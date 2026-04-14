"""
megacloud.py — Pure-Python MegaCloud stream extractor.

MegaCloud (used by HiAnime's VidCloud/VidStreaming servers) changed their API
in April 2026 and the aniwatch npm package (v2.27.9, last updated March 2026)
is now broken. This module re-implements the extraction entirely in Python so
we're no longer blocked by the outdated npm package.

Flow:
  1. HiAnime AJAX → get server list → get embed URL for VidCloud/VidStreaming
  2. MegaCloud embed page → scrape client key (_k) from player JS
  3. MegaCloud getSources → get encrypted sources blob + server key
  4. Decrypt with our ported columnar-cipher / keygen2 algorithm
  5. Return {sources, subtitles}
"""

import asyncio
import json
import math
import re
from typing import Optional
from urllib.parse import urlparse, parse_qs, quote

import httpx

# ── Key health cache ──────────────────────────────────────────────────────────
# Stores the last verified working client key and when it was verified.
# Populated by the background worker before anyone presses play.
import threading
import time as _time

_key_lock = threading.Lock()

_key_health: dict = {
    "key": None,          # str | None — the last verified working key
    "verified_at": 0.0,   # float — unix timestamp of last successful verification
    "ttl": 1200.0,        # float — how long (seconds) a verified key stays trusted (20 min)
}


def get_cached_client_key() -> str | None:
    """Return the cached verified key if it is still fresh, else None."""
    with _key_lock:
        entry = _key_health
        if entry["key"] and (_time.time() - entry["verified_at"]) < entry["ttl"]:
            return entry["key"]
    return None


def set_cached_client_key(key: str) -> None:
    """Store a verified working key with current timestamp."""
    with _key_lock:
        _key_health["key"] = key
        _key_health["verified_at"] = _time.time()


_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

HIANIME_BASE = "https://aniwatchtv.to"
AJAX_BASE = f"{HIANIME_BASE}/ajax/v2"

# ── Decryption (ported from aniwatch server.cjs) ─────────────────────────────

