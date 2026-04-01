"""
backend/library_helpers.py
Phase 6 — Safe main.py split, Step 2: Library + history helper functions.

All functions here were previously inline in main.py (~lines 5182–5660).
main.py imports everything back via:
    from library_helpers import *  # re-export so nothing else breaks

Dependencies: db_helpers, stdlib, app.services.logging_utils.
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


# ── These helpers must match the main.py versions exactly ────────────────────
# They depend on _infer_download_category and _infer_library_display_layout
# which live in main.py (they read globals). We import them at call time to
# avoid circular imports. The import is deferred inside each function body.


def _is_internal_managed_file(path: Path) -> bool:
    """Return True if path is a GRABIX-internal file that should not appear in the library."""
    import main as _main  # deferred — avoids circular import
    return _main._is_internal_managed_file(path)


def _infer_download_category(url: str, title: str, dl_type: str, category: str = "") -> str:
    import main as _main
    return _main._infer_download_category(url, title, dl_type, category)


def _infer_library_display_layout(url: str, title: str, dl_type: str, category: str = "") -> str:
    import main as _main
    return _main._infer_library_display_layout(url, title, dl_type, category)


# ── DB schema helpers ─────────────────────────────────────────────────────────

def migrate_db() -> None:
    """Add columns to the history table if they don't exist yet (schema migration)."""
    try:
        con = get_db_connection()
        cols = [row[1] for row in con.execute("PRAGMA table_info(history)").fetchall()]
        if "tags" not in cols:
            con.execute("ALTER TABLE history ADD COLUMN tags TEXT DEFAULT ''")
        if "category" not in cols:
            con.execute("ALTER TABLE history ADD COLUMN category TEXT DEFAULT ''")
        if "file_size" not in cols:
            con.execute("ALTER TABLE history ADD COLUMN file_size INTEGER DEFAULT 0")
        con.commit()
        con.close()
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
    """Build the full library index — tracked history rows + untracked files on disk."""
    from main import init_db  # deferred
    init_db()
    migrate_db()
    con = get_db_connection()
    rows = con.execute("SELECT * FROM history ORDER BY created_at DESC LIMIT 1000").fetchall()
    tracked_paths: set[str] = set()
    result: list[dict] = []

    for row in rows:
        item = dict(row)
        file_path = str(item.get("file_path") or "").strip()
        exists_on_disk = bool(file_path and Path(file_path).exists() and Path(file_path).is_file())
        if exists_on_disk:
            tracked_paths.add(str(Path(file_path).resolve()))

        stored_size = int(item.get("file_size") or 0)
        actual_size = _get_file_size(file_path) if exists_on_disk else 0
        size_bytes = actual_size or stored_size
        if actual_size and actual_size != stored_size:
            con.execute("UPDATE history SET file_size=? WHERE id=?", (actual_size, item["id"]))

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

    ignored_suffixes = {".part", ".ytdl", ".tmp", ".temp"}
    for path in Path(DOWNLOAD_DIR).rglob("*"):
        if not path.is_file():
            continue
        if _is_internal_managed_file(path):
            continue
        if ".part." in path.name.lower():
            continue
        if any(str(path).lower().endswith(suffix) for suffix in ignored_suffixes):
            continue
        resolved = str(path.resolve())
        if resolved in tracked_paths:
            continue

        file_size  = path.stat().st_size
        dl_type    = _guess_dl_type_from_path(str(path))
        created_at = datetime.fromtimestamp(path.stat().st_mtime).isoformat()
        result.append({
            "id":            f"untracked:{resolved}",
            "url":           "",
            "title":         path.stem,
            "thumbnail":     "",
            "channel":       "",
            "duration":      0,
            "dl_type":       dl_type,
            "file_path":     str(path),
            "status":        "untracked",
            "created_at":    created_at,
            "tags":          "untracked,local",
            "category":      _infer_download_category("", path.stem, dl_type, ""),
            "display_layout": _infer_library_display_layout("", path.stem, dl_type, ""),
            "file_size":     file_size,
            "file_size_label": _format_bytes_int(file_size),
            "file_exists":   True,
            "local_available": True,
            "broken":        False,
            "source_type":   "untracked",
            "library_status": "untracked",
        })

    con.commit()
    con.close()
    return sorted(result, key=lambda item: str(item.get("created_at") or ""), reverse=True)


def _reconcile_library_state() -> dict:
    """Scan history rows, fix missing/restored statuses, backfill sizes."""
    from main import init_db  # deferred
    init_db()
    migrate_db()
    con = get_db_connection()
    rows = con.execute(
        "SELECT id, url, title, dl_type, category, status, file_path, file_size FROM history"
    ).fetchall()
    marked_missing = 0
    restored       = 0
    recategorized  = 0
    resized        = 0

    for row in rows:
        item        = dict(row)
        item_id     = str(item.get("id") or "")
        file_path   = str(item.get("file_path") or "").strip()
        exists      = bool(file_path and Path(file_path).exists() and Path(file_path).is_file())
        cur_status  = str(item.get("status") or "")
        new_status  = cur_status or "done"

        if file_path:
            if exists and cur_status in {"missing", "broken"}:
                new_status = "done"
                restored += 1
            elif not exists and cur_status not in {"missing", "broken"}:
                new_status = "missing"
                marked_missing += 1

        actual_size  = _get_file_size(file_path) if exists else 0
        stored_size  = int(item.get("file_size") or 0)
        if actual_size and actual_size != stored_size:
            con.execute("UPDATE history SET file_size=? WHERE id=?", (actual_size, item_id))
            resized += 1

        inferred_cat = _infer_download_category(
            str(item.get("url") or ""),
            str(item.get("title") or ""),
            str(item.get("dl_type") or ""),
            str(item.get("category") or ""),
        )
        if inferred_cat and inferred_cat != str(item.get("category") or ""):
            con.execute("UPDATE history SET category=? WHERE id=?", (inferred_cat, item_id))
            recategorized += 1

        if new_status != cur_status:
            con.execute("UPDATE history SET status=? WHERE id=?", (new_status, item_id))

    con.commit()
    con.close()

    index   = _build_library_index()
    broken  = sum(1 for i in index if i.get("broken"))
    untracked = sum(1 for i in index if i.get("source_type") == "untracked")
    result = {
        "reconciled":    True,
        "tracked_rows":  len(rows),
        "indexed_items": len(index),
        "marked_missing": marked_missing,
        "restored":      restored,
        "recategorized": recategorized,
        "resized":       resized,
        "broken":        broken,
        "untracked":     untracked,
    }
    log_event(
        library_logger, logging.INFO,
        event="library_reconciled",
        message="Library reconciliation completed.",
        details=result,
    )
    return result
