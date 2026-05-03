import asyncio
import atexit
import logging
import os
import re
import shutil
import socket
import time
import uuid
import ctypes
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import unquote, urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# ── Router imports ────────────────────────────────────────────────────────────
from app.routes.downloads import router as downloads_router
from app.routes.manga import router as manga_router
from app.routes.metadata import router as metadata_router
from app.routes.providers import router as providers_router
from app.routes.settings import router as settings_router
from app.routes.streaming import router as streaming_router
from app.routes.subtitles import router as subtitles_router
from moviebox import (
    router as moviebox_router,
    start_bg_retry as _moviebox_start_bg_retry,
    restore_from_last_session as _moviebox_restore_from_last_session,
)
from downloads import router as downloads_engine_router, register_handlers as _register_download_handlers
from downloads.engine import (
    ensure_runtime_bootstrap,
    recover_download_jobs,
    _is_direct_media_url,
    _is_direct_subtitle_url,
    _persist_download_record,
    _start_download_thread,
)

# FIX (Bug 2 — Problem B): Import the engine MODULE, not just the function.
# `from downloads.engine import _start_download_thread` captures the value at
# import time, which may be None if _register_download_handlers() hasn't run
# yet. Using the module reference lets the lambda below dereference it at
# call-time, always getting the live post-registration function.
import downloads.engine as _downloads_engine

# ── Service imports ───────────────────────────────────────────────────────────
from app.services.errors import json_error_response
from app.services.logging_utils import LOG_DIR, backend_log_path, get_logger, log_event, read_recent_log_events
from app.services.archive_installer import parse_checksum_manifest, safe_extract_zip, sha256_file
from app.services.desktop_auth import DESKTOP_AUTH_HEADER, desktop_auth_state_snapshot, validate_desktop_auth_request
from app.services.network_policy import validate_outbound_target
from app.services.runtime_config import (
    app_state_root, backend_port, bundled_tools_dir,
    db_path as runtime_db_path, default_download_dir, public_base_url,
    runtime_config_snapshot, runtime_tools_dir,
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
    DEFAULT_APPROVED_MEDIA_HOSTS, DEFAULT_LOCAL_APP_ORIGINS,
    ensure_safe_managed_path,
    normalize_download_target as security_normalize_download_target,
    redact_for_diagnostics,
    validate_outbound_url as security_validate_outbound_url,
)

# ── Split helpers (Phase 6 — pre-existing) ───────────────────────────────────
from db_helpers import (
    get_db_connection, db_insert, db_update_status, db_upsert_download_job,
    db_delete_download_job, db_list_download_jobs, DEFAULT_SETTINGS,
    load_settings, save_settings_to_disk, _strip_ansi, _format_bytes,
    _format_bytes_int, _format_eta, _sanitize_download_engine, _get_file_size,
    _guess_dl_type_from_path, has_ffmpeg, has_aria2, init_db,
)
from library_helpers import migrate_db, _build_library_index, _reconcile_library_state
from streaming_helpers import (
    _extract_iframe_src, _fetch_json, _normalize_request_headers,
    _rewrite_hls_playlist, _extract_hls_variants, _looks_like_playable_media_url,
    _resolve_embed_target, resolve_embed, stream_proxy,
    stream_variants, _extract_stream_url_via_browser, extract_stream,
)

# ── Phase 2 core split ────────────────────────────────────────────────────────
from core import cache_ops, network_monitor, download_helpers
from core.health import (
    _service_payload,
    health_services,
    health_capabilities,
    _providers_status_payload,
    _diagnostics_payload,
    router as health_router,
)
from core.cache_ops import (
    router as cache_router,
    _sqlite_cache_get,
    _sqlite_cache_set,
    _cache_trigger_bg_refresh,
)
from core.download_helpers import (
    _normalize_download_target,
    _infer_download_category,
    _infer_library_display_layout,
    _normalize_category_label,
    _normalize_tags_csv,
    _start_auto_retry_failed_worker,
)
from core.network_monitor import _start_network_monitor

try:
    import bcrypt
    BCRYPT_AVAILABLE = True
except Exception:
    bcrypt = None
    BCRYPT_AVAILABLE = False

# ── Global state ──────────────────────────────────────────────────────────────
DOWNLOAD_DIR = str(default_download_dir())
DB_PATH = str(runtime_db_path())
SETTINGS_PATH = str(runtime_settings_path())
RUNTIME_TOOLS_DIR = runtime_tools_dir()
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

runtime_state = RuntimeStateRegistry()
downloads: dict = runtime_state.downloads
download_controls: dict = runtime_state.download_controls

