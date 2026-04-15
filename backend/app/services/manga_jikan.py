import asyncio
from typing import Any

import httpx

from app.services.manga_cache import get_cached, set_cached

JIKAN_BASE = "https://api.jikan.moe/v4"
_jikan_lock = asyncio.Lock()
_last_jikan_request = 0.0


def _image_url(data: dict[str, Any]) -> str:
    images = data.get("images") or {}
    jpg = images.get("jpg") or {}
    webp = images.get("webp") or {}
    return jpg.get("large_image_url") or jpg.get("image_url") or webp.get("large_image_url") or ""


def _authors(data: dict[str, Any]) -> list[str]:
    authors = []
    for item in data.get("authors") or []:
        name = item.get("name")
        if name:
            authors.append(name)
    return authors


def _serialization(data: dict[str, Any]) -> str:
    serials = [item.get("name") for item in (data.get("serializations") or []) if item.get("name")]
    return ", ".join(serials)


def _map_manga(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "mal_id": data.get("mal_id"),
        "title": data.get("title_english") or data.get("title") or "Unknown",
        "score": float(data.get("score") or 0),
        "rank": data.get("rank"),
        "synopsis": data.get("synopsis") or "",
        "genres": [item.get("name") for item in (data.get("genres") or []) if item.get("name")],
        "authors": _authors(data),
        "serialization": _serialization(data),
        "status": data.get("status") or "Unknown",
        "chapters": data.get("chapters"),
        "cover_image": _image_url(data),
    }


async def jikan_request(endpoint: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    global _last_jikan_request

    async with _jikan_lock:
        loop = asyncio.get_running_loop()
        gap = loop.time() - _last_jikan_request
        if gap < 0.4:
            await asyncio.sleep(0.4 - gap)
        _last_jikan_request = loop.time()

    async with httpx.AsyncClient(timeout=8.0) as client:
        for attempt in range(3):
            try:
                response = await client.get(f"{JIKAN_BASE}{endpoint}", params=params or {})
                if response.status_code == 429:
                    await asyncio.sleep(1)
                    continue
                if response.status_code == 404:
                    return {}
                if response.status_code == 503:
                    raise Exception("Jikan: MyAnimeList is currently down")
                response.raise_for_status()
                return response.json()
            except httpx.TimeoutException:
                if attempt == 2:
                    raise Exception("Jikan: Request timed out after 3 attempts")
                await asyncio.sleep(1)

    return {}


async def get_manga_by_query(title: str) -> dict | None:
    cache_key = f"jikan:search:{title.strip().lower()}"
    cached = await get_cached(cache_key)
    if cached:
        return dict(cached["data"]) if cached["data"] else None

    data = await jikan_request("/manga", {"q": title, "limit": 1})
    items = data.get("data") or []
    if not items:
        await set_cached(cache_key, {}, "jikan", expires_hours=6)
        return None
    result = _map_manga(items[0])
    await set_cached(cache_key, result, "jikan", expires_hours=6)
    return result


async def get_manga_by_mal_id(mal_id: int) -> dict:
    cache_key = f"jikan:manga:{mal_id}"
    cached = await get_cached(cache_key)
    if cached:
        return dict(cached["data"])

    data = await jikan_request(f"/manga/{mal_id}")
    item = _map_manga(data.get("data") or {})
    await set_cached(cache_key, item, "jikan", expires_hours=24)
    return item


async def get_manga_characters(mal_id: int) -> list[dict]:
    cache_key = f"jikan:manga-characters:{mal_id}"
    cached = await get_cached(cache_key)
    if cached:
        return list(cached["data"])

    data = await jikan_request(f"/manga/{mal_id}/characters")
    items = []
    for row in data.get("data") or []:
        character = row.get("character") or {}
        items.append(
            {
                "name": character.get("name") or "Unknown",
                "role": row.get("role") or "",
                "image": _image_url(character),
            }
        )
    await set_cached(cache_key, items, "jikan", expires_hours=24)
    return items


async def get_related_manga(mal_id: int) -> list[dict]:
    cache_key = f"jikan:related:{mal_id}"
    cached = await get_cached(cache_key)
    if cached:
        return list(cached["data"])

    data = await jikan_request(f"/manga/{mal_id}/relations")
    items = []
    for relation in data.get("data") or []:
        for entry in relation.get("entry") or []:
            if entry.get("type") != "manga":
                continue
            items.append(
                {
                    "relation": relation.get("relation"),
                    "mal_id": entry.get("mal_id"),
                    "title": entry.get("name") or "Unknown",
                }
            )
    await set_cached(cache_key, items, "jikan", expires_hours=24)
    return items


async def get_top_manga(page: int = 1) -> list[dict]:
    cache_key = f"jikan:top:{page}"
    cached = await get_cached(cache_key)
    if cached:
        return list(cached["data"])

    data = await jikan_request("/top/manga", {"page": page, "limit": 30})
    items = []
    for item in data.get("data") or []:
        items.append(_map_manga(item))
    await set_cached(cache_key, items, "jikan", expires_hours=6)
    return items


async def get_popular_manga_jikan(page: int = 1) -> list[dict]:
    """Fetch popular manga sorted by member count (distinct from score-based get_top_manga)."""
    cache_key = f"jikan:popular:{page}"
    cached = await get_cached(cache_key)
    if cached:
        return list(cached["data"])

    data = await jikan_request("/manga", {"order_by": "members", "sort": "desc", "page": page, "limit": 30})
    items = []
    for item in data.get("data") or []:
        items.append(_map_manga(item))
    await set_cached(cache_key, items, "jikan", expires_hours=6)
    return items
