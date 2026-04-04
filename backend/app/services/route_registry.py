from __future__ import annotations

from collections.abc import Callable
from typing import Any

_HANDLERS: dict[str, dict[str, Callable[..., Any]]] = {}


def register_route_handlers(namespace: str, **handlers: Callable[..., Any]) -> None:
    bucket = _HANDLERS.setdefault(namespace, {})
    bucket.update(handlers)


def get_route_handler(namespace: str, name: str) -> Callable[..., Any]:
    handler = _HANDLERS.get(namespace, {}).get(name)
    if handler is None:
        raise RuntimeError(f"Route handler '{namespace}.{name}' has not been registered.")
    return handler