FFMPEG_PATH = shutil.which("ffmpeg")
ARIA2_PATH = shutil.which("aria2c")
SELF_BASE_URL = public_base_url()

# ── Internal file guard (used by library_helpers via lazy import) ─────────────
_INTERNAL_FILE_SUFFIXES = {".db", ".db-wal", ".db-shm", ".json", ".log", ".lock"}

def _is_internal_managed_file(path) -> bool:
    """Return True for GRABIX-internal files that should not appear in the library index."""
    from pathlib import Path as _Path
    p = _Path(path)
    if p.suffix.lower() in _INTERNAL_FILE_SUFFIXES:
        return True
    # Also skip any file whose name starts with a dot (hidden/temp files)
    if p.name.startswith("."):
        return True
    return False
STREAM_EXTRACT_CACHE_TTL_SECONDS = 900
stream_extract_cache: dict[str, tuple[float, dict]] = runtime_state.stream_extract_cache
ADULT_UNLOCK_WINDOW_SECONDS = 300
ADULT_UNLOCK_MAX_ATTEMPTS = 5
adult_unlock_attempts: dict[str, list[float]] = runtime_state.adult_unlock_attempts
APPROVED_MEDIA_HOSTS = DEFAULT_APPROVED_MEDIA_HOSTS
dependency_install_jobs: dict[str, dict] = runtime_state.dependency_install_jobs

_app_event_loop: asyncio.AbstractEventLoop | None = None

# Inject shared mutable state into core modules.
network_monitor.init(downloads, download_controls)
download_helpers.init(
    downloads, download_controls,
    db_update_status=db_update_status,
    persist_download_record=_persist_download_record,
    # FIX (Bug 2 — Problem B): lambda defers lookup to call-time so we always
    # get the live function even if _register_download_handlers() reassigns
    # _downloads_engine._start_download_thread after this module is imported.
    start_download_thread=lambda dl_id: _downloads_engine._start_download_thread(dl_id),
)

# FIX (downloads stuck "Queued" in EXE — root cause #1):
# downloads/engine.py holds its OWN private _downloads / _download_controls
# dicts (initialised to {} at module load). main.py creates a separate
# RuntimeStateRegistry and binds `downloads` / `download_controls` to THOSE
# dicts. Without this init() call the two sides of the app were talking to
# completely different dicts: start_download() stored the record into engine's
# private dict but list_downloads() / the SSE stream read from the registry
# dict — so the UI always saw an empty queue and nothing ever started.
# engine.init() replaces the engine's private references with the same objects
# that main.py, download_helpers, and network_monitor already share.
_downloads_engine.init(downloads, download_controls)

# ── Loggers ───────────────────────────────────────────────────────────────────
backend_logger = get_logger("backend")
downloads_logger = get_logger("downloads")
library_logger = get_logger("library")
playback_logger = get_logger("playback")

# ── Lazy yt_dlp loader ────────────────────────────────────────────────────────
_yt_dlp_mod = None

def _load_yt_dlp():
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


# ── Tool resolution ───────────────────────────────────────────────────────────

def _resolve_runtime_binary(tool_id: str, names: list[str]) -> str | None:
    bundled = bundled_tools_dir()
    if bundled:
        bundled_tool_dir = bundled / tool_id
        if bundled_tool_dir.exists():
            for name in names:
                candidates = list(bundled_tool_dir.rglob(name))
                if candidates:
                    return str(candidates[0])
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    managed_dir = RUNTIME_TOOLS_DIR / tool_id
    if managed_dir.exists():
        for name in names:
            candidates = list(managed_dir.rglob(name))
            if candidates:
                return str(candidates[0])
    return None


def refresh_runtime_tools() -> None:
    global FFMPEG_PATH, ARIA2_PATH
    FFMPEG_PATH = _resolve_runtime_binary("ffmpeg", ["ffmpeg.exe", "ffmpeg"])
    ARIA2_PATH = _resolve_runtime_binary("aria2", ["aria2c.exe", "aria2c"])
    for tool_path in {Path(path).parent for path in [FFMPEG_PATH, ARIA2_PATH] if path}:
        existing = os.environ.get("PATH", "")
        normalized = str(tool_path)
        if normalized and normalized.lower() not in existing.lower():
            os.environ["PATH"] = f"{normalized}{os.pathsep}{existing}" if existing else normalized


# ── aria2 cleanup on exit ─────────────────────────────────────────────────────

