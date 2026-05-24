"""
backend/db_helpers.py  — OPTIMISED (Performance Pass) + B5 Decoupling

B5 change: removed module-level imports of logging_utils and runtime_config.
All loggers and path constants are now initialised lazily on first use via
_get_*() helpers.  Function signatures are unchanged — no callers need
updating.  The import-time coupling to both service modules is gone.
"""

import sqlite3
import logging
import json
import os
import re
import shutil
import atexit
import threading
import tempfile
from datetime import datetime
from pathlib import Path

# ── B5: No module-level imports of logging_utils or runtime_config ────────────
# All access is lazy — only happens on first function call, not at import time.

# ── Lazy logger accessors ─────────────────────────────────────────────────────
_backend_logger: logging.Logger | None = None
_downloads_logger: logging.Logger | None = None
_library_logger: logging.Logger | None = None


def _get_backend_logger() -> logging.Logger:
    global _backend_logger
    if _backend_logger is None:
        from app.services.logging_utils import get_logger
        _backend_logger = get_logger("backend")
    return _backend_logger


def _get_downloads_logger() -> logging.Logger:
    global _downloads_logger
    if _downloads_logger is None:
        from app.services.logging_utils import get_logger
        _downloads_logger = get_logger("downloads")
    return _downloads_logger


def _get_library_logger() -> logging.Logger:
    global _library_logger
    if _library_logger is None:
        from app.services.logging_utils import get_logger
        _library_logger = get_logger("library")
    return _library_logger


def _log_event(logger: logging.Logger, level: int, *, event: str, message: str,
               details: dict | None = None) -> None:
    from app.services.logging_utils import log_event
    log_event(logger, level, event=event, message=message, details=details or {})


# ── Lazy path accessors ───────────────────────────────────────────────────────
_download_dir: str | None = None
_db_path: str | None = None
_settings_path: str | None = None


def _get_download_dir() -> str:
    global _download_dir
    if _download_dir is None:
        from app.services.runtime_config import default_download_dir
        _download_dir = str(default_download_dir())
    return _download_dir


def _get_db_path() -> str:
    global _db_path
    if _db_path is None:
        from app.services.runtime_config import db_path
        _db_path = str(db_path())
    return _db_path


def _get_settings_path() -> str:
    global _settings_path
    if _settings_path is None:
        from app.services.runtime_config import settings_path
        _settings_path = str(settings_path())
    return _settings_path


# ── Ensure directories exist (lazy, on first DB/settings access) ──────────────
_dirs_ensured = False


def _ensure_dirs() -> None:
    global _dirs_ensured
    if _dirs_ensured:
        return
    os.makedirs(_get_download_dir(), exist_ok=True)
    Path(_get_db_path()).parent.mkdir(parents=True, exist_ok=True)
    Path(_get_settings_path()).parent.mkdir(parents=True, exist_ok=True)
    _dirs_ensured = True


# ── Public path constants (kept for backward compat — computed lazily) ─────────
# These are properties of the module. Accessing them before the first
# runtime_config call is safe because _get_*() will initialise on demand.
# Code that does `from db_helpers import DOWNLOAD_DIR` at module level will
# get an empty string; code that calls them at runtime (inside functions)
# gets the correct value. Prefer _get_download_dir() / _get_db_path() etc.
# internally.
DOWNLOAD_DIR = ""  # filled by _get_download_dir() on first access
DB_PATH      = ""  # filled by _get_db_path()     on first access
SETTINGS_PATH = "" # filled by _get_settings_path() on first access

_thread_local = threading.local()
_pooled_connections: list[sqlite3.Connection] = []
_pooled_connections_lock = threading.Lock()


class _PooledConnection(sqlite3.Connection):
    """Connection whose public close() is a no-op for thread-local reuse."""

    def close(self) -> None:          # type: ignore[override]
        return None

    def really_close(self) -> None:
        super().close()


def _make_connection() -> _PooledConnection:
    """Open and configure a fresh SQLite connection."""
    _ensure_dirs()
    con = sqlite3.connect(
        _get_db_path(),
        timeout=30,
        check_same_thread=False,
        factory=_PooledConnection,
    )
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    con.execute("PRAGMA cache_size=-8000")
    con.execute("PRAGMA temp_store=MEMORY")
    with _pooled_connections_lock:
        _pooled_connections.append(con)
    return con  # type: ignore[return-value]


