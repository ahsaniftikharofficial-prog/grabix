"""
app/routes/streaming.py — FastAPI router for streaming endpoints.

Previously used route_registry as a bridge to streaming_helpers.py.
Now imports directly — no registry needed.
"""
from fastapi import APIRouter, Request

from streaming_helpers import resolve_embed, stream_proxy, stream_variants, extract_stream
import downloads.engine as _dl_engine  # ffmpeg_status lives here after extraction

router = APIRouter()


@router.get("/resolve-embed")
def resolve_embed_route(url: str):
    return resolve_embed(url)


@router.get("/stream/proxy")
@router.get("/stream/proxy/{path_hint:path}")
def stream_proxy_route(url: str, request: Request, headers_json: str = "", path_hint: str = ""):
    return stream_proxy(url, request, headers_json)


@router.get("/stream/variants")
def stream_variants_route(url: str, headers_json: str = ""):
    return stream_variants(url, headers_json)


@router.get("/ffmpeg-status")
def ffmpeg_status():
    return _dl_engine.ffmpeg_status()


@router.get("/extract-stream")
async def extract_stream_route(url: str):
    return await extract_stream(url)
