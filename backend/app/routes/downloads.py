from importlib import import_module

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


def _main_module():
    try:
        return import_module("main")
    except ModuleNotFoundError:
        return import_module("backend.main")


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
):
    main_module = _main_module()
    return main_module.start_download(
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
    )


@router.post("/download")
def start_download_post(payload: DownloadRequest):
    main_module = _main_module()
    return main_module.start_download(
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
    )


@router.get("/download-status/{dl_id}")
def download_status(dl_id: str):
    main_module = _main_module()
    return main_module.download_status(dl_id)


@router.get("/progress/{dl_id}")
def progress_alias(dl_id: str):
    main_module = _main_module()
    return main_module.progress_alias(dl_id)


@router.get("/downloads")
def list_downloads():
    main_module = _main_module()
    return main_module.list_downloads()


@router.post("/open-download-folder")
def open_download_folder(path: str = ""):
    main_module = _main_module()
    return main_module.open_download_folder(path)


@router.post("/downloads/{dl_id}/action")
def download_action(dl_id: str, action: str):
    main_module = _main_module()
    return main_module.download_action(dl_id, action)


@router.delete("/downloads/{dl_id}")
def delete_download(dl_id: str):
    main_module = _main_module()
    return main_module.delete_download(dl_id)


@router.post("/downloads/stop-all")
def stop_all_downloads():
    main_module = _main_module()
    return main_module.stop_all_downloads()
