import logging

from fastapi import APIRouter, Query, Response
from fastapi.responses import JSONResponse

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
logger = logging.getLogger("consumet.routes")


@router.get("/health")
async def consumet_health():
    try:
        return await get_health_status()
    except Exception as exc:
        logger.error("consumet_health failed: %s", exc)
        return JSONResponse(status_code=503, content={"healthy": False, "message": str(exc)})


@router.get("/discover/anime")
async def consumet_discover_anime(
    section: str = Query("trending"),
    page: int = Query(1, ge=1),
    period: str = Query("daily"),
):
    try:
        return await discover_anime(section=section, page=page, period=period)
    except Exception as exc:
        logger.error("consumet_discover_anime failed: %s", exc)
        return JSONResponse(status_code=502, content={"results": [], "error": str(exc)})


@router.get("/discover/manga")
async def consumet_discover_manga(
    section: str = Query("trending"),
    page: int = Query(1, ge=1),
):
    try:
        return await discover_manga(section=section, page=page)
    except Exception as exc:
        logger.error("consumet_discover_manga failed: %s", exc)
        return JSONResponse(status_code=502, content={"results": [], "error": str(exc)})


@router.get("/search/{domain}")
async def consumet_search(
    domain: str,
    query: str = Query(..., min_length=1),
    provider: str = Query("zoro"),
    page: int = Query(1, ge=1),
):
    try:
        return await search_domain(domain=domain, query=query, provider=provider, page=page)
    except Exception as exc:
        logger.error("consumet_search failed: %s", exc)
        return JSONResponse(status_code=502, content={"results": [], "error": str(exc)})


@router.get("/info/{domain}")
async def consumet_info(
    domain: str,
    id: str = Query(..., min_length=1),
    provider: str = Query("zoro"),
):
    try:
        return await fetch_domain_info(domain=domain, provider=provider, media_id=id)
    except Exception as exc:
        logger.error("consumet_info failed: %s", exc)
        return JSONResponse(status_code=502, content={"error": str(exc)})


@router.get("/episodes/anime")
async def consumet_anime_episodes(
    id: str = Query(..., min_length=1),
    provider: str = Query("zoro"),
):
    try:
        return await fetch_anime_episodes(provider=provider, media_id=id)
    except Exception as exc:
        logger.error("consumet_anime_episodes failed: %s", exc)
        return JSONResponse(status_code=502, content={"items": [], "error": str(exc)})


@router.get("/chapters/manga")
async def consumet_manga_chapters(
    id: str = Query(..., min_length=1),
    provider: str = Query("mangadex"),
):
    try:
        return await fetch_manga_chapters(provider=provider, media_id=id)
    except Exception as exc:
        logger.error("consumet_manga_chapters failed: %s", exc)
        return JSONResponse(status_code=502, content={"items": [], "error": str(exc)})


@router.get("/watch/anime")
async def consumet_watch_anime(
    episode_id: str = Query(..., min_length=1),
    provider: str = Query("zoro"),
    server: str | None = Query(None),
    audio: str = Query("hi"),
):
    try:
        return await fetch_anime_watch(
            provider=provider,
            episode_id=episode_id,
            server=server,
            audio=audio,
        )
    except Exception as exc:
        logger.error("consumet_watch_anime failed: %s", exc)
        return JSONResponse(
            status_code=502,
            content={"sources": [], "subtitles": [], "error": str(exc)},
        )


@router.get("/read/manga")
async def consumet_read_manga(
    chapter_id: str = Query(..., min_length=1),
    provider: str = Query("mangadex"),
):
    try:
        return await fetch_manga_read(provider=provider, chapter_id=chapter_id)
    except Exception as exc:
        logger.error("consumet_read_manga failed: %s", exc)
        return JSONResponse(status_code=502, content={"pages": [], "error": str(exc)})


@router.get("/read/{domain}")
async def consumet_read_generic(
    domain: str,
    id: str = Query(..., min_length=1),
    provider: str = Query("libgen"),
):
    try:
        return await fetch_generic_read(domain=domain, provider=provider, item_id=id)
    except Exception as exc:
        logger.error("consumet_read_generic failed: %s", exc)
        return JSONResponse(status_code=502, content={"error": str(exc)})


@router.get("/news/feed")
async def consumet_news_feed(
    topic: str | None = Query(None),
):
    try:
        return await fetch_news_feed(topic=topic)
    except Exception as exc:
        logger.error("consumet_news_feed failed: %s", exc)
        return JSONResponse(status_code=502, content={"items": [], "error": str(exc)})


@router.get("/news/article")
async def consumet_news_article(
    id: str = Query(..., min_length=1),
):
    try:
        return await fetch_news_article(article_id=id)
    except Exception as exc:
        logger.error("consumet_news_article failed: %s", exc)
        return JSONResponse(status_code=502, content={"error": str(exc)})


