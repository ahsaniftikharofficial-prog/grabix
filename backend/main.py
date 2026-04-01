import asyncio
import asyncio
import logging
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import yt_dlp, os, uuid, sqlite3, shutil, threading, subprocess, time, json, re, hashlib, socket, ipaddress, tempfile, zipfile
import ctypes
from pathlib import Path
from datetime import datetime
from difflib import SequenceMatcher
from urllib.parse import parse_qs, quote, unquote, urljoin, urlparse, urlencode
from urllib.request import Request as URLRequest, urlopen
from pydantic import BaseModel
from app.routes.consumet import router as consumet_router
from app.routes.downloads import router as downloads_router
from app.routes.manga import router as manga_router
from app.routes.providers import router as providers_router
from app.routes.settings import router as settings_router
from app.routes.streaming import router as streaming_router
from app.routes.subtitles import router as subtitles_router
from app.services.consumet import get_health_status as get_consumet_health_status
from app.services.logging_utils import LOG_DIR, backend_log_path, get_logger, log_event, read_recent_log_events
from app.services.archive_installer import parse_checksum_manifest, safe_extract_zip, sha256_file
from app.services.network_policy import validate_outbound_target
from app.services.runtime_state import RuntimeStateRegistry
from app.services.security import (
    DEFAULT_APPROVED_MEDIA_HOSTS,
    DEFAULT_LOCAL_APP_ORIGINS,
    ensure_safe_managed_path,
    normalize_download_target as security_normalize_download_target,
    redact_for_diagnostics,
    validate_outbound_url as security_validate_outbound_url,
)

try:
    import bcrypt
    BCRYPT_AVAILABLE = True
except Exception:
    bcrypt = None
    BCRYPT_AVAILABLE = False

try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.edge.options import Options as EdgeOptions
    SELENIUM_AVAILABLE = True
    SELENIUM_IMPORT_ERROR = ""
except Exception as exc:
    webdriver = None
    By = None
    EdgeOptions = None
    SELENIUM_AVAILABLE = False
    SELENIUM_IMPORT_ERROR = str(exc)

try:
    from moviebox_api import (
        Homepage as MovieBoxHomepage,
        HotMoviesAndTVSeries as MovieBoxHotMoviesAndTVSeries,
        MovieDetails as MovieBoxMovieDetails,
        PopularSearch as MovieBoxPopularSearch,
        Search as MovieBoxSearch,
        Trending as MovieBoxTrending,
        TVSeriesDetails as MovieBoxTVSeriesDetails,
    )
    from moviebox_api import (
        DownloadableMovieFilesDetail,
        DownloadableTVSeriesFilesDetail,
        Session as MovieBoxSession,
        SubjectType as MovieBoxSubjectType,
    )
    from moviebox_api.constants import DOWNLOAD_REQUEST_HEADERS as MOVIEBOX_DOWNLOAD_REQUEST_HEADERS
    MOVIEBOX_AVAILABLE = True
    MOVIEBOX_IMPORT_ERROR = ""
except Exception as exc:
    MOVIEBOX_AVAILABLE = False
    MOVIEBOX_IMPORT_ERROR = str(exc)
    MOVIEBOX_DOWNLOAD_REQUEST_HEADERS = {}

app = FastAPI()
LOCAL_APP_ORIGINS = DEFAULT_LOCAL_APP_ORIGINS
app.add_middleware(
    CORSMiddleware,
    allow_origins=LOCAL_APP_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Range"],
)
app.include_router(consumet_router, prefix="/consumet")
app.include_router(downloads_router)
app.include_router(manga_router, prefix="/manga")
app.include_router(providers_router)
app.include_router(settings_router)
app.include_router(streaming_router)
app.include_router(subtitles_router, prefix="/subtitles")
backend_logger = get_logger("backend")
downloads_logger = get_logger("downloads")
library_logger = get_logger("library")
playback_logger = get_logger("playback")

DOWNLOAD_DIR = str(Path.home() / "Downloads" / "GRABIX")
DB_PATH = str(Path.home() / "Downloads" / "GRABIX" / "grabix.db")
SETTINGS_PATH = str(Path.home() / "Downloads" / "GRABIX" / "grabix_settings.json")
RUNTIME_TOOLS_DIR = Path(DOWNLOAD_DIR) / "runtime-tools"

