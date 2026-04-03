import copy
import threading
from dataclasses import dataclass, field
from typing import Any


@dataclass
class RuntimeStateRegistry:
    downloads: dict[str, dict[str, Any]] = field(default_factory=dict)
    download_controls: dict[str, dict[str, Any]] = field(default_factory=dict)
    stream_extract_cache: dict[str, tuple[float, dict[str, Any]]] = field(default_factory=dict)
    anime_resolve_cache: dict[str, tuple[float, dict[str, Any]]] = field(default_factory=dict)
    dependency_install_jobs: dict[str, dict[str, Any]] = field(default_factory=dict)
    adult_unlock_attempts: dict[str, list[float]] = field(default_factory=dict)
    _lock: threading.RLock = field(default_factory=threading.RLock)

    def snapshot_download(self, dl_id: str) -> dict[str, Any] | None:
        with self._lock:
            item = self.downloads.get(dl_id)
            return copy.deepcopy(item) if item is not None else None

    def snapshot_downloads(self) -> list[dict[str, Any]]:
        with self._lock:
            return [copy.deepcopy(item) for item in self.downloads.values()]

    def snapshot_dependency_job(self, dep_id: str) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self.dependency_install_jobs.get(dep_id) or {})

    def set_dependency_job(self, dep_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self.dependency_install_jobs[dep_id] = payload
            return copy.deepcopy(payload)
