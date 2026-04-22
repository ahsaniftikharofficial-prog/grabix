"""
backend/moviebox/moviebox_loader.py — Lazy loader, provider persistence, bg retry, cache helpers.

Responsibilities:
  - _ensure_moviebox()        → lazy-load moviebox_api on first use
  - _save_provider_status()   → persist availability to SQLite
  - restore_from_last_session() → called at startup
  - _bg_retry_worker()        → background thread that auto-recovers
  - start_bg_retry()          → kick off the thread once
  - _moviebox_cache_get/set() → thin wrappers over main.py shims
  - Lazy shims for main.py functions (no circular imports at module level)

No FastAPI, no routes, no business logic here.
"""
from __future__ import annotations

import importlib
import logging
import time
import threading
from datetime import datetime, timezone

from app.services.logging_utils import get_logger, log_event
from db_helpers import get_db_connection
from app.services.runtime_config import public_base_url as _public_base_url

SELF_BASE_URL = _public_base_url()

# ── Cache TTL constants ───────────────────────────────────────────────────────
_CACHE_TTL: dict = {
    "discover":       6 * 3600,
    "details":        6 * 3600,
    "manga_chapters": 12 * 3600,
    "search":         30 * 60,
    "generic":        15 * 60,
    "moviebox":       60 * 15,
}

_MOVIEBOX_TTL: dict[str, int] = {
    "discover": 6 * 3600,
    "details":  6 * 3600,
    "search":   30 * 60,
    "generic":  15 * 60,
}
MOVIEBOX_CACHE_TTL_SECONDS = 60 * 15
_CACHE_STALE_GRACE = 2.0
_CACHE_MAX_BYTES   = 50 * 1024 * 1024

# ── Lazy shims for functions that live in main.py ─────────────────────────────
# We cannot import main at module level (circular: main imports moviebox).
# These thin wrappers do a deferred import at first call instead.

def _sqlite_cache_get(key: str):
    import main as _m
    return _m._sqlite_cache_get(key)

def _sqlite_cache_set(key: str, value, content_type: str = "generic"):
    import main as _m
    return _m._sqlite_cache_set(key, value, content_type)

def _cache_trigger_bg_refresh(key: str, refresh_coro_factory):
    import main as _m
    return _m._cache_trigger_bg_refresh(key, refresh_coro_factory)

def _validate_outbound_url(url: str, **kwargs):
    import main as _m
    return _m._validate_outbound_url(url, **kwargs)


# ── Lazy-loader state ─────────────────────────────────────────────────────────
_moviebox_loaded:           bool  = False
_moviebox_last_fail_time:   float = 0.0
_MOVIEBOX_RETRY_COOLDOWN:   float = 60.0

MovieBoxHomepage              = None
MovieBoxHotMoviesAndTVSeries  = None
MovieBoxMovieDetails          = None
MovieBoxPopularSearch         = None
MovieBoxSearch                = None
MovieBoxTrending              = None
MovieBoxTVSeriesDetails       = None
DownloadableMovieFilesDetail  = None
DownloadableTVSeriesFilesDetail = None
MovieBoxSession               = None
MovieBoxSubjectType           = None
MOVIEBOX_AVAILABLE            = False
MOVIEBOX_IMPORT_ERROR         = ""
MOVIEBOX_IMPORT_VARIANT       = ""
MOVIEBOX_DOWNLOAD_REQUEST_HEADERS: dict = {}

moviebox_item_registry: dict[str, tuple[float, object]] = {}

backend_logger = get_logger("backend")


def _ensure_moviebox() -> bool:
    """Load moviebox_api on first use. Retries after 60 s cooldown on failure."""
    global _moviebox_loaded, _moviebox_last_fail_time
    global MovieBoxHomepage, MovieBoxHotMoviesAndTVSeries, MovieBoxMovieDetails
    global MovieBoxPopularSearch, MovieBoxSearch, MovieBoxTrending, MovieBoxTVSeriesDetails
    global DownloadableMovieFilesDetail, DownloadableTVSeriesFilesDetail
    global MovieBoxSession, MovieBoxSubjectType
    global MOVIEBOX_AVAILABLE, MOVIEBOX_IMPORT_ERROR, MOVIEBOX_IMPORT_VARIANT
    global MOVIEBOX_DOWNLOAD_REQUEST_HEADERS

    if _moviebox_loaded and MOVIEBOX_AVAILABLE:
        return True
    if _moviebox_last_fail_time and (time.time() - _moviebox_last_fail_time) < _MOVIEBOX_RETRY_COOLDOWN:
        return False

    import_errors: list[str] = []
    for api_mod_name, const_mod_name in (
        ("moviebox_api",    "moviebox_api.constants"),
        ("moviebox_api.v1", "moviebox_api.v1.constants"),
    ):
        try:
            api_mod   = importlib.import_module(api_mod_name)
            const_mod = importlib.import_module(const_mod_name)
            MovieBoxHomepage              = getattr(api_mod, "Homepage")
            MovieBoxHotMoviesAndTVSeries  = getattr(api_mod, "HotMoviesAndTVSeries")
            MovieBoxMovieDetails          = getattr(api_mod, "MovieDetails")
            MovieBoxPopularSearch         = getattr(api_mod, "PopularSearch")
            MovieBoxSearch                = getattr(api_mod, "Search")
            MovieBoxTrending              = getattr(api_mod, "Trending")
            MovieBoxTVSeriesDetails       = getattr(api_mod, "TVSeriesDetails")
            DownloadableMovieFilesDetail  = getattr(api_mod, "DownloadableMovieFilesDetail")
            DownloadableTVSeriesFilesDetail = getattr(api_mod, "DownloadableTVSeriesFilesDetail")
            MovieBoxSession               = getattr(api_mod, "Session")
            MovieBoxSubjectType           = getattr(api_mod, "SubjectType")
            MOVIEBOX_DOWNLOAD_REQUEST_HEADERS = getattr(const_mod, "DOWNLOAD_REQUEST_HEADERS")
            MOVIEBOX_AVAILABLE      = True
            MOVIEBOX_IMPORT_ERROR   = ""
            MOVIEBOX_IMPORT_VARIANT = api_mod_name
            _moviebox_loaded        = True
            return True
        except Exception as exc:
            import_errors.append(f"{api_mod_name}: {exc}")

    MOVIEBOX_AVAILABLE      = False
    MOVIEBOX_IMPORT_VARIANT = ""
    MOVIEBOX_IMPORT_ERROR   = " | ".join(import_errors) or "moviebox-api import failed"
    _moviebox_last_fail_time = time.time()
    _moviebox_loaded         = False
    return False


