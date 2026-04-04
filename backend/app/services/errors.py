from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

RETRYABLE_STATUS_CODES = {408, 409, 423, 425, 429, 500, 502, 503, 504}


def infer_service_from_path(path: str | None) -> str:
    normalized = str(path or "").strip()
    if not normalized or normalized == "/":
        return "backend"
    segment = normalized.lstrip("/").split("/", 1)[0].strip().lower()
    return segment or "backend"


def default_error_code(status_code: int, service: str) -> str:
    if status_code == 400:
        return f"{service}_bad_request"
    if status_code == 401:
        return f"{service}_unauthorized"
    if status_code == 403:
        return f"{service}_forbidden"
    if status_code == 404:
        return f"{service}_not_found"
    if status_code == 409:
        return f"{service}_conflict"
    if status_code == 429:
        return f"{service}_rate_limited"
    if status_code >= 500:
        return f"{service}_failed"
    return f"{service}_error"


def default_user_action(status_code: int) -> str:
    if status_code in {400, 404}:
        return "Check the request details and try again."
    if status_code in {401, 403}:
        return "Open this action from the active GRABIX desktop app session and try again."
    if status_code == 429:
        return "Wait a moment and retry after the temporary limit resets."
    if status_code >= 500:
        return "Try again in a moment. If the issue continues, export diagnostics and restart GRABIX."
    return "Try the request again."


def normalize_error_payload(
    detail: Any,
    status_code: int,
    *,
    service: str = "backend",
    code: str = "",
    user_action: str = "",
    retryable: bool | None = None,
) -> dict[str, Any]:
    if isinstance(detail, dict):
        payload = dict(detail)
    else:
        payload = {"message": str(detail).strip() if detail is not None else ""}

    payload["message"] = str(payload.get("message") or "").strip() or f"Request failed with {status_code}."
    payload["code"] = str(payload.get("code") or code or default_error_code(status_code, service)).strip()
    payload["service"] = str(payload.get("service") or service or "backend").strip() or "backend"
    if retryable is None:
        payload["retryable"] = bool(payload.get("retryable")) if "retryable" in payload else status_code in RETRYABLE_STATUS_CODES
    else:
        payload["retryable"] = retryable
    payload["user_action"] = str(payload.get("user_action") or user_action or default_user_action(status_code)).strip()
    return payload


def json_error_response(
    *,
    status_code: int,
    detail: Any,
    request: Request | None = None,
    code: str = "",
    service: str = "",
    user_action: str = "",
    retryable: bool | None = None,
) -> JSONResponse:
    resolved_service = service or infer_service_from_path(getattr(getattr(request, "url", None), "path", ""))
    payload = normalize_error_payload(
        detail,
        status_code,
        service=resolved_service,
        code=code,
        user_action=user_action,
        retryable=retryable,
    )
    body: dict[str, Any] = {"detail": payload}
    correlation_id = str(getattr(getattr(request, "state", None), "correlation_id", "") or "").strip()
    if correlation_id:
        body["correlation_id"] = correlation_id
    return JSONResponse(status_code=status_code, content=body)


def raise_json_http(
    status_code: int,
    detail: Any,
    *,
    code: str = "",
    service: str = "backend",
    user_action: str = "",
    retryable: bool | None = None,
) -> None:
    raise HTTPException(
        status_code=status_code,
        detail=normalize_error_payload(
            detail,
            status_code,
            service=service,
            code=code,
            user_action=user_action,
            retryable=retryable,
        ),
    )