def _columnar_cipher(text: str, key: str) -> str:
    cols = len(key)
    rows = math.ceil(len(text) / cols)
    order = sorted(
        [{"char": c, "index": i} for i, c in enumerate(key)],
        key=lambda x: (x["char"], x["index"]),
    )
    col_lengths = [len(text) // cols] * cols
    remainder = len(text) % cols
    for i in range(remainder):
        col_lengths[order[i]["index"]] += 1

    grid = [[""] * cols for _ in range(rows)]
    cursor = 0
    for item in order:
        col_idx = item["index"]
        length = col_lengths[col_idx]
        for row in range(length):
            grid[row][col_idx] = text[cursor] if cursor < len(text) else ""
            cursor += 1

    result = ""
    for row in range(rows):
        for col in range(cols):
            if grid[row][col]:
                result += grid[row][col]
    return result


def _seed_shuffle(char_array: list, input_key: str) -> list:
    hash_val = 0
    for c in input_key:
        hash_val = (hash_val * 31 + ord(c)) & 0xFFFFFFFF

    shuffle_num = hash_val

    def pseudo_rand(n: int) -> int:
        nonlocal shuffle_num
        shuffle_num = (shuffle_num * 1103515245 + 12345) & 0x7FFFFFFF
        return shuffle_num % n

    shuffled = list(char_array)
    i = len(shuffled) - 1
    while i > 0:
        rand = pseudo_rand(i + 1)
        shuffled[i], shuffled[rand] = shuffled[rand], shuffled[i]
        i -= 1
    return shuffled


def _keygen2(megacloud_key: str, client_key: str) -> str:
    MULT = 31
    XOR_VAL = 247
    SHIFT_VAL = 5
    temp_key = megacloud_key + client_key
    hash_val = 0
    for c in temp_key:
        hash_val = ord(c) + hash_val * MULT + (hash_val << 7) - hash_val
    hash_val = abs(hash_val) % 0x7FFFFFFFFFFFFFFF
    limited = hash_val

    temp_key = "".join(chr(ord(c) ^ XOR_VAL) for c in temp_key)
    pivot = (limited % len(temp_key)) + SHIFT_VAL
    temp_key = temp_key[pivot:] + temp_key[:pivot]
    reversed_client = client_key[::-1]

    output = ""
    max_len = max(len(temp_key), len(reversed_client))
    for i in range(max_len):
        t = temp_key[i] if i < len(temp_key) else ""
        r = reversed_client[i] if i < len(reversed_client) else ""
        output += t + r

    target_len = 96 + (limited % 33)
    output = output[:target_len]
    return "".join(chr((ord(c) % 95) + 32) for c in output)


def _decrypt_megacloud_sources(src: str, client_key: str, megacloud_key: str) -> str:
    import base64 as _b64
    decrypted = _b64.b64decode(src).decode("utf-8")
    char_array = [chr(32 + i) for i in range(95)]
    generated_key = _keygen2(megacloud_key, client_key)

    for layer in range(3, 0, -1):
        layer_key = f"{generated_key}{layer}"
        lhash = 0
        for c in layer_key:
            lhash = (lhash * 31 + ord(c)) & 0xFFFFFFFF
        seed = lhash

        def seed_rand(n: int) -> int:
            nonlocal seed
            seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
            return seed % n

        # Reverse substitution
        decrypted = "".join(
            char_array[(char_array.index(c) - seed_rand(95) + 95) % 95]
            if c in char_array else c
            for c in decrypted
        )
        # Reverse columnar cipher
        decrypted = _columnar_cipher(decrypted, layer_key)
        # Reverse shuffle substitution
        shuffled = _seed_shuffle(char_array, layer_key)
        char_map = {shuffled[i]: char_array[i] for i in range(len(char_array))}
        decrypted = "".join(char_map.get(c, c) for c in decrypted)

    data_length = int(decrypted[:4])
    return decrypted[4: 4 + data_length]


# ── Client key scraping ───────────────────────────────────────────────────────

_KEY_PATTERNS = [
    re.compile(r'_k\s*[:=]\s*["\x60\'"]([A-Za-z0-9]{20,})["\x60\'"]'),
    re.compile(r'clientKey\s*[:=]\s*["\x60\'"]([A-Za-z0-9]{20,})["\x60\'"]'),
    re.compile(r'"_k"\s*:\s*"([A-Za-z0-9]{20,})"'),
    re.compile(r'\bkey\s*[:=]\s*["\x60\'"]([A-Za-z0-9]{30,})["\x60\'"]'),
    re.compile(r'[?&]_k=([A-Za-z0-9]{20,})'),
]


def _find_keys_in(content: str) -> list:
    found = set()
    for pat in _KEY_PATTERNS:
        for m in pat.finditer(content):
            k = m.group(1)
            if 20 <= len(k) <= 120:
                found.add(k)
    return list(found)


async def _scrape_client_key(
    client: httpx.AsyncClient,
    embed_page_url: str,
    domain: str,
    referer: str,
) -> Optional[str]:
    page_headers = {
        "User-Agent": _UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": referer,
        "sec-fetch-dest": "iframe",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "cross-site",
    }
    try:
        r = await client.get(embed_page_url, headers=page_headers, timeout=12.0)
        html = r.text

        # 1. Inline HTML
        keys = _find_keys_in(html)
        if keys:
            return keys[0]

        # 2. Fetch player JS bundles
        SKIP = ["jquery", "bootstrap", "fontawesome", "googleapis", "cloudflare",
                "gtag", "analytics", "recaptcha", "sentry"]
        src_urls = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html, re.IGNORECASE)
        js_headers = {
            "User-Agent": _UA,
            "Accept": "*/*",
            "Referer": embed_page_url,
        }
        for src in src_urls[:6]:  # limit to first 6 scripts
            if any(s in src for s in SKIP):
                continue
            full = src if src.startswith("http") else f"https://{domain}{src if src.startswith('/') else '/' + src}"
            try:
                jr = await client.get(full, headers=js_headers, timeout=8.0)
                js_keys = _find_keys_in(jr.text)
                if js_keys:
                    return js_keys[0]
            except Exception:
                continue
    except Exception:
        pass
    return None


# ── Known fallback keys (update these when MegaCloud rotates) ─────────────────

