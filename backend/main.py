import asyncio
import atexit
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
import os, uuid, sqlite3, shutil, threading, subprocess, time, json, re, hashlib, socket, ipaddress, tempfile, zipfile, importlib, queue as _queue
import concurrent.futures
import ctypes
from pathlib import Path
from datetime import datetime, timezone
from difflib import SequenceMatcher
from urllib.parse import parse_qs, quote, unquote, urljoin, urlparse, urlencode
from urllib.request import Request as URLRequest, urlopen
from pydantic import BaseModel
from app.routes.aniwatch import router as aniwatch_router
from app.routes.consumet import router as consumet_router
from app.routes.downloads import router as downloads_router
from app.routes.manga import router as manga_router
from app.routes.metadata import router as metadata_router
from app.routes.providers import router as providers_router
from app.routes.settings import router as settings_router
from app.routes.streaming import router as streaming_router
from app.routes.subtitles import router as subtitles_router
from moviebox import router as moviebox_router, start_bg_retry as _moviebox_start_bg_retry, restore_from_last_session as _moviebox_restore_from_last_session
from anime import router as anime_router
from downloads import router as downloads_engine_router, register_handlers as _register_download_handlers
from downloads.engine import (
    ensure_runtime_bootstrap,
    recover_download_jobs,
    _service_payload as _service_payload_base,
    _downloads_health,
    _database_health,
    _is_direct_media_url,
    _is_direct_subtitle_url,
    _persist_download_record,
    _start_download_thread,
    ffmpeg_status,
    list_downloads,
    storage_stats,
)

# Compatibility wrapper: the installed downloads.engine._service_payload only
# accepts (name, status, message=None).  main.py calls it with up to 5 args
# (name, status, message, critical, details).  This shim bridges the gap so
# both the old engine and the new call-sites work without modifying the engine.
def _service_payload(name: str, status: str, message: str = "", critical: bool = False, details: dict | None = None) -> dict:
    base = _service_payload_base(name, status, message) if message else _service_payload_base(name, status)
    if isinstance(base, dict):
        base.setdefault("critical", critical)
        if details:
            base.setdefault("details", details)
        return base
    # Fallback if base returned something unexpected
    result: dict = {"name": name, "status": status, "message": message, "critical": critical}
    if details:
        result["details"] = details
    return result
from app.services.consumet import (
    get_health_status as get_consumet_health_status,
    is_consumet_configured as is_consumet_sidecar_configured,
)
from app.services.megacloud import run_key_health_worker
from app.services.errors import json_error_response
from app.services.logging_utils import LOG_DIR, backend_log_path, get_logger, log_event, read_recent_log_events
from app.services.archive_installer import parse_checksum_manifest, safe_extract_zip, sha256_file
from app.services.desktop_auth import DESKTOP_AUTH_HEADER, desktop_auth_state_snapshot, validate_desktop_auth_request
from app.services.network_policy import validate_outbound_target
from app.services.runtime_config import (
    app_state_root,
    backend_port,
    bundled_tools_dir,
    db_path as runtime_db_path,
    default_download_dir,
    public_base_url,
    runtime_config_snapshot,
    runtime_tools_dir,
    settings_path as runtime_settings_path,
)
from app.services.settings_service import (
    configure_adult_content_password,
    get_settings_payload as build_settings_payload,
    settings_public_payload as build_public_settings_payload,
    unlock_adult_content_password,
    update_settings_payload as build_updated_settings_payload,
)
from app.services.runtime_state import RuntimeStateRegistry
from app.services.security import (
    DEFAULT_APPROVED_MEDIA_HOSTS,
    DEFAULT_LOCAL_APP_ORIGINS,
    ensure_safe_managed_path,
    normalize_download_target as security_normalize_download_target,
    redact_for_diagnostics,
    validate_outbound_url as security_validate_outbound_url,
)

# ── Phase 6: Safe main.py split ───────────────────────────────────────────────
# db_helpers.py      → DB helpers, settings, format utils, path constants
# library_helpers.py → Library index, reconcile, history helpers
#
# Imported and re-bound here so all existing code inside main.py and any
# external `from main import X` calls keep working with zero changes.
from db_helpers import (
    get_db_connection,
    db_insert,
    db_update_status,
    db_upsert_download_job,
    db_delete_download_job,
    db_list_download_jobs,
    DEFAULT_SETTINGS,
    load_settings,
    save_settings_to_disk,
    _strip_ansi,
    _format_bytes,
    _format_bytes_int,
    _format_eta,
    _sanitize_download_engine,
    _get_file_size,
    _guess_dl_type_from_path,
    has_ffmpeg,
    has_aria2,
)
from library_helpers import (
    migrate_db,
    _build_library_index,
    _reconcile_library_state,
)
from streaming_helpers import (
    _extract_iframe_src,
    _fetch_json,
    _normalize_request_headers,
    _rewrite_hls_playlist,
    _extract_hls_variants,
    _looks_like_playable_media_url,
    _extract_stream_url,
    _resolve_embed_target,
    resolve_embed,
    stream_proxy,
    stream_variants,
    _extract_stream_url_via_browser,
    extract_stream,
)
# ─────────────────────────────────────────────────────────────────────────────

# FIX: Override _service_payload from downloads.engine — the installed version
# only accepted 2–3 positional args, but main.py calls it with 4–5.
# Correct signature: (name, status, message=None, critical=False, details=None)
def _service_payload(name: str, status: str, message: str | None = None, critical: bool = False, details: dict | None = None) -> dict:
    payload: dict = {"name": name, "status": status}
    if message is not None:
        payload["message"] = message
    payload["critical"] = critical
    if details:
        payload["details"] = details
    return payload

try:
    import bcrypt
    BCRYPT_AVAILABLE = True
except Exception:
    bcrypt = None
    BCRYPT_AVAILABLE = False

@asynccontextmanager
async def _grabix_lifespan(app: FastAPI):
    """
    FastAPI lifespan handler — replaces deprecated @app.on_event("startup").
    Captures the running event loop and completes the runtime bootstrap.
    """
    global _app_event_loop
    _app_event_loop = asyncio.get_running_loop()
    ensure_runtime_bootstrap()
    recover_download_jobs()  # FIX: restore interrupted downloads after restart
    # Start the MegaCloud key health worker — keeps the client key fresh in the background
    asyncio.create_task(run_key_health_worker(interval_seconds=1200.0))
    yield


app = FastAPI(lifespan=_grabix_lifespan)
LOCAL_APP_ORIGINS = list(DEFAULT_LOCAL_APP_ORIGINS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=LOCAL_APP_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Range", "X-Request-ID", DESKTOP_AUTH_HEADER],
)
app.include_router(aniwatch_router, prefix="/aniwatch")
app.include_router(consumet_router, prefix="/consumet")
app.include_router(downloads_router)
app.include_router(manga_router, prefix="/manga")
app.include_router(metadata_router)
app.include_router(providers_router)
app.include_router(settings_router)
app.include_router(streaming_router)
app.include_router(subtitles_router, prefix="/subtitles")
app.include_router(moviebox_router, prefix="/moviebox")
app.include_router(anime_router, prefix="/anime")
app.include_router(downloads_engine_router)
backend_logger = get_logger("backend")
downloads_logger = get_logger("downloads")
library_logger = get_logger("library")
playback_logger = get_logger("playback")

