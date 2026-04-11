import logging

from fastapi import APIRouter, Query, Response
from fastapi.responses import JSONResponse

from app.services.consumet import (
    fetch_anime_episodes,
    fetch_anime_watch,
    fetch_domain_info,
    fetch_generic_read,
    fetch_manga_chapters,
    fetch_manga_read,
    fetch_meta_info,
    fetch_meta_search,
    fetch_news_article,
    fetch_news_feed,
    fetch_proxy_response,
    get_health_status,
    search_domain,
    discover_anime,
    discover_manga,
)

router = APIRouter()
logger = logging.getLogger("consumet.routes")


@router.get("/health")
async def consumet_health():
    try:
        return await get_health_status()
    except Exception as exc:
        logger.error("consumet_health failed: %s", exc)
        return JSONResponse(status_code=503, content={"healthy": False, "message": str(exc)})


@router.get("/discover/anime")
async def consumet_discover_anime(
    section: str = Query("trending"),
    page: int = Query(1, ge=1),
    period: str = Query("daily"),
):
    try:
        return await discover_anime(section=section, page=page, period=period)
    except Exception as exc:
        logger.error("consumet_discover_anime failed: %s", exc)
        return JSONResponse(status_code=502, content={"results": [], "error": str(exc)})


@router.get("/discover/manga")
async def consumet_discover_manga(
    section: str = Query("trending"),
    page: int = Query(1, ge=1),
):
    try:
        return await discover_manga(section=section, page=page)
    except Exception as exc:
        logger.error("consumet_discover_manga failed: %s", exc)
        return JSONResponse(status_code=502, content={"results": [], "error": str(exc)})


@router.get("/search/{domain}")
async def consumet_search(
    domain: str,
    query: str = Query(..., min_length=1),
    provider: str = Query("zoro"),
    page: int = Query(1, ge=1),
):
    try:
        return await search_domain(domain=domain, query=query, provider=provider, page=page)
    except Exception as exc:
        logger.error("consumet_search failed: %s", exc)
        return JSONResponse(status_code=502, content={"results": [], "error": str(exc)})


@router.get("/info/{domain}")
async def consumet_info(
    domain: str,
    id: str = Query(..., min_length=1),
    provider: str = Query("zoro"),
):
    try:
        return await fetch_domain_info(domain=domain, provider=provider, media_id=id)
    except Exception as exc:
        logger.error("consumet_info failed: %s", exc)
        return JSONResponse(status_code=502, content={"error": str(exc)})


@router.get("/episodes/anime")
async def consumet_anime_episodes(
    id: str = Query(..., min_length=1),
    provider: str = Query("zoro"),
):
    try:
        return await fetch_anime_episodes(provider=provider, media_id=id)
    except Exception as exc:
        logger.error("consumet_anime_episodes failed: %s", exc)
        return JSONResponse(status_code=502, content={"items": [], "error": str(exc)})


@router.get("/chapters/manga")
async def consumet_manga_chapters(
    id: str = Query(..., min_length=1),
    provider: str = Query("mangadex"),
):
    try:
        return await fetch_manga_chapters(provider=provider, media_id=id)
    except Exception as exc:
        logger.error("consumet_manga_chapters failed: %s", exc)
        return JSONResponse(status_code=502, content={"items": [], "error": str(exc)})


@router.get("/watch/anime")
async def consumet_watch_anime(
    episode_id: str = Query(..., min_length=1),
    provider: str = Query("zoro"),
    server: str | None = Query(None),
    audio: str = Query("hi"),
):
    try:
        return await fetch_anime_watch(
            provider=provider,
            episode_id=episode_id,
            server=server,
            audio=audio,
        )
    except Exception as exc:
        logger.error("consumet_watch_anime failed: %s", exc)
        return JSONResponse(
            status_code=502,
            content={"sources": [], "subtitles": [], "error": str(exc)},
        )


@router.get("/read/manga")
async def consumet_read_manga(
    chapter_id: str = Query(..., min_length=1),
    provider: str = Query("mangadex"),
):
    try:
        return await fetch_manga_read(provider=provider, chapter_id=chapter_id)
    except Exception as exc:
        logger.error("consumet_read_manga failed: %s", exc)
        return JSONResponse(status_code=502, content={"pages": [], "error": str(exc)})


@router.get("/read/{domain}")
async def consumet_read_generic(
    domain: str,
    id: str = Query(..., min_length=1),
    provider: str = Query("libgen"),
):
    try:
        return await fetch_generic_read(domain=domain, provider=provider, item_id=id)
    except Exception as exc:
        logger.error("consumet_read_generic failed: %s", exc)
        return JSONResponse(status_code=502, content={"error": str(exc)})


@router.get("/news/feed")
async def consumet_news_feed(
    topic: str | None = Query(None),
):
    try:
        return await fetch_news_feed(topic=topic)
    except Exception as exc:
        logger.error("consumet_news_feed failed: %s", exc)
        return JSONResponse(status_code=502, content={"items": [], "error": str(exc)})


@router.get("/news/article")
async def consumet_news_article(
    id: str = Query(..., min_length=1),
):
    try:
        return await fetch_news_article(article_id=id)
    except Exception as exc:
        logger.error("consumet_news_article failed: %s", exc)
        return JSONResponse(status_code=502, content={"error": str(exc)})


@router.get("/meta/search")
async def consumet_meta_search(
    query: str = Query(..., min_length=1),
    type: str = Query("movie"),
):
    try:
        return await fetch_meta_search(query=query, media_type=type)
    except Exception as exc:
        logger.error("consumet_meta_search failed: %s", exc)
        return JSONResponse(status_code=502, content={"results": [], "error": str(exc)})


@router.get("/meta/info")
async def consumet_meta_info(
    id: str = Query(..., min_length=1),
    type: str = Query("movie"),
):
    try:
        return await fetch_meta_info(item_id=id, media_type=type)
    except Exception as exc:
        logger.error("consumet_meta_info failed: %s", exc)
        return JSONResponse(status_code=502, content={"error": str(exc)})


@router.get("/proxy")
async def consumet_proxy(
    url: str = Query(..., min_length=8),
):
    """Proxy external CDN images/resources through the backend to avoid CORS issues.

    Returns a 502 JSON response (with CORS headers intact) instead of crashing
    the server when the upstream CDN is unreachable, which would otherwise strip
    the Access-Control-Allow-Origin header before it reaches the browser.
    """
    try:
        content, media_type = await fetch_proxy_response(url)
        return Response(content=content, media_type=media_type or "application/octet-stream")
    except Exception as exc:
        logger.warning("consumet_proxy failed for url=%s: %s", url[:120], exc)
        return JSONResponse(
            status_code=502,
            content={"error": "Proxy fetch failed", "detail": str(exc)},
        )
