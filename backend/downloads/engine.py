"""
downloads/engine.py
The core download engine for GRABIX.

Responsibilities:
- Manage the in-memory download queue (_downloads / _download_controls)
- Run yt-dlp downloads in background threads with real-time progress hooks
- Expose pause / resume / cancel via threading.Event controls
- Persist download records to SQLite via db_helpers
- Recover queued/interrupted jobs on startup
- Expose all functions that app/routes/downloads.py delegates to via _engine
"""

from __future__ import annotations

import json
import logging
import os
import platform
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter

logger = logging.getLogger("downloads.engine")

# ── Shared mutable state (injected by main.py via init()) ────────────────────
_downloads: dict[str, dict] = {}
_download_controls: dict[str, dict] = {}

# ── Lazy imports (avoid circular imports at module load time) ─────────────────
_db_update_status = None
_db_upsert_download_job = None
_db_delete_download_job = None
_db_list_download_jobs = None
_format_bytes = None
_format_eta = None
_has_ffmpeg = None
_has_aria2 = None
_default_download_dir = None
_app_state_root = None
_sanitize_download_engine = None
_runtime_tools_dir = None
_bundled_tools_dir = None
_ffmpeg_status_cache: dict[str, Any] = {"checked_at": 0.0, "value": None}

router = APIRouter()


def init(downloads: dict, download_controls: dict) -> None:
    """Wire the engine to the shared runtime state dicts from main.py."""
    global _downloads, _download_controls
    _downloads = downloads
    _download_controls = download_controls
    _lazy_import()


def _lazy_import() -> None:
    """Pull in helpers that can't be imported at module load time."""
    global _db_update_status, _db_upsert_download_job, _db_delete_download_job
    global _db_list_download_jobs, _format_bytes, _format_eta
    global _has_ffmpeg, _has_aria2, _default_download_dir, _app_state_root
    global _sanitize_download_engine, _runtime_tools_dir, _bundled_tools_dir

    try:
        from db_helpers import (
            db_update_status, db_upsert_download_job, db_delete_download_job,
            db_list_download_jobs, _format_bytes as fmt_bytes, _format_eta as fmt_eta,
            has_ffmpeg, has_aria2, _sanitize_download_engine as san_engine,
        )
        _db_update_status = db_update_status
        _db_upsert_download_job = db_upsert_download_job
        _db_delete_download_job = db_delete_download_job
        _db_list_download_jobs = db_list_download_jobs
        _format_bytes = fmt_bytes
        _format_eta = fmt_eta
        _has_ffmpeg = has_ffmpeg
        _has_aria2 = has_aria2
        _sanitize_download_engine = san_engine
    except Exception as exc:
        logger.warning("db_helpers import failed: %s", exc)

    try:
        from app.services.runtime_config import (
            app_state_root,
            bundled_tools_dir,
            default_download_dir,
            runtime_tools_dir,
        )
        _default_download_dir = default_download_dir
        _app_state_root = app_state_root
        _runtime_tools_dir = runtime_tools_dir
        _bundled_tools_dir = bundled_tools_dir
    except Exception as exc:
        logger.warning("runtime_config import failed: %s", exc)


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


def _resolve_tool_binary(tool_id: str, names: list[str]) -> str | None:
    bundled = _bundled_tools_dir() if _bundled_tools_dir else None
    if bundled:
        bundled_dir = bundled / tool_id
        if bundled_dir.exists():
            for name in names:
                matches = list(bundled_dir.rglob(name))
                if matches:
                    return str(matches[0])

    for name in names:
        found = shutil.which(name)
        if found:
            return found

    runtime_dir = _runtime_tools_dir() if _runtime_tools_dir else None
    if runtime_dir:
        managed_dir = runtime_dir / tool_id
        if managed_dir.exists():
            for name in names:
                matches = list(managed_dir.rglob(name))
                if matches:
                    return str(matches[0])

    return None


def register_handlers() -> None:
    """Called once by main.py at startup. Starts background workers."""
    _lazy_import()
    try:
        from core.download_helpers import _start_auto_retry_failed_worker
        _start_auto_retry_failed_worker()
    except Exception as exc:
        logger.debug("auto-retry worker not started: %s", exc)


# ── Bootstrap / recovery ──────────────────────────────────────────────────────

def ensure_runtime_bootstrap() -> None:
    """Create the download directory and DB tables if needed."""
    _lazy_import()
    try:
        dl_dir = _default_download_dir() if _default_download_dir else Path.home() / "Downloads" / "GRABIX"
        dl_dir.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        logger.warning("Could not create download dir: %s", exc)


