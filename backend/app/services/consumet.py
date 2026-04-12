"""
app/services/consumet.py  — HTTP client helpers for the consumet-local sidecar.

The consumet-local sidecar runs on port 3000 (node server.cjs).
These helpers are thin wrappers that translate backend calls into sidecar
HTTP requests and normalise the responses.

Nothing in this file imports from app.routes — only from stdlib / third-party.
"""

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("consumet.service")

# ---------------------------------------------------------------------------
# Sidecar base URL
# ---------------------------------------------------------------------------

def get_consumet_api_base() -> str:
    """
    Return the base URL of the consumet-local sidecar.
    Reads CONSUMET_API_BASE env var (set by run.bat / start-backend.cmd).
    Falls back to http://127.0.0.1:3000.
    """
    base = os.environ.get("CONSUMET_API_BASE", "").strip().rstrip("/")
    return base if base else "http://127.0.0.1:3000"


def is_consumet_configured() -> bool:
    """Return True if the sidecar base URL is set."""
    return bool(get_consumet_api_base())


# ---------------------------------------------------------------------------
# Shared HTTP client factory
# ---------------------------------------------------------------------------

def _client(timeout: float = 20.0) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout, follow_redirects=True)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

async def get_health_status() -> dict[str, Any]:
    """Ping the sidecar and return a health dict."""
    base = get_consumet_api_base()
    try:
        async with _client(timeout=5.0) as c:
            r = await c.get(f"{base}/")
            reachable = r.status_code < 500
            try:
                body: Any = r.json()
            except Exception:
                body = r.text[:200]
            return {
                "healthy": reachable,
                "status_code": r.status_code,
                "base": base,
                "body": body,
            }
    except Exception as exc:
        return {
            "healthy": False,
            "base": base,
            "error": str(exc),
            "hint": "Start the sidecar: cd consumet-local && node server.cjs",
        }


# ---------------------------------------------------------------------------
# Anime helpers
# ---------------------------------------------------------------------------

async def discover_anime(
    section: str = "trending",
    page: int = 1,
    period: str = "daily",
) -> dict[str, Any]:
    base = get_consumet_api_base()
    try:
        async with _client() as c:
            r = await c.get(
                f"{base}/anime/hianime/featured",
                params={"section": section, "page": page, "period": period},
            )
            if r.status_code < 400:
                return r.json()
            logger.warning("discover_anime HTTP %d: %s", r.status_code, r.text[:200])
            return {"results": [], "error": f"Sidecar HTTP {r.status_code}"}
    except Exception as exc:
        logger.warning("discover_anime failed: %s", exc)
        return {"results": [], "error": str(exc)}


async def search_domain(
    domain: str,
    query: str,
    provider: str = "zoro",
    page: int = 1,
) -> dict[str, Any]:
    base = get_consumet_api_base()
    try:
        async with _client() as c:
            if domain == "anime":
                r = await c.get(
                    f"{base}/anime/hianime/{query}",
                    params={"page": page},
                )
            else:
                r = await c.get(
                    f"{base}/{domain}/{provider}/{query}",
                    params={"page": page},
                )
            if r.status_code < 400:
                return r.json()
            logger.warning("search_domain %s/%s HTTP %d", domain, query, r.status_code)
            return {"results": [], "error": f"Sidecar HTTP {r.status_code}"}
    except Exception as exc:
        logger.warning("search_domain failed: %s", exc)
        return {"results": [], "error": str(exc)}


async def fetch_domain_info(
    domain: str,
    provider: str,
    media_id: str,
) -> dict[str, Any]:
    base = get_consumet_api_base()
    try:
        async with _client(timeout=25.0) as c:
            if domain == "anime":
                r = await c.get(
                    f"{base}/anime/hianime/info",
                    params={"id": media_id},
                )
            else:
                r = await c.get(
                    f"{base}/{domain}/{provider}/info",
                    params={"id": media_id},
                )
            if r.status_code < 400:
                return r.json()
            logger.warning("fetch_domain_info %s/%s/%s HTTP %d", domain, provider, media_id, r.status_code)
            return {"error": f"Sidecar HTTP {r.status_code}"}
    except Exception as exc:
        logger.warning("fetch_domain_info failed: %s", exc)
        return {"error": str(exc)}


async def fetch_anime_episodes(
    provider: str,
    media_id: str,
) -> dict[str, Any]:
    base = get_consumet_api_base()
    try:
        async with _client(timeout=25.0) as c:
            r = await c.get(
                f"{base}/anime/hianime/info",
                params={"id": media_id},
            )
            if r.status_code < 400:
                data = r.json()
                episodes = data.get("episodes") or []
                return {"items": episodes, "total": len(episodes)}
            logger.warning("fetch_anime_episodes %s/%s HTTP %d", provider, media_id, r.status_code)
            return {"items": [], "error": f"Sidecar HTTP {r.status_code}"}
    except Exception as exc:
        logger.warning("fetch_anime_episodes failed: %s", exc)
        return {"items": [], "error": str(exc)}


