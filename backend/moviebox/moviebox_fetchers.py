"""
backend/moviebox/moviebox_fetchers.py — Async fetch & cache-fill logic.

No FastAPI routes here — this file only contains the async functions that
talk to moviebox_api and populate the SQLite cache.  Routes live in routes.py.

Dependency chain (no circular imports):
  moviebox_loader  →  (no moviebox deps)
  moviebox_helpers →  moviebox_loader
  moviebox_fetchers→  moviebox_loader, moviebox_helpers
  routes.py        →  all three
"""
from __future__ import annotations

import asyncio

from fastapi import HTTPException

import moviebox.moviebox_loader as _loader
from moviebox.moviebox_loader import (
    _CACHE_TTL,
    _sqlite_cache_get,
    _sqlite_cache_set,
    _cache_trigger_bg_refresh,
    _moviebox_cache_set,
    backend_logger,
)
from moviebox.moviebox_helpers import (
    _moviebox_assert_available,
    _moviebox_media_type_value,
    _moviebox_is_hindi,
    _moviebox_is_anime,
    _moviebox_release_year,
    _moviebox_match_score,
    _moviebox_card_payload,
    _moviebox_unique_items,
    _moviebox_filter_items,
    _moviebox_sort_items,
    _moviebox_pick_category,
    _moviebox_register_items,
    _moviebox_get_registered_item,
    _moviebox_supports_downloadable_detail,
    _moviebox_base_title,
    _moviebox_total_episode_count,
)


# ── Subject payload (needs detail model — lives here close to the fetchers) ───

def _moviebox_subject_payload(item, detail_model=None) -> dict:
    """Build the full subject dict from an item + optional detail model."""
    from moviebox.moviebox_helpers import (
        _moviebox_extract_season_episode_counts,
        _moviebox_guess_seasons,
    )

    detail_subject = None
    detail_dump    = None
    if detail_model is not None:
        try:
            detail_dump    = detail_model.resData.model_dump()
            detail_subject = detail_dump.get("subject", {})
        except Exception:
            detail_subject = None
            detail_dump    = None

    description = getattr(item, "description", "") or ""
    if isinstance(detail_subject, dict) and detail_subject.get("description"):
        description = detail_subject["description"]

    payload = _moviebox_card_payload(item)
    payload["description"]      = description
    payload["duration_seconds"] = getattr(item, "duration", 0) or 0

    season_episode_counts = _moviebox_extract_season_episode_counts(detail_dump or detail_model)
    payload["available_seasons"] = (
        sorted(season_episode_counts.keys()) or _moviebox_guess_seasons(payload["title"])
        if payload["moviebox_media_type"] == "series"
        else []
    )
    payload["season_episode_counts"] = season_episode_counts
    return payload


# ── Discover ──────────────────────────────────────────────────────────────────

async def moviebox_discover_payload():
    cache_key = "moviebox:discover"
    cached_value, is_stale = _sqlite_cache_get(cache_key)
    if cached_value is not None:
        if is_stale:
            _cache_trigger_bg_refresh(
                cache_key,
                lambda: _discover_fetch_and_cache(cache_key),
            )
        return cached_value
    return await _discover_fetch_and_cache(cache_key)


