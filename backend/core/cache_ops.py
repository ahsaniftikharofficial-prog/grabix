"""
core/cache_ops.py
SQLite-backed content cache with LRU eviction and stale-while-revalidate.
Includes /cache/clear and /cache/stats FastAPI routes.
Extracted from main.py (Phase 2 split).
"""
import asyncio
import json
import logging
import threading
import time

from fastapi import APIRouter, HTTPException

from app.services.logging_utils import get_logger, log_event
from db_helpers import get_db_connection

router = APIRouter()
_backend_logger = get_logger("backend")

# ---------------------------------------------------------------------------
# Event-loop reference — set by main.py after startup so background refreshes
# can schedule coroutines onto the running loop.
# ---------------------------------------------------------------------------
_app_event_loop: asyncio.AbstractEventLoop | None = None


def set_event_loop(loop: asyncio.AbstractEventLoop | None) -> None:
    global _app_event_loop
    _app_event_loop = loop


# ---------------------------------------------------------------------------
# Per-content-type TTLs (seconds)
# ---------------------------------------------------------------------------
_CACHE_TTL: dict[str, int] = {
    "discover":       6 * 3600,   # trending / homepage  → 6 h
    "details":        6 * 3600,   # item details         → 6 h
    "manga_chapters": 12 * 3600,  # manga chapter lists  → 12 h
    "search":         30 * 60,    # search results       → 30 min
    "generic":        15 * 60,    # fallback             → 15 min
    "moviebox":       60 * 15,    # moviebox results     → 15 min
}

# Stale-while-revalidate grace period multiplier.
# Entry within TTL * _CACHE_STALE_GRACE is returned instantly;
# a background task refreshes it silently.
_CACHE_STALE_GRACE = 2.0

# Maximum cache size on disk (50 MB expressed as JSON character count).
_CACHE_MAX_BYTES = 50 * 1024 * 1024

# Background refresh deduplication
_cache_bg_refresh_keys: set[str] = set()
_cache_bg_refresh_lock = threading.Lock()

# Deferred last_accessed flush (written in bulk every 60s)
_cache_access_log: dict[str, float] = {}
_cache_access_lock = threading.Lock()
_CACHE_ACCESS_FLUSH_INTERVAL = 60.0
_cache_access_flusher_started = False


# ---------------------------------------------------------------------------
# Core cache read/write helpers
# ---------------------------------------------------------------------------

def _sqlite_cache_get(key: str) -> tuple[object | None, bool]:
    """
    Returns (value, is_stale).
    value=None  → full cache miss; caller must fetch fresh.
    is_stale=True → stale-but-usable; caller should trigger a background refresh.
    """
    try:
        now = time.time()
        con = get_db_connection()
        row = con.execute(
            "SELECT value, expires_at, content_type FROM content_cache WHERE key=?", (key,)
        ).fetchone()
        if row is None:
            con.close()
            return None, False
        expires_at = float(row["expires_at"])
        content_type = row["content_type"] or "generic"
        ttl = _CACHE_TTL.get(content_type, _CACHE_TTL["generic"])
        stale_deadline = expires_at + ttl * (_CACHE_STALE_GRACE - 1.0)
        with _cache_access_lock:
            _cache_access_log[key] = now
        con.close()
        value = json.loads(row["value"])
        if now <= expires_at:
            return value, False       # fresh hit
        if now <= stale_deadline:
            return value, True        # stale-but-usable hit
        return None, False            # too old → treat as miss
    except Exception as exc:
        log_event(
            _backend_logger, logging.DEBUG,
            event="cache_get_error",
            message="SQLite cache get failed.",
            details={"key": key, "error": str(exc)},
        )
        return None, False


def _sqlite_cache_set(key: str, value: object, content_type: str = "generic") -> object:
    """
    Persist value to the SQLite content_cache table.
    Runs LRU eviction if total cache size exceeds _CACHE_MAX_BYTES.
    Returns value unchanged so callers can do `return _sqlite_cache_set(key, payload)`.
    """
    try:
        ttl = _CACHE_TTL.get(content_type, _CACHE_TTL["generic"])
        now = time.time()
        serialized = json.dumps(value, default=str)
        con = get_db_connection()
        con.execute(
            """
            INSERT INTO content_cache (key, value, content_type, expires_at, created_at, last_accessed)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value=excluded.value,
                content_type=excluded.content_type,
                expires_at=excluded.expires_at,
                created_at=excluded.created_at,
                last_accessed=excluded.last_accessed
            """,
            (key, serialized, content_type, now + ttl, now, now),
        )
        con.commit()
        # LRU eviction: drop oldest entries when over budget
        try:
            total = con.execute(
                "SELECT COALESCE(SUM(LENGTH(value)), 0) FROM content_cache"
            ).fetchone()[0]
            if total > _CACHE_MAX_BYTES:
                to_delete = con.execute(
                    "SELECT key FROM content_cache ORDER BY last_accessed ASC LIMIT 20"
                ).fetchall()
                if to_delete:
                    con.executemany(
                        "DELETE FROM content_cache WHERE key=?",
                        [(r["key"],) for r in to_delete],
                    )
                    con.commit()
                    log_event(
                        _backend_logger, logging.INFO,
                        event="cache_eviction",
                        message=f"Cache LRU eviction removed {len(to_delete)} entries.",
                        details={"total_bytes": total},
                    )
        except Exception as _exc:
            _backend_logger.warning(
                "_sqlite_cache_set LRU eviction failed: %s", _exc, exc_info=False
            )
        con.close()
    except Exception as exc:
        log_event(
            _backend_logger, logging.DEBUG,
            event="cache_set_error",
            message="SQLite cache set failed.",
            details={"key": key, "error": str(exc)},
        )
    return value


