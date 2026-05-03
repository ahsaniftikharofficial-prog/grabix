"""
app/routes/downloads.py — FastAPI router for download endpoints.

Previously used route_registry as an indirection layer to break a circular
import: main.py -> downloads.py -> main.py.

That circular import is now gone. downloads/engine.py is a standalone module
that main.py imports (not the other way around). All route handlers are
imported directly from downloads.engine — no registry needed.

The _safe wrapper is kept because it provides CORS-safe error responses:
unhandled exceptions that escape before Starlette's CORSMiddleware attaches
headers cause Chrome to report CORS errors instead of the real 500.
"""
import asyncio
import json
import logging
import shutil

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

import downloads.engine as _engine
from library_helpers import _build_library_index, _reconcile_library_state

router = APIRouter()
logger = logging.getLogger("downloads.routes")


class DownloadRequest(BaseModel):
    url: str
    title: str = ""
    thumbnail: str = ""
    dl_type: str = "video"
    quality: str = "best"
    audio_format: str = "mp3"
    audio_quality: str = "192"
    subtitle_lang: str = "en"
    thumbnail_format: str = "jpg"
    trim_start: float = 0
    trim_end: float = 0
    trim_enabled: bool = False
    use_cpu: bool = True
    headers_json: str = ""
    force_hls: bool = False
    category: str = ""
    tags_csv: str = ""
    download_engine: str = ""


def _safe(name: str, fallback, *args, **kwargs):
    """Call a downloads.engine function, returning a safe fallback on error."""
    try:
        fn = getattr(_engine, name)
        return fn(*args, **kwargs)
    except Exception as exc:
        logger.error("downloads.engine.%s failed: %s", name, exc, exc_info=True)
        if fallback is not None:
            return fallback
        return JSONResponse(
            status_code=500,
            content={"error": str(exc), "handler": f"downloads.{name}"},
        )


@router.get("/download")
def start_download(
    url: str,
    title: str = "",
    thumbnail: str = "",
    dl_type: str = "video",
    quality: str = "best",
    audio_format: str = "mp3",
    audio_quality: str = "192",
    subtitle_lang: str = "en",
    thumbnail_format: str = "jpg",
    trim_start: float = 0,
    trim_end: float = 0,
    trim_enabled: bool = False,
    use_cpu: bool = True,
    headers_json: str = "",
    force_hls: bool = False,
    category: str = "",
    tags_csv: str = "",
    download_engine: str = "",
):
    return _safe(
        "start_download", None,
        url=url, title=title, thumbnail=thumbnail, dl_type=dl_type,
        quality=quality, audio_format=audio_format, audio_quality=audio_quality,
        subtitle_lang=subtitle_lang, thumbnail_format=thumbnail_format,
        trim_start=trim_start, trim_end=trim_end, trim_enabled=trim_enabled,
        use_cpu=use_cpu, headers_json=headers_json, force_hls=force_hls,
        category=category, tags_csv=tags_csv, download_engine=download_engine,
    )


@router.post("/download")
def start_download_post(payload: DownloadRequest):
    return _safe(
        "start_download", None,
        url=payload.url, title=payload.title, thumbnail=payload.thumbnail,
        dl_type=payload.dl_type, quality=payload.quality,
        audio_format=payload.audio_format, audio_quality=payload.audio_quality,
        subtitle_lang=payload.subtitle_lang, thumbnail_format=payload.thumbnail_format,
        trim_start=payload.trim_start, trim_end=payload.trim_end,
        trim_enabled=payload.trim_enabled, use_cpu=payload.use_cpu,
        headers_json=payload.headers_json, force_hls=payload.force_hls,
        category=payload.category, tags_csv=payload.tags_csv,
        download_engine=payload.download_engine,
    )


@router.get("/download-status/{dl_id}")
def download_status(dl_id: str, response: Response):
    # Prevent WebView2 / any HTTP cache from returning a stale "queued" snapshot.
    # Without these headers, Chromium-based embedded browsers cache the first
    # response and _pollTask never sees the status transition to "downloading".
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    return _safe("download_status", None, dl_id)


@router.get("/progress/{dl_id}")
def progress_alias(dl_id: str, response: Response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    return _safe("progress_alias", None, dl_id)


@router.get("/downloads")
def list_downloads(response: Response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    return _safe("list_downloads", [])


@router.get("/downloads/stream")
async def download_progress_stream(request: Request):
    """Server-Sent Events — pushes download state changes to the frontend.
    Replaces the 1-second polling loop in DownloaderPage.tsx.
    """
    async def event_generator():
        # Send an immediate keepalive comment so the client receives headers
        # and the first bytes without waiting for a state change.
        yield ": ping\n\n"
        last_snapshot: str | None = None
        while True:
            if await request.is_disconnected():
                break
            try:
                items = _engine.list_downloads()
                snapshot_str = json.dumps(items, default=str, sort_keys=True)
                if snapshot_str != last_snapshot:
                    last_snapshot = snapshot_str
                    yield f"data: {snapshot_str}\n\n"
            except Exception as exc:
                logger.debug("SSE generator error: %s", exc)
            await asyncio.sleep(0.25)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/open-download-folder")
def open_download_folder(path: str = ""):
    return _safe("open_download_folder", None, path)


@router.post("/open-local-file")
def open_local_file(path: str):
    return _safe("open_local_file", None, path)


@router.post("/downloads/{dl_id}/action")
def download_action(dl_id: str, action: str):
    return _safe("download_action", None, dl_id, action)


@router.delete("/downloads/{dl_id}")
def delete_download(dl_id: str):
    return _safe("delete_download", None, dl_id)


@router.post("/downloads/stop-all")
def stop_all_downloads():
    return _safe("stop_all_downloads", None)


@router.get("/runtime/dependencies")
def get_runtime_dependencies():
    return _safe("get_runtime_dependencies", {"dependencies": []})


@router.post("/runtime/dependencies/install")
def install_runtime_dependency(dep_id: str):
    return _safe("install_runtime_dependency", None, dep_id)


# ── Library routes ────────────────────────────────────────────────────────────

@router.get("/library/index")
def library_index():
    try:
        return {"items": _build_library_index()}
    except Exception as exc:
        logger.error("library_index failed: %s", exc, exc_info=True)
        return JSONResponse(status_code=500, content={"error": str(exc)})


@router.post("/library/reconcile")
def library_reconcile():
    try:
        return _reconcile_library_state()
    except Exception as exc:
        logger.error("library_reconcile failed: %s", exc, exc_info=True)
        return JSONResponse(status_code=500, content={"error": str(exc)})


# ── Download engines availability ─────────────────────────────────────────────

@router.get("/download-engines")
def download_engines():
    return {
        "engines": [
            {"id": "aria2", "available": bool(shutil.which("aria2c"))},
            {"id": "yt-dlp", "available": bool(shutil.which("yt-dlp"))},
        ]
    }
