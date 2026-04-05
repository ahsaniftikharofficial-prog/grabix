"""
backend/db_helpers.py
Phase 6 — Safe main.py split, Step 1: Database + format helpers.

All functions here were previously inline in main.py.
main.py imports everything back via:
    from db_helpers import *  # re-export so nothing else breaks

Dependencies: only stdlib + app.services.logging_utils.
"""
import sqlite3
import logging
import json
import os
import re
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

from app.services.logging_utils import get_logger, log_event
from app.services.runtime_config import db_path, default_download_dir, runtime_tools_dir, settings_path

# ── Path constants (single source of truth) ──────────────────────────────────
DOWNLOAD_DIR = str(default_download_dir())
DB_PATH = str(db_path())
SETTINGS_PATH = str(settings_path())

# Ensure download dir exists before any DB or file operations
os.makedirs(DOWNLOAD_DIR, exist_ok=True)
Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
Path(SETTINGS_PATH).parent.mkdir(parents=True, exist_ok=True)

backend_logger   = get_logger("backend")
downloads_logger = get_logger("downloads")
library_logger   = get_logger("library")

# ── DB connection ─────────────────────────────────────────────────────────────

def get_db_connection() -> sqlite3.Connection:
    """Return a new sqlite3 connection with WAL mode, timeout, and row_factory set."""
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    return con


# ── History / download job helpers ───────────────────────────────────────────

