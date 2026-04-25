"""
streaming_helpers.py — FIXED

Changes from previous version:
  1. _extract_stream_url() used subprocess ["yt-dlp", "--get-url", ...]
     → returned ONE URL, no quality variants, no subtitles, slow.

  2. Now uses yt_dlp Python API directly via ytdlp_extract_full():
     → Returns ALL quality variants + subtitle URLs in one shot
     → extract_stream() now returns {url, quality, format, variants, subtitles}
     → Frontend can build a full quality picker and load subtitles automatically

  3. fast_extract() also returns variants/subtitles for API consistency.

  stream_proxy() and stream_variants() are unchanged (sync def, httpx.Client).
"""

from __future__ import annotations

import json
import logging
import re
import time
from urllib.parse import quote, urljoin
from urllib.request import Request as URLRequest, urlopen

import httpx
from fastapi import HTTPException, Request
from fastapi.responses import Response, StreamingResponse

# ── Pre-compiled patterns (compiled once at module load) ──────────────────────
_URI_RE        = re.compile(r'URI="([^"]+)"')
_IFRAME_RE     = re.compile(r'<iframe[^>]+src=["\']([^"\']+)["\']', re.IGNORECASE)
_SCRIPTED_RE   = re.compile(r"src:\s*['\"]([^'\"]+)['\"]", re.IGNORECASE)
_RESOLUTION_RE = re.compile(r"RESOLUTION=\d+x(\d+)", re.IGNORECASE)
_BANDWIDTH_RE  = re.compile(r"(?:AVERAGE-BANDWIDTH|BANDWIDTH)=(\d+)", re.IGNORECASE)

_PLAYABLE_TOKENS  = frozenset({".m3u8", ".mp4", ".m4v", ".webm", ".mpd", "/master.m3u8"})
_SUBTITLE_TOKENS  = frozenset({".vtt", ".webvtt", ".srt"})
_SEGMENT_TOKENS   = frozenset({".m4s", ".cmfa", ".cmfv", ".mp4"})
_AUDIO_TOKENS     = frozenset({".aac", ".m4a", ".mp3", ".ac3", ".ec3"})
_KEY_TOKENS       = frozenset({".key", ".bin"})


# ── Pure utilities ────────────────────────────────────────────────────────────

def _extract_iframe_src(html: str) -> str:
    content = html or ""
    m = _IFRAME_RE.search(content)
    if m:
        return m.group(1).strip()
    m = _SCRIPTED_RE.search(content)
    if m:
        return m.group(1).strip()
    return ""


def _fetch_json(url: str, *, headers: dict[str, str] | None = None, timeout: int = 25) -> dict:
    request = URLRequest(url, headers=headers or {"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8", errors="ignore")
    return json.loads(raw or "{}")


def _normalize_request_headers(headers: dict[str, str] | None = None) -> dict[str, str]:
    from urllib.parse import urlparse as _urlparse
    normalized: dict[str, str] = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
        )
    }
    if headers:
        normalized.update(
            {str(k): str(v) for k, v in headers.items() if v is not None and str(v).strip()}
        )
    if "Referer" in normalized and "Origin" not in normalized:
        _p = _urlparse(normalized["Referer"])
        if _p.scheme and _p.netloc:
            normalized["Origin"] = f"{_p.scheme}://{_p.netloc}"
    return normalized


def _proxy_hls_resource_path(resource_url: str) -> str:
    lowered = str(resource_url or "").lower()
    if ".m3u8" in lowered or "mpegurl" in lowered:
        return "/stream/proxy/playlist.m3u8"
    if any(t in lowered for t in _SUBTITLE_TOKENS):
        return "/stream/proxy/subtitle.vtt"
    if any(t in lowered for t in _SEGMENT_TOKENS):
        return "/stream/proxy/segment.m4s"
    if any(t in lowered for t in _AUDIO_TOKENS):
        return "/stream/proxy/audio.aac"
    if any(t in lowered for t in _KEY_TOKENS):
        return "/stream/proxy/key.bin"
    if any(t in lowered for t in (".ts", ".mts", ".gif", ".png", ".jpg", ".jpeg", ".xml")):
        return "/stream/proxy/segment.ts"
    return "/stream/proxy/segment.ts"


