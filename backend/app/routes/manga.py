from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

from app.services.manga_anilist import (
    get_manga_by_id,
    get_manga_recommendations,
    get_seasonal_manga,
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

router = APIRouter()


async def _pick_best_mangadex_match(title: str, items: list[dict]) -> dict | None:
    lowered = title.strip().lower()
    for item in items:
        if item.get("title", "").strip().lower() == lowered:
            try:
                chapters = await get_chapter_list(item["mangadex_id"], "en")
                if chapters:
                    return item
            except Exception:
                return item

    for item in items[:5]:
        try:
            chapters = await get_chapter_list(item["mangadex_id"], "en")
            if chapters:
                return item
        except Exception:
            continue

    return items[0] if items else None


@router.get("/trending")
async def manga_trending(page: int = 1):
    return {"items": await get_trending_manga(page=page)}


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
    safe_year = year or datetime.utcnow().year
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
            except Exception:
                jikan_data = None
        else:
            jikan_data = await get_manga_by_query(anilist_data["title"])
        try:
            mdx_matches = await mangadex_search_manga(anilist_data["title"])
            mangadex_data = await _pick_best_mangadex_match(anilist_data["title"], mdx_matches)
        except Exception:
            mangadex_data = None
    elif source == "mal_id":
        jikan_data = await get_manga_by_mal_id(int(manga_id))
        if not jikan_data:
            raise HTTPException(status_code=404, detail="Manga not found on Jikan")
        try:
            mdx_matches = await mangadex_search_manga(jikan_data["title"])
            mangadex_data = await _pick_best_mangadex_match(jikan_data["title"], mdx_matches)
        except Exception:
            mangadex_data = None
    elif source == "mangadex_id":
        mangadex_data = await get_mangadex_manga_details(manga_id)
        if not mangadex_data:
            raise HTTPException(status_code=404, detail="Manga not found on MangaDex")
        try:
            jikan_data = await get_manga_by_query(mangadex_data["title"])
        except Exception:
            jikan_data = None
    else:
        raise HTTPException(status_code=400, detail="Invalid detail source")

    related = []
    if jikan_data and jikan_data.get("mal_id"):
        try:
            related = await get_related_manga(int(jikan_data["mal_id"]))
        except Exception:
            related = []

    chapter_count = 0
    if mangadex_data and mangadex_data.get("mangadex_id"):
        try:
            chapter_count = len(await get_chapter_list(mangadex_data["mangadex_id"], "en"))
        except Exception:
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
    except Exception:
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
    return {"pages": await get_comick_chapter_pages(url)}


@router.get("/{mangadex_id}/chapters")
async def manga_chapters(mangadex_id: str, language: str = "en"):
    return {"items": await get_chapter_list(mangadex_id, language=language)}


@router.get("/chapter/{chapter_id}/pages")
async def manga_pages(chapter_id: str):
    return {"pages": await get_chapter_pages(chapter_id)}
