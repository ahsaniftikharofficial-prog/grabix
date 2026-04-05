import asyncio
import gzip
import json
import os
import sqlite3
import zipfile
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

SUBDL_API_URL = "https://api.subdl.com/api/v1/subtitles"
SUBDL_API_KEY = os.environ.get("SUBDL_API_KEY", "").strip()
OPENSUBTITLES_ORG_URL = "https://rest.opensubtitles.org/search"
OPENSUBTITLES_ORG_HEADERS = {
    "X-User-Agent": "TemporaryUserAgent",
    "User-Agent": "TemporaryUserAgent",
    "Accept": "application/json",
}
OPENSUBTITLES_COM_API_KEY = "zoOjoVaadmVovAQTja9Vo3tkVP14tO9q"
OPENSUBTITLES_COM_URL = "https://api.opensubtitles.com/api/v1"
OPENSUBTITLES_COM_HEADERS = {
    "Api-Key": OPENSUBTITLES_COM_API_KEY,
    "User-Agent": "GRABIX v1.0",
    "Accept": "application/json",
}
OPENSUBTITLES_COM_LINK_PREFIX = "opensubtitles-com://"
DB_PATH = Path.home() / "Downloads" / "GRABIX" / "grabix.db"

LANGUAGE_MAP = {
    "en": {"subdl": "EN", "org": "en", "com": "en", "label": "English"},
    "ur": {"subdl": "UR", "org": "ur", "com": "ur", "label": "Urdu"},
    "ar": {"subdl": "AR", "org": "ar", "com": "ar", "label": "Arabic"},
    "hi": {"subdl": "HI", "org": "hi", "com": "hi", "label": "Hindi"},
    "fr": {"subdl": "FR", "org": "fr", "com": "fr", "label": "French"},
    "es": {"subdl": "ES", "org": "es", "com": "es", "label": "Spanish"},
    "de": {"subdl": "DE", "org": "de", "com": "de", "label": "German"},
}


