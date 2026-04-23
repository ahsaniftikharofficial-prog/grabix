"""
AniWatch service — PRIMARY anime data source for Grabix.

Calls the local consumet-local Node.js server (which scrapes aniwatchtv.to
using the aniwatch npm package). Uses an 8-second timeout so if the local
server is slow/down we fall back to Jikan immediately instead of waiting 45s.

All items returned use provider="hianime" so the existing watch/stream/download
flow in consumet.py works unchanged — it already knows how to call
/anime/hianime/watch/{episodeId} on the local server.
"""

import json
import os
import time
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import HTTPException

# Shorter timeout than the 45s consumet default — fail fast, fall back fast
ANIWATCH_TIMEOUT = 8.0
JIKAN_API_BASE = "https://api.jikan.moe/v4"

_CACHE: dict[str, tuple[float, Any]] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_local_base() -> str:
    """Return base URL of the local consumet-local server."""
    base = os.getenv("CONSUMET_API_BASE", "").strip().rstrip("/")
    return base or "http://127.0.0.1:3000"


def _ck(*parts: Any) -> str:
    return f"aw:{json.dumps(parts, sort_keys=True, ensure_ascii=True, default=str)}"


def _cache_get(key: str) -> Any | None:
    entry = _CACHE.get(key)
    if not entry:
        return None
    exp, val = entry
    if exp <= time.time():
        _CACHE.pop(key, None)
        return None
    return val


def _cache_set(key: str, val: Any, ttl: int) -> Any:
    _CACHE[key] = (time.time() + max(ttl, 1), val)
    return val