@router.get("/meta/search")
async def consumet_meta_search(
    query: str = Query(..., min_length=1),
    type: str = Query("movie"),
):
    try:
        return await fetch_meta_search(query=query, media_type=type)
    except Exception as exc:
        logger.error("consumet_meta_search failed: %s", exc)
        return JSONResponse(status_code=502, content={"results": [], "error": str(exc)})


@router.get("/meta/info")
async def consumet_meta_info(
    id: str = Query(..., min_length=1),
    type: str = Query("movie"),
):
    try:
        return await fetch_meta_info(item_id=id, media_type=type)
    except Exception as exc:
        logger.error("consumet_meta_info failed: %s", exc)
        return JSONResponse(status_code=502, content={"error": str(exc)})


# ─────────────────────────────────────────────────────────────────────────────
#  /anime/stream  —  the anime.py flow, fully replicated inside the backend
#
#  anime.py does:
#    1. GET /anime/hianime/{query}           → search results
#    2. pick best match, grab anime_id
#    3. GET /anime/hianime/info?id={id}      → episode list with real ep IDs
#    4. pick episode, grab ep_id
#    5. GET /anime/hianime/watch/{ep_id}?server=vidcloud&category=sub  → stream
#
#  This endpoint does EXACTLY that, server-side, so the browser never has to
#  touch port 3000 and CORS is not a factor.
#
#  The frontend passes:
#    title       — anime title to search for (use original/alt title too)
#    episode     — episode number (1-based)
#    audio       — "sub" or "dub"
#    anime_id    — optional known HiAnime ID (skips search step if provided)
# ─────────────────────────────────────────────────────────────────────────────

def _title_score(result_title: str, query: str) -> int:
    """Simple scoring — higher is better match."""
    r = result_title.lower().strip()
    q = query.lower().strip()
    if r == q:
        return 100
    if r.startswith(q) or q.startswith(r):
        return 80
    # word overlap
    q_words = set(q.split())
    r_words = set(r.split())
    overlap = len(q_words & r_words)
    return overlap * 10


@router.get("/anime/stream")
async def consumet_anime_stream(
    title: str = Query(..., min_length=1, description="Anime title to search for"),
    episode: int = Query(1, ge=1, description="Episode number (1-based)"),
    audio: str = Query("sub", description="'sub' or 'dub'"),
    anime_id: str | None = Query(None, description="Optional known HiAnime ID — skips search"),
    alt_title: str | None = Query(None, description="Alt title to try if primary search fails"),
):
    """
    Full anime.py streaming pipeline, server-side.

    Replicates anime.py steps 1-7 exactly:
      search → pick best match → info/episodes → watch
    Returns the raw Consumet payload (sources + subtitles).
    """
    import httpx
    from urllib.parse import quote as urlquote
    from app.services.consumet import get_consumet_api_base

    base = get_consumet_api_base()
    category = "dub" if audio.strip().lower() == "dub" else "sub"
    fallback_category = "sub" if category == "dub" else "dub"
    servers = ["vidcloud", "vidstreaming"]

    async with httpx.AsyncClient(timeout=40.0, follow_redirects=True) as client:

        # ── Step 1: Resolve anime ID ─────────────────────────────────────────
        resolved_id: str | None = anime_id  # use caller's hint if present

        if not resolved_id:
            # Search by title (mirrors anime.py step 1)
            search_titles = [title]
            if alt_title and alt_title.strip() and alt_title.strip() != title.strip():
                search_titles.append(alt_title.strip())

            for search_term in search_titles:
                try:
                    r = await client.get(
                        f"{base}/anime/hianime/{urlquote(search_term)}",
                        timeout=15.0,
                    )
                    if r.status_code >= 400:
                        continue
                    data = r.json()
                    results = data.get("results") or []
                    if not results:
                        continue
                    # Pick best title match
                    best = max(results, key=lambda x: _title_score(str(x.get("title", "")), search_term))
                    resolved_id = str(best.get("id", ""))
                    if resolved_id:
                        logger.info("anime/stream: resolved '%s' → id=%s", search_term, resolved_id)
                        break
                except Exception as exc:
                    logger.warning("anime/stream: search failed for '%s': %s", search_term, exc)

        if not resolved_id:
            return JSONResponse(
                status_code=404,
                content={
                    "sources": [],
                    "subtitles": [],
                    "error": f"Could not find '{title}' on HiAnime. Check the title spelling.",
                    "_step": "search",
                },
            )

        # ── Step 2: Get episode list (mirrors anime.py step 3) ───────────────
        ep_id: str | None = None
        try:
            r2 = await client.get(
                f"{base}/anime/hianime/info",
                params={"id": resolved_id},
                timeout=20.0,
            )
            if r2.status_code < 400:
                data2 = r2.json()
                episodes = data2.get("episodes") or []
                # Find by number, fallback to index
                ep_obj = next((e for e in episodes if e.get("number") == episode), None)
                if ep_obj is None and episodes:
                    idx = min(episode - 1, len(episodes) - 1)
                    ep_obj = episodes[idx]
                if ep_obj:
                    ep_id = str(ep_obj.get("id") or ep_obj.get("episodeId") or "")
        except Exception as exc:
            logger.warning("anime/stream: info fetch failed for id=%s: %s", resolved_id, exc)

        if not ep_id:
            return JSONResponse(
                status_code=404,
                content={
                    "sources": [],
                    "subtitles": [],
                    "error": f"Episode {episode} not found for '{title}' (id={resolved_id}).",
                    "_step": "info",
                    "_anime_id": resolved_id,
                },
            )

        # ── Step 3: Get stream (mirrors anime.py step 7) ─────────────────────
        # Try preferred audio first, then fallback audio — exactly like anime.py
        for cat in [category, fallback_category]:
            for srv in servers:
                try:
                    watch_url = f"{base}/anime/hianime/watch/{urlquote(ep_id, safe='')}"
                    r3 = await client.get(
                        watch_url,
                        params={"server": srv, "category": cat},
                        timeout=35.0,
                    )
                    if r3.status_code >= 400:
                        logger.debug(
                            "anime/stream: watch HTTP %d for ep=%s server=%s cat=%s",
                            r3.status_code, ep_id, srv, cat,
                        )
                        continue

                    data3 = r3.json()
                    sources = data3.get("sources") or []

                    if not sources:
                        logger.debug(
                            "anime/stream: empty sources for ep=%s server=%s cat=%s",
                            ep_id, srv, cat,
                        )
                        continue

                    # ✓ Got sources — attach diagnostic fields and return
                    data3["_anime_id"] = resolved_id
                    data3["_episode_id"] = ep_id
                    data3["_server_used"] = srv
                    data3["_category_used"] = cat
                    logger.info(
                        "anime/stream: ✓ %d sources for '%s' ep%d via %s/%s",
                        len(sources), title, episode, srv, cat,
                    )
                    return JSONResponse(content=data3)

                except Exception as exc:
                    logger.warning(
                        "anime/stream: watch error ep=%s server=%s cat=%s: %s",
                        ep_id, srv, cat, exc,
                    )

        # All server/category combos failed
        return JSONResponse(
            status_code=502,
            content={
                "sources": [],
                "subtitles": [],
                "error": (
                    f"No playable stream found for '{title}' episode {episode}. "
                    f"Tried vidcloud + vidstreaming ({category.upper()} + {fallback_category.upper()}). "
                    f"The episode may not be available on HiAnime yet, or the sidecar needs a restart."
                ),
                "_anime_id": resolved_id,
                "_episode_id": ep_id,
                "_step": "watch",
            },
        )