# ── Provider status persistence ───────────────────────────────────────────────

def _save_provider_status(available: bool, error: str = "") -> None:
    try:
        con = get_db_connection()
        con.execute(
            """
            INSERT INTO provider_status (provider, available, last_checked_at, last_error, consecutive_failures)
            VALUES (?, ?, ?, ?, 0)
            ON CONFLICT(provider) DO UPDATE SET
                available=excluded.available,
                last_checked_at=excluded.last_checked_at,
                last_error=excluded.last_error,
                consecutive_failures=CASE WHEN excluded.available=1 THEN 0
                                          ELSE consecutive_failures+1 END
            """,
            ("moviebox", 1 if available else 0, datetime.now(timezone.utc).isoformat(), error),
        )
        con.commit()
        con.close()
    except Exception as _exc:
        backend_logger.debug("moviebox _save_provider_status failed: %s", _exc)


def restore_from_last_session() -> None:
    """On startup, restore last-known MovieBox availability from SQLite."""
    try:
        con = get_db_connection()
        row = con.execute(
            "SELECT available, last_error FROM provider_status WHERE provider=?", ("moviebox",)
        ).fetchone()
        con.close()
        if row and row["available"] == 1:
            result = _ensure_moviebox()
            if result:
                log_event(backend_logger, logging.INFO, event="moviebox_restored",
                          message="MovieBox restored as available from last session.")
        elif row and row["available"] == 0:
            log_event(backend_logger, logging.INFO, event="moviebox_last_known_down",
                      message="MovieBox was down last session — background retry will handle recovery.",
                      details={"last_error": row["last_error"] or ""})
    except Exception as _exc:
        backend_logger.warning("restore_from_last_session failed: %s", _exc, exc_info=False)


# ── Background retry worker ───────────────────────────────────────────────────

_bg_retry_running  = False
_BG_RETRY_INTERVAL = 300  # 5 minutes


def _bg_retry_worker() -> None:
    global _bg_retry_running
    _bg_retry_running = True
    log_event(backend_logger, logging.INFO, event="moviebox_bg_retry_started",
              message="MovieBox background auto-retry started.")
    while True:
        time.sleep(_BG_RETRY_INTERVAL)
        try:
            global _moviebox_last_fail_time, _moviebox_loaded
            was_available = MOVIEBOX_AVAILABLE
            _moviebox_last_fail_time = 0.0
            _moviebox_loaded = False
            result = _ensure_moviebox()
            if result and not was_available:
                log_event(backend_logger, logging.INFO, event="moviebox_auto_recovered",
                          message="MovieBox recovered automatically — status flipped to online.")
                _save_provider_status(True)
            elif not result and was_available:
                log_event(backend_logger, logging.WARNING, event="moviebox_went_offline",
                          message="MovieBox went offline — background retry will keep watching.",
                          details={"error": MOVIEBOX_IMPORT_ERROR or ""})
                _save_provider_status(False, MOVIEBOX_IMPORT_ERROR or "")
            elif result:
                _save_provider_status(True)
            else:
                _save_provider_status(False, MOVIEBOX_IMPORT_ERROR or "")
        except Exception as exc:
            log_event(backend_logger, logging.WARNING, event="moviebox_bg_retry_error",
                      message="MovieBox background retry encountered an error.",
                      details={"error": str(exc)})


def start_bg_retry() -> None:
    """Kick off the background retry thread once at startup."""
    if _bg_retry_running:
        return
    threading.Thread(target=_bg_retry_worker, daemon=True, name="moviebox-bg-retry").start()


# ── Cache helpers ─────────────────────────────────────────────────────────────
# Both delegate to main.py via the lazy shims above — no direct SQLite here.

def _moviebox_cache_get(key: str):
    """Return cached value for key (prefixed with 'moviebox:'), or None on miss."""
    value, _is_stale = _sqlite_cache_get(f"moviebox:{key}")
    return value


def _moviebox_cache_set(key: str, payload, ttl: int = MOVIEBOX_CACHE_TTL_SECONDS):
    """Persist payload under 'moviebox:{key}' and return payload."""
    return _sqlite_cache_set(f"moviebox:{key}", payload, content_type="moviebox")
