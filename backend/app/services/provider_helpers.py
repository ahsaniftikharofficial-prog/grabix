"""
provider_helpers.py — pure helper functions, stream utilities, and source mapping.

No adapter or registry imports — safe to import from anywhere.
"""
from __future__ import annotations

import asyncio
import re
from typing import Any

from app.services.consumet import fetch_anime_episodes, fetch_anime_watch
from app.services.provider_types import ProviderServiceError


# ── Title utilities ───────────────────────────────────────────────────────────

def _unique_titles(values: list[str]) -> list[str]:
    seen: set[str] = set()
    results: list[str] = []
    for raw in values:
        title = (raw or "").strip()
        if not title:
            continue
        if title not in seen:
            seen.add(title)
            results.append(title)
        simplified = re.sub(r"\(.*?\)", "", title).strip()
        simplified = re.sub(r"[:\\-|].*$", "", simplified).strip()
        if simplified and simplified not in seen:
            seen.add(simplified)
            results.append(simplified)
    return results


def _normalize_title_for_match(value: str) -> str:
    lowered = re.sub(r"[^a-z0-9]+", " ", str(value or "").lower())
    lowered = re.sub(r"\bseason\s+\d+\b", " ", lowered)
    lowered = re.sub(r"\s+", " ", lowered).strip()
    return lowered


def _anime_title_match_score(candidate_title: str, query_titles: list[str]) -> float:
    candidate = _normalize_title_for_match(candidate_title)
    if not candidate:
        return 0.0

    best = 0.0
    candidate_tokens = set(candidate.split())
    for query_title in query_titles:
        query = _normalize_title_for_match(query_title)
        if not query:
            continue
        score = 0.0
        if candidate == query:
            score += 10.0
        if candidate.startswith(query) or query.startswith(candidate):
            score += 4.0
        if query in candidate or candidate in query:
            score += 3.0
        query_tokens = set(query.split())
        if query_tokens:
            score += (len(candidate_tokens & query_tokens) / len(query_tokens)) * 3.0
        best = max(best, score)
    return best