async def _local(path: str, params: dict | None = None, ttl: int = 300) -> Any:
    """Fetch from the local aniwatch/consumet-local server."""
    fp = {k: v for k, v in (params or {}).items() if v is not None and v != ""}
    key = _ck("local", path, fp)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    url = f"{_get_local_base()}{path}"
    hdrs = {"User-Agent": "GRABIX/2.0", "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=ANIWATCH_TIMEOUT, follow_redirects=True, headers=hdrs) as c:
        r = await c.get(url, params=fp)

    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Local AniWatch server error {r.status_code}")

    return _cache_set(key, r.json(), ttl)


async def _jikan(path: str, params: dict | None = None, ttl: int = 300) -> Any:
    """Fallback to Jikan (MyAnimeList REST API)."""
    fp = {k: v for k, v in (params or {}).items() if v is not None and v != ""}
    key = _ck("jikan", path, fp)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    url = f"{JIKAN_API_BASE}{path}"
    hdrs = {"User-Agent": "GRABIX/2.0", "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers=hdrs) as c:
        r = await c.get(url, params=fp)

    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Jikan error {r.status_code}")

    return _cache_set(key, r.json(), ttl)


# ---------------------------------------------------------------------------
# Normalizers — note provider="hianime" so existing watch/stream flow works
# ---------------------------------------------------------------------------

def _norm_local(item: dict) -> dict:
    return {
        "id": str(item.get("id", "")),
        "provider": "hianime",          # keeps existing watch/stream flow working
        "type": str(item.get("type", "anime")),
        "title": str(item.get("title", item.get("name", ""))),
        "alt_title": str(item.get("otherName", item.get("jname", ""))),
        "image": str(item.get("image", item.get("poster", ""))),
        "description": str(item.get("description", "")),
        "year": None,
        "rating": float(item["rating"]) if item.get("rating") else None,
        "status": str(item.get("status", "")),
        "genres": list(item.get("genres", [])),
        "languages": ["sub", "dub"] if item.get("subOrDub") == "dub" else ["sub"],
        "episodes_count": int(item.get("totalEpisodes", 0)) or None,
        "dub_episode_count": int(item.get("dubEpisodeCount", 0)) or None,
        "url": str(item.get("url", "")),
        "raw": item,
    }


def _norm_animekai_search(item: dict) -> dict:
    return {
        "id": str(item.get("id", "")),
        "provider": "animekai",
        "type": str(item.get("type", "TV")),
        "title": str(item.get("title", "")),
        "alt_title": "",
        "image": str(item.get("image", item.get("img", ""))),
        "description": "",
        "year": None,
        "rating": None,
        "status": str(item.get("status", "")),
        "genres": [],
        "languages": ["sub"],
        "episodes_count": None,
        "url": str(item.get("url", "")),
        "raw": item,
    }


def _norm_kickass_search(item: dict) -> dict:
    return {
        "id": str(item.get("id", "")),
        "provider": "kickassanime",
        "type": str(item.get("type", "TV")),
        "title": str(item.get("title", "")),
        "alt_title": "",
        "image": str(item.get("image", item.get("thumbnail", ""))),
        "description": "",
        "year": None,
        "rating": None,
        "status": str(item.get("status", "")),
        "genres": [],
        "languages": ["sub"],
        "episodes_count": None,
        "url": str(item.get("url", "")),
        "raw": item,
    }


def _normalize_animekai_info(data: dict) -> dict:
    """Normalize AnimeKai fetchAnimeInfo response to HiAnimeInfo shape."""
    episodes = []
    for ep in (data.get("episodes") or []):
        episodes.append({
            "id": str(ep.get("id", "")),
            "number": int(ep.get("number", 0)),
            "title": str(ep.get("title", "") or ""),
            "isFiller": bool(ep.get("isFiller", False)),
        })
    total = int(data.get("totalEpisodes", 0) or len(episodes))
    return {
        "anime": {
            "info": {
                "name": str(data.get("title", "")),
                "poster": str(data.get("image", "")),
                "description": str(data.get("description", "")),
                "stats": {
                    "rating": str(data.get("rating", "")),
                    "quality": "HD",
                    "episodes": {"sub": total, "dub": 0},
                    "type": str(data.get("type", "TV")),
                    "duration": str(data.get("duration", "")),
                },
            },
            "moreInfo": {
                "status": str(data.get("status", "")),
                "genres": list(data.get("genres", [])),
                "studios": [],
            },
        },
        "episodes": episodes,
        "totalEpisodes": total,
        "subEpisodeCount": total,
        "dubEpisodeCount": 0,
        "_provider": "animekai",
    }


def _normalize_kickass_info(data: dict) -> dict:
    """Normalize KickAssAnime fetchAnimeInfo response to HiAnimeInfo shape."""
    episodes = []
    for ep in (data.get("episodes") or []):
        episodes.append({
            "id": str(ep.get("id", "")),
            "number": int(ep.get("number", 0)),
            "title": str(ep.get("title", "") or ""),
            "isFiller": False,
        })
    total = int(data.get("totalEpisodes", 0) or len(episodes))
    return {
        "anime": {
            "info": {
                "name": str(data.get("title", "")),
                "poster": str(data.get("image", "")),
                "description": str(data.get("description", "")),
                "stats": {
                    "rating": "",
                    "quality": "HD",
                    "episodes": {"sub": total, "dub": 0},
                    "type": str(data.get("type", "TV")),
                    "duration": "",
                },
            },
            "moreInfo": {
                "status": str(data.get("status", "")),
                "genres": list(data.get("genres", [])),
                "studios": [],
            },
        },
        "episodes": episodes,
        "totalEpisodes": total,
        "subEpisodeCount": total,
        "dubEpisodeCount": 0,
        "_provider": "kickassanime",
    }



    jpg = item.get("images", {}).get("jpg", {})
    return {
        "id": str(item.get("mal_id", "")),
        "provider": "jikan",
        "type": "anime",
        "title": str(item.get("title_english") or item.get("title", "")),
        "alt_title": str(item.get("title", "")),
        "image": str(jpg.get("large_image_url") or jpg.get("image_url", "")),
        "description": str(item.get("synopsis", "")),
        "year": item.get("year"),
        "rating": float(item["score"]) if item.get("score") else None,
        "status": str(item.get("status", "")),
        "genres": [g["name"] for g in item.get("genres", [])],
        "languages": ["sub"],
        "episodes_count": item.get("episodes"),
        "mal_id": item.get("mal_id"),
        "url": str(item.get("url", "")),
        "raw": item,
    }


# ---------------------------------------------------------------------------
# Section → local server path map
# ---------------------------------------------------------------------------

_LOCAL_PATHS: dict[str, str] = {
    "trending":           "/anime/hianime/top10",
    "popular":            "/anime/hianime/most-popular",
    "toprated":           "/anime/hianime/most-favorite",
    "seasonal":           "/anime/hianime/top-airing",
    "movie":              "/anime/hianime/movie",
    "subbed":             "/anime/hianime/subbed-anime",
    "dubbed":             "/anime/hianime/dubbed-anime",
    "ova":                "/anime/hianime/ova",
    "ona":                "/anime/hianime/ona",
    "tv":                 "/anime/hianime/tv",
    "special":            "/anime/hianime/special",
    "recently-updated":   "/anime/hianime/recently-updated",
    "recently-added":     "/anime/hianime/recently-added",
    "top-upcoming":       "/anime/hianime/top-upcoming",
    "latest-completed":   "/anime/hianime/latest-completed",
}

_JIKAN_PATHS: dict[str, tuple[str, dict]] = {
    "trending":  ("/top/anime", {"filter": "airing"}),
    "popular":   ("/top/anime", {"filter": "bypopularity"}),
    "toprated":  ("/top/anime", {"filter": "favorite"}),
    "seasonal":  ("/seasons/now", {}),
    "movie":     ("/top/anime", {"type": "movie"}),
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def get_health() -> dict:
    try:
        async with httpx.AsyncClient(timeout=3.0) as c:
            r = await c.get(f"{_get_local_base()}/")
        return {"healthy": r.status_code < 400, "source": "aniwatch-local", "base": _get_local_base()}
    except Exception as exc:
        return {"healthy": False, "source": "aniwatch-local", "error": str(exc)}


async def discover(section: str = "trending", page: int = 1, period: str = "daily") -> dict:
    """Discover anime — local AniWatch first, Jikan fallback."""
    # ---- local server ----
    try:
        path = _LOCAL_PATHS.get(section, "/anime/hianime/top10")

        # For trending, use the home page endpoint — one fast call gets everything
        if section == "trending":
            home = await _local("/anime/hianime/home", ttl=300)
            period_map = {"daily": "today", "weekly": "week", "monthly": "month"}
            period_key = period_map.get(period, "today")
            top10 = home.get("top10Animes", {})
            raw = top10.get(period_key) or home.get("trendingAnimes") or []
            items = [_norm_local(i) for i in raw if i.get("id")]
            if items:
                return {"section": section, "page": page, "source": "aniwatch", "has_next": False, "items": items}
        else:
            params: dict = {"page": page}
            data = await _local(path, params, ttl=300)
            raw = data.get("items") or data.get("results") or data.get("animes") or []
            items = [_norm_local(i) for i in raw if i.get("id")]
            if items:
                return {
                    "section": section, "page": page, "source": "aniwatch",
                    "has_next": bool(data.get("hasNextPage", False)),
                    "items": items,
                }
    except Exception:
        pass

    # ---- Jikan fallback ----
    try:
        jpath, jextra = _JIKAN_PATHS.get(section, ("/top/anime", {}))
        data = await _jikan(jpath, {"page": page, "limit": 20, **jextra}, ttl=300)
        items = [_norm_jikan(i) for i in data.get("data", [])]
        return {
            "section": section, "page": page, "source": "jikan",
            "has_next": bool(data.get("pagination", {}).get("has_next_page", False)),
            "items": items,
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AniWatch and Jikan both failed: {exc}")


async def search(query: str, page: int = 1) -> dict:
    """Search anime — HiAnime first, then AnimeKai, then KickAssAnime, then Jikan."""
    # ── 1. HiAnime ────────────────────────────────────────────────────────────
    try:
        data = await _local(
            "/anime/hianime/advanced-search",
            {"keyword": query, "page": page},
            ttl=120,
        )
        raw = data.get("results") or data.get("animes") or []
        items = [_norm_local(i) for i in raw if i.get("id")]
        if items:
            return {
                "query": query, "page": page, "source": "hianime",
                "has_next": bool(data.get("hasNextPage", False)),
                "items": items,
            }
    except Exception:
        pass

    # ── 2. AnimeKai fallback ──────────────────────────────────────────────────
    try:
        data = await _local(
            f"/anime/animekai/{quote(query, safe='')}",
            {"page": page},
            ttl=120,
        )
        raw = data.get("results") or []
        items = [_norm_animekai_search(i) for i in raw if i.get("id")]
        if items:
            return {
                "query": query, "page": page, "source": "animekai",
                "has_next": bool(data.get("hasNextPage", False)),
                "items": items,
            }
    except Exception:
        pass

    # ── 3. KickAssAnime fallback ──────────────────────────────────────────────
    try:
        data = await _local(
            f"/anime/kickassanime/{quote(query, safe='')}",
            {"page": page},
            ttl=120,
        )
        raw = data.get("results") or []
        items = [_norm_kickass_search(i) for i in raw if i.get("id")]
        if items:
            return {
                "query": query, "page": page, "source": "kickassanime",
                "has_next": bool(data.get("hasNextPage", False)),
                "items": items,
            }
    except Exception:
        pass

    # ── 4. Jikan (MAL) last resort ────────────────────────────────────────────
    try:
        data = await _jikan("/anime", {"q": query, "page": page, "limit": 20, "sfw": True}, ttl=120)
        items = [_norm_jikan(i) for i in data.get("data", [])]
        return {
            "query": query, "page": page, "source": "jikan",
            "has_next": bool(data.get("pagination", {}).get("has_next_page", False)),
            "items": items,
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"All search providers failed: {exc}")


async def get_genres() -> dict:
    """Get genre list."""
    try:
        data = await _local("/anime/hianime/genres", ttl=3600)
        genres = data if isinstance(data, list) else []
        return {"genres": genres}
    except Exception:
        pass
    try:
        data = await _jikan("/genres/anime", ttl=3600)
        genres = [{"id": str(g["mal_id"]), "name": g["name"]} for g in data.get("data", [])]
        return {"genres": genres}
    except Exception:
        return {"genres": []}


async def get_genre_anime(genre: str, page: int = 1) -> dict:
    """Get anime by genre."""
    try:
        data = await _local(
            f"/anime/hianime/genre/{quote(genre, safe='')}",
            {"page": page},
            ttl=300,
        )
        raw = data.get("results") or data.get("animes") or []
        items = [_norm_local(i) for i in raw if i.get("id")]
        return {
            "genre": genre, "page": page, "source": "aniwatch",
            "has_next": bool(data.get("hasNextPage", False)),
            "items": items,
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Genre fetch failed: {exc}")


async def get_info(anime_id: str, provider: str = "hianime") -> dict:
    """Get anime info — provider-aware.

    Routes to the correct sidecar endpoint based on provider:
      - hianime  → HiAnime scraper (primary, may be Cloudflare-blocked)
      - animekai → AnimeKai provider (independent of aniwatchtv.to)
      - kickassanime → KickAssAnime provider
      - jikan (or numeric ID) → Jikan cross-reference then HiAnime, falls back to Jikan-only

    Returns HiAnimeInfo-shaped dict so the existing UI renders it unchanged.
    """
    aid = str(anime_id or "").strip()
    prov = str(provider or "hianime").strip().lower()
    is_numeric = aid.isdigit()

    # ── AnimeKai ──────────────────────────────────────────────────────────────
    if prov == "animekai":
        try:
            data = await _local("/anime/animekai/info", {"id": aid})
            return _normalize_animekai_info(data)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"AnimeKai info failed: {exc}")

    # ── KickAssAnime ──────────────────────────────────────────────────────────
    if prov == "kickassanime":
        try:
            data = await _local("/anime/kickassanime/info", {"id": aid})
            return _normalize_kickass_info(data)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"KickAssAnime info failed: {exc}")

    # ── HiAnime slug path ─────────────────────────────────────────────────────
    if not is_numeric:
        try:
            return await _local("/anime/hianime/info", {"id": aid})
        except Exception:
            pass
        # HiAnime failed — try AnimeKai by cross-referencing with a title search
        # (we need a title for the cross-ref; skip if we have no other info)
        raise HTTPException(status_code=502, detail=f"HiAnime info failed for id={aid}. HiAnime may be Cloudflare-blocked. Try restarting consumet-local.")

    # ── Numeric = Jikan/MAL ID — cross-reference to get real provider info ────
    title: str = ""
    jikan_fallback: dict | None = None

    try:
        jd = await _jikan(f"/anime/{aid}", ttl=600)
        item = jd.get("data", {})
        title = str(item.get("title_english") or item.get("title") or "")
        jpg = item.get("images", {}).get("jpg", {})
        jikan_fallback = {
            "anime": {
                "info": {
                    "name": title,
                    "poster": str(jpg.get("large_image_url") or jpg.get("image_url", "")),
                    "description": str(item.get("synopsis", "")),
                    "stats": {
                        "rating": str(item.get("score", "")),
                        "quality": "HD",
                        "episodes": {
                            "sub": item.get("episodes") or 0,
                            "dub": 0,
                        },
                        "type": str(item.get("type", "TV")),
                        "duration": str(item.get("duration", "")),
                    },
                },
                "moreInfo": {
                    "status": str(item.get("status", "")),
                    "genres": [g["name"] for g in item.get("genres", [])],
                    "studios": [s["name"] for s in item.get("studios", [])],
                },
            },
            "episodes": [],
            "totalEpisodes": item.get("episodes") or 0,
            "subEpisodeCount": item.get("episodes") or 0,
            "dubEpisodeCount": 0,
            "_source": "jikan",
            "_jikan_id": aid,
        }
    except HTTPException:
        raise
    except Exception:
        pass

    # Try AnimeKai by title search (works even when HiAnime is Cloudflare-blocked)
    if title:
        try:
            sd = await _local(
                f"/anime/animekai/{quote(title, safe='')}",
                {"page": 1},
                ttl=120,
            )
            results = sd.get("results") or []
            if results:
                animekai_id = str(results[0].get("id", "")).strip()
                if animekai_id:
                    info_data = await _local("/anime/animekai/info", {"id": animekai_id})
                    normalized = _normalize_animekai_info(info_data)
                    normalized["_resolved_from_jikan"] = aid
                    return normalized
        except Exception:
            pass

        # Try HiAnime title cross-reference as second option
        try:
            sd = await _local(
                "/anime/hianime/advanced-search",
                {"keyword": title, "page": 1},
                ttl=120,
            )
            results = sd.get("results") or []
            if results:
                hianime_id = str(results[0].get("id", "")).strip()
                if hianime_id:
                    info = await _local("/anime/hianime/info", {"id": hianime_id})
                    info["_resolved_from_jikan"] = aid
                    return info
        except Exception:
            pass

    # Return Jikan-only data as last resort (no episode streaming, but shows metadata)
    if jikan_fallback:
        return jikan_fallback

    raise HTTPException(status_code=502, detail=f"Could not fetch anime info for id={aid}")


async def get_schedule(date: str) -> dict:
    """Get airing schedule for a date (YYYY-MM-DD)."""
    try:
        data = await _local("/anime/hianime/schedule", {"date": date}, ttl=600)
        return {"date": date, "source": "aniwatch", "scheduled": data.get("scheduledAnimes", [])}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Schedule fetch failed: {exc}")


async def get_spotlight() -> dict:
    """Get hero/spotlight anime."""
    try:
        home = await _local("/anime/hianime/home", ttl=300)
        items = [_norm_local(i) for i in home.get("spotlightAnimes", [])]
        return {"source": "aniwatch", "items": items}
    except Exception:
        pass
    try:
        data = await _local("/anime/hianime/spotlight", ttl=300)
        items = [_norm_local(i) for i in data.get("spotlightAnimes", [])]
        return {"source": "aniwatch", "items": items}
    except Exception:
        return {"source": "none", "items": []}