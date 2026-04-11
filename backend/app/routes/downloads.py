import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.services.route_registry import get_route_handler

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


def _safe_handler(namespace: str, name: str, fallback=None, *args, **kwargs):
    """Call a registered route handler, returning a safe fallback on any error.

    Unhandled exceptions from route handlers can escape before Starlette's
    CORSMiddleware attaches the Access-Control-Allow-Origin header, causing
    Chrome to report a CORS error instead of the real 500.  Wrapping every
    handler call here ensures a JSON response is always returned so CORS
    middleware can annotate it correctly.
    """
    try:
        handler = get_route_handler(namespace, name)
        return handler(*args, **kwargs)
    except Exception as exc:
        logger.error("Route handler %s.%s failed: %s", namespace, name, exc, exc_info=True)
        if fallback is not None:
            return fallback
        return JSONResponse(
            status_code=500,
            content={"error": str(exc), "handler": f"{namespace}.{name}"},
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
    return _safe_handler(
        "downloads", "start_download",
        None,
        url=url,
        title=title,
        thumbnail=thumbnail,
        dl_type=dl_type,
        quality=quality,
        audio_format=audio_format,
        audio_quality=audio_quality,
        subtitle_lang=subtitle_lang,
        thumbnail_format=thumbnail_format,
        trim_start=trim_start,
        trim_end=trim_end,
        trim_enabled=trim_enabled,
        use_cpu=use_cpu,
        headers_json=headers_json,
        force_hls=force_hls,
        category=category,
        tags_csv=tags_csv,
        download_engine=download_engine,
    )


@router.post("/download")
def start_download_post(payload: DownloadRequest):
    return _safe_handler(
        "downloads", "start_download",
        None,
        url=payload.url,
        title=payload.title,
        thumbnail=payload.thumbnail,
        dl_type=payload.dl_type,
        quality=payload.quality,
        audio_format=payload.audio_format,
        audio_quality=payload.audio_quality,
        subtitle_lang=payload.subtitle_lang,
        thumbnail_format=payload.thumbnail_format,
        trim_start=payload.trim_start,
        trim_end=payload.trim_end,
        trim_enabled=payload.trim_enabled,
        use_cpu=payload.use_cpu,
        headers_json=payload.headers_json,
        force_hls=payload.force_hls,
        category=payload.category,
        tags_csv=payload.tags_csv,
        download_engine=payload.download_engine,
    )


@router.get("/download-status/{dl_id}")
def download_status(dl_id: str):
    return _safe_handler("downloads", "download_status", None, dl_id)


@router.get("/progress/{dl_id}")
def progress_alias(dl_id: str):
    return _safe_handler("downloads", "progress_alias", None, dl_id)


@router.get("/downloads")
def list_downloads():
    # Returns [] on error instead of crashing — prevents CORS-breaking 500 on
    # startup or if the downloads runtime state hasn't been initialised yet.
    return _safe_handler("downloads", "list_downloads", [])


@router.post("/open-download-folder")
def open_download_folder(path: str = ""):
    return _safe_handler("downloads", "open_download_folder", None, path)


@router.post("/open-local-file")
def open_local_file(path: str):
    return _safe_handler("downloads", "open_local_file", None, path)


@router.post("/downloads/{dl_id}/action")
def download_action(dl_id: str, action: str):
    return _safe_handler("downloads", "download_action", None, dl_id, action)


@router.delete("/downloads/{dl_id}")
def delete_download(dl_id: str):
    return _safe_handler("downloads", "delete_download", None, dl_id)


@router.post("/downloads/stop-all")
def stop_all_downloads():
    return _safe_handler("downloads", "stop_all_downloads", None)


@router.get("/runtime/dependencies")
def get_runtime_dependencies():
    return _safe_handler("downloads", "get_runtime_dependencies", {"dependencies": []})


@router.post("/runtime/dependencies/install")
def install_runtime_dependency(dep_id: str):
    return _safe_handler("downloads", "install_runtime_dependency", None, dep_id)