def recover_download_jobs() -> None:
    """Restore download records from SQLite so the UI sees history after restart."""
    _lazy_import()
    if not _db_list_download_jobs:
        return
    try:
        rows = _db_list_download_jobs()
        for row in rows:
            dl_id = row.get("id") or row.get("dl_id") or ""
            if not dl_id or dl_id in _downloads:
                continue
            status = row.get("status", "unknown")
            # Mark in-progress jobs as interrupted so auto-retry can pick them up
            if status in ("downloading", "queued", "processing"):
                status = "failed"
                row["failure_code"] = "restart_interrupted"
                row["error"] = "Interrupted by app restart"
                if _db_update_status:
                    _db_update_status(dl_id, status)
            _downloads[dl_id] = {
                "id": dl_id,
                "status": status,
                "url": row.get("url", ""),
                "title": row.get("title", ""),
                "thumbnail": row.get("thumbnail", ""),
                "dl_type": row.get("dl_type", "video"),
                "quality": row.get("quality", "best"),
                "download_engine": row.get("download_engine", "standard"),
                "requested_engine": row.get("download_engine", "standard"),
                "engine_note": "",
                "percent": float(row.get("percent", 0) or 0),
                "speed": row.get("speed", ""),
                "eta": "",
                "downloaded": "",
                "total": row.get("size", ""),
                "size": row.get("size", ""),
                "file_path": row.get("file_path", ""),
                "partial_file_path": "",
                "error": row.get("error", ""),
                "can_pause": False,
                "recoverable": status == "failed" and row.get("failure_code") == "restart_interrupted",
                "failure_code": row.get("failure_code", ""),
                "retry_count": int(row.get("retry_count", 0) or 0),
                "bytes_downloaded": 0,
                "bytes_total": 0,
                "progress_mode": "activity",
                "stage_label": status.title(),
                "variant_label": row.get("quality", ""),
                "aria2_segments": [],
                "aria2_connection_segments": [],
                "category": row.get("category", ""),
                "tags_csv": row.get("tags_csv", ""),
            }
    except Exception as exc:
        logger.warning("recover_download_jobs failed: %s", exc)


# ── URL helpers ───────────────────────────────────────────────────────────────

_DIRECT_MEDIA_EXTS = {
    ".mp4", ".mkv", ".webm", ".avi", ".mov", ".flv", ".ts", ".m2ts",
    ".mpeg", ".mpg", ".wmv", ".3gp", ".mp3", ".aac", ".ogg", ".flac",
    ".wav", ".m4a", ".opus", ".m4v",
}
_DIRECT_SUBTITLE_EXTS = {".srt", ".vtt", ".ass", ".ssa", ".sub", ".sbv"}


def _is_direct_media_url(url: str) -> bool:
    from urllib.parse import urlparse
    path = urlparse(url or "").path.lower().rstrip("/")
    return any(path.endswith(ext) for ext in _DIRECT_MEDIA_EXTS) or ".m3u8" in path


def _is_direct_subtitle_url(url: str) -> bool:
    from urllib.parse import urlparse
    path = urlparse(url or "").path.lower().rstrip("/")
    return any(path.endswith(ext) for ext in _DIRECT_SUBTITLE_EXTS)


# ── DB persistence ────────────────────────────────────────────────────────────

def _persist_download_record(dl_id: str, force: bool = False) -> None:
    if not _db_upsert_download_job:
        return
    item = _downloads.get(dl_id)
    if not item:
        return
    try:
        import time as _time
        _db_upsert_download_job({
            "id": dl_id,
            "url": item.get("url", ""),
            "title": item.get("title", ""),
            "thumbnail": item.get("thumbnail", ""),
            "dl_type": item.get("dl_type", "video"),
            "status": item.get("status", "queued"),
            "progress": item.get("percent", 0),
            "eta": item.get("eta", ""),
            "speed": item.get("speed", ""),
            "file_path": item.get("file_path", ""),
            "created_at": item.get("created_at", _time.strftime("%Y-%m-%d %H:%M:%S")),
            "error": item.get("error", ""),
            "tags": item.get("tags_csv", ""),
            "category": item.get("category", ""),
        })
    except Exception as exc:
        logger.debug("_persist_download_record failed for %s: %s", dl_id, exc)


# ── Thread management ─────────────────────────────────────────────────────────

def _start_download_thread(dl_id: str) -> None:
    """Spawn a background thread to run the download for the given dl_id."""
    if dl_id not in _downloads:
        return

    # Ensure fresh controls exist
    if dl_id not in _download_controls:
        pause_event = threading.Event()
        cancel_event = threading.Event()
        _download_controls[dl_id] = {
            "pause": pause_event,
            "cancel": cancel_event,
            "process": None,       # set by worker once subprocess is running
            "process_kind": None,  # "yt-dlp" | "aria2" | None
        }
    else:
        # Clear stale pause/cancel from previous run
        _download_controls[dl_id]["pause"].clear()
        _download_controls[dl_id]["cancel"].clear()
        _download_controls[dl_id]["process"] = None

    t = threading.Thread(
        target=_download_worker,
        args=(dl_id,),
        daemon=True,
        name=f"download-{dl_id[:8]}",
    )
    t.start()


# ── Download queue entry point ────────────────────────────────────────────────

