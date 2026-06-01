"""
downloads/utils.py
Pure utility functions extracted from engine.py.

These functions have zero dependency on engine state, download dicts,
or injected callbacks. Safe to import from anywhere.
"""
from __future__ import annotations

import platform
import re
import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

# ── Direct-URL detection constants ───────────────────────────────────────────

DIRECT_MEDIA_EXTS = {
    ".mp4", ".mkv", ".webm", ".avi", ".mov", ".flv", ".ts", ".m2ts",
    ".mpeg", ".mpg", ".wmv", ".3gp", ".mp3", ".aac", ".ogg", ".flac",
    ".wav", ".m4a", ".opus", ".m4v",
}
DIRECT_SUBTITLE_EXTS = {".srt", ".vtt", ".ass", ".ssa", ".sub", ".sbv"}


# ── URL helpers ───────────────────────────────────────────────────────────────

def _is_direct_media_url(url: str) -> bool:
    path = urlparse(url or "").path.lower().rstrip("/")
    return any(path.endswith(ext) for ext in DIRECT_MEDIA_EXTS) or ".m3u8" in path


def _is_direct_subtitle_url(url: str) -> bool:
    path = urlparse(url or "").path.lower().rstrip("/")
    return any(path.endswith(ext) for ext in DIRECT_SUBTITLE_EXTS)


def _title_from_url(url: str) -> str:
    path = urlparse(url or "").path
    stem = Path(unquote(path)).stem
    return re.sub(r"[_\-]+", " ", stem).strip() or "Download"


# ── Formatting helpers ────────────────────────────────────────────────────────

def _fmt_bytes(n: int | float) -> str:
    n = int(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n //= 1024
    return f"{n} PB"


def _fmt_eta_secs(eta: int | float | None) -> str:
    if eta is None:
        return ""
    eta = int(eta)
    if eta <= 0:
        return ""
    if eta < 60:
        return f"{eta}s"
    if eta < 3600:
        return f"{eta // 60}m {eta % 60}s"
    return f"{eta // 3600}h {(eta % 3600) // 60}m"


def _fmt_speed(speed: float) -> str:
    if not speed or speed <= 0:
        return ""
    return _fmt_bytes(speed) + "/s"


def _quality_label_to_height(label: str) -> int:
    m = re.search(r"(\d{3,4})p", label.lower())
    if m:
        return int(m.group(1))
    mapping = {"4k": 2160, "2k": 1440, "hd": 1080, "sd": 480}
    return mapping.get(label.lower(), 1080)


# ── Subprocess helpers ────────────────────────────────────────────────────────

def _windows_hidden_subprocess_kwargs() -> dict[str, Any]:
    if platform.system() != "Windows":
        return {}

    creationflags = 0
    startupinfo = None
    try:
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = 0
    except Exception:
        startupinfo = None

    return {
        "creationflags": creationflags,
        "startupinfo": startupinfo,
    }