def _rewrite_hls_playlist(content: str, base_url: str, headers_json: str) -> str:
    params_suffix = f"&headers_json={quote(headers_json, safe='')}" if headers_json else ""

    def _rewrite_uri(match: re.Match) -> str:
        abs_url = urljoin(base_url, match.group(1))
        return (
            'URI="'
            + _proxy_hls_resource_path(abs_url)
            + "?url=" + quote(abs_url, safe="")
            + params_suffix + '"'
        )

    rewritten: list[str] = []
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            if 'URI="' in raw_line:
                rewritten.append(_URI_RE.sub(_rewrite_uri, raw_line))
            else:
                rewritten.append(raw_line)
            continue
        absolute_url = urljoin(base_url, line)
        proxied = (
            f"{_proxy_hls_resource_path(absolute_url)}"
            f"?url={quote(absolute_url, safe='')}{params_suffix}"
        )
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
            r = _RESOLUTION_RE.search(line)
            b = _BANDWIDTH_RE.search(line)
            height = r.group(1) if r else ""
            pending_label = f"{height}p" if height else "Auto"
            pending_bandwidth = int(b.group(1)) if b else 0
            continue
        if line.startswith("#"):
            continue
        variants.append({
            "label":     pending_label or "Auto",
            "url":       urljoin(base_url, line),
            "bandwidth": str(pending_bandwidth),
        })
        pending_label = ""
        pending_bandwidth = 0
    return variants


def _looks_like_playable_media_url(url: str) -> bool:
    lowered = str(url or "").lower()
    return any(t in lowered for t in _PLAYABLE_TOKENS)


# ── Fast HTTP stream scanner ─────────────────────────────────────────────────
# Fetches the embed page HTML and scans it for playable URLs using regex.
# Completes in 2-5 seconds. Falls back to yt-dlp only if this returns nothing.

_FAST_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r'["\']?file["\']?\s*:\s*["\']([^"\']+\.m3u8[^"\']*)["\']', re.IGNORECASE),
    re.compile(r'["\']?source["\']?\s*:\s*["\']([^"\']+\.m3u8[^"\']*)["\']', re.IGNORECASE),
    re.compile(r'["\']?hls(?:Url)?["\']?\s*:\s*["\']([^"\']+\.m3u8[^"\']*)["\']', re.IGNORECASE),
    re.compile(r'\bsrc\s*=\s*["\']([^"\']+\.m3u8[^"\']*)["\']', re.IGNORECASE),
    re.compile(r'["\']?(https?://[^"\'<>\s]+\.m3u8[^"\'<>\s]*)["\']?', re.IGNORECASE),
    re.compile(r'["\']?file["\']?\s*:\s*["\']([^"\']+\.mp4[^"\']*)["\']', re.IGNORECASE),
    re.compile(r'["\']?(https?://[^"\'<>\s]+\.mp4[^"\'<>\s]*)["\']?', re.IGNORECASE),
]

_FAST_SKIP_HOSTS: frozenset[str] = frozenset({
    "doubleclick", "googlesyndication", "googletagmanager", "adnxs",
    "juicyads", "exoclick", "trafficjunky", "propellerads", "adsterra",
    "analytics", "metrics", "tracking", "stat.", "cdn.js", "recaptcha",
})

_COMMON_HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.9",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.google.com/",
}


def _fast_scan_html(html: str) -> str | None:
    """Scan embed page HTML/JS for the first credible playable URL."""
    seen: set[str] = set()
    for pat in _FAST_PATTERNS:
        for m in pat.finditer(html):
            url = m.group(1).strip().strip("'\"")
            if not url.startswith("http"):
                continue
            if url in seen:
                continue
            seen.add(url)
            low = url.lower()
            if any(skip in low for skip in _FAST_SKIP_HOSTS):
                continue
            if ".m3u8" in low or ".mp4" in low:
                return url
    return None


