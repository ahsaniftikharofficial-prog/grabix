import asyncio
import html
import re
from typing import Any

import httpx

from app.services.manga_cache import get_cached, set_cached

MANGADEX_BASE = "https://api.mangadex.org"
MANGADEX_UPLOADS = "https://uploads.mangadex.org"
MANGADEX_HEADERS = {"User-Agent": "GRABIX/1.0"}


def _title_value(data: dict[str, Any]) -> str:
    title = data.get("title") or {}
    return title.get("en") or title.get("ja-ro") or next(iter(title.values()), "Unknown")


def _description_value(data: dict[str, Any]) -> str:
    desc = data.get("description") or {}
    raw = desc.get("en") or next(iter(desc.values()), "")
    text = re.sub(r"<br\s*/?>", "\n", raw, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(text).strip()


def _tag_values(data: dict[str, Any]) -> list[str]:
    tags = []
    for item in data.get("tags") or []:
        name = _title_value(item.get("attributes") or {})
        if name:
            tags.append(name)
    return tags


def _cover_filename(item: dict[str, Any]) -> str:
    for rel in item.get("relationships") or []:
        if rel.get("type") == "cover_art":
            attrs = rel.get("attributes") or {}
            if attrs.get("fileName"):
                return attrs["fileName"]
    return ""


def _map_search_item(item: dict[str, Any]) -> dict[str, Any]:
    attrs = item.get("attributes") or {}
    cover_filename = _cover_filename(item)
    return {
        "mangadex_id": item.get("id"),
        "title": _title_value(attrs),
        "description": _description_value(attrs),
        "cover_image": get_cover_url_sync(item.get("id"), cover_filename) if cover_filename else "",
        "status": attrs.get("status") or "unknown",
        "genres": _tag_values(attrs),
        "year": attrs.get("year"),
    }


async def mangadex_request(url: str, params: dict[str, Any] | None = None, retries: int = 3) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0, headers=MANGADEX_HEADERS) as client:
        for attempt in range(retries):
            response = await client.get(url, params=params or {})
            if response.status_code == 429:
                wait = int(response.headers.get("Retry-After", str(2**attempt)))
                await asyncio.sleep(wait)
                continue
            if response.status_code == 403:
                raise Exception("MangaDex temporarily blocked. Try again in 10 minutes.")
            if response.status_code == 404:
                return {}
            response.raise_for_status()
            return response.json()
    raise Exception("MangaDex: Max retries exceeded")


def get_cover_url_sync(manga_id: str, cover_filename: str) -> str:
    return f"{MANGADEX_UPLOADS}/covers/{manga_id}/{cover_filename}.256.jpg"


async def search_manga(title: str) -> list[dict]:
    cache_key = f"mangadex:search:{title.strip().lower()}"
    cached = await get_cached(cache_key)
    if cached:
        return list(cached["data"])

    data = await mangadex_request(
        f"{MANGADEX_BASE}/manga",
        {
            "title": title,
            "limit": 12,
            "includes[]": "cover_art",
            "contentRating[]": ["safe", "suggestive"],
        },
    )
    items = [_map_search_item(item) for item in (data.get("data") or [])]
    await set_cached(cache_key, items, "mangadex", expires_hours=6)
    return items


async def get_manga_details(manga_id: str) -> dict:
    cache_key = f"mangadex:details:{manga_id}"
    cached = await get_cached(cache_key)
    if cached:
        return dict(cached["data"])

    data = await mangadex_request(
        f"{MANGADEX_BASE}/manga/{manga_id}",
        {"includes[]": "cover_art"},
    )
    item = data.get("data") or {}
    mapped = _map_search_item(item) if item else {}
    await set_cached(cache_key, mapped, "mangadex", expires_hours=24)
    return mapped


async def get_chapter_list(manga_id: str, language: str = "en") -> list[dict]:
    cache_key = f"mangadex:chapters:{manga_id}:{language}"
    cached = await get_cached(cache_key)
    if cached:
        return list(cached["data"])

    data = await mangadex_request(
        f"{MANGADEX_BASE}/manga/{manga_id}/feed",
        {
            "limit": 100,
            "order[chapter]": "desc",
            "translatedLanguage[]": language,
            "includeExternalUrl": 0,
        },
    )

    items = []
    seen = set()
    for row in data.get("data") or []:
        attrs = row.get("attributes") or {}
        chapter_number = str(attrs.get("chapter") or "?")
        key = (chapter_number, attrs.get("title") or "")
        if key in seen:
            continue
        seen.add(key)
        items.append(
            {
                "chapter_id": row.get("id"),
                "chapter_number": chapter_number,
                "title": attrs.get("title"),
                "language": attrs.get("translatedLanguage") or language,
                "pages": attrs.get("pages") or 0,
                "published_at": attrs.get("publishAt") or attrs.get("readableAt") or "",
            }
        )
    await set_cached(cache_key, items, "mangadex", expires_hours=12)
    return items


async def get_chapter_pages(chapter_id: str) -> list[str]:
    cache_key = f"mangadex:pages:{chapter_id}"
    cached = await get_cached(cache_key)
    if cached:
        return list(cached["data"])

    data = await mangadex_request(f"{MANGADEX_BASE}/at-home/server/{chapter_id}")
    chapter = data.get("chapter") or {}
    base_url = data.get("baseUrl") or ""
    file_hash = chapter.get("hash") or ""
    page_files = chapter.get("data") or []

    if not base_url or not file_hash or not page_files:
        return []

    items = [f"{base_url}/data/{file_hash}/{filename}" for filename in page_files]
    await set_cached(cache_key, items, "mangadex", expires_hours=0.17)
    return items


async def get_cover_url(manga_id: str, cover_filename: str) -> str:
    return get_cover_url_sync(manga_id, cover_filename)
