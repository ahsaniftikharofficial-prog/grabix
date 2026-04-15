import asyncio
import html
import re
from typing import Any

import httpx

from app.services.manga_cache import get_cached, set_cached

ANILIST_URL = "https://graphql.anilist.co"
_anilist_lock = asyncio.Lock()
_last_anilist_request = 0.0


def _clean_description(value: str | None) -> str:
    if not value:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", value, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(text).strip()


def _title_value(data: dict[str, Any]) -> str:
    title = data.get("title") or {}
    return title.get("english") or title.get("romaji") or title.get("native") or "Unknown"


def _map_manga(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "anilist_id": data.get("id"),
        "mal_id": data.get("idMal"),
        "title": _title_value(data),
        "cover_image": (data.get("coverImage") or {}).get("large") or "",
        "score": float(data.get("averageScore") or 0),
        "genres": list(data.get("genres") or []),
        "status": data.get("status") or "UNKNOWN",
        "description": _clean_description(data.get("description")),
        "year": data.get("seasonYear"),
    }


async def anilist_request(query: str, variables: dict[str, Any] | None = None, retries: int = 3) -> dict[str, Any]:
    global _last_anilist_request
    payload = {"query": query, "variables": variables or {}}

    async with _anilist_lock:
        loop = asyncio.get_running_loop()
        gap = loop.time() - _last_anilist_request
        if gap < 0.5:
            await asyncio.sleep(0.5 - gap)
        _last_anilist_request = loop.time()

    async with httpx.AsyncClient(timeout=10.0) as client:
        for attempt in range(retries):
            response = await client.post(
                ANILIST_URL,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                },
            )

            if response.status_code == 429:
                retry_after = int(response.headers.get("Retry-After", "60"))
                await asyncio.sleep(retry_after)
                continue
            if response.status_code == 403:
                raise Exception("AniList: API temporarily disabled")

            response.raise_for_status()
            data = response.json()
            if "errors" in data:
                message = data["errors"][0].get("message", "Unknown GraphQL error")
                raise Exception(f"AniList GraphQL error: {message}")
            return data.get("data") or {}

    raise Exception("AniList: Max retries exceeded")


async def get_trending_manga(page: int = 1, per_page: int = 30) -> list[dict]:
    cache_key = f"anilist:trending:{page}:{per_page}"
    cached = await get_cached(cache_key)
    if cached:
        return list(cached["data"])

    query = """
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: MANGA, sort: TRENDING_DESC) {
          id
          idMal
          seasonYear
          title { romaji english native }
          coverImage { large }
          averageScore
          genres
          status
          description(asHtml: false)
        }
      }
    }
    """
    try:
        data = await anilist_request(query, {"page": page, "perPage": per_page})
        items = [_map_manga(item) for item in (data.get("Page", {}).get("media") or [])]
        await set_cached(cache_key, items, "anilist", expires_hours=1)
        return items
    except Exception as exc:
        from app.services.logging_utils import get_logger
        get_logger("manga").warning(f"AniList trending failed: {exc}, using Jikan fallback.")
        from app.services.manga_jikan import get_top_manga
        return await get_top_manga(page=page)



async def get_popular_manga(page: int = 1, per_page: int = 30) -> list[dict]:
    cache_key = f"anilist:popular:{page}:{per_page}"
    cached = await get_cached(cache_key)
    if cached:
        return list(cached["data"])

    query = """
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: MANGA, sort: POPULARITY_DESC) {
          id
          idMal
          seasonYear
          title { romaji english native }
          coverImage { large }
          averageScore
          genres
          status
          description(asHtml: false)
        }
      }
    }
    """
    try:
        data = await anilist_request(query, {"page": page, "perPage": per_page})
        items = [_map_manga(item) for item in (data.get("Page", {}).get("media") or [])]
        await set_cached(cache_key, items, "anilist", expires_hours=1)
        return items
    except Exception as exc:
        from app.services.logging_utils import get_logger
        get_logger("manga").warning(f"AniList popular failed: {exc}, using Jikan fallback.")
        from app.services.manga_jikan import get_popular_manga_jikan
        return await get_popular_manga_jikan(page=page)