# Always create the download directory before any DB or file operations
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# In-memory progress store
runtime_state = RuntimeStateRegistry()
downloads: dict = runtime_state.downloads
download_controls: dict = runtime_state.download_controls
FFMPEG_PATH = shutil.which("ffmpeg")
ARIA2_PATH = shutil.which("aria2c")
SELF_BASE_URL = os.getenv("GRABIX_PUBLIC_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
STREAM_EXTRACT_CACHE_TTL_SECONDS = 900
stream_extract_cache: dict[str, tuple[float, dict]] = runtime_state.stream_extract_cache
ADULT_UNLOCK_WINDOW_SECONDS = 300
ADULT_UNLOCK_MAX_ATTEMPTS = 5
adult_unlock_attempts: dict[str, list[float]] = runtime_state.adult_unlock_attempts
APPROVED_MEDIA_HOSTS = DEFAULT_APPROVED_MEDIA_HOSTS
EDGE_BINARY_PATH = next(
    (
        path
        for path in (
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        )
        if os.path.exists(path)
    ),
    "",
)
ANIME_RESOLVE_CACHE_TTL_SECONDS = 300
anime_resolve_cache: dict[str, tuple[float, dict]] = runtime_state.anime_resolve_cache
CONSUMET_HEALTH_CACHE_TTL_SECONDS = 15
consumet_health_cache: tuple[float, dict] | None = None
dependency_install_jobs: dict[str, dict] = runtime_state.dependency_install_jobs


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


def _is_internal_managed_file(path: Path) -> bool:
    try:
        resolved = path.resolve()
        log_root = LOG_DIR.resolve()
        if resolved == log_root or log_root in resolved.parents:
            return True
    except Exception:
        pass

    ignored_names = {Path(DB_PATH).name, Path(SETTINGS_PATH).name}
    return path.name in ignored_names


class AnimeResolveRequest(BaseModel):
    episodeId: str
    animeId: str = ""
    title: str = ""
    altTitle: str = ""
    episodeNumber: int = 1
    audio: str = "original"
    server: str = "auto"
    isMovie: bool = False
    tmdbId: int | None = None
    purpose: str = "play"


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


def _strip_ansi(s: str) -> str:
    """Remove ANSI terminal color codes from a string."""
    return re.sub(r"\x1b\[[0-9;]*[mGKH]", "", s or "").strip()


def has_ffmpeg() -> bool:
    return FFMPEG_PATH is not None


def has_aria2() -> bool:
    return ARIA2_PATH is not None


def _sanitize_download_engine(engine: str | None) -> str:
    normalized = str(engine or "").strip().lower()
    return normalized if normalized in {"standard", "aria2"} else "standard"


def _format_bytes(num: float | int | None) -> str:
    if not num:
        return ""
    value = float(num)
    units = ["B", "KB", "MB", "GB", "TB"]
    idx = 0
    while value >= 1024 and idx < len(units) - 1:
        value /= 1024
        idx += 1
    if idx == 0:
        return f"{int(value)} {units[idx]}"
    return f"{value:.1f} {units[idx]}"


def _format_eta(seconds: float | int | None) -> str:
    if seconds is None:
        return ""
    safe = max(0, int(seconds))
    mins, secs = divmod(safe, 60)
    hours, mins = divmod(mins, 60)
    if hours:
        return f"{hours}h {mins}m"
    if mins:
        return f"{mins}m {secs}s"
    return f"{secs}s"


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


def _normalize_category_label(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(value or "").strip())
    if not cleaned:
        return ""
    lowered = cleaned.lower()
    mapping = {
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
    return mapping.get(lowered, cleaned.title())


def _infer_download_category(url: str, title: str, dl_type: str, category: str = "") -> str:
    normalized = _normalize_category_label(category)
    if normalized and normalized not in {"Video", "Videos"}:
        return normalized

    haystack = f"{title} {url}".lower()
    host = (urlparse(url).hostname or "").lower()

    if "youtube" in host or "youtu.be" in host:
        return "YouTube"
    if "mangadex" in host or "comick" in host or "manga" in haystack:
        return "Manga"
    if "anime" in haystack or "hianime" in host or "aniwatch" in host:
        return "Anime"
    if "comic" in haystack:
        return "Comics"
    if "light novel" in haystack:
        return "Light Novels"
    if "book" in haystack or "libgen" in host or "openlibrary" in host:
        return "Books"
    if dl_type == "subtitle":
        return "Subtitles"
    if dl_type == "audio":
        return "Audio"
    if dl_type == "thumbnail":
        return "Other"
    return "Movies"


def _infer_library_display_layout(
    url: str,
    title: str,
    dl_type: str,
    category: str = "",
) -> str:
    inferred_category = _infer_download_category(url, title, dl_type, category)
    if inferred_category in {"Movies", "Anime", "Manga", "Books", "Comics", "Light Novels"}:
        return "poster"
    if inferred_category in {"YouTube", "TV Series"}:
        return "landscape"
    if dl_type in {"audio", "subtitle", "thumbnail"}:
        return "square"
    return "landscape"


def _normalize_tags_csv(tags_csv: str = "", category: str = "", dl_type: str = "") -> str:
    tokens: list[str] = []
    for raw in str(tags_csv or "").split(","):
        cleaned = re.sub(r"\s+", " ", raw).strip()
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
def get_db_connection():
    """Return a new sqlite3 connection with row_factory set."""
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    """Create all required tables if they don't exist."""
    try:
        con = get_db_connection()
        con.execute("""
            CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                url TEXT,
                title TEXT,
                thumbnail TEXT,
                channel TEXT,
                duration INTEGER,
                dl_type TEXT,
                file_path TEXT,
                status TEXT,
                created_at TEXT
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS download_jobs (
                id TEXT PRIMARY KEY,
                url TEXT,
                title TEXT,
                thumbnail TEXT,
                dl_type TEXT,
                status TEXT,
                created_at TEXT,
                updated_at TEXT,
                file_path TEXT,
                partial_file_path TEXT,
                error TEXT,
                percent REAL DEFAULT 0,
                speed TEXT DEFAULT '',
                eta TEXT DEFAULT '',
                downloaded TEXT DEFAULT '',
                total TEXT DEFAULT '',
                size TEXT DEFAULT '',
                can_pause INTEGER DEFAULT 0,
                retry_count INTEGER DEFAULT 0,
                failure_code TEXT DEFAULT '',
                recoverable INTEGER DEFAULT 0,
                download_strategy TEXT DEFAULT '',
                params_json TEXT DEFAULT '{}'
            )
        """)
        con.commit()
        con.close()
        log_event(backend_logger, logging.INFO, event="db_init", message="Database initialized successfully.")
    except Exception as e:
        log_event(backend_logger, logging.ERROR, event="db_init_failed", message="Database initialization failed.", details={"error": str(e)})


init_db()


def db_insert(row: dict):
    try:
        con = get_db_connection()
        con.execute(
            """
            INSERT OR REPLACE INTO history
            (id, url, title, thumbnail, channel, duration, dl_type, file_path, status, created_at, tags, category, file_size)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["id"],
                row["url"],
                row["title"],
                row["thumbnail"],
                row["channel"],
                row["duration"],
                row["dl_type"],
                row["file_path"],
                row["status"],
                row["created_at"],
                row.get("tags", ""),
                row.get("category", ""),
                row.get("file_size", 0),
            ),
        )
        con.commit()
        con.close()
    except Exception as e:
        log_event(backend_logger, logging.ERROR, event="history_insert_failed", message="History insert failed.", details={"error": str(e), "row_id": row.get("id", "")})


def db_update_status(dl_id: str, status: str, file_path: str = ""):
    try:
        con = get_db_connection()
        con.execute("UPDATE history SET status=?, file_path=? WHERE id=?", (status, file_path, dl_id))
        con.commit()
        con.close()
    except Exception as e:
        log_event(backend_logger, logging.ERROR, event="history_status_update_failed", message="History status update failed.", details={"error": str(e), "download_id": dl_id, "status": status})


def db_upsert_download_job(row: dict):
    try:
        now = datetime.now().isoformat()
        con = get_db_connection()
        con.execute(
            """
            INSERT INTO download_jobs
            (id, url, title, thumbnail, dl_type, status, created_at, updated_at,
             file_path, partial_file_path, error, percent, speed, eta, downloaded,
             total, size, can_pause, retry_count, failure_code, recoverable,
             download_strategy, params_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                url=excluded.url,
                title=excluded.title,
                thumbnail=excluded.thumbnail,
                dl_type=excluded.dl_type,
                status=excluded.status,
                updated_at=excluded.updated_at,
                file_path=excluded.file_path,
                partial_file_path=excluded.partial_file_path,
                error=excluded.error,
                percent=excluded.percent,
                speed=excluded.speed,
                eta=excluded.eta,
                downloaded=excluded.downloaded,
                total=excluded.total,
                size=excluded.size,
                can_pause=excluded.can_pause,
                retry_count=excluded.retry_count,
                failure_code=excluded.failure_code,
                recoverable=excluded.recoverable,
                download_strategy=excluded.download_strategy,
                params_json=excluded.params_json
            """,
            (
                row["id"],
                row.get("url", ""),
                row.get("title", ""),
                row.get("thumbnail", ""),
                row.get("dl_type", ""),
                row.get("status", "queued"),
                row.get("created_at", now),
                row.get("updated_at", now),
                row.get("file_path", ""),
                row.get("partial_file_path", ""),
                row.get("error", ""),
                float(row.get("percent", 0) or 0),
                row.get("speed", ""),
                row.get("eta", ""),
                row.get("downloaded", ""),
                row.get("total", ""),
                row.get("size", ""),
                1 if row.get("can_pause") else 0,
                int(row.get("retry_count", 0) or 0),
                row.get("failure_code", ""),
                1 if row.get("recoverable") else 0,
                row.get("download_strategy", ""),
                row.get("params_json", "{}"),
            ),
        )
        con.commit()
        con.close()
    except Exception as e:
        log_event(backend_logger, logging.ERROR, event="download_job_upsert_failed", message="Download job persistence failed.", details={"error": str(e), "download_id": row.get("id", "")})


def db_delete_download_job(dl_id: str):
    try:
        con = get_db_connection()
        con.execute("DELETE FROM download_jobs WHERE id=?", (dl_id,))
        con.commit()
        con.close()
    except Exception as e:
        log_event(backend_logger, logging.ERROR, event="download_job_delete_failed", message="Download job deletion failed.", details={"error": str(e), "download_id": dl_id})


def db_list_download_jobs() -> list[sqlite3.Row]:
    try:
        con = get_db_connection()
        rows = con.execute(
            "SELECT * FROM download_jobs ORDER BY created_at DESC, updated_at DESC"
        ).fetchall()
        con.close()
        return rows
    except Exception as e:
        log_event(backend_logger, logging.ERROR, event="download_job_list_failed", message="Download job listing failed.", details={"error": str(e)})
        return []


# ── Settings ──────────────────────────────────────────────────────────────────
DEFAULT_SETTINGS = {
    "theme": "dark",
    "auto_fetch": True,
    "notifications": True,
    "default_format": "mp4",
    "default_quality": "1080p",
    "default_download_engine": "standard",
    "download_folder": DOWNLOAD_DIR,
    "adult_content_enabled": False,
    "adult_password_hash": "",
    "adult_password_configured": False,
}


def load_settings() -> dict:
    try:
        if os.path.exists(SETTINGS_PATH):
            with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
                if saved.get("adult_password_hash") and not saved.get("adult_password_configured"):
                    saved["adult_password_configured"] = True
                # Merge with defaults so any new keys are always present
                return {**DEFAULT_SETTINGS, **saved}
    except Exception as e:
        log_event(backend_logger, logging.ERROR, event="settings_load_failed", message="Settings load failed.", details={"error": str(e)})
    return DEFAULT_SETTINGS.copy()


def save_settings_to_disk(data: dict):
    try:
        current = load_settings()
        current.update(data)
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2)
    except Exception as e:
        log_event(backend_logger, logging.ERROR, event="settings_save_failed", message="Settings save failed.", details={"error": str(e)})


def _settings_public_payload(data: dict) -> dict:
    payload = {**DEFAULT_SETTINGS, **(data or {})}
    payload.pop("adult_password_hash", None)
    payload["adult_content_enabled"] = False
    payload["adult_password_configured"] = bool((data or {}).get("adult_password_hash"))
    return payload


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/")
def home():
    return {"status": "GRABIX Backend Running"}


def _extract_iframe_src(html: str) -> str:
    content = html or ""
    iframe_match = re.search(r'<iframe[^>]+src=["\']([^"\']+)["\']', content, re.IGNORECASE)
    if iframe_match:
        return iframe_match.group(1).strip()

    scripted_match = re.search(r"src:\s*['\"]([^'\"]+)['\"]", content, re.IGNORECASE)
    if scripted_match:
        return scripted_match.group(1).strip()

    return ""


def _resolve_embed_target(url: str, max_depth: int = 3) -> str:
    current = _validate_outbound_url(url)
    if not current:
        return ""

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": current,
    }

    for _ in range(max_depth):
        current = _validate_outbound_url(current)
        req = URLRequest(current, headers=headers)
        with urlopen(req, timeout=12) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        iframe_src = _extract_iframe_src(html)
        if not iframe_src:
            return current

        next_url = urljoin(current, iframe_src)
        _validate_outbound_url(next_url)
        if next_url == current:
            return current

        if any(host in next_url for host in ("vidsrc.to", "vsembed.ru")):
            current = next_url
            continue

        return next_url

    return current


def resolve_embed(url: str):
    try:
        _validate_outbound_url(url)
        resolved = _resolve_embed_target(url)
        return {"url": resolved or url}
    except Exception as e:
        return {"url": url, "error": str(e)}


def stream_proxy(url: str, request: Request, headers_json: str = ""):
    _validate_outbound_url(url)
    parsed_headers: dict[str, str] = {}
    if headers_json:
        try:
            decoded = json.loads(headers_json)
            if isinstance(decoded, dict):
                parsed_headers = {
                    str(key): str(value)
                    for key, value in decoded.items()
                    if value is not None and str(value).strip()
                }
        except Exception:
            parsed_headers = {}

    request_headers = _normalize_request_headers(parsed_headers)
    range_header = request.headers.get("range")
    if range_header:
        request_headers["Range"] = range_header

    upstream_request = URLRequest(url, headers=request_headers)
    try:
        upstream_response = urlopen(upstream_request, timeout=30)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Stream proxy failed: {exc}") from exc

    media_type = upstream_response.headers.get("Content-Type", "application/octet-stream")
    final_url = upstream_response.geturl()
    lowered_url = final_url.lower()
    lowered_media = media_type.lower()
    if ".m3u8" in lowered_url or "mpegurl" in lowered_media:
        try:
            payload = upstream_response.read()
        finally:
            upstream_response.close()
        text = payload.decode("utf-8", errors="ignore")
        rewritten = _rewrite_hls_playlist(text, final_url, headers_json)
        return Response(
            content=rewritten,
            media_type="application/vnd.apple.mpegurl",
            headers={
                "Cache-Control": "no-store",
            },
        )

    response_headers = {}
    for header_name in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"):
        header_value = upstream_response.headers.get(header_name)
        if header_value:
            response_headers[header_name] = header_value

    first_chunk = upstream_response.read(1024 * 64)
    sniffed_media_type = media_type or "application/octet-stream"
    if first_chunk and first_chunk[:1] == b"G":
        lowered_media = sniffed_media_type.lower()
        if (
            lowered_media.startswith("image/")
            or lowered_media.startswith("text/")
            or lowered_media in {"application/octet-stream", "application/unknown"}
        ):
            sniffed_media_type = "video/mp2t"
            response_headers["Content-Type"] = sniffed_media_type

    def iter_stream():
        try:
            if first_chunk:
                yield first_chunk
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
        media_type=sniffed_media_type,
    )


def stream_variants(url: str, headers_json: str = ""):
    _validate_outbound_url(url)
    parsed_headers: dict[str, str] = {}
    if headers_json:
        try:
            decoded = json.loads(headers_json)
            if isinstance(decoded, dict):
                parsed_headers = {
                    str(key): str(value)
                    for key, value in decoded.items()
                    if value is not None and str(value).strip()
                }
        except Exception:
            parsed_headers = {}

    request = URLRequest(url, headers=_normalize_request_headers(parsed_headers))
    try:
        with urlopen(request, timeout=30) as response:
            media_type = response.headers.get("Content-Type", "application/octet-stream")
            payload = response.read().decode("utf-8", errors="ignore")
            final_url = response.geturl()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Variant detection failed: {exc}") from exc

    lowered_url = final_url.lower()
    lowered_media = media_type.lower()
    if ".m3u8" not in lowered_url and "mpegurl" not in lowered_media:
        return {"variants": []}

    return {"variants": _extract_hls_variants(payload, final_url)}


def _fetch_json(url: str, *, headers: dict[str, str] | None = None, timeout: int = 25) -> dict:
    request = URLRequest(url, headers=headers or {"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8", errors="ignore")
    return json.loads(raw or "{}")


def _normalize_request_headers(headers: dict[str, str] | None = None) -> dict[str, str]:
    normalized = {"User-Agent": "Mozilla/5.0"}
    if headers:
        normalized.update(
            {
                str(key): str(value)
                for key, value in headers.items()
                if value is not None and str(value).strip()
            }
        )
    return normalized


def _rewrite_hls_playlist(content: str, base_url: str, headers_json: str) -> str:
    params_suffix = f"&headers_json={quote(headers_json, safe='')}" if headers_json else ""
    rewritten: list[str] = []
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            if 'URI="' in raw_line:
                rewritten.append(
                    re.sub(
                        r'URI="([^"]+)"',
                        lambda match: (
                            'URI="/stream/proxy?url='
                            + quote(urljoin(base_url, match.group(1)), safe="")
                            + params_suffix
                            + '"'
                        ),
                        raw_line,
                    )
                )
            else:
                rewritten.append(raw_line)
            continue
        absolute_url = urljoin(base_url, line)
        proxied = f"/stream/proxy?url={quote(absolute_url, safe='')}{params_suffix}"
        rewritten.append(proxied)
    return "\n".join(rewritten)


def _extract_hls_variants(content: str, base_url: str) -> list[dict[str, str]]:
    variants: list[dict[str, str]] = []
    pending_label = ""
    pending_bandwidth = 0
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#EXT-X-STREAM-INF:"):
            resolution_match = re.search(r"RESOLUTION=\d+x(\d+)", line, re.IGNORECASE)
            bandwidth_match = re.search(r"(?:AVERAGE-BANDWIDTH|BANDWIDTH)=(\d+)", line, re.IGNORECASE)
            height = resolution_match.group(1) if resolution_match else ""
            pending_label = f"{height}p" if height else "Auto"
            pending_bandwidth = int(bandwidth_match.group(1)) if bandwidth_match else 0
            continue
        if line.startswith("#"):
            continue
        variants.append({
            "label": pending_label or "Auto",
            "url": urljoin(base_url, line),
            "bandwidth": str(pending_bandwidth),
        })
        pending_label = ""
        pending_bandwidth = 0
    return variants


def _anime_resolve_cache_key(payload: AnimeResolveRequest) -> str:
    return "|".join(
        [
            payload.episodeId,
            payload.audio,
            payload.server,
            payload.purpose,
            str(payload.episodeNumber),
            str(payload.tmdbId or ""),
        ]
    )


def _get_cached_anime_resolution(payload: AnimeResolveRequest) -> dict | None:
    cache_key = _anime_resolve_cache_key(payload)
    cached = anime_resolve_cache.get(cache_key)
    if not cached:
        return None
    expires_at, result = cached
    if time.time() >= expires_at:
        anime_resolve_cache.pop(cache_key, None)
        return None
    return result


def _set_cached_anime_resolution(payload: AnimeResolveRequest, result: dict) -> None:
    anime_resolve_cache[_anime_resolve_cache_key(payload)] = (
        time.time() + ANIME_RESOLVE_CACHE_TTL_SECONDS,
        result,
    )


def _extract_stream_url(url: str) -> tuple[str, str]:
    result = subprocess.run(
        ["yt-dlp", "--get-url", "--no-playlist", url],
        capture_output=True,
        text=True,
        timeout=30,
    )
    output_lines = result.stdout.strip().splitlines()
    direct_url = output_lines[0].strip() if output_lines else ""
    if not direct_url:
        raise RuntimeError(result.stderr.strip() or "No stream found")
    return direct_url, ("hls" if ".m3u8" in direct_url.lower() else "direct")


def _looks_like_playable_media_url(url: str) -> bool:
    lowered = str(url or "").lower()
    return any(
        token in lowered
        for token in (
            ".m3u8",
            ".mp4",
            ".m4v",
            ".webm",
            ".mpd",
            "/master.m3u8",
        )
    )


def _extract_stream_url_via_browser(url: str) -> tuple[str, str] | None:
    if not SELENIUM_AVAILABLE or not EDGE_BINARY_PATH:
        return None

    options = EdgeOptions()
    options.binary_location = EDGE_BINARY_PATH
    options.page_load_strategy = "eager"
    options.add_argument("--headless=new")
    options.add_argument("--window-size=1280,720")
    options.add_argument("--autoplay-policy=no-user-gesture-required")
    options.add_argument("--disable-features=msEdgeSidebarV2")
    options.add_argument("--mute-audio")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-extensions")
    options.add_argument("--disable-background-networking")
    options.add_argument("--disable-renderer-backgrounding")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    options.add_argument("--disable-popup-blocking")
    options.add_argument("--disable-dev-shm-usage")
    options.set_capability("goog:loggingPrefs", {"performance": "ALL"})
    options.set_capability("ms:loggingPrefs", {"performance": "ALL"})

    driver = None
    try:
        driver = webdriver.Edge(options=options)
        driver.set_page_load_timeout(20)
        driver.set_script_timeout(10)
        driver.set_window_position(-2000, 0)
        try:
            target_url = _resolve_embed_target(url)
        except Exception:
            target_url = url
        driver.get(target_url or url)

        deadline = time.time() + 12
        seen_urls: set[str] = set()

        while time.time() < deadline:
            try:
                entries = driver.execute_script(
                    """
                    return performance.getEntriesByType('resource')
                      .map((entry) => entry.name)
                      .filter(Boolean);
                    """
                ) or []
            except Exception:
                entries = []

            for candidate in entries:
                candidate_url = str(candidate or "").strip()
                if not candidate_url or candidate_url in seen_urls:
                    continue
                seen_urls.add(candidate_url)
                if _looks_like_playable_media_url(candidate_url):
                    return candidate_url, ("hls" if ".m3u8" in candidate_url.lower() else "direct")

            try:
                performance_logs = driver.get_log("performance")
            except Exception:
                performance_logs = []

            for entry in performance_logs:
                try:
                    message = json.loads(entry["message"]).get("message", {})
                    method = message.get("method", "")
                    params = message.get("params", {})
                    request_url = (
                        params.get("request", {}).get("url")
                        or params.get("response", {}).get("url")
                        or ""
                    )
                    request_url = str(request_url).strip()
                    if not request_url or request_url in seen_urls:
                        continue
                    seen_urls.add(request_url)
                    if method.startswith("Network.") and _looks_like_playable_media_url(request_url):
                        return request_url, ("hls" if ".m3u8" in request_url.lower() else "direct")
                except Exception:
                    continue

            time.sleep(0.6)
    except Exception as exc:
        log_event(
            playback_logger,
            logging.ERROR,
            event="browser_stream_resolver_failed",
            message="Browser stream resolver failed.",
            details={"error": str(exc), "url": url[:180]},
        )
    finally:
        if driver is not None:
            try:
                driver.quit()
            except Exception:
                pass

    return None


def _anime_server_order(server: str) -> list[str]:
    normalized = (server or "auto").strip().lower()
    if normalized in {"auto", ""}:
        return ["hd-1", "hd-2"]
    return [normalized]


def _map_audio_category(audio: str) -> str:
    return "dub" if str(audio or "").lower() == "en" else "sub"


def _normalize_resolved_source(
    *,
    source_url: str,
    kind: str,
    provider: str,
    selected_server: str,
    strategy: str,
    headers: dict[str, str] | None = None,
    subtitles: list[dict] | None = None,
    tried: list[dict] | None = None,
) -> dict:
    return {
        "source": {
            "url": source_url,
            "kind": kind,
            "headers": headers or {},
        },
        "subtitles": subtitles or [],
        "provider": provider,
        "selectedServer": selected_server,
        "strategy": strategy,
        "tried": tried or [],
    }


def _convert_hianime_source_payload(payload: dict, server: str, tried: list[dict]) -> dict | None:
    sources = payload.get("sources") or []
    subtitles = payload.get("subtitles") or []
    headers = payload.get("headers") or {}
    for item in sources:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or item.get("file") or item.get("src") or "").strip()
        if not url:
            continue
        kind = "hls" if item.get("isM3U8") or ".m3u8" in url.lower() else ("embed" if item.get("isEmbed") else "direct")
        if kind == "embed":
            continue
        return _normalize_resolved_source(
            source_url=url,
            kind=kind,
            provider="HiAnime",
            selected_server=server,
            strategy="hianime-direct",
            headers=headers,
            subtitles=subtitles,
            tried=tried,
        )
    return None


def _capture_hianime_stream_via_edge(embed_url: str, watch_url: str, server: str, tried: list[dict]) -> dict | None:
    if not SELENIUM_AVAILABLE:
        raise RuntimeError(f"Selenium is unavailable: {SELENIUM_IMPORT_ERROR}")
    if not EDGE_BINARY_PATH:
        raise RuntimeError("Microsoft Edge is not installed.")

    options = EdgeOptions()
    options.binary_location = EDGE_BINARY_PATH
    options.add_argument("--headless=new")
    options.add_argument("--autoplay-policy=no-user-gesture-required")
    options.add_argument("--disable-features=msEdgeSidebarV2")
    options.add_argument("--mute-audio")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-extensions")
    options.add_argument("--disable-background-networking")
    options.add_argument("--disable-renderer-backgrounding")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    options.add_argument("--disable-popup-blocking")
    options.add_argument("--disable-dev-shm-usage")

    driver = webdriver.Edge(options=options)
    try:
        driver.set_window_position(-2000, 0)
        driver.set_window_size(1280, 720)
        driver.get(watch_url or embed_url)
        time.sleep(6)
        if embed_url and embed_url not in driver.current_url:
            driver.get(embed_url)
            time.sleep(6)

        for _ in range(12):
            entries = driver.execute_script(
                """
                return performance.getEntriesByType('resource')
                  .map((entry) => entry.name)
                  .filter((name) => name.includes('.m3u8') || name.includes('.mp4'));
                """
            ) or []
            if entries:
                url = str(entries[-1])
                return _normalize_resolved_source(
                    source_url=url,
                    kind="hls" if ".m3u8" in url.lower() else "direct",
                    provider="HiAnime",
                    selected_server=server,
                    strategy="hianime-browser-capture",
                    headers={"Referer": watch_url or embed_url},
                    subtitles=[],
                    tried=tried,
                )
            time.sleep(1.5)
        return None
    finally:
        driver.quit()


def _fallback_embed_sources(tmdb_id: int | None, season: int, episode: int) -> list[dict]:
    if not tmdb_id:
        return []
    providers = [
        ("VidSrc.mov", f"https://vidsrc.mov/embed/tv/{tmdb_id}/{season}/{episode}"),
    ]
    return [{"provider": provider, "url": url} for provider, url in providers]


def _resolve_fallback_provider(tmdb_id: int | None, season: int, episode: int, tried: list[dict]) -> dict | None:
    for candidate in _fallback_embed_sources(tmdb_id, season, episode):
        try:
            resolved_url = _resolve_embed_target(candidate["url"])
            direct_url, kind = _extract_stream_url(resolved_url)
            return _normalize_resolved_source(
                source_url=direct_url,
                kind=kind,
                provider=candidate["provider"],
                selected_server="fallback",
                strategy="fallback-provider",
                headers={"Referer": resolved_url},
                subtitles=[],
                tried=tried,
            )
        except Exception as exc:
            tried.append({"server": candidate["provider"], "stage": "fallback-provider", "detail": str(exc)})
            continue
    return None


@app.post("/anime/resolve-source")
async def anime_resolve_source(payload: AnimeResolveRequest):
    cached = _get_cached_anime_resolution(payload)
    if cached:
        return cached

    tried: list[dict] = []
    episode_id = payload.episodeId.strip()
    if not episode_id:
        raise HTTPException(status_code=400, detail="episodeId is required")

    try:
        from app.services.consumet import fetch_anime_watch
        watch_payload = await fetch_anime_watch(
            provider="hianime",
            episode_id=episode_id,
            server=payload.server,
            audio=payload.audio
        )
        sources = watch_payload.get("sources")
        if sources and isinstance(sources, list):
            target_source = sources[0]
            kind = "hls" if target_source.get("isM3U8") else ("embed" if target_source.get("isEmbed") else "direct")
            resolution = {
                "source": {
                    "url": target_source.get("url"),
                    "kind": kind,
                    "headers": watch_payload.get("headers") or {}
                },
                "subtitles": watch_payload.get("subtitles") or [],
                "provider": "HiAnime",
                "selectedServer": target_source.get("quality", payload.server),
                "strategy": "HiAnime Direct Resolution",
            }
            _set_cached_anime_resolution(payload, resolution)
            return resolution
    except Exception as exc:
        tried.append(
            {
                "server": payload.server,
                "stage": "anime-primary",
                "detail": f"Direct HiAnime sidecar resolution failed {exc}. Using built-in fallback chain.",
            }
        )

    fallback_result = _resolve_fallback_provider(
        payload.tmdbId,
        1,
        max(1, payload.episodeNumber),
        tried,
    )
    if fallback_result:
        _set_cached_anime_resolution(payload, fallback_result)
        return fallback_result

    raise HTTPException(
        status_code=422,
        detail={
            "message": "Stream unavailable - HiAnime protected source could not be resolved.",
            "tried": tried,
        },
    )


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


# ── Quality helpers ───────────────────────────────────────────────────────────
# Standard quality tiers: height → display label
MOVIEBOX_CACHE_TTL_SECONDS = 60 * 15
moviebox_cache: dict[str, tuple[float, object]] = {}
moviebox_item_registry: dict[str, tuple[float, object]] = {}


def _moviebox_assert_available():
    if not MOVIEBOX_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail=f"moviebox-api is not available: {MOVIEBOX_IMPORT_ERROR or 'not installed'}",
        )


def _moviebox_cache_get(key: str):
    cached = moviebox_cache.get(key)
    if not cached:
        return None
    expires_at, payload = cached
    if expires_at <= time.time():
        moviebox_cache.pop(key, None)
        return None
    return payload


def _moviebox_cache_set(key: str, payload, ttl: int = MOVIEBOX_CACHE_TTL_SECONDS):
    moviebox_cache[key] = (time.time() + ttl, payload)
    return payload


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
    cached = _moviebox_cache_get(cache_key)
    if cached is not None:
        return cached

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
    return _moviebox_cache_set(cache_key, payload)


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


@app.get("/moviebox/search")
async def moviebox_search(title: str, media_type: str = "movie", year: int | None = None):
    normalized_media_type = _moviebox_media_type_value(media_type)
    _, item = await _moviebox_find_item(title, normalized_media_type, year)
    return _moviebox_subject_payload(item)


@app.get("/moviebox/discover")
async def moviebox_discover():
    return await _moviebox_discover_payload()


@app.get("/moviebox/search-items")
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
    cached = _moviebox_cache_get(cache_key)
    if cached is not None:
        return cached

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
    return _moviebox_cache_set(cache_key, payload)


@app.get("/moviebox/details")
async def moviebox_details(
    subject_id: str | None = None,
    title: str | None = None,
    media_type: str = "movie",
    year: int | None = None,
):
    normalized_media_type = _moviebox_media_type_value(media_type)
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
        except Exception:
            pass

    return {
        "provider": "MovieBox",
        "item": payload,
    }


@app.get("/moviebox/sources")
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


@app.get("/moviebox/subtitle")
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


@app.get("/moviebox/poster")
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


@app.get("/moviebox/proxy-stream")
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


def _build_video_format_selector(quality: str) -> str:
    h = _label_to_max_height(quality)
    if has_ffmpeg():
        return (
            f"bestvideo[height<={h}][ext=mp4]+bestaudio[ext=m4a]"
            f"/bestvideo[height<={h}]+bestaudio"
            f"/best[height<={h}][ext=mp4]"
            f"/best[height<={h}]"
            f"/best"
        )
    return f"best[height<={h}][ext=mp4]/best[height<={h}]/best"


def _is_direct_media_url(url: str) -> bool:
    lowered = (url or "").lower()
    parsed = urlparse(lowered)
    if "/moviebox/proxy-stream" in lowered:
        return True
    return parsed.path.endswith((".mp4", ".m4v", ".mov", ".webm", ".mkv"))


def _is_direct_subtitle_url(url: str) -> bool:
    lowered = (url or "").lower()
    parsed = urlparse(lowered)
    if "/moviebox/subtitle" in lowered:
        return True
    return parsed.path.endswith((".vtt", ".srt", ".ass", ".ssa", ".sub"))


def _guess_media_extension(url: str, content_type: str = "") -> str:
    lowered = (content_type or "").lower()
    if "mp4" in lowered:
        return "mp4"
    if "webm" in lowered:
        return "webm"
    if "quicktime" in lowered or "mov" in lowered:
        return "mov"
    if "matroska" in lowered or "mkv" in lowered:
        return "mkv"

    path = urlparse(url).path.lower()
    for ext in (".mp4", ".webm", ".mov", ".mkv", ".m4v"):
        if path.endswith(ext):
            return ext.lstrip(".")
    return "mp4"


def _guess_subtitle_extension(url: str, content_type: str = "") -> str:
    lowered = (content_type or "").lower()
    if "vtt" in lowered:
        return "vtt"
    if "srt" in lowered:
        return "srt"
    if "ass" in lowered:
        return "ass"
    if "ssa" in lowered:
        return "ssa"

    path = urlparse(url).path.lower()
    for ext in (".vtt", ".srt", ".ass", ".ssa", ".sub"):
        if path.endswith(ext):
            return ext.lstrip(".")
    return "vtt"


def _parse_timecode_to_seconds(value: str) -> float:
    try:
        parts = str(value or "").strip().split(":")
        if len(parts) != 3:
            return 0.0
        hours = float(parts[0])
        minutes = float(parts[1])
        seconds = float(parts[2])
        return (hours * 3600) + (minutes * 60) + seconds
    except Exception:
        return 0.0


def _set_ffmpeg_process_state(pid: int, suspend: bool) -> bool:
    if os.name != "nt" or not pid or not _kernel32 or not _ntdll:
        return False
    access = PROCESS_SUSPEND_RESUME | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION
    handle = _kernel32.OpenProcess(access, False, int(pid))
    if not handle:
        return False
    try:
        operation = _ntdll.NtSuspendProcess if suspend else _ntdll.NtResumeProcess
        result = operation(handle)
        return int(result) == 0
    except Exception:
        return False
    finally:
        _kernel32.CloseHandle(handle)


def _delete_download_files(item: dict) -> None:
    file_path = str(item.get("file_path") or "").strip()
    partial_file_path = str(item.get("partial_file_path") or "").strip()
    if not file_path:
        if not partial_file_path:
            return
        candidates = set()
    else:
        candidates = {file_path}
    if partial_file_path:
        candidates.add(partial_file_path)
    if file_path.endswith(".mkv"):
        candidates.add(f"{file_path}.part.mkv")
    candidates.add(f"{file_path}.part")
    candidates.add(f"{file_path}.aria2")
    if partial_file_path:
        candidates.add(f"{partial_file_path}.aria2")
    for candidate in candidates:
        try:
            path = Path(candidate)
            if path.exists():
                path.unlink()
        except Exception:
            continue


WINDOWS_RESERVED_FILENAMES = {
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
}


def _safe_download_stem(raw_title: str, fallback: str) -> str:
    cleaned = str(raw_title or "")
    cleaned = re.sub(r"[\x00-\x1f]+", " ", cleaned)
    cleaned = re.sub(r'[\\/:*?"<>|]+', " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().rstrip(" .")
    if not cleaned:
        cleaned = fallback
    cleaned = cleaned[:140].strip().rstrip(" .")
    if not cleaned:
        cleaned = fallback
    if cleaned.split(".", 1)[0].upper() in WINDOWS_RESERVED_FILENAMES:
        cleaned = f"{cleaned}_file"
    return cleaned or fallback


def _safe_download_path(base_dir: str, raw_title: str, extension: str, fallback: str) -> str:
    stem = _safe_download_stem(raw_title, fallback)
    ext = re.sub(r"[^A-Za-z0-9]+", "", str(extension or "").lstrip(".")) or "bin"
    return str(Path(base_dir) / f"{stem}.{ext}")


def _normalize_variant_label(label: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._ -]+", " ", str(label or "")).strip()
    cleaned = re.sub(r"\s+", "-", cleaned)
    return cleaned.strip("-_. ")


def _variant_label_for_request(
    dl_type: str,
    quality: str,
    audio_format: str,
    audio_quality: str,
    subtitle_lang: str,
    thumbnail_format: str,
) -> str:
    if dl_type == "video":
        return quality or "video"
    if dl_type == "audio":
        return f"{audio_format.lower()}-{audio_quality}"
    if dl_type == "subtitle":
        return f"{subtitle_lang.lower()}-subtitle"
    if dl_type == "thumbnail":
        return thumbnail_format.lower()
    return dl_type or "download"


def _variant_label_for_output(dl_id: str, extension: str = "") -> str:
    params = (downloads.get(dl_id) or {}).get("params") or {}
    dl_type = str(params.get("dl_type") or "").lower()
    quality = str(params.get("quality") or "")
    audio_format = str(params.get("audio_format") or "mp3")
    audio_quality = str(params.get("audio_quality") or "192")
    subtitle_lang = str(params.get("subtitle_lang") or "en")
    thumbnail_format = str(params.get("thumbnail_format") or "jpg")
    ext = re.sub(r"[^A-Za-z0-9]+", "", str(extension or "").lstrip(".")) or ""

    if dl_type == "subtitle":
        return f"{subtitle_lang.lower()}-{(ext or 'subtitle').lower()}"
    if dl_type == "thumbnail":
        return (ext or thumbnail_format or "jpg").lower()
    return _variant_label_for_request(
        dl_type,
        quality,
        audio_format,
        audio_quality,
        subtitle_lang,
        thumbnail_format,
    )


def _safe_variant_download_path(
    base_dir: str | Path,
    raw_title: str,
    extension: str,
    fallback: str,
    variant_label: str = "",
) -> str:
    stem = _safe_download_stem(raw_title, fallback)
    ext = re.sub(r"[^A-Za-z0-9]+", "", str(extension or "").lstrip(".")) or "bin"
    variant = _normalize_variant_label(variant_label)
    base_name = f"{stem} [{variant}]" if variant else stem
    directory = Path(base_dir)
    directory.mkdir(parents=True, exist_ok=True)
    candidate = directory / f"{base_name}.{ext}"
    suffix = 2
    while candidate.exists():
        candidate = directory / f"{base_name} ({suffix}).{ext}"
        suffix += 1
    return str(candidate)


def _job_workspace(dl_id: str) -> Path:
    return Path(tempfile.gettempdir()) / "grabix-jobs" / dl_id


def _prepare_job_workspace(dl_id: str) -> Path:
    workspace = _job_workspace(dl_id)
    if workspace.exists():
        shutil.rmtree(workspace, ignore_errors=True)
    workspace.mkdir(parents=True, exist_ok=True)
    return workspace


def _cleanup_job_workspace(dl_id: str) -> None:
    workspace = _job_workspace(dl_id)
    if workspace.exists():
        shutil.rmtree(workspace, ignore_errors=True)


def _yt_dlp_output_template(dl_id: str, url: str) -> str:
    fallback = f"grabix-{dl_id}"
    target_title = downloads[dl_id].get("title") or Path(urlparse(url).path).stem or fallback
    safe_stem = _safe_download_stem(target_title, fallback)
    return str(Path(DOWNLOAD_DIR) / f"{safe_stem}.%(ext)s")


def _yt_dlp_output_stem(dl_id: str, url: str) -> str:
    fallback = f"grabix-{dl_id}"
    target_title = downloads[dl_id].get("title") or Path(urlparse(url).path).stem or fallback
    return _safe_download_stem(target_title, fallback)


def _estimate_requested_total_bytes(info: dict | None) -> int:
    if not isinstance(info, dict):
        return 0

    total = 0
    sources = []
    requested_downloads = info.get("requested_downloads")
    if isinstance(requested_downloads, list) and requested_downloads:
        sources.extend(item for item in requested_downloads if isinstance(item, dict))
    requested_formats = info.get("requested_formats")
    if isinstance(requested_formats, list) and requested_formats:
        sources.extend(item for item in requested_formats if isinstance(item, dict))
    if not sources:
        sources.append(info)

    for item in sources:
        for key in ("filesize", "filesize_approx"):
            value = item.get(key)
            if isinstance(value, (int, float)) and value > 0:
                total += int(value)
                break
    return total


def _quality_label_to_height(label: str) -> int:
    match = re.search(r"(\d{3,4})", str(label or ""))
    return int(match.group(1)) if match else 1080


def _pick_format_size(item: dict | None) -> int:
    if not isinstance(item, dict):
        return 0
    for key in ("filesize", "filesize_approx"):
        value = item.get(key)
        if isinstance(value, (int, float)) and value > 0:
            return int(value)
    return 0


def _estimate_total_bytes_for_request(info: dict | None, dl_type: str, quality: str) -> int:
    if not isinstance(info, dict):
        return 0

    precomputed = _estimate_requested_total_bytes(info)
    if precomputed > 0:
        return precomputed

    formats = [entry for entry in (info.get("formats") or []) if isinstance(entry, dict)]
    if not formats:
        return 0

    normalized_type = str(dl_type or "").lower()
    if normalized_type == "audio":
        audio_formats = [entry for entry in formats if entry.get("acodec") != "none"]
        ranked_audio = sorted(audio_formats, key=lambda entry: (_pick_format_size(entry), entry.get("abr") or 0), reverse=True)
        return _pick_format_size(ranked_audio[0]) if ranked_audio else 0

    if normalized_type != "video":
        return 0

    target_height = _quality_label_to_height(quality)
    video_only = [
        entry for entry in formats
        if entry.get("vcodec") != "none" and entry.get("acodec") == "none" and isinstance(entry.get("height"), int)
    ]
    progressive = [
        entry for entry in formats
        if entry.get("vcodec") != "none" and entry.get("acodec") != "none" and isinstance(entry.get("height"), int)
    ]
    audio_only = [entry for entry in formats if entry.get("vcodec") == "none" and entry.get("acodec") != "none"]

    def rank_video(entry: dict) -> tuple[int, int]:
        height = int(entry.get("height") or 0)
        if height <= target_height:
            return (2, height)
        return (1, -height)

    total = 0
    ranked_video_only = sorted(video_only, key=rank_video, reverse=True)
    if ranked_video_only:
        total += _pick_format_size(ranked_video_only[0])
    else:
        ranked_progressive = sorted(progressive, key=rank_video, reverse=True)
        if ranked_progressive:
            return _pick_format_size(ranked_progressive[0])

    ranked_audio_only = sorted(audio_only, key=lambda entry: (_pick_format_size(entry), entry.get("abr") or 0), reverse=True)
    if ranked_audio_only:
        total += _pick_format_size(ranked_audio_only[0])
    return total


def _start_external_downloader_progress_monitor(
    dl_id: str,
    base_dir: str | Path,
    expected_total_bytes: int = 0,
) -> tuple[threading.Event, threading.Thread]:
    stop_event = threading.Event()
    workspace = Path(base_dir)

    def worker():
        last_size = 0
        peak_size = 0
        last_ts = time.monotonic()
        smoothed_speed = 0.0
        while not stop_event.is_set():
            try:
                partial_candidates = [
                    path for path in workspace.rglob("*")
                    if path.is_file() and ".aria2" not in path.name.lower() and (
                        path.name.endswith(".part")
                        or ".part." in path.name
                        or path.suffix in {".ytdl", ".part"}
                    )
                ]
                total_downloaded = 0
                primary_partial = ""
                if partial_candidates:
                    total_downloaded = sum(path.stat().st_size for path in partial_candidates if path.exists())
                    primary_partial = str(max(partial_candidates, key=lambda path: path.stat().st_size))
                    peak_size = max(peak_size, total_downloaded)
                elif peak_size > 0:
                    total_downloaded = peak_size
                current_ts = time.monotonic()
                elapsed = max(current_ts - last_ts, 0.001)
                delta = max(0, total_downloaded - last_size)
                speed_label = downloads[dl_id].get("speed", "")
                eta_label = downloads[dl_id].get("eta", "")
                if delta > 0 and elapsed >= 0.5:
                    instant_speed = delta / elapsed
                    smoothed_speed = instant_speed if smoothed_speed <= 0 else ((smoothed_speed * 0.65) + (instant_speed * 0.35))
                    speed_label = f"{_format_bytes(smoothed_speed)}/s"
                    if expected_total_bytes > 0 and smoothed_speed > 0:
                        remaining = max(expected_total_bytes - total_downloaded, 0)
                        eta_label = _format_eta(remaining / smoothed_speed)
                    last_size = total_downloaded
                    last_ts = current_ts
                elif total_downloaded > 0 and last_size == 0:
                    last_size = total_downloaded
                    last_ts = current_ts

                if total_downloaded > 0:
                    previous_percent = float(downloads[dl_id].get("percent", 0) or 0)
                    trustworthy_total = expected_total_bytes > 0 and total_downloaded <= int(expected_total_bytes * 1.02)
                    pct = round((total_downloaded / expected_total_bytes) * 100, 1) if trustworthy_total else previous_percent
                    downloads[dl_id].update({
                        "percent": max(previous_percent, min(pct, 100.0)) if trustworthy_total else 0,
                        "downloaded": _format_bytes(total_downloaded),
                        "total": _format_bytes(expected_total_bytes) if trustworthy_total else "",
                        "size": _format_bytes(expected_total_bytes if trustworthy_total else total_downloaded),
                        "bytes_downloaded": total_downloaded,
                        "bytes_total": expected_total_bytes if trustworthy_total else 0,
                        "progress_mode": "determinate" if trustworthy_total else "activity",
                        "stage_label": "Downloading",
                        "speed": speed_label,
                        "eta": eta_label,
                        "partial_file_path": primary_partial or downloads[dl_id].get("partial_file_path", ""),
                    })
                    if not trustworthy_total:
                        downloads[dl_id]["eta"] = ""
                    _persist_download_record(dl_id)
            except Exception:
                pass
            stop_event.wait(0.6)

    monitor = threading.Thread(target=worker, daemon=True)
    monitor.start()
    return stop_event, monitor


def _download_direct_media(
    dl_id: str,
    url: str,
    headers: dict[str, str] | None = None,
    output_dir: str | Path | None = None,
) -> str:
    fallback = f"grabix-{dl_id}"
    target_title = downloads[dl_id].get("title") or Path(urlparse(url).path).stem or fallback

    request_headers = {"User-Agent": "Mozilla/5.0"}
    request_headers.update(headers or {})
    initial_request = URLRequest(url, headers=request_headers)
    with urlopen(initial_request, timeout=30) as response:
        content_type = response.headers.get("Content-Type", "video/mp4")
        initial_length = int(response.headers.get("Content-Length", "0") or 0)
        ext = _guess_media_extension(url, content_type)

    output_path = _safe_variant_download_path(
        output_dir or DOWNLOAD_DIR,
        target_title,
        ext,
        fallback,
        variant_label=downloads[dl_id].get("variant_label", ""),
    )
    part_path = f"{output_path}.part"
    downloaded_bytes = Path(part_path).stat().st_size if Path(part_path).exists() else 0
    total_bytes = initial_length if initial_length > 0 else 0
    controls = download_controls[dl_id]
    downloads[dl_id].update({
        "file_path": output_path,
        "partial_file_path": part_path,
        "progress_mode": "determinate" if total_bytes > 0 else "activity",
        "stage_label": "Downloading",
        "bytes_downloaded": downloaded_bytes,
        "bytes_total": total_bytes,
    })
    _persist_download_record(dl_id, force=True)

    while True:
        while controls["pause"].is_set() and not controls["cancel"].is_set():
            time.sleep(0.2)
        if controls["cancel"].is_set():
            raise RuntimeError("Download canceled")

        range_headers = dict(request_headers)
        if downloaded_bytes > 0:
            range_headers["Range"] = f"bytes={downloaded_bytes}-"

        request = URLRequest(url, headers=range_headers)
        with urlopen(request, timeout=30) as response:
            response_status = getattr(response, "status", None) or response.getcode()
            content_range = response.headers.get("Content-Range", "")
            response_length = int(response.headers.get("Content-Length", "0") or 0)
            if downloaded_bytes > 0 and (response_status != 206 or not content_range):
                try:
                    Path(part_path).unlink(missing_ok=True)
                except Exception:
                    pass
                downloaded_bytes = 0
                total_bytes = 0
                downloads[dl_id].update({
                    "percent": 0,
                    "downloaded": "",
                    "total": "",
                    "size": "",
                    "bytes_downloaded": 0,
                    "bytes_total": 0,
                    "progress_mode": "activity",
                    "stage_label": "Downloading",
                    "file_path": output_path,
                    "partial_file_path": part_path,
                })
                _persist_download_record(dl_id)
                continue
            if content_range and "/" in content_range:
                try:
                    total_bytes = int(content_range.rsplit("/", 1)[1] or 0)
                except Exception:
                    total_bytes = max(total_bytes, downloaded_bytes + response_length)
            elif response_length > 0:
                total_bytes = max(total_bytes, downloaded_bytes + response_length)

            with open(part_path, "ab" if downloaded_bytes > 0 else "wb") as file_obj:
                while True:
                    while controls["pause"].is_set() and not controls["cancel"].is_set():
                        time.sleep(0.2)
                    if controls["cancel"].is_set():
                        raise RuntimeError("Download canceled")

                    chunk = response.read(1024 * 256)
                    if not chunk:
                        break
                    file_obj.write(chunk)
                    downloaded_bytes += len(chunk)
                    pct = round((downloaded_bytes / total_bytes) * 100, 1) if total_bytes else 0
                    downloads[dl_id].update({
                        "percent": pct,
                        "downloaded": _format_bytes(downloaded_bytes),
                        "total": _format_bytes(total_bytes),
                        "size": _format_bytes(total_bytes or downloaded_bytes),
                        "bytes_downloaded": downloaded_bytes,
                        "bytes_total": total_bytes,
                        "progress_mode": "determinate" if total_bytes > 0 else "activity",
                        "stage_label": "Downloading",
                        "file_path": output_path,
                        "partial_file_path": part_path,
                    })
                    _persist_download_record(dl_id)

        if not total_bytes or downloaded_bytes >= total_bytes:
            break
        time.sleep(0.2)

    if Path(output_path).exists():
        Path(output_path).unlink()
    Path(part_path).replace(output_path)
    downloads[dl_id].update({
        "percent": 100,
        "downloaded": _format_bytes(total_bytes or downloaded_bytes),
        "total": _format_bytes(total_bytes or downloaded_bytes),
        "size": _format_bytes(total_bytes or downloaded_bytes),
        "bytes_downloaded": total_bytes or downloaded_bytes,
        "bytes_total": total_bytes or downloaded_bytes,
        "progress_mode": "determinate",
        "stage_label": "Finalizing",
        "file_path": output_path,
        "partial_file_path": "",
    })
    _persist_download_record(dl_id, force=True)
    return output_path


def _download_direct_subtitle(
    dl_id: str,
    url: str,
    headers: dict[str, str] | None = None,
    output_dir: str | Path | None = None,
) -> str:
    fallback = f"grabix-{dl_id}"
    target_title = downloads[dl_id].get("title") or Path(urlparse(url).path).stem or fallback

    request_headers = {"User-Agent": "Mozilla/5.0"}
    request_headers.update(headers or {})
    request = URLRequest(url, headers=request_headers)
    with urlopen(request, timeout=30) as response:
        content_type = response.headers.get("Content-Type", "text/vtt")
        total_bytes = int(response.headers.get("Content-Length", "0") or 0)
        ext = _guess_subtitle_extension(url, content_type)
        output_path = _safe_variant_download_path(
            output_dir or DOWNLOAD_DIR,
            target_title,
            ext,
            fallback,
            variant_label=downloads[dl_id].get("variant_label", ""),
        )
        controls = download_controls[dl_id]
        downloaded_bytes = 0
        downloads[dl_id].update({
            "file_path": output_path,
            "partial_file_path": "",
            "progress_mode": "determinate" if total_bytes > 0 else "activity",
            "stage_label": "Downloading",
            "bytes_downloaded": 0,
            "bytes_total": total_bytes,
        })
        _persist_download_record(dl_id, force=True)

        with open(output_path, "wb") as file_obj:
            while True:
                while controls["pause"].is_set() and not controls["cancel"].is_set():
                    time.sleep(0.2)
                if controls["cancel"].is_set():
                    raise RuntimeError("Download canceled")

                chunk = response.read(1024 * 64)
                if not chunk:
                    break
                file_obj.write(chunk)
                downloaded_bytes += len(chunk)
                pct = round((downloaded_bytes / total_bytes) * 100, 1) if total_bytes else 0
                downloads[dl_id].update({
                    "percent": pct,
                    "downloaded": _format_bytes(downloaded_bytes),
                    "total": _format_bytes(total_bytes),
                    "size": _format_bytes(total_bytes or downloaded_bytes),
                    "bytes_downloaded": downloaded_bytes,
                    "bytes_total": total_bytes,
                    "progress_mode": "determinate" if total_bytes > 0 else "activity",
                    "stage_label": "Downloading",
                    "file_path": output_path,
                })
                _persist_download_record(dl_id)

    downloads[dl_id].update({
        "percent": 100,
        "downloaded": _format_bytes(total_bytes or downloaded_bytes),
        "total": _format_bytes(total_bytes or downloaded_bytes),
        "size": _format_bytes(total_bytes or downloaded_bytes),
        "bytes_downloaded": total_bytes or downloaded_bytes,
        "bytes_total": total_bytes or downloaded_bytes,
        "progress_mode": "determinate",
        "stage_label": "Finalizing",
        "file_path": output_path,
    })
    _persist_download_record(dl_id, force=True)
    return output_path


def _download_via_aria2(
    dl_id: str,
    url: str,
    dl_type: str,
    headers: dict[str, str] | None = None,
    output_dir: str | Path | None = None,
) -> str:
    if not has_aria2():
        raise RuntimeError("aria2 is not installed. Switch to the standard downloader or install aria2c.")

    fallback = f"grabix-{dl_id}"
    target_title = downloads[dl_id].get("title") or Path(urlparse(url).path).stem or fallback
    request_headers = {"User-Agent": "Mozilla/5.0"}
    request_headers.update(headers or {})

    probe = URLRequest(url, headers=request_headers, method="HEAD")
    total_bytes = 0
    ext = "bin"
    try:
        with urlopen(probe, timeout=20) as response:
            content_type = response.headers.get("Content-Type", "")
            total_bytes = int(response.headers.get("Content-Length", "0") or 0)
            if dl_type == "subtitle":
                ext = _guess_subtitle_extension(url, content_type)
            else:
                ext = _guess_media_extension(url, content_type)
    except Exception:
        ext = _guess_subtitle_extension(url, "") if dl_type == "subtitle" else _guess_media_extension(url, "")

    output_path = _safe_variant_download_path(
        output_dir or DOWNLOAD_DIR,
        target_title,
        ext,
        fallback,
        variant_label=downloads[dl_id].get("variant_label", ""),
    )
    controls = download_controls[dl_id]
    downloads[dl_id].update({
        "file_path": output_path,
        "partial_file_path": output_path,
        "total": _format_bytes(total_bytes),
        "size": _format_bytes(total_bytes),
        "bytes_downloaded": 0,
        "bytes_total": total_bytes,
        "progress_mode": "determinate" if total_bytes > 0 else "activity",
        "stage_label": "Downloading",
    })
    _persist_download_record(dl_id, force=True)

    command = [
        ARIA2_PATH,
        "--allow-overwrite=true",
        "--auto-file-renaming=false",
        "--continue=true",
        "--max-connection-per-server=8",
        "--split=8",
        "--min-split-size=1M",
        "--summary-interval=0",
        "--console-log-level=warn",
        "--dir",
        str(output_dir or DOWNLOAD_DIR),
        "--out",
        Path(output_path).name,
    ]
    for key, value in request_headers.items():
        command.extend(["--header", f"{key}: {value}"])
    command.append(url)

    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    process = subprocess.Popen(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=creation_flags,
    )
    controls["process"] = process
    controls["process_kind"] = "aria2"
    last_error_lines: list[str] = []
    last_size_sample = 0
    last_sample_ts = time.monotonic()

    try:
        while True:
            while controls["pause"].is_set() and not controls["cancel"].is_set():
                time.sleep(0.2)
            if controls["cancel"].is_set():
                try:
                    process.terminate()
                except Exception:
                    pass
                raise RuntimeError("Download canceled")

            if process.poll() is not None:
                break

            if process.stderr:
                line = process.stderr.readline()
                if line:
                    clean_line = line.strip()
                    if clean_line:
                        last_error_lines.append(clean_line)
                        if len(last_error_lines) > 8:
                            last_error_lines.pop(0)

            current_size = 0
            try:
                current_size = Path(output_path).stat().st_size
            except Exception:
                current_size = 0

            pct = round((current_size / total_bytes) * 100, 1) if total_bytes else 0
            now = time.monotonic()
            elapsed = max(now - last_sample_ts, 0.001)
            delta = max(0, current_size - last_size_sample)
            speed = downloads[dl_id].get("speed", "")
            if delta > 0 and elapsed >= 0.5:
                speed = f"{_format_bytes(delta / elapsed)}/s"
                last_size_sample = current_size
                last_sample_ts = now
            eta = ""
            if total_bytes > 0 and delta > 0 and elapsed > 0:
                bytes_per_second = delta / elapsed
                remaining = max(total_bytes - current_size, 0)
                eta = _format_eta(remaining / bytes_per_second) if bytes_per_second > 0 else ""

            downloads[dl_id].update({
                "percent": pct,
                "downloaded": _format_bytes(current_size),
                "total": _format_bytes(total_bytes),
                "size": _format_bytes(total_bytes or current_size),
                "bytes_downloaded": current_size,
                "bytes_total": total_bytes,
                "progress_mode": "determinate" if total_bytes > 0 else "activity",
                "stage_label": "Downloading",
                "speed": speed,
                "eta": eta,
                "file_path": output_path,
                "partial_file_path": output_path,
            })
            _persist_download_record(dl_id)
            time.sleep(0.25)

        return_code = process.wait()
        if return_code != 0:
            detail = " | ".join(last_error_lines[-3:]) or f"aria2 exited with code {return_code}"
            raise RuntimeError(detail)

        final_size = 0
        try:
            final_size = Path(output_path).stat().st_size if Path(output_path).exists() else 0
        except Exception:
            final_size = 0
        total_label = _format_bytes(total_bytes or final_size)
        downloads[dl_id].update({
            "percent": 100,
            "downloaded": total_label,
            "total": total_label,
            "size": total_label,
            "bytes_downloaded": total_bytes or final_size,
            "bytes_total": total_bytes or final_size,
            "progress_mode": "determinate",
            "stage_label": "Finalizing",
            "file_path": output_path,
            "partial_file_path": "",
            "speed": "",
            "eta": "0s",
        })
        _persist_download_record(dl_id, force=True)
        return output_path
    finally:
        controls["process"] = None
        controls["process_kind"] = ""
        if process.stderr:
            process.stderr.close()


def _trim_downloaded_media(
    dl_id: str,
    input_path: str,
    trim_start: float,
    trim_end: float,
    use_cpu: bool,
) -> str:
    if not has_ffmpeg():
        raise RuntimeError("FFmpeg is required for trimmed video downloads. Install FFmpeg and try again.")

    source = Path(input_path)
    if not source.exists():
        raise RuntimeError("Downloaded source file for trimming was not found.")

    controls = download_controls[dl_id]
    requested_length = max(0.1, float(trim_end) - float(trim_start))
    trimmed_path = str(source.with_name(f"{source.stem}.trimmed{source.suffix or '.mp4'}"))
    partial_path = f"{trimmed_path}.part"

    command = [FFMPEG_PATH, "-y", "-ss", str(max(0.0, float(trim_start))), "-to", str(max(float(trim_start), float(trim_end))), "-i", str(source)]
    if use_cpu:
        command.extend(["-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", "192k"])
    else:
        command.extend(["-c", "copy", "-avoid_negative_ts", "1"])
    command.append(partial_path)

    downloads[dl_id].update({
        "status": "processing",
        "error": "",
        "partial_file_path": partial_path,
        "file_path": trimmed_path,
        "speed": "",
        "eta": "",
        "progress_mode": "processing",
        "stage_label": "Trimming",
    })
    _persist_download_record(dl_id, force=True)

    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    process = subprocess.Popen(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=creation_flags,
    )
    controls["process"] = process
    controls["process_kind"] = "ffmpeg"
    error_tail: list[str] = []

    try:
        while True:
            while controls["pause"].is_set() and not controls["cancel"].is_set():
                time.sleep(0.2)
            if controls["cancel"].is_set():
                try:
                    process.terminate()
                except Exception:
                    pass
                raise RuntimeError("Download canceled")

            line = process.stderr.readline() if process.stderr else ""
            if not line:
                if process.poll() is not None:
                    break
                time.sleep(0.1)
                continue

            clean_line = line.strip()
            if clean_line:
                error_tail.append(clean_line)
                if len(error_tail) > 12:
                    error_tail.pop(0)

            match = re.search(r"time=(\d+:\d+:\d+\.\d+)", line)
            if match:
                processed_seconds = _parse_timecode_to_seconds(match.group(1))
                pct = min(100.0, round((processed_seconds / requested_length) * 100, 1)) if requested_length > 0 else 0
                downloads[dl_id].update({
                    "percent": pct,
                    "downloaded": _format_eta(processed_seconds),
                    "total": _format_eta(requested_length),
                })
                _persist_download_record(dl_id)

        return_code = process.wait()
        if return_code != 0:
            raise RuntimeError(" | ".join(error_tail[-3:]) or f"FFmpeg trim exited with code {return_code}")

        if Path(trimmed_path).exists():
            Path(trimmed_path).unlink()
        Path(partial_path).replace(trimmed_path)
        try:
            source.unlink()
        except Exception:
            pass

        final_size = Path(trimmed_path).stat().st_size if Path(trimmed_path).exists() else 0
        downloads[dl_id].update({
            "status": "done",
            "percent": 100,
            "downloaded": _format_eta(requested_length),
            "total": _format_eta(requested_length),
            "size": _format_bytes(final_size),
            "file_path": trimmed_path,
            "partial_file_path": "",
            "speed": "",
            "eta": "0s",
        })
        _persist_download_record(dl_id, force=True)
        return trimmed_path
    finally:
        controls["process"] = None
        controls["process_kind"] = ""
        if process.stderr:
            process.stderr.close()


def _download_hls_media(
    dl_id: str,
    url: str,
    headers: dict[str, str] | None = None,
    output_dir: str | Path | None = None,
) -> str:
    if not has_ffmpeg():
        raise RuntimeError("FFmpeg is required for HLS downloads.")

    fallback = f"grabix-{dl_id}"
    target_title = downloads[dl_id].get("title") or Path(urlparse(url).path).stem or fallback
    final_path = _safe_variant_download_path(
        output_dir or DOWNLOAD_DIR,
        target_title,
        "mkv",
        fallback,
        variant_label=downloads[dl_id].get("variant_label", ""),
    )
    output_path = f"{final_path}.part.mkv"

    request_headers = {"User-Agent": "Mozilla/5.0"}
    request_headers.update(headers or {})
    controls = download_controls[dl_id]

    command = [FFMPEG_PATH, "-y"]
    if request_headers:
        header_blob = "".join(f"{key}: {value}\r\n" for key, value in request_headers.items())
        command.extend(["-headers", header_blob])
    command.extend([
        "-protocol_whitelist", "file,http,https,tcp,tls,crypto,data",
        "-allowed_extensions", "ALL",
        "-allowed_segment_extensions", "ALL",
        "-extension_picky", "0",
        "-stats_period", "1",
        "-i", url,
        "-c", "copy",
        "-f", "matroska",
        output_path,
    ])

    downloads[dl_id].update({
        "file_path": final_path,
        "partial_file_path": output_path,
        "downloaded": "",
        "total": "",
        "size": "",
        "speed": "",
        "eta": "",
        "progress_mode": "activity",
        "stage_label": "Downloading",
    })
    _persist_download_record(dl_id, force=True)

    last_error = "FFmpeg could not start the HLS download."
    for attempt in range(3):
        process = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        controls["process"] = process
        controls["process_kind"] = "ffmpeg"
        error_tail: list[str] = []
        total_duration_seconds = 0.0
        current_seconds = 0.0
        speed_factor = 0.0
        last_size_sample = 0
        last_sample_ts = time.monotonic()

        try:
            while True:
                if controls["cancel"].is_set():
                    process.terminate()
                    raise RuntimeError("Download canceled")

                line = process.stderr.readline() if process.stderr else ""
                if not line:
                    if process.poll() is not None:
                        break
                    time.sleep(0.1)
                    continue

                clean_line = line.strip()
                if clean_line:
                    error_tail.append(clean_line)
                    if len(error_tail) > 12:
                        error_tail.pop(0)

                duration_match = re.search(r"Duration:\s*(\d+:\d+:\d+\.\d+)", line)
                if duration_match:
                    total_label = duration_match.group(1)
                    total_duration_seconds = _parse_timecode_to_seconds(total_label)
                    downloads[dl_id]["total"] = total_label
                    downloads[dl_id]["partial_file_path"] = output_path

                match = re.search(r"time=(\d+:\d+:\d+\.\d+)", line)
                if match:
                    current_label = match.group(1)
                    current_seconds = _parse_timecode_to_seconds(current_label)
                    downloads[dl_id]["downloaded"] = current_label
                    if total_duration_seconds > 0:
                        downloads[dl_id]["percent"] = round(
                            min(100.0, (current_seconds / total_duration_seconds) * 100),
                            1,
                        )
                        downloads[dl_id]["progress_mode"] = "determinate"
                speed_match = re.search(r"speed=\s*([0-9.]+)x", line)
                if speed_match:
                    try:
                        speed_factor = float(speed_match.group(1))
                    except Exception:
                        speed_factor = 0.0
                try:
                    current_size = Path(output_path).stat().st_size
                except Exception:
                    current_size = 0
                if current_size > 0:
                    downloads[dl_id]["size"] = _format_bytes(current_size)
                    if not downloads[dl_id].get("downloaded"):
                        downloads[dl_id]["downloaded"] = _format_bytes(current_size)
                    downloads[dl_id]["bytes_downloaded"] = current_size
                    now = time.monotonic()
                    elapsed = max(now - last_sample_ts, 0.001)
                    delta = max(0, current_size - last_size_sample)
                    if delta > 0 and elapsed >= 0.5:
                        downloads[dl_id]["speed"] = f"{_format_bytes(delta / elapsed)}/s"
                        last_size_sample = current_size
                        last_sample_ts = now
                if total_duration_seconds > 0 and current_seconds > 0:
                    remaining_seconds = max(total_duration_seconds - current_seconds, 0.0)
                    if speed_factor > 0:
                        downloads[dl_id]["eta"] = _format_eta(remaining_seconds / speed_factor)
                downloads[dl_id]["stage_label"] = "Downloading"
                _persist_download_record(dl_id)
        finally:
            controls["process"] = None
            controls["process_kind"] = ""
            if process.stderr:
                process.stderr.close()

        return_code = process.wait()
        if return_code == 0:
            if Path(final_path).exists():
                Path(final_path).unlink()
            Path(output_path).replace(final_path)
            downloads[dl_id].update({
                "percent": 100,
                "file_path": final_path,
                "partial_file_path": "",
                "progress_mode": "processing",
                "stage_label": "Finalizing",
            })
            _persist_download_record(dl_id, force=True)
            return final_path

        last_error = " | ".join(error_tail[-3:]) or f"FFmpeg exited with code {return_code}"
        if attempt < 2:
            time.sleep(2 ** (attempt + 1))

    raise RuntimeError(last_error)


# ── Download record helpers ───────────────────────────────────────────────────
def _download_strategy_for(params: dict | None) -> str:
    payload = params or {}
    engine = _sanitize_download_engine(payload.get("download_engine"))
    dl_type = str(payload.get("dl_type") or "").lower()
    url = str(payload.get("url") or "")
    if engine == "aria2":
        if dl_type == "video" and _is_direct_media_url(url):
            return "aria2_direct_media"
        if dl_type in {"video", "audio"}:
            return "aria2_yt_dlp"
        if dl_type in {"subtitle", "thumbnail"}:
            return "standard_small_asset"
        return "aria2_fallback_standard"
    if dl_type == "subtitle" and _is_direct_subtitle_url(url):
        return "direct_subtitle"
    if dl_type == "video" and (payload.get("force_hls") or ".m3u8" in url.lower()):
        return "hls"
    if dl_type == "video" and _is_direct_media_url(url):
        return "direct_media"
    if dl_type in {"video", "audio", "thumbnail", "subtitle"}:
        return "yt_dlp"
    return dl_type or "unknown"


def _requested_download_engine(payload: dict | None) -> str:
    return _sanitize_download_engine((payload or {}).get("download_engine"))


def _effective_download_engine(payload: dict | None) -> str:
    requested = _requested_download_engine(payload)
    if requested != "aria2":
        return "standard"

    params = payload or {}
    url = str(params.get("url") or "")
    dl_type = str(params.get("dl_type") or "").lower()
    trim_enabled = bool(params.get("trim_enabled"))
    force_hls = bool(params.get("force_hls")) or ".m3u8" in url.lower()

    if not has_aria2():
        return "standard"
    if force_hls or trim_enabled:
        return "standard"
    if dl_type in {"subtitle", "thumbnail"}:
        return "standard"
    if dl_type == "video" and _is_direct_media_url(url):
        return "aria2"
    if dl_type in {"video", "audio"}:
        return "aria2"
    return "standard"


def _download_engine_note(payload: dict | None) -> str:
    requested = _requested_download_engine(payload)
    effective = _effective_download_engine(payload)
    if requested != "aria2":
        return ""
    if effective == "aria2":
        return ""
    if not has_aria2():
        return "aria2 is not installed, so GRABIX used the standard downloader."
    params = payload or {}
    url = str(params.get("url") or "")
    trim_enabled = bool(params.get("trim_enabled"))
    force_hls = bool(params.get("force_hls")) or ".m3u8" in url.lower()
    if trim_enabled:
        return "aria2 is disabled when trim is on, so GRABIX used the standard downloader here."
    if force_hls:
        return "aria2 is disabled for HLS stream downloads, so GRABIX used the standard downloader here."
    if str(params.get("dl_type") or "").lower() in {"subtitle", "thumbnail"}:
        return "Small files always use the standard downloader, even when aria2 is selected."
    return "aria2 could not be used for this download, so GRABIX used the standard downloader here."


def _persist_download_record(dl_id: str, force: bool = False):
    item = downloads.get(dl_id)
    if not item:
        return

    now = time.monotonic()
    last_persist_at = float(item.get("_last_persist_at", 0) or 0)
    if not force and now - last_persist_at < 1.5:
        return
    item["_last_persist_at"] = now

    params = dict(item.get("params") or {})
    row = {
        "id": dl_id,
        "url": params.get("url", ""),
        "title": item.get("title", ""),
        "thumbnail": item.get("thumbnail", ""),
        "dl_type": params.get("dl_type", ""),
        "status": item.get("status", "queued"),
        "created_at": item.get("created_at", datetime.now().isoformat()),
        "updated_at": datetime.now().isoformat(),
        "file_path": item.get("file_path", ""),
        "partial_file_path": item.get("partial_file_path", ""),
        "error": item.get("error", ""),
        "percent": item.get("percent", 0),
        "speed": item.get("speed", ""),
        "eta": item.get("eta", ""),
        "downloaded": item.get("downloaded", ""),
        "total": item.get("total", ""),
        "size": item.get("size", ""),
        "can_pause": item.get("can_pause", False),
        "retry_count": item.get("retry_count", 0),
        "failure_code": item.get("failure_code", ""),
        "recoverable": item.get("recoverable", False),
        "download_strategy": item.get("download_strategy") or _download_strategy_for(params),
        "download_engine": item.get("download_engine") or _effective_download_engine(params),
        "download_engine_requested": item.get("download_engine_requested") or _requested_download_engine(params),
        "engine_note": item.get("engine_note", ""),
        "params_json": json.dumps(params),
    }
    db_upsert_download_job(row)


def _create_download_controls() -> dict:
    return {
        "pause": threading.Event(),
        "cancel": threading.Event(),
        "thread": None,
        "process": None,
        "process_kind": "",
    }


def _create_download_record(dl_id: str, title: str = "", params: dict | None = None) -> dict:
    pause_supported = bool((params or {}).get("can_pause", False))
    estimated_total_bytes = int((params or {}).get("estimated_total_bytes") or 0)
    downloads[dl_id] = {
        "id": dl_id,
        "status": "queued",
        "percent": 0,
        "speed": "",
        "eta": "",
        "downloaded": "",
        "total": "",
        "size": "",
        "title": title,
        "thumbnail": (params or {}).get("thumbnail", ""),
        "error": "",
        "file_path": "",
        "partial_file_path": "",
        "folder": DOWNLOAD_DIR,
        "created_at": datetime.now().isoformat(),
        "params": params or {},
        "can_pause": pause_supported,
        "retry_count": 0,
        "failure_code": "",
        "recoverable": False,
        "download_strategy": _download_strategy_for(params),
        "download_engine": _effective_download_engine(params),
        "download_engine_requested": _requested_download_engine(params),
        "engine_note": _download_engine_note(params),
        "downloaded": "",
        "total": _format_bytes(estimated_total_bytes),
        "size": _format_bytes(estimated_total_bytes),
        "bytes_downloaded": 0,
        "bytes_total": estimated_total_bytes,
        "progress_mode": "activity" if estimated_total_bytes <= 0 else "determinate",
        "stage_label": "Queued",
        "variant_label": str((params or {}).get("variant_label") or ""),
    }
    download_controls[dl_id] = _create_download_controls()
    _persist_download_record(dl_id, force=True)
    return downloads[dl_id]


def _public_download(d: dict) -> dict:
    return {
        "id": d.get("id"),
        "url": (d.get("params") or {}).get("url", ""),
        "status": d.get("status"),
        "percent": d.get("percent", 0),
        "speed": d.get("speed", ""),
        "eta": d.get("eta", ""),
        "downloaded": d.get("downloaded", ""),
        "total": d.get("total", ""),
        "size": d.get("size", ""),
        "title": d.get("title", ""),
        "thumbnail": d.get("thumbnail", ""),
        "error": d.get("error", ""),
        "file_path": d.get("file_path", ""),
        "partial_file_path": d.get("partial_file_path", ""),
        "folder": d.get("folder", DOWNLOAD_DIR),
        "created_at": d.get("created_at", ""),
        "dl_type": (d.get("params") or {}).get("dl_type", ""),
        "can_pause": d.get("can_pause", False),
        "retry_count": d.get("retry_count", 0),
        "failure_code": d.get("failure_code", ""),
        "recoverable": d.get("recoverable", False),
        "download_strategy": d.get("download_strategy", ""),
        "download_engine": d.get("download_engine", "standard"),
        "download_engine_requested": d.get("download_engine_requested", "standard"),
        "engine_note": d.get("engine_note", ""),
        "bytes_downloaded": d.get("bytes_downloaded", 0),
        "bytes_total": d.get("bytes_total", 0),
        "progress_mode": d.get("progress_mode", "activity"),
        "stage_label": d.get("stage_label", ""),
        "variant_label": d.get("variant_label", (d.get("params") or {}).get("variant_label", "")),
    }


def _start_download_thread(dl_id: str):
    params = downloads[dl_id]["params"]
    worker = threading.Thread(
        target=_download_task,
        args=(
            dl_id,
            params["url"],
            params["dl_type"],
            params["quality"],
            params["audio_format"],
            params["audio_quality"],
            params["subtitle_lang"],
            params["thumbnail_format"],
            params["trim_start"],
            params["trim_end"],
            params["trim_enabled"],
            params.get("use_cpu", True),
            params.get("headers_json", ""),
            params.get("force_hls", False),
        ),
        daemon=True,
    )
    download_controls[dl_id]["thread"] = worker
    downloads[dl_id]["status"] = "queued"
    downloads[dl_id]["recoverable"] = False
    downloads[dl_id]["failure_code"] = ""
    _persist_download_record(dl_id, force=True)
    worker.start()


# FIX 3: Changed from POST to GET — frontend calls this as a plain fetch() GET
def start_download(
    url: str,
    title: str = "",
    thumbnail: str = "",
    dl_type: str = "video",
    quality: str = "best",
    audio_format: str = "mp3",
    audio_quality: str = "192",
    subtitle_lang: str = "en",
    thumbnail_format: str = "jpg",
    trim_start: float = 0,
    trim_end: float = 0,
    trim_enabled: bool = False,
    use_cpu: bool = True,
    headers_json: str = "",
    force_hls: bool = False,
    category: str = "",
    tags_csv: str = "",
    download_engine: str = "",
):
    safe_url, headers_json = _normalize_download_target(url, headers_json)
    resolved_category = _infer_download_category(safe_url, title, dl_type, category)
    resolved_tags = _normalize_tags_csv(tags_csv, resolved_category, dl_type)
    resolved_engine = _sanitize_download_engine(download_engine or load_settings().get("default_download_engine"))
    dl_id = str(uuid.uuid4())
    params = {
        "url": safe_url,
        "title": title,
        "thumbnail": thumbnail,
        "dl_type": dl_type,
        "quality": quality,
        "audio_format": audio_format,
        "audio_quality": audio_quality,
        "subtitle_lang": subtitle_lang,
        "thumbnail_format": thumbnail_format,
        "trim_start": trim_start,
        "trim_end": trim_end,
        "trim_enabled": trim_enabled,
        "use_cpu": use_cpu,
        "headers_json": headers_json,
        "force_hls": force_hls,
        "download_engine": resolved_engine,
        "category": resolved_category,
        "tags_csv": resolved_tags,
        "estimated_total_bytes": 0,
        "variant_label": _variant_label_for_request(
            dl_type,
            quality,
            audio_format,
            audio_quality,
            subtitle_lang,
            thumbnail_format,
        ),
    }
    effective_engine = _effective_download_engine(params)
    pause_supported = dl_type in {"video", "audio", "subtitle", "thumbnail"}
    params["can_pause"] = pause_supported
    _create_download_record(dl_id, title=title, params=params)

    # Quick metadata fetch for history DB — non-blocking, errors are swallowed
    fallback_title = title.strip() or Path(urlparse(safe_url).path).stem or f"grabix-{dl_id}"
    try:
        if dl_type == "video" and (force_hls or ".m3u8" in safe_url.lower() or _is_direct_media_url(safe_url) or title.strip()):
            meta = {
                "id": dl_id, "url": safe_url,
                "title": fallback_title,
                "thumbnail": thumbnail,
                "channel": "",
                "duration": 0,
                "dl_type": dl_type, "file_path": "",
                "status": "queued",
                "created_at": datetime.now().isoformat(),
                "category": resolved_category,
                "tags": resolved_tags,
            }
            downloads[dl_id]["title"] = meta["title"]
            downloads[dl_id]["thumbnail"] = meta["thumbnail"]
            db_insert(meta)
        elif dl_type == "subtitle" and (_is_direct_subtitle_url(safe_url) or title.strip()):
            meta = {
                "id": dl_id, "url": safe_url,
                "title": fallback_title,
                "thumbnail": thumbnail,
                "channel": "",
                "duration": 0,
                "dl_type": dl_type, "file_path": "",
                "status": "queued",
                "created_at": datetime.now().isoformat(),
                "category": resolved_category,
                "tags": resolved_tags,
            }
            downloads[dl_id]["title"] = meta["title"]
            downloads[dl_id]["thumbnail"] = meta["thumbnail"]
            db_insert(meta)
        else:
            with yt_dlp.YoutubeDL({"quiet": True, "skip_download": True, "noplaylist": True}) as ydl:
                info = ydl.extract_info(safe_url, download=False)
                meta = {
                    "id": dl_id, "url": safe_url,
                    "title": info.get("title", fallback_title),
                    "thumbnail": info.get("thumbnail", ""),
                    "channel": info.get("channel") or info.get("uploader", ""),
                    "duration": info.get("duration", 0),
                    "dl_type": dl_type, "file_path": "",
                    "status": "queued",
                    "created_at": datetime.now().isoformat(),
                    "category": resolved_category,
                    "tags": resolved_tags,
                }
                downloads[dl_id]["title"] = meta["title"]
                downloads[dl_id]["thumbnail"] = thumbnail or meta["thumbnail"]
                params["estimated_total_bytes"] = _estimate_total_bytes_for_request(info, dl_type, quality)
                db_insert(meta)
    except Exception as e:
        downloads[dl_id]["title"] = fallback_title
        downloads[dl_id]["thumbnail"] = thumbnail
        db_insert({
            "id": dl_id,
            "url": safe_url,
            "title": fallback_title,
            "thumbnail": thumbnail,
            "channel": "",
            "duration": 0,
            "dl_type": dl_type,
            "file_path": "",
            "status": "queued",
            "created_at": datetime.now().isoformat(),
            "category": resolved_category,
            "tags": resolved_tags,
        })
        log_event(
            downloads_logger,
            logging.WARNING,
            event="download_metadata_fetch_failed",
            message="Download metadata fetch failed; using fallback metadata.",
            details={"error": str(e), "download_id": dl_id, "url": safe_url[:180]},
        )

    _persist_download_record(dl_id, force=True)
    log_event(
        downloads_logger,
        logging.INFO,
        event="download_queued",
        message="Download queued.",
        details={"download_id": dl_id, "download_type": dl_type, "title": downloads[dl_id].get("title", ""), "strategy": downloads[dl_id].get("download_strategy", "")},
    )
    _start_download_thread(dl_id)
    # Return both "task_id" and "id" so any frontend variant works
    return {
        "task_id": dl_id,
        "id": dl_id,
        "folder": DOWNLOAD_DIR,
        "download_engine": downloads[dl_id].get("download_engine", effective_engine),
        "download_engine_requested": downloads[dl_id].get("download_engine_requested", resolved_engine),
        "engine_note": downloads[dl_id].get("engine_note", ""),
    }


# FIX 1: This is the correct endpoint name the frontend polls
def download_status(dl_id: str):
    item = runtime_state.snapshot_download(dl_id)
    return _public_download(item) if item else {"status": "not_found"}


# Keep /progress/{dl_id} as an alias so nothing breaks
def progress_alias(dl_id: str):
    return download_status(dl_id)


def list_downloads():
    ordered = sorted(runtime_state.snapshot_downloads(), key=lambda item: item.get("created_at", ""), reverse=True)
    return [_public_download(item) for item in ordered]


def recover_download_jobs():
    rows = db_list_download_jobs()
    active_statuses = {"queued", "downloading", "processing", "canceling"}

    for row in rows:
        try:
            params = json.loads(row["params_json"] or "{}")
            if not isinstance(params, dict):
                params = {}
        except Exception:
            params = {}

        dl_id = row["id"]
        if dl_id in downloads:
            continue

        status = str(row["status"] or "queued")
        can_pause = bool(row["can_pause"])
        recoverable = bool(row["recoverable"])
        error_message = str(row["error"] or "")
        failure_code = str(row["failure_code"] or "")

        if status in active_statuses:
            recoverable = True
            if can_pause:
                status = "paused"
                error_message = "Download was interrupted when GRABIX closed. Resume to continue."
                failure_code = "restart_interrupted"
            else:
                status = "failed"
                error_message = "Download was interrupted when GRABIX closed. Retry to continue."
                failure_code = "restart_interrupted"

        downloads[dl_id] = {
            "id": dl_id,
            "status": status,
            "percent": float(row["percent"] or 0),
            "speed": row["speed"] or "",
            "eta": row["eta"] or "",
            "downloaded": row["downloaded"] or "",
            "total": row["total"] or "",
            "size": row["size"] or "",
            "title": row["title"] or "",
            "thumbnail": row["thumbnail"] or "",
            "error": error_message,
            "file_path": row["file_path"] or "",
            "partial_file_path": row["partial_file_path"] or "",
            "folder": DOWNLOAD_DIR,
            "created_at": row["created_at"] or datetime.now().isoformat(),
            "params": params,
            "can_pause": can_pause,
            "retry_count": int(row["retry_count"] or 0),
            "failure_code": failure_code,
            "recoverable": recoverable,
            "download_strategy": row["download_strategy"] or _download_strategy_for(params),
            "download_engine": _effective_download_engine(params),
            "download_engine_requested": _requested_download_engine(params),
            "engine_note": _download_engine_note(params),
        }
        download_controls[dl_id] = _create_download_controls()
        _persist_download_record(dl_id, force=True)


# FIX 2 + FIX 3 (Library): Proper error handling so "no such table" never reaches the UI
@app.get("/history")
def get_history():
    try:
        # Re-run init in case the DB file was deleted after startup
        init_db()
        con = get_db_connection()
        rows = con.execute("SELECT * FROM history ORDER BY created_at DESC LIMIT 100").fetchall()
        con.close()
        return [dict(row) for row in rows]
    except Exception as e:
        log_event(backend_logger, logging.ERROR, event="history_fetch_failed", message="History fetch failed.", details={"error": str(e)})
        return []


def open_download_folder(path: str = ""):
    # If the specific file doesn't exist, fall back to the DOWNLOAD_DIR folder
    target = ensure_safe_managed_path(path, DOWNLOAD_DIR) if path else Path(DOWNLOAD_DIR).resolve()
    if not target.exists():
        target = Path(DOWNLOAD_DIR)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Download folder not found")

    try:
        if os.name == "nt":
            creation_flags = 0
            for flag_name in ("DETACHED_PROCESS", "CREATE_NEW_PROCESS_GROUP"):
                creation_flags |= getattr(subprocess, flag_name, 0)
            if target.is_file():
                # Highlight the specific file in Explorer
                subprocess.Popen(["explorer", "/select,", str(target)], creationflags=creation_flags)
            else:
                # Open the folder
                subprocess.Popen(["explorer", str(target)], creationflags=creation_flags)
        else:
            raise HTTPException(status_code=501, detail="Open folder is currently implemented for Windows only")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"opened": str(target)}


def open_local_file(path: str):
    target = ensure_safe_managed_path(path, DOWNLOAD_DIR)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Local file not found")

    try:
        if os.name == "nt":
            os.startfile(str(target))
        else:
            raise HTTPException(status_code=501, detail="Open file is currently implemented for Windows only")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"opened": str(target)}


def download_action(dl_id: str, action: str):
    if dl_id not in downloads:
        raise HTTPException(status_code=404, detail="Download not found")

    item = downloads[dl_id]
    controls = download_controls.get(dl_id)
    if controls is None:
        raise HTTPException(status_code=404, detail="Download controls not found")

    if action == "pause":
        if not item.get("can_pause"):
            raise HTTPException(status_code=400, detail="Pause is not supported for this download type")
        controls["pause"].set()
        process = controls.get("process")
        if process is not None and process.poll() is None:
            _set_ffmpeg_process_state(process.pid, suspend=True)
        if item["status"] in {"downloading", "processing"}:
            item["paused_from"] = item["status"]
            item["status"] = "paused"
            item["recoverable"] = True
            item["failure_code"] = "paused"
            db_update_status(dl_id, "paused", item.get("file_path", ""))
            _persist_download_record(dl_id, force=True)
            log_event(downloads_logger, logging.INFO, event="download_paused", message="Download paused.", details={"download_id": dl_id})
    elif action == "resume":
        if not item.get("can_pause"):
            raise HTTPException(status_code=400, detail="Resume is not supported for this download type")
        controls["pause"].clear()
        process = controls.get("process")
        if process is not None and process.poll() is None:
            _set_ffmpeg_process_state(process.pid, suspend=False)
        worker = controls.get("thread")
        if (worker is None or not worker.is_alive()) and item["status"] == "paused":
            item.update({
                "status": "queued",
                "error": "",
                "recoverable": False,
                "failure_code": "",
            })
            db_update_status(dl_id, "queued", item.get("file_path", ""))
            _persist_download_record(dl_id, force=True)
            log_event(downloads_logger, logging.INFO, event="download_resumed", message="Download resumed from paused state.", details={"download_id": dl_id})
            _start_download_thread(dl_id)
        elif item["status"] == "paused":
            resumed_status = str(item.pop("paused_from", "downloading") or "downloading")
            item["status"] = resumed_status
            item["recoverable"] = False
            item["failure_code"] = ""
            db_update_status(dl_id, resumed_status, item.get("file_path", ""))
            _persist_download_record(dl_id, force=True)
            log_event(downloads_logger, logging.INFO, event="download_resumed", message="Download process resumed.", details={"download_id": dl_id})
    elif action == "cancel":
        controls["cancel"].set()
        process = controls.get("process")
        if process is not None and process.poll() is None:
            try:
                process.terminate()
            except Exception:
                pass
        item["status"] = "canceling"
        item["failure_code"] = "cancel_requested"
        _persist_download_record(dl_id, force=True)
        log_event(downloads_logger, logging.WARNING, event="download_cancel_requested", message="Download cancel requested.", details={"download_id": dl_id})
    elif action == "retry":
        if item["status"] not in {"failed", "canceled"}:
            raise HTTPException(status_code=400, detail="Only failed or canceled downloads can be retried")
        _delete_download_files(item)
        controls["pause"].clear()
        controls["cancel"].clear()
        item.update({
            "status": "queued", "percent": 0, "speed": "", "eta": "",
            "downloaded": "", "total": "", "size": "", "error": "", "file_path": "",
            "partial_file_path": "", "recoverable": False, "failure_code": "",
            "retry_count": int(item.get("retry_count", 0) or 0) + 1,
        })
        db_update_status(dl_id, "queued")
        _persist_download_record(dl_id, force=True)
        log_event(downloads_logger, logging.INFO, event="download_retried", message="Download retried.", details={"download_id": dl_id, "retry_count": item.get("retry_count", 0)})
        _start_download_thread(dl_id)
    else:
        raise HTTPException(status_code=400, detail="Unsupported action")

    return _public_download(item)


def delete_download(dl_id: str):
    item = downloads.get(dl_id)
    controls = download_controls.get(dl_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Download not found")

    if controls:
        controls["cancel"].set()
        controls["pause"].clear()
        process = controls.get("process")
        if process is not None and process.poll() is None:
            try:
                process.terminate()
                process.wait(timeout=3)
            except Exception:
                try:
                    process.kill()
                except Exception:
                    pass

    _delete_download_files(item)
    db_update_status(dl_id, "canceled", item.get("file_path", ""))
    downloads.pop(dl_id, None)
    download_controls.pop(dl_id, None)
    db_delete_download_job(dl_id)
    log_event(downloads_logger, logging.INFO, event="download_deleted", message="Download entry deleted.", details={"download_id": dl_id})
    return {"deleted": True}


def stop_all_downloads():
    for dl_id, item in downloads.items():
        if item["status"] in {"queued", "downloading", "paused", "canceling"}:
            controls = download_controls.get(dl_id)
            if controls:
                controls["cancel"].set()
                process = controls.get("process")
                if process is not None and process.poll() is None:
                    try:
                        process.terminate()
                    except Exception:
                        pass
            item["status"] = "canceling"
            item["failure_code"] = "cancel_requested"
            _persist_download_record(dl_id, force=True)
    return {"status": "stopping"}


# ── Settings routes ───────────────────────────────────────────────────────────
def get_settings():
    return _settings_public_payload(load_settings())


def update_settings(data: dict):
    sanitized = dict(data or {})
    sanitized.pop("adult_password_hash", None)
    sanitized["adult_content_enabled"] = False
    sanitized.pop("adult_password_configured", None)
    save_settings_to_disk(sanitized)
    return _settings_public_payload(load_settings())


@app.get("/download-engines")
def get_download_engines():
    return {
        "default": _sanitize_download_engine(load_settings().get("default_download_engine")),
        "engines": [
            {
                "id": "standard",
                "label": "Standard (stable)",
                "available": True,
                "description": "Best compatibility through the current GRABIX downloader stack.",
            },
            {
                "id": "aria2",
                "label": "aria2 (fast)",
                "available": has_aria2(),
                "description": "Faster multi-connection direct-file downloads. Falls back to Standard when a download type is unsupported.",
                "binary_path": ARIA2_PATH or "",
            },
        ],
    }


def _winget_available() -> bool:
    return shutil.which("winget") is not None


def _dependency_catalog() -> dict[str, dict[str, str]]:
    return {
        "ffmpeg": {
            "label": "FFmpeg",
            "winget_id": "Gyan.FFmpeg",
            "description": "Required for trimming, converting, and some HLS workflows.",
        },
        "aria2": {
            "label": "aria2",
            "winget_id": "aria2.aria2",
            "description": "Optional fast multi-connection downloader for supported direct files.",
            "fallback_installer": "portable-zip",
        },
    }


def _download_file(url: str, destination: Path) -> None:
    request = URLRequest(url, headers={"User-Agent": "GRABIX/1.0"})
    with urlopen(request, timeout=60) as response, open(destination, "wb") as handle:
        shutil.copyfileobj(response, handle)


def _github_latest_release_asset(repo: str, asset_matcher) -> tuple[str, str]:
    api_url = f"https://api.github.com/repos/{repo}/releases/latest"
    request = URLRequest(api_url, headers={"User-Agent": "GRABIX/1.0", "Accept": "application/vnd.github+json"})
    with urlopen(request, timeout=60) as response:
        payload = json.loads(response.read().decode("utf-8"))

    for asset in payload.get("assets") or []:
        name = str(asset.get("name") or "")
        if asset_matcher(name):
            return str(asset.get("browser_download_url") or ""), name
    raise RuntimeError(f"No matching asset was found in the latest {repo} release.")


def _github_latest_release_checksum_asset(repo: str) -> tuple[str, str] | None:
    api_url = f"https://api.github.com/repos/{repo}/releases/latest"
    request = URLRequest(api_url, headers={"User-Agent": "GRABIX/1.0", "Accept": "application/vnd.github+json"})
    with urlopen(request, timeout=60) as response:
        payload = json.loads(response.read().decode("utf-8"))

    for asset in payload.get("assets") or []:
        name = str(asset.get("name") or "").lower()
        if "sha256" in name and (name.endswith(".txt") or name.endswith(".sha256") or name.endswith(".sha256sum")):
            return str(asset.get("browser_download_url") or ""), str(asset.get("name") or "")
    return None


def _install_aria2_portable(job: dict) -> str:
    runtime_dir = RUNTIME_TOOLS_DIR / "aria2"
    runtime_dir.mkdir(parents=True, exist_ok=True)

    job.update({"status": "downloading", "message": "Downloading aria2 portable package..."})
    archive_url, archive_name = _github_latest_release_asset(
        "aria2/aria2",
        lambda name: name.lower().endswith(".zip") and "win-64bit" in name.lower(),
    )

    with tempfile.TemporaryDirectory(prefix="grabix-aria2-") as temp_dir_raw:
        temp_dir = Path(temp_dir_raw)
        archive_path = temp_dir / (archive_name or "aria2.zip")
        _download_file(archive_url, archive_path)
        local_sha256 = sha256_file(archive_path)

        checksum_asset = _github_latest_release_checksum_asset("aria2/aria2")
        if checksum_asset:
            checksum_url, checksum_name = checksum_asset
            checksum_path = temp_dir / (checksum_name or "checksums.txt")
            _download_file(checksum_url, checksum_path)
            checksum_manifest = parse_checksum_manifest(checksum_path.read_text(encoding="utf-8", errors="ignore"))
            expected = checksum_manifest.get(Path(archive_name).name)
            if expected and expected.lower() != local_sha256.lower():
                raise RuntimeError("aria2 archive checksum verification failed.")

        extract_dir = temp_dir / "extract"
        extract_dir.mkdir(parents=True, exist_ok=True)
        job.update({"status": "installing", "message": "Extracting aria2 portable package..."})
        safe_extract_zip(archive_path, extract_dir)

        binary = next((path for path in extract_dir.rglob("aria2c.exe") if path.is_file()), None)
        if binary is None:
            raise RuntimeError("aria2 portable package did not contain aria2c.exe.")

        staged_runtime_dir = temp_dir / "runtime-dir-next"
        staged_runtime_dir.mkdir(parents=True, exist_ok=True)

        source_root = binary.parent
        for item in source_root.iterdir():
            target = staged_runtime_dir / item.name
            if item.is_dir():
                shutil.copytree(item, target, dirs_exist_ok=True)
            else:
                shutil.copy2(item, target)

        final_runtime_dir = runtime_dir
        backup_runtime_dir = final_runtime_dir.with_name(f"{final_runtime_dir.name}.bak")
        if backup_runtime_dir.exists():
            shutil.rmtree(backup_runtime_dir, ignore_errors=True)
        if final_runtime_dir.exists():
            final_runtime_dir.replace(backup_runtime_dir)
        staged_runtime_dir.replace(final_runtime_dir)
        if backup_runtime_dir.exists():
            shutil.rmtree(backup_runtime_dir, ignore_errors=True)

    return f"Portable aria2 installed to {runtime_dir}"


def _dependency_status_payload() -> dict[str, dict]:
    refresh_runtime_tools()
    return {
        "ffmpeg": {
            "id": "ffmpeg",
            "label": "FFmpeg",
            "available": has_ffmpeg(),
            "path": FFMPEG_PATH or "",
            "description": "Required for trimming, converting, and some HLS workflows.",
            "install_supported": _winget_available(),
            "job": runtime_state.snapshot_dependency_job("ffmpeg"),
        },
        "aria2": {
            "id": "aria2",
            "label": "aria2",
            "available": has_aria2(),
            "path": ARIA2_PATH or "",
            "description": "Optional fast multi-connection downloader for supported direct files.",
            "install_supported": True,
            "job": runtime_state.snapshot_dependency_job("aria2"),
        },
    }


def get_runtime_dependencies():
    return {
        "winget_available": _winget_available(),
        "dependencies": _dependency_status_payload(),
    }


def _install_dependency_worker(dep_id: str):
    catalog = _dependency_catalog().get(dep_id)
    job = dependency_install_jobs.setdefault(dep_id, {})
    if not catalog:
        job.update({"status": "failed", "message": "Unknown dependency."})
        return
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    install_logs: list[str] = []
    job.update({"status": "installing", "message": f"Installing {catalog['label']}...", "started_at": datetime.now().isoformat()})

    try:
        process = None
        if _winget_available():
            command = [
                "winget", "install", "-e", "--id", catalog["winget_id"],
                "--accept-package-agreements", "--accept-source-agreements",
                "--disable-interactivity",
            ]
            process = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=creation_flags,
                timeout=1800,
            )
            winget_output = "\n".join(
                [part for part in [process.stdout.strip(), process.stderr.strip()] if part]
            ).strip()
            if winget_output:
                install_logs.append(winget_output[-4000:])
            refresh_runtime_tools()
            available = has_ffmpeg() if dep_id == "ffmpeg" else has_aria2()
            if process.returncode == 0 and available:
                job.update({
                    "status": "done",
                    "message": f"{catalog['label']} is installed.",
                    "completed_at": datetime.now().isoformat(),
                    "output": "\n\n".join(install_logs)[-4000:],
                })
                return

            if dep_id == "aria2":
                failed_output = (winget_output or "").lower()
                if "failed to extract" in failed_output or "archive" in failed_output or not available:
                    fallback_message = _install_aria2_portable(job)
                    install_logs.append(fallback_message)
                    refresh_runtime_tools()
                    if has_aria2():
                        job.update({
                            "status": "done",
                            "message": "aria2 is installed and ready.",
                            "completed_at": datetime.now().isoformat(),
                            "output": "\n\n".join(install_logs)[-4000:],
                        })
                        return
        elif dep_id == "aria2":
            install_logs.append("winget is unavailable, using bundled portable install flow.")
            fallback_message = _install_aria2_portable(job)
            install_logs.append(fallback_message)
            refresh_runtime_tools()
            if has_aria2():
                job.update({
                    "status": "done",
                    "message": "aria2 is installed and ready.",
                    "completed_at": datetime.now().isoformat(),
                    "output": "\n\n".join(install_logs)[-4000:],
                })
                return

        if not _winget_available():
            raise RuntimeError("winget is not available on this PC.")

        raise RuntimeError("\n\n".join(install_logs).strip() or f"{catalog['label']} installation failed.")
    except Exception as exc:
        output = "\n\n".join([part for part in install_logs if part]).strip()
        message = str(exc).strip() or f"{catalog['label']} installation failed."
        job.update({
            "status": "failed",
            "message": message[-4000:],
            "completed_at": datetime.now().isoformat(),
            "output": (f"{output}\n\n{message}".strip())[-4000:],
        })


def install_runtime_dependency(dep_id: str):
    dep_id = str(dep_id or "").strip().lower()
    if dep_id not in _dependency_catalog():
        raise HTTPException(status_code=404, detail="Unsupported dependency")
    current_job = runtime_state.snapshot_dependency_job(dep_id)
    if current_job.get("status") == "installing":
        return {"started": False, "dependency": dep_id, "job": current_job}
    runtime_state.set_dependency_job(dep_id, {"status": "queued", "message": f"Queued {dep_id} installation."})
    threading.Thread(target=_install_dependency_worker, args=(dep_id,), daemon=True).start()
    return {"started": True, "dependency": dep_id, "job": runtime_state.snapshot_dependency_job(dep_id)}


def configure_adult_content(data: AdultContentConfigureRequest):
    password = (data.password or "").strip()
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")

    settings = load_settings()
    save_settings_to_disk({
        **settings,
        "adult_password_hash": _hash_adult_password(password),
        "adult_password_configured": True,
        "adult_content_enabled": False,
    })
    return {"configured": True}


def unlock_adult_content(data: AdultContentUnlockRequest, request: Request):
    settings = load_settings()
    expected_hash = settings.get("adult_password_hash") or ""
    if not expected_hash:
        raise HTTPException(status_code=428, detail="Set an adult-content password first.")

    client_key = _client_key(request)
    _ensure_unlock_not_throttled(client_key)
    if not _verify_adult_password(data.password or "", expected_hash):
        attempts = _record_unlock_failure(client_key)
        remaining = max(0, ADULT_UNLOCK_MAX_ATTEMPTS - attempts)
        raise HTTPException(status_code=403, detail=f"Incorrect password. {remaining} attempt(s) remaining before a temporary lockout.")

    adult_unlock_attempts.pop(client_key, None)
    return {"unlocked": True}


# ── Download Task ─────────────────────────────────────────────────────────────
def _resolve_final_file(raw_path: str, download_dir: str, preferred_ext: str = "") -> str:
    """
    After yt-dlp finishes, return the path to the real output file.
    The progress hook often stores a .part temp filename or a pre-merge filename.
    """
    if raw_path:
        p = Path(raw_path)
        # .part file: yt-dlp renames it on completion, try without suffix
        if p.suffix == ".part":
            candidate = p.with_suffix("")
            if candidate.exists() and candidate.is_file():
                return str(candidate)
        elif p.exists() and p.is_file() and p.suffix.lower() not in {".part", ".ytdl", ".tmp", ".temp", ".aria2"}:
            return str(p)

    # Fallback: find the most recently modified eligible file in the target directory.
    try:
        preferred = str(preferred_ext or "").strip().lower().lstrip(".")
        files = [
            f for f in Path(download_dir).rglob("*")
            if f.is_file() and f.suffix.lower() not in {".part", ".ytdl", ".tmp", ".temp", ".aria2"}
        ]
        if preferred:
            preferred_files = [f for f in files if f.suffix.lower() == f".{preferred}"]
            if preferred_files:
                newest = max(preferred_files, key=lambda f: f.stat().st_mtime)
                return str(newest)
        if files:
            newest = max(files, key=lambda f: f.stat().st_mtime)
            return str(newest)
    except Exception:
        pass

    return download_dir


def _move_final_output(dl_id: str, source_path: str) -> str:
    source = Path(source_path)
    if not source.exists() or not source.is_file():
        raise RuntimeError("The downloaded file could not be finalized because the output file was not found.")

    fallback = f"grabix-{dl_id}"
    target_title = downloads[dl_id].get("title") or source.stem or fallback
    extension = source.suffix.lstrip(".") or "bin"
    variant_label = _variant_label_for_output(dl_id, extension)
    final_path = _safe_variant_download_path(
        DOWNLOAD_DIR,
        target_title,
        extension,
        fallback,
        variant_label=variant_label,
    )
    shutil.move(str(source), final_path)
    downloads[dl_id]["variant_label"] = variant_label
    params = dict(downloads[dl_id].get("params") or {})
    params["variant_label"] = variant_label
    downloads[dl_id]["params"] = params
    return final_path


def _finalize_download_output(
    dl_id: str,
    file_path: str,
    dl_type: str,
    trim_enabled: bool,
    trim_start: float,
    trim_end: float,
    use_cpu: bool,
) -> str:
    final_source = file_path
    if dl_type == "video" and trim_enabled and trim_end > trim_start:
        final_source = _trim_downloaded_media(dl_id, final_source, trim_start, trim_end, use_cpu)

    downloads[dl_id].update({
        "status": "processing",
        "progress_mode": "processing",
        "stage_label": "Finalizing",
        "speed": "",
        "eta": "",
    })
    _persist_download_record(dl_id, force=True)

    final_path = _move_final_output(dl_id, final_source)
    final_size = Path(final_path).stat().st_size if Path(final_path).exists() else 0
    downloads[dl_id].update({
        "file_path": final_path,
        "partial_file_path": "",
        "status": "done",
        "percent": 100,
        "downloaded": _format_bytes(final_size),
        "total": _format_bytes(final_size),
        "size": _format_bytes(final_size),
        "bytes_downloaded": final_size,
        "bytes_total": final_size,
        "progress_mode": "determinate",
        "stage_label": "Completed",
        "speed": "",
        "eta": "0s",
    })
    db_update_status(dl_id, "done", final_path)
    _persist_download_record(dl_id, force=True)
    return final_path


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 3 — ADDITIONS TO backend/main.py
#
# Paste these NEW routes and helpers into your existing main.py.
# Add them BEFORE the final `_download_task` function at the bottom.
# Do NOT remove or replace anything already in main.py.
# ─────────────────────────────────────────────────────────────────────────────

import os
from pathlib import Path

# ── Phase 3: DB migration — add tags + category columns if missing ────────────
def migrate_db():
    """Add Phase 3 columns to the history table if they don't exist yet."""
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
        log_event(backend_logger, logging.INFO, event="db_migrated", message="History schema migration completed.")
    except Exception as e:
        log_event(backend_logger, logging.ERROR, event="db_migration_failed", message="History schema migration failed.", details={"error": str(e)})

migrate_db()
recover_download_jobs()


# ── Helper: get real file size from disk ─────────────────────────────────────
def _get_file_size(file_path: str) -> int:
    try:
        p = Path(file_path)
        if p.exists() and p.is_file():
            return p.stat().st_size
    except Exception:
        pass
    return 0


def _format_bytes_int(num: int) -> str:
    if not num:
        return "0 B"
    value = float(num)
    units = ["B", "KB", "MB", "GB", "TB"]
    idx = 0
    while value >= 1024 and idx < len(units) - 1:
        value /= 1024
        idx += 1
    if idx == 0:
        return f"{int(value)} {units[idx]}"
    return f"{value:.1f} {units[idx]}"


# ── Phase 3: Enriched history endpoint ───────────────────────────────────────
def _guess_dl_type_from_path(file_path: str) -> str:
    suffix = Path(file_path).suffix.lower()
    if suffix in {".mp3", ".m4a", ".aac", ".flac", ".wav", ".opus", ".ogg"}:
        return "audio"
    if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return "thumbnail"
    if suffix in {".srt", ".vtt", ".ass", ".ssa", ".sub"}:
        return "subtitle"
    return "video"


def _build_library_index() -> list[dict]:
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
        item["file_size"] = size_bytes
        item["file_size_label"] = _format_bytes_int(size_bytes)
        item["file_exists"] = exists_on_disk
        item["local_available"] = exists_on_disk
        item["broken"] = broken
        item["source_type"] = "history"
        item["library_status"] = "broken" if broken else (item.get("status") or "done")
        item["category"] = _infer_download_category(
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

        file_size = path.stat().st_size
        dl_type = _guess_dl_type_from_path(str(path))
        created_at = datetime.fromtimestamp(path.stat().st_mtime).isoformat()
        result.append({
            "id": f"untracked:{resolved}",
            "url": "",
            "title": path.stem,
            "thumbnail": "",
            "channel": "",
            "duration": 0,
            "dl_type": dl_type,
            "file_path": str(path),
            "status": "untracked",
            "created_at": created_at,
            "tags": "untracked,local",
            "category": _infer_download_category("", path.stem, dl_type, ""),
            "display_layout": _infer_library_display_layout("", path.stem, dl_type, ""),
            "file_size": file_size,
            "file_size_label": _format_bytes_int(file_size),
            "file_exists": True,
            "local_available": True,
            "broken": False,
            "source_type": "untracked",
            "library_status": "untracked",
        })

    con.commit()
    con.close()
    return sorted(result, key=lambda item: str(item.get("created_at") or ""), reverse=True)


def _reconcile_library_state() -> dict:
    init_db()
    migrate_db()
    con = get_db_connection()
    rows = con.execute("SELECT id, url, title, dl_type, category, status, file_path, file_size FROM history").fetchall()
    marked_missing = 0
    restored = 0
    recategorized = 0
    resized = 0

    for row in rows:
        item = dict(row)
        item_id = str(item.get("id") or "")
        file_path = str(item.get("file_path") or "").strip()
        exists_on_disk = bool(file_path and Path(file_path).exists() and Path(file_path).is_file())
        current_status = str(item.get("status") or "")
        desired_status = current_status or "done"

        if file_path:
            if exists_on_disk and current_status in {"missing", "broken"}:
                desired_status = "done"
                restored += 1
            elif not exists_on_disk and current_status not in {"missing", "broken"}:
                desired_status = "missing"
                marked_missing += 1

        actual_size = _get_file_size(file_path) if exists_on_disk else 0
        stored_size = int(item.get("file_size") or 0)
        if actual_size and actual_size != stored_size:
            con.execute("UPDATE history SET file_size=? WHERE id=?", (actual_size, item_id))
            resized += 1

        inferred_category = _infer_download_category(
            str(item.get("url") or ""),
            str(item.get("title") or ""),
            str(item.get("dl_type") or ""),
            str(item.get("category") or ""),
        )
        if inferred_category and inferred_category != str(item.get("category") or ""):
            con.execute("UPDATE history SET category=? WHERE id=?", (inferred_category, item_id))
            recategorized += 1

        if desired_status != current_status:
            con.execute("UPDATE history SET status=? WHERE id=?", (desired_status, item_id))

    con.commit()
    con.close()

    index = _build_library_index()
    broken = sum(1 for item in index if item.get("broken"))
    untracked = sum(1 for item in index if item.get("source_type") == "untracked")
    result = {
        "reconciled": True,
        "tracked_rows": len(rows),
        "indexed_items": len(index),
        "marked_missing": marked_missing,
        "restored": restored,
        "recategorized": recategorized,
        "resized": resized,
        "broken": broken,
        "untracked": untracked,
    }
    log_event(
        library_logger,
        logging.INFO,
        event="library_reconciled",
        message="Library reconciliation completed.",
        details=result,
    )
    return result


@app.get("/library/index")
def get_library_index():
    try:
        return _build_library_index()
    except Exception as e:
        log_event(library_logger, logging.ERROR, event="library_index_failed", message="Library index build failed.", details={"error": str(e)})
        return []


@app.post("/library/reconcile")
def reconcile_library():
    try:
        return _reconcile_library_state()
    except Exception as e:
        log_event(library_logger, logging.ERROR, event="library_reconcile_failed", message="Library reconcile failed.", details={"error": str(e)})
        raise HTTPException(status_code=500, detail="Library reconcile failed.")


@app.post("/library/mark-missing")
def mark_library_item_missing(item_id: str):
    try:
        con = get_db_connection()
        row = con.execute("SELECT id, file_path FROM history WHERE id=?", (item_id,)).fetchone()
        if not row:
            con.close()
            raise HTTPException(status_code=404, detail="Library item not found")
        con.execute("UPDATE history SET status=? WHERE id=?", ("missing", item_id))
        con.commit()
        con.close()
        return {"marked": True, "id": item_id, "status": "missing", "file_path": row["file_path"] or ""}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/library/stale/{item_id}")
def remove_stale_library_item(item_id: str):
    try:
        con = get_db_connection()
        row = con.execute("SELECT file_path FROM history WHERE id=?", (item_id,)).fetchone()
        if not row:
            con.close()
            raise HTTPException(status_code=404, detail="Library item not found")
        file_path = str(row["file_path"] or "").strip()
        if file_path and Path(file_path).exists():
            con.close()
            raise HTTPException(status_code=400, detail="Local file still exists. Use the normal delete action instead.")
        con.execute("DELETE FROM history WHERE id=?", (item_id,))
        con.commit()
        con.close()
        return {"removed": True, "id": item_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/library/file")
def delete_library_file(path: str):
    target = ensure_safe_managed_path(path, DOWNLOAD_DIR, must_exist=True, expect_file=True)
    try:
        target.unlink()
        return {"deleted": True, "path": str(target)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


try:
    _reconcile_library_state()
except Exception as reconcile_error:
    log_event(library_logger, logging.ERROR, event="startup_library_reconcile_failed", message="Startup library reconcile failed.", details={"error": str(reconcile_error)})


@app.get("/history/full")
def get_history_full():
    """
    Returns history with real file sizes read from disk.
    Also updates the DB file_size column if it hasn't been set yet.
    """
    try:
        init_db()
        migrate_db()
        con = get_db_connection()
        rows = con.execute("SELECT * FROM history ORDER BY created_at DESC LIMIT 500").fetchall()
        result = []
        for row in rows:
            item = dict(row)
            size_bytes = item.get("file_size") or 0
            # If no size stored, read from disk
            if not size_bytes and item.get("file_path"):
                size_bytes = _get_file_size(item["file_path"])
                if size_bytes:
                    con.execute("UPDATE history SET file_size=? WHERE id=?", (size_bytes, item["id"]))
            item["file_size"] = size_bytes
            item["file_size_label"] = _format_bytes_int(size_bytes)
            result.append(item)
        con.commit()
        con.close()
        return result
    except Exception as e:
        print(f"[GRABIX] get_history_full error: {e}")
        return []


# ── Phase 3: Delete a file from disk and history DB ──────────────────────────
@app.delete("/history/{item_id}")
def delete_history_item(item_id: str, delete_file: bool = True):
    """
    Remove a history entry. If delete_file=true (default), also deletes the
    actual file from disk.
    """
    try:
        con = get_db_connection()
        row = con.execute("SELECT file_path FROM history WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Item not found")
        file_path = row["file_path"]
        con.execute("DELETE FROM history WHERE id=?", (item_id,))
        con.commit()
        con.close()

        deleted_file = False
        if delete_file and file_path:
            try:
                p = ensure_safe_managed_path(file_path, DOWNLOAD_DIR, expect_file=True)
                if p.exists() and p.is_file():
                    p.unlink()
                    deleted_file = True
            except Exception as fe:
                print(f"[GRABIX] delete file error: {fe}")

        return {"deleted": True, "file_deleted": deleted_file}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Phase 3: Update tags and category for a history item ─────────────────────
@app.patch("/history/{item_id}")
def update_history_item(item_id: str, tags: str = "", category: str = ""):
    """Update the tags and category of a history entry."""
    try:
        con = get_db_connection()
        con.execute(
            "UPDATE history SET tags=?, category=? WHERE id=?",
            (tags, category, item_id)
        )
        con.commit()
        row = con.execute("SELECT * FROM history WHERE id=?", (item_id,)).fetchone()
        con.close()
        if not row:
            raise HTTPException(status_code=404, detail="Item not found")
        return dict(row)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Phase 3: Storage stats ────────────────────────────────────────────────────
@app.get("/storage/stats")
def get_storage_stats():
    """
    Returns total disk usage and per-type breakdown from the history DB.
    Also scans DOWNLOAD_DIR for any files not in the DB.
    """
    try:
        init_db()
        migrate_db()
        con = get_db_connection()
        rows = con.execute("SELECT dl_type, file_path, file_size FROM history").fetchall()
        con.close()

        by_type: dict[str, int] = {"video": 0, "audio": 0, "thumbnail": 0, "subtitle": 0, "other": 0}
        tracked_files: set[str] = set()
        total_bytes = 0

        for row in rows:
            fp = row["file_path"] or ""
            size = row["file_size"] or 0
            if fp:
                # Always read from disk for accuracy
                disk_size = _get_file_size(fp)
                size = disk_size if disk_size else size
                tracked_files.add(fp)
            t = row["dl_type"] or "other"
            if t not in by_type:
                t = "other"
            by_type[t] += size
            total_bytes += size

        # Scan for untracked files in DOWNLOAD_DIR
        untracked_bytes = 0
        untracked_count = 0
        try:
            for f in Path(DOWNLOAD_DIR).iterdir():
                if f.is_file() and not _is_internal_managed_file(f) and str(f) not in tracked_files:
                    sz = f.stat().st_size
                    untracked_bytes += sz
                    untracked_count += 1
        except Exception:
            pass

        # Disk usage of the whole DOWNLOAD_DIR
        folder_total = 0
        try:
            for f in Path(DOWNLOAD_DIR).rglob("*"):
                if f.is_file() and not _is_internal_managed_file(f):
                    try:
                        folder_total += f.stat().st_size
                    except Exception:
                        pass
        except Exception:
            pass

        return {
            "total_bytes": total_bytes,
            "total_label": _format_bytes_int(total_bytes),
            "folder_total_bytes": folder_total,
            "folder_total_label": _format_bytes_int(folder_total),
            "by_type": {k: {"bytes": v, "label": _format_bytes_int(v)} for k, v in by_type.items()},
            "untracked_bytes": untracked_bytes,
            "untracked_count": untracked_count,
            "download_dir": DOWNLOAD_DIR,
        }
    except Exception as e:
        print(f"[GRABIX] storage_stats error: {e}")
        return {"total_bytes": 0, "total_label": "0 B", "folder_total_bytes": 0,
                "folder_total_label": "0 B", "by_type": {}, "untracked_bytes": 0,
                "untracked_count": 0, "download_dir": DOWNLOAD_DIR}


# ── Phase 3: Clear all history (DB only, optionally delete files) ─────────────
@app.delete("/history")
def clear_history(delete_files: bool = False):
    """Delete all history entries. Optionally delete the actual files too."""
    try:
        con = get_db_connection()
        if delete_files:
            rows = con.execute("SELECT file_path FROM history").fetchall()
            for row in rows:
                fp = row["file_path"]
                if fp:
                    try:
                        p = Path(fp)
                        if p.exists() and p.is_file():
                            p.unlink()
                    except Exception:
                        pass
        con.execute("DELETE FROM history")
        con.commit()
        con.close()
        return {"cleared": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Phase 3: Organize files into subfolders by type ──────────────────────────
@app.post("/library/organize")
def organize_library():
    """
    Moves downloaded files into subfolders: Videos/, Audio/, Thumbnails/, Subtitles/
    Updates file_path in the DB after moving.
    """
    type_folders = {
        "video":     "Videos",
        "audio":     "Audio",
        "thumbnail": "Thumbnails",
        "subtitle":  "Subtitles",
    }
    moved = 0
    errors = []

    try:
        con = get_db_connection()
        rows = con.execute("SELECT id, dl_type, file_path FROM history").fetchall()

        for row in rows:
            fp = row["file_path"]
            dl_type = row["dl_type"] or "video"
            if not fp:
                continue
            p = ensure_safe_managed_path(fp, DOWNLOAD_DIR, expect_file=True)
            if not p.exists() or not p.is_file():
                continue

            subfolder = type_folders.get(dl_type, "Other")
            dest_dir = ensure_safe_managed_path(str(Path(DOWNLOAD_DIR) / subfolder), DOWNLOAD_DIR)
            dest_dir.mkdir(exist_ok=True)
            dest = dest_dir / p.name

            # Don't move if already in the right folder
            if p.parent == dest_dir:
                continue

            # Avoid overwrite collisions
            if dest.exists():
                stem = p.stem
                suffix = p.suffix
                counter = 1
                while dest.exists():
                    dest = dest_dir / f"{stem}_{counter}{suffix}"
                    counter += 1

            try:
                shutil.move(str(p), str(dest))
                con.execute("UPDATE history SET file_path=? WHERE id=?", (str(dest), row["id"]))
                moved += 1
            except Exception as e:
                errors.append({"file": str(p), "error": str(e)})

        con.commit()
        con.close()
        return {"moved": moved, "errors": errors}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _download_task(dl_id, url, dl_type, quality, audio_format, audio_quality,
                   subtitle_lang, thumbnail_format, trim_start, trim_end, trim_enabled,
                   use_cpu=True, headers_json="", force_hls=False):
    downloads[dl_id]["status"] = "downloading"
    downloads[dl_id]["error"] = ""
    downloads[dl_id]["recoverable"] = False
    downloads[dl_id]["failure_code"] = ""
    _persist_download_record(dl_id, force=True)
    controls = download_controls[dl_id]
    request_headers: dict[str, str] = {}
    if headers_json:
        try:
            parsed_headers = json.loads(headers_json)
            if isinstance(parsed_headers, dict):
                request_headers = {
                    str(key): str(value)
                    for key, value in parsed_headers.items()
                    if value is not None and str(value).strip()
                }
        except Exception:
            request_headers = {}
    effective_engine = downloads[dl_id].get("download_engine") or _effective_download_engine(downloads[dl_id].get("params"))
    estimated_total_bytes = int((downloads[dl_id].get("params") or {}).get("estimated_total_bytes") or 0)
    workspace = _prepare_job_workspace(dl_id)

    def progress_hook(d):
        while controls["pause"].is_set() and not controls["cancel"].is_set():
            time.sleep(0.2)

        if controls["cancel"].is_set():
            raise RuntimeError("Download canceled")

        # aria2-backed yt-dlp downloads are tracked by the external file monitor.
        # Mixing yt-dlp's per-stream events with that monitor causes progress jumps.
        if effective_engine == "aria2" and dl_type in {"video", "audio"}:
            if d["status"] == "downloading":
                filename = d.get("filename", "")
                if filename:
                    downloads[dl_id]["file_path"] = filename
                    downloads[dl_id]["stage_label"] = "Downloading"
                    _persist_download_record(dl_id)
            elif d["status"] == "finished":
                downloads[dl_id].update({
                    "status": "processing",
                    "progress_mode": "processing",
                    "stage_label": "Merging",
                    "speed": "",
                    "eta": "",
                })
                _persist_download_record(dl_id, force=True)
            return

        if d["status"] == "downloading":
            downloaded_bytes = d.get("downloaded_bytes") or 0
            total_bytes = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            pct = round((downloaded_bytes / total_bytes) * 100, 1) if total_bytes else 0
            raw_speed = d.get("speed")
            speed = _strip_ansi(d.get("_speed_str", ""))
            if not speed and raw_speed:
                speed = f"{_format_bytes(raw_speed)}/s"
            eta = _strip_ansi(d.get("_eta_str", "")) or _format_eta(d.get("eta"))
            downloads[dl_id].update({
                "percent": pct,
                "speed": speed,
                "eta": eta,
                "downloaded": _format_bytes(downloaded_bytes),
                "total": _format_bytes(total_bytes),
                "size": _format_bytes(total_bytes or downloaded_bytes),
                "bytes_downloaded": downloaded_bytes,
                "bytes_total": total_bytes,
                "progress_mode": "determinate" if total_bytes else "activity",
                "stage_label": "Downloading",
                "file_path": d.get("filename", downloads[dl_id].get("file_path", "")),
                "partial_file_path": d.get("filename", downloads[dl_id].get("partial_file_path", "")),
            })
            _persist_download_record(dl_id)
        elif d["status"] == "finished":
            downloads[dl_id].update({
                "status": "processing",
                "progress_mode": "processing",
                "stage_label": "Finalizing",
                "eta": "",
                "speed": "",
                "file_path": d.get("filename", downloads[dl_id].get("file_path", "")),
            })
            _persist_download_record(dl_id, force=True)

    template = str(workspace / f"{_yt_dlp_output_stem(dl_id, url)}.%(ext)s")
    opts: dict = {
        "outtmpl": template,
        "noplaylist": True,
        "progress_hooks": [progress_hook],
        "continuedl": True,
        "windowsfilenames": True,
    }
    if effective_engine == "aria2" and has_aria2():
        opts["external_downloader"] = ARIA2_PATH
        opts["external_downloader_args"] = {
            "default": [
                "--max-connection-per-server=16",
                "--split=16",
                "--min-split-size=1M",
                "--file-allocation=none",
                "--summary-interval=1",
                "--download-result=hide",
                "--console-log-level=warn",
            ]
        }
    monitor_stop_event: threading.Event | None = None
    monitor_thread: threading.Thread | None = None

    try:
        if effective_engine == "aria2" and not (force_hls or ".m3u8" in url.lower()):
            if dl_type == "video" and _is_direct_media_url(url):
                output_path = _download_via_aria2(dl_id, url, dl_type, request_headers, output_dir=workspace)
                _finalize_download_output(dl_id, output_path, dl_type, trim_enabled, trim_start, trim_end, use_cpu)
                return

        if dl_type == "video" and (force_hls or ".m3u8" in url.lower()):
            output_path = _download_hls_media(dl_id, url, request_headers, output_dir=workspace)
            _finalize_download_output(dl_id, output_path, dl_type, trim_enabled, trim_start, trim_end, use_cpu)
            return

        if dl_type == "video" and _is_direct_media_url(url):
            output_path = _download_direct_media(dl_id, url, request_headers, output_dir=workspace)
            _finalize_download_output(dl_id, output_path, dl_type, trim_enabled, trim_start, trim_end, use_cpu)
            return

        if dl_type == "subtitle" and _is_direct_subtitle_url(url):
            output_path = _download_direct_subtitle(dl_id, url, request_headers, output_dir=workspace)
            _finalize_download_output(dl_id, output_path, dl_type, trim_enabled, trim_start, trim_end, use_cpu)
            return

        if dl_type == "video":
            opts["format"] = _build_video_format_selector(quality)
            if trim_enabled and trim_end > trim_start:
                if not has_ffmpeg():
                    raise RuntimeError("Trimmed video downloads require FFmpeg. Install FFmpeg from the downloader tools panel and try again.")

        elif dl_type == "audio":
            opts["format"] = "bestaudio/best"
            if has_ffmpeg():
                opts["postprocessors"] = [{
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": audio_format,
                    "preferredquality": audio_quality,
                }]

        elif dl_type == "thumbnail":
            opts["skip_download"] = True
            opts["writethumbnail"] = True
            if has_ffmpeg():
                opts["postprocessors"] = [{"key": "FFmpegThumbnailsConvertor", "format": thumbnail_format}]

        elif dl_type == "subtitle":
            opts["skip_download"] = True
            opts["writesubtitles"] = True
            opts["writeautomaticsub"] = True
            opts["subtitleslangs"] = [subtitle_lang]

        if request_headers:
            opts["http_headers"] = request_headers

        with yt_dlp.YoutubeDL(opts) as ydl:
            if effective_engine == "aria2" and dl_type in {"video", "audio"}:
                try:
                    monitor_stop_event, monitor_thread = _start_external_downloader_progress_monitor(
                        dl_id,
                        workspace,
                        expected_total_bytes=estimated_total_bytes,
                    )
                except Exception:
                    monitor_stop_event, monitor_thread = _start_external_downloader_progress_monitor(
                        dl_id,
                        workspace,
                        expected_total_bytes=estimated_total_bytes,
                    )
            ydl.download([url])

        preferred_ext = ""
        if dl_type == "audio" and has_ffmpeg():
            preferred_ext = audio_format
        elif dl_type == "thumbnail":
            preferred_ext = thumbnail_format
        raw_path = downloads[dl_id].get("file_path", "")
        file_path = _resolve_final_file(raw_path, str(workspace), preferred_ext=preferred_ext)
        _finalize_download_output(dl_id, file_path, dl_type, trim_enabled, trim_start, trim_end, use_cpu)

    except Exception as e:
        status = "canceled" if controls["cancel"].is_set() else "failed"
        error_text = str(e)
        if isinstance(e, OSError) and getattr(e, "errno", None) == 22:
            error_text = "Windows rejected the generated download file path. GRABIX now uses safer filenames, so retry this download after restarting the backend/app."
        downloads[dl_id]["status"] = status
        downloads[dl_id]["error"] = error_text
        downloads[dl_id]["recoverable"] = status == "failed"
        downloads[dl_id]["failure_code"] = "download_canceled" if status == "canceled" else "download_failed"
        downloads[dl_id]["progress_mode"] = "activity"
        downloads[dl_id]["stage_label"] = "Canceled" if status == "canceled" else "Failed"
        db_update_status(dl_id, status, downloads[dl_id].get("file_path", ""))
        _persist_download_record(dl_id, force=True)
    finally:
        if monitor_stop_event is not None:
          monitor_stop_event.set()
        if monitor_thread is not None and monitor_thread.is_alive():
          monitor_thread.join(timeout=1.0)
        _cleanup_job_workspace(dl_id)
        controls["pause"].clear()
        controls["process"] = None
        controls["process_kind"] = ""
        controls["thread"] = None


# ═══════════════════════════════════════════════════════════════════════════════
# CONVERSION ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

# In-memory store for conversion jobs (same pattern as downloads)
conversions: dict = {}

def _create_conversion_record(job_id: str, input_path: str, output_format: str) -> dict:
    conversions[job_id] = {
        "id": job_id,
        "status": "queued",
        "percent": 0,
        "input_path": input_path,
        "output_path": "",
        "output_format": output_format,
        "error": "",
        "created_at": datetime.now().isoformat(),
    }
    return conversions[job_id]


def _conversion_task(job_id: str, input_path: str, output_format: str):
    """Run FFmpeg to convert input_path to output_format, updating conversions[job_id]."""
    job = conversions[job_id]
    job["status"] = "converting"
    job["percent"] = 5

    if not has_ffmpeg():
        job["status"] = "failed"
        job["error"] = "FFmpeg is not installed. Install FFmpeg and add it to PATH."
        return

    input_p = Path(input_path)
    if not input_p.exists():
        job["status"] = "failed"
        job["error"] = f"File not found: {input_path}"
        return

    output_path = str(input_p.with_suffix(f".{output_format}"))
    # Avoid overwriting the source file if same extension
    if output_path == input_path:
        stem = input_p.stem + "_converted"
        output_path = str(input_p.parent / f"{stem}.{output_format}")

    job["output_path"] = output_path

    # Build FFmpeg command. -y = overwrite without asking.
    cmd = [FFMPEG_PATH, "-y", "-i", input_path]

    # Format-specific encoding flags for quality/compatibility
    fmt = output_format.lower()
    if fmt == "mp4":
        cmd += ["-c:v", "libx264", "-crf", "23", "-preset", "fast", "-c:a", "aac", "-b:a", "192k"]
    elif fmt == "mp3":
        cmd += ["-vn", "-c:a", "libmp3lame", "-q:a", "2"]
    elif fmt == "m4a":
        cmd += ["-vn", "-c:a", "aac", "-b:a", "192k"]
    elif fmt == "opus":
        cmd += ["-vn", "-c:a", "libopus", "-b:a", "128k"]
    elif fmt == "flac":
        cmd += ["-vn", "-c:a", "flac"]
    elif fmt == "wav":
        cmd += ["-vn", "-c:a", "pcm_s16le"]
    elif fmt == "webm":
        cmd += ["-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-c:a", "libopus"]
    elif fmt == "mkv":
        cmd += ["-c:v", "copy", "-c:a", "copy"]
    elif fmt == "gif":
        cmd += ["-vf", "fps=10,scale=480:-1:flags=lanczos", "-loop", "0"]
    else:
        # Generic passthrough — let FFmpeg decide
        cmd += ["-c", "copy"]

    cmd.append(output_path)

    try:
        # Run FFmpeg. We parse stderr for progress via duration/time lines.
        proc = subprocess.Popen(
            cmd,
            stderr=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            universal_newlines=True,
            encoding="utf-8",
            errors="replace",
        )

        duration_secs: float = 0.0
        duration_re = re.compile(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)")
        time_re = re.compile(r"time=\s*(\d+):(\d+):(\d+\.\d+)")

        for line in proc.stderr:
            # Parse total duration once
            if not duration_secs:
                m = duration_re.search(line)
                if m:
                    h, mn, s = float(m.group(1)), float(m.group(2)), float(m.group(3))
                    duration_secs = h * 3600 + mn * 60 + s

            # Parse current time for progress
            m = time_re.search(line)
            if m and duration_secs:
                h, mn, s = float(m.group(1)), float(m.group(2)), float(m.group(3))
                current = h * 3600 + mn * 60 + s
                pct = min(99, round((current / duration_secs) * 100))
                job["percent"] = pct

        proc.wait()

        if proc.returncode != 0:
            job["status"] = "failed"
            job["error"] = "FFmpeg exited with an error. Check that the file is a valid media file."
            return

        job["percent"] = 100
        job["status"] = "done"
        job["output_path"] = output_path

    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)


@app.post("/convert")
def start_conversion(input_path: str, output_format: str):
    """Start a background FFmpeg conversion job."""
    if not input_path or not output_format:
        raise HTTPException(status_code=400, detail="input_path and output_format are required")

    job_id = str(uuid.uuid4())
    _create_conversion_record(job_id, input_path, output_format)

    thread = threading.Thread(
        target=_conversion_task,
        args=(job_id, input_path, output_format),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id, "status": "queued"}


@app.get("/convert-status/{job_id}")
def convert_status(job_id: str):
    job = conversions.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


# ═══════════════════════════════════════════════════════════════════════════════
# STORAGE STATS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/storage-stats")
def storage_stats():
    """Return total size + file count of the GRABIX downloads folder."""
    try:
        folder = Path(DOWNLOAD_DIR)
        if not folder.exists():
            return {"total_bytes": 0, "total_size": "0 B", "file_count": 0, "folder": DOWNLOAD_DIR}

        total = 0
        count = 0
        # Count all non-hidden, non-db files
        for f in folder.rglob("*"):
            if f.is_file() and not f.name.startswith(".") and f.suffix not in (".db", ".json"):
                total += f.stat().st_size
                count += 1

        return {
            "total_bytes": total,
            "total_size": _format_bytes(total),
            "file_count": count,
            "folder": DOWNLOAD_DIR,
        }
    except Exception as e:
        return {"total_bytes": 0, "total_size": "0 B", "file_count": 0, "folder": DOWNLOAD_DIR, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# HISTORY MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════

def ffmpeg_status():
    """Check if FFmpeg is available."""
    return {"available": has_ffmpeg(), "path": FFMPEG_PATH or ""}


def _service_payload(name: str, status: str, message: str, retryable: bool = True, details: dict | None = None) -> dict:
    return {
        "name": name,
        "status": status,
        "message": message,
        "retryable": retryable,
        "details": details or {},
    }


def _database_health() -> dict:
    try:
        con = get_db_connection()
        con.execute("SELECT 1").fetchone()
        con.close()
        return _service_payload("database", "online", "Database is ready.")
    except Exception as exc:
        return _service_payload("database", "offline", "Database could not be opened.", True, {"error": str(exc)})


def _downloads_health() -> dict:
    try:
        os.makedirs(DOWNLOAD_DIR, exist_ok=True)
        writable = os.access(DOWNLOAD_DIR, os.W_OK)
        if writable:
            return _service_payload("downloads", "online", "Download folder is writable.")
        return _service_payload("downloads", "offline", "Download folder is not writable.", True)
    except Exception as exc:
        return _service_payload("downloads", "offline", "Download folder is unavailable.", True, {"error": str(exc)})


async def health_services() -> dict:
    ffmpeg_available = has_ffmpeg()
    database = _database_health()
    downloads_health = _downloads_health()
    moviebox = (
        _service_payload("moviebox", "online", "Movie Box provider is available.", False)
        if MOVIEBOX_AVAILABLE
        else _service_payload(
            "moviebox",
            "degraded",
            "Movie Box provider is unavailable. Other movie sources can still work.",
            True,
            {"import_error": MOVIEBOX_IMPORT_ERROR or ""},
        )
    )
    manga = _service_payload("manga", "online", "Manga routes are available.", False)

    global consumet_health_cache
    if consumet_health_cache and consumet_health_cache[0] > time.time():
        consumet_health = consumet_health_cache[1]
    else:
        try:
            consumet_health = await asyncio.wait_for(get_consumet_health_status(), timeout=0.9)
        except Exception as exc:
            consumet_health = {
                "configured": False,
                "healthy": False,
                "message": "Consumet is still warming up. Anime fallback playback is already available.",
                "error": str(exc),
            }
        consumet_health_cache = (time.time() + CONSUMET_HEALTH_CACHE_TTL_SECONDS, consumet_health)

    consumet_status = "online" if consumet_health.get("healthy") else "degraded"
    consumet = _service_payload(
        "consumet",
        consumet_status,
        str(consumet_health.get("message") or "Consumet health unavailable."),
        True,
        {"configured": bool(consumet_health.get("configured")), "api_base": consumet_health.get("api_base", "")},
    )
    anime = _service_payload(
        "anime",
        "online" if consumet_health.get("healthy") else "degraded",
        "Anime playback is fully available." if consumet_health.get("healthy") else "Anime playback is running on the built-in fallback stack.",
        True,
    )
    ffmpeg = _service_payload(
        "ffmpeg",
        "online" if ffmpeg_available else "degraded",
        "FFmpeg is ready." if ffmpeg_available else "FFmpeg is unavailable, so converter and some HLS flows are limited.",
        True,
        {"path": FFMPEG_PATH or ""},
    )

    services = {
        "backend": _service_payload("backend", "online", "Backend is responding.", False),
        "database": database,
        "downloads": downloads_health,
        "ffmpeg": ffmpeg,
        "consumet": consumet,
        "moviebox": moviebox,
        "anime": anime,
        "manga": manga,
    }
    summary = {"online": 0, "degraded": 0, "offline": 0}
    for payload in services.values():
        state = payload.get("status", "offline")
        summary[state] = summary.get(state, 0) + 1
    return {"services": services, "summary": summary}


async def health_capabilities() -> dict:
    payload = await health_services()
    services = payload["services"]
    capabilities = {
        "startup_ready": services["database"]["status"] == "online" and services["downloads"]["status"] == "online",
        "can_show_shell": True,
        "can_open_library": True,
        "can_download_media": services["downloads"]["status"] == "online",
        "can_use_converter": services["ffmpeg"]["status"] == "online",
        "can_browse_movies": True,
        "can_browse_tv": True,
        "can_use_moviebox": services["moviebox"]["status"] == "online",
        "can_play_anime": True,
        "can_play_anime_primary": services["consumet"]["status"] == "online",
        "can_play_anime_fallback": True,
        "can_read_manga": services["manga"]["status"] == "online",
    }
    degraded_services = [
        name
        for name, item in services.items()
        if item["status"] in {"degraded", "offline"} and name != "backend"
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
    database = _database_health()
    downloads_health = _downloads_health()
    core_ready = database["status"] == "online" and downloads_health["status"] == "online"
    return {
        "ok": True,
        "core_ready": core_ready,
        "services": {
            "backend": _service_payload("backend", "online", "Backend is responding.", False),
            "database": database,
            "downloads": downloads_health,
        },
    }


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
        },
    }


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

async def extract_stream(url: str):
    safe_url = _validate_outbound_url(url)
    cached = stream_extract_cache.get(safe_url)
    if cached and cached[0] > time.time():
        return cached[1]
    try:
        direct_url, kind = _extract_stream_url(safe_url)
        payload = {"url": direct_url, "quality": "Auto", "format": kind}
        stream_extract_cache[safe_url] = (time.time() + STREAM_EXTRACT_CACHE_TTL_SECONDS, payload)
        return payload
    except subprocess.TimeoutExpired as exc:
        ytdlp_error = "Stream extraction timed out"
    except Exception as exc:
        ytdlp_error = str(exc) or "No stream found"

    browser_result = _extract_stream_url_via_browser(safe_url)
    if browser_result:
        direct_url, kind = browser_result
        log_event(playback_logger, logging.INFO, event="extract_stream_browser_fallback", message="Browser fallback resolved a stream.", details={"url": safe_url[:180], "format": kind})
        payload = {"url": direct_url, "quality": "Auto", "format": kind}
        stream_extract_cache[safe_url] = (time.time() + STREAM_EXTRACT_CACHE_TTL_SECONDS, payload)
        return payload

    log_event(playback_logger, logging.ERROR, event="extract_stream_failed", message="Stream extraction failed.", details={"url": safe_url[:180], "error": ytdlp_error})
    raise HTTPException(status_code=422, detail=ytdlp_error)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.getenv("GRABIX_BACKEND_PORT", "8000")),
        log_level=os.getenv("GRABIX_BACKEND_LOG_LEVEL", "warning"),
    )
