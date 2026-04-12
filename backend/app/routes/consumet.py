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


# ---------------------------------------------------------------------------
# Helpers (used by /anime/stream and /anime/debug-stream)
# ---------------------------------------------------------------------------

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
        return str(body.get("detail") or body.get("error") or body.get("message") or body)[:400]
    except Exception:
        return response.text[:400].strip()


def _build_sidecar_hint(attempt_errors: list[str]) -> str:
    """Turn the raw list of sidecar error strings into a human-readable fix hint."""
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

    return (
        "The episode may not be available on HiAnime yet, or the sidecar needs a restart. "
        "Try: cd consumet-local && node server.cjs"
    )


# ---------------------------------------------------------------------------
# Standard pass-through endpoints
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
#  /anime/stream  — full anime.py pipeline, server-side
#
#  Steps:  search → pick best match → info/episodes → watch
#  Captures the real sidecar error body from every failed attempt (KEY FIX).
# ---------------------------------------------------------------------------

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
    Returns stream sources + subtitles, or a detailed error with _attempt_errors.
    """
    import httpx
    from urllib.parse import quote as urlquote
    from app.services.consumet import get_consumet_api_base

    base = get_consumet_api_base()
    category = "dub" if audio.strip().lower() == "dub" else "sub"
    fallback_category = "sub" if category == "dub" else "dub"
    # vidstreaming first (MegaCloud fallback), then vidcloud, then t-cloud (different CDN — bypasses MegaCloud key issues)
    servers = ["vidstreaming", "vidcloud", "t-cloud"]

    async with httpx.AsyncClient(timeout=40.0, follow_redirects=True) as client:

        # ── Step 1: Resolve anime ID ─────────────────────────────────────────
        resolved_id: str | None = anime_id

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

        # ── Step 2: Get episode list ─────────────────────────────────────────
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

        # ── Step 3: Get stream — ALL combos run CONCURRENTLY ────────────────
        # PREVIOUS BUG: sequential attempts (4 × up to 35 s = 140 s worst case)
        # caused "signal timed out" on the frontend (55 s limit).
        # FIX: run all combos in parallel; total time = max(individual times).
        import asyncio as _asyncio

        attempt_errors: list[str] = []

        async def _try_watch(srv: str, cat: str):
            try:
                watch_url = f"{base}/anime/hianime/watch/{urlquote(ep_id, safe='')}"
                r3 = await client.get(
                    watch_url,
                    params={"server": srv, "category": cat},
                    timeout=25.0,  # tight per-call; 4 run in parallel so total ≤ 25 s
                )
                if r3.status_code >= 400:
                    err = _safe_error_body(r3)
                    logger.warning(
                        "anime/stream: watch HTTP %d ep=%s server=%s cat=%s — %s",
                        r3.status_code, ep_id, srv, cat, err,
                    )
                    return None, f"{srv}/{cat}: HTTP {r3.status_code} — {err}"
                data3 = r3.json()
                sources = data3.get("sources") or []
                if not sources:
                    inner_err = data3.get("error") or data3.get("detail") or "empty sources array"
                    return None, f"{srv}/{cat}: 200 OK but no sources — {inner_err}"
                data3["_anime_id"] = resolved_id
                data3["_episode_id"] = ep_id
                data3["_server_used"] = srv
                data3["_category_used"] = cat
                logger.info(
                    "anime/stream: ✓ %d sources for '%s' ep%d via %s/%s",
                    len(sources), title, episode, srv, cat,
                )
                return data3, None
            except Exception as exc:
                logger.warning("anime/stream: watch exception ep=%s srv=%s cat=%s: %s", ep_id, srv, cat, exc)
                return None, f"{srv}/{cat}: exception — {exc}"

        combos = [(srv, cat) for cat in [category, fallback_category] for srv in servers]
        watch_results = await _asyncio.gather(*[_try_watch(s, c) for s, c in combos])

        for data3, err in watch_results:
            if err:
                attempt_errors.append(err)
            if data3:
                return JSONResponse(content=data3)

        # ── All HiAnime sidecar attempts failed — try Python MegaCloud extractor ─
        # The aniwatch npm package (v2.27.9) is broken since MegaCloud changed
        # their API in April 2026. This Python extractor bypasses it entirely:
        # it calls the HiAnime AJAX API directly and implements the decryption.
        try:
            from app.services.megacloud import extract_hianime_stream as _py_extract
            logger.info("anime/stream: trying Python MegaCloud extractor for ep_id=%s", ep_id)
            py_result = await _py_extract(ep_id, category)
            py_sources = py_result.get("sources") or []
            if py_sources:
                logger.info("anime/stream: Python extractor succeeded (%d sources)", len(py_sources))
                return JSONResponse(content={
                    "sources": py_sources,
                    "subtitles": py_result.get("subtitles") or [],
                    "headers": py_result.get("headers") or {},
                    "_server_used": "python-megacloud",
                    "_category_used": category,
                    "_anime_id": resolved_id,
                    "_episode_id": ep_id,
                    "_fallback": "python-megacloud",
                })
        except Exception as py_exc:
            logger.warning("anime/stream: Python MegaCloud extractor failed: %s", py_exc)

        # ── All HiAnime/MegaCloud attempts failed — try Gogoanime first ────────
        # Gogoanime uses a completely different CDN (not MegaCloud).
        # The sidecar exposes a single /anime/gogoanime/stream endpoint that
        # does search → info → episode sources internally.
        try:
            logger.info("anime/stream: trying Gogoanime for '%s' ep%d", title, episode)
            gogo_dubbed = (category == "dub")
            # Try primary title, then alt_title (Japanese romanization often matches Gogoanime)
            gogo_titles = [title]
            if alt_title and alt_title.strip() and alt_title.strip() != title.strip():
                gogo_titles.append(alt_title.strip())
            gr = None
            for gogo_title in gogo_titles:
                _gr = await client.get(
                    f"{base}/anime/gogoanime/stream",
                    params={"title": gogo_title, "episode": episode, "dubbed": str(gogo_dubbed).lower()},
                    timeout=30.0,
                )
                if _gr.status_code < 400 and (_gr.json().get("sources") or []):
                    gr = _gr
                    break
                gr = _gr  # keep last for error checking
            if gr is None:
                raise RuntimeError("no gogoanime response")
            if gr.status_code < 400:
                gd = gr.json()
                gogo_sources = gd.get("sources") or []
                # Filter to m3u8 / direct video only
                playable = [s for s in gogo_sources if s.get("url") and (
                    s.get("isM3U8") or ".m3u8" in str(s.get("url", "")) or
                    str(s.get("quality", "")).lower() not in ("backup", "")
                )]
                if not playable:
                    playable = gogo_sources  # take whatever we have
                if playable:
                    logger.info("anime/stream: Gogoanime succeeded for '%s' ep%d (%d sources)", title, episode, len(playable))
                    return JSONResponse(content={
                        "sources": playable,
                        "subtitles": gd.get("subtitles") or [],
                        "headers": gd.get("headers") or {},
                        "_server_used": "gogoanime",
                        "_category_used": category,
                        "_fallback": "gogoanime",
                    })
        except Exception as gogo_exc:
            logger.warning("anime/stream: Gogoanime fallback failed for '%s': %s", title, gogo_exc)

        # ── All HiAnime/MegaCloud attempts failed — try AnimePahe as fallback ──
        # AnimePahe uses the Kwik CDN (completely different from MegaCloud),
        # so it works even when MegaCloud encryption keys are stale.
        try:
            logger.info("anime/stream: HiAnime failed, trying AnimePahe fallback for '%s' ep%d", title, episode)
            pahe_search_url = f"{base}/anime/animepahe/{urlquote(title, safe='')}"
            pr = await client.get(pahe_search_url, timeout=12.0)
            if pr.status_code < 400:
                pahe_results = pr.json().get("results") or []
                if pahe_results:
                    best_pahe = max(
                        pahe_results,
                        key=lambda x: _title_score(str(x.get("title", "")), title),
                    )
                    pahe_id = str(best_pahe.get("id", "")).strip()
                    if pahe_id:
                        pi_r = await client.get(
                            f"{base}/anime/animepahe/info/{urlquote(pahe_id, safe='')}",
                            timeout=15.0,
                        )
                        if pi_r.status_code < 400:
                            pahe_eps = pi_r.json().get("episodes") or []
                            # Match by episode number; fall back to index
                            pahe_ep = next((e for e in pahe_eps if e.get("number") == episode), None)
                            if pahe_ep is None and pahe_eps:
                                idx = min(episode - 1, len(pahe_eps) - 1)
                                pahe_ep = pahe_eps[idx]
                            if pahe_ep:
                                pahe_ep_id = str(pahe_ep.get("id") or pahe_ep.get("episodeId") or "").strip()
                                if pahe_ep_id:
                                    ps_r = await client.get(
                                        f"{base}/anime/animepahe/watch",
                                        params={"episodeId": pahe_ep_id},
                                        timeout=15.0,
                                    )
                                    if ps_r.status_code < 400:
                                        ps_data = ps_r.json()
                                        pahe_sources = ps_data.get("sources") or []
                                        if pahe_sources:
                                            logger.info(
                                                "anime/stream: AnimePahe fallback succeeded for '%s' ep%d (%d sources)",
                                                title, episode, len(pahe_sources),
                                            )
                                            return JSONResponse(content={
                                                "sources": pahe_sources,
                                                "subtitles": ps_data.get("subtitles") or [],
                                                "headers": ps_data.get("headers") or {},
                                                "_server_used": "animepahe",
                                                "_category_used": category,
                                                "_anime_id": pahe_id,
                                                "_episode_id": pahe_ep_id,
                                                "_fallback": "animepahe",
                                            })
        except Exception as pahe_exc:
            logger.warning("anime/stream: AnimePahe fallback failed for '%s': %s", title, pahe_exc)

        # All attempts failed (HiAnime + AnimePahe)
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
                    f"Tried HiAnime (vidcloud+vidstreaming+t-cloud, {category.upper()}+{fallback_category.upper()}) + Gogoanime + AnimePahe. "
                    f"{hint}"
                ),
                "_anime_id": resolved_id,
                "_episode_id": ep_id,
                "_step": "watch",
                "_attempt_errors": attempt_errors,
                "_sidecar_hint": hint,
            },
        )


# ---------------------------------------------------------------------------
#  /anime/debug-stream  — same pipeline but returns every intermediate result
# ---------------------------------------------------------------------------

@router.get("/anime/debug-stream")
async def consumet_anime_debug_stream(
    title: str = Query(..., min_length=1),
    episode: int = Query(1, ge=1),
    audio: str = Query("sub"),
    anime_id: str | None = Query(None),
    alt_title: str | None = Query(None),
):
    """
    Diagnostic endpoint — runs the full anime pipeline and returns every
    intermediate result so you can see exactly which step is failing.
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

        # Sidecar health check
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

        # Step 1: Search
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

        # Step 2: Info / episode list
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

        # Step 3: Watch — try all server/category combos
        category = "dub" if audio.strip().lower() == "dub" else "sub"
        fallback_category = "sub" if category == "dub" else "dub"
        watch_results: list[dict] = []
        got_sources = False

        for cat in [category, fallback_category]:
            for srv in ["vidcloud", "vidstreaming"]:
                attempt2: dict = {"server": srv, "category": cat, "ep_id": ep_id}
                try:
                    watch_url = f"{base}/anime/hianime/watch/{urlquote(ep_id, safe='')}"
                    r3 = await client.get(
                        watch_url, params={"server": srv, "category": cat}, timeout=35.0
                    )
                    attempt2["status"] = r3.status_code
                    if r3.status_code >= 400:
                        attempt2["sidecar_error"] = _safe_error_body(r3)
                        attempt2["result"] = "FAILED"
                    else:
                        data3 = r3.json()
                        sources = data3.get("sources") or []
                        attempt2["source_count"] = len(sources)
                        attempt2["subtitle_count"] = len(data3.get("subtitles") or [])
                        if sources:
                            attempt2["result"] = "SUCCESS"
                            attempt2["first_source"] = sources[0]
                            got_sources = True
                        else:
                            attempt2["result"] = "EMPTY_SOURCES"
                            attempt2["sidecar_error"] = (
                                data3.get("error") or data3.get("detail") or "No sources in 200 response"
                            )
                except Exception as exc:
                    attempt2["result"] = "EXCEPTION"
                    attempt2["sidecar_error"] = str(exc)
                watch_results.append(attempt2)

        report["step3_watch"] = watch_results

        if got_sources:
            report["verdict"] = (
                "✅ Stream found! The debug run succeeded. "
                "If /anime/stream is still failing, try again — it may have been a transient error."
            )
        else:
            report["verdict"] = (
                "❌ FAILED at step 3 (watch). "
                + _build_sidecar_hint(
                    [f"{a['server']}/{a['category']}: {a.get('sidecar_error', '')}" for a in watch_results]
                )
            )
            report["all_sidecar_errors"] = [
                a.get("sidecar_error", "") for a in watch_results if a.get("sidecar_error")
            ]

    return JSONResponse(content=report)


