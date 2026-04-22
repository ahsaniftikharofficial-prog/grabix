from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.services.manga_anilist import (
    get_manga_by_id,
    get_popular_manga,
    get_manga_recommendations,
    get_seasonal_manga,
    get_top_rated_manga,
    get_trending_manga,
    search_manga as anilist_search_manga,
)
from app.services.manga_jikan import (
    get_manga_by_mal_id,
    get_manga_by_query,
    get_related_manga,
)
from app.services.manga_mangadex import (
    get_chapter_list,
    get_chapter_pages,
    get_manga_details as get_mangadex_manga_details,
    search_manga as mangadex_search_manga,
)
from app.services.manga_comick import (
    get_best_match as get_comick_best_match,
    get_chapter_list as get_comick_chapter_list,
    get_chapter_pages as get_comick_chapter_pages,
    get_frontpage as get_comick_frontpage,
    search_manga as comick_search_manga,
)
from app.services.logging_utils import get_logger

router = APIRouter()
logger = get_logger("manga")
ALLOWED_MANGA_IMAGE_HOST_TOKENS = (
    "mangadex",
    "comick",
    "manga",
    "mangago",
    "mangaread",
    "mangataro",
    "weebdex",
    "atsu",
)


async def _pick_best_mangadex_match(title: str, items: list[dict]) -> dict | None:
    lowered = title.strip().lower()
    for item in items:
        if item.get("title", "").strip().lower() == lowered:
            try:
                chapters = await get_chapter_list(item["mangadex_id"], "en")
                if chapters:
                    return item
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                logger.warning("MangaDex exact-match chapter probe failed for '%s': %s", item.get("title"), exc)
                return item

    for item in items[:5]:
        try:
            chapters = await get_chapter_list(item["mangadex_id"], "en")
            if chapters:
                return item
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            logger.warning("MangaDex fallback chapter probe failed for '%s': %s", item.get("title"), exc)
            continue

    return items[0] if items else None


def _is_allowed_manga_image_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False
    hostname = parsed.netloc.lower()
    return any(token in hostname for token in ALLOWED_MANGA_IMAGE_HOST_TOKENS)


@router.get("/trending")
async def manga_trending(page: int = 1):
    return {"items": await get_trending_manga(page=page)}


@router.get("/popular")
async def manga_popular(page: int = 1):
    return {"items": await get_popular_manga(page=page)}


@router.get("/top-rated")
async def manga_top_rated(page: int = 1):
    return {"items": await get_top_rated_manga(page=page)}


@router.get("/search")
async def manga_search(query: str = Query(..., min_length=1), source: str = "anilist", page: int = 1):
    if source == "mangadex":
        return {"source": "mangadex", "items": await mangadex_search_manga(query)}
    if source == "comick":
        return {"source": "comick", "items": await comick_search_manga(query)}
    return {"source": "anilist", "items": await anilist_search_manga(query, page=page)}


@router.get("/frontpage")
async def manga_frontpage(section: str = "trending", page: int = 1, limit: int = 12, days: int = 7):
    return {"source": "comick", "items": await get_comick_frontpage(section=section, page=page, limit=limit, days=days)}


@router.get("/seasonal")
async def manga_seasonal(year: int | None = None, season: str = "WINTER"):
    safe_year = year or datetime.now(timezone.utc).year
    safe_season = season.upper()
    return {"items": await get_seasonal_manga(safe_year, safe_season)}


@router.get("/recommendations/{anilist_id}")
async def manga_recommendations(anilist_id: int):
    return {"items": await get_manga_recommendations(anilist_id)}


