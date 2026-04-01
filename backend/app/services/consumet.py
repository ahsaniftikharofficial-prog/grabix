import json
import os
import time
from datetime import datetime
from html import unescape
from typing import Any
from urllib.parse import quote
from xml.etree import ElementTree

import httpx
from fastapi import HTTPException

from app.services.manga_anilist import get_seasonal_manga, get_trending_manga
from app.services.manga_comick import get_frontpage as get_comick_frontpage
from app.services.network_policy import validate_outbound_target
from app.services.security import DEFAULT_APPROVED_MEDIA_HOSTS

CONSUMET_API_BASE_ENV = "CONSUMET_API_BASE"
DEFAULT_AUDIO_PRIORITY = ["en", "original", "hi"]
DEFAULT_SUBTITLE_PRIORITY = ["en", "hi"]
HTTP_TIMEOUT = 20.0
HEALTH_TIMEOUT = 0.9
JIKAN_API_BASE = "https://api.jikan.moe/v4"
TMDB_API_BASE = "https://api.themoviedb.org/3"
TMDB_BEARER_TOKEN = (
    "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI5OTk3Y2E5ZjY2NGZhZmI5ZWJkZmNhNDMyNGY0YTBmOCIs"
    "Im5iZiI6MTc3NDU2NDcyMC44NDYwMDAyLCJzdWIiOiI2OWM1YjU3MGE4NTBkNjcxOTE4OWJjN2MiLC"
    "JzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.uv8_l7Ub7WRhSfWtd07Sx_Yg13jubgyU7"
    "953kJZy7mw"
)
_CACHE: dict[str, tuple[float, Any]] = {}


class ConsumetConfigError(RuntimeError):
    pass


def _cache_key(kind: str, *parts: Any) -> str:
    return f"{kind}:{json.dumps(parts, sort_keys=True, ensure_ascii=True, default=str)}"


def _cache_get(key: str) -> Any | None:
    entry = _CACHE.get(key)
    if not entry:
        return None
    expires_at, value = entry
    if expires_at <= time.time():
        _CACHE.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: Any, ttl_seconds: int) -> Any:
    _CACHE[key] = (time.time() + max(ttl_seconds, 1), value)
    return value


def get_consumet_api_base() -> str:
    base = os.getenv(CONSUMET_API_BASE_ENV, "http://127.0.0.1:3000").strip().rstrip("/")
    if not base:
        base = "http://127.0.0.1:3000"
    return base


def _consumet_configured() -> bool:
    return True


def _http_error(detail: str, status_code: int = 502) -> HTTPException:
    return HTTPException(status_code=status_code, detail=detail)


async def _fetch_json_url(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    ttl_seconds: int = 300,
) -> Any:
    filtered = {key: value for key, value in (params or {}).items() if value is not None and value != ""}
    key = _cache_key("json", url, filtered)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    headers = {
        "User-Agent": "GRABIX/1.0 (+https://github.com/consumet/api.consumet.org)",
        "Accept": "application/json, text/plain;q=0.9, */*;q=0.8",
    }

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True, headers=headers) as client:
            response = await client.get(url, params=filtered)
    except Exception as exc:
        raise _http_error(f"Consumet request failed: {exc}") from exc

    if response.status_code >= 400:
        detail = response.text.strip() or f"Consumet request failed with {response.status_code}"
        raise _http_error(detail, response.status_code if response.status_code in {401, 403, 404, 429, 500, 503} else 502)

    try:
        data = response.json()
    except Exception as exc:
        raise _http_error(f"Consumet returned invalid JSON from {url}: {exc}") from exc

    return _cache_set(key, data, ttl_seconds)


async def _fetch_text_url(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    ttl_seconds: int = 300,
) -> str:
    filtered = {key: value for key, value in (params or {}).items() if value is not None and value != ""}
    key = _cache_key("text", url, filtered)
    cached = _cache_get(key)
    if isinstance(cached, str):
        return cached

    headers = {
        "User-Agent": "GRABIX/1.0",
        "Accept": "text/plain, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8",
    }

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True, headers=headers) as client:
            response = await client.get(url, params=filtered)
    except Exception as exc:
        raise _http_error(f"Request failed: {exc}") from exc

    if response.status_code >= 400:
        detail = response.text.strip() or f"Request failed with {response.status_code}"
        raise _http_error(detail, response.status_code if response.status_code in {401, 403, 404, 429, 500, 503} else 502)

    return _cache_set(key, response.text, ttl_seconds)


async def _fetch_tmdb_json(path: str, *, params: dict[str, Any] | None = None, ttl_seconds: int = 600) -> Any:
    filtered = {key: value for key, value in (params or {}).items() if value is not None and value != ""}
    key = _cache_key("tmdb-json", path, filtered)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    headers = {
        "User-Agent": "GRABIX/1.0",
        "Accept": "application/json, text/plain;q=0.9, */*;q=0.8",
        "Authorization": f"Bearer {TMDB_BEARER_TOKEN}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True, headers=headers) as client:
            response = await client.get(f"{TMDB_API_BASE}{path}", params=filtered)
    except Exception as exc:
        raise _http_error(f"TMDB request failed: {exc}") from exc

    if response.status_code >= 400:
        detail = response.text.strip() or f"TMDB request failed with {response.status_code}"
        raise _http_error(detail, response.status_code if response.status_code in {401, 403, 404, 429, 500, 503} else 502)

    try:
        data = response.json()
    except Exception as exc:
        raise _http_error(f"TMDB returned invalid JSON from {path}: {exc}") from exc

    return _cache_set(key, data, ttl_seconds)


async def _fetch_consumet_json(
    path: str,
    *,
    params: dict[str, Any] | None = None,
    ttl_seconds: int = 300,
    timeout: float | None = None,
) -> Any:
    base = get_consumet_api_base()
    if timeout is None or timeout == HTTP_TIMEOUT:
        return await _fetch_json_url(f"{base}{path}", params=params, ttl_seconds=ttl_seconds)

    filtered = {key: value for key, value in (params or {}).items() if value is not None and value != ""}
    key = _cache_key("json-timeout", f"{base}{path}", filtered, timeout)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    headers = {
        "User-Agent": "GRABIX/1.0 (+https://github.com/consumet/api.consumet.org)",
        "Accept": "application/json, text/plain;q=0.9, */*;q=0.8",
    }
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers) as client:
            response = await client.get(f"{base}{path}", params=filtered)
    except Exception as exc:
        raise _http_error(f"Consumet request failed: {exc}") from exc

    if response.status_code >= 400:
        detail = response.text.strip() or f"Consumet request failed with {response.status_code}"
        raise _http_error(detail, response.status_code if response.status_code in {401, 403, 404, 429, 500, 503} else 502)

    try:
        data = response.json()
    except Exception as exc:
        raise _http_error(f"Consumet returned invalid JSON from {base}{path}: {exc}") from exc

    return _cache_set(key, data, ttl_seconds)