def start_download(
    url: str,
    title: str = "",
    thumbnail: str = "",
    dl_type: str = "video",
    quality: str = "best",
    audio_format: str = "mp3",
    audio_quality: str = "192",
    subtitle_lang: str = "en",
    thumbnail_format: str = "jpg",
    trim_start: float = 0,
    trim_end: float = 0,
    trim_enabled: bool = False,
    use_cpu: bool = True,
    headers_json: str = "",
    force_hls: bool = False,
    category: str = "",
    tags_csv: str = "",
    download_engine: str = "",
) -> dict:
    """Create a new download record and start the background worker."""
    _lazy_import()

    dl_id = str(uuid.uuid4())
    requested_engine = "aria2" if str(download_engine or "").strip().lower() == "aria2" else "standard"
    engine, engine_note = _pick_engine(
        requested_engine,
        dl_type,
        url=url,
        force_hls=force_hls,
    )

    # Parse custom headers
    custom_headers: dict = {}
    if headers_json:
        try:
            custom_headers = json.loads(headers_json)
        except Exception:
            pass

    record: dict[str, Any] = {
        "id": dl_id,
        "status": "queued",
        "url": url,
        "title": title or _title_from_url(url),
        "thumbnail": thumbnail,
        "dl_type": dl_type,
        "quality": quality,
        "audio_format": audio_format,
        "audio_quality": audio_quality,
        "subtitle_lang": subtitle_lang,
        "thumbnail_format": thumbnail_format,
        "trim_start": trim_start,
        "trim_end": trim_end,
        "trim_enabled": trim_enabled,
        "use_cpu": use_cpu,
        "custom_headers": custom_headers,
        "force_hls": force_hls,
        "category": category,
        "tags_csv": tags_csv,
        "download_engine": engine,
        "requested_engine": requested_engine,
        "engine_note": engine_note,
        "percent": 0.0,
        "speed": "",
        "eta": "",
        "downloaded": "",
        "total": "",
        "size": "",
        "file_path": "",
        "partial_file_path": "",
        "error": "",
        "can_pause": False,
        "recoverable": False,
        "failure_code": "",
        "retry_count": 0,
        "bytes_downloaded": 0,
        "bytes_total": 0,
        "progress_mode": "activity",
        "stage_label": "Queued",
        "variant_label": quality,
        "aria2_segments": [],
        "aria2_connection_segments": [],
    }

    _downloads[dl_id] = record
    _persist_download_record(dl_id)
    _start_download_thread(dl_id)

    return {"task_id": dl_id}


def _pick_engine(requested: str, dl_type: str, *, url: str = "", force_hls: bool = False) -> tuple[str, str]:
    if dl_type in ("subtitle", "thumbnail"):
        return "standard", ""
    if requested == "aria2":
        if force_hls or ".m3u8" in (url or "").lower():
            return "standard", "aria2 only supports direct file downloads. GRABIX used Standard for this stream."
        if not _is_direct_media_url(url):
            return "standard", "aria2 only supports direct file downloads. GRABIX used Standard for this page URL."
        if _has_aria2 and _has_aria2():
            return "aria2", ""
        return "standard", "aria2 is not available. GRABIX used Standard instead."
    return "standard", ""


def _title_from_url(url: str) -> str:
    from urllib.parse import urlparse, unquote
    path = urlparse(url or "").path
    stem = Path(unquote(path)).stem
    return re.sub(r"[_\-]+", " ", stem).strip() or "Download"


# ── The actual download worker ────────────────────────────────────────────────

def _download_worker(dl_id: str) -> None:
    """Runs in a background thread. Performs the download and updates _downloads."""
    item = _downloads.get(dl_id)
    if not item:
        return

    ctrl = _download_controls.get(dl_id, {})
    pause_ev: threading.Event = ctrl.get("pause", threading.Event())
    cancel_ev: threading.Event = ctrl.get("cancel", threading.Event())

    def _mark(status: str, **kwargs):
        if dl_id in _downloads:
            _downloads[dl_id].update({"status": status, **kwargs})
        if _db_update_status:
            try:
                _db_update_status(dl_id, status)
            except Exception:
                pass
        _persist_download_record(dl_id)

    def _abort_check():
        if cancel_ev.is_set():
            raise _CancelledError()

    _mark("downloading", stage_label="Starting…", can_pause=True, progress_mode="activity")

    try:
        engine = item.get("download_engine", "standard")
        dl_type = item.get("dl_type", "video")

        if engine == "aria2" and _has_aria2 and _has_aria2():
            _run_aria2(dl_id, item, pause_ev, cancel_ev)
        elif dl_type == "subtitle" or _is_direct_subtitle_url(item.get("url", "")):
            _run_direct_download(dl_id, item, pause_ev, cancel_ev, expected_type="subtitle")
        elif _is_direct_media_url(item.get("url", "")) and item.get("force_hls") is False:
            _run_direct_download(dl_id, item, pause_ev, cancel_ev, expected_type="media")
        elif dl_type == "thumbnail":
            _run_direct_download(dl_id, item, pause_ev, cancel_ev, expected_type="image")
        else:
            _run_ytdlp(dl_id, item, pause_ev, cancel_ev)

        if not cancel_ev.is_set():
            file_path = _downloads[dl_id].get("file_path", "")
            _mark("done",
                  percent=100.0,
                  speed="",
                  eta="",
                  can_pause=False,
                  progress_mode="determinate",
                  stage_label="Complete",
                  file_path=file_path)

    except _CancelledError:
        _mark("canceled", speed="", eta="", can_pause=False, stage_label="Canceled")
    except Exception as exc:
        logger.warning("Download %s failed: %s", dl_id, exc, exc_info=False)
        partial = _downloads.get(dl_id, {}).get("partial_file_path", "")
        _mark("failed",
              error=str(exc)[:300],
              speed="",
              eta="",
              can_pause=False,
              recoverable=bool(partial),
              failure_code="download_failed",
              stage_label="Failed")


