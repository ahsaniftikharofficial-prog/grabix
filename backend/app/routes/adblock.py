"""
adblock.py — Ad Blocker API routes for GRABIX.

GET  /adblock/status   → current state (enabled, domain count, last updated)
POST /adblock/toggle   → enable or disable the ad blocker
POST /adblock/refresh  → force re-download of the filter list
"""
from __future__ import annotations

from fastapi import APIRouter

from db_helpers import load_settings, save_settings_to_disk
from app.services.adblock_service import get_status, force_refresh

router = APIRouter()


@router.get("/adblock/status")
def adblock_status():
    """Return current ad blocker state and filter list info."""
    settings = load_settings()
    enabled = bool(settings.get("adblock_enabled", True))
    filter_info = get_status()
    return {
        "enabled": enabled,
        **filter_info,
    }


@router.post("/adblock/toggle")
def adblock_toggle(data: dict):
    """
    Enable or disable the ad blocker.
    Body: { "enabled": true | false }
    """
    enabled = bool(data.get("enabled", True))
    settings = load_settings()
    settings["adblock_enabled"] = enabled
    save_settings_to_disk(settings)
    filter_info = get_status()
    return {
        "enabled": enabled,
        **filter_info,
    }


@router.post("/adblock/refresh")
def adblock_refresh():
    """Force a re-download of the AdGuard filter list."""
    from app.services.runtime_config import app_state_root
    try:
        from pathlib import Path
        cache_dir = Path(app_state_root()) / "adblock-cache"
    except Exception:
        cache_dir = None
    result = force_refresh(cache_dir)
    settings = load_settings()
    enabled = bool(settings.get("adblock_enabled", True))
    return {
        "enabled": enabled,
        **result,
    }
