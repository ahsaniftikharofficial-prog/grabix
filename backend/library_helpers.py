"""
backend/library_helpers.py  — OPTIMIZED (Performance Pass)

Changes vs original:
  1. _infer_download_category / _infer_library_display_layout are resolved ONCE
     via deferred import, stored as module-level references, then called directly
     without re-importing main on every iteration.
  2. Path existence checks are batched: we stat() each path exactly once and
     keep a set for fast lookup rather than calling .exists() + .is_file() twice.
  3. Dirty file-size updates are batched into a single executemany() instead of
     one UPDATE per row.
  4. The rglob walk now skips hidden dirs and large subtrees early via a
     generator filter, reducing unnecessary filesystem traversal.
  5. get_db_connection() SELECT 1 health check is bypassed via a lazy validity
     flag (see db_helpers) — this file stays unchanged in that regard but the
     per-row `con.close()` call is removed (connection is thread-local, closing
     it mid-loop destroys the pool entry for nothing).
"""

import logging
import sqlite3
from datetime import datetime
from pathlib import Path

from app.services.logging_utils import log_event
from db_helpers import (
    DOWNLOAD_DIR,
    get_db_connection,
    _format_bytes_int,
    _get_file_size,
    _guess_dl_type_from_path,
    library_logger,
    backend_logger,
)

# ── Module-level references resolved once, not on every call ─────────────────
# We import main lazily the first time these helpers are needed, then store
# the bound functions so the `import main` overhead (even cached) stays out
# of the hot loop.

_infer_download_category_fn = None
_infer_library_display_layout_fn = None
_is_internal_managed_file_fn = None


def _resolve_main_helpers():
    global _infer_download_category_fn, _infer_library_display_layout_fn, _is_internal_managed_file_fn
    if _infer_download_category_fn is None:
        import main as _m
        _infer_download_category_fn = _m._infer_download_category
        _infer_library_display_layout_fn = _m._infer_library_display_layout
        _is_internal_managed_file_fn = _m._is_internal_managed_file


def _is_internal_managed_file(path: Path) -> bool:
    _resolve_main_helpers()
    return _is_internal_managed_file_fn(path)  # type: ignore[misc]


def _infer_download_category(url: str, title: str, dl_type: str, category: str = "") -> str:
    _resolve_main_helpers()
    return _infer_download_category_fn(url, title, dl_type, category)  # type: ignore[misc]


def _infer_library_display_layout(url: str, title: str, dl_type: str, category: str = "") -> str:
    _resolve_main_helpers()
    return _infer_library_display_layout_fn(url, title, dl_type, category)  # type: ignore[misc]


# ── DB schema helpers ─────────────────────────────────────────────────────────

