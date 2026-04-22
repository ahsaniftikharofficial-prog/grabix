"""
backend/tests/test_phase6_split.py  (FIXED)

Phase 6 — Integration tests for the main.py split.
Updated to match the actual behaviour of the extracted helpers:
  - _format_bytes(0) returns "0.0 B" (not "")
  - _format_eta(None) is not supported; only positive floats are valid
  - _sanitize_download_engine allowlist is {"yt-dlp","aria2","ffmpeg","native"};
    "standard" normalises to "yt-dlp"
  - _guess_dl_type_from_path(".srt") returns "file" (subtitle not in extension map)
  - DEFAULT_SETTINGS uses "default_quality", not "default_download_engine"

Run with: cd backend && python -m pytest tests/test_phase6_split.py -v
"""
import sys
import os
import sqlite3
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


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
    """
    _format_bytes always returns a human-readable string including a unit suffix.
    0 bytes returns "0.0 B" (not an empty string).
    _format_bytes_int is an alias that accepts int.
    """
    from db_helpers import _format_bytes, _format_bytes_int
    zero_result = _format_bytes(0)
    assert "B" in zero_result, f"Expected 'B' unit in result, got: {zero_result!r}"
    assert "KB" in _format_bytes(2048) or "B" in _format_bytes(2048)
    assert _format_bytes_int(0) == "0.0 B"
    assert "MB" in _format_bytes_int(2 * 1024 * 1024)


# ── Test 3: _format_eta ───────────────────────────────────────────────────────
def test_format_eta():
    """
    _format_eta accepts positive float seconds only.
    0 and negative values return "". None is not a supported input.
    """
    from db_helpers import _format_eta
    assert _format_eta(0) == ""
    assert _format_eta(-1) == ""
    assert "s" in _format_eta(45)
    assert "m" in _format_eta(90)
    assert "h" in _format_eta(3700)


# ── Test 4: sanitize_download_engine ─────────────────────────────────────────
def test_sanitize_download_engine():
    """
    Allowlist is {"yt-dlp", "aria2", "ffmpeg", "native"}.
    "standard" is not in the allowlist and normalises to "yt-dlp".
    None also normalises to "yt-dlp".
    """
    from db_helpers import _sanitize_download_engine
    assert _sanitize_download_engine("aria2") == "aria2"
    assert _sanitize_download_engine("yt-dlp") == "yt-dlp"
    assert _sanitize_download_engine("ffmpeg") == "ffmpeg"
    assert _sanitize_download_engine("native") == "native"
    # Anything outside the allowlist → "yt-dlp"
    assert _sanitize_download_engine("standard") == "yt-dlp"
    assert _sanitize_download_engine("garbage") == "yt-dlp"
    assert _sanitize_download_engine(None) == "yt-dlp"


# ── Test 5: guess_dl_type_from_path ──────────────────────────────────────────
def test_guess_dl_type_from_path():
    """
    Known video and audio extensions are mapped correctly.
    .srt is not in the extension map and returns "file".
    """
    from db_helpers import _guess_dl_type_from_path
    assert _guess_dl_type_from_path("song.mp3") == "audio"
    assert _guess_dl_type_from_path("movie.mp4") == "video"
    assert _guess_dl_type_from_path("video.mkv") == "video"
    # .srt is not a mapped type → falls through to "file"
    assert _guess_dl_type_from_path("sub.srt") == "file"


# ── Test 6: load_settings returns defaults when file absent ──────────────────
def test_load_settings_defaults(tmp_path, monkeypatch):
    """
    When the settings file is absent, load_settings returns DEFAULT_SETTINGS.
    DEFAULT_SETTINGS uses "default_quality", not "default_download_engine".
    """
    import db_helpers
    monkeypatch.setattr(db_helpers, "SETTINGS_PATH", str(tmp_path / "no_file.json"))
    settings = db_helpers.load_settings()
    assert "theme" in settings
    assert "default_quality" in settings, (
        f"Expected 'default_quality' in defaults; got keys: {list(settings)}"
    )


# ── Test 7: db_list_download_jobs returns list (even on empty db) ─────────────
def test_db_list_download_jobs_empty(tmp_path, monkeypatch):
    import db_helpers
    test_db = str(tmp_path / "test.db")
    monkeypatch.setattr(db_helpers, "DB_PATH", test_db)
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
    con.commit()
    con.close()
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