def fast_extract(url: str) -> dict | None:
    """
    Try to extract a direct stream URL from an embed page in <5 seconds.
    Returns {url, quality, format, variants, subtitles} or None.
    """
    visited: set[str] = set()

    def _fetch_and_scan(target: str, depth: int = 0) -> str | None:
        if depth > 2 or target in visited:
            return None
        visited.add(target)
        try:
            with httpx.Client(
                timeout=httpx.Timeout(connect=6.0, read=8.0, write=5.0, pool=5.0),
                follow_redirects=True,
                headers={**_COMMON_HEADERS, "Referer": target},
                max_redirects=4,
            ) as client:
                resp = client.get(target)
                html = resp.text
        except Exception:
            return None

        found = _fast_scan_html(html)
        if found:
            return found

        if depth == 0:
            iframe_match = _IFRAME_RE.search(html)
            if iframe_match:
                iframe_src = iframe_match.group(1)
                if iframe_src.startswith("http"):
                    return _fetch_and_scan(iframe_src, depth + 1)
                elif iframe_src.startswith("//"):
                    return _fetch_and_scan("https:" + iframe_src, depth + 1)
        return None

    stream_url = _fetch_and_scan(url)
    if not stream_url:
        return None

    kind = "hls" if ".m3u8" in stream_url.lower() else "direct"
    return {
        "url": stream_url,
        "quality": "Auto",
        "format": kind,
        "variants": [{"quality": "Auto", "url": stream_url, "bandwidth": 0}],
        "subtitles": [],
    }


# ── yt-dlp Python API extractor ───────────────────────────────────────────────
# Uses yt_dlp as a library (not subprocess) to get ALL quality variants + subtitles.

def ytdlp_extract_full(url: str) -> dict:
    """
    Extract stream info using the yt-dlp Python API.
    Returns {url, quality, format, variants: [{quality, url, bandwidth}], subtitles: [{lang, url, format, label}]}.
    Raises RuntimeError if no stream is found.
    """
    try:
        import yt_dlp  # noqa: PLC0415
    except ImportError as exc:
        raise RuntimeError("yt_dlp is not installed") from exc

    ydl_opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "no_color": True,
        "format": "bestvideo+bestaudio/best",
        "referer": url,
        "socket_timeout": 20,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

    if not info:
        raise RuntimeError("yt-dlp returned no info for this URL")

    formats: list[dict] = info.get("formats") or []

    # ── Build quality variant list ────────────────────────────────────────────
    seen_urls: set[str] = set()
    variants: list[dict] = []

    def _add_fmt(fmt: dict, quality_label: str) -> None:
        fmt_url = fmt.get("url", "")
        if not fmt_url or fmt_url in seen_urls:
            return
        seen_urls.add(fmt_url)
        bandwidth = int((fmt.get("tbr") or fmt.get("abr") or fmt.get("vbr") or 0) * 1000)
        variants.append({"quality": quality_label, "url": fmt_url, "bandwidth": bandwidth})

    # Combined audio+video formats sorted by height descending
    av_formats = [
        f for f in formats
        if f.get("url") and f.get("height")
        and f.get("vcodec", "none") != "none"
        and f.get("acodec", "none") != "none"
    ]
    av_formats.sort(key=lambda f: f.get("height", 0), reverse=True)
    for fmt in av_formats:
        _add_fmt(fmt, f"{fmt['height']}p")

    # Fall back to any video format with height
    if not variants:
        video_fmts = [
            f for f in formats
            if f.get("url") and f.get("height") and f.get("vcodec", "none") != "none"
        ]
        video_fmts.sort(key=lambda f: f.get("height", 0), reverse=True)
        for fmt in video_fmts:
            _add_fmt(fmt, f"{fmt['height']}p")

    # Last resort: any URL from info
    if not variants:
        direct = info.get("url", "")
        if not direct:
            for fmt in reversed(formats):
                if fmt.get("url"):
                    direct = fmt["url"]
                    break
        if direct and direct not in seen_urls:
            variants.append({"quality": "Auto", "url": direct, "bandwidth": 0})

    if not variants:
        raise RuntimeError("yt-dlp found no usable stream URLs")

    # ── Build subtitle list ───────────────────────────────────────────────────
    subtitles: list[dict] = []
    sub_dict: dict = info.get("subtitles") or {}
    priority_langs = ["en", "en-US", "en-GB"]
    sorted_langs = sorted(
        sub_dict.keys(),
        key=lambda lang: (0 if lang in priority_langs else 1, lang),
    )
    for lang in sorted_langs:
        sub_formats: list[dict] = sub_dict[lang] or []
        preferred = next(
            (sf for sf in sub_formats if sf.get("ext") in ("vtt", "srt") and sf.get("url")),
            next((sf for sf in sub_formats if sf.get("url")), None),
        )
        if preferred:
            subtitles.append({
                "lang": lang,
                "url": preferred["url"],
                "format": preferred.get("ext", "vtt"),
                "label": lang.upper(),
            })

    best = variants[0]
    kind = "hls" if ".m3u8" in best["url"].lower() else "direct"

    return {
        "url": best["url"],
        "quality": best["quality"],
        "format": kind,
        "variants": variants,
        "subtitles": subtitles,
    }


