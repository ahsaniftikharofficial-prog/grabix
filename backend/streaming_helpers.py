"""
streaming_helpers.py — Phase 6 Step 3
Extracted from main.py: proxy, HLS, embed-resolution, and stream-extraction helpers.

Pure utilities (no main.py deps): _extract_iframe_src, _fetch_json,
  _normalize_request_headers, _rewrite_hls_playlist, _extract_hls_variants,
  _looks_like_playable_media_url, _extract_stream_url.

Deferred-main wrappers (use `import main` inside body to avoid circular imports):
  _resolve_embed_target, resolve_embed, stream_proxy, stream_variants,
  _extract_stream_url_via_browser, extract_stream.
"""

from __future__ import annotations

import json
import logging
import re
import subprocess
import time
from urllib.parse import quote, urljoin
from urllib.request import Request as URLRequest, urlopen

from fastapi import HTTPException, Request
from fastapi.responses import Response, StreamingResponse


# ── Pure utilities ────────────────────────────────────────────────────────────

def _extract_iframe_src(html: str) -> str:
    content = html or ""
    iframe_match = re.search(r'<iframe[^>]+src=["\']([^"\']+)["\']', content, re.IGNORECASE)
    if iframe_match:
        return iframe_match.group(1).strip()
    scripted_match = re.search(r"src:\s*['\"]([^'\"]+)['\"]", content, re.IGNORECASE)
    if scripted_match:
        return scripted_match.group(1).strip()
    return ""


def _fetch_json(url: str, *, headers: dict[str, str] | None = None, timeout: int = 25) -> dict:
    request = URLRequest(url, headers=headers or {"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8", errors="ignore")
    return json.loads(raw or "{}")


def _normalize_request_headers(headers: dict[str, str] | None = None) -> dict[str, str]:
    from urllib.parse import urlparse as _urlparse
    normalized: dict[str, str] = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"}
    if headers:
        normalized.update(
            {
                str(key): str(value)
                for key, value in headers.items()
                if value is not None and str(value).strip()
            }
        )
    # Derive Origin from Referer so CDNs that check both (e.g. windytrail24.online) accept the request
    if "Referer" in normalized and "Origin" not in normalized:
        _p = _urlparse(normalized["Referer"])
        if _p.scheme and _p.netloc:
            normalized["Origin"] = f"{_p.scheme}://{_p.netloc}"
    return normalized


def _proxy_hls_resource_path(resource_url: str) -> str:
    lowered = str(resource_url or "").lower()
    if ".m3u8" in lowered or "mpegurl" in lowered:
        return "/stream/proxy/playlist.m3u8"
    if any(token in lowered for token in (".vtt", ".webvtt", ".srt")):
        return "/stream/proxy/subtitle.vtt"
    if any(token in lowered for token in (".m4s", ".cmfa", ".cmfv", ".mp4")):
        return "/stream/proxy/segment.m4s"
    if any(token in lowered for token in (".aac", ".m4a", ".mp3", ".ac3", ".ec3")):
        return "/stream/proxy/audio.aac"
    if any(token in lowered for token in (".key", ".bin")):
        return "/stream/proxy/key.bin"
    # Some anime CDNs disguise MPEG-TS segments behind image/xml-looking paths.
    if any(token in lowered for token in (".ts", ".mts", ".gif", ".png", ".jpg", ".jpeg", ".xml")):
        return "/stream/proxy/segment.ts"
    return "/stream/proxy/segment.ts"


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
                            'URI="'
                            + _proxy_hls_resource_path(urljoin(base_url, match.group(1)))
                            + '?url='
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
        proxied = f"{_proxy_hls_resource_path(absolute_url)}?url={quote(absolute_url, safe='')}{params_suffix}"
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
        variants.append(
            {
                "label": pending_label or "Auto",
                "url": urljoin(base_url, line),
                "bandwidth": str(pending_bandwidth),
            }
        )
        pending_label = ""
        pending_bandwidth = 0
    return variants


def _looks_like_playable_media_url(url: str) -> bool:
    lowered = str(url or "").lower()
    return any(
        token in lowered
        for token in (".m3u8", ".mp4", ".m4v", ".webm", ".mpd", "/master.m3u8")
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


# ── Deferred-main wrappers ────────────────────────────────────────────────────
# These functions require globals that live in main.py (SELENIUM_AVAILABLE,
# EDGE_BINARY_PATH, stream_extract_cache, …).  We import main lazily inside
# each function body so there are zero circular-import issues at module load.

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


def stream_proxy(url: str, request: Request, headers_json: str = ""):
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
            headers={"Cache-Control": "no-store"},
        )

    response_headers: dict[str, str] = {}
    for header_name in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"):
        header_value = upstream_response.headers.get(header_name)
        if header_value:
            response_headers[header_name] = header_value

    first_chunk = upstream_response.read(1024 * 64)
    sniffed_media_type = media_type or "application/octet-stream"
    if first_chunk and first_chunk[:1] == b"G":
        lowered_media = sniffed_media_type.lower()
        if (
            not lowered_media.startswith("video/")
            and not lowered_media.startswith("audio/")
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


def _extract_stream_url_via_browser(url: str) -> tuple[str, str] | None:
    import main as _m  # deferred

    _m._ensure_selenium()
    if not _m.SELENIUM_AVAILABLE or not _m.EDGE_BINARY_PATH:
        return None

    options = _m.EdgeOptions()
    options.binary_location = _m.EDGE_BINARY_PATH
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
        driver = _m.webdriver.Edge(options=options)
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
        import main as _m2  # deferred (second reference for log_event)
        _m2.log_event(
            _m2.playback_logger,
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


async def extract_stream(url: str):
    import main as _m  # deferred

    safe_url = _m._validate_outbound_url(url)
    cached = _m.stream_extract_cache.get(safe_url)
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
