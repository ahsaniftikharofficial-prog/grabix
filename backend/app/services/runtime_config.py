import json
import os
import shutil
import sqlite3
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any

LEGACY_DOWNLOAD_ROOT = Path.home() / "Downloads" / "GRABIX"
APP_STATE_ROOT_ENV = "GRABIX_APP_STATE_ROOT"
PACKAGED_MODE_ENV = "GRABIX_PACKAGED_MODE"
RUNTIME_CONFIG_PATH_ENV = "GRABIX_RUNTIME_CONFIG_PATH"
TMDB_TOKEN_ENV_CANDIDATES = (
    "GRABIX_TMDB_BEARER_TOKEN",
    "TMDB_BEARER_TOKEN",
    "TMDB_TOKEN",
)
DESKTOP_AUTH_TOKEN_ENV = "GRABIX_DESKTOP_AUTH_TOKEN"
DESKTOP_AUTH_REQUIRED_ENV = "GRABIX_DESKTOP_AUTH_REQUIRED"
DESKTOP_AUTH_OBSERVE_ONLY_ENV = "GRABIX_DESKTOP_AUTH_OBSERVE_ONLY"
BACKEND_PORT_ENV = "GRABIX_BACKEND_PORT"
BACKEND_PUBLIC_BASE_ENV = "GRABIX_PUBLIC_BASE_URL"
ALLOWED_ORIGINS_ENV = "GRABIX_ALLOWED_ORIGINS"

_storage_lock = threading.Lock()
_storage_layout: dict[str, Any] | None = None


def legacy_download_root() -> Path:
    return LEGACY_DOWNLOAD_ROOT


def default_download_dir() -> Path:
    path = legacy_download_root()
    path.mkdir(parents=True, exist_ok=True)
    return path


def is_packaged_mode() -> bool:
    return str(os.getenv(PACKAGED_MODE_ENV, "")).strip().lower() in {"1", "true", "yes", "on"}


def runtime_config_path() -> Path:
    explicit = str(os.getenv(RUNTIME_CONFIG_PATH_ENV, "")).strip()
    if explicit:
        return Path(explicit).expanduser()
    return app_state_root() / "runtime-config.json"


@lru_cache(maxsize=1)
def load_runtime_config() -> dict[str, Any]:
    # Primary location: explicit env var or app_state_root
    primary = runtime_config_path()
    if primary.exists():
        try:
            return json.loads(primary.read_text(encoding="utf-8"))
        except Exception:
            return {}

    # FIX (movies not loading in packaged exe): runtime-config.json lives in
    # the backend/ source directory during development. In a packaged Tauri exe
    # the backend runs from a Tauri resource directory, NOT from the project
    # source tree. app_state_root() resolves to ~/Downloads/GRABIX/ which is
    # correct for databases/logs but the runtime-config.json is never copied
    # there on first install, so has_tmdb_token() always returns False and all
    # TMDB-backed pages (Movies, TV Series, Ratings) show nothing.
    #
    # We now fall back to searching three additional locations in order:
    #   1. GRABIX_RESOURCE_DIR env var  — set by Tauri for bundled resources
    #   2. Directory of the running script / frozen executable
    #   3. Parent of that directory     — common layout for pyinstaller bundles
    import sys

    candidate_dirs: list[Path] = []

    resource_dir = os.getenv("GRABIX_RESOURCE_DIR", "").strip()
    if resource_dir:
        candidate_dirs.append(Path(resource_dir))

    try:
        # sys.executable in a packaged exe is the exe itself; its parent dir
        # usually contains the bundled backend resources.
        exe_dir = Path(sys.executable).resolve().parent
        candidate_dirs.append(exe_dir)
        candidate_dirs.append(exe_dir.parent)
    except Exception:
        pass

    try:
        script_dir = Path(sys.argv[0]).resolve().parent
        if script_dir not in candidate_dirs:
            candidate_dirs.append(script_dir)
    except Exception:
        pass

    for directory in candidate_dirs:
        candidate = directory / "runtime-config.json"
        if candidate.exists():
            try:
                data = json.loads(candidate.read_text(encoding="utf-8"))
                # Copy to the canonical location so future calls (and cache
                # invalidation scenarios) find it without searching again.
                try:
                    primary.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(candidate, primary)
                except Exception:
                    pass
                return data
            except Exception:
                continue

    return {}


def _copy_file_if_missing(source: Path, destination: Path) -> bool:
    if not source.exists() or not source.is_file() or destination.exists():
        return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return True


def _validate_sqlite_file(path: Path) -> None:
    if not path.exists():
        return
    con = sqlite3.connect(path)
    try:
        result = con.execute("PRAGMA integrity_check(1)").fetchone()
        if not result or str(result[0]).lower() != "ok":
            raise RuntimeError(f"SQLite integrity check failed for {path}.")
    finally:
        con.close()


def _validate_settings_file(path: Path) -> None:
    if not path.exists():
        return
    json.loads(path.read_text(encoding="utf-8"))