class _CancelledError(Exception):
    pass


# ── yt-dlp download ───────────────────────────────────────────────────────────

def _run_ytdlp(dl_id: str, item: dict, pause_ev: threading.Event, cancel_ev: threading.Event) -> None:
    try:
        import yt_dlp as ytdl
    except ImportError:
        raise RuntimeError("yt-dlp is not installed. Install it with: pip install yt-dlp")

    dl_dir = _get_download_dir()
    quality = item.get("quality", "best")
    dl_type = item.get("dl_type", "video")
    audio_fmt = item.get("audio_format", "mp3")
    audio_quality = item.get("audio_quality", "192")
    use_cpu = item.get("use_cpu", True)
    trim_enabled = item.get("trim_enabled", False)
    trim_start = float(item.get("trim_start") or 0)
    trim_end = float(item.get("trim_end") or 0)
    custom_headers = item.get("custom_headers") or {}
    force_hls = item.get("force_hls", False)
    ffmpeg_path = _resolve_tool_binary("ffmpeg", ["ffmpeg.exe", "ffmpeg"])

    # ── Format selector ───────────────────────────────────────────────────────
    if dl_type == "audio":
        fmt_selector = "bestaudio/best"
    elif not ffmpeg_path:
        if quality in ("best", "source", "auto", ""):
            fmt_selector = "best"
        else:
            height = _quality_label_to_height(quality)
            fmt_selector = f"best[height<={height}][vcodec!=none][acodec!=none]/best"
    elif quality in ("best", "source", "auto", ""):
        fmt_selector = "bestvideo+bestaudio/best"
    else:
        height = _quality_label_to_height(quality)
        fmt_selector = (
            f"bestvideo[height<={height}]+bestaudio/best[height<={height}]/bestvideo+bestaudio/best"
        )

    # ── Output template ───────────────────────────────────────────────────────
    outtmpl = str(dl_dir / "%(title).100s [%(id)s].%(ext)s")

    # ── Postprocessors ────────────────────────────────────────────────────────
    postprocessors = []
    if dl_type == "audio":
        postprocessors.append({
            "key": "FFmpegExtractAudio",
            "preferredcodec": audio_fmt,
            "preferredquality": str(audio_quality),
        })
    if trim_enabled and trim_end > trim_start:
        postprocessors.append({
            "key": "FFmpegVideoRemuxer",
            "preferedformat": "mp4",
        })

    ffmpeg_path = _resolve_tool_binary("ffmpeg", ["ffmpeg.exe", "ffmpeg"])

    # ── Progress hook ─────────────────────────────────────────────────────────
    def _progress_hook(d: dict) -> None:
        status = d.get("status")

        if cancel_ev.is_set():
            raise _CancelledError()

        # Pause: block here until resumed or cancelled
        while pause_ev.is_set():
            if cancel_ev.is_set():
                raise _CancelledError()
            _downloads[dl_id]["status"] = "paused"
            _downloads[dl_id]["stage_label"] = "Paused"
            time.sleep(0.5)

        if dl_id not in _downloads:
            raise _CancelledError()

        if status == "downloading":
            downloaded = int(d.get("downloaded_bytes") or 0)
            total = int(d.get("total_bytes") or d.get("total_bytes_estimate") or 0)
            speed = float(d.get("speed") or 0)
            eta_secs = d.get("eta")
            percent = round(100.0 * downloaded / total, 1) if total > 0 else 0.0

            _downloads[dl_id].update({
                "status": "downloading",
                "percent": percent,
                "bytes_downloaded": downloaded,
                "bytes_total": total,
                "downloaded": _fmt_bytes(downloaded),
                "total": _fmt_bytes(total) if total else "",
                "size": _fmt_bytes(total) if total else "",
                "speed": _fmt_speed(speed),
                "eta": _fmt_eta_secs(eta_secs),
                "can_pause": True,
                "progress_mode": "determinate" if total > 0 else "activity",
                "stage_label": "Downloading",
                "partial_file_path": d.get("filename", "") or d.get("tmpfilename", ""),
            })

        elif status == "finished":
            _downloads[dl_id].update({
                "status": "processing",
                "stage_label": "Processing…",
                "progress_mode": "processing",
                "can_pause": False,
                "percent": 99.0,
                "speed": "",
                "eta": "",
            })

    def _postprocessor_hook(d: dict) -> None:
        if cancel_ev.is_set():
            raise _CancelledError()
        pp_status = d.get("status")
        if pp_status == "started":
            _downloads[dl_id].update({
                "status": "processing",
                "stage_label": f"Processing ({d.get('postprocessor', 'merging')}…)",
                "progress_mode": "processing",
                "can_pause": False,
            })
        elif pp_status == "finished":
            finished_file = d.get("info_dict", {}).get("filepath") or ""
            if finished_file:
                _downloads[dl_id]["file_path"] = finished_file

    # ── yt-dlp options ────────────────────────────────────────────────────────
    opts: dict[str, Any] = {
        "format": fmt_selector,
        "outtmpl": outtmpl,
        "progress_hooks": [_progress_hook],
        "postprocessor_hooks": [_postprocessor_hook],
        "postprocessors": postprocessors,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "no_color": True,
        "concurrent_fragments": 16,          # <-- KEY: parallel fragment downloads
        "http_chunk_size": 10 * 1024 * 1024, # 10 MB chunks for speed
        "retries": 5,
        "fragment_retries": 5,
        "socket_timeout": 30,
        "continuedl": True,                  # resume partial downloads
    }

    if ffmpeg_path:
        opts["ffmpeg_location"] = ffmpeg_path

    if custom_headers:
        opts["http_headers"] = custom_headers

    if force_hls:
        opts["hls_use_mpegts"] = True

    if trim_enabled and trim_end > trim_start and ffmpeg_path:
        opts["external_downloader"] = "ffmpeg"
        opts["external_downloader_args"] = {
            "ffmpeg_i": ["-ss", str(trim_start), "-to", str(trim_end)],
        }

    with ytdl.YoutubeDL(opts) as ydl:
        # Store the ydl object so psutil can find and suspend its subprocess if needed
        if dl_id in _download_controls:
            _download_controls[dl_id]["ydl_ref"] = ydl
        info = ydl.extract_info(item["url"], download=True)
        if info:
            # Try to get final file path
            final_path = info.get("requested_downloads", [{}])[0].get("filepath", "")
            if not final_path:
                final_path = ydl.prepare_filename(info)
            if final_path:
                _downloads[dl_id]["file_path"] = final_path
        if dl_id in _download_controls:
            _download_controls[dl_id]["ydl_ref"] = None