def _terminate_all_aria2_processes() -> None:
    for ctrl in list(download_controls.values()):
        if ctrl.get("process_kind") == "aria2":
            proc = ctrl.get("process")
            if proc is not None and proc.poll() is None:
                try:
                    proc.terminate()
                except Exception as _exc:
                    downloads_logger.debug(
                        "aria2 process.terminate() skipped — process already gone: %s",
                        _exc, exc_info=False,
                    )

atexit.register(_terminate_all_aria2_processes)

# ── Windows process suspension constants ──────────────────────────────────────
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


# ── FastAPI app ───────────────────────────────────────────────────────────────

@asynccontextmanager
async def _grabix_lifespan(app: FastAPI):
    global _app_event_loop
    _app_event_loop = asyncio.get_running_loop()
    cache_ops.set_event_loop(_app_event_loop)   # allow background cache refresh
    ensure_runtime_bootstrap()
    recover_download_jobs()
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

app.include_router(downloads_router)
app.include_router(manga_router,           prefix="/manga")
app.include_router(metadata_router)
app.include_router(providers_router)
app.include_router(settings_router)
app.include_router(streaming_router)
app.include_router(subtitles_router,       prefix="/subtitles")
app.include_router(moviebox_router,        prefix="/moviebox")
app.include_router(downloads_engine_router)
# Phase 2: health, cache, diagnostics, providers routes
app.include_router(health_router)
app.include_router(cache_router)


# ── Middleware ────────────────────────────────────────────────────────────────

def _correlation_id_from_request(request: Request | None) -> str:
    if request is None:
        return ""
    return str(
        getattr(request.state, "correlation_id", "")
        or request.headers.get("X-Request-ID", "")
    ).strip()


@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
    correlation_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.correlation_id = correlation_id
    auth_failure = validate_desktop_auth_request(request)
    if auth_failure is not None:
        payload = dict(auth_failure["payload"])
        log_event(
            backend_logger, logging.WARNING,
            event=str(payload.get("code") or "desktop_auth_rejected"),
            message=f"{request.method} {request.url.path} was blocked by desktop auth.",
            correlation_id=correlation_id,
            details={"path": request.url.path, "method": request.method},
        )
        response = json_error_response(
            status_code=int(auth_failure["status_code"]),
            detail=payload, request=request, service="security",
        )
        response.headers["X-Request-ID"] = correlation_id
        return response
    try:
        response = await call_next(request)
    except Exception as exc:
        log_event(
            backend_logger, logging.ERROR,
            event="request_error",
            message=f"{request.method} {request.url.path} failed.",
            correlation_id=correlation_id,
            details={"error": str(exc), "path": request.url.path, "method": request.method},
        )
        raise
    response.headers["X-Request-ID"] = correlation_id
    if response.status_code >= 500:
        log_event(
            backend_logger, logging.ERROR,
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
        backend_logger, logging.ERROR,
        event="unhandled_exception",
        message=f"{request.method} {request.url.path} crashed unexpectedly.",
        correlation_id=correlation_id,
        details={"error": str(exc), "path": request.url.path, "method": request.method},
    )
    response = json_error_response(
        status_code=500, detail="An unexpected backend error occurred.", request=request,
    )
    response.headers["X-Request-ID"] = correlation_id
    return response


# ── Adult content helpers ─────────────────────────────────────────────────────

class AdultContentUnlockRequest(BaseModel):
    password: str

class AdultContentConfigureRequest(BaseModel):
    password: str

def _client_key(request: Request | None = None) -> str:
    if request and request.client and request.client.host:
        return request.client.host
    return "local"

def _normalize_unlock_attempts(client_key: str) -> list[float]:
    cutoff = time.time() - ADULT_UNLOCK_WINDOW_SECONDS
    attempts = [s for s in adult_unlock_attempts.get(client_key, []) if s >= cutoff]
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
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. Try again in {retry_after} seconds.",
        )

def _hash_adult_password(password: str) -> str:
    if not BCRYPT_AVAILABLE:
        raise HTTPException(
            status_code=500,
            detail="bcrypt is required before configuring the adult-content password.",
        )
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

def _settings_public_payload(data: dict) -> dict:
    return build_public_settings_payload(DEFAULT_SETTINGS, data)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def home():
    return {"status": "GRABIX Backend Running"}


