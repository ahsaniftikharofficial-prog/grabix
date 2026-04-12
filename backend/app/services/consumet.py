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
#  Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _title_score(result_title: str, query: str) -> int:
    """Simple scoring — higher is better match."""
    r = result_title.lower().strip()
    q = query.lower().strip()
    if r == q:
        return 100
    if r.startswith(q) or q.startswith(r):
        return 80
    q_words = set(q.split())
    r_words = set(r.split())
    overlap = len(q_words & r_words)
    return overlap * 10


def _safe_error_body(response) -> str:
    """Extract a readable error string from a non-2xx httpx response."""
    try:
        body = response.json()
        # consumet-local returns {"detail": "..."} for errors
        return str(body.get("detail") or body.get("error") or body.get("message") or body)[:400]
    except Exception:
        return response.text[:400].strip()


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

    On failure, returns a detailed error body including:
      - _step: which step failed (search / info / watch)
      - _anime_id / _episode_id: resolved IDs for debugging
      - _attempt_errors: per-server error messages from the sidecar
      - _sidecar_hint: actionable fix suggestion
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
                        logger.warning(
                            "anime/stream: search HTTP %d for '%s' — sidecar: %s",
                            r.status_code, search_term, _safe_error_body(r),
                        )
                        continue
                    data = r.json()
                    results = data.get("results") or []
                    if not results:
                        continue
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
                    "error": (
                        f"Could not find '{title}' on HiAnime. "
                        "Check the title spelling, or try the original Japanese title."
                    ),
                    "_step": "search",
                    "_sidecar_hint": (
                        "If HiAnime search consistently fails, check that the consumet sidecar "
                        "is running: open a terminal and run 'cd consumet-local && node server.cjs'"
                    ),
                },
            )

        # ── Step 2: Get episode list (mirrors anime.py step 3) ───────────────
        ep_id: str | None = None
        info_error: str = ""
        try:
            r2 = await client.get(
                f"{base}/anime/hianime/info",
                params={"id": resolved_id},
                timeout=20.0,
            )
            if r2.status_code < 400:
                data2 = r2.json()
                episodes = data2.get("episodes") or []
                ep_obj = next((e for e in episodes if e.get("number") == episode), None)
                if ep_obj is None and episodes:
                    idx = min(episode - 1, len(episodes) - 1)
                    ep_obj = episodes[idx]
                if ep_obj:
                    ep_id = str(ep_obj.get("id") or ep_obj.get("episodeId") or "")
            else:
                info_error = _safe_error_body(r2)
                logger.warning(
                    "anime/stream: info HTTP %d for id=%s — sidecar: %s",
                    r2.status_code, resolved_id, info_error,
                )
        except Exception as exc:
            info_error = str(exc)
            logger.warning("anime/stream: info fetch failed for id=%s: %s", resolved_id, exc)

        if not ep_id:
            return JSONResponse(
                status_code=404,
                content={
                    "sources": [],
                    "subtitles": [],
                    "error": (
                        f"Episode {episode} not found for '{title}' "
                        f"(anime_id={resolved_id}). "
                        + (f"Sidecar error: {info_error}" if info_error else "")
                    ),
                    "_step": "info",
                    "_anime_id": resolved_id,
                    "_sidecar_error": info_error,
                    "_sidecar_hint": (
                        "The sidecar returned no episode list. "
                        "Try restarting it: 'cd consumet-local && node server.cjs'"
                    ),
                },
            )

        # ── Step 3: Get stream (mirrors anime.py step 7) ─────────────────────
        # Try preferred audio first, then fallback — exactly like anime.py.
        # KEY FIX: capture the actual sidecar error body from every 4xx/5xx
        # response so we can surface it to the user instead of silently dropping it.
        attempt_errors: list[str] = []

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
                        # ← FIXED: read the actual sidecar error, not just the status code
                        sidecar_err = _safe_error_body(r3)
                        attempt_errors.append(
                            f"{srv}/{cat}: HTTP {r3.status_code} — {sidecar_err}"
                        )
                        logger.warning(
                            "anime/stream: watch HTTP %d ep=%s server=%s cat=%s — sidecar: %s",
                            r3.status_code, ep_id, srv, cat, sidecar_err,
                        )
                        continue

                    data3 = r3.json()
                    sources = data3.get("sources") or []

                    if not sources:
                        # Sources array is present but empty
                        inner_err = data3.get("error") or data3.get("detail") or "empty sources array"
                        attempt_errors.append(f"{srv}/{cat}: 200 OK but no sources — {inner_err}")
                        logger.debug(
                            "anime/stream: empty sources for ep=%s server=%s cat=%s — %s",
                            ep_id, srv, cat, inner_err,
                        )
                        continue

                    # ✓ Got real sources — annotate and return
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
                    attempt_errors.append(f"{srv}/{cat}: exception — {exc}")
                    logger.warning(
                        "anime/stream: watch exception ep=%s server=%s cat=%s: %s",
                        ep_id, srv, cat, exc,
                    )

        # ── All server/category combos failed ────────────────────────────────
        # Build a human-readable hint from the actual sidecar errors collected above.
        hint = _build_sidecar_hint(attempt_errors)

        logger.error(
            "anime/stream: all attempts failed for '%s' ep%d (id=%s ep_id=%s). Errors: %s",
            title, episode, resolved_id, ep_id, attempt_errors,
        )

        return JSONResponse(
            status_code=502,
            content={
                "sources": [],
                "subtitles": [],
                "error": (
                    f"No playable stream found for '{title}' episode {episode}. "
                    f"Tried vidcloud + vidstreaming ({category.upper()} + {fallback_category.upper()}). "
                    f"{hint}"
                ),
                "_anime_id": resolved_id,
                "_episode_id": ep_id,
                "_step": "watch",
                "_attempt_errors": attempt_errors,
                "_sidecar_hint": hint,
            },
        )