# ── aria2c download ───────────────────────────────────────────────────────────

def _run_aria2(dl_id: str, item: dict, pause_ev: threading.Event, cancel_ev: threading.Event) -> None:
    dl_dir = _get_download_dir()
    url = item["url"]
    title = re.sub(r'[<>:"/\\|?*]', "_", item.get("title", "download")[:80])
    custom_headers = item.get("custom_headers") or {}

    aria2c = _resolve_tool_binary("aria2", ["aria2c.exe", "aria2c"])
    if not aria2c:
        raise RuntimeError("aria2 is not available. Install it from GRABIX Settings or switch to Standard.")

    cmd = [
        aria2c,
        "--dir", str(dl_dir),
        "--out", f"{title}.aria2tmp",
        "--split=16",
        "--max-connection-per-server=16",
        "--min-split-size=1M",
        "--continue=true",
        "--summary-interval=1",
        "--console-log-level=warn",
        url,
    ]
    for k, v in custom_headers.items():
        cmd += ["--header", f"{k}: {v}"]

    _downloads[dl_id].update({
        "can_pause": False,  # aria2 subprocess doesn't support in-process pause
        "progress_mode": "activity",
        "stage_label": "Downloading (aria2)",
    })

    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1,
        **_windows_hidden_subprocess_kwargs(),
    )
    _download_controls[dl_id]["process"] = proc
    _download_controls[dl_id]["process_kind"] = "aria2"

    _re_progress = re.compile(
        r"\[#[0-9a-f]+ (\S+)/(\S+)\((\d+)%\) CN:(\d+) DL:(\S+)"
    )

    for line in (proc.stdout or []):
        if cancel_ev.is_set():
            proc.terminate()
            raise _CancelledError()
        m = _re_progress.search(line)
        if m:
            downloaded_str, total_str, pct, conns, speed_str = m.groups()
            pct_f = float(pct)
            _downloads[dl_id].update({
                "percent": pct_f,
                "downloaded": downloaded_str,
                "total": total_str,
                "speed": speed_str + "/s",
                "progress_mode": "determinate",
                "stage_label": f"Downloading (aria2 ×{conns})",
                "aria2_connection_segments": [{"connections": int(conns)}],
            })

    proc.wait()
    if proc.returncode != 0 and not cancel_ev.is_set():
        raise RuntimeError(f"aria2c exited with code {proc.returncode}")

    # Rename tmp file to final
    tmp = dl_dir / f"{title}.aria2tmp"
    if tmp.exists():
        final = dl_dir / title
        tmp.rename(final)
        _downloads[dl_id]["file_path"] = str(final)


# ── Direct file download (subtitles, thumbnails, direct media URLs) ───────────

