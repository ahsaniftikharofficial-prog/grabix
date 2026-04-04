from fastapi import APIRouter, Request

from app.services.route_registry import get_route_handler

router = APIRouter()


@router.get("/resolve-embed")
def resolve_embed(url: str):
    return get_route_handler("streaming", "resolve_embed")(url)


@router.get("/stream/proxy")
def stream_proxy(url: str, request: Request, headers_json: str = ""):
    return get_route_handler("streaming", "stream_proxy")(url, request, headers_json)


@router.get("/stream/variants")
def stream_variants(url: str, headers_json: str = ""):
    return get_route_handler("streaming", "stream_variants")(url, headers_json)


@router.get("/ffmpeg-status")
def ffmpeg_status():
    return get_route_handler("streaming", "ffmpeg_status")()


@router.get("/extract-stream")
async def extract_stream(url: str):
    return await get_route_handler("streaming", "extract_stream")(url)
