"""
core/health.py
Health-check logic, circuit breaker, tiered status, and diagnostics.
Includes /health/*, /providers/status, and /diagnostics/* FastAPI routes.
Extracted from main.py (Phase 2 split).
"""
import asyncio
import logging
import shutil
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter

from app.services.desktop_auth import desktop_auth_state_snapshot
from app.services.logging_utils import (
    backend_log_path,
    get_logger,
    log_event,
    read_recent_log_events,
)
from app.services.runtime_config import default_download_dir, runtime_config_snapshot
from app.services.security import DEFAULT_APPROVED_MEDIA_HOSTS, redact_for_diagnostics
from db_helpers import get_db_connection, has_ffmpeg
from downloads.engine import (
    _downloads_health,
    _database_health,
    ffmpeg_status,
    list_downloads,
    storage_stats,
)
from library_helpers import _build_library_index

router = APIRouter()
_backend_logger = get_logger("backend")

# ---------------------------------------------------------------------------
# _service_payload — canonical shim used throughout the backend
# ---------------------------------------------------------------------------

def _service_payload(
    name: str,
    status: str,
    message: str | None = None,
    critical: bool = False,
    details: dict | None = None,
) -> dict:
    payload: dict = {"name": name, "status": status}
    if message is not None:
        payload["message"] = message
    payload["critical"] = critical
    if details:
        payload["details"] = details
    return payload


# ---------------------------------------------------------------------------
# Phase 4 — Circuit Breaker + Tiered Status + Health Log
# Tiered status: online → slow → degraded → offline
# Circuit: if a service fails 3× in a row → skip pinging for 10 min
# ---------------------------------------------------------------------------

_HEALTH_CB_THRESHOLD = 3        # failures before opening circuit
_HEALTH_CB_COOLDOWN = 600       # seconds circuit stays open (10 min)
_HEALTH_SLOW_THRESHOLD_MS = 2000  # latency above this → "slow"
_HEALTH_LOG_PRUNE_EVERY = 100
_health_log_prune_counter = 0


@dataclass
class _HealthCBState:
    failures: int = 0
    open_until: float = 0.0
    last_status: str = "online"
    last_latency_ms: float | None = None


_health_cb: dict[str, _HealthCBState] = {}
_health_cb_lock = threading.Lock()


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


def _health_log_write(
    service: str,
    status: str,
    latency_ms: float | None = None,
    error: str = "",
) -> None:
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
        _backend_logger.warning(
            "_health_log_write cleanup failed: %s", _exc, exc_info=False
        )


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


def _tiered_message(
    service: str,
    status: str,
    ok_msg: str,
    slow_msg: str,
    degraded_msg: str,
    offline_msg: str,
) -> str:
    return {
        "online":   ok_msg,
        "slow":     slow_msg,
        "degraded": degraded_msg,
        "offline":  offline_msg,
    }.get(status, degraded_msg)


# ---------------------------------------------------------------------------
# Core health functions
# ---------------------------------------------------------------------------