_FALLBACK_KEYS = [
    "3AlttPAF1Zwn2l63meMeGMIvlWOXgm9ZXNk3glEzLTGOr1F113",
    "nTAygRRNLS3wo82OtMyfPrWgD9K2UIvcwlj",
]

_REMOTE_KEY_URLS = [
    "https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json",
    "https://raw.githubusercontent.com/consumet/rapidcloudKeys/refs/heads/main/keys.json",
]

async def _get_remote_keys(client: httpx.AsyncClient) -> list:
    for url in _REMOTE_KEY_URLS:
        try:
            r = await client.get(url, timeout=5.0)
            d = r.json()
            keys = [d.get("rabbit"), d.get("mega"), d.get("vidstr")]
            keys = [k for k in keys if k and len(k) > 10]
            if keys:
                return keys
        except Exception:
            continue
    return []


# ── HiAnime AJAX helpers ──────────────────────────────────────────────────────

async def _get_episode_embed_url(
    client: httpx.AsyncClient,
    episode_id: str,  # e.g. "kusunokis-garden-of-gods-20704?ep=169759"
    server_id: str = "1",  # 1=VidCloud, 4=VidStreaming, 6=T-Cloud
    category: str = "sub",
) -> Optional[str]:
    ep_number = episode_id.split("?ep=")[-1] if "?ep=" in episode_id else ""
    if not ep_number:
        return None

    watch_url = f"{HIANIME_BASE}/watch/{episode_id}"
    ajax_headers = {
        "User-Agent": _UA,
        "Referer": watch_url,
        "X-Requested-With": "XMLHttpRequest",
    }

    # Step 1: get server list
    try:
        r = await client.get(
            f"{AJAX_BASE}/episode/servers?episodeId={ep_number}",
            headers=ajax_headers,
            timeout=12.0,
        )
        payload = r.json() if isinstance(r.json(), dict) else json.loads(r.text)
    except Exception:
        return None

    # Parse HTML to find the server entry
    html = payload.get("html", "")
    pattern = re.compile(
        rf'data-type="{category}"[^>]*data-server-id="{server_id}"[^>]*data-id="([^"]+)"'
        r'|data-id="([^"]+)"[^>]*data-type="{cat}"[^>]*data-server-id="{sid}"'.format(
            cat=category, sid=server_id
        )
    )
    # Simpler approach: find data-id where type and server-id match
    pat2 = re.compile(
        r'class="server-item[^"]*"[^>]*data-type="' + re.escape(category) +
        r'"[^>]*data-server-id="' + re.escape(server_id) +
        r'"[^>]*data-id="([^"]+)"'
    )
    m = pat2.search(html)
    if not m:
        # Try reversed attribute order
        pat3 = re.compile(r'data-id="([^"]+)"[^>]*data-server-id="' + re.escape(server_id) + r'"[^>]*data-type="' + re.escape(category) + r'"')
        m = pat3.search(html)
    if not m:
        return None
    source_id = m.group(1)

    # Step 2: get embed URL
    try:
        r2 = await client.get(
            f"{AJAX_BASE}/episode/sources?id={quote(source_id, safe='')}",
            headers=ajax_headers,
            timeout=12.0,
        )
        data = r2.json() if isinstance(r2.json(), dict) else json.loads(r2.text)
        return data.get("link", "")
    except Exception:
        return None


# ── Main extraction entry point ───────────────────────────────────────────────

def _build_result(data: dict, embed_url: str) -> dict:
    raw = data.get("sources") or []
    if isinstance(raw, str):
        return {}
    sources = [
        {
            "url": s.get("file") or s.get("url", ""),
            "isM3U8": s.get("type") == "hls" or ".m3u8" in str(s.get("file", s.get("url", ""))),
            "type": s.get("type", "hls"),
            "quality": s.get("label") or s.get("quality", "Auto"),
        }
        for s in raw
        if s.get("file") or s.get("url")
    ]
    subtitles = [
        {"url": t.get("file", ""), "lang": t.get("label", t.get("kind", "sub")), "default": bool(t.get("default"))}
        for t in (data.get("tracks") or [])
        if t.get("kind") in ("captions", "subtitles")
    ]
    parsed = urlparse(embed_url)
    return {
        "headers": {"Referer": f"{parsed.scheme}://{parsed.hostname}/"},
        "sources": sources,
        "subtitles": subtitles,
        "download": data.get("download", ""),
    }


