from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.route_registry import get_route_handler

router = APIRouter()


class DownloadRequest(BaseModel):
    url: str = Field(..., min_length=8, max_length=2000)
    title: str = Field("", max_length=180)
    thumbnail: str = Field("", max_length=2000)
    dl_type: str = Field("video", max_length=40)
    quality: str = Field("best", max_length=40)
    audio_format: str = Field("mp3", max_length=20)
    audio_quality: str = Field("192", max_length=20)
    subtitle_lang: str = Field("en", max_length=12)
    thumbnail_format: str = Field("jpg", max_length=12)
    trim_start: float = 0
    trim_end: float = 0
    trim_enabled: bool = False
    use_cpu: bool = True
    headers_json: str = Field("", max_length=4000)
    force_hls: bool = False
    category: str = Field("", max_length=80)
    tags_csv: str = Field("", max_length=400)
    download_engine: str = Field("", max_length=20)


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
    start_download_handler = get_route_handler("downloads", "start_download")
    return start_download_handler(
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
    start_download_handler = get_route_handler("downloads", "start_download")
    return start_download_handler(
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
    return get_route_handler("downloads", "download_status")(dl_id)


@router.get("/progress/{dl_id}")
def progress_alias(dl_id: str):
    return get_route_handler("downloads", "progress_alias")(dl_id)


@router.get("/downloads")
def list_downloads():
    return get_route_handler("downloads", "list_downloads")()


@router.post("/open-download-folder")
def open_download_folder(path: str = ""):
    return get_route_handler("downloads", "open_download_folder")(path)


@router.post("/open-local-file")
def open_local_file(path: str):
    return get_route_handler("downloads", "open_local_file")(path)


@router.post("/downloads/{dl_id}/action")
def download_action(dl_id: str, action: str):
    return get_route_handler("downloads", "download_action")(dl_id, action)


@router.delete("/downloads/{dl_id}")
def delete_download(dl_id: str):
    return get_route_handler("downloads", "delete_download")(dl_id)


@router.post("/downloads/stop-all")
def stop_all_downloads():
    return get_route_handler("downloads", "stop_all_downloads")()


@router.get("/runtime/dependencies")
def get_runtime_dependencies():
    return get_route_handler("downloads", "get_runtime_dependencies")()


@router.post("/runtime/dependencies/install")
def install_runtime_dependency(dep_id: str):
    return get_route_handler("downloads", "install_runtime_dependency")(dep_id)
