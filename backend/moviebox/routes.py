"""
backend/moviebox/routes.py — FastAPI route handlers only.

Every handler is ≤10 lines: validate → cache-check → delegate to a fetcher.

Dependency chain (no circular imports):
  moviebox_loader   →  (no moviebox deps)
  moviebox_helpers  →  moviebox_loader
  moviebox_fetchers →  moviebox_loader, moviebox_helpers
  routes.py         →  all three
"""
from __future__ import annotations

from urllib.request import Request as URLRequest, urlopen

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

import moviebox.moviebox_loader as _loader
from moviebox.moviebox_loader import (
    _sqlite_cache_get,
    _cache_trigger_bg_refresh,
    _validate_outbound_url,
    _moviebox_cache_get,
    _moviebox_cache_set,
    # re-exported so moviebox/__init__.py import stays unchanged
    start_bg_retry,            # noqa: F401
    restore_from_last_session, # noqa: F401
    MOVIEBOX_AVAILABLE,        # noqa: F401
    MOVIEBOX_IMPORT_ERROR,     # noqa: F401
)
from moviebox.moviebox_helpers import (
    _moviebox_media_type_value,
    _moviebox_release_year,
    _moviebox_caption_payload,
    _moviebox_source_payload,
    _moviebox_srt_to_vtt,
)
from moviebox.moviebox_fetchers import (
    _moviebox_subject_payload,
    moviebox_discover_payload,
    moviebox_find_item,
    moviebox_resolve_item,
    search_items_fetch_and_cache,
    details_fetch_and_cache,
)

router = APIRouter()


@router.get("/search")
async def moviebox_search(title: str, media_type: str = "movie", year: int | None = None):
    normalized = _moviebox_media_type_value(media_type)
    _, item = await moviebox_find_item(title, normalized, year)
    return _moviebox_subject_payload(item)


@router.get("/discover")
async def moviebox_discover():
    return await moviebox_discover_payload()


@router.get("/search-items")
async def moviebox_search_items(
    query:        str,
    page:         int  = 1,
    per_page:     int  = 24,
    media_type:   str  = "all",
    hindi_only:   bool = False,
    anime_only:   bool = False,
    prefer_hindi: bool = True,
    sort_by:      str  = "search",
):
    normalized    = _moviebox_media_type_value(media_type)
    safe_page     = max(1, page)
    safe_per_page = min(max(1, per_page), 48)
    cache_key = (
        f"moviebox:search:{query}:{safe_page}:{safe_per_page}:{normalized}:"
        f"{hindi_only}:{anime_only}:{prefer_hindi}:{sort_by}"
    )
    cached_value, is_stale = _sqlite_cache_get(cache_key)
    if cached_value is not None:
        if is_stale:
            async def _refresh():
                await search_items_fetch_and_cache(
                    cache_key, query, safe_page, safe_per_page,
                    normalized, hindi_only, anime_only, prefer_hindi, sort_by,
                )
            _cache_trigger_bg_refresh(cache_key, _refresh)
        return cached_value
    return await search_items_fetch_and_cache(
        cache_key, query, safe_page, safe_per_page,
        normalized, hindi_only, anime_only, prefer_hindi, sort_by,
    )


@router.get("/details")
async def moviebox_details(
    subject_id: str | None = None,
    title:      str | None = None,
    media_type: str        = "movie",
    year:       int | None = None,
):
    normalized = _moviebox_media_type_value(media_type)
    cache_key  = f"moviebox:details:{subject_id or title}:{normalized}:{year}"
    cached_value, is_stale = _sqlite_cache_get(cache_key)
    if cached_value is not None:
        if is_stale:
            async def _refresh():
                await details_fetch_and_cache(cache_key, subject_id, title, normalized, year)
            _cache_trigger_bg_refresh(cache_key, _refresh)
        return cached_value
    return await details_fetch_and_cache(cache_key, subject_id, title, normalized, year)