def _build_sidecar_hint(attempt_errors: list[str]) -> str:
    """
    Turn the raw list of sidecar error strings into a human-readable fix hint.
    Looks for known patterns from the consumet-local server.cjs error messages.
    """
    combined = " ".join(attempt_errors).lower()

    if not attempt_errors:
        return "No attempt was made — the sidecar may be unreachable."

    if "connection refused" in combined or "connect call failed" in combined:
        return (
            "The consumet sidecar is NOT running. "
            "Open a terminal and run: cd consumet-local && node server.cjs"
        )

    if "aniwatch" in combined and ("outdated" in combined or "megacloud" in combined):
        return (
            "The aniwatch npm package is outdated. "
            "Fix: cd consumet-local && npm update aniwatch && node server.cjs"
        )

    if "encrypted" in combined and "no key" in combined:
        return (
            "MegaCloud is using encrypted sources and the current key is missing. "
            "Fix: cd consumet-local && npm update aniwatch && node server.cjs"
        )

    if "encrypted" in combined:
        return (
            "MegaCloud encryption detected. The aniwatch package may need updating. "
            "Fix: cd consumet-local && npm update aniwatch && node server.cjs"
        )

    if "invalid episode id" in combined:
        return (
            "The episode ID format was rejected by the sidecar. "
            "This is a bug — please report it with the _episode_id value."
        )

    if "502" in combined or "bad gateway" in combined:
        return (
            "The sidecar itself is returning errors. "
            "Try: cd consumet-local && npm update aniwatch && node server.cjs"
        )

    # Generic fallback
    return (
        "The episode may not be available on HiAnime yet, or the sidecar needs a restart. "
        "Try: cd consumet-local && node server.cjs"
    )


