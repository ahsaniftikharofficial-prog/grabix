"""
shared/types.py — Shared data shapes for GRABIX backend.

These TypedDicts match the actual fields used in engine.py and db_helpers.py.
No internal GRABIX imports — safe to import from anywhere.
"""
from __future__ import annotations

from typing import Any, Optional
from typing import TypedDict


class DownloadRecord(TypedDict, total=False):
    """Full download record as stored in engine._downloads."""
    id: str
    status: str
    url: str
    title: str
    thumbnail: str
    dl_type: str
    quality: str
    audio_format: str
    audio_quality: str
    subtitle_lang: str
    subtitle_format: str
    thumbnail_format: str
    trim_start: str
    trim_end: str
    trim_enabled: bool
    use_cpu: bool
    custom_headers: dict
    force_hls: bool
    category: str
    tags_csv: str
    download_engine: str
    requested_engine: str
    engine_note: str
    percent: float
    speed: str
    eta: str
    downloaded: str
    total: str
    size: str
    file_path: str
    stage_label: str
    can_pause: bool
    error: Optional[str]


class DownloadStatus(TypedDict):
    """Lightweight status snapshot returned to the frontend."""
    id: str
    status: str
    progress: float
    speed: str
    eta: str
    size: str


class ProviderResult(TypedDict):
    """A single resolved streaming source."""
    url: str
    quality: str
    provider: str


class StreamSource(TypedDict):
    """A playable stream with optional subtitles."""
    url: str
    quality: str
    format: str
    subtitles: list


class HealthStatus(TypedDict):
    """Single service health entry."""
    name: str
    status: str
    message: str
    retryable: bool


class RuntimeSnapshot(TypedDict):
    """Point-in-time snapshot of runtime paths and flags."""
    db_path: str
    download_dir: str
    logs_dir: str
    settings_path: str
    is_packaged: bool