def _run_direct_download(
    dl_id: str, item: dict,
    pause_ev: threading.Event, cancel_ev: threading.Event,
    expected_type: str = "media",
) -> None:
    import urllib.request
    from urllib.parse import urlparse

    url = item["url"]
    dl_dir = _get_download_dir()
    custom_headers = item.get("custom_headers") or {}

    parsed = urlparse(url)
    filename = Path(parsed.path).name or "download"
    if not Path(filename).suffix:
        ext_map = {"subtitle": ".srt", "image": ".jpg", "media": ".mp4"}
        filename += ext_map.get(expected_type, ".bin")

    out_path = dl_dir / filename

    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; GRABIX)",
        **custom_headers,
    })

    _downloads[dl_id].update({
        "can_pause": False,
        "progress_mode": "activity",
        "stage_label": "Downloading…",
    })

    CHUNK = 256 * 1024  # 256 KB
    downloaded = 0

    with urllib.request.urlopen(req, timeout=30) as resp:
        total = int(resp.headers.get("Content-Length", 0) or 0)
        with open(out_path, "wb") as f:
            while True:
                if cancel_ev.is_set():
                    raise _CancelledError()
                chunk = resp.read(CHUNK)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                pct = round(100.0 * downloaded / total, 1) if total else 0.0
                _downloads[dl_id].update({
                    "percent": pct,
                    "bytes_downloaded": downloaded,
                    "bytes_total": total,
                    "downloaded": _fmt_bytes(downloaded),
                    "total": _fmt_bytes(total) if total else "",
                    "progress_mode": "determinate" if total else "activity",
                })

    _downloads[dl_id]["file_path"] = str(out_path)
    _downloads[dl_id]["partial_file_path"] = ""


# ── Status & list endpoints ───────────────────────────────────────────────────

def _item_to_status(dl_id: str) -> dict:
    item = _downloads.get(dl_id)
    if not item:
        return {"error": "not found"}
    return {
        "id": dl_id,
        "status": item.get("status", "unknown"),
        "percent": item.get("percent", 0),
        "speed": item.get("speed", ""),
        "eta": item.get("eta", ""),
        "downloaded": item.get("downloaded", ""),
        "total": item.get("total", ""),
        "size": item.get("size", "") or item.get("total", ""),
        "file_path": item.get("file_path", ""),
        "partial_file_path": item.get("partial_file_path", ""),
        "error": item.get("error", ""),
        "can_pause": bool(item.get("can_pause", False)),
        "recoverable": bool(item.get("recoverable", False)),
        "failure_code": item.get("failure_code", ""),
        "retry_count": int(item.get("retry_count", 0) or 0),
        "bytes_downloaded": int(item.get("bytes_downloaded", 0) or 0),
        "bytes_total": int(item.get("bytes_total", 0) or 0),
        "progress_mode": item.get("progress_mode", "activity"),
        "stage_label": item.get("stage_label", ""),
        "variant_label": item.get("variant_label", item.get("quality", "")),
        "download_engine": item.get("download_engine", "standard"),
        "requested_engine": item.get("requested_engine", "standard"),
        "engine_note": item.get("engine_note", ""),
        "aria2_segments": item.get("aria2_segments", []),
        "aria2_connection_segments": item.get("aria2_connection_segments", []),
        "url": item.get("url", ""),
        "title": item.get("title", ""),
        "thumbnail": item.get("thumbnail", ""),
        "dl_type": item.get("dl_type", "video"),
    }


def download_status(dl_id: str) -> dict:
    return _item_to_status(dl_id)


def progress_alias(dl_id: str) -> dict:
    return download_status(dl_id)


def list_downloads() -> list:
    return [_item_to_status(dl_id) for dl_id in list(_downloads.keys())]


# ── Queue actions ─────────────────────────────────────────────────────────────

def _psutil_suspend(proc_obj) -> bool:
    """Suspend a process tree OS-level (works even during ffmpeg postprocessing)."""
    try:
        import psutil
        parent = psutil.Process(proc_obj.pid)
        for child in parent.children(recursive=True):
            try: child.suspend()
            except Exception: pass
        parent.suspend()
        return True
    except Exception:
        return False


def _psutil_resume(proc_obj) -> bool:
    """Resume a suspended process tree."""
    try:
        import psutil
        parent = psutil.Process(proc_obj.pid)
        for child in parent.children(recursive=True):
            try: child.resume()
            except Exception: pass
        parent.resume()
        return True
    except Exception:
        return False


