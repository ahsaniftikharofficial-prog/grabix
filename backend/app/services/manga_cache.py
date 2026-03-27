import asyncio
import json
import sqlite3
from pathlib import Path

DB_PATH = Path.home() / "Downloads" / "GRABIX" / "grabix.db"


def _db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS manga_cache (
            cache_key TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            source TEXT NOT NULL,
            cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_hours INTEGER DEFAULT 6
        )
        """
    )
    con.commit()
    return con


def _get_cached_sync(cache_key: str) -> dict | None:
    con = _db()
    row = con.execute(
        """
        SELECT cache_key, data, source, cached_at, expires_hours
        FROM manga_cache
        WHERE cache_key = ?
          AND datetime(cached_at, '+' || expires_hours || ' hours') > datetime('now')
        """,
        (cache_key,),
    ).fetchone()
    con.close()
    if not row:
        return None
    payload = dict(row)
    payload["data"] = json.loads(payload["data"])
    return payload


def _set_cached_sync(
    cache_key: str,
    data: dict | list,
    source: str,
    expires_hours: int = 6,
) -> None:
    con = _db()
    con.execute(
        """
        INSERT OR REPLACE INTO manga_cache (cache_key, data, source, cached_at, expires_hours)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
        """,
        (cache_key, json.dumps(data), source, expires_hours),
    )
    con.commit()
    con.close()


def _invalidate_sync(cache_key: str) -> None:
    con = _db()
    con.execute("DELETE FROM manga_cache WHERE cache_key = ?", (cache_key,))
    con.commit()
    con.close()


async def get_cached(cache_key: str) -> dict | None:
    return await asyncio.to_thread(_get_cached_sync, cache_key)


async def set_cached(
    cache_key: str,
    data: dict | list,
    source: str,
    expires_hours: int = 6,
):
    await asyncio.to_thread(_set_cached_sync, cache_key, data, source, expires_hours)


async def invalidate(cache_key: str):
    await asyncio.to_thread(_invalidate_sync, cache_key)
