import sys
from importlib import import_module

from fastapi import APIRouter, Request

router = APIRouter()


def _main_module():
    main_module = sys.modules.get("main") or sys.modules.get("__main__") or sys.modules.get("backend.main")
    if main_module is not None:
        return main_module
    try:
        return import_module("main")
    except ModuleNotFoundError:
        return import_module("backend.main")


@router.get("/resolve-embed")
def resolve_embed(url: str):
    main_module = _main_module()
    return main_module.resolve_embed(url)


@router.get("/stream/proxy")
def stream_proxy(url: str, request: Request, headers_json: str = ""):
    main_module = _main_module()
    return main_module.stream_proxy(url, request, headers_json)


@router.get("/stream/variants")
def stream_variants(url: str, headers_json: str = ""):
    main_module = _main_module()
    return main_module.stream_variants(url, headers_json)


@router.get("/ffmpeg-status")
def ffmpeg_status():
    main_module = _main_module()
    return main_module.ffmpeg_status()


@router.get("/extract-stream")
async def extract_stream(url: str):
    main_module = _main_module()
    return await main_module.extract_stream(url)