DOWNLOAD_DIR = str(default_download_dir())
DB_PATH = str(runtime_db_path())
SETTINGS_PATH = str(runtime_settings_path())
RUNTIME_TOOLS_DIR = runtime_tools_dir()

# Always create the download directory before any DB or file operations
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# In-memory progress store
runtime_state = RuntimeStateRegistry()
downloads: dict = runtime_state.downloads
download_controls: dict = runtime_state.download_controls


def _terminate_all_aria2_processes() -> None:
    """Kill every active aria2 subprocess on backend shutdown.
    This is the Windows fallback — on Unix, --stop-with-process handles it cleanly.
    atexit handlers run on sys.exit() and normal termination; SIGKILL bypasses them,
    but Tauri typically sends SIGTERM first, which triggers atexit on Python.
    """
    for ctrl in list(download_controls.values()):
        if ctrl.get("process_kind") == "aria2":
            proc = ctrl.get("process")
            if proc is not None and proc.poll() is None:
                try:
                    proc.terminate()
                except Exception as _exc:
                    downloads_logger.debug("aria2 process.terminate() skipped — process already gone: %s", _exc, exc_info=False)


atexit.register(_terminate_all_aria2_processes)
FFMPEG_PATH = shutil.which("ffmpeg")
ARIA2_PATH = shutil.which("aria2c")
SELF_BASE_URL = public_base_url()
STREAM_EXTRACT_CACHE_TTL_SECONDS = 900
stream_extract_cache: dict[str, tuple[float, dict]] = runtime_state.stream_extract_cache
ADULT_UNLOCK_WINDOW_SECONDS = 300
ADULT_UNLOCK_MAX_ATTEMPTS = 5
adult_unlock_attempts: dict[str, list[float]] = runtime_state.adult_unlock_attempts
APPROVED_MEDIA_HOSTS = DEFAULT_APPROVED_MEDIA_HOSTS
# ANIME_RESOLVE_CACHE_TTL_SECONDS and anime_resolve_cache → moved to anime/resolver.py
CONSUMET_HEALTH_CACHE_TTL_SECONDS = 15
consumet_health_cache: tuple[float, dict] | None = None
dependency_install_jobs: dict[str, dict] = runtime_state.dependency_install_jobs

RUNTIME_BOOTSTRAP_LOCK = threading.Lock()
RUNTIME_BOOTSTRAP_STATE = {
    "started": False,
    "completed": False,
    "failed": False,
    "step": "",
    "error": "",
}
_network_monitor_started = False
_auto_retry_failed_started = False
_app_event_loop: asyncio.AbstractEventLoop | None = None


# --- LAZY YT_DLP LOADER ---
# yt_dlp is NOT imported at startup. Imported on first use only.
# Saves ~1 second of startup time (yt_dlp is a heavy import).
_yt_dlp_mod = None

def _load_yt_dlp():
    """Return the real yt_dlp module, importing it on first call."""
    global _yt_dlp_mod
    if _yt_dlp_mod is None:
        try:
            import yt_dlp as _mod
            _yt_dlp_mod = _mod
        except Exception as exc:
            raise RuntimeError(f"yt_dlp is not available: {exc}") from exc
    return _yt_dlp_mod


class _LazyYtDlpProxy:
    def __getattr__(self, name: str):
        return getattr(_load_yt_dlp(), name)


yt_dlp = _LazyYtDlpProxy()


def _get_yt_dlp():
    return yt_dlp


def refresh_runtime_tools() -> None:
    global FFMPEG_PATH, ARIA2_PATH
    FFMPEG_PATH = _resolve_runtime_binary("ffmpeg", ["ffmpeg.exe", "ffmpeg"])
    ARIA2_PATH = _resolve_runtime_binary("aria2", ["aria2c.exe", "aria2c"])
    for tool_path in {Path(path).parent for path in [FFMPEG_PATH, ARIA2_PATH] if path}:
        existing = os.environ.get("PATH", "")
        normalized = str(tool_path)
        if normalized and normalized.lower() not in existing.lower():
            os.environ["PATH"] = f"{normalized}{os.pathsep}{existing}" if existing else normalized


def _resolve_runtime_binary(tool_id: str, names: list[str]) -> str | None:
    # 1. Check the bundled tools dir shipped inside the installer (highest priority).
    bundled = bundled_tools_dir()
    if bundled:
        bundled_tool_dir = bundled / tool_id
        if bundled_tool_dir.exists():
            for name in names:
                candidates = list(bundled_tool_dir.rglob(name))
                if candidates:
                    return str(candidates[0])

    # 2. Check system PATH (covers user-installed or winget-installed versions).
    for name in names:
        found = shutil.which(name)
        if found:
            return found

    # 3. Check the managed runtime dir (previously downloaded via the Install button).
    managed_dir = RUNTIME_TOOLS_DIR / tool_id
    if managed_dir.exists():
        for name in names:
            candidates = list(managed_dir.rglob(name))
            if candidates:
                return str(candidates[0])
    return None


# AnimeResolveRequest → moved to anime/resolver.py

class AdultContentUnlockRequest(BaseModel):
    password: str


class AdultContentConfigureRequest(BaseModel):
    password: str


def _correlation_id_from_request(request: Request | None) -> str:
    if request is None:
        return ""
    return str(getattr(request.state, "correlation_id", "") or request.headers.get("X-Request-ID", "")).strip()


@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
    correlation_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.correlation_id = correlation_id
    auth_failure = validate_desktop_auth_request(request)
    if auth_failure is not None:
        payload = dict(auth_failure["payload"])
        log_event(
            backend_logger,
            logging.WARNING,
            event=str(payload.get("code") or "desktop_auth_rejected"),
            message=f"{request.method} {request.url.path} was blocked by desktop auth.",
            correlation_id=correlation_id,
            details={"path": request.url.path, "method": request.method},
        )
        response = json_error_response(
            status_code=int(auth_failure["status_code"]),
            detail=payload,
            request=request,
            service="security",
        )
        response.headers["X-Request-ID"] = correlation_id
        return response
    try:
        response = await call_next(request)
    except Exception as exc:
        log_event(
            backend_logger,
            logging.ERROR,
            event="request_error",
            message=f"{request.method} {request.url.path} failed.",
            correlation_id=correlation_id,
            details={"error": str(exc), "path": request.url.path, "method": request.method},
        )
        raise
    response.headers["X-Request-ID"] = correlation_id
    if response.status_code >= 500:
        log_event(
            backend_logger,
            logging.ERROR,
            event="request_5xx",
            message=f"{request.method} {request.url.path} returned {response.status_code}.",
            correlation_id=correlation_id,
            details={"path": request.url.path, "method": request.method, "status_code": response.status_code},
        )
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return json_error_response(status_code=exc.status_code, detail=exc.detail, request=request)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    correlation_id = _correlation_id_from_request(request)
    log_event(
        backend_logger,
        logging.ERROR,
        event="unhandled_exception",
        message=f"{request.method} {request.url.path} crashed unexpectedly.",
        correlation_id=correlation_id,
        details={"error": str(exc), "path": request.url.path, "method": request.method},
    )
    response = json_error_response(
        status_code=500,
        detail="An unexpected backend error occurred.",
        request=request,
    )
    response.headers["X-Request-ID"] = correlation_id
    return response


