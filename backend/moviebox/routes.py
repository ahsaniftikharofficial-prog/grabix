"""
backend/moviebox/routes.py — All MovieBox business logic and FastAPI routes.

Extracted from main.py (Phase 2 refactor). Previously ~1,100 lines spread
across two regions of main.py; now self-contained with no circular imports.

External dependencies (no main.py imports):
  - db_helpers.get_db_connection  → for provider status persistence
  - app.services.logging_utils    → log_event, get_logger
  - fastapi                       → APIRouter, HTTPException, Request, StreamingResponse
  - stdlib only for everything else
"""
from __future__ import annotations

import asyncio
import importlib
import json
import logging
import math
import re
import time
import threading
from datetime import datetime, timezone
from difflib import SequenceMatcher
from urllib.parse import quote, unquote, urljoin, urlparse
from urllib.request import Request as URLRequest, urlopen

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.services.logging_utils import get_logger, log_event
from db_helpers import get_db_connection

# ── Constants and lazy shims for things that live in main.py ─────────────────
# SELF_BASE_URL: imported directly from runtime_config (no circular risk)
from app.services.runtime_config import public_base_url as _public_base_url
SELF_BASE_URL = _public_base_url()

# _CACHE_TTL: mirrored here so moviebox doesn't import main at module level
_CACHE_TTL: dict = {
    "discover":       6 * 3600,
    "details":        6 * 3600,
    "manga_chapters": 12 * 3600,
    "search":         30 * 60,
    "generic":        15 * 60,
    "moviebox":       60 * 15,
}

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


router = APIRouter()
backend_logger = get_logger("backend")

# ── Cache constants (mirrors _CACHE_TTL in main.py for moviebox keys) ─────────
_MOVIEBOX_TTL: dict[str, int] = {
    "discover": 6 * 3600,
    "details":  6 * 3600,
    "search":   30 * 60,
    "generic":  15 * 60,
}
MOVIEBOX_CACHE_TTL_SECONDS = 60 * 15
_CACHE_STALE_GRACE = 2.0
_CACHE_MAX_BYTES   = 50 * 1024 * 1024

