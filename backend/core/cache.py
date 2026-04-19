"""
core/cache.py — Unified SQLite-backed cache for all GRABIX modules.

Replaces TWO separate caching systems that existed before:
  1. _sqlite_cache_get / _sqlite_cache_set in main.py
  2. moviebox_cache dict with manual TTL in main.py

Now there is ONE system. Use it for everything.

PERFORMANCE IMPROVEMENTS over the old system:
  - Connection pool (not a new connection per call)
  - Prepares statements once
  - WAL mode for concurrent reads
  - Batch eviction instead of per-call cleanup
  - LRU access tracking flushed every 60s (not per-access)
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("grabix.cache")

# ── TTL per content type (seconds) ───────────────────────────────────────────
_TTL: dict[str, int] = {
    "generic":  900,      # 15 min
    "anime":   1500,      # 25 min
    "moviebox": 3600,     # 1 hour
    "tmdb":    3600,      # 1 hour
    "health":    30,      # 30 seconds
    "stream":   900,      # 15 min
}
_STALE_GRACE_FACTOR = 2.0   # serve stale for up to 2× TTL while refreshing
_MAX_CACHE_BYTES    = 50 * 1024 * 1024  # 50 MB max SQLite cache
_ACCESS_FLUSH_INTERVAL = 60  # flush LRU access log every 60s

# ── Internal state ────────────────────────────────────────────────────────────
_db_path: Path | None = None
_pool: list[sqlite3.Connection] = []
_pool_lock = threading.Lock()
_pool_size = 4

_access_log: dict[str, float] = {}   # key → last_accessed timestamp
_access_lock = threading.Lock()
_flusher_started = False


# ── Init ──────────────────────────────────────────────────────────────────────

def init_cache(db_path: Path | str) -> None:
    """Call once at startup. Pass the same DB path used by db_helpers."""
    global _db_path
    _db_path = Path(db_path)
    _ensure_schema()
    _start_access_flusher()


def _get_conn() -> sqlite3.Connection:
    """Borrow a connection from the pool (or create one)."""
    with _pool_lock:
        if _pool:
            return _pool.pop()
    conn = sqlite3.connect(str(_db_path), check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-8000")   # 8 MB page cache
    return conn


def _return_conn(conn: sqlite3.Connection) -> None:
    with _pool_lock:
        if len(_pool) < _pool_size:
            _pool.append(conn)
        else:
            conn.close()


def _ensure_schema() -> None:
    conn = _get_conn()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS content_cache (
                key          TEXT PRIMARY KEY,
                value        TEXT NOT NULL,
                content_type TEXT NOT NULL DEFAULT 'generic',
                expires_at   REAL NOT NULL,
                last_accessed REAL NOT NULL,
                created_at   REAL NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cache_expires ON content_cache(expires_at)")
        conn.commit()
    finally:
        _return_conn(conn)


# ── Public API ────────────────────────────────────────────────────────────────

def cache_get(key: str) -> tuple[Any, bool]:
    """
    Returns (value, is_stale).
      value=None, is_stale=False  → miss
      value=data, is_stale=False  → fresh hit
      value=data, is_stale=True   → stale hit (caller should trigger bg refresh)
    """
    if _db_path is None:
        return None, False

    now = time.time()
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT value, expires_at, content_type FROM content_cache WHERE key=?",
            (key,)
        ).fetchone()
    finally:
        _return_conn(conn)

    if row is None:
        return None, False

    expires_at    = float(row["expires_at"])
    content_type  = row["content_type"] or "generic"
    ttl           = _TTL.get(content_type, _TTL["generic"])
    stale_deadline = expires_at + ttl * (_STALE_GRACE_FACTOR - 1.0)

    # Track access for LRU eviction (batched, not per-call DB write)
    with _access_lock:
        _access_log[key] = now

    try:
        value = json.loads(row["value"])
    except (json.JSONDecodeError, TypeError):
        return None, False

    if now <= expires_at:
        return value, False       # fresh
    if now <= stale_deadline:
        return value, True        # stale but usable
    return None, False            # expired beyond grace window


def cache_set(key: str, value: Any, content_type: str = "generic") -> Any:
    """Store value. TTL is determined by content_type."""
    if _db_path is None:
        return value

    now     = time.time()
    ttl     = _TTL.get(content_type, _TTL["generic"])
    expires = now + ttl

    try:
        serialized = json.dumps(value, default=str)
    except (TypeError, ValueError) as exc:
        logger.warning("cache_set: could not serialize value for key=%s: %s", key, exc)
        return value

    conn = _get_conn()
    try:
        conn.execute(
            """INSERT INTO content_cache (key, value, content_type, expires_at, last_accessed, created_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET
                 value=excluded.value,
                 content_type=excluded.content_type,
                 expires_at=excluded.expires_at,
                 last_accessed=excluded.last_accessed""",
            (key, serialized, content_type, expires, now, now)
        )
        conn.commit()
    except Exception as exc:
        logger.debug("cache_set failed for key=%s: %s", key, exc)
    finally:
        _return_conn(conn)

    return value


def cache_delete(key: str) -> None:
    if _db_path is None:
        return
    conn = _get_conn()
    try:
        conn.execute("DELETE FROM content_cache WHERE key=?", (key,))
        conn.commit()
    except Exception as exc:
        logger.debug("cache_delete failed for key=%s: %s", key, exc)
    finally:
        _return_conn(conn)


def cache_delete_expired() -> int:
    """Delete entries that have exceeded even the stale grace window. Returns count."""
    if _db_path is None:
        return 0
    now = time.time()
    conn = _get_conn()
    try:
        cur = conn.execute(
            "DELETE FROM content_cache WHERE expires_at < ?",
            (now - max(_TTL.values()) * _STALE_GRACE_FACTOR,)
        )
        conn.commit()
        deleted = cur.rowcount
    except Exception as exc:
        logger.debug("cache_delete_expired failed: %s", exc)
        deleted = 0
    finally:
        _return_conn(conn)

    # Evict LRU entries if over size budget
    _evict_by_size()
    return deleted


def cache_stats() -> dict:
    """Returns cache size stats for the health/diagnostics endpoint."""
    if _db_path is None:
        return {"total_entries": 0, "total_size_kb": 0}
    conn = _get_conn()
    try:
        total_bytes   = conn.execute("SELECT COALESCE(SUM(LENGTH(value)),0) FROM content_cache").fetchone()[0]
        total_entries = conn.execute("SELECT COUNT(*) FROM content_cache").fetchone()[0]
        rows = conn.execute(
            """SELECT content_type,
                      COUNT(*) as entries,
                      COALESCE(SUM(LENGTH(value)),0) as bytes,
                      MIN(expires_at) as oldest_expires,
                      MAX(expires_at) as newest_expires
               FROM content_cache GROUP BY content_type"""
        ).fetchall()
    finally:
        _return_conn(conn)

    return {
        "total_entries": total_entries,
        "total_size_kb": round(total_bytes / 1024, 1),
        "max_size_kb":   round(_MAX_CACHE_BYTES / 1024, 1),
        "usage_pct":     round(total_bytes / _MAX_CACHE_BYTES * 100, 1),
        "breakdown": [
            {
                "content_type":  r["content_type"],
                "entries":       r["entries"],
                "size_kb":       round(r["bytes"] / 1024, 1),
                "oldest_expires": r["oldest_expires"],
                "newest_expires": r["newest_expires"],
            }
            for r in rows
        ],
    }


# ── LRU eviction ─────────────────────────────────────────────────────────────

def _evict_by_size() -> None:
    """If cache exceeds _MAX_CACHE_BYTES, delete least-recently-used entries."""
    if _db_path is None:
        return
    conn = _get_conn()
    try:
        total_bytes = conn.execute(
            "SELECT COALESCE(SUM(LENGTH(value)),0) FROM content_cache"
        ).fetchone()[0]
        if total_bytes <= _MAX_CACHE_BYTES:
            return
        # Delete oldest-accessed entries until under budget
        conn.execute(
            """DELETE FROM content_cache WHERE key IN (
               SELECT key FROM content_cache ORDER BY last_accessed ASC LIMIT 50)"""
        )
        conn.commit()
    except Exception as exc:
        logger.debug("_evict_by_size failed: %s", exc)
    finally:
        _return_conn(conn)


# ── Access log flusher ────────────────────────────────────────────────────────

def _flush_access_log() -> None:
    with _access_lock:
        if not _access_log:
            return
        snapshot = list(_access_log.items())
        _access_log.clear()

    conn = _get_conn()
    try:
        conn.executemany(
            "UPDATE content_cache SET last_accessed=? WHERE key=?",
            [(ts, k) for k, ts in snapshot],
        )
        conn.commit()
    except Exception as exc:
        logger.debug("_flush_access_log failed: %s", exc)
    finally:
        _return_conn(conn)


def _start_access_flusher() -> None:
    global _flusher_started
    if _flusher_started:
        return
    _flusher_started = True

    def _worker() -> None:
        while True:
            time.sleep(_ACCESS_FLUSH_INTERVAL)
            try:
                _flush_access_log()
                cache_delete_expired()
            except Exception as exc:
                logger.debug("cache flusher error: %s", exc)

    threading.Thread(target=_worker, daemon=True, name="cache-flusher").start()