@router.get("/sources")
async def moviebox_sources(
    subject_id: str | None = None,
    title:      str | None = None,
    media_type: str        = "movie",
    year:       int | None = None,
    season:     int        = 1,
    episode:    int        = 1,
):
    normalized = _moviebox_media_type_value(media_type)
    if normalized == "all":
        raise HTTPException(status_code=400, detail="media_type must not be 'all' for sources")

    cache_key = f"moviebox:sources:{subject_id or title}:{normalized}:{year}:{season}:{episode}"
    cached = _moviebox_cache_get(cache_key)
    if cached is not None:
        return cached

    session, item = await moviebox_resolve_item(
        subject_id, title, normalized, year, require_downloadable=True
    )
    try:
        if normalized == "movie":
            files = await _loader.DownloadableMovieFilesDetail(session, item).get_content_model()
        else:
            files = await _loader.DownloadableTVSeriesFilesDetail(session, item).get_content_model(season, episode)
    except Exception as exc:
        print(
            f"[GRABIX] MovieBox source resolution failed: "
            f"title={getattr(item, 'title', title or '')} "
            f"subject_id={getattr(item, 'id', subject_id or '')} "
            f"media_type={normalized} season={season} episode={episode} error={exc}"
        )
        raise HTTPException(status_code=502,
                            detail="Movie Box could not resolve playable files for this title")

    downloads = sorted(
        list(getattr(files, "downloads", []) or []),
        key=lambda f: int(getattr(f, "resolution", 0) or 0),
        reverse=True,
    )
    if not downloads:
        raise HTTPException(status_code=404, detail="Movie Box returned no playable files")

    captions = [
        _moviebox_caption_payload(c)
        for c in list(getattr(files, "captions", []) or [])
        if str(getattr(c, "url", "") or "")
    ]
    payload = {
        "provider":   "MovieBox",
        "media_type": normalized,
        "title":      getattr(item, "title", title or ""),
        "year":       _moviebox_release_year(item),
        "season":     season  if normalized != "movie" else None,
        "episode":    episode if normalized != "movie" else None,
        "item":       _moviebox_subject_payload(item),
        "subtitles":  captions,
        "sources":    [_moviebox_source_payload(f, captions) for f in downloads],
    }
    return _moviebox_cache_set(cache_key, payload, ttl=60 * 10)


@router.get("/subtitle")
def moviebox_subtitle(url: str):
    try:
        _validate_outbound_url(url)
        req = URLRequest(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://moviebox.ng/"})
        with urlopen(req, timeout=20) as resp:
            content = resp.read().decode("utf-8", errors="ignore")
        return Response(content=_moviebox_srt_to_vtt(content), media_type="text/vtt")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Subtitle fetch failed: {exc}")


@router.get("/poster")
def moviebox_poster(url: str):
    try:
        req = URLRequest(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://moviebox.ng/"})
        with urlopen(req, timeout=20) as resp:
            content    = resp.read()
            media_type = resp.headers.get("Content-Type", "image/jpeg")
        return Response(content=content, media_type=media_type,
                        headers={"Cache-Control": "public, max-age=86400"})
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Movie Box poster fetch failed: {exc}")


@router.get("/proxy-stream")
def moviebox_proxy_stream(url: str, request: Request):
    try:
        headers = dict(_loader.MOVIEBOX_DOWNLOAD_REQUEST_HEADERS or {})
        headers.setdefault("User-Agent", "Mozilla/5.0")
        range_header = request.headers.get("range")
        if range_header:
            headers["Range"] = range_header

        upstream_req  = URLRequest(url, headers=headers)
        upstream_resp = urlopen(upstream_req, timeout=30)

        resp_headers: dict = {}
        for h in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"):
            v = upstream_resp.headers.get(h)
            if v:
                resp_headers[h] = v

        media_type = upstream_resp.headers.get("Content-Type", "video/mp4")

        def iter_stream():
            try:
                while True:
                    chunk = upstream_resp.read(1024 * 256)
                    if not chunk:
                        break
                    yield chunk
            finally:
                upstream_resp.close()

        return StreamingResponse(
            iter_stream(),
            status_code=getattr(upstream_resp, "status", 200),
            headers=resp_headers,
            media_type=media_type,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Movie Box stream proxy failed: {exc}")
