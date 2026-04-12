from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.services.settings_service import (
    configure_adult_content_password,
    get_settings_payload,
    unlock_adult_content_password,
    update_settings_payload,
)
from db_helpers import DEFAULT_SETTINGS, load_settings, save_settings_to_disk
from app.services.runtime_config import default_download_dir


class AdultContentUnlockRequest(BaseModel):
    password: str


class AdultContentConfigureRequest(BaseModel):
    password: str


class TmdbTokenRequest(BaseModel):
    token: str


router = APIRouter()


@router.get("/settings")
def get_settings():
    return get_settings_payload(default_settings=DEFAULT_SETTINGS, load_settings=load_settings)


@router.post("/settings")
def update_settings(data: dict):
    return update_settings_payload(
        data,
        default_settings=DEFAULT_SETTINGS,
        load_settings=load_settings,
        save_settings_to_disk=save_settings_to_disk,
        default_download_dir=str(default_download_dir()),
    )


# NOTE: These endpoints intentionally do NOT use the /settings prefix.
# The /settings prefix triggers desktop-auth middleware which blocks
# requests in browser/dev mode. TMDB token is not sensitive — it's a
# public read-access token that only fetches movie metadata.

@router.get("/tmdb-status")
def tmdb_status():
    """Returns whether a TMDB bearer token is currently configured."""
    from app.services.runtime_config import has_tmdb_token, tmdb_config_source
    return {
        "configured": has_tmdb_token(),
        "source": tmdb_config_source(),
    }


@router.post("/tmdb-token")
def save_tmdb_token(data: TmdbTokenRequest):
    """
    Save (or clear) the TMDB bearer token in runtime-config.json.
    Pass an empty string to remove the token.
    """
    import json
    from app.services.runtime_config import (
        runtime_config_path,
        reset_runtime_config_caches,
        has_tmdb_token,
    )

    token = data.token.strip()
    path = runtime_config_path()

    # Load existing config file (if it exists)
    try:
        existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except Exception:
        existing = {}

    # Set or remove the token
    if token:
        existing["tmdb_bearer_token"] = token
    else:
        existing.pop("tmdb_bearer_token", None)

    # Write back
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")

    # Clear the lru_cache so the new token is picked up immediately (no restart needed)
    reset_runtime_config_caches()

    return {
        "ok": True,
        "configured": has_tmdb_token(),
    }


@router.post("/settings/adult-content/configure")
def configure_adult_content(data: AdultContentConfigureRequest):
    return configure_adult_content_password(
        data.password,
        load_settings=load_settings,
        save_settings_to_disk=save_settings_to_disk,
    )


@router.post("/settings/adult-content/unlock")
def unlock_adult_content(data: AdultContentUnlockRequest, request: Request):
    return unlock_adult_content_password(
        data.password,
        request,
        load_settings=load_settings,
    )