if os.name == "nt":
    PROCESS_SUSPEND_RESUME = 0x0800
    PROCESS_TERMINATE = 0x0001
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _ntdll = ctypes.WinDLL("ntdll", use_last_error=True)
else:
    PROCESS_SUSPEND_RESUME = 0
    PROCESS_TERMINATE = 0
    PROCESS_QUERY_LIMITED_INFORMATION = 0
    _kernel32 = None
    _ntdll = None



def _client_key(request: Request | None = None) -> str:
    if request and request.client and request.client.host:
        return request.client.host
    return "local"


def _normalize_unlock_attempts(client_key: str) -> list[float]:
    cutoff = time.time() - ADULT_UNLOCK_WINDOW_SECONDS
    attempts = [stamp for stamp in adult_unlock_attempts.get(client_key, []) if stamp >= cutoff]
    adult_unlock_attempts[client_key] = attempts
    return attempts


def _record_unlock_failure(client_key: str) -> int:
    attempts = _normalize_unlock_attempts(client_key)
    attempts.append(time.time())
    adult_unlock_attempts[client_key] = attempts
    return len(attempts)


def _ensure_unlock_not_throttled(client_key: str):
    attempts = _normalize_unlock_attempts(client_key)
    if len(attempts) >= ADULT_UNLOCK_MAX_ATTEMPTS:
        retry_after = max(1, int(ADULT_UNLOCK_WINDOW_SECONDS - (time.time() - attempts[0])))
        raise HTTPException(status_code=429, detail=f"Too many failed attempts. Try again in {retry_after} seconds.")


def _hash_adult_password(password: str) -> str:
    if not BCRYPT_AVAILABLE:
        raise HTTPException(status_code=500, detail="bcrypt is required before configuring the adult-content password.")
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_adult_password(password: str, hashed_value: str) -> bool:
    if not password or not hashed_value or not BCRYPT_AVAILABLE:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed_value.encode("utf-8"))
    except ValueError:
        return False


def _validate_outbound_url(url: str, *, allowed_hosts: tuple[str, ...] = APPROVED_MEDIA_HOSTS) -> str:
    return security_validate_outbound_url(url, allowed_hosts=allowed_hosts)


def _normalize_download_target(url: str, headers_json: str = "") -> tuple[str, str]:
    return security_normalize_download_target(
        url,
        self_base_url=SELF_BASE_URL,
        headers_json=headers_json,
        moviebox_headers=dict(MOVIEBOX_DOWNLOAD_REQUEST_HEADERS or {}),
        allowed_hosts=APPROVED_MEDIA_HOSTS,
    )


def _infer_download_category(url: str, title: str, dl_type: str, category: str = "") -> str:
    if category:
        return _normalize_category_label(category)
    if dl_type == "subtitle":
        return "Subtitles"
    if dl_type == "audio":
        return "Audio"
    lowered_url = (url or "").lower()
    lowered_title = (title or "").lower()

    # YouTube
    if "youtube.com" in lowered_url or "youtu.be" in lowered_url:
        return "YouTube"

    # Anime streaming sites
    _ANIME_SITES = ("hianime", "aniwatch", "gogoanime", "9anime", "animepahe",
                    "zoro.to", "animixplay", "animekisa", "crunchyroll", "funimation")
    if any(site in lowered_url for site in _ANIME_SITES):
        return "Anime"

    # Movie / TV streaming sites
    _MOVIE_SITES = ("moviebox", "moviesbox", "netflixmirror", "123movies",
                    "fmovies", "putlocker", "primewire", "yifymovie", "yts.mx",
                    "hdmovie", "5movies", "flixtor", "soap2day")
    if any(site in lowered_url for site in _MOVIE_SITES):
        return "Movies"

    # Manga sites
    _MANGA_SITES = ("mangadex", "mangakakalot", "manganato", "comick", "webtoon")
    if any(site in lowered_url for site in _MANGA_SITES):
        return "Manga"

    # Title-based fallbacks
    if "anime" in lowered_title or ("episode" in lowered_title and "manga" not in lowered_title):
        return "Anime"
    if "manga" in lowered_title:
        return "Manga"

    # Unknown — return empty so the frontend can handle it
    return ""


def _infer_library_display_layout(url: str, title: str, dl_type: str, category: str = "") -> str:
    cat = _infer_download_category(url, title, dl_type, category)
    if cat in ("Anime", "TV Series"):
        return "episodes"
    if cat == "Manga":
        return "chapters"
    return "grid"


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


# ── DB Setup ──────────────────────────────────────────────────────────────────

# init_db moved to db_helpers.py to avoid circular import with downloads.engine
from db_helpers import init_db  # noqa: E402  (import after constants)

# Runtime bootstrap happens after module import so packaged startup cannot call
# helpers before they are defined.


# ---------------------------------------------------------------------------
# Phase 2 — Provider Status Persistence + Background Auto-Retry
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# RESILIENCE: Network change monitor (Fix 7)
# Pings 8.8.8.8 every 15s. WiFi drops -> pauses all active downloads.
# WiFi restores -> auto-resumes them. No silent hangs.
# ---------------------------------------------------------------------------
_network_was_online: bool = True

def _check_network() -> bool:
    try:
        socket.setdefaulttimeout(5)
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.connect(("8.8.8.8", 53))
        s.close()
        return True
    except Exception:
        return False

def _network_monitor_worker() -> None:
    global _network_was_online
    while True:
        try:
            time.sleep(15)
            online = _check_network()
            if not online and _network_was_online:
                _network_was_online = False
                for dl_id, item in list(downloads.items()):
                    if item.get("status") in {"downloading", "queued"}:
                        ctrl = download_controls.get(dl_id)
                        if ctrl and item.get("can_pause"):
                            ctrl["pause"].set()
                            item["paused_from"] = item.get("status", "downloading")
                            item["status"] = "paused"
                            item["stage_label"] = "Waiting for network..."
                            item["error"] = ""
                            _persist_download_record(dl_id, force=True)
            elif online and not _network_was_online:
                _network_was_online = True
                for dl_id, item in list(downloads.items()):
                    if (item.get("status") == "paused"
                            and item.get("stage_label", "") == "Waiting for network..."):
                        ctrl = download_controls.get(dl_id)
                        if ctrl:
                            ctrl["pause"].clear()
                            item["status"] = item.pop("paused_from", "downloading")
                            item["stage_label"] = "Reconnecting..."
                            item["error"] = ""
                            _persist_download_record(dl_id, force=True)
                            _start_download_thread(dl_id)
        except Exception as _exc:
            backend_logger.warning("_network_monitor_worker iteration failed: %s", _exc, exc_info=False)


