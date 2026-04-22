"""
provider_types.py — shared types, dataclasses, error class, and base adapter.

No internal GRABIX imports — safe to import from anywhere.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Protocol

from fastapi import HTTPException


# ── Protocol ──────────────────────────────────────────────────────────────────

class ProviderAdapter(Protocol):
    name: str
    family: str
    policy: "ProviderPolicy"

    async def health(self, **kwargs) -> Any: ...
    async def discover(self, **kwargs) -> Any: ...
    async def search(self, **kwargs) -> Any: ...
    async def details(self, **kwargs) -> Any: ...
    async def sources(self, **kwargs) -> Any: ...
    async def download_options(self, **kwargs) -> Any: ...
    async def subtitles(self, **kwargs) -> Any: ...


# ── Dataclasses ───────────────────────────────────────────────────────────────

@dataclass(slots=True)
class ProviderPolicy:
    timeout_seconds: float = 15.0
    retries: int = 1
    cooldown_seconds: float = 20.0
    circuit_breaker_threshold: int = 3


@dataclass(slots=True)
class ProviderCircuitState:
    failures: int = 0
    open_until: float = 0.0
    last_error: str = ""
    last_failure_at: float = 0.0


# ── Error class ───────────────────────────────────────────────────────────────

class ProviderServiceError(RuntimeError):
    def __init__(
        self,
        *,
        code: str,
        message: str,
        retryable: bool,
        provider: str,
        correlation_id: str | None = None,
        fallback_used: bool = False,
        user_action: str = "Try again in a moment.",
        status_code: int = 502,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.provider = provider
        self.correlation_id = correlation_id or uuid.uuid4().hex
        self.fallback_used = fallback_used
        self.user_action = user_action
        self.status_code = status_code
        self.details = details or {}

    def to_payload(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "provider": self.provider,
            "fallback_used": self.fallback_used,
            "correlation_id": self.correlation_id,
            "user_action": self.user_action,
        }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_retryable_status(status_code: int) -> bool:
    return status_code in {408, 409, 423, 425, 429, 500, 502, 503, 504}


def _provider_error_from_exception(
    error: Exception,
    *,
    provider: str,
    correlation_id: str,
    fallback_used: bool = False,
) -> ProviderServiceError:
    if isinstance(error, ProviderServiceError):
        if not error.correlation_id:
            error.correlation_id = correlation_id
        return error

    if isinstance(error, HTTPException):
        detail = error.detail
        if isinstance(detail, dict):
            message = str(detail.get("message") or detail.get("detail") or f"{provider} request failed.")
            details = detail
        else:
            message = str(detail or f"{provider} request failed.")
            details = {}
        return ProviderServiceError(
            code=f"{provider.replace(' ', '_').lower()}_http_error",
            message=message,
            retryable=_is_retryable_status(error.status_code),
            provider=provider,
            correlation_id=correlation_id,
            fallback_used=fallback_used,
            user_action="Switch sources or retry after the provider recovers." if _is_retryable_status(error.status_code) else "Try another provider or source.",
            status_code=error.status_code,
            details=details,
        )

    return ProviderServiceError(
        code=f"{provider.replace(' ', '_').lower()}_execution_failed",
        message=str(error) or f"{provider} failed to respond.",
        retryable=True,
        provider=provider,
        correlation_id=correlation_id,
        fallback_used=fallback_used,
        user_action="Try again or let GRABIX fall back to the next provider.",
        status_code=502,
    )


# ── Base adapter ──────────────────────────────────────────────────────────────

class BaseProviderAdapter:
    def __init__(self, *, name: str, family: str, policy: ProviderPolicy | None = None) -> None:
        self.name = name
        self.family = family
        self.policy = policy or ProviderPolicy()

    async def _unsupported(self, operation: str) -> Any:
        raise ProviderServiceError(
            code="unsupported_operation",
            message=f"{self.name} does not support {operation}.",
            retryable=False,
            provider=self.name,
            user_action="Use a different provider path.",
            status_code=400,
        )

    async def health(self, **kwargs) -> Any:
        return await self._unsupported("health")

    async def discover(self, **kwargs) -> Any:
        return await self._unsupported("discover")

    async def search(self, **kwargs) -> Any:
        return await self._unsupported("search")

    async def details(self, **kwargs) -> Any:
        return await self._unsupported("details")

    async def sources(self, **kwargs) -> Any:
        return await self._unsupported("sources")

    async def download_options(self, **kwargs) -> Any:
        return await self._unsupported("download_options")

    async def subtitles(self, **kwargs) -> Any:
        return await self._unsupported("subtitles")