# ---------------------------------------------------------------------------
#  /anime/debug-watch/{ep_id}  — proxy to sidecar's MegaCloud diagnostic
# ---------------------------------------------------------------------------

@router.get("/anime/debug-watch/{ep_id:path}")
async def consumet_anime_debug_watch(ep_id: str):
    """
    Proxies GET /anime/hianime/debug-watch/{ep_id} from the consumet sidecar.
    Use when /anime/debug-stream shows step 3 failing.
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


# ---------------------------------------------------------------------------
#  /watch/anime/raw  — raw pass-through (backward compat)
# ---------------------------------------------------------------------------

@router.get("/watch/anime/raw")
async def consumet_watch_anime_raw(
    episode_id: str = Query(..., min_length=1),
    server: str = Query("vidcloud"),
    category: str = Query("sub"),
):
    import httpx
    from urllib.parse import quote as urlquote
    from app.services.consumet import get_consumet_api_base

    base = get_consumet_api_base()
    url = f"{base}/anime/hianime/watch/{urlquote(episode_id, safe='')}"
    servers_to_try = ["vidcloud", "vidstreaming"] if server in ("auto", "") else [server]
    if server == "vidcloud":
        servers_to_try = ["vidcloud", "vidstreaming"]
    elif server == "vidstreaming":
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


# ---------------------------------------------------------------------------
#  /anime/update-aniwatch  — runs npm update aniwatch in consumet-local
# ---------------------------------------------------------------------------

@router.get("/anime/update-aniwatch")
async def update_aniwatch_package():
    """
    Run 'npm update aniwatch' in the consumet-local directory.
    Call this when HiAnime streams fail with MegaCloud key errors.
    After the update, restart the sidecar manually: node server.cjs
    """
    import subprocess
    import os as _os

    # Walk up from this file to find consumet-local/
    this_dir = _os.path.dirname(_os.path.abspath(__file__))
    project_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.dirname(this_dir))))
    consumet_dir = _os.path.join(project_root, "consumet-local")

    # Fallback: check common relative paths
    if not _os.path.isdir(consumet_dir):
        for candidate in [
            _os.path.join(_os.getcwd(), "consumet-local"),
            _os.path.join(_os.path.dirname(_os.getcwd()), "consumet-local"),
        ]:
            if _os.path.isdir(candidate):
                consumet_dir = candidate
                break

    if not _os.path.isdir(consumet_dir):
        return JSONResponse(
            status_code=404,
            content={
                "success": False,
                "error": f"consumet-local directory not found. Expected: {consumet_dir}",
                "hint": "Make sure consumet-local/ is at the project root, then run: cd consumet-local && npm update aniwatch && node server.cjs",
            },
        )

    # ── Locate npm — subprocess on Windows often misses PATH ──────────────
    import shutil as _shutil
    import sys as _sys

    npm_cmd = _shutil.which("npm")

    if not npm_cmd:
        # Search common Node.js install locations (Windows + macOS + Linux)
        candidates = [
            # Windows
            r"C:\Program Files\nodejs\npm.cmd",
            r"C:\Program Files (x86)\nodejs\npm.cmd",
            _os.path.expandvars(r"%APPDATA%\npm\npm.cmd"),
            _os.path.expandvars(r"%ProgramFiles%\nodejs\npm.cmd"),
            # macOS / Linux via nvm, brew, system
            _os.path.expanduser("~/.nvm/versions/node/$(node -e 'process.version' 2>/dev/null)/bin/npm"),
            "/usr/local/bin/npm",
            "/usr/bin/npm",
            "/opt/homebrew/bin/npm",
        ]
        for c in candidates:
            if _os.path.isfile(c):
                npm_cmd = c
                break

    if not npm_cmd:
        # Last resort: try with shell=True so the OS shell finds npm itself
        npm_cmd = "npm"
        use_shell = True
    else:
        use_shell = False

    try:
        if use_shell:
            # shell=True lets Windows cmd.exe / bash resolve npm from PATH
            result = subprocess.run(
                f"npm update aniwatch",
                cwd=consumet_dir,
                capture_output=True,
                text=True,
                timeout=180,
                shell=True,
            )
        else:
            result = subprocess.run(
                [npm_cmd, "update", "aniwatch"],
                cwd=consumet_dir,
                capture_output=True,
                text=True,
                timeout=180,
                shell=False,
            )
        success = result.returncode == 0
        return JSONResponse(content={
            "success": success,
            "consumet_dir": consumet_dir,
            "npm_used": npm_cmd,
            "stdout": result.stdout[-3000:],
            "stderr": result.stderr[-3000:],
            "returncode": result.returncode,
            "next_step": (
                "Update succeeded! Now restart the sidecar: open a terminal in consumet-local and run 'node server.cjs'"
                if success
                else "npm update failed. Try running manually: cd consumet-local && npm update aniwatch && node server.cjs"
            ),
        })
    except subprocess.TimeoutExpired:
        return JSONResponse(
            status_code=504,
            content={"success": False, "error": "npm update timed out after 3 minutes. Run it manually."},
        )
    except FileNotFoundError:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": (
                    f"npm not found even after searching common locations. "
                    f"Please run manually: cd consumet-local && npm update aniwatch && node server.cjs"
                ),
                "searched": candidates if not _shutil.which("npm") else [],
            },
        )
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(exc)},
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
