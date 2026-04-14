"""
streaming_helpers.py — FIXED (sync stream_proxy restored + httpx sync)

Root cause of backend crash:
  The previous optimized version changed stream_proxy() and stream_variants()
  to async def. But streaming.py routes call them as plain sync functions:
      def stream_proxy(url, request, headers_json=""):
          return get_route_handler("streaming", "stream_proxy")(url, request, headers_json)
  Calling an async function without await returns a coroutine object — FastAPI
  can't serialize a coroutine as a response, crashing on every proxy request.

Fix:
  stream_proxy() and stream_variants() are back to sync def.
  They now use httpx.Client (sync) instead of urllib.request.urlopen — still
  better than the original (connection pooling, timeout handling, redirect
  following) but compatible with the sync route wrappers.

  extract_stream() stays async def (its route IS async def extract_stream).
  Pre-compiled regex constants kept from the optimized version.
"""

from __future__ import annotations

import json
import logging
import re
import subprocess
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
_NETWORK_METHODS  = frozenset({"Network.requestWillBeSent", "Network.responseReceived"})


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


# ── Deferred-main wrappers ────────────────────────────────────────────────────

def _resolve_embed_target(url: str, max_depth: int = 3) -> str:
    import main as _m  # deferred to avoid circular import

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
# Route in streaming.py is `def stream_proxy(...)` (not async) — must stay sync.
# httpx.Client is still better than urlopen: connection pooling, proper redirects,
# clean timeout API.

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

    # Add headers that CDNs (bunny.net, MegaCloud) require or strongly prefer.
    # Without Accept/Accept-Encoding many CDNs return 403 or serve wrong content.
    request_headers.setdefault("Accept", "*/*")
    request_headers.setdefault("Accept-Encoding", "gzip, deflate, br")
    request_headers.setdefault("Accept-Language", "en-US,en;q=0.9")
    request_headers.setdefault("Sec-Fetch-Mode", "cors")
    request_headers.setdefault("Sec-Fetch-Site", "cross-site")
    # Force fresh response from CDN — prevents 304 "Not Modified" which
    # causes HLS.js to hang waiting for a cached playlist it doesn't have.
    request_headers["Cache-Control"] = "no-cache"
    request_headers["Pragma"] = "no-cache"

    range_header = request.headers.get("range")
    if range_header:
        request_headers["Range"] = range_header

    try:
        with httpx.Client(timeout=20.0, follow_redirects=True) as client:
            upstream = client.get(url, headers=request_headers)
    except Exception as exc:
        # Raise 502 — hls.js will treat this as a fatal network error and
        # immediately call goToNextSource() instead of retrying for 120 seconds.
        raise HTTPException(status_code=502, detail=f"Stream proxy failed: {exc}") from exc

    # Fail fast on CDN errors: raise an HTTP exception so hls.js gets a proper
    # error status and triggers its fatal-error handler immediately, rather than
    # silently retrying for the entire 120-second startup window.
    if upstream.status_code not in (200, 206):
        # Always return 502 (not the upstream code) so HLS.js treats it as a
        # fatal network error and immediately tries the next source, rather
        # than misinterpreting e.g. 304 as a cached-content response and hanging.
        raise HTTPException(
            status_code=502,
            detail=f"CDN returned {upstream.status_code} for proxied resource",
        )

    media_type = upstream.headers.get("content-type", "application/octet-stream")
    final_url   = str(upstream.url)
    lowered_url = final_url.lower()
    lowered_media = media_type.lower()

    # Content sniffing: some CDNs return application/octet-stream even for m3u8
    # playlists, and after redirects the final URL may not contain ".m3u8".
    # Check the actual body prefix — a valid HLS playlist always starts with
    # "#EXTM3U" (possibly after a UTF-8 BOM).
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
    # MPEG-TS segments start with 0x47 sync byte
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


# ── Browser-based stream extractor (unchanged) ────────────────────────────────

def _extract_stream_url_via_browser(url: str) -> tuple[str, str] | None:
    """
    Browser-based stream extraction has been removed.
    Selenium/Edge is unreliable and not worth the dependency.
    Returns None so callers fall through to the next strategy.
    """
    return None


async def extract_stream(url: str):
    import main as _m  # deferred

    safe_url = _m._validate_outbound_url(url)
    cached   = _m.stream_extract_cache.get(safe_url)
    if cached and cached[0] > time.time():
        return cached[1]
    try:
        direct_url, kind = _extract_stream_url(safe_url)
        payload = {"url": direct_url, "quality": "Auto", "format": kind}
        _m.stream_extract_cache[safe_url] = (
            time.time() + _m.STREAM_EXTRACT_CACHE_TTL_SECONDS,
            payload,
        )
        return payload
    except subprocess.TimeoutExpired:
        ytdlp_error = "Stream extraction timed out"
    except Exception as exc:
        ytdlp_error = str(exc) or "No stream found"

    browser_result = _extract_stream_url_via_browser(safe_url)
    if browser_result:
        direct_url, kind = browser_result
        _m.log_event(
            _m.playback_logger,
            logging.INFO,
            event="extract_stream_browser_fallback",
            message="Browser fallback resolved a stream.",
            details={"url": safe_url[:180], "format": kind},
        )
        payload = {"url": direct_url, "quality": "Auto", "format": kind}
        _m.stream_extract_cache[safe_url] = (
            time.time() + _m.STREAM_EXTRACT_CACHE_TTL_SECONDS,
            payload,
        )
        return payload

    _m.log_event(
        _m.playback_logger,
        logging.ERROR,
        event="extract_stream_failed",
        message="Stream extraction failed.",
        details={"url": safe_url[:180], "error": ytdlp_error},
    )
    raise HTTPException(status_code=422, detail=ytdlp_error)