@app.get("/debug/download-state")
def debug_download_state():
    """
    FIX (Root Cause #4 — diagnostics): Returns the full in-memory download
    dict so you can verify that _downloads_engine.init() correctly wired the
    engine's _downloads to the RuntimeStateRegistry dict.

    To use in EXE: open http://127.0.0.1:8000/debug/download-state in a
    browser right after clicking Download. You should see the download record
    with status "downloading" (not "queued"). If it shows "queued" the engine
    is using a different dict than main.py — init() didn't take effect.

    Also reports which dict object IDs are in play so you can confirm they
    match across the engine / download_helpers / runtime_state triangle.
    """
    import downloads.engine as _eng
    return {
        "engine_downloads_id": id(_eng._downloads),
        "registry_downloads_id": id(downloads),
        "dicts_are_same": _eng._downloads is downloads,
        "download_count": len(_eng._downloads),
        "downloads": [
            {
                "id": dl_id,
                "status": item.get("status"),
                "stage_label": item.get("stage_label"),
                "error": item.get("error", ""),
                "title": item.get("title", "")[:60],
            }
            for dl_id, item in list(_eng._downloads.items())
        ],
    }


@app.get("/debug/auth-state")
def debug_auth_state():
    """
    DIAGNOSTIC: Reports the desktop auth configuration.
    Open http://127.0.0.1:8000/debug/auth-state in a browser.
    If 'token_set' is True but you see downloads stuck, the frontend
    is not sending the X-Grabix-Desktop-Auth header correctly.
    If 'required' is True and 'token_set' is False → 503 on all sensitive routes.
    """
    from app.services.desktop_auth import desktop_auth_state_snapshot
    snap = desktop_auth_state_snapshot()
    return {
        "required": snap["required"],
        "observe_only": snap["observe_only"],
        "token_set": snap["ready"],
        "header_name": snap["header"],
        "sensitive_routes_blocked": snap["required"] and not snap["ready"],
    }


@app.get("/debug/trigger-test-download")
def debug_trigger_test_download():
    """
    DIAGNOSTIC: Directly calls start_download() on the engine — NO auth check.
    Open http://127.0.0.1:8000/debug/trigger-test-download in a browser.
    If download_count goes from 0 → 1, start_download() works and the bug is
    that the authenticated GET /download route is being blocked (auth header missing).
    If still 0, start_download() itself has a bug.
    """
    import downloads.engine as _eng
    before = len(_eng._downloads)
    try:
        result = _eng.start_download(
            url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            title="[GRABIX DIAGNOSTIC TEST — SAFE TO DELETE]",
            dl_type="video",
            quality="360p",
        )
        after = len(_eng._downloads)
        dl_id = result.get("task_id", "")
        item = _eng._downloads.get(dl_id, {})
        return {
            "start_download_called": True,
            "download_count_before": before,
            "download_count_after": after,
            "task_id": dl_id,
            "initial_status": item.get("status", ""),
            "dicts_are_same": _eng._downloads is downloads,
        }
    except Exception as exc:
        return {
            "start_download_called": False,
            "error": str(exc),
            "download_count_before": before,
        }


@app.get("/debug/thread-test")
def debug_thread_test():
    """
    DIAGNOSTIC: Spawns a real background thread that mimics the download worker
    and reports whether it transitioned through queued -> downloading -> done.
    Open http://127.0.0.1:8000/debug/thread-test in a browser and wait 3 seconds.
    If result shows 'done', threads work. If stuck on 'queued', the thread is dying
    before _mark('downloading') — check downloads.log for the crash reason.
    """
    import threading as _threading
    import time as _time
    import uuid as _uuid

    test_id = "THREAD_TEST_" + str(_uuid.uuid4())[:8]
    result: dict = {"status": "queued", "error": ""}

    def _test_worker():
        try:
            result["status"] = "downloading"
            _time.sleep(0.5)
            # Try importing yt_dlp — the most common failure point in EXE
            try:
                import yt_dlp as _ytdlp
                result["yt_dlp_version"] = getattr(_ytdlp, "__version__", "unknown")
                result["yt_dlp_ok"] = True
            except BaseException as exc:
                result["yt_dlp_ok"] = False
                result["yt_dlp_error"] = f"{type(exc).__name__}: {exc}"
            result["status"] = "done"
        except BaseException as exc:
            result["status"] = "crashed"
            result["error"] = f"{type(exc).__name__}: {exc}"

    t = _threading.Thread(target=_test_worker, daemon=True, name="grabix-diag-thread")
    t.start()
    t.join(timeout=5.0)

    return {
        "test_id": test_id,
        "thread_finished": not t.is_alive(),
        "result": result,
        "engine_downloads_id": id(_downloads_engine._downloads),
        "registry_downloads_id": id(downloads),
        "dicts_are_same": _downloads_engine._downloads is downloads,
    }


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
            "valid": True, "title": guessed_title, "thumbnail": "",
            "duration_seconds": 0, "uploader": parsed.netloc, "formats": ["Source"],
        }

    opts = {
        "quiet": True, "no_warnings": True, "no_color": True,
        "noplaylist": True, "skip_download": True, "socket_timeout": 8,
    }
    try:
        safe_url = _normalize_check_link_input(url)
        safe_url = validate_outbound_target(safe_url, mode="public_user_target").normalized_url
        if _is_direct_media_url(safe_url) or _is_direct_subtitle_url(safe_url):
            return _direct_preview_payload(safe_url)
        ydl_mod = _get_yt_dlp()
        with ydl_mod.YoutubeDL(opts) as ydl:
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
            return {"valid": False, "error": "That link could not be read. Paste a full http or https media URL."}
        return {"valid": False, "error": str(e)}
    except (ValueError, Exception) as e:
        return {"valid": False, "error": str(e)}