# ── Lazy-loader state ─────────────────────────────────────────────────────────
_moviebox_loaded          = False
_moviebox_last_fail_time: float = 0.0
_MOVIEBOX_RETRY_COOLDOWN  = 60.0

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
            MOVIEBOX_AVAILABLE    = True
            MOVIEBOX_IMPORT_ERROR = ""
            MOVIEBOX_IMPORT_VARIANT = api_mod_name
            _moviebox_loaded      = True
            return True
        except Exception as exc:
            import_errors.append(f"{api_mod_name}: {exc}")

    MOVIEBOX_AVAILABLE     = False
    MOVIEBOX_IMPORT_VARIANT = ""
    MOVIEBOX_IMPORT_ERROR  = " | ".join(import_errors) or "moviebox-api import failed"
    _moviebox_last_fail_time = time.time()
    _moviebox_loaded       = False
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
                consecutive_failures=CASE WHEN excluded.available=1 THEN 0 ELSE consecutive_failures+1 END
            """,
            ("moviebox", 1 if available else 0, datetime.now(timezone.utc).isoformat(), error),
        )
        con.commit()
        con.close()
    except Exception as _exc:
        backend_logger.debug("moviebox _save_provider_status failed: %s", _exc)


def restore_from_last_session() -> None:
    """On startup, restore last-known MovieBox availability from SQLite."""
    global MOVIEBOX_AVAILABLE, MOVIEBOX_IMPORT_ERROR
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

_bg_retry_running    = False
_BG_RETRY_INTERVAL   = 300  # 5 minutes


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
                          message="MovieBox recovered automatically in background — status flipped to online.")
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


# ── Cache helpers (direct SQLite, no main.py import) ─────────────────────────

def _moviebox_cache_get(key: str):
    try:
        now = time.time()
        con = get_db_connection()
        row = con.execute(
            "SELECT value, expires_at, content_type FROM content_cache WHERE key=?",
            (f"moviebox:{key}",)
        ).fetchone()
        con.close()
        if row is None:
            return None
        expires_at   = float(row["expires_at"])
        content_type = row["content_type"] or "generic"
        ttl          = _MOVIEBOX_TTL.get(content_type, MOVIEBOX_CACHE_TTL_SECONDS)
        stale_deadline = expires_at + ttl * (_CACHE_STALE_GRACE - 1.0)
        value = json.loads(row["value"])
        if now <= expires_at:
            return value       # fresh
        if now <= stale_deadline:
            return value       # stale-but-usable
        return None
    except Exception as _exc:
        backend_logger.debug("_moviebox_cache_get failed: %s", _exc)
        return None


def _moviebox_cache_set(key: str, payload, ttl: int = MOVIEBOX_CACHE_TTL_SECONDS):
    try:
        now        = time.time()
        serialized = json.dumps(payload, default=str)
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
            (f"moviebox:{key}", serialized, "moviebox", now + ttl, now, now),
        )
        con.commit()
        con.close()
    except Exception as _exc:
        backend_logger.debug("_moviebox_cache_set failed: %s", _exc)
    return payload


# ── Business logic (extracted from main.py) ──────────────────────────────────
def _moviebox_assert_available():
    _ensure_moviebox()  # lazy-load with 60s cooldown on failure
    if not MOVIEBOX_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail={
                "message": f"moviebox-api is not available: {MOVIEBOX_IMPORT_ERROR or 'not installed'}",
                "fallbacks": ["embed", "vidsrc"],
                "auto_retry": True,
                "retry_interval_seconds": _BG_RETRY_INTERVAL,
            },
        )


def _moviebox_cache_get(key: str):
    value, is_stale = _sqlite_cache_get(f"moviebox:{key}")
    return value  # None on miss, data on hit (stale-while-revalidate handled by sqlite cache)


def _moviebox_cache_set(key: str, payload, ttl: int = MOVIEBOX_CACHE_TTL_SECONDS):
    return _sqlite_cache_set(f"moviebox:{key}", payload, content_type="moviebox")


def _moviebox_register_item(item):
    subject_id = str(getattr(item, "subjectId", "") or "")
    if subject_id:
        moviebox_item_registry[subject_id] = (
            time.time() + MOVIEBOX_CACHE_TTL_SECONDS,
            item,
        )


def _moviebox_register_items(items):
    for item in items or []:
        _moviebox_register_item(item)


def _moviebox_get_registered_item(subject_id: str | None):
    if not subject_id:
        return None
    cached = moviebox_item_registry.get(str(subject_id))
    if not cached:
        return None
    expires_at, item = cached
    if expires_at <= time.time():
        moviebox_item_registry.pop(str(subject_id), None)
        return None
    return item


def _moviebox_supports_downloadable_detail(item) -> bool:
    if item is None:
        return False
    return item.__class__.__name__ in {"SearchResultsItem", "ItemJsonDetailsModel"}


def _normalize_moviebox_title(value: str) -> str:
    cleaned = re.sub(r"\[[^\]]+\]", "", value or "")
    cleaned = re.sub(r"[^a-z0-9]+", " ", cleaned.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def _moviebox_media_type_value(media_type: str) -> str:
    normalized = (media_type or "all").strip().lower()
    if normalized not in {"all", "movie", "series", "anime"}:
        raise HTTPException(
            status_code=400,
            detail="media_type must be one of: all, movie, series, anime",
        )
    return normalized


def _moviebox_media_type_from_item(item) -> str:
    if getattr(item, "subjectType", None) == MovieBoxSubjectType.MOVIES:
        return "movie"
    return "series"


def _moviebox_is_hindi(item) -> bool:
    haystack = " ".join(
        [
            str(getattr(item, "title", "") or ""),
            str(getattr(item, "corner", "") or ""),
            str(getattr(item, "countryName", "") or ""),
            " ".join(str(value) for value in (getattr(item, "genre", None) or [])),
            " ".join(str(value) for value in (getattr(item, "subtitles", None) or [])),
            str(getattr(item, "description", "") or ""),
        ]
    ).lower()
    return any(
        token in haystack
        for token in (
            "hindi",
            "hin",
            "dubbed",
            "dual audio",
            "multi audio",
            "bollywood",
        )
    ) or (getattr(item, "countryName", "") or "").lower() == "india"


def _moviebox_is_anime(item) -> bool:
    genres = [str(genre).lower() for genre in (getattr(item, "genre", None) or [])]
    country = (getattr(item, "countryName", "") or "").lower()
    title = (getattr(item, "title", "") or "").lower()
    return "anime" in genres or country == "japan" or "anime" in title


def _moviebox_release_year(item) -> int | None:
    release_date = getattr(item, "releaseDate", None)
    return getattr(release_date, "year", None)


def _moviebox_match_score(
    item,
    title: str,
    year: int | None,
    prefer_hindi: bool = True,
    anime_only: bool = False,
) -> float:
    target = _normalize_moviebox_title(title)
    candidate = _normalize_moviebox_title(getattr(item, "title", ""))
    ratio = SequenceMatcher(None, target, candidate).ratio()

    score = ratio * 100
    if target and candidate == target:
        score += 30
    elif target and target in candidate:
        score += 15

    release_year = _moviebox_release_year(item)
    if year is not None and release_year == year:
        score += 25

    if getattr(item, "hasResource", False):
        score += 10
    if prefer_hindi and _moviebox_is_hindi(item):
        score += 12
    if anime_only:
        score += 18 if _moviebox_is_anime(item) else -35

    return score


def _moviebox_card_payload(item, section: str | None = None) -> dict:
    raw_poster = str(getattr(getattr(item, "cover", None), "url", "") or "")
    media_type = _moviebox_media_type_from_item(item)

    return {
        "id": str(getattr(item, "subjectId", "") or ""),
        "title": getattr(item, "title", "") or "Unknown",
        "description": getattr(item, "description", "") or "",
        "year": _moviebox_release_year(item),
        "poster": raw_poster,
        "poster_proxy": _moviebox_poster_proxy_url(raw_poster) if raw_poster else "",
        "media_type": "anime" if _moviebox_is_anime(item) else media_type,
        "moviebox_media_type": media_type,
        "country": getattr(item, "countryName", "") or "",
        "genres": list(getattr(item, "genre", None) or []),
        "imdb_rating": getattr(item, "imdbRatingValue", None),
        "imdb_rating_count": getattr(item, "imdbRatingCount", None),
        "detail_path": getattr(item, "detailPath", "") or "",
        "corner": getattr(item, "corner", "") or "",
        "has_resource": getattr(item, "hasResource", False),
        "subtitle_languages": list(getattr(item, "subtitles", None) or []),
        "is_hindi": _moviebox_is_hindi(item),
        "is_anime": _moviebox_is_anime(item),
        "section": section or "",
    }


def _moviebox_unique_items(items) -> list:
    deduped: list = []
    seen: set[str] = set()
    for item in items or []:
        subject_id = str(getattr(item, "subjectId", "") or "")
        if not subject_id or subject_id in seen:
            continue
        seen.add(subject_id)
        deduped.append(item)
    return deduped


def _moviebox_filter_items(
    items,
    media_type: str = "all",
    hindi_only: bool = False,
    anime_only: bool = False,
) -> list:
    filtered: list = []
    for item in items or []:
        item_media_type = _moviebox_media_type_from_item(item)
        is_anime = _moviebox_is_anime(item)
        is_hindi = _moviebox_is_hindi(item)

        if media_type == "movie" and item_media_type != "movie":
            continue
        if media_type == "series" and item_media_type != "series":
            continue
        if media_type == "anime" and not is_anime:
            continue
        if anime_only and not is_anime:
            continue
        if hindi_only and not is_hindi:
            continue

        filtered.append(item)
    return filtered


def _moviebox_sort_items(items, sort_by: str = "search", query: str = "") -> list:
    normalized_sort = (sort_by or "search").lower()
    if normalized_sort == "rating":
        return sorted(
            items,
            key=lambda item: float(getattr(item, "imdbRatingValue", 0) or 0),
            reverse=True,
        )
    if normalized_sort == "recent":
        return sorted(
            items,
            key=lambda item: (
                _moviebox_release_year(item) or 0,
                float(getattr(item, "imdbRatingValue", 0) or 0),
            ),
            reverse=True,
        )
    return sorted(
        items,
        key=lambda item: _moviebox_match_score(item, query, None, True, False),
        reverse=True,
    )


def _moviebox_pick_category(categories: dict[str, list], keywords: list[str]) -> list:
    for category_title, items in categories.items():
        lowered = category_title.lower()
        if all(keyword in lowered for keyword in keywords):
            return items
    return []


def _moviebox_subtitle_proxy_url(url: str) -> str:
    return f"{SELF_BASE_URL}/moviebox/subtitle?url={quote(url, safe='')}"


def _moviebox_stream_proxy_url(url: str) -> str:
    return f"{SELF_BASE_URL}/moviebox/proxy-stream?url={quote(url, safe='')}"


def _moviebox_poster_proxy_url(url: str) -> str:
    return f"{SELF_BASE_URL}/moviebox/poster?url={quote(url, safe='')}"


def _moviebox_caption_payload(caption) -> dict:
    language = getattr(caption, "lanName", None) or getattr(caption, "lan", None) or "Subtitle"
    raw_url = str(getattr(caption, "url", "") or "")
    return {
        "id": str(getattr(caption, "id", "") or language),
        "language": getattr(caption, "lan", "") or "",
        "label": language,
        "url": _moviebox_subtitle_proxy_url(raw_url) if raw_url else "",
        "original_url": raw_url,
    }


def _moviebox_source_payload(media_file, captions: list[dict] | None = None) -> dict:
    resolution = int(getattr(media_file, "resolution", 0) or 0)
    size = int(getattr(media_file, "size", 0) or 0)
    quality = f"{resolution}p" if resolution > 0 else "Auto"
    raw_url = str(getattr(media_file, "url", "") or "")
    server = urlparse(raw_url).netloc or "moviebox"
    return {
        "provider": "MovieBox",
        "label": f"MovieBox {quality}",
        "url": _moviebox_stream_proxy_url(raw_url) if raw_url else "",
        "original_url": raw_url,
        "server": server,
        "quality": quality,
        "resolution": resolution,
        "size_bytes": size,
        "size_label": _format_bytes(size),
        "kind": "direct",
        "mime_type": "video/mp4",
        "headers": {"Referer": "https://moviebox.ng/", "User-Agent": "Mozilla/5.0"},
        "subtitles": captions or [],
    }


def _moviebox_guess_seasons(title: str) -> list[int]:
    match = re.search(r"S(\d+)\s*-\s*S?(\d+)", title or "", re.IGNORECASE)
    if match:
        start = int(match.group(1))
        end = int(match.group(2))
        if start <= end:
            return list(range(start, min(end, start + 24) + 1))
    match = re.search(r"S(\d+)", title or "", re.IGNORECASE)
    if match:
        return [int(match.group(1))]
    return [1]


def _moviebox_base_title(title: str) -> str:
    cleaned = re.sub(r"\[(.*?)\]", "", title or "", flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(hindi|urdu|punjabi|dub|dubbed)\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip(" -")


def _moviebox_extract_season_episode_counts(payload) -> dict[int, int]:
    counts: dict[int, int] = {}

    def register(season_value, episode_value) -> None:
        try:
            season_number = int(season_value or 0)
            max_episode = int(episode_value or 0)
        except Exception:
            return
        if season_number > 0 and max_episode > 0:
            counts[season_number] = max(counts.get(season_number, 0), max_episode)

    def visit(node) -> None:
        if isinstance(node, dict):
            lowered = {str(key).lower(): key for key in node.keys()}
            season_key = next((lowered[name] for name in ("se", "season", "seasonnumber", "season_number") if name in lowered), None)
            episode_key = next(
                (
                    lowered[name]
                    for name in ("maxep", "episodecount", "episodes", "epcount", "episode_count", "latestep")
                    if name in lowered
                ),
                None,
            )
            if season_key is not None and episode_key is not None:
                register(node.get(season_key), node.get(episode_key))
            for value in node.values():
                visit(value)
            return

        if isinstance(node, (list, tuple, set)):
            for item in node:
                visit(item)
            return

        season_value = getattr(node, "se", None)
        if season_value is None:
            season_value = getattr(node, "season", None)
        episode_value = getattr(node, "maxEp", None)
        if episode_value is None:
            episode_value = getattr(node, "episodeCount", None)
        if episode_value is None:
            episode_value = getattr(node, "episodes", None)
        if season_value is not None and episode_value is not None:
            register(season_value, episode_value)

        for attr_name in ("seasons", "seasonList", "episodes", "episodeList", "resource", "resData", "subject"):
            try:
                child = getattr(node, attr_name, None)
            except Exception:
                child = None
            if child is not None:
                visit(child)

    visit(payload)
    return counts


def _moviebox_total_episode_count(season_episode_counts: dict[int, int] | None) -> int:
    return sum(int(value or 0) for value in (season_episode_counts or {}).values())


async def _moviebox_discover_payload():
    cache_key = "moviebox:discover"

    # Phase 3: SQLite TTL cache with stale-while-revalidate
    cached_value, is_stale = _sqlite_cache_get(cache_key)
    if cached_value is not None:
        if is_stale:
            # Return stale content immediately; refresh silently in background
            _cache_trigger_bg_refresh(
                cache_key,
                lambda: _moviebox_discover_fetch_and_cache(cache_key),
            )
        return cached_value

    # Full miss — fetch fresh synchronously
    return await _moviebox_discover_fetch_and_cache(cache_key)


async def _moviebox_discover_fetch_and_cache(cache_key: str):

    _moviebox_assert_available()
    session = MovieBoxSession(timeout=20)

    homepage, trending, hot, popular_searches = await asyncio.gather(
        MovieBoxHomepage(session).get_content_model(),
        MovieBoxTrending(session).get_content_model(),
        MovieBoxHotMoviesAndTVSeries(session).get_content_model(),
        MovieBoxPopularSearch(session).get_content_model(),
        return_exceptions=True
    )

    if isinstance(homepage, Exception): homepage = None
    if isinstance(trending, Exception): trending = None
    if isinstance(hot, Exception): hot = None
    if isinstance(popular_searches, Exception): popular_searches = None


    categories: dict[str, list] = {}
    for category in list(getattr(homepage, "operatingList", []) or []):
        items = _moviebox_unique_items(getattr(category, "subjects", []) or [])
        if items:
            categories[str(getattr(category, "title", "") or "")] = items
            _moviebox_register_items(items)

    trending_items = _moviebox_unique_items(getattr(trending, "items", []) or [])
    hot_items = _moviebox_unique_items(
        list(getattr(hot, "movies", []) or []) + list(getattr(hot, "tv_series", []) or [])
    )
    combined = _moviebox_unique_items(
        trending_items
        + hot_items
        + _moviebox_pick_category(categories, ["top anime"])
        + _moviebox_pick_category(categories, ["bollywood"])
        + _moviebox_pick_category(categories, ["western", "tv"])
        + _moviebox_pick_category(categories, ["indian", "drama"])
        + _moviebox_pick_category(categories, ["hindi", "dub"])
    )
    _moviebox_register_items(trending_items)
    _moviebox_register_items(hot_items)

    sections = [
        {
            "id": "recent",
            "title": "Recent",
            "subtitle": "Fresh titles and current releases",
            "items": [_moviebox_card_payload(item, "recent") for item in _moviebox_sort_items(hot_items, "recent")[:20]],
        },
        {
            "id": "most-popular",
            "title": "Most Popular",
            "subtitle": "What people are watching right now",
            "items": [_moviebox_card_payload(item, "most-popular") for item in trending_items[:20]],
        },
        {
            "id": "top-rated",
            "title": "Top Rated",
            "subtitle": "Highest IMDb-rated picks from Movie Box",
            "items": [_moviebox_card_payload(item, "top-rated") for item in _moviebox_sort_items(combined, "rating")[:20]],
        },
        {
            "id": "hindi",
            "title": "Hindi Picks",
            "subtitle": "Hindi-first titles surfaced from Movie Box",
            "items": [
                _moviebox_card_payload(item, "hindi")
                for item in _moviebox_filter_items(
                    _moviebox_pick_category(categories, ["hindi", "dub"])
                    + _moviebox_pick_category(categories, ["bollywood"])
                    + _moviebox_pick_category(categories, ["punjabi"]),
                    hindi_only=True,
                )[:20]
            ],
        },
        {
            "id": "movies",
            "title": "Movies",
            "subtitle": "Featured movie picks",
            "items": [
                _moviebox_card_payload(item, "movies")
                for item in _moviebox_filter_items(
                    _moviebox_pick_category(categories, ["hollywood"]) + list(getattr(hot, "movies", []) or []),
                    media_type="movie",
                )[:20]
            ],
        },
        {
            "id": "series",
            "title": "TV Shows",
            "subtitle": "Popular series and drama picks",
            "items": [
                _moviebox_card_payload(item, "series")
                for item in _moviebox_filter_items(
                    _moviebox_pick_category(categories, ["western", "tv"])
                    + _moviebox_pick_category(categories, ["top series"])
                    + list(getattr(hot, "tv_series", []) or []),
                    media_type="series",
                )[:20]
            ],
        },
        {
            "id": "anime",
            "title": "Anime",
            "subtitle": "Top anime on Movie Box",
            "items": [
                _moviebox_card_payload(item, "anime")
                for item in _moviebox_filter_items(
                    _moviebox_pick_category(categories, ["top anime"]) + combined,
                    media_type="anime",
                )[:20]
            ],
        },
        {
            "id": "other",
            "title": "Other",
            "subtitle": "Everything else worth exploring",
            "items": [
                _moviebox_card_payload(item, "other")
                for item in _moviebox_unique_items(
                    _moviebox_pick_category(categories, ["indian", "drama"])
                    + _moviebox_pick_category(categories, ["punjabi"])
                    + combined
                )
                if not _moviebox_is_anime(item)
            ][:20],
        },
    ]

    payload = {
        "sections": [section for section in sections if section["items"]],
        "popular_searches": [
            getattr(entry, "title", "")
            for entry in list(popular_searches or [])
            if getattr(entry, "title", "")
        ][:12],
    }
    # Phase 3: persist to SQLite with 6h TTL; also warm the in-memory dict cache for the session
    _moviebox_cache_set(cache_key, payload, ttl=_CACHE_TTL["discover"])
    return _sqlite_cache_set(cache_key, payload, "discover")


async def _moviebox_find_item(
    title: str,
    media_type: str,
    year: int | None = None,
    prefer_hindi: bool = True,
    anime_only: bool = False,
):
    _moviebox_assert_available()

    normalized_media_type = _moviebox_media_type_value(media_type)
    subject_type = MovieBoxSubjectType.ALL
    if normalized_media_type == "movie":
        subject_type = MovieBoxSubjectType.MOVIES
    elif normalized_media_type in {"series", "anime"}:
        subject_type = MovieBoxSubjectType.TV_SERIES

    session = MovieBoxSession(timeout=15)
    search = MovieBoxSearch(session, query=title, subject_type=subject_type, per_page=16)
    results = await search.get_content_model()

    items = list(getattr(results, "items", []) or [])
    if prefer_hindi and "hindi" not in (title or "").lower():
        extra_results = await MovieBoxSearch(
            session,
            query=f"{title} hindi",
            subject_type=subject_type,
            per_page=16,
        ).get_content_model()
        items.extend(list(getattr(extra_results, "items", []) or []))

    items = _moviebox_unique_items(items)
    items = _moviebox_filter_items(
        items,
        media_type=normalized_media_type,
        anime_only=normalized_media_type == "anime" or anime_only,
    )
    if not items:
        raise HTTPException(status_code=404, detail="Movie Box returned no matches")

    _moviebox_register_items(items)
    ranked = sorted(
        items,
        key=lambda item: _moviebox_match_score(
            item,
            title,
            year,
            prefer_hindi=prefer_hindi,
            anime_only=normalized_media_type == "anime" or anime_only,
        ),
        reverse=True,
    )
    return session, ranked[0]


async def _moviebox_find_non_hindi_item(
    title: str,
    media_type: str,
    year: int | None = None,
    anime_only: bool = False,
):
    _moviebox_assert_available()

    normalized_media_type = _moviebox_media_type_value(media_type)
    subject_type = MovieBoxSubjectType.ALL
    if normalized_media_type == "movie":
        subject_type = MovieBoxSubjectType.MOVIES
    elif normalized_media_type in {"series", "anime"}:
        subject_type = MovieBoxSubjectType.TV_SERIES

    session = MovieBoxSession(timeout=15)
    results = await MovieBoxSearch(session, query=title, subject_type=subject_type, per_page=16).get_content_model()
    items = _moviebox_filter_items(
        _moviebox_unique_items(list(getattr(results, "items", []) or [])),
        media_type=normalized_media_type,
        anime_only=normalized_media_type == "anime" or anime_only,
    )
    items = [item for item in items if not _moviebox_is_hindi(item)]
    if year is not None:
        year_matches = [item for item in items if _moviebox_release_year(item) == year]
        if year_matches:
            items = year_matches
    if not items:
        return session, None

    ranked = sorted(
        items,
        key=lambda item: _moviebox_match_score(
            item,
            title,
            year,
            prefer_hindi=False,
            anime_only=normalized_media_type == "anime" or anime_only,
        ),
        reverse=True,
    )
    return session, ranked[0]


async def _moviebox_resolve_item(
    subject_id: str | None = None,
    title: str | None = None,
    media_type: str = "movie",
    year: int | None = None,
    require_downloadable: bool = False,
):
    registered = _moviebox_get_registered_item(subject_id)
    if registered is not None and (
        not require_downloadable or _moviebox_supports_downloadable_detail(registered)
    ):
        return MovieBoxSession(timeout=15), registered

    if not title:
        raise HTTPException(status_code=400, detail="subject_id or title is required")

    return await _moviebox_find_item(title, media_type, year)


def _moviebox_subject_payload(item, detail_model=None) -> dict:
    detail_subject = None
    detail_dump = None
    if detail_model is not None:
        try:
            detail_dump = detail_model.resData.model_dump()
            detail_subject = detail_dump.get("subject", {})
        except Exception:
            detail_subject = None
            detail_dump = None

    description = getattr(item, "description", "") or ""
    if isinstance(detail_subject, dict) and detail_subject.get("description"):
        description = detail_subject["description"]

    payload = _moviebox_card_payload(item)
    payload["description"] = description
    payload["duration_seconds"] = getattr(item, "duration", 0) or 0
    season_episode_counts = _moviebox_extract_season_episode_counts(detail_dump or detail_model)

    payload["available_seasons"] = (
        sorted(season_episode_counts.keys()) or _moviebox_guess_seasons(payload["title"])
        if payload["moviebox_media_type"] == "series"
        else []
    )
    payload["season_episode_counts"] = season_episode_counts
    return payload


@router.get("/search")
async def moviebox_search(title: str, media_type: str = "movie", year: int | None = None):
    normalized_media_type = _moviebox_media_type_value(media_type)
    _, item = await _moviebox_find_item(title, normalized_media_type, year)
    return _moviebox_subject_payload(item)


@router.get("/discover")
async def moviebox_discover():
    return await _moviebox_discover_payload()


@router.get("/search-items")
async def moviebox_search_items(
    query: str,
    page: int = 1,
    per_page: int = 24,
    media_type: str = "all",
    hindi_only: bool = False,
    anime_only: bool = False,
    prefer_hindi: bool = True,
    sort_by: str = "search",
):
    normalized_media_type = _moviebox_media_type_value(media_type)
    safe_page = max(1, page)
    safe_per_page = min(max(1, per_page), 48)
    cache_key = (
        f"moviebox:search:{query}:{safe_page}:{safe_per_page}:{normalized_media_type}:"
        f"{hindi_only}:{anime_only}:{prefer_hindi}:{sort_by}"
    )
    # Phase 3: SQLite cache (30min TTL, search results go stale fast)
    cached_value, is_stale = _sqlite_cache_get(cache_key)
    if cached_value is not None:
        if is_stale:
            async def _refresh_search():
                await _moviebox_search_items_fetch_and_cache(
                    cache_key, query, safe_page, safe_per_page,
                    normalized_media_type, hindi_only, anime_only, prefer_hindi, sort_by,
                )
            _cache_trigger_bg_refresh(cache_key, _refresh_search)
        return cached_value

    return await _moviebox_search_items_fetch_and_cache(
        cache_key, query, safe_page, safe_per_page,
        normalized_media_type, hindi_only, anime_only, prefer_hindi, sort_by,
    )


async def _moviebox_search_items_fetch_and_cache(
    cache_key, query, safe_page, safe_per_page,
    normalized_media_type, hindi_only, anime_only, prefer_hindi, sort_by,
):

    _moviebox_assert_available()
    session = MovieBoxSession(timeout=20)
    subject_type = MovieBoxSubjectType.ALL
    if normalized_media_type == "movie":
        subject_type = MovieBoxSubjectType.MOVIES
    elif normalized_media_type in {"series", "anime"}:
        subject_type = MovieBoxSubjectType.TV_SERIES

    results = await MovieBoxSearch(
        session,
        query=query,
        subject_type=subject_type,
        page=safe_page,
        per_page=safe_per_page,
    ).get_content_model()
    items = list(getattr(results, "items", []) or [])

    if prefer_hindi and "hindi" not in query.lower():
        extra = await MovieBoxSearch(
            session,
            query=f"{query} hindi",
            subject_type=subject_type,
            page=1,
            per_page=min(24, safe_per_page),
        ).get_content_model()
        items.extend(list(getattr(extra, "items", []) or []))

    items = _moviebox_unique_items(items)
    _moviebox_register_items(items)
    items = _moviebox_filter_items(
        items,
        media_type=normalized_media_type,
        hindi_only=hindi_only,
        anime_only=anime_only or normalized_media_type == "anime",
    )
    ranked = sorted(
        _moviebox_sort_items(items, sort_by, query),
        key=lambda item: _moviebox_match_score(
            item,
            query,
            None,
            prefer_hindi=prefer_hindi,
            anime_only=anime_only or normalized_media_type == "anime",
        ),
        reverse=True,
    )

    payload = {
        "query": query,
        "page": safe_page,
        "per_page": safe_per_page,
        "media_type": normalized_media_type,
        "items": [_moviebox_card_payload(item, "search") for item in ranked],
    }
    # Phase 3: persist to SQLite with 30min TTL; warm in-memory dict too
    _moviebox_cache_set(cache_key, payload, ttl=_CACHE_TTL["search"])
    return _sqlite_cache_set(cache_key, payload, "search")


@router.get("/details")
async def moviebox_details(
    subject_id: str | None = None,
    title: str | None = None,
    media_type: str = "movie",
    year: int | None = None,
):
    normalized_media_type = _moviebox_media_type_value(media_type)

    # Phase 3: SQLite cache with 6h TTL for details (expensive to fetch)
    cache_key = f"moviebox:details:{subject_id or title}:{normalized_media_type}:{year}"
    cached_value, is_stale = _sqlite_cache_get(cache_key)
    if cached_value is not None:
        if is_stale:
            async def _refresh_details():
                await _moviebox_details_fetch_and_cache(cache_key, subject_id, title, normalized_media_type, year)
            _cache_trigger_bg_refresh(cache_key, _refresh_details)
        return cached_value

    return await _moviebox_details_fetch_and_cache(cache_key, subject_id, title, normalized_media_type, year)


async def _moviebox_details_fetch_and_cache(cache_key, subject_id, title, normalized_media_type, year):
    session, item = await _moviebox_resolve_item(subject_id, title, normalized_media_type, year)

    detail_model = None
    try:
        if normalized_media_type == "movie":
            detail_model = await MovieBoxMovieDetails(item, session).get_content_model()
        else:
            detail_model = await MovieBoxTVSeriesDetails(item, session).get_content_model()
    except Exception:
        detail_model = None

    payload = _moviebox_subject_payload(item, detail_model)

    if (
        payload.get("moviebox_media_type") == "series"
        and payload.get("is_hindi")
        and payload.get("title")
    ):
        try:
            canonical_title = _moviebox_base_title(str(payload.get("title") or ""))
            if canonical_title and canonical_title.lower() != str(payload.get("title") or "").lower():
                canonical_session, canonical_item = await _moviebox_find_non_hindi_item(
                    canonical_title,
                    normalized_media_type,
                    year,
                    anime_only=normalized_media_type == "anime",
                )
                if canonical_item and not _moviebox_is_hindi(canonical_item):
                    canonical_detail_model = None
                    try:
                        canonical_detail_model = await MovieBoxTVSeriesDetails(canonical_item, canonical_session).get_content_model()
                    except Exception:
                        canonical_detail_model = None
                    canonical_payload = _moviebox_subject_payload(canonical_item, canonical_detail_model)
                    if _moviebox_total_episode_count(canonical_payload.get("season_episode_counts")) > _moviebox_total_episode_count(payload.get("season_episode_counts")):
                        payload["available_seasons"] = canonical_payload.get("available_seasons", payload.get("available_seasons", []))
                        payload["season_episode_counts"] = canonical_payload.get("season_episode_counts", payload.get("season_episode_counts", {}))
        except Exception as _exc:
            backend_logger.debug("_moviebox_details canonical merge failed: %s", _exc, exc_info=False)

    result = {
        "provider": "MovieBox",
        "item": payload,
    }
    # Phase 3: persist to SQLite with 6h TTL; warm in-memory dict too
    _moviebox_cache_set(cache_key, result, ttl=_CACHE_TTL["details"])
    return _sqlite_cache_set(cache_key, result, "details")


@router.get("/sources")
async def moviebox_sources(
    subject_id: str | None = None,
    title: str | None = None,
    media_type: str = "movie",
    year: int | None = None,
    season: int = 1,
    episode: int = 1,
):
    normalized_media_type = _moviebox_media_type_value(media_type)
    if normalized_media_type == "all":
        raise HTTPException(status_code=400, detail="media_type must not be 'all' for sources")

    cache_key = f"moviebox:sources:{subject_id or title}:{normalized_media_type}:{year}:{season}:{episode}"
    cached = _moviebox_cache_get(cache_key)
    if cached is not None:
        return cached

    session, item = await _moviebox_resolve_item(
        subject_id,
        title,
        normalized_media_type,
        year,
        require_downloadable=True,
    )

    try:
        if normalized_media_type == "movie":
            files = await DownloadableMovieFilesDetail(session, item).get_content_model()
        else:
            files = await DownloadableTVSeriesFilesDetail(session, item).get_content_model(season, episode)
    except Exception as exc:
        print(
            f"[GRABIX] MovieBox source resolution failed: title={getattr(item, 'title', title or '')} "
            f"subject_id={getattr(item, 'id', subject_id or '')} media_type={normalized_media_type} "
            f"season={season} episode={episode} error={exc}"
        )
        raise HTTPException(status_code=502, detail="Movie Box could not resolve playable files for this title")

    downloads = sorted(
        list(getattr(files, "downloads", []) or []),
        key=lambda media_file: int(getattr(media_file, "resolution", 0) or 0),
        reverse=True,
    )

    if not downloads:
        raise HTTPException(status_code=404, detail="Movie Box returned no playable files")

    captions = [
        _moviebox_caption_payload(caption)
        for caption in list(getattr(files, "captions", []) or [])
        if str(getattr(caption, "url", "") or "")
    ]

    payload = {
        "provider": "MovieBox",
        "media_type": normalized_media_type,
        "title": getattr(item, "title", title or ""),
        "year": _moviebox_release_year(item),
        "season": season if normalized_media_type != "movie" else None,
        "episode": episode if normalized_media_type != "movie" else None,
        "item": _moviebox_subject_payload(item),
        "subtitles": captions,
        "sources": [_moviebox_source_payload(media_file, captions) for media_file in downloads],
    }
    return _moviebox_cache_set(cache_key, payload, ttl=60 * 10)


def _moviebox_srt_to_vtt(content: str) -> str:
    safe_content = (content or "").replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
    if safe_content.startswith("WEBVTT"):
        return safe_content

    converted_lines = ["WEBVTT", ""]
    for line in safe_content.split("\n"):
        converted_lines.append(line.replace(",", ".") if "-->" in line else line)
    return "\n".join(converted_lines)


@router.get("/subtitle")
def moviebox_subtitle(url: str):
    try:
        _validate_outbound_url(url)
        request = URLRequest(
            url,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://moviebox.ng/",
            },
        )
        with urlopen(request, timeout=20) as response:
            content = response.read().decode("utf-8", errors="ignore")
        return Response(content=_moviebox_srt_to_vtt(content), media_type="text/vtt")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Subtitle fetch failed: {exc}")


@router.get("/poster")
def moviebox_poster(url: str):
    try:
        request = URLRequest(
            url,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://moviebox.ng/",
            },
        )
        with urlopen(request, timeout=20) as response:
            content = response.read()
            media_type = response.headers.get("Content-Type", "image/jpeg")
        return Response(
            content=content,
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Movie Box poster fetch failed: {exc}")


@router.get("/proxy-stream")
def moviebox_proxy_stream(url: str, request: Request):
    try:
        headers = dict(MOVIEBOX_DOWNLOAD_REQUEST_HEADERS or {})
        headers.setdefault("User-Agent", "Mozilla/5.0")
        range_header = request.headers.get("range")
        if range_header:
            headers["Range"] = range_header

        upstream_request = URLRequest(url, headers=headers)
        upstream_response = urlopen(upstream_request, timeout=30)

        response_headers = {}
        for header_name in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"):
            header_value = upstream_response.headers.get(header_name)
            if header_value:
                response_headers[header_name] = header_value

        media_type = upstream_response.headers.get("Content-Type", "video/mp4")

        def iter_stream():
            try:
                while True:
                    chunk = upstream_response.read(1024 * 256)
                    if not chunk:
                        break
                    yield chunk
            finally:
                upstream_response.close()

        return StreamingResponse(
            iter_stream(),
            status_code=getattr(upstream_response, "status", 200),
            headers=response_headers,
            media_type=media_type,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Movie Box stream proxy failed: {exc}")


