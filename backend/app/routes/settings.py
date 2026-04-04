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