async def fetch_anime_watch(
    provider: str,
    episode_id: str,
    server: str | None = None,
    audio: str = "sub",
) -> dict[str, Any]:
    from urllib.parse import quote as urlquote

    base = get_consumet_api_base()
    category = "dub" if str(audio).lower() == "dub" else "sub"
    servers = [server] if server and server not in ("auto", "") else ["vidcloud", "vidstreaming"]

    try:
        async with _client(timeout=35.0) as c:
            for srv in servers:
                url = f"{base}/anime/hianime/watch/{urlquote(episode_id, safe='')}"
                r = await c.get(url, params={"server": srv, "category": category})
                if r.status_code < 400:
                    data = r.json()
                    if data.get("sources"):
                        data["_server_used"] = srv
                        data["_category_used"] = category
                        return data
            return {"sources": [], "subtitles": [], "error": "No sources found"}
    except Exception as exc:
        logger.warning("fetch_anime_watch failed: %s", exc)
        return {"sources": [], "subtitles": [], "error": str(exc)}


# ---------------------------------------------------------------------------
# Manga helpers
# ---------------------------------------------------------------------------

async def discover_manga(
    section: str = "trending",
    page: int = 1,
) -> dict[str, Any]:
    base = get_consumet_api_base()
    try:
        async with _client() as c:
            r = await c.get(
                f"{base}/manga/mangadex/featured",
                params={"section": section, "page": page},
            )
            if r.status_code < 400:
                return r.json()
            return {"results": [], "error": f"Sidecar HTTP {r.status_code}"}
    except Exception as exc:
        return {"results": [], "error": str(exc)}


async def fetch_manga_chapters(
    provider: str,
    media_id: str,
) -> dict[str, Any]:
    base = get_consumet_api_base()
    try:
        async with _client(timeout=25.0) as c:
            r = await c.get(
                f"{base}/manga/{provider}/info",
                params={"id": media_id},
            )
            if r.status_code < 400:
                data = r.json()
                chapters = data.get("chapters") or []
                return {"items": chapters, "total": len(chapters)}
            return {"items": [], "error": f"Sidecar HTTP {r.status_code}"}
    except Exception as exc:
        return {"items": [], "error": str(exc)}


async def fetch_manga_read(
    provider: str,
    chapter_id: str,
) -> dict[str, Any]:
    base = get_consumet_api_base()
    try:
        async with _client(timeout=25.0) as c:
            r = await c.get(
                f"{base}/manga/{provider}/read",
                params={"chapterId": chapter_id},
            )
            if r.status_code < 400:
                return r.json()
            return {"pages": [], "error": f"Sidecar HTTP {r.status_code}"}
    except Exception as exc:
        return {"pages": [], "error": str(exc)}


async def fetch_generic_read(
    domain: str,
    provider: str,
    item_id: str,
) -> dict[str, Any]:
    base = get_consumet_api_base()
    try:
        async with _client(timeout=25.0) as c:
            r = await c.get(
                f"{base}/{domain}/{provider}/read",
                params={"id": item_id},
            )
            if r.status_code < 400:
                return r.json()
            return {"error": f"Sidecar HTTP {r.status_code}"}
    except Exception as exc:
        return {"error": str(exc)}


# ---------------------------------------------------------------------------
# News helpers
# ---------------------------------------------------------------------------

async def fetch_news_feed(
    topic: str | None = None,
) -> dict[str, Any]:
    base = get_consumet_api_base()
    params: dict[str, Any] = {}
    if topic:
        params["topic"] = topic
    try:
        async with _client() as c:
            r = await c.get(f"{base}/news/ann/recent-feeds", params=params)
            if r.status_code < 400:
                return r.json()
            return {"items": [], "error": f"Sidecar HTTP {r.status_code}"}
    except Exception as exc:
        return {"items": [], "error": str(exc)}


async def fetch_news_article(
    article_id: str,
) -> dict[str, Any]:
    from urllib.parse import quote as urlquote

    base = get_consumet_api_base()
    try:
        async with _client() as c:
            r = await c.get(f"{base}/news/ann/info/{urlquote(article_id, safe='')}")
            if r.status_code < 400:
                return r.json()
            return {"error": f"Sidecar HTTP {r.status_code}"}
    except Exception as exc:
        return {"error": str(exc)}


# ---------------------------------------------------------------------------
# Meta (movies / TV via TMDB-backed consumet)
# ---------------------------------------------------------------------------

async def fetch_meta_search(
    query: str,
    media_type: str = "movie",
) -> dict[str, Any]:
    base = get_consumet_api_base()
    try:
        async with _client() as c:
            r = await c.get(
                f"{base}/meta/tmdb/{query}",
                params={"type": media_type},
            )
            if r.status_code < 400:
                return r.json()
            return {"results": [], "error": f"Sidecar HTTP {r.status_code}"}
    except Exception as exc:
        return {"results": [], "error": str(exc)}


async def fetch_meta_info(
    item_id: str,
    media_type: str = "movie",
) -> dict[str, Any]:
    base = get_consumet_api_base()
    try:
        async with _client(timeout=25.0) as c:
            r = await c.get(
                f"{base}/meta/tmdb/info/{item_id}",
                params={"type": media_type},
            )
            if r.status_code < 400:
                return r.json()
            return {"error": f"Sidecar HTTP {r.status_code}"}
    except Exception as exc:
        return {"error": str(exc)}


# ---------------------------------------------------------------------------
# Proxy helper (CDN image proxy to avoid CORS)
# ---------------------------------------------------------------------------

async def fetch_proxy_response(url: str) -> tuple[bytes, str | None]:
    """
    Fetch an external URL (image / resource) and return (content_bytes, media_type).
    Raises on failure so the caller can return a 502.
    """
    async with _client(timeout=15.0) as c:
        r = await c.get(url)
        r.raise_for_status()
        media_type = r.headers.get("content-type")
        return r.content, media_type