async def fetch_proxy_response(url: str) -> tuple[bytes, str | None]:
    validated = validate_outbound_target(
        url,
        mode="approved_provider_target",
        allowed_hosts=DEFAULT_APPROVED_MEDIA_HOSTS,
    )
    safe_url = validated.normalized_url

    headers = {"User-Agent": "GRABIX/1.0"}
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True, headers=headers) as client:
            response = await client.get(safe_url)
    except Exception as exc:
        raise _http_error(f"Proxy request failed: {exc}") from exc

    if response.status_code >= 400:
        raise _http_error(
            response.text.strip() or f"Proxy request failed with {response.status_code}",
            response.status_code if response.status_code in {400, 401, 403, 404, 429, 500, 503} else 502,
        )

    return response.content, response.headers.get("content-type")


def _first_non_empty(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _coerce_int(value: Any) -> int | None:
    try:
        if value is None or value == "":
            return None
        return int(float(value))
    except Exception:
        return None


def _extract_title(item: dict[str, Any]) -> str:
    title = item.get("title")
    if isinstance(title, dict):
        return _first_non_empty(
            title.get("english"),
            title.get("romaji"),
            title.get("userPreferred"),
            title.get("native"),
        )
    return _first_non_empty(
        title,
        item.get("name"),
        item.get("englishTitle"),
        item.get("romanjiTitle"),
    )


def _normalize_jikan_anime_item(item: dict[str, Any], provider: str) -> dict[str, Any]:
    images = item.get("images") or {}
    jpg = images.get("jpg") if isinstance(images, dict) else {}
    trailer = item.get("trailer") or {}
    return {
        "id": str(item.get("mal_id") or ""),
        "provider": provider,
        "type": "anime",
        "title": _first_non_empty(item.get("title_english"), item.get("title")),
        "alt_title": _first_non_empty(item.get("title"), item.get("title_japanese")),
        "image": _first_non_empty(
            (jpg.get("large_image_url") if isinstance(jpg, dict) else ""),
            (jpg.get("image_url") if isinstance(jpg, dict) else ""),
        ),
        "description": _first_non_empty(item.get("synopsis"), item.get("background")),
        "year": _coerce_int(item.get("year") or item.get("aired", {}).get("prop", {}).get("from", {}).get("year")),
        "rating": float(item.get("score")) if item.get("score") is not None else None,
        "status": _first_non_empty(item.get("status")),
        "genres": [
            genre.get("name")
            for genre in item.get("genres") or []
            if isinstance(genre, dict) and genre.get("name")
        ],
        "languages": ["original"],
        "url": _first_non_empty(item.get("url")),
        "mal_id": item.get("mal_id"),
        "episodes_count": _coerce_int(item.get("episodes")),
        "trailer_url": _first_non_empty(trailer.get("embed_url")) if isinstance(trailer, dict) else "",
        "raw": item,
    }


def _normalize_jikan_episode_item(
    item: dict[str, Any],
    *,
    provider: str,
    anime_id: str,
    fallback_number: int,
) -> dict[str, Any]:
    number = _coerce_int(item.get("mal_id")) or _coerce_int(item.get("episode_id")) or fallback_number
    return {
        "id": f"{provider}:{anime_id}:{number}",
        "provider": provider,
        "number": number,
        "title": _first_non_empty(item.get("title"), item.get("title_japanese")) or f"Episode {number}",
        "is_filler": False,
        "languages": ["original"],
        "raw": item,
    }


async def _search_jikan_anime(query: str, page: int = 1, provider: str = "jikan") -> dict[str, Any]:
    payload = await _fetch_json_url(
        f"{JIKAN_API_BASE}/anime",
        params={"q": query, "page": page, "limit": 20, "sfw": "true"},
        ttl_seconds=600,
    )
    items = [
        _normalize_jikan_anime_item(item, provider)
        for item in payload.get("data") or []
        if isinstance(item, dict)
    ]
    return {"domain": "anime", "provider": provider, "query": query, "page": page, "items": items}


async def _fetch_jikan_anime_full(media_id: str, provider: str) -> dict[str, Any]:
    payload = await _fetch_json_url(
        f"{JIKAN_API_BASE}/anime/{quote(media_id)}/full",
        ttl_seconds=1800,
    )
    item = payload.get("data") if isinstance(payload, dict) else {}
    if not isinstance(item, dict):
        raise _http_error("Anime details were not found.", 404)
    return {"domain": "anime", "provider": provider, "item": _normalize_jikan_anime_item(item, provider), "raw": item}


async def _fetch_jikan_anime_episodes(media_id: str, provider: str) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    page = 1
    while page <= 6:
        payload = await _fetch_json_url(
            f"{JIKAN_API_BASE}/anime/{quote(media_id)}/episodes",
            params={"page": page},
            ttl_seconds=1800,
        )
        batch = payload.get("data") or []
        for index, item in enumerate(batch):
            if isinstance(item, dict):
                items.append(
                    _normalize_jikan_episode_item(
                        item,
                        provider=provider,
                        anime_id=media_id,
                        fallback_number=len(items) + index + 1,
                    )
                )
        pagination = payload.get("pagination") or {}
        if not isinstance(pagination, dict) or not pagination.get("has_next_page"):
            break
        page += 1
    return {"provider": provider, "id": media_id, "items": items}


async def _fetch_tmdb_meta_search(query: str, media_type: str = "movie") -> dict[str, Any]:
    path = "movie" if media_type == "movie" else "tv"
    payload = await _fetch_tmdb_json(
        f"/search/{path}",
        params={"query": query, "page": 1},
        ttl_seconds=600,
    )
    results: list[dict[str, Any]] = []
    for item in payload.get("results") or []:
        if not isinstance(item, dict):
            continue
        title = _first_non_empty(item.get("title"), item.get("name"))
        poster = _first_non_empty(item.get("poster_path"))
        backdrop = _first_non_empty(item.get("backdrop_path"))
        image = f"https://image.tmdb.org/t/p/w500{poster}" if poster else (f"https://image.tmdb.org/t/p/w780{backdrop}" if backdrop else "")
        release = _first_non_empty(item.get("release_date"), item.get("first_air_date"))
        results.append(
            {
                "id": str(item.get("id") or ""),
                "provider": "tmdb",
                "type": media_type,
                "title": title,
                "alt_title": "",
                "image": image,
                "description": _first_non_empty(item.get("overview")),
                "year": _coerce_int(release[:4]) if len(release) >= 4 else None,
                "rating": float(item.get("vote_average")) if item.get("vote_average") is not None else None,
                "status": "",
                "genres": [],
                "languages": [],
                "url": "",
                "raw": item,
            }
        )
    return {"query": query, "type": media_type, "items": results}


async def _fetch_tmdb_meta_info(item_id: str, media_type: str = "movie") -> dict[str, Any]:
    path = "movie" if media_type == "movie" else "tv"
    payload = await _fetch_tmdb_json(
        f"/{path}/{quote(item_id)}",
        ttl_seconds=1800,
    )
    if not isinstance(payload, dict):
        raise _http_error("TMDB details were not found.", 404)
    title = _first_non_empty(payload.get("title"), payload.get("name"))
    poster = _first_non_empty(payload.get("poster_path"))
    backdrop = _first_non_empty(payload.get("backdrop_path"))
    image = f"https://image.tmdb.org/t/p/w500{poster}" if poster else (f"https://image.tmdb.org/t/p/w780{backdrop}" if backdrop else "")
    item = {
        "id": str(payload.get("id") or item_id),
        "provider": "tmdb",
        "type": media_type,
        "title": title,
        "alt_title": "",
        "image": image,
        "description": _first_non_empty(payload.get("overview")),
        "year": _coerce_int(_first_non_empty(payload.get("release_date"), payload.get("first_air_date"))[:4]),
        "rating": float(payload.get("vote_average")) if payload.get("vote_average") is not None else None,
        "status": _first_non_empty(payload.get("status")),
        "genres": [
            genre.get("name")
            for genre in payload.get("genres") or []
            if isinstance(genre, dict) and genre.get("name")
        ],
        "languages": [],
        "url": "",
        "raw": payload,
    }
    return {"id": item_id, "type": media_type, "item": item, "raw": payload}


def _extract_alt_title(item: dict[str, Any]) -> str:
    title = item.get("title")
    if isinstance(title, dict):
        primary = _extract_title(item)
        return _first_non_empty(
            *(value for value in title.values() if isinstance(value, str) and value.strip() and value.strip() != primary)
        )
    return _first_non_empty(item.get("title_english"), item.get("originalTitle"))


def _extract_image(item: dict[str, Any]) -> str:
    image = item.get("image")
    if isinstance(image, str):
        return image.strip()
    if isinstance(image, dict):
        return _first_non_empty(
            image.get("large"),
            image.get("medium"),
            image.get("poster"),
            image.get("cover"),
            image.get("url"),
        )
    return _first_non_empty(
        item.get("imageUrl"),
        item.get("img"),
        item.get("poster"),
        item.get("posterImage"),
        item.get("cover"),
        item.get("coverImage"),
        item.get("thumbnail"),
    )


def _extract_description(item: dict[str, Any]) -> str:
    return _first_non_empty(
        item.get("description"),
        item.get("overview"),
        item.get("summary"),
        item.get("desc"),
        item.get("synopsis"),
    )


def _extract_genres(item: dict[str, Any]) -> list[str]:
    raw = item.get("genres") or item.get("genre") or []
    if isinstance(raw, list):
        result: list[str] = []
        for value in raw:
            if isinstance(value, str) and value.strip():
                result.append(value.strip())
            elif isinstance(value, dict):
                name = _first_non_empty(value.get("name"), value.get("title"))
                if name:
                    result.append(name)
        return result
    return []


def _extract_languages(item: dict[str, Any]) -> list[str]:
    raw = item.get("languages") or item.get("audioLanguages") or item.get("availableAudio")
    if isinstance(raw, list):
        return [str(value).strip().lower() for value in raw if str(value).strip()]

    flags = []
    if item.get("isHindi"):
        flags.append("hi")
    if item.get("isDubbed"):
        flags.append("en")
    if item.get("isSubbed"):
        flags.append("original")
    if item.get("subOrDub"):
        flags.append(str(item.get("subOrDub")).strip().lower())
    return list(dict.fromkeys(flags))


def _payload_items(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("results", "items", "data", "episodes", "chapters", "pages", "spotlightAnimes", "scheduledAnimes", "suggestions"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []


def _normalize_media_item(item: dict[str, Any], domain: str, provider: str) -> dict[str, Any]:
    media_id = _first_non_empty(
        str(item.get("id") or ""),
        str(item.get("_id") or ""),
        item.get("slug") or "",
        item.get("url") or "",
    )
    year = _coerce_int(item.get("releaseDate") or item.get("year") or item.get("releaseYear"))
    rating = item.get("rating") or item.get("score") or item.get("vote_average")
    if isinstance(rating, str):
        try:
            rating = float(rating)
        except Exception:
            rating = None
    elif isinstance(rating, int):
        rating = float(rating)

    return {
        "id": media_id,
        "provider": provider,
        "type": domain,
        "title": _extract_title(item),
        "alt_title": _first_non_empty(_extract_alt_title(item), item.get("otherName")),
        "image": _extract_image(item),
        "description": _extract_description(item),
        "year": year,
        "rating": rating if isinstance(rating, float) else None,
        "status": _first_non_empty(item.get("status"), item.get("state")),
        "genres": _extract_genres(item),
        "languages": _extract_languages(item),
        "url": _first_non_empty(item.get("url"), item.get("siteUrl")),
        "episodes_count": _coerce_int(item.get("totalEpisodes") or item.get("episodes")),
        "raw": item,
    }


def _normalize_episode_item(item: dict[str, Any], provider: str, fallback_number: int) -> dict[str, Any]:
    number = _coerce_int(
        item.get("number")
        or item.get("episode")
        or item.get("episodeNumber")
        or item.get("episodeNo")
    ) or fallback_number
    title = _first_non_empty(item.get("title"), item.get("name"))
    episode_id = _first_non_empty(
        str(item.get("id") or ""),
        str(item.get("episodeId") or ""),
        item.get("url") or "",
    )
    return {
        "id": episode_id,
        "provider": provider,
        "number": number,
        "title": title or f"Episode {number}",
        "is_filler": bool(item.get("isFiller")),
        "languages": _extract_languages(item),
        "raw": item,
    }


def _normalize_chapter_item(item: dict[str, Any], provider: str, fallback_number: int) -> dict[str, Any]:
    number = (
        item.get("chapterNumber")
        or item.get("number")
        or item.get("chapter")
        or fallback_number
    )
    chapter_id = _first_non_empty(
        str(item.get("id") or ""),
        str(item.get("chapterId") or ""),
        item.get("url") or "",
    )
    released = _first_non_empty(
        item.get("releaseDate"),
        item.get("publishedAt"),
        item.get("updatedAt"),
    )
    return {
        "id": chapter_id,
        "provider": provider,
        "number": str(number),
        "title": _first_non_empty(item.get("title"), item.get("name")),
        "language": _first_non_empty(item.get("language"), item.get("lang")).lower() or "en",
        "released_at": released,
        "raw": item,
    }


def _openlibrary_search_query(domain: str, query: str) -> str:
    if domain == "comics":
        return f"{query} subject:comics"
    if domain == "light-novels":
        return f"{query} \"light novel\""
    return query


def _map_openlibrary_doc(doc: dict[str, Any], domain: str) -> dict[str, Any]:
    cover_id = doc.get("cover_i")
    image = f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg" if cover_id else ""
    first_publish = _coerce_int(doc.get("first_publish_year"))
    title = _first_non_empty(doc.get("title"))
    description_parts = [
        ", ".join(doc.get("author_name") or []) if isinstance(doc.get("author_name"), list) else "",
        ", ".join(doc.get("subject")[:6]) if isinstance(doc.get("subject"), list) else "",
    ]
    description = " · ".join([part for part in description_parts if part])
    key = _first_non_empty(doc.get("key"), str(doc.get("cover_edition_key") or ""))
    return {
        "id": key.replace("/works/", "").replace("/books/", ""),
        "provider": "openlibrary",
        "type": domain,
        "title": title,
        "alt_title": "",
        "image": image,
        "description": description,
        "year": first_publish,
        "rating": None,
        "status": "",
        "genres": [subject for subject in (doc.get("subject") or [])[:6] if isinstance(subject, str)],
        "languages": ["en"],
        "url": f"https://openlibrary.org{key}" if key.startswith("/") else "",
        "raw": doc,
    }


async def _search_openlibrary(domain: str, query: str, page: int = 1) -> dict[str, Any]:
    payload = await _fetch_json_url(
        "https://openlibrary.org/search.json",
        params={"q": _openlibrary_search_query(domain, query), "page": page, "limit": 24},
        ttl_seconds=900,
    )
    items = [_map_openlibrary_doc(item, domain) for item in payload.get("docs") or [] if isinstance(item, dict)]
    return {"domain": domain, "provider": "openlibrary", "query": query, "page": page, "items": items}


async def _fetch_openlibrary_info(domain: str, media_id: str) -> dict[str, Any]:
    work_id = media_id if media_id.startswith("OL") else media_id
    payload = await _fetch_json_url(
        f"https://openlibrary.org/works/{work_id}.json",
        ttl_seconds=1800,
    )
    description_value = payload.get("description")
    if isinstance(description_value, dict):
        description = _first_non_empty(description_value.get("value"))
    else:
        description = _first_non_empty(description_value)
    covers = payload.get("covers") or []
    image = f"https://covers.openlibrary.org/b/id/{covers[0]}-L.jpg" if covers else ""
    item = {
        "id": work_id,
        "provider": "openlibrary",
        "type": domain,
        "title": _first_non_empty(payload.get("title")),
        "alt_title": "",
        "image": image,
        "description": description,
        "year": _coerce_int(payload.get("first_publish_date")),
        "rating": None,
        "status": "",
        "genres": [subject for subject in (payload.get("subjects") or [])[:8] if isinstance(subject, str)],
        "languages": ["en"],
        "url": f"https://openlibrary.org/works/{work_id}",
        "raw": payload,
    }
    return {"domain": domain, "provider": "openlibrary", "item": item, "raw": payload}


async def _fetch_openlibrary_read(domain: str, item_id: str) -> dict[str, Any]:
    info = await _fetch_openlibrary_info(domain, item_id)
    return {
        "domain": domain,
        "provider": "openlibrary",
        "id": item_id,
        "content": {
            "title": info["item"]["title"],
            "description": info["item"]["description"],
            "url": info["item"]["url"],
        },
        "raw": info["raw"],
    }


def _gutendex_extract_formats(
    formats: dict[str, Any] | None,
) -> tuple[str, str, list[dict[str, str]]]:
    payload = formats if isinstance(formats, dict) else {}
    read_url = ""
    preview_url = ""
    downloads: list[dict[str, str]] = []

    preferred_read = [
        ("text/html", "Read Online"),
        ("text/plain; charset=utf-8", "Read Text"),
        ("text/plain; charset=us-ascii", "Read Text"),
    ]
    preferred_downloads = [
        ("application/epub+zip", "EPUB"),
        ("application/pdf", "PDF"),
        ("application/x-mobipocket-ebook", "MOBI"),
        ("application/octet-stream", "Download"),
    ]

    for key, label in preferred_read:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            if not read_url:
                read_url = value.strip()
            if not preview_url and key.startswith("text/plain"):
                preview_url = value.strip()

    for key, label in preferred_downloads:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            downloads.append({"label": label, "url": value.strip()})

    if not preview_url:
        preview_url = read_url

    return read_url, preview_url, downloads


def _map_gutendex_book(book: dict[str, Any]) -> dict[str, Any]:
    authors = [
        author.get("name", "").strip()
        for author in (book.get("authors") or [])
        if isinstance(author, dict) and author.get("name")
    ]
    languages = [str(value).strip().lower() for value in (book.get("languages") or []) if str(value).strip()]
    subjects = [str(value).strip() for value in (book.get("subjects") or [])[:8] if str(value).strip()]
    image = _first_non_empty(((book.get("formats") or {}).get("image/jpeg")) if isinstance(book.get("formats"), dict) else "")
    title = _first_non_empty(book.get("title"))
    read_url, preview_url, downloads = _gutendex_extract_formats(book.get("formats"))
    description = " - ".join([part for part in [", ".join(authors), ", ".join(subjects[:4])] if part])

    return {
        "id": str(book.get("id") or ""),
        "provider": "gutendex",
        "type": "books",
        "title": title,
        "alt_title": "",
        "image": image,
        "description": description,
        "year": None,
        "rating": None,
        "status": "",
        "genres": subjects,
        "languages": languages or ["en"],
        "url": read_url or preview_url or "",
        "downloads": downloads,
        "authors": authors,
        "download_count": _coerce_int(book.get("download_count")),
        "raw": book,
    }


async def _search_gutendex(query: str, page: int = 1) -> dict[str, Any]:
    payload = await _fetch_json_url(
        "https://gutendex.com/books",
        params={"search": query, "page": page},
        ttl_seconds=900,
    )
    items = [_map_gutendex_book(item) for item in payload.get("results") or [] if isinstance(item, dict)]
    return {"domain": "books", "provider": "gutendex", "query": query, "page": page, "items": items}


async def _fetch_gutendex_info(book_id: str) -> dict[str, Any]:
    payload = await _fetch_json_url(
        f"https://gutendex.com/books/{quote(book_id)}",
        ttl_seconds=1800,
    )
    item = _map_gutendex_book(payload if isinstance(payload, dict) else {})
    return {"domain": "books", "provider": "gutendex", "item": item, "raw": payload}


async def _fetch_gutendex_read(book_id: str) -> dict[str, Any]:
    info = await _fetch_gutendex_info(book_id)
    book = info["raw"] if isinstance(info.get("raw"), dict) else {}
    item = info["item"]
    read_url, preview_url, downloads = _gutendex_extract_formats(book.get("formats"))

    preview_text = ""
    preview_source = preview_url or read_url
    if preview_source and preview_source.lower().endswith((".txt", ".utf-8", ".txt.utf-8", ".txt.utf8", ".txt; charset=utf-8")):
        try:
            preview_text = (await _fetch_text_url(preview_source, ttl_seconds=1800))[:24000]
        except HTTPException:
            preview_text = ""

    content = {
        "title": item.get("title", ""),
        "description": item.get("description", ""),
        "url": item.get("url", ""),
        "read_url": read_url or preview_url or item.get("url", ""),
        "preview_text": preview_text,
        "downloads": downloads,
        "authors": item.get("authors", []),
    }
    return {"domain": "books", "provider": "gutendex", "id": book_id, "content": content, "raw": book}


def _strip_html(value: str) -> str:
    return unescape(
        value.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
    ).replace("&nbsp;", " ")


async def _fetch_ann_feed(topic: str | None = None) -> dict[str, Any]:
    xml_content = await _fetch_text_url(
        "https://www.animenewsnetwork.com/news/rss.xml?ann-edition=us",
        ttl_seconds=600,
    )
    root = ElementTree.fromstring(xml_content)
    items: list[dict[str, Any]] = []
    for entry in root.findall(".//item"):
        title = _first_non_empty(entry.findtext("title"))
        description = _strip_html(entry.findtext("description") or "")
        link = _first_non_empty(entry.findtext("link"))
        published = _first_non_empty(entry.findtext("pubDate"))
        if topic and topic.lower() not in f"{title} {description}".lower():
            continue
        items.append(
            {
                "id": link or title,
                "title": title,
                "description": description,
                "image": "",
                "url": link,
                "published_at": published,
                "topic": topic or "",
                "raw": {"title": title, "description": description, "link": link, "published_at": published},
            }
        )
    return {"topic": topic or "", "items": items}


def _language_rank(language: str | None, order: list[str]) -> int:
    normalized = (language or "original").strip().lower()
    synonyms = {
        "dub": "en",
        "english": "en",
        "hindi": "hi",
        "sub": "original",
        "subbed": "original",
        "japanese": "original",
    }
    normalized = synonyms.get(normalized, normalized)
    if normalized in order:
        return order.index(normalized)
    return len(order)


def _sort_subtitles(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(items, key=lambda item: (_language_rank(item.get("language"), DEFAULT_SUBTITLE_PRIORITY), item.get("label") or ""))


def _proxy_url(url: str) -> str:
    return f"/consumet/proxy?url={quote(url, safe='')}"


def _normalize_subtitles(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw_tracks = payload.get("subtitles") or payload.get("tracks") or []
    results: list[dict[str, Any]] = []
    for index, item in enumerate(raw_tracks):
        if isinstance(item, str):
            url = item.strip()
            if not url:
                continue
            label = f"Subtitle {index + 1}"
            language = ""
        elif isinstance(item, dict):
            url = _first_non_empty(item.get("url"), item.get("file"))
            if not url:
                continue
            label = _first_non_empty(item.get("lang"), item.get("label"), item.get("language")) or f"Subtitle {index + 1}"
            language = _first_non_empty(item.get("srclang"), item.get("language"), item.get("lang")).lower()
        else:
            continue

        results.append(
            {
                "id": f"subtitle-{index}",
                "label": label,
                "language": language or label.lower(),
                "url": _proxy_url(url),
                "originalUrl": url,
            }
        )

    return _sort_subtitles(results)


def normalize_watch_payload(
    payload: dict[str, Any],
    *,
    provider: str,
    requested_audio: str,
    server: str | None,
) -> dict[str, Any]:
    subtitles = _normalize_subtitles(payload)
    raw_sources = payload.get("sources") or payload.get("data") or []
    normalized_sources: list[dict[str, Any]] = []
    audio_priority = (
        ["hi", "en", "original"]
        if requested_audio == "hi"
        else ["en", "original", "hi"]
        if requested_audio == "en"
        else ["original", "en", "hi"]
    )

    if isinstance(raw_sources, dict):
        raw_sources = [raw_sources]

    for index, item in enumerate(raw_sources):
        if not isinstance(item, dict):
            continue
        url = _first_non_empty(item.get("url"), item.get("file"))
        if not url:
            continue
        language = _first_non_empty(item.get("lang"), item.get("language"), requested_audio).lower() or "original"
        quality = _first_non_empty(item.get("quality"), item.get("label")) or "Auto"
        is_embed = bool(item.get("isEmbed")) or _first_non_empty(item.get("type")).lower() == "embed"
        normalized_sources.append(
            {
                "id": f"{provider}-source-{index}",
                "label": quality,
                "provider": f"Consumet {provider}",
                "kind": "embed" if is_embed else "hls" if item.get("isM3U8") or ".m3u8" in url.lower() else "direct",
                "url": url,
                "description": f"{provider} source" + (f" via {server}" if server else ""),
                "quality": quality,
                "mimeType": item.get("type"),
                "externalUrl": url,
                "canExtract": False,
                "subtitles": subtitles,
                "language": language,
            }
        )

    ordered_sources = sorted(
        normalized_sources,
        key=lambda item: (_language_rank(item.get("language"), audio_priority), item.get("quality") != "1080p"),
    )

    return {
        "provider": provider,
        "requested_audio": requested_audio,
        "available_audio": list(dict.fromkeys([(item.get("language") or "original") for item in ordered_sources])),
        "selected_server": server or "",
        "headers": payload.get("headers") or {},
        "download": payload.get("download"),
        "sources": ordered_sources,
        "subtitles": subtitles,
        "raw": payload,
    }


async def get_health_status() -> dict[str, Any]:
    configured = _consumet_configured()
    if not configured:
        return {
            "configured": False,
            "healthy": True,
            "api_base": "",
            "message": "Anime providers are handled inside the Python backend. Built-in fallbacks are ready.",
            "default_audio_priority": DEFAULT_AUDIO_PRIORITY,
            "default_subtitle_priority": DEFAULT_SUBTITLE_PRIORITY,
        }

    base = get_consumet_api_base()
    try:
        discover_payload = await _fetch_consumet_json(
            "/anime/hianime/top10",
            params={"period": "daily"},
            ttl_seconds=45,
            timeout=HEALTH_TIMEOUT,
        )
        discover_items = [item for item in _payload_items(discover_payload) if isinstance(item, dict)]

        if discover_items:
            healthy = True
            message = "Consumet is reachable for Hianime anime playback."
        else:
            healthy = False
            message = "Consumet is running, but Hianime returned no anime data yet. GRABIX fallback playback is ready."
    except HTTPException as exc:
        healthy = False
        _ = exc
        message = "Consumet is still warming up. GRABIX can already use built-in anime fallbacks."

    return {
        "configured": True,
        "healthy": healthy,
        "api_base": base,
        "message": message,
        "default_audio_priority": DEFAULT_AUDIO_PRIORITY,
        "default_subtitle_priority": DEFAULT_SUBTITLE_PRIORITY,
    }


async def discover_anime(section: str = "trending", page: int = 1, period: str = "daily") -> dict[str, Any]:
    section_key = (section or "trending").strip().lower()
    period_key = (period or "daily").strip().lower()
    try:
        if section_key == "trending":
            payload = await _fetch_consumet_json("/anime/hianime/top10", params={"period": period_key}, ttl_seconds=300)
            items = [
                _normalize_media_item(item, "anime", "hianime")
                for item in _payload_items(payload)
                if isinstance(item, dict)
            ]
            return {"section": section_key, "period": period_key, "page": page, "items": items if page == 1 else []}

        route_map = {
            "popular": "/anime/hianime/most-popular",
            "toprated": "/anime/hianime/most-favorite",
            "seasonal": "/anime/hianime/top-airing",
            "movie": "/anime/hianime/movie",
        }
        payload = await _fetch_consumet_json(
            route_map.get(section_key, route_map["popular"]),
            params={"page": page},
            ttl_seconds=600,
        )
        items = [
            _normalize_media_item(item, "anime", "hianime")
            for item in _payload_items(payload)
            if isinstance(item, dict)
        ]
        if items:
            return {"section": section_key, "period": period_key, "page": page, "items": items}
    except (HTTPException, ConsumetConfigError):
        pass

    urls = {
        "trending": f"https://api.jikan.moe/v4/top/anime?filter=airing&page={page}&limit=10",
        "popular": f"https://api.jikan.moe/v4/top/anime?filter=bypopularity&page={page}&limit=20",
        "toprated": f"https://api.jikan.moe/v4/top/anime?page={page}&limit=20",
        "seasonal": f"https://api.jikan.moe/v4/seasons/now?page={page}&limit=20",
        "movie": f"https://api.jikan.moe/v4/top/anime?type=movie&page={page}&limit=20",
    }
    url = urls.get(section_key, urls["popular"])
    payload = await _fetch_json_url(url, ttl_seconds=900)
    items = []
    for raw in payload.get("data") or []:
        if not isinstance(raw, dict):
            continue
        title = _first_non_empty(raw.get("title_english"), raw.get("title"))
        image = (
            (((raw.get("images") or {}).get("jpg") or {}).get("large_image_url"))
            or (((raw.get("images") or {}).get("jpg") or {}).get("image_url"))
            or ""
        )
        items.append(
            {
                "id": str(raw.get("mal_id") or ""),
                "provider": "jikan",
                "type": "anime",
                "title": title,
                "alt_title": _first_non_empty(raw.get("title")),
                "image": image,
                "description": _first_non_empty(raw.get("synopsis")),
                "year": raw.get("year"),
                "rating": float(raw.get("score")) if raw.get("score") else None,
                "status": _first_non_empty(raw.get("status")),
                "genres": [genre.get("name") for genre in raw.get("genres") or [] if isinstance(genre, dict) and genre.get("name")],
                "languages": ["original"],
                "url": raw.get("url") or "",
                "mal_id": raw.get("mal_id"),
                "episodes": raw.get("episodes"),
                "trailer_url": ((raw.get("trailer") or {}).get("embed_url")) or "",
            }
        )

    return {"section": section_key, "period": period_key, "page": page, "items": items}


async def discover_manga(section: str = "trending", page: int = 1) -> dict[str, Any]:
    section_key = (section or "trending").strip().lower()
    if section_key == "seasonal":
        current_month = datetime.utcnow().month
        season = "WINTER" if current_month <= 3 else "SPRING" if current_month <= 6 else "SUMMER" if current_month <= 9 else "FALL"
        raw_items = await get_seasonal_manga(datetime.utcnow().year, season)
        items = [
            {
                "id": str(item.get("mangadex_id") or item.get("anilist_id") or item.get("mal_id") or item.get("title") or ""),
                "provider": "anilist",
                "type": "manga",
                "title": item.get("title") or "",
                "alt_title": "",
                "image": item.get("cover_image") or "",
                "description": item.get("description") or "",
                "year": item.get("year"),
                "rating": float(item.get("score")) if item.get("score") is not None else None,
                "status": item.get("status") or "",
                "genres": item.get("genres") or [],
                "languages": ["en"],
                "url": "",
                "anilist_id": item.get("anilist_id"),
                "mangadex_id": item.get("mangadex_id"),
                "mal_id": item.get("mal_id"),
            }
            for item in raw_items
        ]
        return {"section": section_key, "page": page, "items": items}
    if section_key == "hot":
        raw_items = await get_comick_frontpage(section="trending", page=page, limit=12, days=7)
    else:
        raw_items = await get_trending_manga(page=page)
    items = [
        {
            "id": str(item.get("mangadex_id") or item.get("anilist_id") or item.get("mal_id") or item.get("title") or ""),
            "provider": "comick" if section_key == "hot" else "anilist",
            "type": "manga",
            "title": item.get("title") or "",
            "alt_title": "",
            "image": item.get("cover_image") or "",
            "description": item.get("description") or "",
            "year": item.get("year"),
            "rating": float(item.get("score")) if item.get("score") is not None else None,
            "status": item.get("status") or "",
            "genres": item.get("genres") or [],
            "languages": ["en"],
            "url": "",
            "anilist_id": item.get("anilist_id"),
            "mangadex_id": item.get("mangadex_id"),
            "mal_id": item.get("mal_id"),
        }
        for item in raw_items
    ]
    return {"section": section_key, "page": page, "items": items}


async def search_domain(
    domain: str,
    query: str,
    *,
    provider: str,
    page: int = 1,
) -> dict[str, Any]:
    if domain == "books" and provider == "gutendex":
        try:
            return await _search_gutendex(query, page)
        except HTTPException:
            pass

    if domain in {"books", "comics", "light-novels"}:
        try:
            return await _search_openlibrary(domain, query, page)
        except HTTPException:
            pass

    if domain == "anime":
        if not _consumet_configured():
            return await _search_jikan_anime(query, page, provider)
        try:
            path = f"/anime/{provider}/{quote(query)}"
            payload = await _fetch_consumet_json(path, params={"page": page}, ttl_seconds=600)
        except (HTTPException, ConsumetConfigError):
            return await _search_jikan_anime(query, page, provider)
    elif domain == "manga":
        path = f"/manga/{provider}/{quote(query)}"
        payload = await _fetch_consumet_json(path, ttl_seconds=600)
    else:
        path = f"/{domain}/{provider}/{quote(query)}"
        payload = await _fetch_consumet_json(path, params={"page": page}, ttl_seconds=600)

    raw_items = _payload_items(payload)
    items = [
        _normalize_media_item(item, domain, provider)
        for item in raw_items
        if isinstance(item, dict)
    ]
    return {"domain": domain, "provider": provider, "query": query, "page": page, "items": items}


async def fetch_domain_info(domain: str, provider: str, media_id: str) -> dict[str, Any]:
    if domain == "books" and provider == "gutendex":
        return await _fetch_gutendex_info(media_id)

    if provider == "openlibrary" or domain in {"books", "comics", "light-novels"}:
        return await _fetch_openlibrary_info(domain, media_id)

    if domain == "anime" and provider in {"zoro", "hianime", "gogoanime"} and not _consumet_configured():
        detail = await _fetch_jikan_anime_full(media_id, provider)
        episodes = await _fetch_jikan_anime_episodes(media_id, provider)
        detail["item"]["episodes"] = episodes.get("items") or []
        return detail

    if domain == "anime" and provider in {"zoro", "hianime"}:
        try:
            path = f"/anime/{provider}/info"
            payload = await _fetch_consumet_json(path, params={"id": media_id}, ttl_seconds=1800)
        except (HTTPException, ConsumetConfigError):
            detail = await _fetch_jikan_anime_full(media_id, provider)
            episodes = await _fetch_jikan_anime_episodes(media_id, provider)
            detail["item"]["episodes"] = episodes.get("items") or []
            return detail
    elif domain == "anime":
        try:
            path = f"/anime/{provider}/info/{quote(media_id)}"
            payload = await _fetch_consumet_json(path, ttl_seconds=1800)
        except (HTTPException, ConsumetConfigError):
            detail = await _fetch_jikan_anime_full(media_id, provider)
            episodes = await _fetch_jikan_anime_episodes(media_id, provider)
            detail["item"]["episodes"] = episodes.get("items") or []
            return detail
    elif domain == "manga":
        path = f"/manga/{provider}/info/{quote(media_id)}"
        payload = await _fetch_consumet_json(path, ttl_seconds=1800)
    else:
        path = f"/{domain}/{provider}/info/{quote(media_id)}"
        payload = await _fetch_consumet_json(path, ttl_seconds=1800)

    item = payload if isinstance(payload, dict) else {"value": payload}
    normalized = _normalize_media_item(item, domain, provider)

    if domain == "anime":
        episodes = [
            _normalize_episode_item(episode, provider, index + 1)
            for index, episode in enumerate(_payload_items({"episodes": item.get("episodes") or []}))
            if isinstance(episode, dict)
        ]
        normalized["episodes"] = episodes
    elif domain == "manga":
        chapters = [
            _normalize_chapter_item(chapter, provider, index + 1)
            for index, chapter in enumerate(_payload_items({"chapters": item.get("chapters") or []}))
            if isinstance(chapter, dict)
        ]
        normalized["chapters"] = chapters

    return {
        "domain": domain,
        "provider": provider,
        "item": normalized,
        "raw": payload,
    }


async def fetch_anime_episodes(provider: str, media_id: str) -> dict[str, Any]:
    if not _consumet_configured():
        return await _fetch_jikan_anime_episodes(media_id, provider)
    try:
        detail = await fetch_domain_info("anime", provider, media_id)
        return {
            "provider": provider,
            "id": media_id,
            "items": detail["item"].get("episodes") or [],
        }
    except (HTTPException, ConsumetConfigError):
        return await _fetch_jikan_anime_episodes(media_id, provider)


async def fetch_manga_chapters(provider: str, media_id: str) -> dict[str, Any]:
    detail = await fetch_domain_info("manga", provider, media_id)
    return {
        "provider": provider,
        "id": media_id,
        "items": detail["item"].get("chapters") or [],
    }


async def fetch_anime_watch(
    *,
    provider: str,
    episode_id: str,
    server: str | None = None,
    audio: str = "hi",
) -> dict[str, Any]:
    requested_audio = (audio or "hi").strip().lower()

    if not _consumet_configured():
        return {
            "provider": provider,
            "requested_audio": requested_audio,
            "available_audio": [requested_audio],
            "selected_server": server or "fallback",
            "headers": {},
            "download": "",
            "sources": [],
            "subtitles": [],
            "raw": {"fallback_only": True},
        }

    if provider == "hianime":
        # Map frontend server names to consumet-local values
        _server_map = {"hd-1": "vidstreaming", "hd-2": "vidcloud", "vidstreaming": "vidstreaming", "vidcloud": "vidcloud"}
        if server and server != "auto" and server in _server_map:
            servers = [_server_map[server]]
        else:
            servers = ["vidstreaming", "vidcloud"]
        categories = ["dub", "sub"] if requested_audio in {"hi", "en"} else ["sub", "dub"]
        last_error: HTTPException | None = None
        for category in categories:
            for server_name in servers:
                try:
                    payload = await _fetch_consumet_json(
                        f"/anime/{provider}/watch/{quote(episode_id)}",
                        params={"server": server_name, "category": category},
                        ttl_seconds=180,
                    )
                    normalized = normalize_watch_payload(
                        payload,
                        provider=provider,
                        requested_audio=requested_audio if category == "dub" else "original",
                        server=server_name,
                    )
                    if normalized["sources"]:
                        normalized["category"] = category
                        return normalized
                except HTTPException as exc:
                    last_error = exc
                    continue
        if last_error:
            raise last_error
        raise _http_error("Hianime did not return any playable anime sources.")

    if provider == "zoro":
        categories = ["dub", "sub"] if requested_audio in {"hi", "en"} else ["sub", "dub"]
        servers_z = [server] if server else ["hd-1", "hd-2", "streamsb", "streamtape"]
        last_error2: HTTPException | None = None
        for category in categories:
            for server_name in servers_z:
                try:
                    payload = await _fetch_consumet_json(
                        f"/anime/{provider}/watch/{quote(episode_id)}",
                        params={"server": server_name, "category": category},
                        ttl_seconds=180,
                    )
                    normalized = normalize_watch_payload(payload, provider=provider, requested_audio=requested_audio if category == "dub" else "original", server=server_name)
                    if normalized["sources"]:
                        normalized["category"] = category
                        return normalized
                except HTTPException as exc:
                    last_error2 = exc
                    continue
        if last_error2:
            raise last_error2
        raise _http_error("Consumet did not return any playable anime sources.")

    payload = await _fetch_consumet_json(
        f"/anime/{provider}/watch/{quote(episode_id)}",
        ttl_seconds=180,
    )
    normalized = normalize_watch_payload(payload, provider=provider, requested_audio=requested_audio, server=server)
    if not normalized["sources"]:
        raise _http_error("Consumet did not return any playable anime sources.")
    return normalized


async def fetch_manga_read(provider: str, chapter_id: str) -> dict[str, Any]:
    payload = await _fetch_consumet_json(
        f"/manga/{provider}/read/{quote(chapter_id)}",
        ttl_seconds=180,
    )
    pages: list[str] = []
    for item in _payload_items(payload):
        if isinstance(item, str) and item.strip():
            pages.append(item.strip())
        elif isinstance(item, dict):
            url = _first_non_empty(item.get("img"), item.get("url"), item.get("image"))
            if url:
                pages.append(url)

    return {
        "provider": provider,
        "chapter_id": chapter_id,
        "pages": pages,
        "raw": payload,
    }


async def fetch_generic_read(domain: str, provider: str, item_id: str) -> dict[str, Any]:
    if domain == "books" and provider == "gutendex":
        return await _fetch_gutendex_read(item_id)

    if provider == "openlibrary" or domain in {"books", "comics", "light-novels"}:
        return await _fetch_openlibrary_read(domain, item_id)

    payload = await _fetch_consumet_json(
        f"/{domain}/{provider}/read/{quote(item_id)}",
        ttl_seconds=180,
    )
    if isinstance(payload, dict) and payload.get("content"):
        content = payload.get("content")
    else:
        content = payload
    return {
        "domain": domain,
        "provider": provider,
        "id": item_id,
        "content": content,
        "raw": payload,
    }


async def fetch_news_feed(topic: str | None = None) -> dict[str, Any]:
    try:
        payload = await _fetch_consumet_json(
            "/news/ann/recent-feeds",
            params={"topic": topic} if topic else None,
            ttl_seconds=600,
        )
        items = []
        for item in _payload_items(payload):
            if not isinstance(item, dict):
                continue
            items.append(
                {
                    "id": _first_non_empty(str(item.get("id") or ""), item.get("guid") or "", item.get("url") or ""),
                    "title": _first_non_empty(item.get("title")),
                    "description": _first_non_empty(item.get("description"), item.get("content")),
                    "image": _extract_image(item),
                    "url": _first_non_empty(item.get("url"), item.get("link")),
                    "published_at": _first_non_empty(item.get("date"), item.get("publishedAt"), item.get("isoDate")),
                    "topic": _first_non_empty(item.get("topic")),
                    "raw": item,
                }
            )
        return {"topic": topic or "", "items": items}
    except Exception:
        return await _fetch_ann_feed(topic)


async def fetch_news_article(article_id: str) -> dict[str, Any]:
    try:
        payload = await _fetch_consumet_json(
            "/news/ann/info",
            params={"id": article_id},
            ttl_seconds=1800,
        )
        return {
            "id": article_id,
            "title": _first_non_empty(payload.get("title")),
            "description": _first_non_empty(payload.get("description"), payload.get("content")),
            "image": _extract_image(payload),
            "url": _first_non_empty(payload.get("url"), payload.get("link")),
            "published_at": _first_non_empty(payload.get("date"), payload.get("publishedAt"), payload.get("isoDate")),
            "content": payload.get("content") or payload.get("description") or "",
            "raw": payload,
        }
    except Exception:
        feed = await _fetch_ann_feed(None)
        item = next((entry for entry in feed["items"] if entry["id"] == article_id), None)
        if not item:
            raise _http_error("News article not found.", 404)
        return {
            "id": item["id"],
            "title": item["title"],
            "description": item["description"],
            "image": item.get("image", ""),
            "url": item.get("url", ""),
            "published_at": item.get("published_at", ""),
            "content": item.get("description", ""),
            "raw": item,
        }


async def fetch_meta_search(query: str, media_type: str = "movie") -> dict[str, Any]:
    if not _consumet_configured():
        return await _fetch_tmdb_meta_search(query, media_type)
    try:
        payload = await _fetch_consumet_json(
            f"/meta/tmdb/{quote(query)}",
            params={"type": media_type} if media_type else None,
            ttl_seconds=600,
        )
        items = [
            _normalize_media_item(item, media_type, "tmdb")
            for item in _payload_items(payload)
            if isinstance(item, dict)
        ]
        return {"query": query, "type": media_type, "items": items}
    except (HTTPException, ConsumetConfigError):
        return await _fetch_tmdb_meta_search(query, media_type)


async def fetch_meta_info(item_id: str, media_type: str = "movie") -> dict[str, Any]:
    if not _consumet_configured():
        return await _fetch_tmdb_meta_info(item_id, media_type)
    try:
        payload = await _fetch_consumet_json(
            f"/meta/tmdb/info/{quote(item_id)}",
            params={"type": media_type},
            ttl_seconds=1800,
        )
        return {
            "id": item_id,
            "type": media_type,
            "item": _normalize_media_item(payload if isinstance(payload, dict) else {}, media_type, "tmdb"),
            "raw": payload,
        }
    except (HTTPException, ConsumetConfigError):
        return await _fetch_tmdb_meta_info(item_id, media_type)