async def health_services() -> dict:
    ffmpeg_path = shutil.which("ffmpeg")

    # ── database & downloads (sync — no network, no circuit breaker needed) ──
    database = _database_health()
    downloads_health = _downloads_health()

    # ── ffmpeg (local binary — fast, no circuit breaker) ─────────────────────
    ffmpeg_available = has_ffmpeg()
    ffmpeg_svc_status = "online" if ffmpeg_available else "degraded"
    _health_log_write("ffmpeg", ffmpeg_svc_status)
    ffmpeg = _service_payload(
        "ffmpeg", ffmpeg_svc_status,
        "FFmpeg is ready." if ffmpeg_available else (
            "FFmpeg is unavailable — converter and some HLS flows are limited."
        ),
        True, {"path": ffmpeg_path or ""},
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

    services = {
        "backend":   _service_payload("backend", "online", "Backend is responding.", False),
        "database":  database,
        "downloads": downloads_health,
        "ffmpeg":    ffmpeg,
        "moviebox":  moviebox,
        "manga":     manga,
    }

    summary: dict[str, int] = {"online": 0, "slow": 0, "degraded": 0, "offline": 0}
    for svc in services.values():
        tier = svc.get("status", "offline")
        summary[tier] = summary.get(tier, 0) + 1

    return {"services": services, "summary": summary}


async def health_capabilities() -> dict:
    payload = await health_services()
    services = payload["services"]
    capabilities = {
        "startup_ready": services["database"]["status"] == "online",
        "can_show_shell": True,
        "can_open_library": True,
        "can_download_media": services["downloads"]["status"] in {"online", "slow"},
        "can_use_converter": services["ffmpeg"]["status"] in {"online", "slow"},
        "can_browse_movies": True,
        "can_browse_tv": True,
        "can_use_moviebox": services["moviebox"]["status"] in {"online", "slow"},
        "can_read_manga": services["manga"]["status"] in {"online", "slow"},
    }
    CORE_SERVICES = {"database", "downloads", "ffmpeg"}
    degraded_services = [
        name
        for name, item in services.items()
        if item["status"] in {"degraded", "offline"} and name in CORE_SERVICES
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


def _providers_status_payload(payload: dict) -> dict:
    services = payload["services"]
    return {
        "providers": {
            "moviebox": services["moviebox"],
            "manga":    services["manga"],
        },
        "fallbacks": {
            "movies": ["moviebox", "embed"],
            "tv":     ["moviebox", "embed"],
            "manga":  ["mangadex", "comick", "offline-cache"],
        },
    }


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
    queue_active = sum(
        1 for item in queue
        if item.get("status") in {"queued", "downloading", "processing", "paused"}
    )
    download_dir = str(default_download_dir())

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
            "id": "ffmpeg_ready",
            "label": "FFmpeg is available",
            "passed": bool(ffmpeg.get("available")),
        },
    ]
    failed_checks = [check for check in checks if not check.get("passed")]

    return {
        "generated_at": __import__("datetime").datetime.now().isoformat(),
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
            "approved_media_host_count": len(DEFAULT_APPROVED_MEDIA_HOSTS),
            "managed_download_root": str(Path(download_dir).resolve()),
            "desktop_auth": redact_for_diagnostics(desktop_auth_state_snapshot()),
        },
    }


# ---------------------------------------------------------------------------
# /health/* routes
# ---------------------------------------------------------------------------

@router.get("/health/services")
async def runtime_health_services():
    return await health_services()


@router.get("/health/capabilities")
async def runtime_health_capabilities():
    return await health_capabilities()


@router.get("/health/ping")
async def runtime_health_ping():
    return {
        "ok": True,
        "core_ready": True,
        "services": {
            "backend": _service_payload("backend", "online", "Backend is responding.", False),
        },
    }


@router.get("/health/log")
async def runtime_health_log(service: str | None = None, limit: int = 100):
    """Return last 24h of health events from SQLite health_log."""
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
                "service":     r["service"],
                "status":      r["status"],
                "latency_ms":  r["latency_ms"],
                "error":       r["error"] or "",
                "recorded_at": r["recorded_at"],
            }
            for r in rows
        ]
        return {"events": events, "count": len(events), "filter_service": service}
    except Exception as exc:
        return {"events": [], "count": 0, "error": str(exc)}


@router.post("/health/circuit-breaker/reset")
async def runtime_reset_circuit_breaker(service: str | None = None):
    """
    Manually reset a circuit breaker so health checks resume immediately.
    POST /health/circuit-breaker/reset?service=moviebox  → reset one service
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
    return {
        "reset": targets,
        "message": "Circuit breaker(s) reset — pinging will resume on next health check.",
    }


@router.get("/health/circuit-breaker/status")
async def runtime_circuit_breaker_status():
    """Show current circuit-breaker state for all monitored services."""
    now = time.time()
    result = {}
    with _health_cb_lock:
        for svc, state in _health_cb.items():
            open_for_seconds = max(0.0, state.open_until - now)
            result[svc] = {
                "failures":         state.failures,
                "circuit_open":     state.open_until > now,
                "open_for_seconds": round(open_for_seconds, 1),
                "last_status":      state.last_status,
                "last_latency_ms":  state.last_latency_ms,
            }
    return {
        "circuit_breakers": result,
        "threshold": _HEALTH_CB_THRESHOLD,
        "cooldown_seconds": _HEALTH_CB_COOLDOWN,
    }


# ---------------------------------------------------------------------------
# /providers/status route
# ---------------------------------------------------------------------------

@router.get("/providers/status")
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


# ---------------------------------------------------------------------------
# /diagnostics/* routes
# ---------------------------------------------------------------------------

@router.get("/diagnostics/self-test")
async def diagnostics_self_test():
    return await _diagnostics_payload()


@router.get("/diagnostics/export")
async def diagnostics_export():
    return await _diagnostics_payload()


@router.get("/diagnostics/logs")
async def diagnostics_logs(limit: int = 20):
    safe_limit = max(1, min(limit, 100))
    return {
        "backend_log_path": backend_log_path(),
        "events": redact_for_diagnostics(read_recent_log_events(limit=safe_limit)),
    }
