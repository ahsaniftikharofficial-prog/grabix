"""
core/state.py — Typed models for download state.

Replaces the two untyped global dicts:
    downloads: dict = runtime_state.downloads
    download_controls: dict = runtime_state.download_controls

Using @dataclass means Python catches field typos at parse time.
No more silent bugs from `downloads[id]["stauts"]` instead of `"status"`.

USAGE:
    from core.state import DownloadJob, DownloadControls, create_download_job

    job = create_download_job(dl_id="abc123", title="My Video", params={...})
    job.status = "downloading"
    job.percent = 42.5
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


# ── Download job (replaces downloads[dl_id] dict) ─────────────────────────────

@dataclass
class DownloadJob:
    # Identity
    id:               str
    title:            str         = ""
    thumbnail:        str         = ""

    # State
    status:           str         = "queued"   # queued | downloading | processing | done | failed | canceled
    percent:          float       = 0.0
    speed:            str         = ""
    eta:              str         = ""
    downloaded:       str         = ""
    total:            str         = ""
    size:             str         = ""
    bytes_downloaded: int         = 0
    bytes_total:      int         = 0
    progress_mode:    str         = "activity"  # activity | determinate | processing
    stage_label:      str         = "Queued"

    # File paths
    file_path:        str         = ""
    partial_file_path: str        = ""
    folder:           str         = ""

    # Error / retry
    error:            str         = ""
    failure_code:     str         = ""
    recoverable:      bool        = False
    retry_count:      int         = 0

    # Capabilities
    can_pause:        bool        = False

    # Engine
    download_strategy:          str  = ""
    download_engine:            str  = "standard"
    download_engine_requested:  str  = ""
    engine_note:                str  = ""

    # Misc
    variant_label:    str         = ""
    created_at:       str         = field(default_factory=lambda: datetime.now().isoformat())
    params:           dict        = field(default_factory=dict)

    # Internal (not sent to frontend)
    _params_json_cache: str       = field(default="", repr=False)
    _last_persist_at:   float     = field(default=0.0, repr=False)

    def to_public_dict(self) -> dict:
        """Return the dict the frontend receives. Excludes internal fields."""
        return {
            "id":               self.id,
            "url":              self.params.get("url", ""),
            "status":           self.status,
            "percent":          self.percent,
            "speed":            self.speed,
            "eta":              self.eta,
            "downloaded":       self.downloaded,
            "total":            self.total,
            "size":             self.size,
            "bytes_downloaded": self.bytes_downloaded,
            "bytes_total":      self.bytes_total,
            "progress_mode":    self.progress_mode,
            "stage_label":      self.stage_label,
            "title":            self.title,
            "thumbnail":        self.thumbnail,
            "file_path":        self.file_path,
            "partial_file_path": self.partial_file_path,
            "folder":           self.folder,
            "error":            self.error,
            "failure_code":     self.failure_code,
            "recoverable":      self.recoverable,
            "retry_count":      self.retry_count,
            "can_pause":        self.can_pause,
            "download_strategy": self.download_strategy,
            "download_engine":   self.download_engine,
            "engine_note":       self.engine_note,
            "variant_label":    self.variant_label,
            "created_at":       self.created_at,
            "dl_type":          self.params.get("dl_type", ""),
            "category":         self.params.get("category", ""),
        }

    def update(self, **kwargs: Any) -> None:
        """Convenience method to update multiple fields at once.
        Mirrors the old dict.update() call pattern.
        Unknown keys raise AttributeError so typos are caught immediately.
        """
        for key, value in kwargs.items():
            if not hasattr(self, key):
                raise AttributeError(
                    f"DownloadJob has no field '{key}'. "
                    f"Check for typos (old code used untyped dicts)."
                )
            setattr(self, key, value)


# ── Download controls (replaces download_controls[dl_id] dict) ────────────────

@dataclass
class DownloadControls:
    pause:        threading.Event  = field(default_factory=threading.Event)
    cancel:       threading.Event  = field(default_factory=threading.Event)
    thread:       threading.Thread | None = None
    process:      Any             = None   # subprocess.Popen or None
    process_kind: str             = ""     # "ffmpeg" | "aria2" | ""
    aria2_rpc_port: int           = 0
    aria2_gid:    str             = ""


# ── Registry: typed replacement for the global dicts ─────────────────────────

class DownloadRegistry:
    """
    Thread-safe registry of all active/queued download jobs.
    Replaces the two module-level global dicts in main.py.
    """

    def __init__(self) -> None:
        self._jobs:     dict[str, DownloadJob]     = {}
        self._controls: dict[str, DownloadControls] = {}
        self._lock      = threading.Lock()

    def add(self, job: DownloadJob, controls: DownloadControls) -> None:
        with self._lock:
            self._jobs[job.id]     = job
            self._controls[job.id] = controls

    def get_job(self, dl_id: str) -> DownloadJob | None:
        return self._jobs.get(dl_id)

    def get_controls(self, dl_id: str) -> DownloadControls | None:
        return self._controls.get(dl_id)

    def remove(self, dl_id: str) -> None:
        with self._lock:
            self._jobs.pop(dl_id, None)
            self._controls.pop(dl_id, None)

    def all_jobs(self) -> list[DownloadJob]:
        return list(self._jobs.values())

    def public_list(self) -> list[dict]:
        return [job.to_public_dict() for job in self._jobs.values()]

    def __contains__(self, dl_id: str) -> bool:
        return dl_id in self._jobs

    def __len__(self) -> int:
        return len(self._jobs)


# ── Factory functions ─────────────────────────────────────────────────────────

def create_download_job(
    dl_id: str,
    title: str = "",
    params: dict | None = None,
    folder: str = "",
) -> DownloadJob:
    """
    Factory: create a DownloadJob from raw params dict.
    Replaces the _create_download_record() function in main.py.
    """
    import json
    from db_helpers import _format_bytes   # keep using existing util until utils.py migration
    p = params or {}
    estimated_bytes = int(p.get("estimated_total_bytes") or 0)

    job = DownloadJob(
        id=dl_id,
        title=title or "",
        thumbnail=p.get("thumbnail", ""),
        status="queued",
        bytes_total=estimated_bytes,
        total=_format_bytes(estimated_bytes) if estimated_bytes else "",
        size=_format_bytes(estimated_bytes) if estimated_bytes else "",
        progress_mode="determinate" if estimated_bytes > 0 else "activity",
        folder=folder,
        can_pause=bool(p.get("can_pause", False)),
        variant_label=str(p.get("variant_label") or ""),
        params=p,
        _params_json_cache=json.dumps(p),
    )
    return job


def create_download_controls() -> DownloadControls:
    """Factory: create fresh controls for a new download."""
    return DownloadControls()
