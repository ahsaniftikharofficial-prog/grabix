from fastapi import APIRouter, Query
from app.services.request_guard import clean_optional_text, clean_text, require_choice

from app.services.tmdb import (
    discover_media,
    fetch_details,
    fetch_tv_season,
    fetch_tv_season_map,
    search_media,
)

router = APIRouter(prefix="/metadata")


@router.get("/tmdb/discover")
async def tmdb_discover(
    media_type: str = Query("movie"),
    category: str = Query("trending"),
    page: int = Query(1, ge=1),
):
    media_type = require_choice(media_type, field="media_type", allowed=("movie", "tv"))
    category = require_choice(category, field="category", allowed=("trending", "popular", "top_rated", "on_the_air"))
    return await discover_media(media_type=media_type, category=category, page=page)


@router.get("/tmdb/search")
async def tmdb_search(
    media_type: str = Query("movie"),
    query: str = Query(..., min_length=1),
    page: int = Query(1, ge=1),
):
    media_type = require_choice(media_type, field="media_type", allowed=("movie", "tv", "multi"))
    query = clean_text(query, field="query", max_length=120)
    return await search_media(media_type=media_type, query=query, page=page)


@router.get("/tmdb/details")
async def tmdb_details(
    media_type: str = Query("movie"),
    id: int = Query(..., ge=1),
    append_to_response: str = Query(""),
):
    media_type = require_choice(media_type, field="media_type", allowed=("movie", "tv"))
    append_to_response = clean_optional_text(append_to_response, field="append_to_response", max_length=80)
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