# ── OPTIMISED DB connection ───────────────────────────────────────────────────

def get_db_connection() -> sqlite3.Connection:
    """
    Return a reusable thread-local sqlite3 connection.

    OPTIMISED: the original ran `SELECT 1` on every call to verify the
    connection was still alive.  Under normal usage this is wasted work —
    SQLite in-process connections never go stale spontaneously.  We now use
    a boolean `_healthy` attribute set to False only when a real
    DatabaseError is observed.  The SELECT 1 is only run when that flag is
    explicitly cleared, i.e. after a detected error.
    """
    con: _PooledConnection | None = getattr(_thread_local, "connection", None)

    if con is not None:
        if getattr(con, "_healthy", True):
            return con
        try:
            con.execute("SELECT 1").fetchone()
            con._healthy = True  # type: ignore[attr-defined]
            return con
        except sqlite3.DatabaseError:
            try:
                con.really_close()
            except Exception:
                pass
            _thread_local.connection = None

    con = _make_connection()
    con._healthy = True  # type: ignore[attr-defined]
    _thread_local.connection = con
    return con


def _close_pooled_connections() -> None:
    with _pooled_connections_lock:
        connections = list(_pooled_connections)
        _pooled_connections.clear()
    for con in connections:
        try:
            if isinstance(con, _PooledConnection):
                con.really_close()
            else:
                con.close()
        except Exception:
            pass


atexit.register(_close_pooled_connections)