_HEIGHT_LABELS = {
    144: "144p", 240: "240p", 360: "360p", 480: "480p",
    720: "720p", 1080: "1080p", 1440: "2K", 2160: "4K",
}

def _height_to_label(h: int) -> str:
    if h in _HEIGHT_LABELS:
        return _HEIGHT_LABELS[h]
    closest = min(sorted(_HEIGHT_LABELS), key=lambda t: abs(t - h))
    return _HEIGHT_LABELS[closest]

def _get_formats(info: dict) -> list[str]:
    seen_heights: set[int] = set()
    for f in (info.get("formats") or []):
        h = f.get("height")
        if not h or not isinstance(h, int) or h <= 0:
            continue
        if f.get("vcodec", "none") == "none":
            continue
        fps = f.get("fps")
        if fps is not None and fps < 1:
            continue
        if not f.get("url") and not f.get("fragment_base_url") and not f.get("fragments"):
            continue
        seen_heights.add(h)
    if not seen_heights:
        return ["1080p", "720p", "480p", "360p"]
    label_to_max: dict[str, int] = {}
    for h in seen_heights:
        label = _height_to_label(h)
        if label not in label_to_max or h > label_to_max[label]:
            label_to_max[label] = h
    return [label for label, _ in sorted(label_to_max.items(), key=lambda x: x[1], reverse=True)]

def _label_to_max_height(label: str) -> int:
    reverse = {v: k for k, v in _HEIGHT_LABELS.items()}
    return reverse.get(label, 1080)


# ── Server entry point ────────────────────────────────────────────────────────

def run_server() -> None:
    """Start the uvicorn server. Blocks until the process exits."""
    import asyncio
    import uvicorn
    import sys as _sys

    _register_download_handlers()

    # FIX (Bug 2 — Problem A): Removed the two premature calls that were here:
    #   ensure_runtime_bootstrap()
    #   recover_download_jobs()
    #
    # Both functions are now called exclusively inside _grabix_lifespan, where
    # the asyncio event loop is already running. Calling them here — before
    # loop.run_until_complete() — meant the event loop didn't exist yet, so any
    # coroutines or asyncio.create_task() calls inside them were silently
    # dropped. Download threads started by that broken first call were orphaned,
    # and when the lifespan called the same functions a second time it couldn't
    # tell recovered jobs from new ones. Net result: every download stayed
    # permanently "queued" with no thread ever pulling it.

    port = backend_port()

    try:
        _probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        _probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
        _probe.bind(("127.0.0.1", port))
        _probe.close()
    except OSError:
        # FIX (RC2): Raise a catchable RuntimeError instead of calling sys.exit(1).
        # sys.exit() raises SystemExit which PyO3 cannot recover from — it permanently
        # kills the embedded interpreter. RuntimeError is caught by the Rust restart
        # loop in lib.rs, which waits 8 seconds for the OS to release the port, then
        # retries. This makes port conflicts on crash/restart fully self-healing.
        raise RuntimeError(
            f"port_in_use: Port {port} is already in use. "
            f"Another GRABIX backend is still running (or the OS has not yet released "
            f"the port after a crash). The backend will retry automatically."
        )

    loop = asyncio.SelectorEventLoop() if os.name == "nt" else asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    config = uvicorn.Config(
        app, host="127.0.0.1", port=port,
        log_level=os.getenv("GRABIX_BACKEND_LOG_LEVEL", "warning"),
        log_config=None,
    )
    server = uvicorn.Server(config)
    server.install_signal_handlers = lambda: None  # type: ignore[method-assign]

    try:
        loop.run_until_complete(server.serve())
    finally:
        loop.close()


if __name__ == "__main__":
    run_server()