def _compute_storage_layout() -> dict[str, Any]:
    legacy_root = legacy_download_root().resolve()
    preferred_root_raw = str(os.getenv(APP_STATE_ROOT_ENV, "")).strip()
    preferred_root = Path(preferred_root_raw).expanduser().resolve() if preferred_root_raw else legacy_root
    migration: dict[str, Any] = {
        "status": "not_needed" if preferred_root == legacy_root else "pending",
        "used_fallback": False,
        "copied": [],
        "error": "",
        "legacy_root": str(legacy_root),
        "preferred_root": str(preferred_root),
    }
    active_root = preferred_root

    try:
        default_download_dir()
        if preferred_root != legacy_root:
            preferred_root.mkdir(parents=True, exist_ok=True)

            copied: list[str] = []
            legacy_db = legacy_root / "grabix.db"
            legacy_settings = legacy_root / "grabix_settings.json"
            legacy_logs = legacy_root / "logs"

            if _copy_file_if_missing(legacy_db, preferred_root / "grabix.db"):
                copied.append("grabix.db")
            if _copy_file_if_missing(legacy_settings, preferred_root / "grabix_settings.json"):
                copied.append("grabix_settings.json")
            if legacy_logs.exists() and legacy_logs.is_dir():
                target_logs = preferred_root / "logs"
                if not target_logs.exists():
                    shutil.copytree(legacy_logs, target_logs, dirs_exist_ok=True)
                    copied.append("logs")

            _validate_sqlite_file(preferred_root / "grabix.db")
            _validate_settings_file(preferred_root / "grabix_settings.json")

            migration["copied"] = copied
            migration["status"] = "migrated" if copied else "already_present"

        active_root.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        active_root = legacy_root
        active_root.mkdir(parents=True, exist_ok=True)
        migration["status"] = "failed"
        migration["used_fallback"] = True
        migration["error"] = str(exc)

    (active_root / "logs").mkdir(parents=True, exist_ok=True)
    (active_root / "diagnostics").mkdir(parents=True, exist_ok=True)
    (active_root / "cache").mkdir(parents=True, exist_ok=True)
    (active_root / "runtime-tools").mkdir(parents=True, exist_ok=True)

    return {
        "legacy_root": legacy_root,
        "preferred_root": preferred_root,
        "active_root": active_root,
        "migration": migration,
    }


def storage_layout() -> dict[str, Any]:
    global _storage_layout
    if _storage_layout is None:
        with _storage_lock:
            if _storage_layout is None:
                _storage_layout = _compute_storage_layout()
    return _storage_layout


def reset_runtime_config_caches() -> None:
    global _storage_layout
    with _storage_lock:
        _storage_layout = None
    load_runtime_config.cache_clear()


def app_state_root() -> Path:
    return Path(storage_layout()["active_root"])


def db_path() -> Path:
    return app_state_root() / "grabix.db"


def settings_path() -> Path:
    return app_state_root() / "grabix_settings.json"


def logs_dir() -> Path:
    return app_state_root() / "logs"


def diagnostics_dir() -> Path:
    return app_state_root() / "diagnostics"


def runtime_tools_dir() -> Path:
    return app_state_root() / "runtime-tools"


def bundled_tools_dir() -> Path | None:
    """Return the path to tools bundled inside the Tauri installer, or None in dev mode."""
    resource_dir = os.getenv("GRABIX_RESOURCE_DIR", "").strip()
    return Path(resource_dir) / "tools" if resource_dir else None


def tmdb_bearer_token() -> str:
    for env_key in TMDB_TOKEN_ENV_CANDIDATES:
        value = str(os.getenv(env_key, "")).strip()
        if value:
            return value

    config = load_runtime_config()
    configured = str(config.get("tmdb_bearer_token") or "").strip()
    if configured:
        return configured

    return ""


def has_tmdb_token() -> bool:
    return bool(tmdb_bearer_token().strip())


def tmdb_config_source() -> str:
    for env_key in TMDB_TOKEN_ENV_CANDIDATES:
        value = str(os.getenv(env_key, "")).strip()
        if value:
            return f"env:{env_key}"

    config = load_runtime_config()
    configured = str(config.get("tmdb_bearer_token") or "").strip()
    if configured:
        return f"file:{runtime_config_path()}"

    return "missing"


def backend_port(default: int = 8000) -> int:
    raw = str(os.getenv(BACKEND_PORT_ENV, "")).strip()
    try:
        return int(raw or default)
    except ValueError:
        return default


def public_base_url() -> str:
    configured = str(os.getenv(BACKEND_PUBLIC_BASE_ENV, "")).strip().rstrip("/")
    if configured:
        return configured
    return f"http://127.0.0.1:{backend_port()}"


def desktop_auth_token() -> str:
    return str(os.getenv(DESKTOP_AUTH_TOKEN_ENV, "")).strip()


def is_desktop_auth_required() -> bool:
    return str(os.getenv(DESKTOP_AUTH_REQUIRED_ENV, "")).strip().lower() in {"1", "true", "yes", "on"}


def is_desktop_auth_observe_only() -> bool:
    return str(os.getenv(DESKTOP_AUTH_OBSERVE_ONLY_ENV, "")).strip().lower() in {"1", "true", "yes", "on"}


def runtime_config_snapshot() -> dict[str, Any]:
    layout = storage_layout()
    return {
        "packaged_mode": is_packaged_mode(),
        "app_state_root": str(app_state_root()),
        "legacy_download_root": str(legacy_download_root()),
        "default_download_dir": str(default_download_dir()),
        "db_path": str(db_path()),
        "settings_path": str(settings_path()),
        "logs_dir": str(logs_dir()),
        "diagnostics_dir": str(diagnostics_dir()),
        "runtime_tools_dir": str(runtime_tools_dir()),
        "runtime_config_path": str(runtime_config_path()),
        "tmdb_configured": has_tmdb_token(),
        "tmdb_config_source": tmdb_config_source(),
        "desktop_auth_required": is_desktop_auth_required(),
        "desktop_auth_ready": bool(desktop_auth_token()),
        "migration": layout["migration"],
    }