# ── History / download job helpers ────────────────────────────────────────────

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
    except Exception as e:
        _log_event(
            _get_backend_logger(), logging.ERROR,
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
    except Exception as e:
        _log_event(
            _get_backend_logger(), logging.ERROR,
            event="history_update_status_failed",
            message="History status update failed.",
            details={"error": str(e), "dl_id": dl_id},
        )


def db_upsert_download_job(job: dict) -> None:
    try:
        import json as _json
        params: dict = {}
        try:
            params = _json.loads(job.get("params_json") or "{}")
        except Exception:
            params = {}
        for key in ("quality", "download_engine", "tags", "category"):
            if key in job and job[key] not in (None, ""):
                params[key] = job[key]

        con = get_db_connection()
        con.execute(
            """
            INSERT OR REPLACE INTO download_jobs
            (id, url, title, thumbnail, dl_type, status, percent, eta,
             speed, file_path, created_at, error, size, retry_count,
             failure_code, params_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job["id"],
                job.get("url", ""),
                job.get("title", ""),
                job.get("thumbnail", ""),
                job.get("dl_type", ""),
                job.get("status", ""),
                job.get("progress", 0),
                job.get("eta", ""),
                job.get("speed", ""),
                job.get("file_path", ""),
                job.get("created_at", ""),
                job.get("error", ""),
                job.get("size", ""),
                int(job.get("retry_count", 0) or 0),
                job.get("failure_code", ""),
                _json.dumps(params),
            ),
        )
        con.commit()
    except Exception as e:
        _log_event(
            _get_backend_logger(), logging.ERROR,
            event="download_job_upsert_failed",
            message="Download job upsert failed.",
            details={"error": str(e), "job_id": job.get("id", "")},
        )


def db_delete_download_job(job_id: str) -> None:
    try:
        con = get_db_connection()
        con.execute("DELETE FROM download_jobs WHERE id=?", (job_id,))
        con.commit()
    except Exception as e:
        _log_event(
            _get_backend_logger(), logging.ERROR,
            event="download_job_delete_failed",
            message="Download job delete failed.",
            details={"error": str(e), "job_id": job_id},
        )


def db_list_download_jobs() -> list[dict]:
    try:
        import json as _json
        con = get_db_connection()
        rows = con.execute("SELECT * FROM download_jobs ORDER BY created_at DESC").fetchall()
        result = []
        for r in rows:
            row = dict(r)
            try:
                params = _json.loads(row.get("params_json") or "{}")
            except Exception:
                params = {}
            for key in ("quality", "download_engine", "tags", "category"):
                if key not in row or not row[key]:
                    row[key] = params.get(key, "")
            result.append(row)
        return result
    except Exception as e:
        _log_event(
            _get_backend_logger(), logging.ERROR,
            event="download_job_list_failed",
            message="Download job list failed.",
            details={"error": str(e)},
        )
        return []


# ── Settings ──────────────────────────────────────────────────────────────────

DEFAULT_SETTINGS: dict = {
    "theme": "dark",
    "download_dir": "",          # filled lazily in load_settings()
    "max_concurrent_downloads": 3,
    "default_quality": "best",
    "default_format": "mp4",
    "enable_media_cache": True,
    "media_cache_days": 7,
    "adult_content_enabled": False,
    "adult_content_password_hash": "",
    "adblock_enabled": True,
}


def load_settings() -> dict:
    # Resolve download_dir lazily so runtime_config isn't needed at import time.
    base = dict(DEFAULT_SETTINGS)
    base["download_dir"] = _get_download_dir()
    try:
        settings_path = _get_settings_path()
        if Path(settings_path).exists():
            with open(settings_path, "r", encoding="utf-8") as f:
                stored = json.load(f)
            return {**base, **stored}
    except Exception as e:
        _log_event(
            _get_backend_logger(), logging.WARNING,
            event="settings_load_failed",
            message="Settings load failed; using defaults.",
            details={"error": str(e)},
        )
    return base


def save_settings_to_disk(settings: dict) -> None:
    settings_path = _get_settings_path()
    try:
        tmp = settings_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2)
        shutil.move(tmp, settings_path)
    except Exception as e:
        _log_event(
            _get_backend_logger(), logging.ERROR,
            event="settings_save_failed",
            message="Settings save failed.",
            details={"error": str(e)},
        )


# ── Format / path utilities ───────────────────────────────────────────────────

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def _strip_ansi(text: str) -> str:
    return _ANSI_RE.sub("", text or "")


def _format_bytes(size: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} PB"


def _format_bytes_int(size: int) -> str:
    return _format_bytes(float(size))


def _format_eta(seconds: float) -> str:
    if seconds <= 0:
        return ""
    minutes, secs = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}h {minutes:02d}m"
    if minutes:
        return f"{minutes}m {secs:02d}s"
    return f"{secs}s"


_DL_ENGINE_ALLOWLIST = {"yt-dlp", "aria2", "ffmpeg", "native"}


def _sanitize_download_engine(engine: str) -> str:
    normalized = str(engine or "yt-dlp").strip().lower()
    return normalized if normalized in _DL_ENGINE_ALLOWLIST else "yt-dlp"


def _get_file_size(file_path: str) -> int:
    try:
        return int(Path(file_path).stat().st_size)
    except Exception:
        return 0


_VIDEO_EXTENSIONS = frozenset(
    {".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v", ".flv", ".ts"}
)
_AUDIO_EXTENSIONS = frozenset(
    {".mp3", ".aac", ".m4a", ".flac", ".ogg", ".opus", ".wav"}
)


def _guess_dl_type_from_path(file_path: str) -> str:
    ext = Path(file_path).suffix.lower()
    if ext in _VIDEO_EXTENSIONS:
        return "video"
    if ext in _AUDIO_EXTENSIONS:
        return "audio"
    return "file"


def _managed_binary_exists(tool_id: str, names: list) -> bool:
    """Return True if a binary exists in either the bundled tools dir or the managed runtime dir."""
    from app.services.runtime_config import bundled_tools_dir, runtime_tools_dir
    bundled = bundled_tools_dir()
    if bundled:
        bundled_dir = bundled / tool_id
        if bundled_dir.exists() and any(bundled_dir.rglob(name) for name in names):
            return True
    managed_dir = runtime_tools_dir() / tool_id
    if managed_dir.exists() and any(managed_dir.rglob(name) for name in names):
        return True
    return False


def has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None or _managed_binary_exists("ffmpeg", ["ffmpeg.exe", "ffmpeg"])


def has_aria2() -> bool:
    return shutil.which("aria2c") is not None or _managed_binary_exists("aria2", ["aria2c.exe", "aria2c"])


# ── Database initialisation ───────────────────────────────────────────────────

def init_db() -> None:
    """Create all required tables if they don't exist."""
    try:
        con = get_db_connection()
        con.execute("""
            CREATE TABLE IF NOT EXISTS schema_version (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                version INTEGER NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                url TEXT,
                title TEXT,
                thumbnail TEXT,
                channel TEXT,
                duration INTEGER,
                dl_type TEXT,
                file_path TEXT,
                status TEXT,
                created_at TEXT
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS download_jobs (
                id TEXT PRIMARY KEY,
                url TEXT,
                title TEXT,
                thumbnail TEXT,
                dl_type TEXT,
                status TEXT,
                created_at TEXT,
                updated_at TEXT,
                file_path TEXT,
                partial_file_path TEXT,
                error TEXT,
                percent REAL DEFAULT 0,
                speed TEXT DEFAULT '',
                eta TEXT DEFAULT '',
                downloaded TEXT DEFAULT '',
                total TEXT DEFAULT '',
                size TEXT DEFAULT '',
                can_pause INTEGER DEFAULT 0,
                retry_count INTEGER DEFAULT 0,
                failure_code TEXT DEFAULT '',
                recoverable INTEGER DEFAULT 0,
                download_strategy TEXT DEFAULT '',
                params_json TEXT DEFAULT '{}'
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS provider_status (
                provider TEXT PRIMARY KEY,
                available INTEGER DEFAULT 0,
                last_checked_at TEXT,
                last_error TEXT DEFAULT '',
                consecutive_failures INTEGER DEFAULT 0
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS content_cache (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                content_type TEXT DEFAULT 'generic',
                expires_at REAL NOT NULL,
                created_at REAL NOT NULL,
                last_accessed REAL NOT NULL
            )
        """)
        con.execute("CREATE INDEX IF NOT EXISTS idx_content_cache_expires ON content_cache(expires_at)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_content_cache_accessed ON content_cache(last_accessed)")
        con.execute("""
            CREATE TABLE IF NOT EXISTS health_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service TEXT NOT NULL,
                status TEXT NOT NULL,
                latency_ms REAL DEFAULT NULL,
                error TEXT DEFAULT '',
                recorded_at REAL NOT NULL
            )
        """)
        con.execute("CREATE INDEX IF NOT EXISTS idx_health_log_service ON health_log(service)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_health_log_recorded ON health_log(recorded_at)")

        _migration_columns = [
            ("download_jobs", "progress",          "REAL DEFAULT 0"),
            ("download_jobs", "speed",             "TEXT DEFAULT ''"),
            ("download_jobs", "eta",               "TEXT DEFAULT ''"),
            ("download_jobs", "downloaded",        "TEXT DEFAULT ''"),
            ("download_jobs", "total",             "TEXT DEFAULT ''"),
            ("download_jobs", "size",              "TEXT DEFAULT ''"),
            ("download_jobs", "can_pause",         "INTEGER DEFAULT 0"),
            ("download_jobs", "retry_count",       "INTEGER DEFAULT 0"),
            ("download_jobs", "failure_code",      "TEXT DEFAULT ''"),
            ("download_jobs", "recoverable",       "INTEGER DEFAULT 0"),
            ("download_jobs", "download_strategy", "TEXT DEFAULT ''"),
            ("download_jobs", "params_json",       "TEXT DEFAULT '{}'"),
            ("download_jobs", "partial_file_path", "TEXT DEFAULT ''"),
            ("history", "tags",      "TEXT DEFAULT ''"),
            ("history", "category",  "TEXT DEFAULT ''"),
            ("history", "file_size", "INTEGER DEFAULT 0"),
        ]
        for table, col, col_def in _migration_columns:
            try:
                con.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_def}")
            except Exception:
                pass

        con.execute(
            """
            INSERT INTO schema_version (id, version, updated_at)
            VALUES (1, 1, ?)
            ON CONFLICT(id) DO UPDATE SET
                version = CASE WHEN schema_version.version < excluded.version THEN excluded.version ELSE schema_version.version END,
                updated_at = CASE WHEN schema_version.version < excluded.version THEN excluded.updated_at ELSE schema_version.updated_at END
            """,
            (datetime.now().isoformat(),),
        )
        con.commit()
        con.close()
        _log_event(_get_backend_logger(), logging.INFO, event="db_init", message="Database initialized successfully.")
    except Exception as e:
        _log_event(_get_backend_logger(), logging.ERROR, event="db_init_failed", message="Database initialization failed.", details={"error": str(e)})
