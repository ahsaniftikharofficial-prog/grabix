from fastapi import APIRouter, Query, Response
from app.services.request_guard import clean_optional_text, clean_text, require_choice

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
    period: str = Query("daily"),
):
    section = require_choice(section, field="section", allowed=("trending", "popular", "toprated", "seasonal", "movie"))
    period = require_choice(period, field="period", allowed=("daily", "weekly", "monthly"))
    return await discover_anime(section=section, page=page, period=period)


@router.get("/discover/manga")
async def consumet_discover_manga(
    section: str = Query("trending"),
    page: int = Query(1, ge=1),
):
    section = require_choice(section, field="section", allowed=("trending", "seasonal", "hot"))
    return await discover_manga(section=section, page=page)


@router.get("/search/{domain}")
async def consumet_search(
    domain: str,
    query: str = Query(..., min_length=1),
    provider: str = Query("zoro"),
    page: int = Query(1, ge=1),
):
    domain = require_choice(domain, field="domain", allowed=("anime", "manga", "books", "comics", "light-novels"))
    query = clean_text(query, field="query", max_length=120)
    provider = clean_text(provider, field="provider", max_length=40)
    return await search_domain(domain=domain, query=query, provider=provider, page=page)


@router.get("/info/{domain}")
async def consumet_info(
    domain: str,
    id: str = Query(..., min_length=1),
    provider: str = Query("zoro"),
):
    domain = clean_text(domain, field="domain", max_length=40)
    id = clean_text(id, field="id", max_length=180)
    provider = clean_text(provider, field="provider", max_length=40)
    return await fetch_domain_info(domain=domain, provider=provider, media_id=id)


@router.get("/episodes/anime")
async def consumet_anime_episodes(
    id: str = Query(..., min_length=1),
    provider: str = Query("zoro"),
):
    id = clean_text(id, field="id", max_length=180)
    provider = clean_text(provider, field="provider", max_length=40)
    return await fetch_anime_episodes(provider=provider, media_id=id)


@router.get("/chapters/manga")
async def consumet_manga_chapters(
    id: str = Query(..., min_length=1),
    provider: str = Query("mangadex"),
):
    id = clean_text(id, field="id", max_length=180)
    provider = clean_text(provider, field="provider", max_length=40)
    return await fetch_manga_chapters(provider=provider, media_id=id)


@router.get("/watch/anime")
async def consumet_watch_anime(
    episode_id: str = Query(..., min_length=1),
    provider: str = Query("zoro"),
    server: str | None = Query(None),
    audio: str = Query("hi"),
):
    episode_id = clean_text(episode_id, field="episode_id", max_length=180)
    provider = clean_text(provider, field="provider", max_length=40)
    server = clean_optional_text(server, field="server", max_length=40) or None
    audio = require_choice(audio, field="audio", allowed=("hi", "en", "original", "dub", "sub"))
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
    chapter_id = clean_text(chapter_id, field="chapter_id", max_length=180)
    provider = clean_text(provider, field="provider", max_length=40)
    return await fetch_manga_read(provider=provider, chapter_id=chapter_id)


@router.get("/read/{domain}")
async def consumet_read_generic(
    domain: str,
    id: str = Query(..., min_length=1),
    provider: str = Query("libgen"),
):
    domain = clean_text(domain, field="domain", max_length=40)
    id = clean_text(id, field="id", max_length=180)
    provider = clean_text(provider, field="provider", max_length=40)
    return await fetch_generic_read(domain=domain, provider=provider, item_id=id)


@router.get("/news/feed")
async def consumet_news_feed(
    topic: str | None = Query(None),
):
    topic = clean_optional_text(topic, field="topic", max_length=60) or None
    return await fetch_news_feed(topic=topic)


@router.get("/news/article")
async def consumet_news_article(
    id: str = Query(..., min_length=1),
):
    id = clean_text(id, field="id", max_length=120)
    return await fetch_news_article(article_id=id)


@router.get("/meta/search")
async def consumet_meta_search(
    query: str = Query(..., min_length=1),
    type: str = Query("movie"),
):
    query = clean_text(query, field="query", max_length=120)
    type = require_choice(type, field="type", allowed=("movie", "tv", "anime"))
    return await fetch_meta_search(query=query, media_type=type)


@router.get("/meta/info")
async def consumet_meta_info(
    id: str = Query(..., min_length=1),
    type: str = Query("movie"),
):
    id = clean_text(id, field="id", max_length=120)
    type = require_choice(type, field="type", allowed=("movie", "tv", "anime"))
    return await fetch_meta_info(item_id=id, media_type=type)


@router.get("/proxy")
async def consumet_proxy(
    url: str = Query(..., min_length=8),
):
    url = clean_text(url, field="url", max_length=2000)
    content, media_type = await fetch_proxy_response(url)
    return Response(content=content, media_type=media_type or "application/octet-stream")
