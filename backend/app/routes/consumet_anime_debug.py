import logging

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.services.consumet import get_consumet_api_base
from .consumet_helpers import _title_score, _safe_error_body, _build_sidecar_hint

debug_router = APIRouter()
logger = logging.getLogger("consumet.routes")


# ---------------------------------------------------------------------------
#  /anime/debug-stream  — same pipeline but returns every intermediate result
# ---------------------------------------------------------------------------

@debug_router.get("/anime/debug-stream")
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
#  /anime/update-aniwatch  — runs npm update aniwatch in consumet-local
# ---------------------------------------------------------------------------

@debug_router.get("/anime/update-aniwatch")
async def update_aniwatch_package():
    """
    Run 'npm update aniwatch' in the consumet-local directory.
    Call this when HiAnime streams fail with MegaCloud key errors.
    After the update, restart the sidecar manually: node server.cjs
    """
    import subprocess
    import os as _os

    this_dir = _os.path.dirname(_os.path.abspath(__file__))
    project_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.dirname(this_dir))))
    consumet_dir = _os.path.join(project_root, "consumet-local")

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

    import shutil as _shutil

    npm_cmd = _shutil.which("npm")
    use_shell = False

    if not npm_cmd:
        candidates = [
            r"C:\Program Files\nodejs\npm.cmd",
            r"C:\Program Files (x86)\nodejs\npm.cmd",
            _os.path.expandvars(r"%APPDATA%\npm\npm.cmd"),
            _os.path.expandvars(r"%ProgramFiles%\nodejs\npm.cmd"),
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
        npm_cmd = "npm"
        use_shell = True

    try:
        if use_shell:
            result = subprocess.run(
                "npm update aniwatch",
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
                    "npm not found even after searching common locations. "
                    "Please run manually: cd consumet-local && npm update aniwatch && node server.cjs"
                ),
            },
        )
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(exc)},
        )
