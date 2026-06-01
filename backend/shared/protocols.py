"""
shared/protocols.py — Contracts (interfaces) for GRABIX backend services.

Uses typing.Protocol — NOT ABC, NOT inheritance.
Any class that already has these methods automatically satisfies the protocol.
No rewrites needed in existing code.

No internal GRABIX imports — safe to import from anywhere.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class LoggerProtocol(Protocol):
    """Matches the standard logging.Logger interface used throughout GRABIX."""
    def info(self, msg: str, *args: Any, **kwargs: Any) -> None: ...
    def error(self, msg: str, *args: Any, **kwargs: Any) -> None: ...
    def warning(self, msg: str, *args: Any, **kwargs: Any) -> None: ...
    def debug(self, msg: str, *args: Any, **kwargs: Any) -> None: ...


@runtime_checkable
class ConfigProtocol(Protocol):
    """
    Matches _GrabixConfig from runtime_config.py.
    Files that need config receive this — they never import runtime_config directly.
    """
    def get_download_dir(self) -> Path: ...
    def get_db_path(self) -> Path: ...
    def get_logs_dir(self) -> Path: ...
    def get_settings_path(self) -> Path: ...
    def is_packaged_mode(self) -> bool: ...


@runtime_checkable
class DatabaseProtocol(Protocol):
    """
    Matches the public interface of db_helpers.py.
    Routes and services receive this — they never import db_helpers directly.
    """
    def load_settings(self) -> dict: ...
    def save_settings(self, settings: dict) -> None: ...
    def load_library(self) -> list: ...
    def save_library(self, library: list) -> None: ...


@runtime_checkable
class CacheProtocol(Protocol):
    """
    Matches manga_cache.py and any other async cache implementation.
    Manga providers receive this — they never import manga_cache directly.

    All methods are async to match the SQLite-backed manga_cache implementation.
    The route assembles a MangaCacheAdapter that satisfies this protocol.
    """
    async def get(self, key: str) -> Any: ...
    async def set(self, key: str, value: Any, source: str = "", expires_hours: int = 6) -> None: ...
    async def clear(self, key: str) -> None: ...


@runtime_checkable
class DownloadEngineProtocol(Protocol):
    """Matches the public API surface of downloads/engine.py."""
    def start_download(self, url: str, options: dict) -> str: ...
    def get_status(self, dl_id: str) -> dict: ...
    def list_downloads(self) -> list: ...
    def download_action(self, dl_id: str, action: str) -> dict: ...


@runtime_checkable
class SecurityProtocol(Protocol):
    """Matches security.py public functions."""
    def validate_url(self, url: str) -> bool: ...
    def redact_for_logs(self, data: Any) -> Any: ...


@runtime_checkable
class NetworkPolicyProtocol(Protocol):
    """
    Matches network_policy.py.
    security.py receives this — it never imports network_policy directly.
    The real validate_outbound_target accepts mode= and allowed_hosts= kwargs;
    the protocol covers the minimal contract callers rely on.
    """
    def validate_outbound_target(self, url: str, *, mode: str, allowed_hosts: tuple = ()) -> Any: ...
