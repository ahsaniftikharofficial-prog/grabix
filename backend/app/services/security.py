import json
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from fastapi import HTTPException
from app.services.network_policy import validate_outbound_target

DEFAULT_LOCAL_APP_ORIGINS = [
    "http://127.0.0.1:1420",
    "http://localhost:1420",
    "http://127.0.0.1:1421",
    "http://localhost:1421",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "tauri://localhost",
    "http://tauri.localhost",
]

DEFAULT_APPROVED_MEDIA_HOSTS = (
    "youtube.com",
    "youtu.be",
    "googlevideo.com",
    "ytimg.com",
    "vimeo.com",
    "archive.org",
    "moviebox.ng",
    "moviebox.ph",
    "movieboxpro.app",
    "hakunaymatata.com",
    "bcdnxw.com",
    "bunnycdn",
    "cdn",
    "vidsrc",
    "2embed",
    "multiembed",
    "vsembed",
    "hianime",
    "aniwatch",
    "mangadex",
    "comick",
    "opensubtitles",
    "subdl",
    "stormshade",
    "crimsonstorm",
    "megacloud",
    "rabbitstream",
    "dokicloud",
    "*",
)


def validate_outbound_url(url: str, *, allowed_hosts: tuple[str, ...] = DEFAULT_APPROVED_MEDIA_HOSTS) -> str:
    result = validate_outbound_target(
        url,
        mode="approved_provider_target",
        allowed_hosts=allowed_hosts,
    )
    return result.normalized_url


def _normalize_loopback(hostname: str) -> str:
    """Treat localhost, 127.0.0.1, and ::1 as the same host for proxy-URL detection."""
    h = (hostname or "").lower().strip()
    if h in ("localhost", "127.0.0.1", "::1"):
        return "127.0.0.1"
    return h


def normalize_download_target(
    url: str,
    *,
    self_base_url: str,
    headers_json: str = "",
    moviebox_headers: dict[str, str] | None = None,
    allowed_hosts: tuple[str, ...] = DEFAULT_APPROVED_MEDIA_HOSTS,
) -> tuple[str, str]:
    parsed = urlparse((url or "").strip())
    self_parsed = urlparse(self_base_url)
    same_host = _normalize_loopback(parsed.hostname or "") == _normalize_loopback(self_parsed.hostname or "")
    same_port = (parsed.port or (443 if parsed.scheme == "https" else 80)) == (
        self_parsed.port or (443 if self_parsed.scheme == "https" else 80)
    )

    if same_host and same_port and parsed.path in {"/stream/proxy", "/moviebox/proxy-stream", "/moviebox/subtitle"}:
        query = parse_qs(parsed.query)
        nested_url = (query.get("url") or [""])[0].strip()
        nested_headers_json = headers_json or (query.get("headers_json") or [""])[0].strip()
        if not nested_headers_json and parsed.path.startswith("/moviebox/") and moviebox_headers:
            nested_headers_json = json.dumps(dict(moviebox_headers))
        if nested_url:
            return validate_outbound_url(nested_url, allowed_hosts=allowed_hosts), nested_headers_json

    return validate_outbound_url(url, allowed_hosts=allowed_hosts), headers_json


def ensure_safe_managed_path(raw_path: str, base_dir: str | Path, *, must_exist: bool = False, expect_file: bool | None = None) -> Path:
    base_path = Path(base_dir).resolve()
    candidate = Path(raw_path).expanduser()
    if not candidate.is_absolute():
        candidate = base_path / candidate
    candidate = candidate.resolve(strict=False)

    try:
        candidate.relative_to(base_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Path is outside the managed GRABIX folder.") from exc

    if must_exist and not candidate.exists():
        raise HTTPException(status_code=404, detail="Managed path was not found.")
    if expect_file is True and candidate.exists() and not candidate.is_file():
        raise HTTPException(status_code=400, detail="Expected a file path.")
    if expect_file is False and candidate.exists() and not candidate.is_dir():
        raise HTTPException(status_code=400, detail="Expected a folder path.")
    return candidate


def redact_for_diagnostics(value: Any) -> Any:
    sensitive_keys = {"password", "token", "authorization", "cookie", "headers_json", "secret"}
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            if str(key).lower() in sensitive_keys:
                redacted[key] = "<redacted>"
            else:
                redacted[key] = redact_for_diagnostics(item)
        return redacted
    if isinstance(value, list):
        return [redact_for_diagnostics(item) for item in value]
    return value