async def _discover_fetch_and_cache(cache_key: str):
    _moviebox_assert_available()
    session = _loader.MovieBoxSession(timeout=20)

    homepage, trending, hot, popular_searches = await asyncio.gather(
        _loader.MovieBoxHomepage(session).get_content_model(),
        _loader.MovieBoxTrending(session).get_content_model(),
        _loader.MovieBoxHotMoviesAndTVSeries(session).get_content_model(),
        _loader.MovieBoxPopularSearch(session).get_content_model(),
        return_exceptions=True,
    )
    if isinstance(homepage,         Exception): homepage         = None
    if isinstance(trending,         Exception): trending         = None
    if isinstance(hot,              Exception): hot              = None
    if isinstance(popular_searches, Exception): popular_searches = None

    categories: dict[str, list] = {}
    for category in list(getattr(homepage, "operatingList", []) or []):
        items = _moviebox_unique_items(getattr(category, "subjects", []) or [])
        if items:
            categories[str(getattr(category, "title", "") or "")] = items
            _moviebox_register_items(items)

    trending_items = _moviebox_unique_items(getattr(trending, "items", []) or [])
    hot_items      = _moviebox_unique_items(
        list(getattr(hot, "movies",    []) or []) +
        list(getattr(hot, "tv_series", []) or [])
    )
    combined = _moviebox_unique_items(
        trending_items + hot_items
        + _moviebox_pick_category(categories, ["top anime"])
        + _moviebox_pick_category(categories, ["bollywood"])
        + _moviebox_pick_category(categories, ["western", "tv"])
        + _moviebox_pick_category(categories, ["indian", "drama"])
        + _moviebox_pick_category(categories, ["hindi", "dub"])
    )
    _moviebox_register_items(trending_items)
    _moviebox_register_items(hot_items)

    def _cards(items, section): return [_moviebox_card_payload(i, section) for i in items]

    sections = [
        {"id": "recent",       "title": "Recent",       "subtitle": "Fresh titles and current releases",
         "items": _cards(_moviebox_sort_items(hot_items, "recent")[:20], "recent")},
        {"id": "most-popular", "title": "Most Popular", "subtitle": "What people are watching right now",
         "items": _cards(trending_items[:20], "most-popular")},
        {"id": "top-rated",    "title": "Top Rated",    "subtitle": "Highest IMDb-rated picks from Movie Box",
         "items": _cards(_moviebox_sort_items(combined, "rating")[:20], "top-rated")},
        {"id": "hindi",        "title": "Hindi Picks",  "subtitle": "Hindi-first titles surfaced from Movie Box",
         "items": _cards(_moviebox_filter_items(
             _moviebox_pick_category(categories, ["hindi", "dub"])
             + _moviebox_pick_category(categories, ["bollywood"])
             + _moviebox_pick_category(categories, ["punjabi"]),
             hindi_only=True)[:20], "hindi")},
        {"id": "movies",  "title": "Movies",   "subtitle": "Featured movie picks",
         "items": _cards(_moviebox_filter_items(
             _moviebox_pick_category(categories, ["hollywood"])
             + list(getattr(hot, "movies", []) or []),
             media_type="movie")[:20], "movies")},
        {"id": "series",  "title": "TV Shows", "subtitle": "Popular series and drama picks",
         "items": _cards(_moviebox_filter_items(
             _moviebox_pick_category(categories, ["western", "tv"])
             + _moviebox_pick_category(categories, ["top series"])
             + list(getattr(hot, "tv_series", []) or []),
             media_type="series")[:20], "series")},
        {"id": "anime",   "title": "Anime",    "subtitle": "Top anime on Movie Box",
         "items": _cards(_moviebox_filter_items(
             _moviebox_pick_category(categories, ["top anime"]) + combined,
             media_type="anime")[:20], "anime")},
        {"id": "other",   "title": "Other",    "subtitle": "Everything else worth exploring",
         "items": _cards([i for i in _moviebox_unique_items(
             _moviebox_pick_category(categories, ["indian", "drama"])
             + _moviebox_pick_category(categories, ["punjabi"])
             + combined
         ) if not _moviebox_is_anime(i)][:20], "other")},
    ]

    payload = {
        "sections": [s for s in sections if s["items"]],
        "popular_searches": [
            getattr(e, "title", "")
            for e in list(popular_searches or [])
            if getattr(e, "title", "")
        ][:12],
    }
    _moviebox_cache_set(cache_key, payload, ttl=_CACHE_TTL["discover"])
    return _sqlite_cache_set(cache_key, payload, "discover")


# ── Item finders ──────────────────────────────────────────────────────────────

