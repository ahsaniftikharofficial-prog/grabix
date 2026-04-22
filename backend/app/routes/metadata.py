from fastapi import APIRouter, Query

from app.services.tmdb import (
    discover_media,
    fetch_details,
    fetch_tv_season,
    fetch_tv_season_map,
    search_media,
)
from app.services.imdb import fetch_imdb_chart

router = APIRouter()  # no prefix — routes are /tmdb/search, /tmdb/details, etc.


@router.get("/tmdb/discover")
async def tmdb_discover(
    media_type: str = Query("movie"),
    category: str = Query("trending"),
    page: int = Query(1, ge=1),
):
    return await discover_media(media_type=media_type, category=category, page=page)


@router.get("/tmdb/search")
async def tmdb_search(
    media_type: str = Query("movie"),
    query: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
):
    return await search_media(media_type=media_type, query=query, page=page)


@router.get("/tmdb/details")
async def tmdb_details(
    media_type: str = Query("movie"),
    id: int = Query(..., ge=1),
    append_to_response: str = Query(""),
):
    return await fetch_details(media_type=media_type, item_id=id, append_to_response=append_to_response)


@router.get("/tmdb/tv-season")
async def tmdb_tv_season(
    id: int = Query(..., ge=1),
    season: int = Query(..., ge=1),
):
    return await fetch_tv_season(tv_id=id, season_number=season)


@router.get("/tmdb/tv-season-map")
async def tmdb_tv_season_map(
    id: int = Query(..., ge=1),
):
    return {
        "id": id,
        "seasons": await fetch_tv_season_map(tv_id=id),
    }


@router.get("/imdb/chart")
async def imdb_chart(
    chart: str = Query(..., min_length=1),
):
    return await fetch_imdb_chart(chart_name=chart)
