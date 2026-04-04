from __future__ import annotations

import re
import time
from collections import deque
from dataclasses import dataclass
from typing import Iterable

from fastapi import Request

from app.services.errors import raise_json_http

_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_SPACE_RE = re.compile(r"\s+")


def clean_text(value: str | None, *, field: str, max_length: int = 200, min_length: int = 1) -> str:
    normalized = _CONTROL_CHARS_RE.sub("", str(value or ""))
    normalized = _SPACE_RE.sub(" ", normalized).strip()
    if len(normalized) < min_length:
        raise_json_http(400, f"{field} is required.", code=f"{field}_required", service="validation", retryable=False)
    if len(normalized) > max_length:
        raise_json_http(400, f"{field} is too long.", code=f"{field}_too_long", service="validation", retryable=False)
    return normalized


def clean_optional_text(value: str | None, *, field: str, max_length: int = 200) -> str:
    normalized = _CONTROL_CHARS_RE.sub("", str(value or ""))
    normalized = _SPACE_RE.sub(" ", normalized).strip()
    if len(normalized) > max_length:
        raise_json_http(400, f"{field} is too long.", code=f"{field}_too_long", service="validation", retryable=False)
    return normalized


def require_choice(value: str | None, *, field: str, allowed: Iterable[str]) -> str:
    normalized = clean_text(value, field=field, max_length=64).lower()
    allowed_set = {item.strip().lower() for item in allowed if str(item).strip()}
    if normalized not in allowed_set:
        raise_json_http(
            400,
            f"{field} must be one of: {', '.join(sorted(allowed_set))}.",
            code=f"{field}_invalid",
            service="validation",
            retryable=False,
        )
    return normalized


@dataclass(frozen=True)
class RateLimitPolicy:
    bucket: str
    limit: int
    window_seconds: int


_request_buckets: dict[str, deque[float]] = {}


def _client_key(request: Request) -> str:
    forwarded = str(request.headers.get("X-Forwarded-For", "")).split(",", 1)[0].strip()
    if forwarded:
        return forwarded
    if request.client and request.client.host:
        return request.client.host
    return "local"


def resolve_rate_limit_policy(request: Request) -> RateLimitPolicy | None:
    path = str(request.url.path or "")
    method = str(request.method or "GET").upper()

    if path.startswith("/health/") or path in {"/docs", "/openapi.json"}:
        return None
    if path.startswith("/download") or path.startswith("/downloads") or path.startswith("/convert"):
        return RateLimitPolicy(bucket="write-heavy", limit=30, window_seconds=60)
    if path.startswith("/subtitles/") or path.startswith("/consumet/") or path.startswith("/metadata/"):
        return RateLimitPolicy(bucket="provider-read", limit=120, window_seconds=60)
    if method in {"POST", "PATCH", "DELETE"}:
        return RateLimitPolicy(bucket="writes", limit=60, window_seconds=60)
    return RateLimitPolicy(bucket="default", limit=180, window_seconds=60)


def enforce_rate_limit(request: Request) -> None:
    policy = resolve_rate_limit_policy(request)
    if policy is None:
        return

    now = time.time()
    bucket_key = f"{policy.bucket}:{_client_key(request)}"
    queue = _request_buckets.setdefault(bucket_key, deque())
    while queue and queue[0] <= now - policy.window_seconds:
        queue.popleft()

    if len(queue) >= policy.limit:
        retry_after = max(1, int(policy.window_seconds - (now - queue[0])))
        raise_json_http(
            429,
            f"Too many requests. Try again in {retry_after} seconds.",
            code="request_rate_limited",
            service="security",
            user_action="Slow down repeated requests for a moment, then try again.",
            retryable=True,
        )

    queue.append(now)
