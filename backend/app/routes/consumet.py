from fastapi import APIRouter, Query, Response

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


@router.get("/health")
async def consumet_health():
    return await get_health_status()


@router.get("/discover/anime")
async def consumet_discover_anime(
    section: str = Query("trending"),
    page: int = Query(1, ge=1),
):
    return await discover_anime(section=section, page=page)


@router.get("/discover/manga")
async def consumet_discover_manga(
    section: str = Query("trending"),
    page: int = Query(1, ge=1),
):
    return await discover_manga(section=section, page=page)


@router.get("/search/{domain}")
async def consumet_search(
    domain: str,
    query: str = Query(..., min_length=1),
    provider: str = Query("zoro"),
    page: int = Query(1, ge=1),
):
    return await search_domain(domain=domain, query=query, provider=provider, page=page)


@router.get("/info/{domain}")
async def consumet_info(
    domain: str,
    id: str = Query(..., min_length=1),
    provider: str = Query("zoro"),
):
    return await fetch_domain_info(domain=domain, provider=provider, media_id=id)


@router.get("/episodes/anime")
async def consumet_anime_episodes(
    id: str = Query(..., min_length=1),
    provider: str = Query("zoro"),
):
    return await fetch_anime_episodes(provider=provider, media_id=id)


@router.get("/chapters/manga")
async def consumet_manga_chapters(
    id: str = Query(..., min_length=1),
    provider: str = Query("mangadex"),
):
    return await fetch_manga_chapters(provider=provider, media_id=id)


@router.get("/watch/anime")
async def consumet_watch_anime(
    episode_id: str = Query(..., min_length=1),
    provider: str = Query("zoro"),
    server: str | None = Query(None),
    audio: str = Query("hi"),
):
    return await fetch_anime_watch(
        provider=provider,
        episode_id=episode_id,
        server=server,
        audio=audio,
    )


@router.get("/read/manga")
async def consumet_read_manga(
    chapter_id: str = Query(..., min_length=1),
    provider: str = Query("mangadex"),
):
    return await fetch_manga_read(provider=provider, chapter_id=chapter_id)


@router.get("/read/{domain}")
async def consumet_read_generic(
    domain: str,
    id: str = Query(..., min_length=1),
    provider: str = Query("libgen"),
):
    return await fetch_generic_read(domain=domain, provider=provider, item_id=id)


@router.get("/news/feed")
async def consumet_news_feed(
    topic: str | None = Query(None),
):
    return await fetch_news_feed(topic=topic)


@router.get("/news/article")
async def consumet_news_article(
    id: str = Query(..., min_length=1),
):
    return await fetch_news_article(article_id=id)


@router.get("/meta/search")
async def consumet_meta_search(
    query: str = Query(..., min_length=1),
    type: str = Query("movie"),
):
    return await fetch_meta_search(query=query, media_type=type)


@router.get("/meta/info")
async def consumet_meta_info(
    id: str = Query(..., min_length=1),
    type: str = Query("movie"),
):
    return await fetch_meta_info(item_id=id, media_type=type)


@router.get("/proxy")
async def consumet_proxy(
    url: str = Query(..., min_length=8),
):
    content, media_type = await fetch_proxy_response(url)
    return Response(content=content, media_type=media_type or "application/octet-stream")