# ─────────────────────────────────────────────────────────────────────────────
#  /anime/debug-stream  —  same pipeline as /anime/stream but returns every
#  intermediate result so you can see exactly where it breaks.
#
#  Call this from the browser / curl when /anime/stream fails.
#  It never throws — it always returns a JSON report.
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/anime/debug-stream")
async def consumet_anime_debug_stream(
    title: str = Query(..., min_length=1),
    episode: int = Query(1, ge=1),
    audio: str = Query("sub"),
    anime_id: str | None = Query(None),
    alt_title: str | None = Query(None),
):
    """
    Diagnostic endpoint — runs the full anime.py pipeline and returns every
    intermediate result so you can see exactly which step is failing.

    Returns a JSON report with:
      - sidecar_reachable: bool
      - step1_search: search results + chosen ID
      - step2_info: episode list + resolved ep_id
      - step3_watch: per-server attempt results with full sidecar response bodies
      - verdict: human-readable summary of what went wrong
    """
    import httpx
    from urllib.parse import quote as urlquote
    from app.services.consumet import get_consumet_api_base

    base = get_consumet_api_base()
    report: dict = {
        "title": title,
        "episode": episode,
        "audio": audio,
        "anime_id_hint": anime_id,
        "sidecar_base": base,
        "sidecar_reachable": False,
        "step1_search": {},
        "step2_info": {},
        "step3_watch": [],
        "verdict": "",
    }

    async with httpx.AsyncClient(timeout=40.0, follow_redirects=True) as client:

        # ── Sidecar health check ──────────────────────────────────────────────
        try:
            hc = await client.get(f"{base}/", timeout=5.0)
            report["sidecar_reachable"] = hc.status_code < 500
            try:
                report["sidecar_home"] = hc.json()
            except Exception:
                report["sidecar_home"] = hc.text[:200]
        except Exception as exc:
            report["sidecar_reachable"] = False
            report["sidecar_home"] = f"ERROR: {exc}"
            report["verdict"] = (
                f"Sidecar is NOT reachable at {base}. "
                "Run: cd consumet-local && node server.cjs"
            )
            return JSONResponse(content=report)

        # ── Step 1: Search ────────────────────────────────────────────────────
        resolved_id: str | None = anime_id
        step1: dict = {"skipped": bool(anime_id), "anime_id_used": anime_id}

        if not resolved_id:
            search_titles = [title]
            if alt_title and alt_title.strip() and alt_title.strip() != title.strip():
                search_titles.append(alt_title.strip())

            step1["attempts"] = []
            for search_term in search_titles:
                attempt: dict = {"query": search_term}
                try:
                    r = await client.get(
                        f"{base}/anime/hianime/{urlquote(search_term)}", timeout=15.0
                    )
                    attempt["status"] = r.status_code
                    if r.status_code < 400:
                        data = r.json()
                        results = data.get("results") or []
                        attempt["result_count"] = len(results)
                        attempt["top5"] = [
                            {"id": x.get("id"), "title": x.get("title")} for x in results[:5]
                        ]
                        if results:
                            best = max(
                                results,
                                key=lambda x: _title_score(str(x.get("title", "")), search_term),
                            )
                            resolved_id = str(best.get("id", ""))
                            attempt["chosen_id"] = resolved_id
                            attempt["chosen_title"] = best.get("title")
                    else:
                        attempt["error"] = _safe_error_body(r)
                except Exception as exc:
                    attempt["error"] = str(exc)
                step1["attempts"].append(attempt)
                if resolved_id:
                    break

        step1["resolved_id"] = resolved_id
        report["step1_search"] = step1

        if not resolved_id:
            report["verdict"] = (
                f"FAILED at step 1 (search). Could not find '{title}' on HiAnime. "
                "Try the Japanese title, or check that the sidecar can reach aniwatchtv.to"
            )
            return JSONResponse(content=report)

        # ── Step 2: Info / episode list ───────────────────────────────────────
        ep_id: str | None = None
        step2: dict = {"anime_id": resolved_id}
        try:
            r2 = await client.get(
                f"{base}/anime/hianime/info", params={"id": resolved_id}, timeout=20.0
            )
            step2["status"] = r2.status_code
            if r2.status_code < 400:
                data2 = r2.json()
                episodes = data2.get("episodes") or []
                step2["total_episodes"] = len(episodes)
                step2["sub_count"] = data2.get("subEpisodeCount", "?")
                step2["dub_count"] = data2.get("dubEpisodeCount", "?")
                step2["first5_episodes"] = [
                    {"number": e.get("number"), "id": e.get("id"), "title": e.get("title")}
                    for e in episodes[:5]
                ]
                ep_obj = next((e for e in episodes if e.get("number") == episode), None)
                if ep_obj is None and episodes:
                    idx = min(episode - 1, len(episodes) - 1)
                    ep_obj = episodes[idx]
                if ep_obj:
                    ep_id = str(ep_obj.get("id") or ep_obj.get("episodeId") or "")
                    step2["ep_obj"] = ep_obj
                    step2["ep_id"] = ep_id
                else:
                    step2["error"] = f"Episode {episode} not found in list of {len(episodes)}"
            else:
                step2["error"] = _safe_error_body(r2)
        except Exception as exc:
            step2["error"] = str(exc)

        report["step2_info"] = step2

        if not ep_id:
            report["verdict"] = (
                f"FAILED at step 2 (info). "
                f"Could not resolve episode {episode} for anime_id={resolved_id}. "
                + (step2.get("error") or "")
            )
            return JSONResponse(content=report)

        # ── Step 3: Watch — try all server/category combos ────────────────────
        category = "dub" if audio.strip().lower() == "dub" else "sub"
        fallback_category = "sub" if category == "dub" else "dub"
        watch_results: list[dict] = []
        got_sources = False

        for cat in [category, fallback_category]:
            for srv in ["vidcloud", "vidstreaming"]:
                attempt: dict = {"server": srv, "category": cat, "ep_id": ep_id}
                try:
                    watch_url = f"{base}/anime/hianime/watch/{urlquote(ep_id, safe='')}"
                    r3 = await client.get(
                        watch_url, params={"server": srv, "category": cat}, timeout=35.0
                    )
                    attempt["status"] = r3.status_code
                    if r3.status_code >= 400:
                        attempt["sidecar_error"] = _safe_error_body(r3)
                        attempt["result"] = "FAILED"
                    else:
                        data3 = r3.json()
                        sources = data3.get("sources") or []
                        attempt["source_count"] = len(sources)
                        attempt["subtitle_count"] = len(data3.get("subtitles") or [])
                        if sources:
                            attempt["result"] = "SUCCESS"
                            attempt["first_source"] = sources[0]
                            got_sources = True
                        else:
                            attempt["result"] = "EMPTY_SOURCES"
                            attempt["sidecar_error"] = (
                                data3.get("error") or data3.get("detail") or "No sources in 200 response"
                            )
                except Exception as exc:
                    attempt["result"] = "EXCEPTION"
                    attempt["sidecar_error"] = str(exc)
                watch_results.append(attempt)

        report["step3_watch"] = watch_results

        # ── Verdict ───────────────────────────────────────────────────────────
        if got_sources:
            report["verdict"] = (
                "✅ Stream found! The debug run succeeded. "
                "If /anime/stream is still failing, try again — it may have been a transient error."
            )
        else:
            all_errors = [
                a.get("sidecar_error", "") for a in watch_results if a.get("sidecar_error")
            ]
            report["verdict"] = (
                "❌ FAILED at step 3 (watch). "
                + _build_sidecar_hint(
                    [f"{a['server']}/{a['category']}: {a.get('sidecar_error','')}" for a in watch_results]
                )
            )
            report["all_sidecar_errors"] = all_errors

    return JSONResponse(content=report)


