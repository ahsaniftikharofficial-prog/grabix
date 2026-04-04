from fastapi import APIRouter, HTTPException, Query, Response

from app.services.logging_utils import get_logger
from app.services.request_guard import clean_text, require_choice
from app.services.subtitles import (
    cache_subtitle_content,
    download_subtitle,
    get_cached_subtitle_content,
    search_subtitles,
)

router = APIRouter()
logger = get_logger("subtitles")


@router.get("/search")
async def subtitle_search(
    title: str = Query(..., min_length=1),
    language: str = Query("en", min_length=2),
    type: str = Query("movie", min_length=2),
):
    title = clean_text(title, field="title", max_length=140)
    language = require_choice(language, field="language", allowed=("en", "ur", "ar", "hi", "fr", "es", "de"))
    type = require_choice(type, field="type", allowed=("movie", "tv", "series", "show", "anime"))
    return {
        "title": title,
        "language": language.lower(),
        "media_type": type.lower(),
        "results": await search_subtitles(title, language, type),
    }


@router.get("/cached")
async def subtitle_cached(
    title: str = Query(..., min_length=1),
    language: str = Query("en", min_length=2),
    type: str = Query("movie", min_length=2),
):
    title = clean_text(title, field="title", max_length=140)
    language = require_choice(language, field="language", allowed=("en", "ur", "ar", "hi", "fr", "es", "de"))
    type = require_choice(type, field="type", allowed=("movie", "tv", "series", "show", "anime"))
    cached = await get_cached_subtitle_content(title, language, type)
    if not cached:
        raise HTTPException(status_code=404, detail="No cached subtitle found")
    return Response(content=cached, media_type="text/plain; charset=utf-8")


@router.get("/download")
async def subtitle_download(
    url: str = Query(..., min_length=8),
    title: str = Query(..., min_length=1),
    language: str = Query("en", min_length=2),
    type: str = Query("movie", min_length=2),
    source: str = Query("manual"),
    format: str = Query("srt"),
):
    url = clean_text(url, field="url", max_length=2000)
    title = clean_text(title, field="title", max_length=140)
    language = require_choice(language, field="language", allowed=("en", "ur", "ar", "hi", "fr", "es", "de"))
    type = require_choice(type, field="type", allowed=("movie", "tv", "series", "show", "anime"))
    source = clean_text(source, field="source", max_length=40)
    format = require_choice(format, field="format", allowed=("srt", "vtt", "ass", "ssa"))
    try:
        content = await download_subtitle(url)
    except (ValueError, OSError) as exc:
        logger.error("Subtitle download failed for title=%s language=%s type=%s source=%s url=%s: %s", title, language, type, source, url, exc)
        raise HTTPException(status_code=502, detail=f"Subtitle download failed: {exc}") from exc

    await cache_subtitle_content(
        title=title,
        language=language.lower(),
        media_type=type.lower(),
        content=content,
        subtitle_format=format.lower(),
        source=source,
    )
    return Response(content=content, media_type="text/plain; charset=utf-8")