def db_insert(row: dict) -> None:
    try:
        con = get_db_connection()
        con.execute(
            """
            INSERT OR REPLACE INTO history
            (id, url, title, thumbnail, channel, duration, dl_type, file_path,
             status, created_at, tags, category, file_size)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["id"],
                row["url"],
                row["title"],
                row["thumbnail"],
                row["channel"],
                row["duration"],
                row["dl_type"],
                row["file_path"],
                row["status"],
                row["created_at"],
                row.get("tags", ""),
                row.get("category", ""),
                row.get("file_size", 0),
            ),
        )
        con.commit()
        con.close()
    except Exception as e:
        log_event(
            backend_logger, logging.ERROR,
            event="history_insert_failed",
            message="History insert failed.",
            details={"error": str(e), "row_id": row.get("id", "")},
        )


def db_update_status(dl_id: str, status: str, file_path: str = "") -> None:
    try:
        con = get_db_connection()
        con.execute(
            "UPDATE history SET status=?, file_path=? WHERE id=?",
            (status, file_path, dl_id),
        )
        con.commit()
        con.close()
    except Exception as e:
        log_event(
            backend_logger, logging.ERROR,
            event="history_status_update_failed",
            message="History status update failed.",
            details={"error": str(e), "download_id": dl_id, "status": status},
        )


def db_upsert_download_job(row: dict) -> None:
    try:
        now = datetime.now().isoformat()
        con = get_db_connection()
        con.execute(
            """
            INSERT INTO download_jobs
            (id, url, title, thumbnail, dl_type, status, created_at, updated_at,
             file_path, partial_file_path, error, percent, speed, eta, downloaded,
             total, size, can_pause, retry_count, failure_code, recoverable,
             download_strategy, params_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                url=excluded.url, title=excluded.title, thumbnail=excluded.thumbnail,
                dl_type=excluded.dl_type, status=excluded.status,
                updated_at=excluded.updated_at, file_path=excluded.file_path,
                partial_file_path=excluded.partial_file_path, error=excluded.error,
                percent=excluded.percent, speed=excluded.speed, eta=excluded.eta,
                downloaded=excluded.downloaded, total=excluded.total, size=excluded.size,
                can_pause=excluded.can_pause, retry_count=excluded.retry_count,
                failure_code=excluded.failure_code, recoverable=excluded.recoverable,
                download_strategy=excluded.download_strategy, params_json=excluded.params_json
            """,
            (
                row["id"],
                row.get("url", ""),
                row.get("title", ""),
                row.get("thumbnail", ""),
                row.get("dl_type", ""),
                row.get("status", "queued"),
                row.get("created_at", now),
                row.get("updated_at", now),
                row.get("file_path", ""),
                row.get("partial_file_path", ""),
                row.get("error", ""),
                float(row.get("percent", 0) or 0),
                row.get("speed", ""),
                row.get("eta", ""),
                row.get("downloaded", ""),
                row.get("total", ""),
                row.get("size", ""),
                1 if row.get("can_pause") else 0,
                int(row.get("retry_count", 0) or 0),
                row.get("failure_code", ""),
                1 if row.get("recoverable") else 0,
                row.get("download_strategy", ""),
                row.get("params_json", "{}"),
            ),
        )
        con.commit()
        con.close()
    except Exception as e:
        log_event(
            backend_logger, logging.ERROR,
            event="download_job_upsert_failed",
            message="Download job persistence failed.",
            details={"error": str(e), "download_id": row.get("id", "")},
        )


def db_delete_download_job(dl_id: str) -> None:
    try:
        con = get_db_connection()
        con.execute("DELETE FROM download_jobs WHERE id=?", (dl_id,))
        con.commit()
        con.close()
    except Exception as e:
        log_event(
            backend_logger, logging.ERROR,
            event="download_job_delete_failed",
            message="Download job deletion failed.",
            details={"error": str(e), "download_id": dl_id},
        )


def db_list_download_jobs() -> list[sqlite3.Row]:
    try:
        con = get_db_connection()
        rows = con.execute(
            "SELECT * FROM download_jobs ORDER BY created_at DESC, updated_at DESC"
        ).fetchall()
        con.close()
        return rows
    except Exception as e:
        log_event(
            backend_logger, logging.ERROR,
            event="download_job_list_failed",
            message="Download job listing failed.",
            details={"error": str(e)},
        )
        return []


# ── Settings ──────────────────────────────────────────────────────────────────

DEFAULT_SETTINGS: dict = {
    "theme": "dark",
    "auto_fetch": True,
    "notifications": True,
    "default_format": "mp4",
    "default_quality": "1080p",
    "default_download_engine": "standard",
    "download_folder": DOWNLOAD_DIR,
    "adult_content_enabled": False,
    "adult_password_hash": "",
    "adult_password_configured": False,
}


def load_settings() -> dict:
    try:
        if os.path.exists(SETTINGS_PATH):
            with open(SETTINGS_PATH, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            return {**DEFAULT_SETTINGS, **data}
    except Exception:
        backup_path = f"{SETTINGS_PATH}.bak"
        try:
            if os.path.exists(backup_path):
                with open(backup_path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                return {**DEFAULT_SETTINGS, **data}
        except Exception:
            pass
    return dict(DEFAULT_SETTINGS)


def save_settings_to_disk(data: dict) -> None:
    target = Path(SETTINGS_PATH)
    backup = Path(f"{SETTINGS_PATH}.bak")
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, indent=2, ensure_ascii=True)
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            delete=False,
            dir=str(target.parent),
            prefix="grabix-settings-",
            suffix=".tmp",
        ) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
            temp_path = Path(handle.name)

        if target.exists():
            shutil.copy2(target, backup)
        temp_path.replace(target)
    except Exception as e:
        log_event(
            backend_logger, logging.ERROR,
            event="settings_save_failed",
            message="Settings save failed.",
            details={"error": str(e)},
        )
        raise


# ── Format / byte utilities ───────────────────────────────────────────────────

def _strip_ansi(s: str) -> str:
    """Remove ANSI terminal color codes from a string."""
    return re.sub(r"\x1b\[[0-9;]*[mGKH]", "", s or "").strip()


def _format_bytes(num: float | int | None) -> str:
    if not num:
        return ""
    value = float(num)
    units = ["B", "KB", "MB", "GB", "TB"]
    idx = 0
    while value >= 1024 and idx < len(units) - 1:
        value /= 1024
        idx += 1
    if idx == 0:
        return f"{int(value)} {units[idx]}"
    return f"{value:.1f} {units[idx]}"


def _format_bytes_int(num: int) -> str:
    if not num:
        return "0 B"
    return _format_bytes(num)


def _format_eta(seconds: float | int | None) -> str:
    if seconds is None or seconds <= 0:
        return ""
    s = int(seconds)
    if s < 60:
        return f"{s}s"
    m, s = divmod(s, 60)
    if m < 60:
        return f"{m}m {s:02d}s"
    h, m = divmod(m, 60)
    return f"{h}h {m:02d}m"


def _sanitize_download_engine(engine: str | None) -> str:
    normalized = str(engine or "").strip().lower()
    return normalized if normalized in {"standard", "aria2"} else "standard"


def _get_file_size(file_path: str) -> int:
    try:
        p = Path(file_path)
        if p.exists() and p.is_file():
            return p.stat().st_size
    except Exception:
        pass
    return 0


def _guess_dl_type_from_path(file_path: str) -> str:
    suffix = Path(file_path).suffix.lower()
    if suffix in {".mp3", ".m4a", ".aac", ".flac", ".wav", ".opus", ".ogg"}:
        return "audio"
    if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return "thumbnail"
    if suffix in {".srt", ".vtt", ".ass", ".ssa", ".sub"}:
        return "subtitle"
    return "video"


# ── Tool detection ─────────────────────────────────────────────────────────────

def _resolve_tool_binary(tool_id: str, names: list[str]) -> str | None:
    for name in names:
        found = shutil.which(name)
        if found:
            return found

    managed_dir = runtime_tools_dir() / tool_id
    if managed_dir.exists():
        for name in names:
            candidates = list(managed_dir.rglob(name))
            if candidates:
                return str(candidates[0])

    bundled_root_raw = str(os.getenv("GRABIX_BUNDLED_RUNTIME_TOOLS_DIR", "")).strip()
    if bundled_root_raw:
        bundled_dir = Path(bundled_root_raw).expanduser() / tool_id
        if bundled_dir.exists():
            for name in names:
                candidates = list(bundled_dir.rglob(name))
                if candidates:
                    return str(candidates[0])

    return None


FFMPEG_PATH = _resolve_tool_binary("ffmpeg", ["ffmpeg.exe", "ffmpeg"])
ARIA2_PATH  = _resolve_tool_binary("aria2", ["aria2c.exe", "aria2c"])


def has_ffmpeg() -> bool:
    global FFMPEG_PATH
    FFMPEG_PATH = _resolve_tool_binary("ffmpeg", ["ffmpeg.exe", "ffmpeg"])
    return FFMPEG_PATH is not None


def has_aria2() -> bool:
    global ARIA2_PATH
    ARIA2_PATH = _resolve_tool_binary("aria2", ["aria2c.exe", "aria2c"])
    return ARIA2_PATH is not None