# ─────────────────────────────────────────────────────────────────────────────
#  /anime/debug-watch/{ep_id}  —  proxy to the sidecar's built-in debug-watch
#  endpoint which diagnoses MegaCloud extraction step by step.
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/anime/debug-watch/{ep_id:path}")
async def consumet_anime_debug_watch(ep_id: str):
    """
    Proxies GET /anime/hianime/debug-watch/{ep_id} from the consumet sidecar.

    The sidecar's debug-watch endpoint shows:
      - Step 1: server list from HiAnime AJAX
      - Step 2: embed link for first server
      - Step 3: MegaCloud AJAX response (encrypted? key present? sources count?)
      - verdict: ✅ / ⚠️ / ❌

    Call this when /anime/debug-stream shows step 3 failing.
    You need the ep_id (e.g. jujutsu-kaisen-18679?ep=126296) from step2_info.ep_id.
    """
    import httpx
    from urllib.parse import quote as urlquote
    from app.services.consumet import get_consumet_api_base

    base = get_consumet_api_base()

    try:
        async with httpx.AsyncClient(timeout=40.0, follow_redirects=True) as client:
            url = f"{base}/anime/hianime/debug-watch/{urlquote(ep_id, safe='')}"
            r = await client.get(url, timeout=35.0)
            try:
                return JSONResponse(content=r.json(), status_code=r.status_code)
            except Exception:
                return JSONResponse(
                    content={"raw": r.text[:2000], "status": r.status_code},
                    status_code=r.status_code,
                )
    except Exception as exc:
        return JSONResponse(
            status_code=502,
            content={
                "error": str(exc),
                "hint": f"Could not reach sidecar at {base}. Is it running?",
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

    attempt_errors: list[str] = []
    async with httpx.AsyncClient(timeout=35.0, follow_redirects=True) as client:
        for srv in servers_to_try:
            try:
                r = await client.get(url, params={"server": srv, "category": category})
                if r.status_code >= 400:
                    err = _safe_error_body(r)
                    attempt_errors.append(f"{srv}: HTTP {r.status_code} — {err}")
                    continue
                data = r.json()
                sources = data.get("sources") or []
                if not sources:
                    attempt_errors.append(f"{srv}: 200 OK but no sources")
                    continue
                data["_server_used"] = srv
                data["_category_used"] = category
                return JSONResponse(content=data)
            except Exception as exc:
                attempt_errors.append(f"{srv}: exception — {exc}")
                continue

    return JSONResponse(
        status_code=502,
        content={
            "sources": [],
            "subtitles": [],
            "error": "; ".join(attempt_errors) or "No sources found",
            "_episode_id": episode_id,
            "_attempt_errors": attempt_errors,
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
