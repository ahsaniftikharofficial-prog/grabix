import json
import re
from typing import Any

import httpx

from app.services.manga_cache import get_cached, set_cached

COMICK_API = "https://comick-source-api.notaspider.dev/api"
COMICK_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "GRABIX/1.0",
}
SCRAPE_HEADERS = {
    "User-Agent": "GRABIX/1.0",
    "Referer": "https://www.google.com/",
}
SUPPORTED_READER_SOURCES = {
    "MangaRead": 0,
    "Mangataro": 1,
    "MangaGo": 2,
    "Weebdex": 3,
    "AtsuMoe": 4,
}


def _clean_title(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip()).lower()


def _coerce_score(value: Any) -> float:
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return 0.0


def _parse_ndjson(raw: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            items.append(payload)
    return items


def _score_result(query: str, item: dict[str, Any]) -> tuple[int, int, float]:
    title = _clean_title(item.get("title") or "")
    query_text = _clean_title(query)
    if title == query_text:
        title_score = 0
    elif title.startswith(query_text):
        title_score = 1
    elif query_text in title:
        title_score = 2
    else:
        title_score = 3

    source_rank = SUPPORTED_READER_SOURCES.get(item.get("source") or "", 99)
    latest = _coerce_score(item.get("latestChapter"))
    return (title_score, source_rank, -latest)


def _map_search_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": item.get("title") or "Unknown",
        "cover_image": item.get("coverImage") or "",
        "score": _coerce_score(item.get("rating")),
        "genres": [],
        "status": item.get("source") or "Comick",
        "description": f"{item.get('source') or 'Comick'} backup reader",
        "source": "comick",
        "comick_source": item.get("source") or "",
        "comick_url": item.get("url") or "",
        "latest_chapter": item.get("latestChapter"),
    }


def _parse_page_urls(html: str) -> list[str]:
    patterns = [
        re.compile(
            r'<img[^>]+class="[^"]*wp-manga-chapter-img[^"]*"[^>]+src="\s*([^"\s]+)\s*"',
            re.IGNORECASE,
        ),
        re.compile(
            r'<img[^>]+src="\s*([^"\s]+)\s*"[^>]+class="[^"]*wp-manga-chapter-img[^"]*"',
            re.IGNORECASE,
        ),
        re.compile(
            r'data-src="\s*(https?://[^"\s]+\.(?:jpg|jpeg|png|webp|gif))\s*"',
            re.IGNORECASE,
        ),
    ]

    pages: list[str] = []
    seen: set[str] = set()
    for pattern in patterns:
        for match in pattern.finditer(html):
            url = (match.group(1) or "").strip()
            if not url or url in seen:
                continue
            if any(blocked in url for blocked in ("doubleclick", "yandex", "google", "gravatar")):
                continue
            seen.add(url)
            pages.append(url)
    return pages


async def _comick_request(path: str, payload: dict[str, Any]) -> str:
    async with httpx.AsyncClient(timeout=18.0, headers=COMICK_HEADERS) as client:
        response = await client.post(f"{COMICK_API}{path}", json=payload)
        response.raise_for_status()
        return response.text


async def search_manga(title: str) -> list[dict[str, Any]]:
    cache_key = f"comick:search:{title.strip().lower()}"
    cached = await get_cached(cache_key)
    if cached:
        return list(cached["data"])

    raw = await _comick_request("/search", {"query": title, "source": "all"})
    payloads = _parse_ndjson(raw)
    results: list[dict[str, Any]] = []

    for payload in payloads:
        source_name = payload.get("source") or ""
        for result in payload.get("results") or []:
            if not isinstance(result, dict):
                continue
            merged = dict(result)
            merged["source"] = source_name
            results.append(merged)

    ranked = sorted(results, key=lambda item: _score_result(title, item))
    mapped = [_map_search_item(item) for item in ranked[:24]]
    await set_cached(cache_key, mapped, "comick", expires_hours=6)
    return mapped


async def get_frontpage(section: str = "trending", page: int = 1, limit: int = 12, days: int = 7) -> list[dict[str, Any]]:
    cache_key = f"comick:frontpage:{section}:{page}:{limit}:{days}"
    cached = await get_cached(cache_key)
    if cached:
        return list(cached["data"])

    try:
        raw = await _comick_request(
            "/frontpage",
            {
                "source": "comix",
                "section": section,
                "page": page,
                "limit": limit,
                "days": days,
            },
        )
        payload = json.loads(raw)
    except (httpx.HTTPError, json.JSONDecodeError):
        # The upstream Comick frontpage endpoint is unreliable and regularly
        # returns 403/500 responses. Treat that as "no items" instead of
        # breaking the whole manga homepage.
        payload = {}

    items = payload.get("results") or payload.get("items") or []
    mapped = [
        {
            "title": item.get("title") or "Unknown",
            "cover_image": item.get("coverImage") or "",
            "score": _coerce_score(item.get("rating")),
            "genres": [],
            "status": "Comick",
            "description": "Comick frontpage discovery",
            "source": "comick",
            "comick_source": "Comix",
            "comick_url": item.get("url") or "",
            "latest_chapter": item.get("latestChapter"),
        }
        for item in items
        if isinstance(item, dict)
    ]
    await set_cached(cache_key, mapped, "comick", expires_hours=1)
    return mapped


async def get_best_match(title: str) -> dict[str, Any] | None:
    results = await search_manga(title)
    return results[0] if results else None


async def get_chapter_list(title: str) -> dict[str, Any]:
    cache_key = f"comick:chapters:{title.strip().lower()}"
    cached = await get_cached(cache_key)
    if cached:
        return dict(cached["data"])

    match = await get_best_match(title)
    if not match or not match.get("comick_url"):
        result = {"match": None, "items": [], "total": 0}
        await set_cached(cache_key, result, "comick", expires_hours=6)
        return result

    raw = await _comick_request(
        "/chapters",
        {
            "url": match["comick_url"],
            "source": match.get("comick_source") or None,
        },
    )
    payload = json.loads(raw)
    chapters = payload.get("chapters") or []
    mapped = []
    for chapter in chapters:
        if not isinstance(chapter, dict):
            continue
        chapter_url = chapter.get("url") or ""
        if not chapter_url:
            continue
        mapped.append(
            {
                "chapter_id": chapter_url,
                "chapter_number": str(chapter.get("number") or "?"),
                "title": chapter.get("title"),
                "language": "en",
                "pages": 0,
                "published_at": "",
                "provider": "comick",
                "source_name": payload.get("source") or match.get("comick_source") or "Comick",
                "chapter_url": chapter_url,
            }
        )

    def sort_key(item: dict[str, Any]) -> float:
        try:
            return float(item["chapter_number"])
        except (TypeError, ValueError):
            return -1

    mapped.sort(key=sort_key)
    result = {
        "match": match,
        "items": mapped,
        "total": payload.get("totalChapters") or len(mapped),
    }
    await set_cached(cache_key, result, "comick", expires_hours=12)
    return result


async def get_chapter_pages(chapter_url: str) -> list[str]:
    cache_key = f"comick:pages:{chapter_url}"
    cached = await get_cached(cache_key)
    if cached:
        return list(cached["data"])

    async with httpx.AsyncClient(timeout=18.0, headers=SCRAPE_HEADERS, follow_redirects=True) as client:
        response = await client.get(chapter_url)
        response.raise_for_status()
        html = response.text

    pages = _parse_page_urls(html)
    await set_cached(cache_key, pages, "comick", expires_hours=1)
    return pages
