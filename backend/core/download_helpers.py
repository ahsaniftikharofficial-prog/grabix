"""
core/download_helpers.py
Download URL normalization, category inference, tag normalization,
and the auto-retry-failed background worker.
Extracted from main.py (Phase 2 split).
"""
import logging
import threading
import time

from app.services.logging_utils import get_logger, log_event
from app.services.runtime_config import public_base_url
from app.services.security import (
    DEFAULT_APPROVED_MEDIA_HOSTS,
    normalize_download_target as security_normalize_download_target,
)

# Try to pull the moviebox request headers; fall back to {} if unavailable.
try:
    from moviebox import MOVIEBOX_DOWNLOAD_REQUEST_HEADERS as _MOVIEBOX_HEADERS
except (ImportError, AttributeError):
    _MOVIEBOX_HEADERS = {}

# ---------------------------------------------------------------------------
# Module-level state injected by main.py via init()
# ---------------------------------------------------------------------------
_downloads: dict = {}
_download_controls: dict = {}
_downloads_logger = get_logger("downloads")

# These are injected from downloads.engine at init time to avoid circular imports.
_db_update_status = None
_persist_download_record = None
_start_download_thread = None

_auto_retry_failed_started = False
_TRANSIENT_FAILURE_CODES = {"download_failed", "restart_interrupted"}
_AUTO_RETRY_LIMIT = 3
_AUTO_RETRY_DELAY = 5 * 60  # seconds


def init(
    downloads: dict,
    download_controls: dict,
    db_update_status,
    persist_download_record,
    start_download_thread,
    downloads_logger=None,
) -> None:
    """Called once by main.py after runtime_state is created."""
    global _downloads, _download_controls, _db_update_status
    global _persist_download_record, _start_download_thread, _downloads_logger
    _downloads = downloads
    _download_controls = download_controls
    _db_update_status = db_update_status
    _persist_download_record = persist_download_record
    _start_download_thread = start_download_thread
    if downloads_logger is not None:
        _downloads_logger = downloads_logger


# ---------------------------------------------------------------------------
# Download URL / category helpers
# ---------------------------------------------------------------------------

def _normalize_download_target(url: str, headers_json: str = "") -> tuple[str, str]:
    return security_normalize_download_target(
        url,
        self_base_url=public_base_url(),
        headers_json=headers_json,
        moviebox_headers=dict(_MOVIEBOX_HEADERS or {}),
        allowed_hosts=DEFAULT_APPROVED_MEDIA_HOSTS,
    )


_ANIME_SITES = (
    "hianime", "aniwatch", "gogoanime", "9anime", "animepahe",
    "zoro.to", "animixplay", "animekisa", "crunchyroll", "funimation",
)
_MOVIE_SITES = (
    "moviebox", "moviesbox", "netflixmirror", "123movies",
    "fmovies", "putlocker", "primewire", "yifymovie", "yts.mx",
    "hdmovie", "5movies", "flixtor", "soap2day",
)
_MANGA_SITES = ("mangadex", "mangakakalot", "manganato", "comick", "webtoon")

_CATEGORY_LABEL_MAP: dict[str, str] = {
    "movie": "Movies",
    "movies": "Movies",
    "film": "Movies",
    "tv": "TV Series",
    "show": "TV Series",
    "series": "TV Series",
    "tv series": "TV Series",
    "anime": "Anime",
    "manga": "Manga",
    "youtube": "YouTube",
    "yt": "YouTube",
    "book": "Books",
    "books": "Books",
    "comic": "Comics",
    "comics": "Comics",
    "light novel": "Light Novels",
    "light novels": "Light Novels",
    "subtitle": "Subtitles",
    "subtitles": "Subtitles",
    "audio": "Audio",
    "music": "Audio",
}


def _normalize_category_label(value: str) -> str:
    cleaned = " ".join(str(value or "").split())
    if not cleaned:
        return ""
    return _CATEGORY_LABEL_MAP.get(cleaned.lower(), cleaned.title())


