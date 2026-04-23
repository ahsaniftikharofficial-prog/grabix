"""
AniWatch routes — mounted at /aniwatch/ in main.py.
These are the PRIMARY anime data endpoints; Consumet/Jikan are fallbacks.
"""

from fastapi import APIRouter, Query

from app.services.aniwatch import (
    discover,
    get_genre_anime,
    get_genres,
    get_health,
    get_schedule,
    get_spotlight,
    search,
)
from app.services.aniwatch_service import get_info

router = APIRouter()


@router.get("/health")
async def aniwatch_health():
    """Health check for the local AniWatch server."""
    return await get_health()


@router.get("/info")
async def aniwatch_info(
    id: str = Query(..., min_length=1, description="HiAnime slug, AnimeKai id, KickAssAnime id, or numeric MAL/Jikan ID"),
    provider: str = Query("hianime", description="hianime|animekai|kickassanime|jikan"),
):
    """
    Get full anime info — provider-aware.

    Pass provider='animekai' or provider='kickassanime' when the search result
    came from those fallback providers (HiAnime Cloudflare-blocked). Falls back
    to Jikan cross-reference for numeric MAL IDs.
    """
    return await get_info(id, provider=provider)


@router.get("/discover")
async def aniwatch_discover(
    section: str = Query("trending", description="trending|popular|toprated|seasonal|movie|subbed|dubbed|ova|ona|tv|special|recently-updated|recently-added|top-upcoming"),
    page: int = Query(1, ge=1),
    period: str = Query("daily", description="daily|weekly|monthly — used for trending section"),
):
    """
    Discover anime. AniWatch (aniwatchtv.to) is primary; Jikan is fallback.
    Returns items with provider='hianime' so the existing watch/stream flow works.
    """
    return await discover(section=section, page=page, period=period)


@router.get("/search")
async def aniwatch_search(
    query: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
):
    """Search anime via AniWatch, fallback to Jikan."""
    return await search(query=query, page=page)


@router.get("/genres")
async def aniwatch_genres():
    """List available anime genres from AniWatch."""
    return await get_genres()


@router.get("/genre/{genre}")
async def aniwatch_genre_anime(
    genre: str,
    page: int = Query(1, ge=1),
):
    """Get anime list for a specific genre."""
    return await get_genre_anime(genre=genre, page=page)


@router.get("/schedule")
async def aniwatch_schedule(
    date: str = Query(..., description="Date in YYYY-MM-DD format"),
):
    """Get the anime airing schedule for a given date."""
    return await get_schedule(date=date)


@router.get("/spotlight")
async def aniwatch_spotlight():
    """Get hero/spotlight anime for the home section."""
    return await get_spotlight()
