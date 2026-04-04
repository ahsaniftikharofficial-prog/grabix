from __future__ import annotations

import time
from typing import Any

from fastapi import Request

from app.services.errors import raise_json_http

try:
    import bcrypt
    BCRYPT_AVAILABLE = True
except Exception:
    bcrypt = None
    BCRYPT_AVAILABLE = False


ADULT_UNLOCK_WINDOW_SECONDS = 300
ADULT_UNLOCK_MAX_ATTEMPTS = 5
adult_unlock_attempts: dict[str, list[float]] = {}


def _client_key(request: Request | None = None) -> str:
    if request and request.client and request.client.host:
        return request.client.host
    return "local"


def _normalize_unlock_attempts(client_key: str) -> list[float]:
    cutoff = time.time() - ADULT_UNLOCK_WINDOW_SECONDS
    attempts = [stamp for stamp in adult_unlock_attempts.get(client_key, []) if stamp >= cutoff]
    adult_unlock_attempts[client_key] = attempts
    return attempts


def _record_unlock_failure(client_key: str) -> int:
    attempts = _normalize_unlock_attempts(client_key)
    attempts.append(time.time())
    adult_unlock_attempts[client_key] = attempts
    return len(attempts)


def _ensure_unlock_not_throttled(client_key: str) -> None:
    attempts = _normalize_unlock_attempts(client_key)
    if len(attempts) >= ADULT_UNLOCK_MAX_ATTEMPTS:
        retry_after = max(1, int(ADULT_UNLOCK_WINDOW_SECONDS - (time.time() - attempts[0])))
        raise_json_http(
            429,
            f"Too many failed attempts. Try again in {retry_after} seconds.",
            code="adult_content_rate_limited",
            service="settings",
            user_action="Wait for the temporary lockout to expire, then try the password again.",
            retryable=True,
        )


def _hash_adult_password(password: str) -> str:
    if not BCRYPT_AVAILABLE:
        raise_json_http(
            500,
            "bcrypt is required before configuring the adult-content password.",
            code="adult_content_bcrypt_unavailable",
            service="settings",
        )
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_adult_password(password: str, hashed_value: str) -> bool:
    if not password or not hashed_value or not BCRYPT_AVAILABLE:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed_value.encode("utf-8"))
    except ValueError:
        return False


def settings_public_payload(default_settings: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    payload = {**default_settings, **(data or {})}
    payload.pop("adult_password_hash", None)
    payload["adult_content_enabled"] = False
    payload["adult_password_configured"] = bool((data or {}).get("adult_password_hash"))
    return payload


def get_settings_payload(*, default_settings: dict[str, Any], load_settings) -> dict[str, Any]:
    return settings_public_payload(default_settings, load_settings())


def update_settings_payload(
    data: dict[str, Any],
    *,
    default_settings: dict[str, Any],
    load_settings,
    save_settings_to_disk,
    default_download_dir: str,
) -> dict[str, Any]:
    current = load_settings()
    sanitized = {**current, **dict(data or {})}
    sanitized.pop("adult_password_hash", None)
    sanitized.pop("adult_password_configured", None)
    sanitized["adult_content_enabled"] = False
    if not str(sanitized.get("download_folder") or "").strip():
        sanitized["download_folder"] = default_download_dir
    try:
        save_settings_to_disk(sanitized)
    except Exception as exc:
        raise_json_http(
            500,
            f"Settings could not be saved: {exc}",
            code="settings_write_failed",
            service="settings",
        )
    return settings_public_payload(default_settings, load_settings())


def configure_adult_content_password(
    password: str,
    *,
    load_settings,
    save_settings_to_disk,
) -> dict[str, Any]:
    normalized = str(password or "").strip()
    if len(normalized) < 6:
        raise_json_http(
            400,
            "Password must be at least 6 characters.",
            code="adult_content_password_too_short",
            service="settings",
            retryable=False,
        )

    settings = load_settings()
    save_settings_to_disk(
        {
            **settings,
            "adult_password_hash": _hash_adult_password(normalized),
            "adult_password_configured": True,
            "adult_content_enabled": False,
        }
    )
    return {"configured": True}


def unlock_adult_content_password(
    password: str,
    request: Request,
    *,
    load_settings,
) -> dict[str, Any]:
    settings = load_settings()
    expected_hash = str(settings.get("adult_password_hash") or "")
    if not expected_hash:
        raise_json_http(
            428,
            "Set an adult-content password first.",
            code="adult_content_not_configured",
            service="settings",
            retryable=False,
            user_action="Set an adult-content password in Settings before trying to unlock it.",
        )

    client_key = _client_key(request)
    _ensure_unlock_not_throttled(client_key)
    if not _verify_adult_password(password or "", expected_hash):
        attempts = _record_unlock_failure(client_key)
        remaining = max(0, ADULT_UNLOCK_MAX_ATTEMPTS - attempts)
        raise_json_http(
            403,
            f"Incorrect password. {remaining} attempt(s) remaining before a temporary lockout.",
            code="adult_content_password_invalid",
            service="settings",
            retryable=True,
            user_action="Check the password and try again.",
        )

    adult_unlock_attempts.pop(client_key, None)
    return {"unlocked": True}