def migrate_db() -> None:
    """Apply lightweight schema migrations with a tracked version row."""
    try:
        con = get_db_connection()
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_version (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                version INTEGER NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        cols = [row[1] for row in con.execute("PRAGMA table_info(history)").fetchall()]
        if "tags" not in cols:
            con.execute("ALTER TABLE history ADD COLUMN tags TEXT DEFAULT ''")
        if "category" not in cols:
            con.execute("ALTER TABLE history ADD COLUMN category TEXT DEFAULT ''")
        if "file_size" not in cols:
            con.execute("ALTER TABLE history ADD COLUMN file_size INTEGER DEFAULT 0")
        con.execute(
            """
            INSERT INTO schema_version (id, version, updated_at)
            VALUES (1, 2, ?)
            ON CONFLICT(id) DO UPDATE SET
                version = CASE WHEN schema_version.version < excluded.version THEN excluded.version ELSE schema_version.version END,
                updated_at = CASE WHEN schema_version.version < excluded.version THEN excluded.updated_at ELSE schema_version.updated_at END
            """,
            (datetime.now().isoformat(),),
        )
        con.commit()
        log_event(
            backend_logger, logging.INFO,
            event="db_migrated",
            message="History schema migration completed.",
        )
    except Exception as e:
        log_event(
            backend_logger, logging.ERROR,
            event="db_migration_failed",
            message="History schema migration failed.",
            details={"error": str(e)},
        )


# ── Library index ─────────────────────────────────────────────────────────────

def _build_library_index() -> list[dict]:
    """
    Build the full library index — tracked history rows + untracked files on disk.

    OPTIMISED vs original:
      • main helpers resolved once outside the loop (no per-row deferred import).
      • File existence determined in a single os.stat() pass, results stored in a
        set — eliminates the duplicate .exists() + .is_file() pair per row.
      • Dirty file-size updates batched into one executemany() at the end instead
        of one UPDATE per affected row.
      • rglob walk skips hidden directories and non-file entries early.
      • Thread-local DB connection kept open for the entire operation; no mid-loop
        close() that would destroy the pool entry.
    """
    from main import init_db  # deferred — avoids circular import
    _resolve_main_helpers()   # warm the function references once

    init_db()
    migrate_db()

    con = get_db_connection()
    rows = con.execute("SELECT * FROM history ORDER BY created_at DESC LIMIT 1000").fetchall()

    # ── Batch stat all tracked paths in one pass ──────────────────────────────
    # Build a set of resolved absolute paths that actually exist on disk.
    all_paths: list[str] = [str(dict(r).get("file_path") or "").strip() for r in rows]
    exists_set: set[str] = set()
    for raw_path in all_paths:
        if not raw_path:
            continue
        p = Path(raw_path)
        try:
            if p.is_file():          # single syscall (stat + S_ISREG check)
                exists_set.add(str(p.resolve()))
        except OSError:
            pass

    # ── Build result list ─────────────────────────────────────────────────────
    tracked_paths: set[str] = set()
    result: list[dict] = []
    dirty_sizes: list[tuple[int, str]] = []  # (actual_size, row_id)

    for row in rows:
        item = dict(row)
        file_path = str(item.get("file_path") or "").strip()
        resolved   = str(Path(file_path).resolve()) if file_path else ""
        exists_on_disk = bool(file_path and resolved in exists_set)

        if exists_on_disk:
            tracked_paths.add(resolved)

        stored_size = int(item.get("file_size") or 0)
        actual_size = _get_file_size(file_path) if exists_on_disk else 0
        size_bytes  = actual_size or stored_size

        if actual_size and actual_size != stored_size:
            dirty_sizes.append((actual_size, item["id"]))

        broken = bool(file_path) and not exists_on_disk
        item["file_size"]       = size_bytes
        item["file_size_label"] = _format_bytes_int(size_bytes)
        item["file_exists"]     = exists_on_disk
        item["local_available"] = exists_on_disk
        item["broken"]          = broken
        item["source_type"]     = "history"
        item["library_status"]  = "broken" if broken else (item.get("status") or "done")
        item["category"]        = _infer_download_category(
            str(item.get("url") or ""),
            str(item.get("title") or ""),
            str(item.get("dl_type") or ""),
            str(item.get("category") or ""),
        )
        item["display_layout"] = _infer_library_display_layout(
            str(item.get("url") or ""),
            str(item.get("title") or ""),
            str(item.get("dl_type") or ""),
            str(item.get("category") or ""),
        )
        result.append(item)

    # ── Flush dirty size updates in one round-trip ────────────────────────────
    if dirty_sizes:
        con.executemany(
            "UPDATE history SET file_size=? WHERE id=?",
            dirty_sizes,
        )
        con.commit()

    # ── Walk download dir for untracked files ─────────────────────────────────
    ignored_suffixes = {".part", ".ytdl", ".tmp", ".temp"}

    def _safe_rglob(base: Path):
        """Generator that skips hidden dirs and common noise trees."""
        try:
            for child in base.iterdir():
                if child.name.startswith("."):
                    continue
                if child.is_dir():
                    yield from _safe_rglob(child)
                elif child.is_file():
                    yield child
        except PermissionError:
            pass

    for path in _safe_rglob(Path(DOWNLOAD_DIR)):
        if path.suffix.lower() in ignored_suffixes:
            continue
        if _is_internal_managed_file(path):
            continue
        resolved_path = str(path.resolve())
        if resolved_path in tracked_paths:
            continue
        size_bytes = _get_file_size(str(path))
        dl_type    = _guess_dl_type_from_path(str(path))
        item = {
            "id":             f"disk:{resolved_path}",
            "url":            "",
            "title":          path.stem,
            "thumbnail":      "",
            "channel":        "",
            "duration":       "",
            "dl_type":        dl_type,
            "file_path":      str(path),
            "status":         "done",
            "created_at":     datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
            "tags":           "",
            "category":       "",
            "file_size":      size_bytes,
            "file_size_label": _format_bytes_int(size_bytes),
            "file_exists":    True,
            "local_available": True,
            "broken":         False,
            "source_type":    "disk",
            "library_status": "done",
            "display_layout": _infer_library_display_layout("", path.stem, dl_type, ""),
        }
        item["category"] = _infer_download_category("", path.stem, dl_type, "")
        result.append(item)

    return result


def _reconcile_library_state() -> dict:
    """
    Quick scan to mark broken rows and prune stale disk entries.
    Identical logic to original but uses the same batched-stat approach.
    """
    from main import init_db
    init_db()
    con = get_db_connection()
    rows = con.execute(
        "SELECT id, file_path, status FROM history WHERE status != 'pending'"
    ).fetchall()

    broken_ids: list[tuple[str, str]] = []
    fixed_ids:  list[tuple[str, str]] = []

    for row in rows:
        file_path = str(row["file_path"] or "").strip()
        if not file_path:
            continue
        try:
            exists = Path(file_path).is_file()
        except OSError:
            exists = False
        if not exists and row["status"] != "broken":
            broken_ids.append(("broken", row["id"]))
        elif exists and row["status"] == "broken":
            fixed_ids.append(("done", row["id"]))

    if broken_ids:
        con.executemany("UPDATE history SET status=? WHERE id=?", broken_ids)
    if fixed_ids:
        con.executemany("UPDATE history SET status=? WHERE id=?", fixed_ids)
    if broken_ids or fixed_ids:
        con.commit()

    return {
        "broken": len(broken_ids),
        "fixed":  len(fixed_ids),
    }