# ── Deferred-main wrappers ────────────────────────────────────────────────────

def _resolve_embed_target(url: str, max_depth: int = 3) -> str:
    current = str(url or "").strip()
    if not current:
        return ""

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": current,
    }

    for _ in range(max_depth):
        req = URLRequest(current, headers=headers)
        with urlopen(req, timeout=12) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        iframe_src = _extract_iframe_src(html)
        if not iframe_src:
            return current

        next_url = urljoin(current, iframe_src)
        if next_url == current:
            return current

        if any(host in next_url for host in ("vidsrc.to", "vsembed.ru")):
            current = next_url
            continue

        return next_url

    return current


def resolve_embed(url: str):
    try:
        resolved = _resolve_embed_target(url)
        return {"url": resolved or url}
    except Exception as e:
        return {"url": url, "error": str(e)}


# ── FIXED: sync stream_proxy using httpx.Client ───────────────────────────────

def stream_proxy(url: str, request: Request, headers_json: str = ""):
    parsed_headers: dict[str, str] = {}
    if headers_json:
        try:
            decoded = json.loads(headers_json)
            if isinstance(decoded, dict):
                parsed_headers = {
                    str(k): str(v)
                    for k, v in decoded.items()
                    if v is not None and str(v).strip()
                }
        except Exception:
            parsed_headers = {}

    request_headers = _normalize_request_headers(parsed_headers)
    request_headers.setdefault("Accept", "*/*")
    request_headers.setdefault("Accept-Encoding", "gzip, deflate, br")
    request_headers.setdefault("Accept-Language", "en-US,en;q=0.9")
    request_headers.setdefault("Sec-Fetch-Mode", "cors")
    request_headers.setdefault("Sec-Fetch-Site", "cross-site")
    request_headers["Cache-Control"] = "no-cache"
    request_headers["Pragma"] = "no-cache"

    range_header = request.headers.get("range")
    if range_header:
        request_headers["Range"] = range_header

    clean_path = url.split("?")[0].lower()
    is_segment = any(
        clean_path.endswith(ext)
        for ext in (".ts", ".m4s", ".cmfa", ".cmfv", ".aac", ".m4a", ".mp4")
    )

    if is_segment:
        def _iter_segment():
            try:
                with httpx.stream(
                    "GET", url,
                    headers=request_headers,
                    follow_redirects=True,
                    timeout=httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0),
                ) as r:
                    if r.status_code not in (200, 206):
                        return
                    for chunk in r.iter_bytes(65536):
                        yield chunk
            except Exception:
                return

        return StreamingResponse(
            _iter_segment(),
            status_code=200,
            media_type="video/mp2t",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store",
            },
        )

    try:
        with httpx.Client(timeout=20.0, follow_redirects=True) as client:
            upstream = client.get(url, headers=request_headers)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Stream proxy failed: {exc}") from exc

    if upstream.status_code not in (200, 206):
        raise HTTPException(
            status_code=502,
            detail=f"CDN returned {upstream.status_code} for proxied resource",
        )

    media_type = upstream.headers.get("content-type", "application/octet-stream")
    final_url   = str(upstream.url)
    lowered_url = final_url.lower()
    lowered_media = media_type.lower()

    raw_content = upstream.content
    text_preview = raw_content[:16].lstrip(b"\xef\xbb\xbf").decode("utf-8", errors="ignore")
    is_m3u8 = (
        ".m3u8" in lowered_url
        or "mpegurl" in lowered_media
        or text_preview.startswith("#EXTM3U")
        or text_preview.startswith("#EXT")
    )

    if is_m3u8:
        text = raw_content.decode("utf-8", errors="replace")
        rewritten = _rewrite_hls_playlist(text, final_url, headers_json)
        return Response(
            content=rewritten,
            media_type="application/vnd.apple.mpegurl",
            headers={"Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"},
        )

    response_headers: dict[str, str] = {"Access-Control-Allow-Origin": "*"}
    for header_name in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"):
        header_value = upstream.headers.get(header_name.lower())
        if header_value:
            response_headers[header_name] = header_value

    sniffed_media_type = media_type or "application/octet-stream"
    if raw_content and raw_content[:1] == b"G":
        if not sniffed_media_type.lower().startswith(("video/", "audio/")):
            sniffed_media_type = "video/mp2t"
            response_headers["Content-Type"] = sniffed_media_type

    return Response(
        content=raw_content,
        status_code=200,
        headers=response_headers,
        media_type=sniffed_media_type,
    )


