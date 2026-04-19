"""
backend/anime/resolver.py — Anime source resolution logic and FastAPI route.

Extracted from main.py (Phase 2 refactor). Contains:
  - _anime_server_order, _map_audio_category, _normalize_resolved_source
  - _extract_hianime_embed_source, _capture_hianime_stream_via_edge
  - _get_cached_anime_resolution, _set_cached_anime_resolution
  - _is_internal_managed_file, _validate_stream_url
  - _fallback_embed_sources, _race_hianime_megacloud, _race_fallback_provider
  - _resolve_fallback_provider
  - anime_resolve_source (the single route: POST /anime/resolve-source)

NOTE: _fetch_consumet_json is imported inside _race_fallback_provider from
app.services.consumet — this import does not currently exist in consumet.py
and will fail at runtime if that code path is hit. This is a pre-existing bug
in main.py preserved here as-is (Phase 3 task: replace with fetch_domain_info).

External imports:
  - fastapi: APIRouter, HTTPException, Request
  - pydantic: BaseModel
  - streaming_helpers: _extract_stream_url, _resolve_embed_target
  - app.services.consumet: fetch_anime_watch, search_domain
  - app.services.runtime_state: RuntimeStateRegistry (via runtime_state singleton)
  - app.services.logging_utils: get_logger, log_event
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx as _httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services.logging_utils import get_logger, log_event
from app.services.runtime_state import RuntimeStateRegistry
from streaming_helpers import _extract_stream_url, _resolve_embed_target

router = APIRouter()
backend_logger = get_logger("backend")

# ── Shared anime resolve cache (runtime_state singleton) ──────────────────────
# Imported lazily to avoid circular deps; bound at first use via _get_anime_cache()
_runtime_state: RuntimeStateRegistry | None = None


def _get_anime_cache() -> dict[str, tuple[float, dict]]:
    """Return the shared anime_resolve_cache from the runtime_state singleton."""
    global _runtime_state
    if _runtime_state is None:
        # Import here to avoid circular import at module load time
        from app.services import runtime_state as _rs_mod  # type: ignore[attr-defined]
        # The singleton is created in main.py; we grab it via the module attribute
        import main as _main_mod  # noqa: F401 — exists at runtime
        _runtime_state = _main_mod.runtime_state
    return _runtime_state.anime_resolve_cache


ANIME_RESOLVE_CACHE_TTL_SECONDS = 1500


class AnimeResolveRequest(BaseModel):
    episodeId:     str
    animeId:       str   = ""
    title:         str   = ""
    altTitle:      str   = ""
    episodeNumber: int   = 1
    audio:         str   = "original"
    server:        str   = "auto"
    isMovie:       bool  = False
    tmdbId:        int | None = None
    purpose:       str   = "play"

def _anime_server_order(server: str) -> list[str]:
    normalized = (server or "auto").strip().lower()
    if normalized in {"auto", ""}:
        return ["hd-1", "hd-2"]
    return [normalized]


def _map_audio_category(audio: str) -> str:
    return "dub" if str(audio or "").lower() == "en" else "sub"


def _normalize_resolved_source(
    *,
    source_url: str,
    kind: str,
    provider: str,
    selected_server: str,
    strategy: str,
    headers: dict[str, str] | None = None,
    subtitles: list[dict] | None = None,
    tried: list[dict] | None = None,
) -> dict:
    return {
        "source": {
            "url": source_url,
            "kind": kind,
            "headers": headers or {},
        },
        "subtitles": subtitles or [],
        "provider": provider,
        "selectedServer": selected_server,
        "strategy": strategy,
        "tried": tried or [],
    }


def _convert_hianime_source_payload(payload: dict, server: str, tried: list[dict]) -> dict | None:
    sources = payload.get("sources") or []
    subtitles = payload.get("subtitles") or []
    headers = payload.get("headers") or {}
    for item in sources:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or item.get("file") or item.get("src") or "").strip()
        if not url:
            continue
        kind = "hls" if item.get("isM3U8") or ".m3u8" in url.lower() else ("embed" if item.get("isEmbed") else "direct")
        if kind == "embed":
            continue
        return _normalize_resolved_source(
            source_url=url,
            kind=kind,
            provider="HiAnime",
            selected_server=server,
            strategy="hianime-direct",
            headers=headers,
            subtitles=subtitles,
            tried=tried,
        )
    return None


def _extract_hianime_embed_source(
    payload: dict,
    episode_id: str,
    server: str,
    tried: list[dict],
    *,
    allow_browser_capture: bool = True,
) -> dict | None:
    sources = payload.get("sources") or []
    subtitles = payload.get("subtitles") or []
    for item in sources:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or item.get("file") or item.get("src") or "").strip()
        if not url:
            continue
        kind = "hls" if item.get("isM3U8") or ".m3u8" in url.lower() else ("embed" if item.get("isEmbed") else "direct")
        if kind != "embed":
            continue

        try:
            resolved_url = _resolve_embed_target(url)
            direct_url, extracted_kind = _extract_stream_url(resolved_url)
            return _normalize_resolved_source(
                source_url=direct_url,
                kind=extracted_kind,
                provider="HiAnime",
                selected_server=server,
                strategy="hianime-embed-extract",
                headers={"Referer": resolved_url},
                subtitles=subtitles,
                tried=tried,
            )
        except Exception as exc:
            tried.append({"server": server, "stage": "hianime-embed-extract", "detail": str(exc)})

        if allow_browser_capture:
            try:
                captured = _capture_hianime_stream_via_edge(url, episode_id, server, tried)
                if captured:
                    captured["provider"] = "HiAnime"
                    captured["selectedServer"] = server
                    captured["strategy"] = "hianime-browser-capture"
                    if not captured.get("subtitles"):
                        captured["subtitles"] = subtitles
                    return captured
            except Exception as exc:
                tried.append({"server": server, "stage": "hianime-browser-capture", "detail": str(exc)})

    return None


def _capture_hianime_stream_via_edge(embed_url: str, watch_url: str, server: str, tried: list[dict]) -> dict | None:
    """
    Browser-based capture has been removed.
    The Selenium/Edge dependency is unreliable on most systems.
    The fallback provider chain handles unavailable streams instead.
    """
    tried.append({
        "server": server,
        "stage": "hianime-browser-capture",
        "detail": "Browser-based capture is disabled. Falling back to provider chain.",
    })
    return None


def _fallback_embed_sources(tmdb_id: int | None, season: int, episode: int) -> list[dict]:
    if not tmdb_id:
        return []
    providers = [
        ("VidSrc.mov", f"https://vidsrc.mov/embed/tv/{tmdb_id}/{season}/{episode}"),
    ]
    return [{"provider": provider, "url": url} for provider, url in providers]


def _get_cached_anime_resolution(payload) -> dict | None:
    key = f"{payload.episodeId}:{payload.audio}:{payload.server}"
    cache = _get_anime_cache()
    cached = cache.get(key)
    if not cached:
        return None
    expires_at, data = cached
    if expires_at <= time.time():
        cache.pop(key, None)
        return None
    return data


def _set_cached_anime_resolution(payload, data: dict) -> None:
    key = f"{payload.episodeId}:{payload.audio}:{payload.server}"
    _get_anime_cache()[key] = (time.time() + ANIME_RESOLVE_CACHE_TTL_SECONDS, data)


def _is_internal_managed_file(path) -> bool:
    name = getattr(path, "name", str(path))
    return name.endswith((".db", ".json", ".log")) or name.startswith(".")


def _resolve_fallback_provider(tmdb_id: int | None, season: int, episode: int, tried: list[dict]) -> dict | None:
    for candidate in _fallback_embed_sources(tmdb_id, season, episode):
        try:
            resolved_url = _resolve_embed_target(candidate["url"])
            direct_url, kind = _extract_stream_url(resolved_url)
            return _normalize_resolved_source(
                source_url=direct_url,
                kind=kind,
                provider=candidate["provider"],
                selected_server="fallback",
                strategy="fallback-provider",
                headers={"Referer": resolved_url},
                subtitles=[],
                tried=tried,
            )
        except Exception as exc:
            tried.append({"server": candidate["provider"], "stage": "fallback-provider", "detail": str(exc)})
            continue
    return None


async def _validate_stream_url(url: str, timeout: float = 5.0, request_headers: dict | None = None) -> bool:
    """
    Quick HEAD/GET check to confirm the stream URL actually responds.
    Returns True if the URL returns 200 or 206.
    Returns False on any error, timeout, or non-success status.
    Accepts optional request_headers (e.g. Referer) so CDN URLs don't get
    incorrectly rejected when the CDN requires a Referer header.
    """
    import httpx as _httpx
    check_headers = {"User-Agent": "Mozilla/5.0", **(request_headers or {})}
    try:
        async with _httpx.AsyncClient(
            timeout=_httpx.Timeout(connect=3.0, read=timeout, write=3.0, pool=3.0),
            follow_redirects=True,
        ) as client:
            # Try HEAD first (faster, no body download)
            r = await client.head(url, headers=check_headers)
            if r.status_code in (200, 206):
                return True
            # Some CDNs reject HEAD or require Referer — fall back to ranged GET
            if r.status_code in (403, 405, 501):
                r2 = await client.get(url, headers={**check_headers, "Range": "bytes=0-0"})
                return r2.status_code in (200, 206)
    except Exception as _exc:
        backend_logger.debug("_validate_stream_url probe failed: %s", _exc, exc_info=False)
    return False


async def _race_hianime_megacloud(
    episode_id: str,
    audio: str,
) -> dict | None:
    """
    Race-safe wrapper for the Python MegaCloud extractor.
    Normalizes output to match the shape returned by _race_fallback_provider.
    Returns None on failure.
    """
    from app.services.megacloud import try_extract_hianime_stream

    category = "dub" if str(audio or "").lower() == "en" else "sub"
    result = await try_extract_hianime_stream(
        episode_id=episode_id,
        category=category,
    )
    if not result:
        return None

    sources = result.get("sources") or []
    playable = [
        s for s in sources
        if isinstance(s, dict)
        and str(s.get("kind") or ("hls" if s.get("isM3U8") else "direct")).lower() in {"hls", "direct"}
    ]
    if not playable:
        return None

    stream_url = str(playable[0].get("url") or "").strip()
    if not stream_url:
        return None

    # MegaCloud streams are on bunnycdn — they always require a Referer
    # The extractor provides this in result["headers"]
    headers = dict(result.get("headers") or {})
    if not headers:
        headers = {"Referer": "https://megacloud.blog/"}

    # HiAnime streams go through the backend proxy, so we trust them without HEAD check
    return {
        "source": {
            "url": stream_url,
            "kind": "hls" if (playable[0].get("isM3U8") or ".m3u8" in stream_url.lower()) else "direct",
            "headers": headers,
        },
        "subtitles": result.get("subtitles") or [],
        "provider": "HiAnime",
        "selectedServer": "VidCloud",
        "strategy": "HiAnime MegaCloud Race Win",
    }


async def _race_fallback_provider(
    fb_provider: str,
    title: str,
    episode_number: int,
    audio: str,
    server: str,
) -> dict | None:
    """
    Try a single fallback provider for a stream URL.
    Returns a normalized resolution dict on success, or None on failure.
    Never raises — designed for asyncio.gather() races.

    Steps:
      1. Search provider by anime title
      2. Pick best matching result
      3. Fetch episode list
      4. Match episode by number
      5. Fetch stream, return first playable source
    """
    from app.services.consumet import search_domain, fetch_anime_watch, _fetch_consumet_json

    try:
        # Step 1 — search by title
        search_result = await search_domain("anime", title, provider=fb_provider, page=1)
        items = search_result.get("items") or []
        if not items:
            return None

        fb_anime_id = str(items[0].get("id") or "").strip()
        if not fb_anime_id:
            return None

        # Step 2 — fetch episode list
        if fb_provider == "animepahe":
            info_payload = await _fetch_consumet_json(
                f"/anime/{fb_provider}/info/{fb_anime_id}",
                ttl_seconds=300,
            )
        else:
            info_payload = await _fetch_consumet_json(
                f"/anime/{fb_provider}/info",
                params={"id": fb_anime_id},
                ttl_seconds=300,
            )

        episodes = info_payload.get("episodes") or []
        if not episodes:
            return None

        # Step 3 — match episode by number, fall back to first
        target_ep = next(
            (e for e in episodes if int(e.get("number") or 0) == episode_number),
            episodes[0],
        )
        fb_episode_id = str(target_ep.get("id") or "").strip()
        if not fb_episode_id:
            return None

        # Step 4 — fetch stream
        watch_data = await fetch_anime_watch(
            provider=fb_provider,
            episode_id=fb_episode_id,
            server=server,
            audio=audio,
        )
        sources = watch_data.get("sources") or []

        # Task 7: If user asked for dub, skip this provider if it only has sub
        category_requested = "dub" if str(audio or "").lower() == "en" else "sub"
        returned_category = str(watch_data.get("_category_used") or "sub").lower()
        if category_requested == "dub" and returned_category != "dub":
            return None

        playable = [
            s for s in sources
            if isinstance(s, dict)
            and str(s.get("kind") or "").lower() in {"hls", "direct"}
        ]
        if not playable:
            return None

        # Step 5 — validate the URL is reachable before declaring victory
        stream_url = str(playable[0].get("url") or "").strip()
        if not stream_url:
            return None

        provider_headers = dict(watch_data.get("headers") or {})
        if not await _validate_stream_url(stream_url, request_headers=provider_headers or None):
            return None

        return {
            "source": {
                "url": stream_url,
                "kind": str(playable[0].get("kind") or "hls"),
                "headers": dict(watch_data.get("headers") or {}),
            },
            "subtitles": watch_data.get("subtitles") or [],
            "provider": fb_provider,
            "selectedServer": playable[0].get("quality", server),
            "strategy": f"{fb_provider} Race Win",
        }

    except Exception:
        return None


@router.post("/resolve-source")
async def anime_resolve_source(payload: AnimeResolveRequest):
    cached = _get_cached_anime_resolution(payload)
    if cached:
        return cached

    episode_id = payload.episodeId.strip()
    if not episode_id:
        raise HTTPException(status_code=400, detail="episodeId is required")

    audio = payload.audio or "original"
    server = payload.server or "auto"
    title = payload.title or ""

    # ── Build the race ────────────────────────────────────────────────────────
    # All four providers fire simultaneously.
    # First to return a valid, reachable stream URL wins.
    # The others are cancelled immediately.

    tasks = []
    task_labels = []

    # Provider 1: Python MegaCloud extractor (HiAnime)
    tasks.append(asyncio.create_task(
        _race_hianime_megacloud(episode_id, audio),
        name="hianime_megacloud",
    ))
    task_labels.append("hianime_megacloud")

    # Providers 2-4: Fallback providers (only if we have a title to search with)
    if title:
        for fb_provider in ("animekai", "kickassanime", "animepahe"):
            tasks.append(asyncio.create_task(
                _race_fallback_provider(
                    fb_provider=fb_provider,
                    title=title,
                    episode_number=payload.episodeNumber or 1,
                    audio=audio,
                    server=server,
                ),
                name=fb_provider,
            ))
            task_labels.append(fb_provider)

    # ── Race: wait for first non-None result ─────────────────────────────────
    resolution = None
    pending = set(tasks)

    try:
        while pending and resolution is None:
            done, pending = await asyncio.wait(
                pending,
                return_when=asyncio.FIRST_COMPLETED,
                timeout=35.0,
            )
            if not done:
                # Timeout hit with no results
                break
            for finished_task in done:
                try:
                    result = finished_task.result()
                    if result is not None and resolution is None:
                        resolution = result
                except Exception as _exc:
                    backend_logger.debug("race task result retrieval failed: %s", _exc, exc_info=False)
    finally:
        # Cancel all remaining tasks — we have our winner (or have given up)
        for t in pending:
            t.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    if resolution is None:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "All stream providers failed. Try again in a moment.",
                "code": "all_providers_failed",
                "retryable": True,
            },
        )

    # ── Normalize and cache ───────────────────────────────────────────────────
    # Make sure HLS streams from HiAnime always have a Referer header set
    # so the backend proxy can forward it to the CDN
    source = resolution.get("source") or {}
    if not source.get("headers"):
        source["headers"] = {"Referer": "https://megacloud.blog/"}
        resolution["source"] = source

    _set_cached_anime_resolution(payload, resolution)
    return resolution