async def extract_hianime_stream(
    episode_id: str,
    category: str = "sub",
    referer: str = HIANIME_BASE + "/",
) -> dict:
    """
    Extract a playable HLS stream for a HiAnime episode directly in Python.
    Tries VidCloud (serverId=1) then VidStreaming (serverId=4).
    Returns {"sources": [...], "subtitles": [...], "headers": {...}} or raises.
    """
    async with httpx.AsyncClient(
        timeout=20.0,
        follow_redirects=True,
        headers={"User-Agent": _UA},
    ) as client:
        remote_keys_task = asyncio.create_task(_get_remote_keys(client))

        servers_to_try = [("1", "VidCloud"), ("4", "VidStreaming")]
        # Also try the other category as final fallback
        categories_to_try = [category, "dub" if category == "sub" else "sub"]

        for cat in categories_to_try:
            for server_id, server_label in servers_to_try:
                embed_url = await _get_episode_embed_url(client, episode_id, server_id, cat)
                if not embed_url:
                    continue

                parsed = urlparse(embed_url)
                domain = parsed.hostname or "megacloud.tv"
                path_parts = [p for p in parsed.path.split("/") if p]
                source_id = path_parts[-1] if path_parts else ""
                qs = parse_qs(parsed.query)
                k_param = qs.get("k", ["1"])[0]

                if not source_id:
                    continue

                embed_page_url = f"https://{domain}/embed-2/v3/e-1/{source_id}?k={k_param}"
                get_sources_base = f"https://{domain}/embed-2/v3/e-1/getSources?id={source_id}"

                common_headers = {
                    "User-Agent": _UA,
                    "X-Requested-With": "XMLHttpRequest",
                    "Accept": "application/json, text/plain, */*",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Origin": f"https://{domain}",
                    "Referer": embed_page_url,
                }

                # Concurrently scrape client key + fetch remote keys
                client_key_task = asyncio.create_task(
                    _scrape_client_key(client, embed_page_url, domain, referer)
                )

                # Try WITHOUT _k first (sometimes returns unencrypted)
                try:
                    r = await client.get(get_sources_base, headers=common_headers, timeout=12.0)
                    data = r.json()

                    if not data.get("encrypted") and isinstance(data.get("sources"), list) and data["sources"]:
                        client_key_task.cancel()
                        return _build_result(data, embed_url)
                except Exception:
                    pass

                # Need a client key — wait for scrape result
                scraped_key = await client_key_task
                remote_keys = await remote_keys_task
                remote_keys_task = asyncio.create_task(asyncio.sleep(0))  # mark done

                cached_key = get_cached_client_key()
                key_candidates = list(dict.fromkeys(
                    ([cached_key] if cached_key else [])
                    + ([scraped_key] if scraped_key else [])
                    + remote_keys
                    + _FALLBACK_KEYS
                ))

                for key in key_candidates:
                    try:
                        r2 = await client.get(
                            f"{get_sources_base}&_k={quote(key, safe='')}",
                            headers={**common_headers, "Referer": referer},
                            timeout=12.0,
                        )
                        data2 = r2.json()

                        if not data2.get("encrypted") and isinstance(data2.get("sources"), list) and data2["sources"]:
                            set_cached_client_key(key)
                            return _build_result(data2, embed_url)

                        if data2.get("encrypted") and isinstance(data2.get("sources"), str):
                            megacloud_key = data2.get("key", "")
                            try:
                                raw = _decrypt_megacloud_sources(data2["sources"], key, megacloud_key)
                                sources = json.loads(raw)
                                if sources:
                                    data2["sources"] = sources
                                    set_cached_client_key(key)
                                    return _build_result(data2, embed_url)
                            except Exception:
                                continue
                    except Exception:
                        continue

        raise RuntimeError(
            f"Python MegaCloud extractor: all server/key combinations failed for episode '{episode_id}'"
        )


# ── Background key health worker ──────────────────────────────────────────────