# ── FIXED: sync stream_variants using httpx.Client ───────────────────────────

def stream_variants(url: str, headers_json: str = ""):
    parsed_headers: dict[str, str] = {}
    if headers_json:
        try:
            decoded = json.loads(headers_json)
            if isinstance(decoded, dict):
                parsed_headers = {
                    str(k): str(v)
                    for k, v in decoded.items()
                    if v is not None and str(v).strip()
                }
        except Exception:
            parsed_headers = {}

    try:
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            response = client.get(
                url,
                headers=_normalize_request_headers(parsed_headers),
            )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Variant detection failed: {exc}") from exc

    media_type = response.headers.get("content-type", "application/octet-stream")
    final_url   = str(response.url)
    if ".m3u8" not in final_url.lower() and "mpegurl" not in media_type.lower():
        return {"variants": []}

    return {"variants": _extract_hls_variants(response.text, final_url)}


# ── Browser-based stream extractor (stub) ─────────────────────────────────────

def _extract_stream_url_via_browser(url: str) -> tuple[str, str] | None:
    """Browser-based extraction removed — unreliable. Returns None so callers fall through."""
    return None


# ── Main async extract endpoint ───────────────────────────────────────────────

async def extract_stream(url: str):
    """
    Extract a direct playable stream URL from an embed URL.

    Response shape:
      {
        url:       str,          # best/first playable URL
        quality:   str,          # e.g. "1080p" or "Auto"
        format:    "hls"|"direct",
        variants:  [{quality, url, bandwidth}],   # all quality options
        subtitles: [{lang, url, format, label}],  # subtitle tracks
      }

    Strategy:
      1. Fast HTTP regex scan (2-5 s) — works on simple embed pages
      2. yt-dlp Python API (15-30 s) — handles obfuscated/JS-heavy pages,
         returns full quality variant list and subtitles
    """
    import main as _m  # deferred to avoid circular import

    safe_url = _m._validate_outbound_url(url)
    cached   = _m.stream_extract_cache.get(safe_url)
    if cached and cached[0] > time.time():
        return cached[1]

    # ── Stage 1: Fast HTTP scanner (2-5 s, no subprocess) ────────────────────
    fast_result = fast_extract(safe_url)
    if fast_result:
        _m.stream_extract_cache[safe_url] = (
            time.time() + _m.STREAM_EXTRACT_CACHE_TTL_SECONDS,
            fast_result,
        )
        return fast_result

    # ── Stage 2: yt-dlp Python API (15-30 s, full quality list + subtitles) ──
    try:
        payload = ytdlp_extract_full(safe_url)
        _m.stream_extract_cache[safe_url] = (
            time.time() + _m.STREAM_EXTRACT_CACHE_TTL_SECONDS,
            payload,
        )
        return payload
    except Exception as exc:
        ytdlp_error = str(exc) or "yt-dlp found no stream"

    # ── Stage 3: Browser/CDP fallback (no-op stub) ───────────────────────────
    browser_result = _extract_stream_url_via_browser(safe_url)
    if browser_result:
        direct_url, kind = browser_result
        payload = {
            "url": direct_url,
            "quality": "Auto",
            "format": kind,
            "variants": [{"quality": "Auto", "url": direct_url, "bandwidth": 0}],
            "subtitles": [],
        }
        _m.stream_extract_cache[safe_url] = (
            time.time() + _m.STREAM_EXTRACT_CACHE_TTL_SECONDS,
            payload,
        )
        return payload

    _m.log_event(
        _m.playback_logger,
        logging.ERROR,
        event="extract_stream_failed",
        message="Stream extraction failed at all stages.",
        details={"url": safe_url[:180], "error": ytdlp_error},
    )
    raise HTTPException(status_code=422, detail=ytdlp_error)
