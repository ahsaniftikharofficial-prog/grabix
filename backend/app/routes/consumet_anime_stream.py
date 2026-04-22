import logging

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.services.consumet import get_consumet_api_base
from .consumet_helpers import _title_score, _safe_error_body, _build_sidecar_hint

stream_router = APIRouter()
logger = logging.getLogger("consumet.routes")


# ---------------------------------------------------------------------------
#  /anime/stream  — full anime.py pipeline, server-side
#
#  Steps:  search → pick best match → info/episodes → watch
#  Captures the real sidecar error body from every failed attempt (KEY FIX).
# ---------------------------------------------------------------------------

@stream_router.get("/anime/stream")
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

    base = get_consumet_api_base()
    category = "dub" if audio.strip().lower() == "dub" else "sub"
    fallback_category = "sub" if category == "dub" else "dub"
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
        import asyncio as _asyncio

        attempt_errors: list[str] = []

        async def _try_watch(srv: str, cat: str):
            try:
                watch_url = f"{base}/anime/hianime/watch/{urlquote(ep_id, safe='')}"
                r3 = await client.get(
                    watch_url,
                    params={"server": srv, "category": cat},
                    timeout=25.0,
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

        # ── Gogoanime fallback ───────────────────────────────────────────────
        try:
            logger.info("anime/stream: trying Gogoanime for '%s' ep%d", title, episode)
            gogo_dubbed = (category == "dub")
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
                gr = _gr
            if gr is None:
                raise RuntimeError("no gogoanime response")
            if gr.status_code < 400:
                gd = gr.json()
                gogo_sources = gd.get("sources") or []
                playable = [s for s in gogo_sources if s.get("url") and (
                    s.get("isM3U8") or ".m3u8" in str(s.get("url", "")) or
                    str(s.get("quality", "")).lower() not in ("backup", "")
                )]
                if not playable:
                    playable = gogo_sources
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

        # ── AnimePahe fallback ───────────────────────────────────────────────
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

        # All attempts failed
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
#  /anime/debug-watch/{ep_id}  — proxy to sidecar's MegaCloud diagnostic
# ---------------------------------------------------------------------------

@stream_router.get("/anime/debug-watch/{ep_id:path}")
async def consumet_anime_debug_watch(ep_id: str):
    """
    Proxies GET /anime/hianime/debug-watch/{ep_id} from the consumet sidecar.
    Use when /anime/debug-stream shows step 3 failing.
    """
    import httpx
    from urllib.parse import quote as urlquote

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

@stream_router.get("/watch/anime/raw")
async def consumet_watch_anime_raw(
    episode_id: str = Query(..., min_length=1),
    server: str = Query("vidcloud"),
    category: str = Query("sub"),
):
    import httpx
    from urllib.parse import quote as urlquote

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
