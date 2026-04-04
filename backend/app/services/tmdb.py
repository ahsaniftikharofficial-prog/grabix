from typing import Any

import httpx
from fastapi import HTTPException

from app.services.runtime_config import has_tmdb_token, tmdb_bearer_token

TMDB_API_BASE = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500"
TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/w780"
HTTP_TIMEOUT = 20.0
_CACHE: dict[str, tuple[float, Any]] = {}


def _cache_key(kind: str, *parts: Any) -> str:
    import json
    return f"{kind}:{json.dumps(parts, sort_keys=True, ensure_ascii=True, default=str)}"


def _cache_get(key: str) -> Any | None:
    import time
    entry = _CACHE.get(key)
    if not entry:
        return None
    expires_at, value = entry
    if expires_at <= time.time():
        _CACHE.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: Any, ttl_seconds: int) -> Any:
    import time
    _CACHE[key] = (time.time() + max(ttl_seconds, 1), value)
    return value


def _tmdb_http_error(detail: str, status_code: int = 502, *, code: str = "tmdb_request_failed") -> HTTPException:
    exc = HTTPException(status_code=status_code, detail={
        "code": code,
        "message": detail,
        "retryable": status_code >= 500 or status_code in {429},
        "service": "tmdb",
        "user_action": "Try again in a moment, or configure a valid TMDB token if this keeps failing.",
    })
    return exc


async def fetch_tmdb_json(path: str, *, params: dict[str, Any] | None = None, ttl_seconds: int = 600) -> Any:
    if not has_tmdb_token():
        raise _tmdb_http_error(
            "TMDB is not configured for this build.",
            503,
            code="tmdb_config_missing",
        )

    filtered = {key: value for key, value in (params or {}).items() if value is not None and value != ""}
    key = _cache_key("tmdb-json", path, filtered)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    headers = {
        "User-Agent": "GRABIX/1.0",
        "Accept": "application/json, text/plain;q=0.9, */*;q=0.8",
        "Authorization": f"Bearer {tmdb_bearer_token()}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True, headers=headers) as client:
            response = await client.get(f"{TMDB_API_BASE}{path}", params=filtered)
    except Exception as exc:
        raise _tmdb_http_error(f"TMDB request failed: {exc}") from exc

    if response.status_code >= 400:
        code = "tmdb_auth_failed" if response.status_code in {401, 403} else "tmdb_request_failed"
        detail = response.text.strip() or f"TMDB request failed with {response.status_code}"
        raise _tmdb_http_error(
            detail,
            response.status_code if response.status_code in {401, 403, 404, 429, 500, 503} else 502,
            code=code,
        )

    try:
        data = response.json()
    except Exception as exc:
        raise _tmdb_http_error(f"TMDB returned invalid JSON from {path}: {exc}") from exc

    return _cache_set(key, data, ttl_seconds)


def poster_url(path: str | None) -> str:
    return f"{TMDB_IMAGE_BASE}{path}" if path else ""


def backdrop_url(path: str | None) -> str:
    return f"{TMDB_BACKDROP_BASE}{path}" if path else ""


async def discover_media(media_type: str, category: str, page: int = 1) -> dict[str, Any]:
    media = "tv" if str(media_type).lower() == "tv" else "movie"
    normalized = str(category or "").strip().lower()
    endpoints = {
        ("movie", "trending"): "/trending/movie/week",
        ("movie", "popular"): "/movie/popular",
        ("movie", "top_rated"): "/movie/top_rated",
        ("tv", "trending"): "/trending/tv/week",
        ("tv", "popular"): "/tv/popular",
        ("tv", "top_rated"): "/tv/top_rated",
        ("tv", "on_the_air"): "/tv/on_the_air",
    }
    endpoint = endpoints.get((media, normalized))
    if not endpoint:
        raise _tmdb_http_error(
            f"Unsupported TMDB discover category '{category}' for media '{media}'.",
            400,
            code="tmdb_request_invalid",
        )
    return await fetch_tmdb_json(endpoint, params={"page": max(page, 1)}, ttl_seconds=300)


async def search_media(media_type: str, query: str, page: int = 1) -> dict[str, Any]:
    normalized = str(media_type or "").strip().lower()
    if normalized not in {"movie", "tv", "multi"}:
        raise _tmdb_http_error(
            f"Unsupported TMDB search media type '{media_type}'.",
            400,
            code="tmdb_request_invalid",
        )
    return await fetch_tmdb_json(
        f"/search/{normalized}",
        params={"query": query, "page": max(page, 1)},
        ttl_seconds=300,
    )


async def fetch_details(media_type: str, item_id: int, append_to_response: str = "") -> dict[str, Any]:
    normalized = "tv" if str(media_type).lower() == "tv" else "movie"
    params = {"append_to_response": append_to_response.strip()} if append_to_response.strip() else None
    return await fetch_tmdb_json(f"/{normalized}/{int(item_id)}", params=params, ttl_seconds=300)


async def fetch_tv_season(tv_id: int, season_number: int) -> dict[str, Any]:
    return await fetch_tmdb_json(f"/tv/{int(tv_id)}/season/{int(season_number)}", ttl_seconds=300)


async def fetch_tv_season_map(tv_id: int) -> list[dict[str, int]]:
    details = await fetch_details("tv", tv_id)
    return [
        {
            "season": int(item.get("season_number") or 0),
            "count": int(item.get("episode_count") or 0),
        }
        for item in (details.get("seasons") or [])
        if int(item.get("season_number") or 0) > 0 and int(item.get("episode_count") or 0) > 0
    ]