def download_action(dl_id: str, action: str) -> dict:
    item = _downloads.get(dl_id)
    if not item:
        return {"error": "not found"}

    ctrl = _download_controls.get(dl_id, {})
    pause_ev: threading.Event | None = ctrl.get("pause")
    cancel_ev: threading.Event | None = ctrl.get("cancel")
    proc = ctrl.get("process")

    if action == "pause":
        # Tier 1: OS-level suspend (works even during ffmpeg merge phase)
        if proc:
            _psutil_suspend(proc)
        # Tier 2: threading.Event (works during yt-dlp progress hook phase)
        if pause_ev:
            pause_ev.set()
        item["status"] = "paused"
        item["stage_label"] = "Paused"
        item["can_pause"] = False

    elif action == "resume":
        if proc:
            _psutil_resume(proc)
        if pause_ev:
            pause_ev.clear()
        item["status"] = "downloading"
        item["stage_label"] = "Downloading"
        item["can_pause"] = True

    elif action == "cancel":
        if pause_ev:
            pause_ev.clear()  # unblock hook so thread can exit cleanly
        if cancel_ev:
            cancel_ev.set()
        if proc:
            try: _psutil_resume(proc)  # must resume before kill on Windows
            except Exception: pass
            try: proc.terminate()
            except Exception: pass
        item["status"] = "canceling"
        item["stage_label"] = "Canceling…"
        item["can_pause"] = False

    elif action == "retry":
        item.update({
            "status": "queued",
            "percent": 0.0,
            "speed": "",
            "eta": "",
            "downloaded": "",
            "total": "",
            "error": "",
            "can_pause": False,
            "recoverable": False,
            "failure_code": "",
            "stage_label": "Queued",
            "progress_mode": "activity",
        })
        if _db_update_status:
            _db_update_status(dl_id, "queued")
        _start_download_thread(dl_id)

    _persist_download_record(dl_id)
    return {"ok": True, "action": action, "dl_id": dl_id}


def delete_download(dl_id: str) -> dict:
    ctrl = _download_controls.get(dl_id, {})
    cancel_ev: threading.Event | None = ctrl.get("cancel")
    pause_ev: threading.Event | None = ctrl.get("pause")
    if pause_ev:
        pause_ev.clear()
    if cancel_ev:
        cancel_ev.set()
    proc = ctrl.get("process")
    if proc:
        try:
            proc.terminate()
        except Exception:
            pass

    _downloads.pop(dl_id, None)
    _download_controls.pop(dl_id, None)

    if _db_delete_download_job:
        try:
            _db_delete_download_job(dl_id)
        except Exception:
            pass

    return {"ok": True, "deleted": dl_id}


def stop_all_downloads() -> dict:
    ids = list(_downloads.keys())
    for dl_id in ids:
        ctrl = _download_controls.get(dl_id, {})
        pause_ev = ctrl.get("pause")
        cancel_ev = ctrl.get("cancel")
        if pause_ev:
            pause_ev.clear()
        if cancel_ev:
            cancel_ev.set()
        proc = ctrl.get("process")
        if proc:
            try:
                proc.terminate()
            except Exception:
                pass
        if dl_id in _downloads:
            _downloads[dl_id]["status"] = "canceling"
    return {"ok": True, "stopped": len(ids)}


# ── Folder / file reveal ──────────────────────────────────────────────────────

def open_download_folder(path: str = "") -> dict:
    target = path or str(_get_download_dir())
    target_path = Path(target)
    if not target_path.exists():
        target_path = target_path.parent
    _open_in_explorer(str(target_path), select_file=bool(path))
    return {"ok": True}


def open_local_file(path: str) -> dict:
    if not path or not Path(path).exists():
        return {"error": "File not found"}
    try:
        if platform.system() == "Windows":
            os.startfile(path)  # type: ignore[attr-defined]
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
    except Exception as exc:
        return {"error": str(exc)}
    return {"ok": True}


def _open_in_explorer(path: str, select_file: bool = False) -> None:
    try:
        if platform.system() == "Windows":
            if select_file:
                subprocess.Popen(["explorer", "/select,", path])
            else:
                subprocess.Popen(["explorer", path])
        elif platform.system() == "Darwin":
            if select_file:
                subprocess.Popen(["open", "-R", path])
            else:
                subprocess.Popen(["open", path])
        else:
            folder = str(Path(path).parent) if select_file else path
            subprocess.Popen(["xdg-open", folder])
    except Exception as exc:
        logger.debug("open_in_explorer failed: %s", exc)


# ── Runtime dependencies ──────────────────────────────────────────────────────

def get_runtime_dependencies() -> dict:
    deps: dict[str, dict] = {}

    # yt-dlp
    ytdlp_ok = bool(shutil.which("yt-dlp"))
    if not ytdlp_ok:
        try:
            import yt_dlp  # noqa: F401
            ytdlp_ok = True
        except ImportError:
            pass
    deps["yt-dlp"] = {"id": "yt-dlp", "label": "yt-dlp", "available": ytdlp_ok, "job": None}

    # ffmpeg
    ffmpeg_ok = bool(shutil.which("ffmpeg"))
    deps["ffmpeg"] = {"id": "ffmpeg", "label": "FFmpeg", "available": ffmpeg_ok, "job": None}

    # aria2
    aria2_ok = bool(shutil.which("aria2c"))
    deps["aria2"] = {"id": "aria2", "label": "aria2c", "available": aria2_ok, "job": None}

    return {"dependencies": deps}