def _db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS subtitle_cache (
            cache_key TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            language TEXT NOT NULL,
            media_type TEXT NOT NULL,
            content TEXT NOT NULL,
            format TEXT NOT NULL,
            source TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    con.commit()
    return con


def _cache_key(title: str, language: str, media_type: str) -> str:
    return f"{title.strip().lower()}::{language.strip().lower()}::{media_type.strip().lower()}"


def _language_codes(language: str) -> dict[str, str]:
    return LANGUAGE_MAP.get(
        language.lower(),
        {
            "subdl": language.upper(),
            "org": language.lower(),
            "com": language.lower(),
            "label": language.upper(),
        },
    )


def _media_type_value(media_type: str) -> str:
    return "tv" if media_type.lower() in {"tv", "series", "show", "anime"} else "movie"


def _decode_bytes(data: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig", "cp1256", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


def _normalize_subtitle_content(content: str) -> str:
    text = (content or "").replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
    if text.startswith("WEBVTT"):
        return text
    return text


def _guess_format(download_url: str, title: str = "") -> str:
    lowered = f"{download_url} {title}".lower()
    if ".vtt" in lowered:
        return "vtt"
    if ".ass" in lowered:
        return "ass"
    return "srt"


def _get_cached_subtitle(title: str, language: str, media_type: str) -> dict | None:
    con = _db()
    row = con.execute(
        "SELECT * FROM subtitle_cache WHERE cache_key = ?",
        (_cache_key(title, language, media_type),),
    ).fetchone()
    con.close()
    return dict(row) if row else None


def _save_cached_subtitle(
    title: str,
    language: str,
    media_type: str,
    content: str,
    subtitle_format: str,
    source: str,
) -> None:
    con = _db()
    con.execute(
        """
        INSERT OR REPLACE INTO subtitle_cache (
            cache_key, title, language, media_type, content, format, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            _cache_key(title, language, media_type),
            title,
            language,
            media_type,
            content,
            subtitle_format,
            source,
            datetime.utcnow().isoformat(),
        ),
    )
    con.commit()
    con.close()


def _fetch_json_sync(url: str, headers: dict[str, str] | None = None) -> Any:
    request = Request(url, headers=headers or {"Accept": "application/json"})
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def _fetch_json_post_sync(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str] | None = None,
) -> Any:
    merged_headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        **(headers or {}),
    }
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=merged_headers,
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def _fetch_bytes_sync(url: str, headers: dict[str, str] | None = None) -> tuple[bytes, str]:
    request = Request(url, headers=headers or {"User-Agent": "GRABIX v1.0"})
    with urlopen(request, timeout=25) as response:
        return response.read(), response.headers.get("Content-Type", "")


def _extract_subtitle_content(data: bytes, content_type: str, download_url: str) -> str:
    lowered = f"{download_url} {content_type}".lower()

    if lowered.endswith(".gz") or "gzip" in lowered:
        data = gzip.decompress(data)
        return _normalize_subtitle_content(_decode_bytes(data))

    if lowered.endswith(".zip") or "zip" in lowered or data[:2] == b"PK":
        with zipfile.ZipFile(BytesIO(data)) as archive:
            preferred = sorted(
                archive.namelist(),
                key=lambda name: (
                    0 if name.lower().endswith(".srt") else 1 if name.lower().endswith(".vtt") else 2,
                    len(name),
                ),
            )
            for name in preferred:
                if name.lower().endswith((".srt", ".vtt", ".ass", ".ssa")):
                    return _normalize_subtitle_content(_decode_bytes(archive.read(name)))
            if archive.namelist():
                return _normalize_subtitle_content(_decode_bytes(archive.read(archive.namelist()[0])))

    return _normalize_subtitle_content(_decode_bytes(data))


def _subdl_download_url(item: dict, result_item: dict | None) -> str:
    for key in ("url", "download_url", "download_link", "subtitle_link"):
        value = item.get(key)
        if value:
            return str(value)

    subtitle_id = item.get("subtitle_id") or item.get("id")
    sd_id = item.get("sd_id") or (result_item or {}).get("sd_id")
    if subtitle_id and sd_id:
        return f"https://dl.subdl.com/subtitle/{sd_id}-{subtitle_id}.zip"
    return ""


def _resolve_opensubtitles_com_download_url(file_id: int | str) -> str:
    data = _fetch_json_post_sync(
        f"{OPENSUBTITLES_COM_URL}/download",
        {"file_id": int(file_id)},
        OPENSUBTITLES_COM_HEADERS,
    )
    return str(data.get("link") or "")


async def search_subdl(title: str, language: str, media_type: str) -> list[dict]:
    if not SUBDL_API_KEY:
        return []

    codes = _language_codes(language)
    params = {
        "api_key": SUBDL_API_KEY,
        "film_name": title,
        "languages": codes["subdl"],
        "type": _media_type_value(media_type),
        "subs_per_page": 30,
    }
    url = f"{SUBDL_API_URL}?{urlencode(params)}"

    try:
        data = await asyncio.to_thread(_fetch_json_sync, url, {"Accept": "application/json"})
    except Exception:
        return []

    subtitles = list(data.get("subtitles") or [])
    result_item = (data.get("results") or [None])[0]
    normalized = []
    for item in subtitles:
        download_url = _subdl_download_url(item, result_item)
        if not download_url:
            continue
        normalized.append(
            {
                "title": item.get("release_name") or item.get("name") or title,
                "language": item.get("language") or item.get("lang") or codes["label"],
                "format": _guess_format(download_url, item.get("name", "")),
                "download_url": download_url,
                "source": "subdl",
                "cached": False,
            }
        )
    return normalized


async def search_opensubtitles_org(title: str, language: str) -> list[dict]:
    codes = _language_codes(language)
    safe_title = quote(title.replace("/", " "))
    url = f"{OPENSUBTITLES_ORG_URL}/query-{safe_title}/sublanguageid-{codes['org']}"

    try:
        data = await asyncio.to_thread(_fetch_json_sync, url, OPENSUBTITLES_ORG_HEADERS)
    except Exception:
        return []

    normalized = []
    for item in data or []:
        download_url = item.get("ZipDownloadLink") or item.get("SubDownloadLink") or ""
        if not download_url:
            continue
        normalized.append(
            {
                "title": item.get("MovieReleaseName") or item.get("SubFileName") or title,
                "language": item.get("LanguageName") or codes["label"],
                "format": item.get("SubFormat") or _guess_format(download_url, item.get("SubFileName", "")),
                "download_url": str(download_url),
                "source": "opensubtitles.org",
                "cached": False,
            }
        )
    return normalized


async def search_opensubtitles_com(title: str, language: str) -> list[dict]:
    codes = _language_codes(language)
    search_url = f"{OPENSUBTITLES_COM_URL}/subtitles?{urlencode({'query': title, 'languages': codes['com']})}"

    try:
        data = await asyncio.to_thread(_fetch_json_sync, search_url, OPENSUBTITLES_COM_HEADERS)
    except Exception:
        return []

    normalized = []
    for item in list(data.get("data") or [])[:6]:
        attributes = item.get("attributes") or {}
        files = attributes.get("files") or []
        file_id = files[0].get("file_id") if files else None
        if not file_id:
            continue

        normalized.append(
            {
                "title": attributes.get("release") or attributes.get("feature_details", {}).get("title") or title,
                "language": attributes.get("language") or codes["label"],
                "format": _guess_format(attributes.get("release", ""), attributes.get("release", "")),
                "download_url": f"{OPENSUBTITLES_COM_LINK_PREFIX}{file_id}",
                "source": "opensubtitles.com",
                "cached": False,
            }
        )
    return normalized


async def search_subtitles(title: str, language: str, media_type: str) -> list[dict]:
    cached = _get_cached_subtitle(title, language, media_type)
    if cached:
        return [
            {
                "title": cached["title"],
                "language": cached["language"],
                "format": cached["format"],
                "download_url": "",
                "source": cached["source"],
                "cached": True,
            }
        ]

    for searcher in (search_subdl, search_opensubtitles_com, search_opensubtitles_org):
        try:
            if searcher is search_subdl:
                results = await searcher(title, language, media_type)
            else:
                results = await searcher(title, language)
            if results:
                return results
        except Exception:
            continue
    return []


async def download_subtitle(url: str) -> str:
    if url.startswith(OPENSUBTITLES_COM_LINK_PREFIX):
        file_id = url.removeprefix(OPENSUBTITLES_COM_LINK_PREFIX).strip()
        if not file_id:
            raise ValueError("Missing OpenSubtitles.com file id")
        url = await asyncio.to_thread(_resolve_opensubtitles_com_download_url, file_id)
        if not url:
            raise ValueError("Could not resolve OpenSubtitles.com subtitle link")

    data, content_type = await asyncio.to_thread(_fetch_bytes_sync, url, {"User-Agent": "GRABIX v1.0"})
    return _extract_subtitle_content(data, content_type, url)


async def get_cached_subtitle_content(title: str, language: str, media_type: str) -> str | None:
    cached = _get_cached_subtitle(title, language, media_type)
    if not cached:
        return None
    return cached["content"]


async def cache_subtitle_content(
    title: str,
    language: str,
    media_type: str,
    content: str,
    subtitle_format: str,
    source: str,
) -> None:
    await asyncio.to_thread(
        _save_cached_subtitle,
        title,
        language,
        media_type,
        content,
        subtitle_format,
        source,
    )