async def moviebox_find_item(
    title: str,
    media_type: str,
    year: int | None = None,
    prefer_hindi: bool = True,
    anime_only: bool = False,
):
    _moviebox_assert_available()
    normalized = _moviebox_media_type_value(media_type)
    subject_type = _loader.MovieBoxSubjectType.ALL
    if normalized == "movie":
        subject_type = _loader.MovieBoxSubjectType.MOVIES
    elif normalized in {"series", "anime"}:
        subject_type = _loader.MovieBoxSubjectType.TV_SERIES

    session = _loader.MovieBoxSession(timeout=15)
    results = await _loader.MovieBoxSearch(
        session, query=title, subject_type=subject_type, per_page=16
    ).get_content_model()
    items = list(getattr(results, "items", []) or [])

    if prefer_hindi and "hindi" not in (title or "").lower():
        extra = await _loader.MovieBoxSearch(
            session, query=f"{title} hindi", subject_type=subject_type, per_page=16
        ).get_content_model()
        items.extend(list(getattr(extra, "items", []) or []))

    items = _moviebox_filter_items(
        _moviebox_unique_items(items),
        media_type=normalized,
        anime_only=normalized == "anime" or anime_only,
    )
    if not items:
        raise HTTPException(status_code=404, detail="Movie Box returned no matches")

    _moviebox_register_items(items)
    ranked = sorted(
        items,
        key=lambda i: _moviebox_match_score(i, title, year,
                                             prefer_hindi=prefer_hindi,
                                             anime_only=normalized == "anime" or anime_only),
        reverse=True,
    )
    return session, ranked[0]


async def moviebox_find_non_hindi_item(
    title: str,
    media_type: str,
    year: int | None = None,
    anime_only: bool = False,
):
    _moviebox_assert_available()
    normalized = _moviebox_media_type_value(media_type)
    subject_type = _loader.MovieBoxSubjectType.ALL
    if normalized == "movie":
        subject_type = _loader.MovieBoxSubjectType.MOVIES
    elif normalized in {"series", "anime"}:
        subject_type = _loader.MovieBoxSubjectType.TV_SERIES

    session = _loader.MovieBoxSession(timeout=15)
    results = await _loader.MovieBoxSearch(
        session, query=title, subject_type=subject_type, per_page=16
    ).get_content_model()
    items = [
        i for i in _moviebox_filter_items(
            _moviebox_unique_items(list(getattr(results, "items", []) or [])),
            media_type=normalized,
            anime_only=normalized == "anime" or anime_only,
        )
        if not _moviebox_is_hindi(i)
    ]
    if year is not None:
        year_matches = [i for i in items if _moviebox_release_year(i) == year]
        if year_matches:
            items = year_matches
    if not items:
        return session, None

    ranked = sorted(
        items,
        key=lambda i: _moviebox_match_score(i, title, year, prefer_hindi=False,
                                             anime_only=normalized == "anime" or anime_only),
        reverse=True,
    )
    return session, ranked[0]


async def moviebox_resolve_item(
    subject_id: str | None = None,
    title: str | None = None,
    media_type: str = "movie",
    year: int | None = None,
    require_downloadable: bool = False,
):
    registered = _moviebox_get_registered_item(subject_id)
    if registered is not None and (
        not require_downloadable or _moviebox_supports_downloadable_detail(registered)
    ):
        return _loader.MovieBoxSession(timeout=15), registered
    if not title:
        raise HTTPException(status_code=400, detail="subject_id or title is required")
    return await moviebox_find_item(title, media_type, year)


# ── Search-items fetcher ──────────────────────────────────────────────────────