def install_runtime_dependency(dep_id: str) -> dict:
    """
    Best-effort installer. Tries pip for yt-dlp; for ffmpeg/aria2 tells the user
    to install manually (or use bundled tools directory).
    """
    if dep_id == "yt-dlp":
        def _install():
            result = subprocess.run(
                [sys.executable, "-m", "pip", "install", "--upgrade", "yt-dlp"],
                capture_output=True, text=True,
                **_windows_hidden_subprocess_kwargs(),
            )
            logger.info("yt-dlp install result: %s", result.stdout or result.stderr)
        threading.Thread(target=_install, daemon=True).start()
        return {"ok": True, "message": "Installing yt-dlp in the background…"}

    return {
        "ok": False,
        "message": f"Please install {dep_id} manually and ensure it is on your PATH.",
    }


# ── Formatting helpers ────────────────────────────────────────────────────────

def _fmt_bytes(n: int | float) -> str:
    if _format_bytes:
        try:
            return _format_bytes(int(n))
        except Exception:
            pass
    n = int(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n //= 1024
    return f"{n} PB"


def _fmt_eta_secs(eta: int | float | None) -> str:
    if eta is None:
        return ""
    if _format_eta:
        try:
            return _format_eta(int(eta))
        except Exception:
            pass
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


def _get_download_dir() -> Path:
    try:
        if _default_download_dir:
            d = _default_download_dir()
            d.mkdir(parents=True, exist_ok=True)
            return d
    except Exception:
        pass
    fallback = Path.home() / "Downloads" / "GRABIX"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


# ── Health / diagnostics functions (imported by core/health.py) ───────────────

def _downloads_health() -> dict:
    """Return a _service_payload-shaped dict describing download system health."""
    dl_dir = _get_download_dir()
    try:
        # Check the download directory is writable
        test_file = dl_dir / ".grabix_write_test"
        test_file.touch()
        test_file.unlink()
        writable = True
    except Exception:
        writable = False

    ytdlp_ok = False
    try:
        import yt_dlp  # noqa: F401
        ytdlp_ok = True
    except ImportError:
        ytdlp_ok = bool(shutil.which("yt-dlp"))

    if not writable:
        status = "degraded"
        message = f"Download folder is not writable: {dl_dir}"
    elif not ytdlp_ok:
        status = "degraded"
        message = "yt-dlp is not installed. Downloads will fail."
    else:
        status = "online"
        message = "Download system is ready."

    return {
        "name": "downloads",
        "status": status,
        "message": message,
        "critical": True,
        "details": {
            "download_dir": str(dl_dir),
            "writable": writable,
            "ytdlp_available": ytdlp_ok,
            "active_downloads": sum(
                1 for d in _downloads.values()
                if d.get("status") in {"downloading", "queued", "processing", "paused"}
            ),
        },
    }


def _database_health() -> dict:
    """Return a _service_payload-shaped dict describing database health."""
    try:
        from db_helpers import get_db_connection
        con = get_db_connection()
        con.execute("SELECT 1")
        return {
            "name": "database",
            "status": "online",
            "message": "Database is responding.",
            "critical": True,
            "details": {},
        }
    except Exception as exc:
        return {
            "name": "database",
            "status": "degraded",
            "message": f"Database error: {exc}",
            "critical": True,
            "details": {},
        }


def ffmpeg_status() -> dict:
    """Return FFmpeg availability and path info."""
    cached = _ffmpeg_status_cache.get("value")
    checked_at = float(_ffmpeg_status_cache.get("checked_at") or 0.0)
    now = time.time()
    if cached is not None and (now - checked_at) < 30:
        return dict(cached)

    path = _resolve_tool_binary("ffmpeg", ["ffmpeg.exe", "ffmpeg"])
    available = bool(path)

    version = ""
    if available:
        try:
            result = subprocess.run(
                [path, "-version"], capture_output=True, text=True, timeout=5,
                **_windows_hidden_subprocess_kwargs(),
            )
            first_line = result.stdout.splitlines()[0] if result.stdout else ""
            m = re.search(r"ffmpeg version (\S+)", first_line)
            if m:
                version = m.group(1)
        except Exception:
            pass

    payload = {
        "available": available,
        "path": path or "",
        "version": version,
    }
    _ffmpeg_status_cache["checked_at"] = now
    _ffmpeg_status_cache["value"] = dict(payload)
    return payload


def storage_stats() -> dict:
    """Return disk usage stats for the download directory."""
    dl_dir = _get_download_dir()
    try:
        usage = shutil.disk_usage(dl_dir)
        total_gb = round(usage.total / (1024 ** 3), 2)
        used_gb = round(usage.used / (1024 ** 3), 2)
        free_gb = round(usage.free / (1024 ** 3), 2)
        free_pct = round(100.0 * usage.free / usage.total, 1) if usage.total else 0
        return {
            "download_dir": str(dl_dir),
            "total_gb": total_gb,
            "used_gb": used_gb,
            "free_gb": free_gb,
            "free_percent": free_pct,
            "low_disk": free_pct < 5,
        }
    except Exception as exc:
        return {
            "download_dir": str(dl_dir),
            "error": str(exc),
            "low_disk": False,
        }
