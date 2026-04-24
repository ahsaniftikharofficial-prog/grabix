from fastapi import APIRouter, Query

from app.services.tmdb import (
    discover_media,
    fetch_details,
    fetch_tv_season,
    fetch_tv_season_map,
    search_media,
    fetch_genres,
    discover_by_genre,
    fetch_recommendations,
    fetch_credits,
    fetch_videos,
    fetch_now_playing,
    fetch_upcoming,
    fetch_airing_today,
    fetch_watch_providers,
)
from app.services.imdb import fetch_imdb_chart

router = APIRouter()


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
    return {"id": id, "seasons": await fetch_tv_season_map(tv_id=id)}


@router.get("/imdb/chart")
async def imdb_chart(chart: str = Query(..., min_length=1)):
    return await fetch_imdb_chart(chart_name=chart)


# ── New Netflix-style endpoints ───────────────────────────────────────────────

@router.get("/tmdb/genres")
async def tmdb_genres(media_type: str = Query("movie")):
    return await fetch_genres(media_type=media_type)


@router.get("/tmdb/discover-genre")
async def tmdb_discover_genre(
    media_type: str = Query("movie"),
    genre_id: int = Query(..., ge=1),
    page: int = Query(1, ge=1),
    sort_by: str = Query("popularity.desc"),
    year: int = Query(None),
    min_rating: float = Query(None),
):
    return await discover_by_genre(
        media_type=media_type,
        genre_id=genre_id,
        page=page,
        sort_by=sort_by,
        year=year,
        min_rating=min_rating,
    )


@router.get("/tmdb/recommendations")
async def tmdb_recommendations(
    media_type: str = Query("movie"),
    id: int = Query(..., ge=1),
    page: int = Query(1, ge=1),
):
    return await fetch_recommendations(media_type=media_type, item_id=id, page=page)


@router.get("/tmdb/credits")
async def tmdb_credits(
    media_type: str = Query("movie"),
    id: int = Query(..., ge=1),
):
    return await fetch_credits(media_type=media_type, item_id=id)


@router.get("/tmdb/videos")
async def tmdb_videos(
    media_type: str = Query("movie"),
    id: int = Query(..., ge=1),
):
    return await fetch_videos(media_type=media_type, item_id=id)


@router.get("/tmdb/now-playing")
async def tmdb_now_playing(page: int = Query(1, ge=1)):
    return await fetch_now_playing(page=page)


@router.get("/tmdb/upcoming")
async def tmdb_upcoming(page: int = Query(1, ge=1)):
    return await fetch_upcoming(page=page)


@router.get("/tmdb/airing-today")
async def tmdb_airing_today(page: int = Query(1, ge=1)):
    return await fetch_airing_today(page=page)


@router.get("/tmdb/watch-providers")
async def tmdb_watch_providers(
    media_type: str = Query("movie"),
    id: int = Query(..., ge=1),
    region: str = Query("US"),
):
    return await fetch_watch_providers(media_type=media_type, item_id=id, region=region)