async def get_top_rated_manga(page: int = 1, per_page: int = 30) -> list[dict]:
    cache_key = f"anilist:top-rated:{page}:{per_page}"
    cached = await get_cached(cache_key)
    if cached:
        return list(cached["data"])

    query = """
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: MANGA, sort: SCORE_DESC) {
          id
          idMal
          seasonYear
          title { romaji english native }
          coverImage { large }
          averageScore
          genres
          status
          description(asHtml: false)
        }
      }
    }
    """
    try:
        data = await anilist_request(query, {"page": page, "perPage": per_page})
        items = [_map_manga(item) for item in (data.get("Page", {}).get("media") or [])]
        await set_cached(cache_key, items, "anilist", expires_hours=1)
        return items
    except Exception as exc:
        from app.services.logging_utils import get_logger
        get_logger("manga").warning(f"AniList top rated failed: {exc}, using Jikan fallback.")
        from app.services.manga_jikan import get_top_manga
        return await get_top_manga(page=page)


async def search_manga(query_text: str, page: int = 1) -> list[dict]:
    cache_key = f"anilist:search:{query_text.strip().lower()}:{page}"
    cached = await get_cached(cache_key)
    if cached:
        return list(cached["data"])

    query = """
    query ($search: String, $page: Int) {
      Page(page: $page, perPage: 24) {
        media(type: MANGA, search: $search, sort: SEARCH_MATCH) {
          id
          idMal
          seasonYear
          title { romaji english native }
          coverImage { large }
          averageScore
          genres
          status
          description(asHtml: false)
        }
      }
    }
    """
    data = await anilist_request(query, {"search": query_text, "page": page})
    items = [_map_manga(item) for item in (data.get("Page", {}).get("media") or [])]
    await set_cached(cache_key, items, "anilist", expires_hours=6)
    return items


async def get_manga_recommendations(manga_id: int) -> list[dict]:
    cache_key = f"anilist:recommendations:{manga_id}"
    cached = await get_cached(cache_key)
    if cached:
        return list(cached["data"])

    query = """
    query ($id: Int) {
      Media(id: $id, type: MANGA) {
        recommendations(sort: RATING_DESC, perPage: 12) {
          nodes {
            mediaRecommendation {
              id
              idMal
              seasonYear
              title { romaji english native }
              coverImage { large }
              averageScore
              genres
              status
              description(asHtml: false)
            }
          }
        }
      }
    }
    """
    data = await anilist_request(query, {"id": manga_id})
    nodes = data.get("Media", {}).get("recommendations", {}).get("nodes") or []
    items = [_map_manga(node.get("mediaRecommendation") or {}) for node in nodes if node.get("mediaRecommendation")]
    await set_cached(cache_key, items, "anilist", expires_hours=6)
    return items


async def get_seasonal_manga(year: int, season: str) -> list[dict]:
    cache_key = f"anilist:seasonal:{year}:{season}"
    cached = await get_cached(cache_key)
    if cached:
        return list(cached["data"])

    query = """
    query ($seasonYear: Int, $season: MediaSeason) {
      Page(page: 1, perPage: 20) {
        media(type: MANGA, seasonYear: $seasonYear, season: $season, sort: POPULARITY_DESC) {
          id
          idMal
          seasonYear
          title { romaji english native }
          coverImage { large }
          averageScore
          genres
          status
          description(asHtml: false)
        }
      }
    }
    """
    try:
        data = await anilist_request(query, {"seasonYear": year, "season": season})
        items = [_map_manga(item) for item in (data.get("Page", {}).get("media") or [])]
        await set_cached(cache_key, items, "anilist", expires_hours=1)
        return items
    except Exception as exc:
        from app.services.logging_utils import get_logger
        get_logger("manga").warning(f"AniList seasonal failed: {exc}, using Jikan fallback.")
        from app.services.manga_jikan import get_top_manga
        return await get_top_manga(page=1)



async def get_manga_by_id(manga_id: int) -> dict[str, Any] | None:
    cache_key = f"anilist:detail:{manga_id}"
    cached = await get_cached(cache_key)
    if cached:
        return dict(cached["data"])

    query = """
    query ($id: Int) {
      Media(id: $id, type: MANGA) {
        id
        idMal
        seasonYear
        title { romaji english native }
        coverImage { large }
        averageScore
        genres
        status
        description(asHtml: false)
      }
    }
    """
    data = await anilist_request(query, {"id": manga_id})
    media = data.get("Media")
    if not media:
        return None
    item = _map_manga(media)
    await set_cached(cache_key, item, "anilist", expires_hours=24)
    return item