async def _discover_anime_candidates_by_title(
    *,
    titles: list[str],
    existing_candidates: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    from app.services.consumet import search_domain

    title_candidates = _unique_titles(titles)[:4]
    if not title_candidates:
        return list(existing_candidates or [])

    merged: list[dict[str, Any]] = []
    seen: set[str] = set()

    for candidate in existing_candidates or []:
        provider_name = str(candidate.get("provider") or "hianime").strip() or "hianime"
        anime_id = str(candidate.get("anime_id") or candidate.get("animeId") or candidate.get("id") or "").strip()
        if not anime_id:
            continue
        key = f"{provider_name}:{anime_id}"
        if key in seen:
            continue
        seen.add(key)
        merged.append(candidate)

    fallback_providers = ("animekai", "kickassanime", "animepahe")
    search_results = await asyncio.gather(
        *[
            search_domain("anime", title, provider=provider_name, page=1)
            for provider_name in fallback_providers
            for title in title_candidates
        ],
        return_exceptions=True,
    )

    result_index = 0
    for provider_name in fallback_providers:
        added_for_provider = 0
        for _title in title_candidates:
            result = search_results[result_index]
            result_index += 1
            if isinstance(result, Exception):
                continue
            ranked_items = sorted(
                list(result.get("items") or []),
                key=lambda item: _anime_title_match_score(
                    str(item.get("title") or item.get("alt_title") or ""),
                    title_candidates,
                ),
                reverse=True,
            )
            for item in ranked_items:
                anime_id = str(item.get("id") or "").strip()
                if not anime_id:
                    continue
                if _anime_title_match_score(
                    str(item.get("title") or item.get("alt_title") or ""),
                    title_candidates,
                ) < 1.5:
                    continue
                key = f"{provider_name}:{anime_id}"
                if key in seen:
                    continue
                seen.add(key)
                merged.append(
                    {
                        "provider": provider_name,
                        "anime_id": anime_id,
                        "title": str(item.get("title") or "").strip(),
                        "alt_title": str(item.get("alt_title") or "").strip(),
                    }
                )
                added_for_provider += 1
                if added_for_provider >= 2:
                    break
            if added_for_provider >= 2:
                break

    return merged


# ── Stream kind inference ─────────────────────────────────────────────────────

def _infer_stream_kind(url: str, mime_type: str | None = None) -> str:
    lowered = (url or "").lower()
    mime = (mime_type or "").lower()
    if ".m3u8" in lowered or "mpegurl" in mime:
        return "hls"
    if any(token in mime for token in ("video/", "audio/", "mp4", "webm", "matroska")):
        return "direct"
    if any(lowered.endswith(ext) for ext in (".mp4", ".m4v", ".mov", ".webm", ".mkv")):
        return "direct"
    return "embed"


# ── Source builders ───────────────────────────────────────────────────────────

def _stream_source(
    *,
    source_id: str,
    label: str,
    provider: str,
    kind: str,
    url: str,
    description: str = "",
    quality: str = "Auto",
    mime_type: str | None = None,
    file_name: str | None = None,
    external_url: str | None = None,
    can_extract: bool = False,
    subtitles: list[dict[str, Any]] | None = None,
    request_headers: dict[str, str] | None = None,
    language: str | None = None,
) -> dict[str, Any]:
    return {
        "id": source_id,
        "label": label,
        "provider": provider,
        "kind": kind,
        "url": url,
        "requestHeaders": request_headers or {},
        "language": language or "",
        "description": description,
        "quality": quality,
        "mimeType": mime_type or "",
        "fileName": file_name or "",
        "externalUrl": external_url or url,
        "canExtract": can_extract,
        "subtitles": subtitles or [],
    }


def _source_dedup_key(source: dict[str, Any]) -> str:
    return "|".join(
        [
            str(source.get("provider") or "").strip().lower(),
            str(source.get("externalUrl") or source.get("url") or "").strip().lower(),
            str(source.get("language") or "").strip().lower(),
        ]
    )


def merge_provider_source_groups(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for group in groups:
        for source in group.get("sources") or []:
            if not isinstance(source, dict) or not source.get("url"):
                continue
            key = _source_dedup_key(source)
            if key in seen:
                continue
            seen.add(key)
            merged.append(
                {
                    **source,
                    "description": source.get("description") or f"{group.get('label') or 'Provider'} source",
                }
            )
    return merged


# ── Payload builders ──────────────────────────────────────────────────────────

def _attempt_payload(
    *,
    provider: str,
    operation: str,
    success: bool,
    message: str,
    fallback_used: bool,
    retryable: bool = True,
) -> dict[str, Any]:
    return {
        "provider": provider,
        "operation": operation,
        "success": success,
        "message": message,
        "fallback_used": fallback_used,
        "retryable": retryable,
    }


def _resolution_payload(
    *,
    correlation_id: str,
    groups: list[dict[str, Any]],
    attempts: list[dict[str, Any]],
    primary_provider: str,
) -> dict[str, Any]:
    sources = merge_provider_source_groups(groups)
    fallback_used = any(item.get("fallback_used") and item.get("success") for item in attempts)
    return {
        "correlation_id": correlation_id,
        "primary_provider": primary_provider,
        "fallback_used": fallback_used,
        "sources": sources,
        "attempts": attempts,
        "error": None,
    }


# ── Consumet watch mapping ────────────────────────────────────────────────────

def _map_consumet_watch_payload(provider: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    headers = dict(payload.get("headers") or {})
    if not headers:
        headers = {"Referer": "https://megacloud.blog/"}

    # HiAnime / consumet returns subtitles at the TOP LEVEL of the payload,
    # NOT inside each individual source object.  Using source.get("subtitles")
    # always yields [] and makes the CC button say "off" even for sub episodes.
    payload_subtitles: list[dict[str, Any]] = list(payload.get("subtitles") or [])

    # Embed-only URLs (raw megacloud.blog pages) cannot be played by a video
    # element -- they require an iframe. Filter them out here so the backend
    # never returns fake sources that open the player but never load.
    _EMBED_URL_PATTERNS = ("megacloud.blog", "megacloud.tv", "rapid-cloud.co")

    mapped: list[dict[str, Any]] = []
    for index, source in enumerate(payload.get("sources") or []):
        if not isinstance(source, dict) or not source.get("url"):
            continue
        url_str = str(source.get("url") or "")
        is_m3u8 = bool(source.get("isM3U8"))
        # Skip raw embed page URLs unless they are explicitly marked as M3U8
        if not is_m3u8 and any(p in url_str for p in _EMBED_URL_PATTERNS):
            continue
        # Prefer any source-level subtitles (rare), fall back to payload-level.
        effective_subtitles = list(source.get("subtitles") or []) or payload_subtitles
        mapped.append(
            _stream_source(
                source_id=str(source.get("id") or f"{provider}-watch-{index}"),
                label=str(source.get("label") or source.get("quality") or f"Source {index + 1}"),
                provider=str(source.get("provider") or f"Consumet {provider}"),
                kind=str(source.get("kind") or ("hls" if source.get("isM3U8") else _infer_stream_kind(str(source.get("url") or ""), str(source.get("mimeType") or "")))),
                url=str(source.get("url") or ""),
                description=str(source.get("description") or f"{provider} source"),
                quality=str(source.get("quality") or "Auto"),
                mime_type=str(source.get("mimeType") or ""),
                external_url=str(source.get("externalUrl") or source.get("url") or ""),
                can_extract=bool(source.get("canExtract", False)),
                subtitles=effective_subtitles,
                request_headers=headers,
                language=str(source.get("language") or ""),
            )
        )
    return mapped


# ── Direct anime provider resolution ─────────────────────────────────────────

async def _resolve_direct_anime_provider_sources(
    *,
    provider_name: str,
    anime_id: str,
    episode_id: str,
    episode_number: int,
    audio: str,
    server: str,
) -> tuple[list[dict[str, Any]], str]:
    from fastapi import HTTPException

    resolved_episode_id = episode_id
    if not resolved_episode_id:
        details = await fetch_anime_episodes(provider=provider_name, media_id=anime_id)
        items = list(details.get("items") or [])
        selected = None
        for item in items:
            try:
                if int(item.get("number") or 0) == episode_number:
                    selected = item
                    break
            except Exception:
                continue
        if selected is None and items:
            selected = items[0]
        resolved_episode_id = str((selected or {}).get("id") or "").strip()

    if not resolved_episode_id:
        raise HTTPException(status_code=404, detail=f"No episode metadata was found for episode {episode_number}.")

    payload = await fetch_anime_watch(
        provider=provider_name,
        episode_id=resolved_episode_id,
        server=None if server == "auto" else server,
        audio=audio,
    )
    return _map_consumet_watch_payload(provider_name, payload), resolved_episode_id


# ── Embed provider constants ──────────────────────────────────────────────────

EMBED_PROVIDERS: list[dict[str, Any]] = [
    {
        "id": "vidsrc-mov",
        "label": "Server 1",
        "provider": "VidSrc.mov",
        "movie": "https://vidsrc.mov/embed/movie/{id}",
        "tv": "https://vidsrc.mov/embed/tv/{id}/1/1",
        "episode": "https://vidsrc.mov/embed/tv/{id}/{season}/{episode}",
        "movie_id_type": "tmdb",
        "tv_id_type": "tmdb",
        "can_extract": True,
    },
    {
        "id": "vidsrc-to",
        "label": "Server 2",
        "provider": "VidSrc.to",
        "movie": "https://vidsrc.to/embed/movie/{id}",
        "tv": "https://vidsrc.to/embed/tv/{id}/1/1",
        "episode": "https://vidsrc.to/embed/tv/{id}/{season}/{episode}",
        "movie_id_type": "tmdb",
        "tv_id_type": "tmdb",
        "can_extract": True,
    },
    {
        "id": "vidsrc-me",
        "label": "Server 3",
        "provider": "VidSrc.me",
        "movie": "https://vidsrc.me/embed/movie?imdb={id}",
        "tv": "https://vidsrc.me/embed/tv?imdb={id}&season=1&episode=1",
        "episode": "https://vidsrc.me/embed/tv?imdb={id}&season={season}&episode={episode}",
        "movie_id_type": "imdb",
        "tv_id_type": "imdb",
        "can_extract": True,
    },
    {
        "id": "2embed",
        "label": "Server 4",
        "provider": "2embed",
        "movie": "https://www.2embed.cc/embed/{id}",
        "tv": "https://www.2embed.cc/embedtv/{id}&s=1&e=1",
        "episode": "https://www.2embed.cc/embedtv/{id}&s={season}&e={episode}",
        "movie_id_type": "imdb",
        "tv_id_type": "imdb",
        "can_extract": True,
    },
    {
        "id": "multiembed",
        "label": "Server 5",
        "provider": "Multiembed",
        "movie": "https://multiembed.mov/?video_id={id}&tmdb=1",
        "tv": "https://multiembed.mov/?video_id={id}&tmdb=1&s=1&e=1",
        "episode": "https://multiembed.mov/?video_id={id}&tmdb=1&s={season}&e={episode}",
        "movie_id_type": "tmdb",
        "tv_id_type": "tmdb",
        "can_extract": False,
    },
]


def _build_provider_sources(
    *,
    media_type: str,
    tmdb_id: int | None = None,
    imdb_id: str | None = None,
    season: int = 1,
    episode: int = 1,
    trailer_url: str | None = None,
) -> list[dict[str, Any]]:
    source_kind = "movie" if media_type == "movie" else "tv"
    sources: list[dict[str, Any]] = []
    ids = {"tmdb": str(tmdb_id) if tmdb_id else "", "imdb": (imdb_id or "").strip()}
    suffix = f"-s{season}e{episode}" if source_kind == "tv" else ""

    for provider in EMBED_PROVIDERS:
        id_type = provider["movie_id_type"] if source_kind == "movie" else provider["tv_id_type"]
        provider_id = ids.get(id_type, "")
        if not provider_id:
            continue
        template = provider["movie"] if source_kind == "movie" else provider["episode"]
        url = (
            template.replace("{id}", provider_id)
            .replace("{season}", str(season))
            .replace("{episode}", str(episode))
        )
        sources.append(
            _stream_source(
                source_id=f"{provider['id']}{suffix}",
                label=provider["label"],
                provider=provider["provider"],
                kind="embed",
                url=url,
                description=f"{provider['provider']} fallback source",
                quality="Auto",
                external_url=url,
                can_extract=bool(provider["can_extract"]),
            )
        )

    if trailer_url:
        sources.append(
            _stream_source(
                source_id="trailer-fallback",
                label="Trailer",
                provider="Fallback",
                kind="embed",
                url=trailer_url,
                description="Trailer fallback when the main stream is unavailable",
                quality="Preview",
                external_url=trailer_url,
                can_extract=False,
            )
        )

    return sources