# ─────────────────────────────────────────────────────────────────────────────
#  /watch/anime/raw  —  kept as-is for backward compatibility
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/watch/anime/raw")
async def consumet_watch_anime_raw(
    episode_id: str = Query(..., min_length=1),
    server: str = Query("vidcloud"),
    category: str = Query("sub"),
):
    """
    Raw pass-through of the Consumet watch call — no normalization.
    Use /anime/stream instead (which also handles search + episode lookup).
    This is kept for direct episode-ID callers.
    """
    import httpx
    from urllib.parse import quote as urlquote
    from app.services.consumet import get_consumet_api_base

    base = get_consumet_api_base()
    url = f"{base}/anime/hianime/watch/{urlquote(episode_id, safe='')}"
    servers_to_try = ["vidcloud", "vidstreaming"] if server in ("auto", "") else [server]
    if server not in ("auto", "") and server == "vidcloud":
        servers_to_try = ["vidcloud", "vidstreaming"]
    elif server not in ("auto", "") and server == "vidstreaming":
        servers_to_try = ["vidstreaming", "vidcloud"]

    last_error = ""
    async with httpx.AsyncClient(timeout=35.0, follow_redirects=True) as client:
        for srv in servers_to_try:
            try:
                r = await client.get(url, params={"server": srv, "category": category})
                if r.status_code >= 400:
                    last_error = f"HTTP {r.status_code} from server={srv}"
                    continue
                data = r.json()
                sources = data.get("sources") or []
                if not sources:
                    last_error = f"Empty sources from server={srv}"
                    continue
                data["_server_used"] = srv
                data["_category_used"] = category
                return JSONResponse(content=data)
            except Exception as exc:
                last_error = str(exc)
                continue

    return JSONResponse(
        status_code=502,
        content={
            "sources": [],
            "subtitles": [],
            "error": last_error or "No sources found",
            "_episode_id": episode_id,
        },
    )


@router.get("/proxy")
async def consumet_proxy(
    url: str = Query(..., min_length=8),
):
    """Proxy external CDN images/resources to avoid CORS issues."""
    try:
        content, media_type = await fetch_proxy_response(url)
        return Response(content=content, media_type=media_type or "application/octet-stream")
    except Exception as exc:
        logger.warning("consumet_proxy failed for url=%s: %s", url[:120], exc)
        return JSONResponse(
            status_code=502,
            content={"error": "Proxy fetch failed", "detail": str(exc)},
        )
