import logging

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.services.consumet import get_consumet_api_base
from .consumet_helpers import _title_score, _safe_error_body, _build_sidecar_hint

stream_router = APIRouter()
logger = logging.getLogger("consumet.routes")


# ---------------------------------------------------------------------------
#  /anime/stream  — GogoAnime + AnimePahe primary pipeline (HiAnime removed)
#
#  Steps:  GogoAnime search → episodes → stream
#          Fallback 1: AnimePahe search → episodes → stream
#          Fallback 2: HiAnime (last resort, likely down)
# ---------------------------------------------------------------------------

@stream_router.get("/anime/stream")
async def consumet_anime_stream(
    title: str = Query(..., min_length=1, description="Anime title to search for"),
    episode: int = Query(1, ge=1, description="Episode number (1-based)"),
    audio: str = Query("sub", description="'sub' or 'dub'"),
    anime_id: str | None = Query(None, description="Optional known GogoAnime ID — skips search"),
    alt_title: str | None = Query(None, description="Alt title to try if primary search fails"),
):
    """
    Full anime streaming pipeline — GogoAnime first, AnimePahe fallback.
    Returns stream sources + subtitles, or a detailed error with _attempt_errors.
    """
    import httpx
    from urllib.parse import quote as urlquote

    base = get_consumet_api_base()
    category = "dub" if audio.strip().lower() == "dub" else "sub"
    gogo_dubbed = category == "dub"

    # Build list of titles to try
    search_titles: list[str] = [title]
    if alt_title and alt_title.strip() and alt_title.strip() != title.strip():
        search_titles.append(alt_title.strip())

    attempt_errors: list[str] = []

    async with httpx.AsyncClient(timeout=40.0, follow_redirects=True) as client:

        # ══════════════════════════════════════════════════════════════════════
        #  PRIMARY PATH: GogoAnime
        # ══════════════════════════════════════════════════════════════════════

        # ── Step 1-G: Search GogoAnime ────────────────────────────────────────
        gogo_anime_id: str | None = anime_id  # allow caller to pass a known id
        gogo_ep_id: str | None = None

        if not gogo_anime_id:
            for search_term in search_titles:
                try:
                    # GogoAnime dub titles often have "(Dub)" suffix
                    query = f"{search_term} (Dub)" if gogo_dubbed else search_term
                    r = await client.get(
                        f"{base}/anime/gogoanime/{urlquote(query, safe='')}",
                        timeout=15.0,
                    )
                    if r.status_code >= 400:
                        attempt_errors.append(
                            f"gogoanime/search/{search_term}: HTTP {r.status_code} — {_safe_error_body(r)}"
                        )
                        # Also try without (Dub) suffix on failure
                        if gogo_dubbed:
                            r2 = await client.get(
                                f"{base}/anime/gogoanime/{urlquote(search_term, safe='')}",
                                timeout=15.0,
                            )
                            if r2.status_code < 400:
                                r = r2
                            else:
                                continue
                        else:
                            continue

                    results = r.json().get("results") or []
                    if not results:
                        attempt_errors.append(f"gogoanime/search/{search_term}: no results")
                        continue

                    # Prefer results matching the dub/sub preference
                    if gogo_dubbed:
                        dub_results = [x for x in results if "dub" in str(x.get("title", "")).lower()]
                        scored_pool = dub_results if dub_results else results
                    else:
                        sub_results = [x for x in results if "dub" not in str(x.get("title", "")).lower()]
                        scored_pool = sub_results if sub_results else results

                    best = max(scored_pool, key=lambda x: _title_score(str(x.get("title", "")), search_term))
                    gogo_anime_id = str(best.get("id", "")).strip()
                    if gogo_anime_id:
                        logger.info("anime/stream: GogoAnime resolved '%s' → id=%s", search_term, gogo_anime_id)
                        break
                except Exception as exc:
                    attempt_errors.append(f"gogoanime/search/{search_term}: exception — {exc}")
                    logger.warning("anime/stream: GogoAnime search failed for '%s': %s", search_term, exc)

        # ── Step 2-G: Get GogoAnime episode list ──────────────────────────────
        if gogo_anime_id:
            try:
                r2 = await client.get(
                    f"{base}/anime/gogoanime/info/{urlquote(gogo_anime_id, safe='')}",
                    timeout=20.0,
                )
                if r2.status_code < 400:
                    episodes = r2.json().get("episodes") or []
                    ep_obj = next((e for e in episodes if e.get("number") == episode), None)
                    if ep_obj is None and episodes:
                        idx = min(episode - 1, len(episodes) - 1)
                        ep_obj = episodes[idx]
                    if ep_obj:
                        gogo_ep_id = str(ep_obj.get("id") or ep_obj.get("episodeId") or "").strip()
                        logger.info(
                            "anime/stream: GogoAnime ep%d id=%s for anime=%s",
                            episode, gogo_ep_id, gogo_anime_id,
                        )
                    else:
                        attempt_errors.append(f"gogoanime/info: ep{episode} not in episode list")
                else:
                    attempt_errors.append(
                        f"gogoanime/info/{gogo_anime_id}: HTTP {r2.status_code} — {_safe_error_body(r2)}"
                    )
            except Exception as exc:
                attempt_errors.append(f"gogoanime/info: exception — {exc}")
                logger.warning("anime/stream: GogoAnime info failed for id=%s: %s", gogo_anime_id, exc)

        # ── Step 3-G: Get GogoAnime stream ────────────────────────────────────
        if gogo_ep_id:
            try:
                rw = await client.get(
                    f"{base}/anime/gogoanime/watch",
                    params={"episodeId": gogo_ep_id},
                    timeout=25.0,
                )
                if rw.status_code < 400:
                    wd = rw.json()
                    sources = wd.get("sources") or []
                    # Prefer m3u8 / non-backup sources
                    playable = [
                        s for s in sources
                        if s.get("url") and (
                            s.get("isM3U8")
                            or ".m3u8" in str(s.get("url", ""))
                            or str(s.get("quality", "")).lower() not in ("backup", "")
                        )
                    ] or sources
                    if playable:
                        logger.info(
                            "anime/stream: ✓ GogoAnime success for '%s' ep%d (%d sources)",
                            title, episode, len(playable),
                        )
                        return JSONResponse(content={
                            "sources": playable,
                            "subtitles": wd.get("subtitles") or [],
                            "headers": wd.get("headers") or {},
                            "_provider": "gogoanime",
                            "_anime_id": gogo_anime_id,
                            "_episode_id": gogo_ep_id,
                            "_category_used": category,
                        })
                    else:
                        attempt_errors.append(f"gogoanime/watch: 200 OK but no sources for ep_id={gogo_ep_id}")
                else:
                    attempt_errors.append(
                        f"gogoanime/watch: HTTP {rw.status_code} — {_safe_error_body(rw)}"
                    )
            except Exception as exc:
                attempt_errors.append(f"gogoanime/watch: exception — {exc}")
                logger.warning("anime/stream: GogoAnime watch failed for ep_id=%s: %s", gogo_ep_id, exc)

        # ══════════════════════════════════════════════════════════════════════
        #  FALLBACK 1: AnimePahe
        # ══════════════════════════════════════════════════════════════════════

        logger.info("anime/stream: GogoAnime failed, trying AnimePahe for '%s' ep%d", title, episode)

        pahe_anime_id: str | None = None
        pahe_ep_id: str | None = None

        for search_term in search_titles:
            try:
                pr = await client.get(
                    f"{base}/anime/animepahe/{urlquote(search_term, safe='')}",
                    timeout=15.0,
                )
                if pr.status_code >= 400:
                    attempt_errors.append(
                        f"animepahe/search/{search_term}: HTTP {pr.status_code} — {_safe_error_body(pr)}"
                    )
                    continue
                pahe_results = pr.json().get("results") or []
                if not pahe_results:
                    attempt_errors.append(f"animepahe/search/{search_term}: no results")
                    continue
                best_pahe = max(
                    pahe_results,
                    key=lambda x: _title_score(str(x.get("title", "")), search_term),
                )
                pahe_anime_id = str(best_pahe.get("id", "")).strip()
                if pahe_anime_id:
                    logger.info("anime/stream: AnimePahe resolved '%s' → id=%s", search_term, pahe_anime_id)
                    break
            except Exception as exc:
                attempt_errors.append(f"animepahe/search/{search_term}: exception — {exc}")
                logger.warning("anime/stream: AnimePahe search failed for '%s': %s", search_term, exc)

        if pahe_anime_id:
            try:
                pi_r = await client.get(
                    f"{base}/anime/animepahe/info/{urlquote(pahe_anime_id, safe='')}",
                    timeout=20.0,
                )
                if pi_r.status_code < 400:
                    pahe_eps = pi_r.json().get("episodes") or []
                    pahe_ep = next((e for e in pahe_eps if e.get("number") == episode), None)
                    if pahe_ep is None and pahe_eps:
                        idx = min(episode - 1, len(pahe_eps) - 1)
                        pahe_ep = pahe_eps[idx]
                    if pahe_ep:
                        pahe_ep_id = str(pahe_ep.get("id") or pahe_ep.get("episodeId") or "").strip()
                else:
                    attempt_errors.append(
                        f"animepahe/info/{pahe_anime_id}: HTTP {pi_r.status_code} — {_safe_error_body(pi_r)}"
                    )
            except Exception as exc:
                attempt_errors.append(f"animepahe/info: exception — {exc}")
                logger.warning("anime/stream: AnimePahe info failed for id=%s: %s", pahe_anime_id, exc)

        if pahe_ep_id:
            try:
                ps_r = await client.get(
                    f"{base}/anime/animepahe/watch",
                    params={"episodeId": pahe_ep_id},
                    timeout=20.0,
                )
                if ps_r.status_code < 400:
                    ps_data = ps_r.json()
                    pahe_sources = ps_data.get("sources") or []
                    if pahe_sources:
                        logger.info(
                            "anime/stream: ✓ AnimePahe success for '%s' ep%d (%d sources)",
                            title, episode, len(pahe_sources),
                        )
                        return JSONResponse(content={
                            "sources": pahe_sources,
                            "subtitles": ps_data.get("subtitles") or [],
                            "headers": ps_data.get("headers") or {},
                            "_provider": "animepahe",
                            "_anime_id": pahe_anime_id,
                            "_episode_id": pahe_ep_id,
                            "_category_used": category,
                        })
                    else:
                        attempt_errors.append(f"animepahe/watch: 200 OK but no sources for ep_id={pahe_ep_id}")
                else:
                    attempt_errors.append(
                        f"animepahe/watch: HTTP {ps_r.status_code} — {_safe_error_body(ps_r)}"
                    )
            except Exception as exc:
                attempt_errors.append(f"animepahe/watch: exception — {exc}")
                logger.warning("anime/stream: AnimePahe watch failed for ep_id=%s: %s", pahe_ep_id, exc)

        # ══════════════════════════════════════════════════════════════════════
        #  FALLBACK 2: HiAnime (last resort — likely down, kept for future use)
        # ══════════════════════════════════════════════════════════════════════

        import asyncio as _asyncio

        fallback_category = "sub" if category == "dub" else "dub"
        hianime_id: str | None = None
        hianime_ep_id: str | None = None

        for search_term in search_titles:
            try:
                r = await client.get(
                    f"{base}/anime/hianime/{urlquote(search_term, safe='')}",
                    timeout=10.0,
                )
                if r.status_code < 400:
                    results = r.json().get("results") or []
                    if results:
                        best = max(results, key=lambda x: _title_score(str(x.get("title", "")), search_term))
                        hianime_id = str(best.get("id", "")).strip()
                        if hianime_id:
                            break
            except Exception:
                pass  # HiAnime is expected to be down — silent failure

        if hianime_id:
            try:
                r2 = await client.get(
                    f"{base}/anime/hianime/info",
                    params={"id": hianime_id},
                    timeout=15.0,
                )
                if r2.status_code < 400:
                    episodes = r2.json().get("episodes") or []
                    ep_obj = next((e for e in episodes if e.get("number") == episode), None)
                    if ep_obj is None and episodes:
                        idx = min(episode - 1, len(episodes) - 1)
                        ep_obj = episodes[idx]
                    if ep_obj:
                        hianime_ep_id = str(ep_obj.get("id") or ep_obj.get("episodeId") or "").strip()
            except Exception:
                pass

        if hianime_ep_id:
            servers = ["vidstreaming", "vidcloud", "t-cloud"]

            async def _try_hianime_watch(srv: str, cat: str):
                try:
                    rw = await client.get(
                        f"{base}/anime/hianime/watch/{urlquote(hianime_ep_id, safe='')}",
                        params={"server": srv, "category": cat},
                        timeout=20.0,
                    )
                    if rw.status_code < 400:
                        d = rw.json()
                        if d.get("sources"):
                            return d, None
                        return None, f"hianime/{srv}/{cat}: no sources"
                    return None, f"hianime/{srv}/{cat}: HTTP {rw.status_code}"
                except Exception as exc:
                    return None, f"hianime/{srv}/{cat}: exception — {exc}"

            combos = [(srv, cat) for cat in [category, fallback_category] for srv in servers]
            hi_results = await _asyncio.gather(*[_try_hianime_watch(s, c) for s, c in combos])
            for d, err in hi_results:
                if err:
                    attempt_errors.append(err)
                if d:
                    logger.info("anime/stream: ✓ HiAnime fallback succeeded for '%s' ep%d", title, episode)
                    return JSONResponse(content={
                        **d,
                        "_provider": "hianime",
                        "_anime_id": hianime_id,
                        "_episode_id": hianime_ep_id,
                        "_category_used": category,
                        "_fallback": "hianime",
                    })

        # ── All providers failed ──────────────────────────────────────────────
        hint = _build_sidecar_hint(attempt_errors)
        logger.error(
            "anime/stream: all providers failed for '%s' ep%d. Errors: %s",
            title, episode, attempt_errors,
        )
        return JSONResponse(
            status_code=502,
            content={
                "sources": [],
                "subtitles": [],
                "error": (
                    f"No playable stream found for '{title}' episode {episode}. "
                    f"Tried GogoAnime → AnimePahe → HiAnime. "
                    f"{hint}"
                ),
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
#  /watch/anime/raw  — raw pass-through: GogoAnime first, HiAnime fallback
# ---------------------------------------------------------------------------

@stream_router.get("/watch/anime/raw")
async def consumet_watch_anime_raw(
    episode_id: str = Query(..., min_length=1),
    server: str = Query("vidcloud"),
    category: str = Query("sub"),
):
    """
    Raw episode watch — tries GogoAnime first (episode_id as gogoanime ep id),
    then HiAnime as fallback.
    """
    import httpx
    from urllib.parse import quote as urlquote

    base = get_consumet_api_base()
    attempt_errors: list[str] = []

    async with httpx.AsyncClient(timeout=35.0, follow_redirects=True) as client:

        # Try GogoAnime first
        try:
            r = await client.get(
                f"{base}/anime/gogoanime/watch",
                params={"episodeId": episode_id},
                timeout=20.0,
            )
            if r.status_code < 400:
                data = r.json()
                sources = data.get("sources") or []
                if sources:
                    data["_server_used"] = "gogoanime"
                    data["_category_used"] = category
                    return JSONResponse(content=data)
                attempt_errors.append("gogoanime/watch: 200 OK but no sources")
            else:
                attempt_errors.append(f"gogoanime/watch: HTTP {r.status_code} — {_safe_error_body(r)}")
        except Exception as exc:
            attempt_errors.append(f"gogoanime/watch: exception — {exc}")

        # HiAnime fallback
        hianime_url = f"{base}/anime/hianime/watch/{urlquote(episode_id, safe='')}"
        servers_to_try = (
            ["vidcloud", "vidstreaming"] if server in ("auto", "", "vidcloud")
            else ["vidstreaming", "vidcloud"] if server == "vidstreaming"
            else [server]
        )
        for srv in servers_to_try:
            try:
                r = await client.get(hianime_url, params={"server": srv, "category": category})
                if r.status_code >= 400:
                    attempt_errors.append(f"hianime/{srv}: HTTP {r.status_code} — {_safe_error_body(r)}")
                    continue
                data = r.json()
                sources = data.get("sources") or []
                if not sources:
                    attempt_errors.append(f"hianime/{srv}: 200 OK but no sources")
                    continue
                data["_server_used"] = srv
                data["_category_used"] = category
                return JSONResponse(content=data)
            except Exception as exc:
                attempt_errors.append(f"hianime/{srv}: exception — {exc}")

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