async def search_items_fetch_and_cache(
    cache_key, query, safe_page, safe_per_page,
    normalized_media_type, hindi_only, anime_only, prefer_hindi, sort_by,
):
    _moviebox_assert_available()
    session = _loader.MovieBoxSession(timeout=20)
    subject_type = _loader.MovieBoxSubjectType.ALL
    if normalized_media_type == "movie":
        subject_type = _loader.MovieBoxSubjectType.MOVIES
    elif normalized_media_type in {"series", "anime"}:
        subject_type = _loader.MovieBoxSubjectType.TV_SERIES

    results = await _loader.MovieBoxSearch(
        session, query=query, subject_type=subject_type,
        page=safe_page, per_page=safe_per_page,
    ).get_content_model()
    items = list(getattr(results, "items", []) or [])

    if prefer_hindi and "hindi" not in query.lower():
        extra = await _loader.MovieBoxSearch(
            session, query=f"{query} hindi", subject_type=subject_type,
            page=1, per_page=min(24, safe_per_page),
        ).get_content_model()
        items.extend(list(getattr(extra, "items", []) or []))

    items = _moviebox_unique_items(items)
    _moviebox_register_items(items)
    items = _moviebox_filter_items(
        items, media_type=normalized_media_type,
        hindi_only=hindi_only,
        anime_only=anime_only or normalized_media_type == "anime",
    )
    ranked = sorted(
        _moviebox_sort_items(items, sort_by, query),
        key=lambda i: _moviebox_match_score(i, query, None,
                                             prefer_hindi=prefer_hindi,
                                             anime_only=anime_only or normalized_media_type == "anime"),
        reverse=True,
    )
    payload = {
        "query":      query,
        "page":       safe_page,
        "per_page":   safe_per_page,
        "media_type": normalized_media_type,
        "items":      [_moviebox_card_payload(i, "search") for i in ranked],
    }
    _moviebox_cache_set(cache_key, payload, ttl=_CACHE_TTL["search"])
    return _sqlite_cache_set(cache_key, payload, "search")


# ── Details fetcher ───────────────────────────────────────────────────────────

async def details_fetch_and_cache(cache_key, subject_id, title, normalized_media_type, year):
    session, item = await moviebox_resolve_item(subject_id, title, normalized_media_type, year)

    detail_model = None
    try:
        if normalized_media_type == "movie":
            detail_model = await _loader.MovieBoxMovieDetails(item, session).get_content_model()
        else:
            detail_model = await _loader.MovieBoxTVSeriesDetails(item, session).get_content_model()
    except Exception:
        detail_model = None

    payload = _moviebox_subject_payload(item, detail_model)

    if (
        payload.get("moviebox_media_type") == "series"
        and payload.get("is_hindi")
        and payload.get("title")
    ):
        try:
            canonical_title = _moviebox_base_title(str(payload.get("title") or ""))
            if canonical_title and canonical_title.lower() != str(payload.get("title") or "").lower():
                c_session, c_item = await moviebox_find_non_hindi_item(
                    canonical_title, normalized_media_type, year,
                    anime_only=normalized_media_type == "anime",
                )
                if c_item and not _moviebox_is_hindi(c_item):
                    c_detail = None
                    try:
                        c_detail = await _loader.MovieBoxTVSeriesDetails(
                            c_item, c_session
                        ).get_content_model()
                    except Exception:
                        c_detail = None
                    c_payload = _moviebox_subject_payload(c_item, c_detail)
                    if _moviebox_total_episode_count(c_payload.get("season_episode_counts")) > \
                       _moviebox_total_episode_count(payload.get("season_episode_counts")):
                        payload["available_seasons"]     = c_payload.get("available_seasons",     payload.get("available_seasons",     []))
                        payload["season_episode_counts"] = c_payload.get("season_episode_counts", payload.get("season_episode_counts", {}))
        except Exception as _exc:
            backend_logger.debug("details canonical merge failed: %s", _exc, exc_info=False)

    result = {"provider": "MovieBox", "item": payload}
    _moviebox_cache_set(cache_key, result, ttl=_CACHE_TTL["details"])
    return _sqlite_cache_set(cache_key, result, "details")
