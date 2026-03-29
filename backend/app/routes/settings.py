import sys
from importlib import import_module

from fastapi import APIRouter, Request
from pydantic import BaseModel


class AdultContentUnlockRequest(BaseModel):
    password: str


class AdultContentConfigureRequest(BaseModel):
    password: str

router = APIRouter()


def _main_module():
    main_module = sys.modules.get("main") or sys.modules.get("__main__") or sys.modules.get("backend.main")
    if main_module is not None:
        return main_module
    try:
        return import_module("main")
    except ModuleNotFoundError:
        return import_module("backend.main")


@router.get("/settings")
def get_settings():
    main_module = _main_module()
    return main_module.get_settings()


@router.post("/settings")
def update_settings(data: dict):
    main_module = _main_module()
    return main_module.update_settings(data)


@router.post("/settings/adult-content/configure")
def configure_adult_content(data: AdultContentConfigureRequest):
    main_module = _main_module()
    return main_module.configure_adult_content(data)


@router.post("/settings/adult-content/unlock")
def unlock_adult_content(data: AdultContentUnlockRequest, request: Request):
    main_module = _main_module()
    return main_module.unlock_adult_content(data, request)