async def run_key_health_worker(interval_seconds: float = 1200.0) -> None:
    """
    Background coroutine. Runs forever while the app is alive.
    Every `interval_seconds` (default 20 min) it:
      1. Checks if the cached key is still fresh.
      2. If not, probes MegaCloud with a known test episode to find a working key.
      3. Stores the verified key in the cache.

    Should be started once at application startup via asyncio.create_task().
    Errors are caught and logged — this worker must never crash the app.
    """
    import asyncio
    import logging

    logger = logging.getLogger("megacloud.key_worker")

    # A known stable HiAnime episode ID used only for key verification probes.
    # One Piece episode 1 — always available, always on VidCloud.
    TEST_EPISODE_ID = "one-piece-100?ep=2142"

    async def _probe_key(key: str, client: httpx.AsyncClient, embed_url: str, source_id: str) -> bool:
        """Returns True if this key produces valid decrypted sources."""
        parsed = urlparse(embed_url)
        domain = parsed.hostname or "megacloud.tv"
        embed_page_url = f"https://{domain}/embed-2/v3/e-1/{source_id}?k=1"
        get_sources_url = f"https://{domain}/embed-2/v3/e-1/getSources?id={source_id}"
        headers = {
            "User-Agent": _UA,
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/plain, */*",
            "Origin": f"https://{domain}",
            "Referer": embed_page_url,
        }
        try:
            r = await client.get(
                f"{get_sources_url}&_k={quote(key, safe='')}",
                headers=headers,
                timeout=10.0,
            )
            data = r.json()
            # Unencrypted sources — key accepted
            if not data.get("encrypted") and isinstance(data.get("sources"), list) and data["sources"]:
                return True
            # Encrypted — try decryption
            if data.get("encrypted") and isinstance(data.get("sources"), str):
                megacloud_key = data.get("key", "")
                try:
                    raw = _decrypt_megacloud_sources(data["sources"], key, megacloud_key)
                    sources = json.loads(raw)
                    return bool(sources)
                except Exception:
                    return False
        except Exception:
            return False
        return False

    logger.info("MegaCloud key health worker started.")

    while True:
        try:
            # Sleep first — on startup the main stream path will already populate
            # the cache naturally on first play. Worker's job is to keep it fresh.
            await asyncio.sleep(interval_seconds)

            # Skip probe if cache is still fresh
            cached = get_cached_client_key()
            if cached:
                logger.debug("Key health worker: cached key still valid, skipping probe.")
                continue

            logger.info("Key health worker: cache stale, probing MegaCloud...")

            async with httpx.AsyncClient(
                timeout=20.0,
                follow_redirects=True,
                headers={"User-Agent": _UA},
            ) as client:
                # Step 1: Get embed URL for the test episode
                embed_url = await _get_episode_embed_url(client, TEST_EPISODE_ID, "1", "sub")
                if not embed_url:
                    logger.warning("Key health worker: could not get embed URL for test episode.")
                    continue

                parsed = urlparse(embed_url)
                path_parts = [p for p in parsed.path.split("/") if p]
                source_id = path_parts[-1] if path_parts else ""
                if not source_id:
                    continue

                embed_page_url = f"https://{parsed.hostname}/embed-2/v3/e-1/{source_id}?k=1"

                # Step 2: Try to find a working key
                scraped_key = await _scrape_client_key(client, embed_page_url, parsed.hostname or "megacloud.tv", HIANIME_BASE + "/")
                remote_keys = await _get_remote_keys(client)

                candidates = list(dict.fromkeys(
                    ([scraped_key] if scraped_key else []) + remote_keys + _FALLBACK_KEYS
                ))

                for key in candidates:
                    if await _probe_key(key, client, embed_url, source_id):
                        set_cached_client_key(key)
                        logger.info("Key health worker: found and cached a working key.")
                        break
                else:
                    logger.warning("Key health worker: no working key found in this cycle.")

        except asyncio.CancelledError:
            logger.info("Key health worker: cancelled, shutting down.")
            return
        except Exception as exc:
            logger.error("Key health worker error (will retry next cycle): %s", exc)
            await asyncio.sleep(60.0)  # Back off on unexpected errors