def _sqlite_cache_delete_expired() -> int:
    """Delete all entries past their stale deadline. Returns number removed."""
    try:
        now = time.time()
        con = get_db_connection()
        cur = con.execute(
            """
            DELETE FROM content_cache
            WHERE (
                CASE content_type
                    WHEN 'discover'        THEN expires_at + ?
                    WHEN 'details'         THEN expires_at + ?
                    WHEN 'manga_chapters'  THEN expires_at + ?
                    WHEN 'search'          THEN expires_at + ?
                    ELSE                       expires_at + ?
                END
            ) < ?
            """,
            (
                _CACHE_TTL["discover"],
                _CACHE_TTL["details"],
                _CACHE_TTL["manga_chapters"],
                _CACHE_TTL["search"],
                _CACHE_TTL["generic"],
                now,
            ),
        )
        removed = cur.rowcount
        con.commit()
        con.close()
        return removed
    except Exception:
        return 0


def _cache_trigger_bg_refresh(key: str, refresh_coro_factory) -> None:
    """
    Fire a background asyncio task to refresh a stale cache entry.
    Deduplicates: if a refresh for this key is already running, skips.
    refresh_coro_factory is a zero-arg callable that returns a coroutine.
    """
    with _cache_bg_refresh_lock:
        if key in _cache_bg_refresh_keys:
            return
        _cache_bg_refresh_keys.add(key)

    async def _run():
        try:
            await refresh_coro_factory()
        except Exception as exc:
            log_event(
                _backend_logger, logging.DEBUG,
                event="cache_bg_refresh_error",
                message="Background cache refresh failed.",
                details={"key": key, "error": str(exc)},
            )
        finally:
            with _cache_bg_refresh_lock:
                _cache_bg_refresh_keys.discard(key)

    if _app_event_loop and _app_event_loop.is_running():
        asyncio.run_coroutine_threadsafe(_run(), _app_event_loop)
        return

    def _thread_target():
        import asyncio as _asyncio
        loop = _asyncio.new_event_loop()
        _asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(_run())
        finally:
            loop.close()

    t = threading.Thread(
        target=_thread_target, daemon=True, name=f"cache-refresh-{key[:30]}"
    )
    t.start()


# ---------------------------------------------------------------------------
# Deferred last_accessed flush
# ---------------------------------------------------------------------------

def _flush_cache_access_log() -> None:
    with _cache_access_lock:
        if not _cache_access_log:
            return
        snapshot = list(_cache_access_log.items())
        _cache_access_log.clear()
    try:
        con = get_db_connection()
        con.executemany(
            "UPDATE content_cache SET last_accessed=? WHERE key=?",
            [(ts, cache_key) for cache_key, ts in snapshot],
        )
        con.commit()
        con.close()
    except Exception as _exc:
        _backend_logger.warning("_flush_cache_access_log failed: %s", _exc, exc_info=False)


def _start_cache_access_flusher() -> None:
    global _cache_access_flusher_started
    if _cache_access_flusher_started:
        return
    _cache_access_flusher_started = True

    def _worker() -> None:
        while True:
            time.sleep(_CACHE_ACCESS_FLUSH_INTERVAL)
            _flush_cache_access_log()

    threading.Thread(target=_worker, daemon=True, name="cache-access-flusher").start()


# ---------------------------------------------------------------------------
# /cache routes
# ---------------------------------------------------------------------------

@router.post("/cache/clear")
async def cache_clear(content_type: str | None = None):
    """
    Clear the SQLite content cache.
    - content_type=None  → wipe everything
    - content_type=discover|search|details|manga_chapters|generic|moviebox → wipe that type only
    """
    try:
        con = get_db_connection()
        if content_type:
            cur = con.execute(
                "DELETE FROM content_cache WHERE content_type=?", (content_type,)
            )
        else:
            cur = con.execute("DELETE FROM content_cache")
        removed = cur.rowcount
        con.commit()
        con.close()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Cache clear failed: {exc}")

    log_event(
        _backend_logger, logging.INFO,
        event="cache_cleared",
        message="Content cache cleared.",
        details={"content_type": content_type or "all", "removed": removed},
    )
    return {"cleared": removed, "content_type": content_type or "all"}


@router.get("/cache/stats")
async def cache_stats():
    """Return current cache size, entry count, and per-type breakdown."""
    try:
        con = get_db_connection()
        rows = con.execute(
            """
            SELECT content_type,
                   COUNT(*) as entries,
                   COALESCE(SUM(LENGTH(value)), 0) as bytes,
                   MIN(expires_at) as oldest_expires,
                   MAX(expires_at) as newest_expires
            FROM content_cache
            GROUP BY content_type
            """
        ).fetchall()
        total_bytes = con.execute(
            "SELECT COALESCE(SUM(LENGTH(value)), 0) FROM content_cache"
        ).fetchone()[0]
        total_entries = con.execute("SELECT COUNT(*) FROM content_cache").fetchone()[0]
        con.close()
        breakdown = [
            {
                "content_type": r["content_type"],
                "entries": r["entries"],
                "size_kb": round(r["bytes"] / 1024, 1),
                "oldest_expires": r["oldest_expires"],
                "newest_expires": r["newest_expires"],
            }
            for r in rows
        ]
        return {
            "total_entries": total_entries,
            "total_size_kb": round(total_bytes / 1024, 1),
            "max_size_kb": round(_CACHE_MAX_BYTES / 1024, 1),
            "usage_pct": round(total_bytes / _CACHE_MAX_BYTES * 100, 1),
            "breakdown": breakdown,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Cache stats failed: {exc}")
