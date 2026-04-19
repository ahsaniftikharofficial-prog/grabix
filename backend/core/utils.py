"""
core/utils.py — Shared utility functions for all GRABIX backend modules.

Previously these were scattered across:
  - db_helpers.py (_format_bytes, _format_eta, _strip_ansi)
  - main.py (_parse_timecode_to_seconds, _format_bytes calls)

Now there is ONE place. Import from here.
"""
from __future__ import annotations

import re
import math


# ── Formatting ────────────────────────────────────────────────────────────────

def format_bytes(size: float) -> str:
    """Human-readable byte size. '1.23 MB', '456 KB', etc."""
    if not size or size <= 0:
        return ""
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(size) < 1000.0:
            return f"{size:.1f} {unit}" if unit != "B" else f"{int(size)} {unit}"
        size /= 1000.0
    return f"{size:.1f} PB"


def format_bytes_int(size: int) -> str:
    return format_bytes(float(size))


def format_eta(seconds: float | None) -> str:
    """Human-readable ETA. '1h 23m', '45s', etc."""
    if not seconds or seconds <= 0 or math.isnan(seconds) or math.isinf(seconds):
        return ""
    s = int(seconds)
    if s < 60:
        return f"{s}s"
    m = s // 60
    s %= 60
    if m < 60:
        return f"{m}m {s:02d}s"
    h = m // 60
    m %= 60
    return f"{h}h {m:02d}m"


def strip_ansi(text: str) -> str:
    """Remove ANSI escape sequences from yt-dlp progress strings."""
    if not text:
        return text
    return re.sub(r"\x1b\[[0-9;]*[mGKHF]", "", text)


def parse_timecode_to_seconds(value: str) -> float:
    """Parse 'HH:MM:SS.ms' → total seconds. Used for FFmpeg progress."""
    if not value:
        return 0.0
    try:
        parts = value.strip().split(":")
        if len(parts) == 3:
            h, m, s = parts
            return int(h) * 3600 + int(m) * 60 + float(s)
        if len(parts) == 2:
            m, s = parts
            return int(m) * 60 + float(s)
        return float(parts[0])
    except (ValueError, IndexError):
        return 0.0


# ── File / Path helpers ───────────────────────────────────────────────────────

def get_file_size(path: str) -> int:
    """Return file size in bytes, or 0 on error."""
    try:
        from pathlib import Path as _Path
        return _Path(path).stat().st_size
    except OSError:
        return 0


def guess_dl_type_from_path(path: str) -> str:
    """Infer download type from file extension."""
    from pathlib import Path as _Path
    ext = _Path(path).suffix.lower()
    if ext in {".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".ts"}:
        return "video"
    if ext in {".mp3", ".aac", ".m4a", ".flac", ".ogg", ".opus", ".wav"}:
        return "audio"
    if ext in {".srt", ".vtt", ".ass", ".ssa"}:
        return "subtitle"
    if ext in {".jpg", ".jpeg", ".png", ".webp", ".avif"}:
        return "thumbnail"
    return "video"


# ── Sanitization ──────────────────────────────────────────────────────────────

def sanitize_download_engine(value: str | None) -> str:
    """Normalize download engine selection to 'aria2' or '' (standard)."""
    if not value:
        return ""
    clean = str(value).strip().lower()
    return "aria2" if clean == "aria2" else ""


# ── ETA estimate for HLS segment downloads ───────────────────────────────────

def estimate_hls_remaining_seconds(
    completed_segments: int,
    total_segments: int,
    downloaded_bytes: int,
    bytes_per_second: float,
) -> float:
    """Estimate remaining download time for HLS segment downloads."""
    if completed_segments <= 0 or bytes_per_second <= 0:
        return 0.0
    remaining = total_segments - completed_segments
    if remaining <= 0:
        return 0.0
    avg_segment_bytes = downloaded_bytes / completed_segments
    return (remaining * avg_segment_bytes) / bytes_per_second
