from typing import Any

from fastapi import Request

from app.services.runtime_config import (
    desktop_auth_token,
    is_desktop_auth_observe_only,
    is_desktop_auth_required,
)

DESKTOP_AUTH_HEADER = "X-Grabix-Desktop-Auth"

_SENSITIVE_ROUTES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("/download", ("GET", "POST")),
    ("/downloads/", ("POST", "DELETE")),
    ("/downloads/stop-all", ("POST",)),
    ("/open-download-folder", ("POST",)),
    ("/open-local-file", ("POST",)),
    ("/settings", ("POST",)),
    ("/settings/adult-content/", ("POST",)),
    ("/diagnostics/export", ("GET",)),
    ("/library/", ("POST", "DELETE", "PATCH")),
    ("/history/", ("DELETE", "PATCH")),
    ("/convert", ("POST",)),
    ("/runtime/dependencies/install", ("POST",)),
)


def requires_desktop_auth(method: str, path: str) -> bool:
    normalized_method = str(method or "").upper()
    normalized_path = str(path or "").strip()
    if not normalized_path.startswith("/"):
        normalized_path = f"/{normalized_path}"

    for prefix, methods in _SENSITIVE_ROUTES:
        # FIX: use precise boundary matching so that "/download" does NOT match
        # "/download-status/...", "/downloads/stream", or "/downloads".
        # Previously `startswith(prefix)` caused every path beginning with
        # "/download" — including the read-only polling and SSE endpoints — to
        # require the desktop auth header.  In a release EXE the header is
        # required but _pollTask uses plain fetch() with no header, so every
        # status poll got a 401, silently hit MAX_CONSECUTIVE_ERRORS (8 tries),
        # then stopped — leaving the queue item stuck on "Queued" forever.
        # Precise matching: strip any trailing slash from the prefix, then
        # require the path to be exact, or continue with "/" or "?".
        prefix_base = prefix.rstrip("/")
        path_matches = (
            normalized_path == prefix_base          # exact (no trailing slash)
            or normalized_path == prefix            # exact (with trailing slash)
            or normalized_path.startswith(prefix_base + "/")   # sub-resource
            or normalized_path.startswith(prefix_base + "?")   # query string
        )
        if path_matches and normalized_method in methods:
            return True
    return False


def desktop_auth_state_snapshot() -> dict[str, Any]:
    return {
        "required": is_desktop_auth_required(),
        "observe_only": is_desktop_auth_observe_only(),
        "ready": bool(desktop_auth_token()),
        "header": DESKTOP_AUTH_HEADER,
    }


def validate_desktop_auth_request(request: Request) -> dict[str, Any] | None:
    if not requires_desktop_auth(request.method, request.url.path):
        return None

    expected = desktop_auth_token()
    if not expected:
        # No token configured at all. In packaged mode this is a real problem;
        # in dev mode (run.bat) the token env var is simply never set.
        if is_desktop_auth_required():
            return {
                "status_code": 503,
                "payload": {
                    "code": "desktop_auth_unavailable",
                    "message": "Desktop auth is not initialized for this install.",
                    "retryable": True,
                    "service": "security",
                    "user_action": "Restart GRABIX so the local backend trust token can be created again.",
                },
            }
        # Not required and no token = dev/source mode. Allow through.
        return None

    provided = str(request.headers.get(DESKTOP_AUTH_HEADER, "")).strip()
    if provided == expected:
        return None

    status_code = 401 if not provided else 403
    code = "desktop_auth_missing" if not provided else "desktop_auth_invalid"
    payload = {
        "code": code,
        "message": "This local action requires a trusted GRABIX desktop session.",
        "retryable": True,
        "service": "security",
        "user_action": "Open this action from the GRABIX desktop app instead of an external browser or stale window.",
    }

    if is_desktop_auth_observe_only() and not is_desktop_auth_required():
        payload["observe_only"] = True
        return None

    return {"status_code": status_code, "payload": payload}