def _start_network_monitor() -> None:
    global _network_monitor_started
    if _network_monitor_started:
        return
    _network_monitor_started = True
    threading.Thread(target=_network_monitor_worker, daemon=True, name="network-monitor").start()

# ---------------------------------------------------------------------------
# RESILIENCE: Auto-retry failed downloads (Fix 8)
# Checks every 60s. Any failed download re-queues itself after 5 min,
# up to 3 times. No user action needed.
# ---------------------------------------------------------------------------
_TRANSIENT_FAILURE_CODES = {"download_failed", "restart_interrupted"}
_AUTO_RETRY_LIMIT = 3
_AUTO_RETRY_DELAY = 5 * 60

def _auto_retry_failed_worker() -> None:
    while True:
        try:
            time.sleep(60)
            now = time.time()
            for dl_id, item in list(downloads.items()):
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
                ctrl = download_controls.get(dl_id)
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
                db_update_status(dl_id, "queued")
                _persist_download_record(dl_id, force=True)
                _start_download_thread(dl_id)
                log_event(downloads_logger, logging.INFO,
                          event="download_auto_retried",
                          message="Download auto-retried after failure.",
                          details={"download_id": dl_id, "retry_count": retry_count + 1})
        except Exception as _exc:
            downloads_logger.warning("_auto_retry_failed_worker iteration failed: %s", _exc, exc_info=False)


def _start_auto_retry_failed_worker() -> None:
    global _auto_retry_failed_started
    if _auto_retry_failed_started:
        return
    _auto_retry_failed_started = True
    threading.Thread(target=_auto_retry_failed_worker, daemon=True, name="auto-retry-failed").start()

# Per-content-type TTLs (seconds)
_CACHE_TTL: dict[str, int] = {
    "discover":        6 * 3600,    # trending / homepage  → 6 h
    "details":         6 * 3600,    # item details         → 6 h
    "manga_chapters":  12 * 3600,   # manga chapter lists  → 12 h
    "search":          30 * 60,     # search results       → 30 min
    "generic":         15 * 60,     # fallback             → 15 min
    "moviebox":        60 * 15,  # moviebox results → 15 min (= MOVIEBOX_CACHE_TTL_SECONDS)
}

# Stale-while-revalidate grace period multiplier
# If entry is within TTL * _CACHE_STALE_GRACE it's returned instantly;
# a background task refreshes it silently.
_CACHE_STALE_GRACE = 2.0

# Maximum cache size on disk (50 MB expressed in characters — JSON text)
_CACHE_MAX_BYTES = 50 * 1024 * 1024

# Background refresh tasks that are currently running (deduplicated by key)
_cache_bg_refresh_keys: set[str] = set()
_cache_bg_refresh_lock = threading.Lock()
_cache_access_log: dict[str, float] = {}
_cache_access_lock = threading.Lock()
_CACHE_ACCESS_FLUSH_INTERVAL = 60.0
_cache_access_flusher_started = False


