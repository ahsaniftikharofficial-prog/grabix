"""
AniWatch service — PRIMARY anime data source for Grabix.

Provider priority (HiAnime / AniWatch / 9anime are DOWN):
  Search / Info:  GogoAnime → AnimePahe → Jikan (MAL)
  Discover/Browse: Jikan (GogoAnime has no browse API)
"""

import json
import os
import time
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import HTTPException

ANIWATCH_TIMEOUT = 8.0
JIKAN_API_BASE = "https://api.jikan.moe/v4"

_CACHE: dict[str, tuple[float, Any]] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_local_base() -> str:
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
        raise HTTPException(status_code=502, detail=f"Local sidecar error {r.status_code}: {path}")
    return _cache_set(key, r.json(), ttl)


async def _jikan(path: str, params: dict | None = None, ttl: int = 300) -> Any:
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
# Normalizers
# ---------------------------------------------------------------------------

def _norm_local(item: dict) -> dict:
    return {
        "id": str(item.get("id", "")),
        "provider": "hianime",
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


def _norm_gogoanime(item: dict) -> dict:
    sub_or_dub = str(item.get("subOrDub", "sub")).lower()
    return {
        "id": str(item.get("id", "")),
        "provider": "gogoanime",
        "type": str(item.get("type", "TV")),
        "title": str(item.get("title", "")),
        "alt_title": "",
        "image": str(item.get("image", "")),
        "description": str(item.get("description", "")),
        "year": item.get("releaseDate"),
        "rating": None,
        "status": str(item.get("status", "")),
        "genres": list(item.get("genres", [])),
        "languages": ["dub"] if sub_or_dub == "dub" else ["sub"],
        "episodes_count": int(item.get("totalEpisodes", 0)) or None,
        "url": str(item.get("url", "")),
        "raw": item,
    }


def _normalize_gogoanime_info(data: dict) -> dict:
    episodes = []
    for ep in (data.get("episodes") or []):
        episodes.append({
            "id": str(ep.get("id", "")),
            "number": int(ep.get("number", 0)),
            "title": str(ep.get("title", "") or ""),
            "isFiller": False,
        })
    total = int(data.get("totalEpisodes", 0) or len(episodes))
    sub_or_dub = str(data.get("subOrDub", "sub")).lower()
    return {
        "anime": {
            "info": {
                "name": str(data.get("title", "")),
                "poster": str(data.get("image", "")),
                "description": str(data.get("description", "")),
                "stats": {
                    "rating": str(data.get("rating", "")),
                    "quality": "HD",
                    "episodes": {"sub": total, "dub": total if sub_or_dub == "dub" else 0},
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
        "dubEpisodeCount": total if sub_or_dub == "dub" else 0,
        "_provider": "gogoanime",
    }


def _norm_animepahe_search(item: dict) -> dict:
    return {
        "id": str(item.get("id", "")),
        "provider": "animepahe",
        "type": str(item.get("type", "TV")),
        "title": str(item.get("title", "")),
        "alt_title": "",
        "image": str(item.get("image", item.get("poster", ""))),
        "description": "",
        "year": item.get("year"),
        "rating": None,
        "status": str(item.get("status", "")),
        "genres": [],
        "languages": ["sub"],
        "episodes_count": int(item.get("episodes", 0)) or None,
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


def _normalize_animekai_info(data: dict) -> dict:
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


def _norm_jikan(item: dict) -> dict:
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
# Jikan browse map (GogoAnime has no browse/discover API)
# ---------------------------------------------------------------------------

_JIKAN_PATHS: dict[str, tuple[str, dict]] = {
    "trending":         ("/top/anime", {"filter": "airing"}),
    "popular":          ("/top/anime", {"filter": "bypopularity"}),
    "toprated":         ("/top/anime", {"filter": "favorite"}),
    "seasonal":         ("/seasons/now", {}),
    "movie":            ("/top/anime", {"type": "movie"}),
    "subbed":           ("/top/anime", {"filter": "airing"}),
    "dubbed":           ("/top/anime", {"filter": "airing"}),
    "ova":              ("/top/anime", {"type": "ova"}),
    "ona":              ("/top/anime", {"type": "ona"}),
    "tv":               ("/top/anime", {"type": "tv"}),
    "special":          ("/top/anime", {"type": "special"}),
    "recently-updated": ("/top/anime", {"filter": "airing"}),
    "recently-added":   ("/top/anime", {"filter": "bypopularity"}),
    "top-upcoming":     ("/top/anime", {"filter": "upcoming"}),
    "latest-completed": ("/top/anime", {"filter": "complete"}),
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def get_health() -> dict:
    try:
        async with httpx.AsyncClient(timeout=3.0) as c:
            r = await c.get(f"{_get_local_base()}/")
        return {"healthy": r.status_code < 400, "source": "consumet-local", "base": _get_local_base()}
    except Exception as exc:
        return {"healthy": False, "source": "consumet-local", "error": str(exc)}


async def discover(section: str = "trending", page: int = 1, period: str = "daily") -> dict:
    """Discover anime — Jikan primary (GogoAnime has no browse API)."""
    try:
        jpath, jextra = _JIKAN_PATHS.get(section, ("/top/anime", {}))
        data = await _jikan(jpath, {"page": page, "limit": 20, **jextra}, ttl=300)
        items = [_norm_jikan(i) for i in data.get("data", [])]
        if items:
            return {
                "section": section, "page": page, "source": "jikan",
                "has_next": bool(data.get("pagination", {}).get("has_next_page", False)),
                "items": items,
            }
    except Exception:
        pass
    raise HTTPException(status_code=502, detail=f"Discover failed for section={section}")


async def search(query: str, page: int = 1) -> dict:
    """Search anime — GogoAnime → AnimePahe → Jikan."""

    # 1. GogoAnime
    try:
        data = await _local(f"/anime/gogoanime/{quote(query, safe='')}", {"page": page}, ttl=120)
        raw = data.get("results") or []
        items = [_norm_gogoanime(i) for i in raw if i.get("id")]
        if items:
            return {
                "query": query, "page": page, "source": "gogoanime",
                "has_next": bool(data.get("hasNextPage", False)),
                "items": items,
            }
    except Exception:
        pass

    # 2. AnimePahe
    try:
        data = await _local(f"/anime/animepahe/{quote(query, safe='')}", {"page": page}, ttl=120)
        raw = data.get("results") or []
        items = [_norm_animepahe_search(i) for i in raw if i.get("id")]
        if items:
            return {
                "query": query, "page": page, "source": "animepahe",
                "has_next": bool(data.get("hasNextPage", False)),
                "items": items,
            }
    except Exception:
        pass

    # 3. Jikan
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
    try:
        data = await _jikan("/genres/anime", ttl=3600)
        genres = [{"id": str(g["mal_id"]), "name": g["name"]} for g in data.get("data", [])]
        return {"genres": genres}
    except Exception:
        return {"genres": []}


async def get_genre_anime(genre: str, page: int = 1) -> dict:
    try:
        data = await _jikan("/anime", {"genres": genre, "page": page, "limit": 20}, ttl=300)
        items = [_norm_jikan(i) for i in data.get("data", [])]
        return {
            "genre": genre, "page": page, "source": "jikan",
            "has_next": bool(data.get("pagination", {}).get("has_next_page", False)),
            "items": items,
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Genre fetch failed: {exc}")


async def get_info(anime_id: str, provider: str = "gogoanime") -> dict:
    """Get anime info and episode list — provider-aware.

    gogoanime / animepahe / animekai  → direct provider lookup
    hianime (down) → re-route to GogoAnime via slug-title search
    jikan / numeric → Jikan cross-ref → GogoAnime title search → AnimePahe → Jikan-only
    """
    aid = str(anime_id or "").strip()
    prov = str(provider or "gogoanime").strip().lower()
    is_numeric = aid.isdigit()

    # GogoAnime
    if prov == "gogoanime":
        try:
            data = await _local("/anime/gogoanime/info", {"id": aid})
            return _normalize_gogoanime_info(data)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"GogoAnime info failed: {exc}")

    # AnimePahe
    if prov == "animepahe":
        try:
            data = await _local(f"/anime/animepahe/info/{quote(aid, safe='')}")
            episodes = []
            for ep in (data.get("episodes") or []):
                episodes.append({
                    "id": str(ep.get("id", "")),
                    "number": int(ep.get("number", ep.get("episode", 0))),
                    "title": str(ep.get("title", "") or ""),
                    "isFiller": False,
                })
            total = len(episodes)
            return {
                "anime": {
                    "info": {
                        "name": str(data.get("title", "")),
                        "poster": str(data.get("image", data.get("poster", ""))),
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
                "_provider": "animepahe",
            }
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"AnimePahe info failed: {exc}")

    # AnimeKai
    if prov == "animekai":
        try:
            data = await _local("/anime/animekai/info", {"id": aid})
            return _normalize_animekai_info(data)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"AnimeKai info failed: {exc}")

    # HiAnime slug → re-route to GogoAnime (HiAnime is down)
    if prov == "hianime" and not is_numeric:
        slug_title = aid.rsplit("-", 1)[0].replace("-", " ") if "-" in aid else aid.replace("-", " ")
        if slug_title:
            try:
                sd = await _local(f"/anime/gogoanime/{quote(slug_title, safe='')}", ttl=120)
                results = sd.get("results") or []
                if results:
                    gogo_id = str(results[0].get("id", "")).strip()
                    if gogo_id:
                        info_data = await _local("/anime/gogoanime/info", {"id": gogo_id})
                        normalized = _normalize_gogoanime_info(info_data)
                        normalized["_resolved_from_hianime"] = aid
                        return normalized
            except Exception:
                pass
            try:
                sd = await _local(f"/anime/animepahe/{quote(slug_title, safe='')}", ttl=120)
                results = sd.get("results") or []
                if results:
                    pahe_id = str(results[0].get("id", "")).strip()
                    if pahe_id:
                        return await get_info(pahe_id, provider="animepahe")
            except Exception:
                pass
        raise HTTPException(
            status_code=502,
            detail=f"HiAnime is down. GogoAnime/AnimePahe cross-reference also failed for id={aid}."
        )

    # Numeric = Jikan/MAL ID
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
                        "episodes": {"sub": item.get("episodes") or 0, "dub": 0},
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

    if title:
        try:
            sd = await _local(f"/anime/gogoanime/{quote(title, safe='')}", ttl=120)
            results = sd.get("results") or []
            if results:
                gogo_id = str(results[0].get("id", "")).strip()
                if gogo_id:
                    info_data = await _local("/anime/gogoanime/info", {"id": gogo_id})
                    normalized = _normalize_gogoanime_info(info_data)
                    normalized["_resolved_from_jikan"] = aid
                    return normalized
        except Exception:
            pass

        try:
            sd = await _local(f"/anime/animepahe/{quote(title, safe='')}", ttl=120)
            results = sd.get("results") or []
            if results:
                pahe_id = str(results[0].get("id", "")).strip()
                if pahe_id:
                    result = await get_info(pahe_id, provider="animepahe")
                    result["_resolved_from_jikan"] = aid
                    return result
        except Exception:
            pass

    if jikan_fallback:
        return jikan_fallback

    raise HTTPException(status_code=502, detail=f"Could not fetch anime info for id={aid}")


async def get_schedule(date: str) -> dict:
    try:
        data = await _jikan("/schedules", {"page": 1, "limit": 25}, ttl=600)
        scheduled = []
        for item in data.get("data", []):
            scheduled.append({
                "id": str(item.get("mal_id", "")),
                "title": str(item.get("title", "")),
                "image": str(item.get("images", {}).get("jpg", {}).get("image_url", "")),
                "url": str(item.get("url", "")),
                "time": "",
            })
        return {"date": date, "source": "jikan", "scheduled": scheduled}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Schedule fetch failed: {exc}")


async def get_spotlight() -> dict:
    try:
        data = await _jikan("/top/anime", {"filter": "airing", "limit": 10}, ttl=300)
        items = [_norm_jikan(i) for i in data.get("data", [])]
        return {"source": "jikan", "items": items}
    except Exception:
        return {"source": "none", "items": []}
