from __future__ import annotations

import os
import threading
import time
from typing import Any

import httpx
from fastapi import Request

from app.services.errors import raise_json_http

SUPABASE_URL_ENV = "GRABIX_SUPABASE_URL"
SUPABASE_ANON_KEY_ENV = "GRABIX_SUPABASE_ANON_KEY"
_VERIFY_CACHE_TTL_SECONDS = 60
_verify_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_verify_cache_lock = threading.Lock()


def supabase_url() -> str:
    return str(os.getenv(SUPABASE_URL_ENV, "")).strip().rstrip("/")


def supabase_anon_key() -> str:
    return str(os.getenv(SUPABASE_ANON_KEY_ENV, "")).strip()


def is_supabase_auth_configured() -> bool:
    return bool(supabase_url() and supabase_anon_key())


def auth_config_snapshot() -> dict[str, Any]:
    return {
        "provider": "supabase",
        "configured": is_supabase_auth_configured(),
        "url_ready": bool(supabase_url()),
        "anon_key_ready": bool(supabase_anon_key()),
    }


def _authorization_bearer_token(request: Request) -> str:
    raw = str(request.headers.get("Authorization", "")).strip()
    if not raw.lower().startswith("bearer "):
        return ""
    return raw[7:].strip()


def _cache_get(token: str) -> dict[str, Any] | None:
    now = time.time()
    with _verify_cache_lock:
        cached = _verify_cache.get(token)
        if not cached:
            return None
        expires_at, payload = cached
        if expires_at <= now:
            _verify_cache.pop(token, None)
            return None
        return dict(payload)


def _cache_set(token: str, payload: dict[str, Any]) -> None:
    with _verify_cache_lock:
        _verify_cache[token] = (time.time() + _VERIFY_CACHE_TTL_SECONDS, dict(payload))


async def verify_supabase_access_token(token: str) -> dict[str, Any]:
    normalized = str(token or "").strip()
    if not normalized:
        raise_json_http(
            401,
            "Sign in to continue.",
            code="cloud_auth_missing",
            service="auth",
            retryable=True,
            user_action="Sign in with your GRABIX cloud account, then try again.",
        )

    if not is_supabase_auth_configured():
        raise_json_http(
            503,
            "Cloud account sign-in is not configured for this build.",
            code="cloud_auth_unavailable",
            service="auth",
            retryable=False,
            user_action="Set GRABIX_SUPABASE_URL and GRABIX_SUPABASE_ANON_KEY, then restart GRABIX.",
        )

    cached = _cache_get(normalized)
    if cached is not None:
        return cached

    url = f"{supabase_url()}/auth/v1/user"
    headers = {
        "apikey": supabase_anon_key(),
        "Authorization": f"Bearer {normalized}",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=headers)
    except Exception as exc:
        raise_json_http(
            503,
            f"Cloud account verification failed: {exc}",
            code="cloud_auth_verify_failed",
            service="auth",
            retryable=True,
            user_action="Check your connection and try signing in again.",
        )

    if response.status_code in {401, 403}:
        raise_json_http(
            401,
            "Your cloud session is no longer valid.",
            code="cloud_auth_invalid",
            service="auth",
            retryable=True,
            user_action="Sign in again to refresh your session.",
        )
    if response.status_code >= 400:
        detail = response.text.strip() or f"Cloud account verification failed with {response.status_code}."
        raise_json_http(
            503,
            detail,
            code="cloud_auth_verify_failed",
            service="auth",
            retryable=True,
            user_action="Try again in a moment.",
        )

    payload = response.json() if response.content else {}
    if not isinstance(payload, dict) or not payload.get("id"):
        raise_json_http(
            401,
            "The cloud session response was invalid.",
            code="cloud_auth_invalid",
            service="auth",
            retryable=True,
            user_action="Sign in again to refresh your session.",
        )

    _cache_set(normalized, payload)
    return dict(payload)


async def require_supabase_user(request: Request) -> dict[str, Any]:
    token = _authorization_bearer_token(request)
    return await verify_supabase_access_token(token)
