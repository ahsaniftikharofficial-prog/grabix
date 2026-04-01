"""
backend/tests/test_phase6_split.py
Phase 6 — Integration tests for the main.py split.

Run with: cd backend && python -m pytest tests/test_phase6_split.py -v

Each test is intentionally short (~10 lines) — just enough to confirm the
extracted module loads and its core contract holds.
"""
import importlib
import sys
import os
import tempfile
from pathlib import Path

# ── Test 1: db_helpers imports cleanly ───────────────────────────────────────
def test_db_helpers_importable():
    """db_helpers must import without errors and expose key names."""
    import db_helpers
    assert callable(db_helpers.get_db_connection)
    assert callable(db_helpers.db_insert)
    assert callable(db_helpers.db_upsert_download_job)
    assert callable(db_helpers.load_settings)
    assert callable(db_helpers.has_ffmpeg)
    assert isinstance(db_helpers.DOWNLOAD_DIR, str)
    assert isinstance(db_helpers.DB_PATH, str)


# ── Test 2: format utilities ──────────────────────────────────────────────────
def test_format_bytes():
    from db_helpers import _format_bytes, _format_bytes_int
    assert _format_bytes(0) == ""
    assert "KB" in _format_bytes(2048) or "B" in _format_bytes(2048)
    assert _format_bytes_int(0) == "0 B"
    assert "MB" in _format_bytes_int(2 * 1024 * 1024)


# ── Test 3: _format_eta ───────────────────────────────────────────────────────
def test_format_eta():
    from db_helpers import _format_eta
    assert _format_eta(None) == ""
    assert _format_eta(0) == ""
    assert "s" in _format_eta(45)
    assert "m" in _format_eta(90)
    assert "h" in _format_eta(3700)


# ── Test 4: sanitize_download_engine ─────────────────────────────────────────
def test_sanitize_download_engine():
    from db_helpers import _sanitize_download_engine
    assert _sanitize_download_engine("aria2") == "aria2"
    assert _sanitize_download_engine("standard") == "standard"
    assert _sanitize_download_engine("garbage") == "standard"
    assert _sanitize_download_engine(None) == "standard"


# ── Test 5: guess_dl_type_from_path ──────────────────────────────────────────
def test_guess_dl_type_from_path():
    from db_helpers import _guess_dl_type_from_path
    assert _guess_dl_type_from_path("song.mp3") == "audio"
    assert _guess_dl_type_from_path("movie.mp4") == "video"
    assert _guess_dl_type_from_path("sub.srt") == "subtitle"
    assert _guess_dl_type_from_path("cover.jpg") == "thumbnail"


# ── Test 6: load_settings returns defaults when file absent ──────────────────
def test_load_settings_defaults(tmp_path, monkeypatch):
    import db_helpers
    monkeypatch.setattr(db_helpers, "SETTINGS_PATH", str(tmp_path / "no_file.json"))
    settings = db_helpers.load_settings()
    assert "theme" in settings
    assert settings["default_download_engine"] == "standard"


# ── Test 7: db_list_download_jobs returns list (even on empty db) ─────────────
def test_db_list_download_jobs_empty(tmp_path, monkeypatch):
    import db_helpers
    test_db = str(tmp_path / "test.db")
    monkeypatch.setattr(db_helpers, "DB_PATH", test_db)
    import sqlite3
    con = sqlite3.connect(test_db)
    con.execute("""
        CREATE TABLE IF NOT EXISTS download_jobs (
            id TEXT PRIMARY KEY, url TEXT, title TEXT, thumbnail TEXT,
            dl_type TEXT, status TEXT, created_at TEXT, updated_at TEXT,
            file_path TEXT, partial_file_path TEXT, error TEXT, percent REAL,
            speed TEXT, eta TEXT, downloaded TEXT, total TEXT, size TEXT,
            can_pause INTEGER, retry_count INTEGER, failure_code TEXT,
            recoverable INTEGER, download_strategy TEXT, params_json TEXT
        )
    """)
    con.commit(); con.close()
    rows = db_helpers.db_list_download_jobs()
    assert isinstance(rows, list)
    assert len(rows) == 0


# ── Test 8: library_helpers importable ───────────────────────────────────────
def test_library_helpers_importable():
    """library_helpers must import without errors and expose key names."""
    import library_helpers
    assert callable(library_helpers.migrate_db)
    assert callable(library_helpers._build_library_index)
    assert callable(library_helpers._reconcile_library_state)


# ── Test 9: _get_file_size safe on missing file ───────────────────────────────
def test_get_file_size_missing():
    from db_helpers import _get_file_size
    assert _get_file_size("/definitely/does/not/exist.mp4") == 0


# ── Test 10: strip_ansi removes color codes ──────────────────────────────────
def test_strip_ansi():
    from db_helpers import _strip_ansi
    assert _strip_ansi("\x1b[32mHello\x1b[0m") == "Hello"
    assert _strip_ansi("plain text") == "plain text"
    assert _strip_ansi("") == ""
    assert _strip_ansi(None) == ""