def _infer_download_category(url: str, title: str, dl_type: str, category: str = "") -> str:
    if category:
        return _normalize_category_label(category)
    if dl_type == "subtitle":
        return "Subtitles"
    if dl_type == "audio":
        return "Audio"
    lowered_url = (url or "").lower()
    lowered_title = (title or "").lower()

    if "youtube.com" in lowered_url or "youtu.be" in lowered_url:
        return "YouTube"
    if any(site in lowered_url for site in _ANIME_SITES):
        return "Anime"
    if any(site in lowered_url for site in _MOVIE_SITES):
        return "Movies"
    if any(site in lowered_url for site in _MANGA_SITES):
        return "Manga"

    if "anime" in lowered_title or ("episode" in lowered_title and "manga" not in lowered_title):
        return "Anime"
    if "manga" in lowered_title:
        return "Manga"
    return ""


def _infer_library_display_layout(url: str, title: str, dl_type: str, category: str = "") -> str:
    cat = _infer_download_category(url, title, dl_type, category)
    if cat in ("Anime", "TV Series"):
        return "episodes"
    if cat == "Manga":
        return "chapters"
    return "grid"


def _normalize_tags_csv(tags_csv: str = "", category: str = "", dl_type: str = "") -> str:
    tokens: list[str] = []
    for raw in str(tags_csv or "").split(","):
        cleaned = " ".join(raw.split())
        if cleaned:
            tokens.append(cleaned)
    if category:
        tokens.append(category)
    if dl_type:
        tokens.append(dl_type)

    deduped: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        key = token.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(token)
    return ",".join(deduped)


# ---------------------------------------------------------------------------
# RESILIENCE: Auto-retry failed downloads (Fix 8)
# Checks every 60s. Any failed download re-queues itself after 5 min,
# up to 3 times. No user action needed.
# ---------------------------------------------------------------------------

def _auto_retry_failed_worker() -> None:
    while True:
        try:
            time.sleep(60)
            now = time.time()
            for dl_id, item in list(_downloads.items()):
                if item.get("status") != "failed":
                    continue
                if item.get("failure_code", "") not in _TRANSIENT_FAILURE_CODES:
                    continue
                if int(item.get("retry_count", 0) or 0) >= _AUTO_RETRY_LIMIT:
                    continue
                failed_at = float(item.get("_failed_at", 0) or 0)
                if failed_at == 0:
                    item["_failed_at"] = now
                    continue
                if now - failed_at < _AUTO_RETRY_DELAY:
                    continue
                ctrl = _download_controls.get(dl_id)
                if ctrl:
                    ctrl["pause"].clear()
                    ctrl["cancel"].clear()
                retry_count = int(item.get("retry_count", 0) or 0)
                item.update({
                    "status": "queued",
                    "percent": 0, "speed": "", "eta": "",
                    "downloaded": "", "total": "", "size": "",
                    "error": "", "file_path": "",
                    "partial_file_path": item.get("partial_file_path", ""),
                    "recoverable": False, "failure_code": "",
                    "retry_count": retry_count + 1,
                    "stage_label": f"Auto-retrying (attempt {retry_count + 1}/{_AUTO_RETRY_LIMIT})...",
                    "_failed_at": 0,
                })
                if _db_update_status:
                    _db_update_status(dl_id, "queued")
                if _persist_download_record:
                    _persist_download_record(dl_id, force=True)
                if _start_download_thread:
                    _start_download_thread(dl_id)
                log_event(
                    _downloads_logger, logging.INFO,
                    event="download_auto_retried",
                    message="Download auto-retried after failure.",
                    details={"download_id": dl_id, "retry_count": retry_count + 1},
                )
        except Exception as _exc:
            _downloads_logger.warning(
                "_auto_retry_failed_worker iteration failed: %s", _exc, exc_info=False
            )


def _start_auto_retry_failed_worker() -> None:
    global _auto_retry_failed_started
    if _auto_retry_failed_started:
        return
    _auto_retry_failed_started = True
    threading.Thread(
        target=_auto_retry_failed_worker, daemon=True, name="auto-retry-failed"
    ).start()