def _sqlite_cache_get(key: str) -> tuple[object | None, bool]:
    """
    Returns (value, is_stale).
    value=None  → full cache miss (caller must fetch fresh).
    is_stale=True → value was returned but TTL has expired; caller should
                    trigger a background refresh while the stale value is
                    served immediately (stale-while-revalidate).
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
            return value, False          # fresh hit
        if now <= stale_deadline:
            return value, True           # stale-but-usable hit
        # Entry is too old — treat as miss
        return None, False
    except Exception as exc:
        log_event(backend_logger, logging.DEBUG, event="cache_get_error", message="SQLite cache get failed.", details={"key": key, "error": str(exc)})
        return None, False


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
        backend_logger.warning("_flush_cache_access_log failed: %s", _exc, exc_info=False)


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
        # LRU eviction: check total size and drop oldest entries
        try:
            total = con.execute("SELECT COALESCE(SUM(LENGTH(value)), 0) FROM content_cache").fetchone()[0]
            if total > _CACHE_MAX_BYTES:
                to_delete = con.execute(
                    "SELECT key FROM content_cache ORDER BY last_accessed ASC LIMIT 20"
                ).fetchall()
                if to_delete:
                    con.executemany("DELETE FROM content_cache WHERE key=?", [(r["key"],) for r in to_delete])
                    con.commit()
                    log_event(backend_logger, logging.INFO, event="cache_eviction",
                              message=f"Cache LRU eviction removed {len(to_delete)} entries.", details={"total_bytes": total})
        except Exception as _exc:
            backend_logger.warning("_sqlite_cache_set LRU eviction failed: %s", _exc, exc_info=False)
        con.close()
    except Exception as exc:
        log_event(backend_logger, logging.DEBUG, event="cache_set_error", message="SQLite cache set failed.", details={"key": key, "error": str(exc)})
    return value


def _sqlite_cache_delete_expired() -> int:
    """Delete all entries past their stale deadline. Returns number removed."""
    try:
        now = time.time()
        con = get_db_connection()
        # Build a case expression to compute stale deadline per content_type
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
            log_event(backend_logger, logging.DEBUG, event="cache_bg_refresh_error",
                      message="Background cache refresh failed.", details={"key": key, "error": str(exc)})
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

    t = threading.Thread(target=_thread_target, daemon=True, name=f"cache-refresh-{key[:30]}")
    t.start()


# ---------------------------------------------------------------------------
# Phase 4 — Circuit Breaker for Health Checks + Tiered Status + Health Log
# ---------------------------------------------------------------------------

# Tiered status ladder: online → slow → degraded → offline
# Circuit breaker: if a service fails 3× in a row → skip pinging for 10 min

_HEALTH_CB_THRESHOLD = 3          # failures before opening circuit
_HEALTH_CB_COOLDOWN  = 600        # seconds circuit stays open (10 min)
_HEALTH_SLOW_THRESHOLD_MS = 2000  # latency above this → "slow"

@dataclass
class _HealthCBState:
    failures: int = 0
    open_until: float = 0.0
    last_status: str = "online"
    last_latency_ms: float | None = None

# One circuit-breaker state per logical service name
_health_cb: dict[str, _HealthCBState] = {}
_health_cb_lock = threading.Lock()
_health_log_prune_counter = 0
_HEALTH_LOG_PRUNE_EVERY = 100

def _get_health_cb(service: str) -> _HealthCBState:
    with _health_cb_lock:
        if service not in _health_cb:
            _health_cb[service] = _HealthCBState()
        return _health_cb[service]


def _health_cb_record_success(service: str, latency_ms: float) -> str:
    """Record a successful health ping; return tiered status string."""
    state = _get_health_cb(service)
    with _health_cb_lock:
        state.failures = 0
        state.open_until = 0.0
        status = "slow" if latency_ms > _HEALTH_SLOW_THRESHOLD_MS else "online"
        state.last_status = status
        state.last_latency_ms = latency_ms
    _health_log_write(service, status, latency_ms)
    return status


def _health_cb_record_failure(service: str, error: str = "") -> str:
    """Record a failed health ping; return tiered status string."""
    state = _get_health_cb(service)
    with _health_cb_lock:
        state.failures += 1
        if state.failures >= _HEALTH_CB_THRESHOLD:
            state.open_until = time.time() + _HEALTH_CB_COOLDOWN
            status = "offline"
        else:
            status = "degraded"
        state.last_status = status
    _health_log_write(service, status, error=error)
    return status


def _health_cb_is_open(service: str) -> bool:
    """True if circuit is open (skip pinging, serve cached status)."""
    state = _get_health_cb(service)
    if state.open_until > time.time():
        return True
    # Auto-reset after cooldown
    if state.open_until > 0.0:
        with _health_cb_lock:
            state.failures = 0
            state.open_until = 0.0
    return False


def _health_log_write(service: str, status: str, latency_ms: float | None = None, error: str = "") -> None:
    """Persist a health event to SQLite health_log. Best-effort."""
    global _health_log_prune_counter
    try:
        con = get_db_connection()
        con.execute(
            "INSERT INTO health_log (service, status, latency_ms, error, recorded_at) VALUES (?, ?, ?, ?, ?)",
            (service, status, latency_ms, error or "", time.time()),
        )
        _health_log_prune_counter += 1
        if _health_log_prune_counter >= _HEALTH_LOG_PRUNE_EVERY:
            _health_log_prune_counter = 0
            cutoff = time.time() - 86400
            con.execute("DELETE FROM health_log WHERE recorded_at < ?", (cutoff,))
        con.commit()
        con.close()
    except Exception as _exc:
        backend_logger.warning("_health_log_write cleanup failed: %s", _exc, exc_info=False)


async def _timed_ping(coro, service: str) -> tuple[str, float | None, str]:
    """
    Await coro, measure latency. Returns (status, latency_ms, error).
    Uses circuit breaker: if open → returns last known status immediately.
    """
    if _health_cb_is_open(service):
        cached = _get_health_cb(service).last_status
        return (cached, None, "circuit open — skipping ping")
    t0 = time.monotonic()
    try:
        await coro
        latency_ms = (time.monotonic() - t0) * 1000
        status = _health_cb_record_success(service, latency_ms)
        return (status, latency_ms, "")
    except Exception as exc:
        _health_cb_record_failure(service, str(exc))
        status = _get_health_cb(service).last_status
        return (status, None, str(exc))


# ---------------------------------------------------------------------------

def _settings_public_payload(data: dict) -> dict:
    return build_public_settings_payload(DEFAULT_SETTINGS, data)


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/")
def home():
    return {"status": "GRABIX Backend Running"}

@app.get("/check-link")
def check_link(url: str):
    def _normalize_check_link_input(raw_url: str) -> str:
        cleaned = str(raw_url or "").replace("\r", "").replace("\n", "").strip().strip("'\"")
        if not cleaned:
            raise ValueError("Paste a full http or https link.")

        if cleaned.startswith("www."):
            cleaned = f"https://{cleaned}"

        parsed = urlparse(cleaned)
        if not parsed.scheme and "." in (parsed.path or "") and " " not in cleaned:
            cleaned = f"https://{cleaned}"
            parsed = urlparse(cleaned)

        if parsed.scheme and parsed.scheme.lower() not in {"http", "https"}:
            raise ValueError("Only http and https links are supported.")
        if not parsed.netloc:
            raise ValueError("Paste a valid web link, for example https://youtube.com/watch?v=...")
        return cleaned

    def _direct_preview_payload(safe_url: str) -> dict:
        parsed = urlparse(safe_url)
        raw_name = Path(unquote(parsed.path or "")).stem
        guessed_title = re.sub(r"[_\-]+", " ", raw_name).strip() or parsed.netloc or "Direct file"
        return {
            "valid": True,
            "title": guessed_title,
            "thumbnail": "",
            "duration_seconds": 0,
            "uploader": parsed.netloc,
            "formats": ["Source"],
        }

    opts = {"quiet": True, "no_warnings": True, "no_color": True, "noplaylist": True, "skip_download": True, "socket_timeout": 8}
    try:
        safe_url = _normalize_check_link_input(url)
        safe_url = validate_outbound_target(safe_url, mode="public_user_target").normalized_url
        if _is_direct_media_url(safe_url) or _is_direct_subtitle_url(safe_url):
            return _direct_preview_payload(safe_url)
        yt_dlp = _get_yt_dlp()
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(safe_url, download=False)
            return {
                "valid": True,
                "title": info.get("title", "Unknown"),
                "thumbnail": info.get("thumbnail", ""),
                "duration_seconds": info.get("duration", 0),
                "uploader": info.get("channel") or info.get("uploader", ""),
                "formats": _get_formats(info),
            }
    except OSError as e:
        if getattr(e, "errno", None) == 22:
            return {
                "valid": False,
                "error": "That link could not be read. Paste a full http or https media URL.",
            }
        return {"valid": False, "error": str(e)}
    except ValueError as e:
        return {"valid": False, "error": str(e)}
    except Exception as e:
        return {"valid": False, "error": str(e)}


_HEIGHT_LABELS = {
    144: "144p",
    240: "240p",
    360: "360p",
    480: "480p",
    720: "720p",
    1080: "1080p",
    1440: "2K",
    2160: "4K",
}


def _height_to_label(h: int) -> str:
    """Snap an arbitrary pixel height to the nearest standard label."""
    if h in _HEIGHT_LABELS:
        return _HEIGHT_LABELS[h]
    tiers = sorted(_HEIGHT_LABELS.keys())
    closest = min(tiers, key=lambda t: abs(t - h))
    return _HEIGHT_LABELS[closest]


def _get_formats(info: dict) -> list[str]:
    """
    Return a sorted list of quality label strings, e.g. ["4K","2K","1080p","720p","480p"].
    Only heights from REAL, downloadable video streams are included.
    Audio-only tracks, storyboards, and streams without a video codec are excluded.
    """
    seen_heights: set[int] = set()

    for f in (info.get("formats") or []):
        h = f.get("height")
        if not h or not isinstance(h, int) or h <= 0:
            continue
        # Skip audio-only streams (vcodec="none" means no video track)
        if f.get("vcodec", "none") == "none":
            continue
        # Skip storyboard / image tracks (fps < 1 or explicitly marked)
        fps = f.get("fps")
        if fps is not None and fps < 1:
            continue
        # Skip formats with no download URL
        if not f.get("url") and not f.get("fragment_base_url") and not f.get("fragments"):
            continue
        seen_heights.add(h)

    if not seen_heights:
        # Fallback when format list is unavailable (e.g. live streams, private videos)
        return ["1080p", "720p", "480p", "360p"]

    # Snap each real height to a standard label, keep the tallest representative per label
    label_to_max_height: dict[str, int] = {}
    for h in seen_heights:
        label = _height_to_label(h)
        if label not in label_to_max_height or h > label_to_max_height[label]:
            label_to_max_height[label] = h

    # Sort descending by height
    ordered = sorted(label_to_max_height.items(), key=lambda x: x[1], reverse=True)
    return [label for label, _ in ordered]


def _label_to_max_height(label: str) -> int:
    """Convert a quality label back to a pixel height for yt-dlp format selection."""
    reverse = {v: k for k, v in _HEIGHT_LABELS.items()}
    return reverse.get(label, 1080)


def _tiered_message(service: str, status: str, ok_msg: str, slow_msg: str, degraded_msg: str, offline_msg: str) -> str:
    return {
        "online":   ok_msg,
        "slow":     slow_msg,
        "degraded": degraded_msg,
        "offline":  offline_msg,
    }.get(status, degraded_msg)


async def health_services() -> dict:
    # ── database & downloads (sync — no network, no circuit breaker needed) ──
    database      = _database_health()
    downloads_health = _downloads_health()

    # ── ffmpeg (local binary — fast, no circuit breaker) ─────────────────────
    ffmpeg_available = has_ffmpeg()
    ffmpeg_status = "online" if ffmpeg_available else "degraded"
    _health_log_write("ffmpeg", ffmpeg_status)
    ffmpeg = _service_payload(
        "ffmpeg", ffmpeg_status,
        "FFmpeg is ready." if ffmpeg_available else "FFmpeg is unavailable — converter and some HLS flows are limited.",
        True, {"path": FFMPEG_PATH or ""},
    )

    # ── moviebox (in-process import, no network ping) ─────────────────────────
    import moviebox as _mb_mod
    _mb_available = _mb_mod.MOVIEBOX_AVAILABLE
    _mb_error = _mb_mod.MOVIEBOX_IMPORT_ERROR or ""
    if _mb_available:
        mb_status = "online"
        mb_msg = "Movie Box provider is available."
        mb_details: dict = {}
    else:
        mb_status = "degraded"
        mb_msg = "Movie Box is unavailable — auto-retry active. Using VidSrc/embed as fallbacks."
        mb_details = {
            "import_error": _mb_error,
            "auto_retry_active": True,
            "retry_interval_seconds": 300,
            "fallbacks": ["embed", "vidsrc"],
        }
        _health_log_write("moviebox", mb_status, error=_mb_error)
    moviebox = _service_payload("moviebox", mb_status, mb_msg, True, mb_details)

    # ── manga (local routes — always available) ───────────────────────────────
    manga = _service_payload("manga", "online", "Manga routes are available.", False)
    _health_log_write("manga", "online")

    # ── consumet (network ping — use circuit breaker + tiered status) ─────────
    global consumet_health_cache
    consumet_cb_open = False

    if not is_consumet_sidecar_configured():
        # Packaged mode can intentionally run without a Consumet sidecar.
        consumet_health = {
            "configured": False,
            "healthy": False,
            "api_base": "",
            "message": "Consumet sidecar is disabled for this build. Built-in anime fallback mode is active.",
            "mode": "fallback",
        }
        consumet_raw_status = "degraded"
        consumet_health_cache = (time.time() + CONSUMET_HEALTH_CACHE_TTL_SECONDS, consumet_health)
    elif _health_cb_is_open("consumet"):
        consumet_health = (consumet_health_cache or (0, {}))[1] if consumet_health_cache else {}
        consumet_cb_open = _health_cb_is_open("consumet")
        consumet_raw_status = _get_health_cb("consumet").last_status
    elif consumet_health_cache and consumet_health_cache[0] > time.time():
        consumet_health = consumet_health_cache[1]
        consumet_raw_status = "online" if consumet_health.get("healthy") else "degraded"
    else:
        t0 = time.monotonic()
        try:
            consumet_health = await asyncio.wait_for(get_consumet_health_status(), timeout=10.0)
            latency_ms = (time.monotonic() - t0) * 1000
            if consumet_health.get("healthy"):
                consumet_raw_status = _health_cb_record_success("consumet", latency_ms)
            else:
                consumet_raw_status = _health_cb_record_failure("consumet", consumet_health.get("message", ""))
        except Exception as exc:
            consumet_health = {
                "configured": False, "healthy": False,
                "message": "Consumet is warming up — anime fallback is already active.",
                "error": str(exc),
            }
            consumet_raw_status = _health_cb_record_failure("consumet", str(exc))
        consumet_health_cache = (time.time() + CONSUMET_HEALTH_CACHE_TTL_SECONDS, consumet_health)

    consumet_msg = _tiered_message(
        "consumet", consumet_raw_status,
        ok_msg      = str(consumet_health.get("message") or "Consumet is healthy."),
        slow_msg    = "Consumet is responding slowly — anime may buffer.",
        degraded_msg= "Consumet is degraded — anime running on built-in fallback.",
        offline_msg = "Consumet is unreachable (circuit open) — anime fallback active.",
    )
    consumet = _service_payload(
        "consumet", consumet_raw_status, consumet_msg, True,
        {
            "configured": bool(consumet_health.get("configured")),
            "api_base": consumet_health.get("api_base", ""),
            "circuit_open": consumet_cb_open,
        },
    )

    anime_primary_healthy = bool(consumet_health.get("healthy", False))
    anime_fallback_ready = moviebox["status"] in {"online", "slow"}
    anime_status = consumet_raw_status if anime_primary_healthy else ("online" if anime_fallback_ready else "degraded")
    anime = _service_payload(
        "anime", anime_status,
        (
            "Anime playback is fully available."
            if anime_primary_healthy
            else (
                "Anime playback is available through GRABIX fallback providers."
                if anime_fallback_ready
                else "Anime running on built-in fallback stack."
            )
        ),
        True,
    )

    # ── AniWatch (local consumet-local Node sidecar) ──────────────────────────
    try:
        from app.services.aniwatch import get_health as _get_aniwatch_health
        _aw_health = await asyncio.wait_for(_get_aniwatch_health(), timeout=10.0)
        aw_status = "online" if _aw_health.get("healthy") else "degraded"
        aw_msg = "AniWatch local server is healthy." if _aw_health.get("healthy") else "AniWatch local server is warming up — anime fallback active."
    except Exception:
        aw_status = "degraded"
        aw_msg = "AniWatch local server is starting up."
    _health_log_write("aniwatch", aw_status)
    aniwatch = _service_payload("aniwatch", aw_status, aw_msg, True)

    services = {
        "backend":   _service_payload("backend", "online", "Backend is responding.", False),
        "database":  database,
        "downloads": downloads_health,
        "ffmpeg":    ffmpeg,
        "consumet":  consumet,
        "aniwatch":  aniwatch,
        "moviebox":  moviebox,
        "anime":     anime,
        "manga":     manga,
    }

    # Summary counts all four tiers
    summary: dict[str, int] = {"online": 0, "slow": 0, "degraded": 0, "offline": 0}
    for svc in services.values():
        tier = svc.get("status", "offline")
        summary[tier] = summary.get(tier, 0) + 1

    return {"services": services, "summary": summary}


async def health_capabilities() -> dict:
    payload = await health_services()
    services = payload["services"]
    capabilities = {
        # FIX: Only require database to be online for startup_ready.
        # Downloads folder being slow/offline should not keep the whole app stuck
        # in "starting" forever — it degrades gracefully via can_download_media.
        "startup_ready": services["database"]["status"] == "online",
        "can_show_shell": True,
        "can_open_library": True,
        "can_download_media": services["downloads"]["status"] in {"online", "slow"},
        "can_use_converter": services["ffmpeg"]["status"] in {"online", "slow"},
        "can_browse_movies": True,
        "can_browse_tv": True,
        "can_use_moviebox": services["moviebox"]["status"] in {"online", "slow"},
        "can_play_anime": True,
        "can_play_anime_primary": services["consumet"]["status"] in {"online", "slow"} or services["aniwatch"]["status"] in {"online", "slow"},
        "can_play_anime_fallback": True,
        "can_read_manga": services["manga"]["status"] in {"online", "slow"},
    }
    # Only core services with no fallback count as degraded.
    # consumet, aniwatch, moviebox, and anime all have built-in fallbacks —
    # they should never alarm the user during normal operation.
    CORE_SERVICES = {"database", "downloads", "ffmpeg"}
    degraded_services = [
        name
        for name, item in services.items()
        if item["status"] in {"degraded", "offline"}
        and name in CORE_SERVICES
    ]
    payload["capabilities"] = capabilities
    payload["summary"].update(
        {
            "backend_reachable": True,
            "startup_ready": capabilities["startup_ready"],
            "degraded_services": degraded_services,
        }
    )
    return payload


@app.get("/health/services")
async def runtime_health_services():
    return await health_services()


@app.get("/health/capabilities")
async def runtime_health_capabilities():
    return await health_capabilities()


@app.get("/health/ping")
async def runtime_health_ping():
    # Ultra-lightweight — intentionally does NO blocking DB or filesystem work.
    # Heavy checks (DB, downloads folder) are available at /health/capabilities.
    # Keeping this instant prevents false "Backend crashed" watchdog alerts.
    import os as _os
    _consumet_url = _os.environ.get("CONSUMET_API_BASE", "").strip().rstrip("/") or "http://127.0.0.1:3000"
    return {
        "ok": True,
        "core_ready": True,
        "consumet_url": _consumet_url,
        "services": {
            "backend": _service_payload("backend", "online", "Backend is responding.", False),
        },
    }


@app.get("/health/log")
async def runtime_health_log(service: str | None = None, limit: int = 100):
    """
    Phase 4 — Return last 24h of health events from SQLite health_log.
    Optional ?service=consumet to filter by service.
    Optional ?limit=N to cap results (default 100, max 500).
    """
    limit = max(1, min(limit, 500))
    try:
        con = get_db_connection()
        if service:
            rows = con.execute(
                "SELECT service, status, latency_ms, error, recorded_at FROM health_log "
                "WHERE service=? ORDER BY recorded_at DESC LIMIT ?",
                (service, limit),
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT service, status, latency_ms, error, recorded_at FROM health_log "
                "ORDER BY recorded_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        con.close()
        events = [
            {
                "service":    r["service"],
                "status":     r["status"],
                "latency_ms": r["latency_ms"],
                "error":      r["error"] or "",
                "recorded_at": r["recorded_at"],
            }
            for r in rows
        ]
        return {"events": events, "count": len(events), "filter_service": service}
    except Exception as exc:
        return {"events": [], "count": 0, "error": str(exc)}


@app.post("/health/circuit-breaker/reset")
async def runtime_reset_circuit_breaker(service: str | None = None):
    """
    Phase 4 — Manually reset a circuit breaker so health checks resume immediately.
    POST /health/circuit-breaker/reset?service=consumet  → reset one service
    POST /health/circuit-breaker/reset                   → reset all services
    """
    with _health_cb_lock:
        if service:
            if service in _health_cb:
                _health_cb[service] = _HealthCBState()
            targets = [service]
        else:
            for key in list(_health_cb):
                _health_cb[key] = _HealthCBState()
            targets = list(_health_cb.keys()) or ["(none)"]
    return {"reset": targets, "message": "Circuit breaker(s) reset — pinging will resume on next health check."}


@app.get("/health/circuit-breaker/status")
async def runtime_circuit_breaker_status():
    """
    Phase 4 — Show current circuit-breaker state for all monitored services.
    """
    now = time.time()
    result = {}
    with _health_cb_lock:
        for svc, state in _health_cb.items():
            open_for_seconds = max(0.0, state.open_until - now)
            result[svc] = {
                "failures":          state.failures,
                "circuit_open":      state.open_until > now,
                "open_for_seconds":  round(open_for_seconds, 1),
                "last_status":       state.last_status,
                "last_latency_ms":   state.last_latency_ms,
            }
    return {"circuit_breakers": result, "threshold": _HEALTH_CB_THRESHOLD, "cooldown_seconds": _HEALTH_CB_COOLDOWN}


def _providers_status_payload(payload: dict) -> dict:
    services = payload["services"]
    return {
        "providers": {
            "moviebox": services["moviebox"],
            "consumet": services["consumet"],
            "anime": services["anime"],
            "manga": services["manga"],
        },
        "fallbacks": {
            "movies": ["moviebox", "embed"],
            "tv": ["moviebox", "embed"],
            "anime": ["backend-resolved", "moviebox", "consumet-watch", "embed"],
            "manga": ["mangadex", "comick", "offline-cache"],
        },
    }


@app.get("/providers/status")
async def providers_status():
    payload = await health_capabilities()
    registry = {}
    try:
        from app.services.providers import provider_registry_snapshot

        registry = provider_registry_snapshot()
    except Exception as exc:
        registry = {"error": str(exc)}
    status_payload = _providers_status_payload(payload)
    status_payload["registry"] = registry
    return status_payload


async def _diagnostics_payload() -> dict:
    runtime = redact_for_diagnostics(await health_capabilities())
    providers = redact_for_diagnostics(_providers_status_payload(runtime))
    ffmpeg = ffmpeg_status()
    storage = storage_stats()
    recent_events = read_recent_log_events(limit=25, levels={"WARNING", "ERROR", "CRITICAL"})
    library_items = _build_library_index()
    broken_library = sum(1 for item in library_items if item.get("broken"))
    untracked_library = sum(1 for item in library_items if item.get("source_type") == "untracked")
    queue = list_downloads()
    queue_active = sum(1 for item in queue if item.get("status") in {"queued", "downloading", "processing", "paused"})

    checks = [
        {
            "id": "database_online",
            "label": "Database is online",
            "passed": runtime["services"]["database"]["status"] == "online",
        },
        {
            "id": "downloads_writable",
            "label": "Download folder is writable",
            "passed": runtime["services"]["downloads"]["status"] == "online",
        },
        {
            "id": "backend_reachable",
            "label": "Backend is reachable",
            "passed": bool(runtime["summary"].get("backend_reachable")),
        },
        {
            "id": "library_has_no_broken_items",
            "label": "Library has no broken tracked files",
            "passed": broken_library == 0,
            "details": {"broken_items": broken_library},
        },
        {
            "id": "moviebox_provider_ready",
            "label": "Movie Box provider is ready",
            "passed": runtime["services"]["moviebox"]["status"] == "online",
        },
        {
            "id": "anime_fallback_ready",
            "label": "Anime playback has fallback coverage",
            "passed": bool(runtime["capabilities"].get("can_play_anime_fallback")),
        },
        {
            "id": "ffmpeg_ready",
            "label": "FFmpeg is available",
            "passed": bool(ffmpeg.get("available")),
        },
    ]
    failed_checks = [check for check in checks if not check.get("passed")]

    return {
        "generated_at": datetime.now().isoformat(),
        "runtime": runtime,
        "config": redact_for_diagnostics(runtime_config_snapshot()),
        "providers": providers,
        "ffmpeg": ffmpeg,
        "storage": storage,
        "library": {
            "total_items": len(library_items),
            "broken_items": broken_library,
            "untracked_items": untracked_library,
        },
        "queue": {
            "total": len(queue),
            "active": queue_active,
        },
        "logs": {
            "backend_log_path": backend_log_path(),
            "recent_events": redact_for_diagnostics(recent_events),
        },
        "release_gate": {
            "ready": len(failed_checks) == 0,
            "failed_checks": redact_for_diagnostics(failed_checks),
            "checks": redact_for_diagnostics(checks),
        },
        "security": {
            "local_origins_only": True,
            "approved_media_host_count": len(APPROVED_MEDIA_HOSTS),
            "managed_download_root": str(Path(DOWNLOAD_DIR).resolve()),
            "desktop_auth": redact_for_diagnostics(desktop_auth_state_snapshot()),
        },
    }


# ---------------------------------------------------------------------------
# Phase 3 — Cache Management Endpoints
# ---------------------------------------------------------------------------

@app.post("/cache/clear")
async def cache_clear(content_type: str | None = None):
    """
    Clear the SQLite content cache.
    - content_type=None  → wipe everything
    - content_type=discover|search|details|manga_chapters|generic|moviebox → wipe that type only
    MovieBox results are now stored in SQLite (prefixed "moviebox:"), so clearing
    content_type=None or content_type=moviebox handles them automatically.
    """
    try:
        con = get_db_connection()
        if content_type:
            cur = con.execute("DELETE FROM content_cache WHERE content_type=?", (content_type,))
        else:
            cur = con.execute("DELETE FROM content_cache")
        removed = cur.rowcount
        con.commit()
        con.close()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Cache clear failed: {exc}")

    log_event(backend_logger, logging.INFO, event="cache_cleared",
              message="Content cache cleared.", details={"content_type": content_type or "all", "removed": removed})
    return {"cleared": removed, "content_type": content_type or "all"}


@app.get("/cache/stats")
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
        total_bytes = con.execute("SELECT COALESCE(SUM(LENGTH(value)), 0) FROM content_cache").fetchone()[0]
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


@app.get("/diagnostics/self-test")
async def diagnostics_self_test():
    return await _diagnostics_payload()


@app.get("/diagnostics/export")
async def diagnostics_export():
    return await _diagnostics_payload()


@app.get("/diagnostics/logs")
async def diagnostics_logs(limit: int = 20):
    safe_limit = max(1, min(limit, 100))
    return {
        "backend_log_path": backend_log_path(),
        "events": redact_for_diagnostics(read_recent_log_events(limit=safe_limit)),
    }

# ── PyO3 entry point ─────────────────────────────────────────────────────────
# Called by the Rust/PyO3 embed in lib.rs instead of spawning a child process.
# Also called when running directly: `python main.py`
# uvicorn blocks here forever — this is intentional.
# Download handler registration moved to downloads/engine.py::register_handlers()
# Streaming handlers imported directly in app/routes/streaming.py — no registry needed


def run_server() -> None:
    """Start the uvicorn server. Blocks until the process exits.

    NOTE: When called from PyO3 (embedded in grabix.exe), Python runs on a
    background Rust thread — NOT the main thread.  uvicorn.run() tries to
    install signal handlers which Python only allows from the main thread,
    so it crashes silently.  We use uvicorn.Server directly and disable
    signal handlers.  On Windows we also force SelectorEventLoop because
    ProactorEventLoop (Windows 3.8+ default) requires the OS main thread.
    """
    import asyncio
    import uvicorn
    import sys as _sys

    _register_download_handlers()
    ensure_runtime_bootstrap()
    recover_download_jobs()  # FIX: restore interrupted downloads after restart

    port = backend_port()

    # ── Pre-flight port check ─────────────────────────────────────────────────
    # Must happen BEFORE creating uvicorn.Config/Server.  If we skip this and
    # let uvicorn try to bind, it first runs the FastAPI lifespan (which creates
    # the run_key_health_worker async task), THEN fails to bind, leaving the
    # task pending — which produces the confusing "Task was destroyed but it is
    # pending!" warning in addition to the real Errno 10048 error.
    try:
        _probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        _probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
        _probe.bind(("127.0.0.1", port))
        _probe.close()
    except OSError:
        _sys.stderr.write(
            f"\n ==========================================\n"
            f"   GRABIX Backend — STARTUP FAILED\n"
            f"   Port {port} is already in use.\n"
            f"   Another GRABIX backend is already running.\n"
            f"   Close it (or its terminal window) first,\n"
            f"   then restart.\n"
            f" ==========================================\n\n"
        )
        _sys.exit(1)
    # ─────────────────────────────────────────────────────────────────────────

    # On Windows, SelectorEventLoop is required when running on a non-main thread
    # (e.g. when embedded via PyO3). We create it directly instead of using
    # set_event_loop_policy which is deprecated in Python 3.14+ and removed in 3.16.
    if os.name == "nt":
        loop = asyncio.SelectorEventLoop()
    else:
        loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        log_level=os.getenv("GRABIX_BACKEND_LOG_LEVEL", "warning"),
        log_config=None,  # Don't reconfigure logging — main.py already set it up
    )
    server = uvicorn.Server(config)

    # Disable signal-handler installation — not allowed outside the main thread.
    server.install_signal_handlers = lambda: None  # type: ignore[method-assign]

    try:
        loop.run_until_complete(server.serve())
    finally:
        loop.close()


if __name__ == "__main__":
    run_server()
