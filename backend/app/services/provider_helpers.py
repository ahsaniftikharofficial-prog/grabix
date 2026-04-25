"""
provider_helpers.py — pure helper functions, stream utilities, and source mapping.

No adapter or registry imports — safe to import from anywhere.
"""
from __future__ import annotations

import re
from typing import Any

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


# ── Embed provider constants ──────────────────────────────────────────────────

EMBED_PROVIDERS: list[dict[str, Any]] = [
    {
        "id": "vidsrc-to",
        "label": "Server 1",
        "provider": "VidSrc.to",
        "movie": "https://vidsrc.to/embed/movie/{id}",
        "tv": "https://vidsrc.to/embed/tv/{id}/1/1",
        "episode": "https://vidsrc.to/embed/tv/{id}/{season}/{episode}",
        "movie_id_type": "tmdb",
        "tv_id_type": "tmdb",
        "can_extract": True,
    },
    {
        "id": "vidsrc-mov",
        "label": "Server 2",
        "provider": "VidSrc.mov",
        "movie": "https://vidsrc.mov/embed/movie/{id}",
        "tv": "https://vidsrc.mov/embed/tv/{id}/1/1",
        "episode": "https://vidsrc.mov/embed/tv/{id}/{season}/{episode}",
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
