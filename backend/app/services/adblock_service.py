"""
adblock_service.py — AdGuard DNS filter list manager for GRABIX.

Downloads the AdGuard DNS filter list (~50k domains) and caches it in memory.
Provides a fast domain-check function used by the ad-block proxy layer.
Refreshes the list once every 24 hours automatically.
"""
from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Optional
import urllib.request

logger = logging.getLogger("grabix.adblock")

# ── Constants ─────────────────────────────────────────────────────────────────

ADGUARD_FILTER_URL = (
    "https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt"
)
REFRESH_INTERVAL_SECONDS = 86400  # 24 hours
CONNECT_TIMEOUT = 10
READ_TIMEOUT = 30

# ── State ─────────────────────────────────────────────────────────────────────

_blocked_domains: set[str] = set()
_last_refreshed: float = 0.0
_refresh_lock = threading.Lock()
_initialized = False
_domain_count = 0
_last_error: Optional[str] = None


# ── Public API ────────────────────────────────────────────────────────────────

def initialize(cache_dir: Optional[Path] = None) -> None:
    """Call once at backend startup. Downloads filter list in a background thread."""
    global _initialized
    if _initialized:
        return
    _initialized = True
    thread = threading.Thread(
        target=_refresh_filter_list,
        args=(cache_dir,),
        name="adblock-init",
        daemon=True,
    )
    thread.start()


def is_ad_domain(domain: str) -> bool:
    """Return True if the domain (or any parent domain) is in the blocklist."""
    if not _blocked_domains or not domain:
        return False
    parts = domain.lower().strip().split(".")
    # Check the domain and each parent: "ad.example.com", "example.com"
    for i in range(len(parts) - 1):
        candidate = ".".join(parts[i:])
        if candidate in _blocked_domains:
            return True
    return False


def get_status() -> dict:
    """Return current adblock service status for the settings API."""
    return {
        "domain_count": _domain_count,
        "last_refreshed": _last_refreshed,
        "last_refreshed_human": (
            time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(_last_refreshed))
            if _last_refreshed
            else "Never"
        ),
        "last_error": _last_error,
        "ready": _domain_count > 0,
    }


def force_refresh(cache_dir: Optional[Path] = None) -> dict:
    """Force an immediate re-download of the filter list. Returns status."""
    _refresh_filter_list(cache_dir, force=True)
    return get_status()


# ── Internal ──────────────────────────────────────────────────────────────────

def _refresh_filter_list(
    cache_dir: Optional[Path] = None,
    force: bool = False,
) -> None:
    global _blocked_domains, _last_refreshed, _domain_count, _last_error

    with _refresh_lock:
        now = time.time()
        if not force and (now - _last_refreshed) < REFRESH_INTERVAL_SECONDS:
            return  # Still fresh

        raw: Optional[str] = None

        # Try loading from disk cache first (fast startup)
        if cache_dir:
            cache_file = cache_dir / "adblock_filter.txt"
            if cache_file.exists() and not force:
                try:
                    raw = cache_file.read_text(encoding="utf-8", errors="ignore")
                    logger.info("adblock: loaded filter list from disk cache (%d bytes)", len(raw))
                except Exception as exc:
                    logger.warning("adblock: disk cache read failed: %s", exc)

        # Download from AdGuard CDN
        if raw is None:
            logger.info("adblock: downloading filter list from %s", ADGUARD_FILTER_URL)
            try:
                req = urllib.request.Request(
                    ADGUARD_FILTER_URL,
                    headers={"User-Agent": "GRABIX-AdBlock/1.0"},
                )
                with urllib.request.urlopen(req, timeout=READ_TIMEOUT) as resp:
                    raw = resp.read().decode("utf-8", errors="ignore")
                logger.info("adblock: downloaded %d bytes", len(raw))

                # Persist to disk cache
                if cache_dir:
                    try:
                        cache_dir.mkdir(parents=True, exist_ok=True)
                        (cache_dir / "adblock_filter.txt").write_text(raw, encoding="utf-8")
                    except Exception as exc:
                        logger.warning("adblock: could not write disk cache: %s", exc)

            except Exception as exc:
                _last_error = str(exc)
                logger.error("adblock: filter list download failed: %s", exc)
                # Keep existing blocklist if we already have one
                if _domain_count > 0:
                    logger.info("adblock: keeping existing list (%d domains)", _domain_count)
                return

        # Parse the filter file — extract plain domain/hostname rules
        domains = _parse_filter(raw)
        _blocked_domains = domains
        _domain_count = len(domains)
        _last_refreshed = time.time()
        _last_error = None
        logger.info("adblock: filter list ready — %d domains loaded", _domain_count)

        # Schedule next automatic refresh
        timer = threading.Timer(REFRESH_INTERVAL_SECONDS, _refresh_filter_list, args=(cache_dir,))
        timer.daemon = True
        timer.start()


def _parse_filter(raw: str) -> set[str]:
    """
    Parse AdGuard / uBlock / hosts-style filter files.
    Extracts plain domain names from rules like:
      ||doubleclick.net^
      0.0.0.0 doubleclick.net
      127.0.0.1 ads.example.com
    """
    domains: set[str] = set()
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("!") or line.startswith("#"):
            continue

        # AdGuard/uBlock format: ||domain.tld^  or  ||domain.tld^$option,...
        if line.startswith("||"):
            domain = line[2:].split("^")[0].split("/")[0].strip()
            if _valid_domain(domain):
                domains.add(domain.lower())
            continue

        # Hosts file format: 0.0.0.0 domain  or  127.0.0.1 domain
        parts = line.split()
        if len(parts) == 2 and parts[0] in ("0.0.0.0", "127.0.0.1", "::1"):
            domain = parts[1].strip()
            if _valid_domain(domain) and domain not in ("localhost", "local", "broadcasthost"):
                domains.add(domain.lower())

    return domains


def _valid_domain(s: str) -> bool:
    """Quick sanity check — must look like a real domain name."""
    if not s or len(s) > 253 or "." not in s:
        return False
    if any(c in s for c in " \t/\\?#@"):
        return False
    return True
