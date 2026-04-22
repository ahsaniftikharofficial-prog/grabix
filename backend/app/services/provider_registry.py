"""
provider_registry.py — ProviderRegistry class.

Holds registered adapters and their circuit breaker states.
Does NOT import any adapter classes — the singleton lives in provider_adapters.py.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

from app.services.provider_types import (
    ProviderAdapter,
    ProviderCircuitState,
    ProviderServiceError,
    _provider_error_from_exception,
)


class ProviderRegistry:
    def __init__(self) -> None:
        self._providers: dict[str, ProviderAdapter] = {}
        self._circuit_states: dict[str, ProviderCircuitState] = {}

    def register(self, adapter: ProviderAdapter) -> None:
        self._providers[adapter.name] = adapter
        self._circuit_states.setdefault(adapter.family, ProviderCircuitState())

    def snapshot(self) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        now = time.time()
        for name, adapter in self._providers.items():
            state = self._circuit_states.setdefault(adapter.family, ProviderCircuitState())
            payload[name] = {
                "family": adapter.family,
                "timeout_seconds": adapter.policy.timeout_seconds,
                "retries": adapter.policy.retries,
                "cooldown_seconds": adapter.policy.cooldown_seconds,
                "circuit_breaker_threshold": adapter.policy.circuit_breaker_threshold,
                "failures": state.failures,
                "cooldown_remaining_seconds": max(0, int(state.open_until - now)),
                "circuit_open": state.open_until > now,
                "last_error": state.last_error,
                "last_failure_at": int(state.last_failure_at) if state.last_failure_at else 0,
            }
        return payload

    async def execute(
        self,
        provider_name: str,
        operation: str,
        *,
        correlation_id: str,
        fallback_used: bool = False,
        **kwargs,
    ) -> Any:
        adapter = self._providers.get(provider_name)
        if adapter is None:
            raise ProviderServiceError(
                code="provider_not_registered",
                message=f"Provider '{provider_name}' is not registered.",
                retryable=False,
                provider=provider_name,
                correlation_id=correlation_id,
                fallback_used=fallback_used,
                user_action="Check the provider configuration.",
                status_code=500,
            )

        state = self._circuit_states.setdefault(adapter.family, ProviderCircuitState())
        now = time.time()
        if state.open_until > now:
            raise ProviderServiceError(
                code="provider_circuit_open",
                message=f"{adapter.name} is cooling down after repeated failures.",
                retryable=True,
                provider=adapter.name,
                correlation_id=correlation_id,
                fallback_used=fallback_used,
                user_action="Wait a few seconds or use the next fallback provider.",
                status_code=503,
                details={"cooldown_remaining_seconds": max(1, int(state.open_until - now))},
            )

        method = getattr(adapter, operation, None)
        if method is None:
            raise ProviderServiceError(
                code="provider_operation_missing",
                message=f"{adapter.name} cannot perform {operation}.",
                retryable=False,
                provider=adapter.name,
                correlation_id=correlation_id,
                fallback_used=fallback_used,
                user_action="Use a different provider path.",
                status_code=400,
            )

        last_error: ProviderServiceError | None = None
        for attempt_index in range(adapter.policy.retries + 1):
            try:
                result = await asyncio.wait_for(method(**kwargs), timeout=adapter.policy.timeout_seconds)
                state.failures = 0
                state.open_until = 0.0
                state.last_error = ""
                return result
            except Exception as error:
                normalized = _provider_error_from_exception(
                    error,
                    provider=adapter.name,
                    correlation_id=correlation_id,
                    fallback_used=fallback_used,
                )
                state.failures += 1
                state.last_error = normalized.message
                state.last_failure_at = time.time()
                last_error = normalized

                if state.failures >= adapter.policy.circuit_breaker_threshold:
                    state.open_until = time.time() + adapter.policy.cooldown_seconds

                if attempt_index >= adapter.policy.retries or not normalized.retryable:
                    raise normalized

                await asyncio.sleep(min(0.35 * (attempt_index + 1), 1.0))

        if last_error is not None:
            raise last_error

        raise ProviderServiceError(
            code="provider_execution_unknown",
            message=f"{adapter.name} did not return a result.",
            retryable=True,
            provider=adapter.name,
            correlation_id=correlation_id,
        )
