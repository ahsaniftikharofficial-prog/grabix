"""
core/circuit_breaker.py — Single circuit breaker implementation for GRABIX.

Replaces TWO separate implementations that existed before:
  1. _HealthCBState in main.py  (used by health_services)
  2. ProviderCircuitState in providers.py (used by provider adapters)

Now there is ONE. Both main.py and providers.py import from here.

CIRCUIT BREAKER STATES:
  CLOSED   — normal operation, requests go through
  OPEN     — too many failures, requests are blocked for cooldown_seconds
  HALF_OPEN — cooldown expired, one probe request allowed through

USAGE:
    from core.circuit_breaker import CircuitBreaker

    cb = CircuitBreaker(service="consumet", failure_threshold=3, cooldown_seconds=60)

    if cb.is_open():
        raise ServiceUnavailableError("Consumet is down")

    try:
        result = await call_consumet()
        cb.record_success()
    except Exception as exc:
        cb.record_failure(str(exc))
        raise
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

logger = logging.getLogger("grabix.circuit_breaker")


class CircuitState(Enum):
    CLOSED    = "closed"
    OPEN      = "open"
    HALF_OPEN = "half_open"


@dataclass
class CircuitBreaker:
    service:             str
    failure_threshold:   int   = 3       # failures before opening
    cooldown_seconds:    float = 60.0    # time in OPEN before trying again
    success_threshold:   int   = 1       # successes in HALF_OPEN before closing

    # Internal state
    _state:               CircuitState = field(default=CircuitState.CLOSED, init=False, repr=False)
    _failure_count:       int          = field(default=0, init=False, repr=False)
    _success_count:       int          = field(default=0, init=False, repr=False)
    _last_failure_time:   float        = field(default=0.0, init=False, repr=False)
    _last_failure_reason: str          = field(default="", init=False, repr=False)
    _last_latency_ms:     Optional[float] = field(default=None, init=False, repr=False)
    _lock:                threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)

    @property
    def state(self) -> CircuitState:
        with self._lock:
            return self._evaluate_state()

    def _evaluate_state(self) -> CircuitState:
        """Called under lock. Transitions OPEN → HALF_OPEN on timeout."""
        if self._state == CircuitState.OPEN:
            if time.monotonic() - self._last_failure_time >= self.cooldown_seconds:
                self._state = CircuitState.HALF_OPEN
                self._success_count = 0
                logger.info("[circuit_breaker] %s → HALF_OPEN (cooldown elapsed)", self.service)
        return self._state

    def is_open(self) -> bool:
        """Returns True if the circuit is OPEN (requests should be blocked)."""
        return self.state == CircuitState.OPEN

    def is_closed(self) -> bool:
        return self.state == CircuitState.CLOSED

    def record_success(self, latency_ms: float | None = None) -> None:
        with self._lock:
            self._last_latency_ms = latency_ms
            state = self._evaluate_state()
            if state == CircuitState.HALF_OPEN:
                self._success_count += 1
                if self._success_count >= self.success_threshold:
                    self._state = CircuitState.CLOSED
                    self._failure_count = 0
                    logger.info("[circuit_breaker] %s → CLOSED (recovered)", self.service)
            elif state == CircuitState.CLOSED:
                self._failure_count = max(0, self._failure_count - 1)

    def record_failure(self, reason: str = "") -> None:
        with self._lock:
            self._failure_count += 1
            self._last_failure_time = time.monotonic()
            self._last_failure_reason = reason
            state = self._evaluate_state()
            if state in (CircuitState.CLOSED, CircuitState.HALF_OPEN):
                if self._failure_count >= self.failure_threshold:
                    self._state = CircuitState.OPEN
                    logger.warning(
                        "[circuit_breaker] %s → OPEN after %d failures. Last: %s",
                        self.service, self._failure_count, reason
                    )

    def reset(self) -> None:
        """Manually reset to CLOSED. Used by the admin reset endpoint."""
        with self._lock:
            self._state = CircuitState.CLOSED
            self._failure_count = 0
            self._success_count = 0
            self._last_failure_reason = ""
            logger.info("[circuit_breaker] %s manually reset → CLOSED", self.service)

    def snapshot(self) -> dict:
        """Return a JSON-serializable status dict for health/diagnostics endpoints."""
        with self._lock:
            state = self._evaluate_state()
            cooldown_remaining = 0.0
            if state == CircuitState.OPEN:
                elapsed = time.monotonic() - self._last_failure_time
                cooldown_remaining = max(0.0, self.cooldown_seconds - elapsed)
            return {
                "service":             self.service,
                "state":               state.value,
                "failure_count":       self._failure_count,
                "failure_threshold":   self.failure_threshold,
                "last_failure_reason": self._last_failure_reason,
                "last_latency_ms":     self._last_latency_ms,
                "cooldown_remaining_s": round(cooldown_remaining, 1),
            }


# ── Global registry ───────────────────────────────────────────────────────────
# One registry for the whole app. Both main.py and providers.py use this.

_registry: dict[str, CircuitBreaker] = {}
_registry_lock = threading.Lock()


def get_circuit_breaker(
    service: str,
    failure_threshold: int   = 3,
    cooldown_seconds:  float = 60.0,
) -> CircuitBreaker:
    """Get or create a circuit breaker for a named service."""
    with _registry_lock:
        if service not in _registry:
            _registry[service] = CircuitBreaker(
                service=service,
                failure_threshold=failure_threshold,
                cooldown_seconds=cooldown_seconds,
            )
        return _registry[service]


def reset_circuit_breaker(service: str | None = None) -> list[str]:
    """Reset one or all circuit breakers. Returns list of reset service names."""
    with _registry_lock:
        targets = [service] if service and service in _registry else list(_registry.keys())
        for s in targets:
            _registry[s].reset()
        return targets


def all_circuit_breaker_snapshots() -> list[dict]:
    """Return status of all registered circuit breakers."""
    with _registry_lock:
        return [cb.snapshot() for cb in _registry.values()]
