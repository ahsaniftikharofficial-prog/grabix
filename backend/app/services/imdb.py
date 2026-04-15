from typing import Any

import httpx
from fastapi import HTTPException

IMDB_API_BASE = "https://api.imdbapi.dev"
HTTP_TIMEOUT = 20.0
_CACHE: dict[str, tuple[float, Any]] = {}


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


def _imdb_http_error(detail: str, status_code: int = 502) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={
            "code": "imdb_request_failed",
            "message": detail,
            "retryable": status_code >= 500 or status_code == 429,
            "service": "imdb",
            "user_action": "Try again in a moment.",
        },
    )


async def fetch_imdb_json(path: str, *, ttl_seconds: int = 600) -> Any:
    cache_key = f"imdb:{path}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    headers = {
        "User-Agent": "GRABIX/1.0",
        "Accept": "application/json, text/plain;q=0.9, */*;q=0.8",
    }
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True, headers=headers) as client:
            response = await client.get(f"{IMDB_API_BASE}{path}")
    except Exception as exc:
        raise _imdb_http_error(f"IMDb request failed: {exc}") from exc

    if response.status_code >= 400:
        detail = response.text.strip() or f"IMDb request failed with {response.status_code}"
        raise _imdb_http_error(
            detail,
            response.status_code if response.status_code in {404, 429, 500, 503} else 502,
        )

    try:
        data = response.json()
    except Exception as exc:
        raise _imdb_http_error(f"IMDb returned invalid JSON from {path}: {exc}") from exc

    return _cache_set(cache_key, data, ttl_seconds)


async def fetch_imdb_chart(chart_name: str) -> dict[str, Any]:
    normalized = str(chart_name or "").strip().lower()
    routes = {
        "top250movies": "/chart/top250movies",
        "top250tvshows": "/chart/top250tvshows",
    }
    path = routes.get(normalized)
    if not path:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "imdb_request_invalid",
                "message": f"Unsupported IMDb chart '{chart_name}'.",
                "retryable": False,
                "service": "imdb",
                "user_action": "Use a supported chart.",
            },
        )
    return await fetch_imdb_json(path, ttl_seconds=1800)