@router.get("/{manga_id}/details")
async def manga_details(
    manga_id: str,
    source: str = Query("anilist_id"),
):
    anilist_data = None
    jikan_data = None
    mangadex_data = None

    if source == "anilist_id":
        anilist_data = await get_manga_by_id(int(manga_id))
        if not anilist_data:
            raise HTTPException(status_code=404, detail="Manga not found on AniList")
        if anilist_data.get("mal_id"):
            try:
                jikan_data = await get_manga_by_mal_id(int(anilist_data["mal_id"]))
            except (ValueError, TypeError, httpx.HTTPError) as exc:
                logger.warning("Jikan MAL lookup failed for anilist_id=%s mal_id=%s: %s", manga_id, anilist_data.get("mal_id"), exc)
                jikan_data = None
        else:
            jikan_data = await get_manga_by_query(anilist_data["title"])
        try:
            mdx_matches = await mangadex_search_manga(anilist_data["title"])
            mangadex_data = await _pick_best_mangadex_match(anilist_data["title"], mdx_matches)
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            logger.warning("MangaDex lookup failed for anilist_id=%s title=%s: %s", manga_id, anilist_data["title"], exc)
            mangadex_data = None
    elif source == "mal_id":
        jikan_data = await get_manga_by_mal_id(int(manga_id))
        if not jikan_data:
            raise HTTPException(status_code=404, detail="Manga not found on Jikan")
        try:
            mdx_matches = await mangadex_search_manga(jikan_data["title"])
            mangadex_data = await _pick_best_mangadex_match(jikan_data["title"], mdx_matches)
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            logger.warning("MangaDex lookup failed for mal_id=%s title=%s: %s", manga_id, jikan_data["title"], exc)
            mangadex_data = None
    elif source == "mangadex_id":
        mangadex_data = await get_mangadex_manga_details(manga_id)
        if not mangadex_data:
            raise HTTPException(status_code=404, detail="Manga not found on MangaDex")
        try:
            jikan_data = await get_manga_by_query(mangadex_data["title"])
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            logger.warning("Jikan search failed for mangadex_id=%s title=%s: %s", manga_id, mangadex_data["title"], exc)
            jikan_data = None
    else:
        raise HTTPException(status_code=400, detail="Invalid detail source")

    related = []
    if jikan_data and jikan_data.get("mal_id"):
        try:
            related = await get_related_manga(int(jikan_data["mal_id"]))
        except (ValueError, TypeError, httpx.HTTPError) as exc:
            logger.warning("Related manga lookup failed for mal_id=%s: %s", jikan_data.get("mal_id"), exc)
            related = []

    chapter_count = 0
    if mangadex_data and mangadex_data.get("mangadex_id"):
        try:
            chapter_count = len(await get_chapter_list(mangadex_data["mangadex_id"], "en"))
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            logger.warning("Chapter count lookup failed for mangadex_id=%s: %s", mangadex_data.get("mangadex_id"), exc)
            chapter_count = 0

    comick_match = None
    try:
        title = (
            (anilist_data or {}).get("title")
            or (jikan_data or {}).get("title")
            or (mangadex_data or {}).get("title")
            or ""
        )
        if title:
            comick_match = await get_comick_best_match(title)
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        logger.warning("Comick match lookup failed for manga_id=%s title=%s: %s", manga_id, title, exc)
        comick_match = None

    return {
        "anilist": anilist_data,
        "jikan": jikan_data,
        "mangadex": mangadex_data,
        "comick": comick_match,
        "related": related,
        "chapter_count": chapter_count,
    }


@router.get("/comick/chapters")
async def manga_comick_chapters(title: str = Query(..., min_length=1)):
    data = await get_comick_chapter_list(title)
    return {
        "match": data.get("match"),
        "items": data.get("items") or [],
        "total": data.get("total") or 0,
    }


@router.get("/comick/pages")
async def manga_comick_pages(url: str = Query(..., min_length=1)):
    try:
        return {"pages": await get_comick_chapter_pages(url)}
    except (httpx.HTTPError, ValueError) as exc:
        logger.error("Comick page fetch failed for url=%s: %s", url, exc)
        raise HTTPException(status_code=502, detail={"error_code": "MANGA_COMICK_PAGE_FETCH_FAILED", "message": str(exc)}) from exc


@router.get("/{mangadex_id}/chapters")
async def manga_chapters(mangadex_id: str, language: str = "en"):
    try:
        return {"items": await get_chapter_list(mangadex_id, language=language)}
    except (httpx.HTTPError, ValueError) as exc:
        logger.error("MangaDex chapter fetch failed for mangadex_id=%s language=%s: %s", mangadex_id, language, exc)
        raise HTTPException(status_code=502, detail={"error_code": "MANGADEX_CHAPTER_FETCH_FAILED", "message": str(exc)}) from exc


@router.get("/chapter/{chapter_id}/pages")
async def manga_pages(chapter_id: str):
    try:
        return {"pages": await get_chapter_pages(chapter_id)}
    except (httpx.HTTPError, ValueError) as exc:
        logger.error("MangaDex page fetch failed for chapter_id=%s: %s", chapter_id, exc)
        raise HTTPException(status_code=502, detail={"error_code": "MANGADEX_PAGE_FETCH_FAILED", "message": str(exc)}) from exc


@router.get("/image-proxy")
async def manga_image_proxy(url: str = Query(..., min_length=1)):
    if not _is_allowed_manga_image_url(url):
      raise HTTPException(status_code=400, detail="Blocked manga image host")

    try:
        async with httpx.AsyncClient(
            timeout=25.0,
            follow_redirects=True,
            headers={"User-Agent": "GRABIX/1.0", "Referer": "https://mangadex.org/"},
        ) as client:
            upstream = await client.get(url)
            upstream.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not load manga page image: {exc}") from exc

    media_type = upstream.headers.get("content-type", "image/jpeg")
    return Response(
        content=upstream.content,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )
