"""
provider_resolvers.py — top-level playback resolution orchestration.

Ties together the registry, adapters, and helpers to resolve sources
for movies, TV shows, and anime.
"""
from __future__ import annotations

import asyncio
import uuid
from typing import Any

from app.services.provider_adapters import get_provider_registry
from app.services.provider_helpers import (
    _attempt_payload,
    _resolution_payload,
    _unique_titles,
)
from app.services.provider_registry import ProviderRegistry
from app.services.provider_types import ProviderServiceError


# ── Shared MovieBox resolution ────────────────────────────────────────────────

async def _resolve_moviebox_sources_by_title(
    *,
    registry: ProviderRegistry,
    correlation_id: str,
    titles: list[str],
    media_type: str,
    year: int | None = None,
    season: int = 1,
    episode: int = 1,
    prefer_hindi: bool = False,
    attempts: list[dict[str, Any]],
    fallback_used: bool = False,
) -> list[dict[str, Any]]:
    for title in _unique_titles(titles)[:6]:
        try:
            search_payload = await registry.execute(
                "moviebox",
                "search",
                correlation_id=correlation_id,
                fallback_used=fallback_used,
                query=title,
                page=1,
                per_page=8,
                media_type=media_type,
                hindi_only=prefer_hindi,
                    prefer_hindi=prefer_hindi,
                sort_by="search",
            )
            items = list(search_payload.get("items") or [])
        except ProviderServiceError as error:
            attempts.append(
                _attempt_payload(
                    provider="moviebox",
                    operation="search",
                    success=False,
                    message=error.message,
                    fallback_used=fallback_used,
                    retryable=error.retryable,
                )
            )
            items = []

        for item in items:
            try:
                sources = await registry.execute(
                    "moviebox",
                    "sources",
                    correlation_id=correlation_id,
                    fallback_used=fallback_used,
                    subject_id=item.get("id"),
                    title=item.get("title") or title,
                    media_type=item.get("moviebox_media_type") or media_type,
                    year=item.get("year") or year,
                    season=season,
                    episode=episode,
                )
            except ProviderServiceError as error:
                attempts.append(
                    _attempt_payload(
                        provider="moviebox",
                        operation="sources",
                        success=False,
                        message=error.message,
                        fallback_used=fallback_used,
                        retryable=error.retryable,
                    )
                )
                continue

            if sources:
                attempts.append(
                    _attempt_payload(
                        provider="moviebox",
                        operation="sources",
                        success=True,
                        message=f"Resolved {len(sources)} Movie Box sources for {title}.",
                        fallback_used=fallback_used,
                    )
                )
                return sources

        try:
            direct_sources = await registry.execute(
                "moviebox",
                "sources",
                correlation_id=correlation_id,
                fallback_used=fallback_used,
                title=title,
                media_type=media_type,
                year=year,
                season=season,
                episode=episode,
            )
        except ProviderServiceError as error:
            attempts.append(
                _attempt_payload(
                    provider="moviebox",
                    operation="sources",
                    success=False,
                    message=error.message,
                    fallback_used=fallback_used,
                    retryable=error.retryable,
                )
            )
            direct_sources = []

        if direct_sources:
            attempts.append(
                _attempt_payload(
                    provider="moviebox",
                    operation="sources",
                    success=True,
                    message=f"Resolved {len(direct_sources)} Movie Box sources for {title}.",
                    fallback_used=fallback_used,
                )
            )
            return direct_sources

    return []


# ── Movie playback ────────────────────────────────────────────────────────────

async def resolve_movie_playback(
    *,
    tmdb_id: int,
    imdb_id: str | None,
    title: str,
    alt_titles: list[str] | None = None,
    year: int | None = None,
) -> dict[str, Any]:
    correlation_id = uuid.uuid4().hex
    registry = get_provider_registry()
    attempts: list[dict[str, Any]] = []
    groups: list[dict[str, Any]] = []
    titles = [title, *(alt_titles or [])]

    moviebox_sources = await _resolve_moviebox_sources_by_title(
        registry=registry,
        correlation_id=correlation_id,
        titles=titles,
        media_type="movie",
        year=year,
        attempts=attempts,
        fallback_used=False,
    )
    if moviebox_sources:
        groups.append({"id": "moviebox", "label": "Movie Box primary", "sources": moviebox_sources})

    try:
        embed_sources = await registry.execute(
            "embed",
            "sources",
            correlation_id=correlation_id,
            fallback_used=not bool(moviebox_sources),
            media_type="movie",
            tmdb_id=tmdb_id,
            imdb_id=imdb_id,
        )
        if embed_sources:
            attempts.append(
                _attempt_payload(
                    provider="embed",
                    operation="sources",
                    success=True,
                    message=f"Prepared {len(embed_sources)} embed fallback sources.",
                    fallback_used=not bool(moviebox_sources),
                )
            )
            groups.append({"id": "embed", "label": "Embed fallback", "sources": embed_sources})
    except ProviderServiceError as error:
        attempts.append(
            _attempt_payload(
                provider="embed",
                operation="sources",
                success=False,
                message=error.message,
                fallback_used=not bool(moviebox_sources),
                retryable=error.retryable,
            )
        )

    payload = _resolution_payload(
        correlation_id=correlation_id,
        groups=groups,
        attempts=attempts,
        primary_provider="moviebox",
    )
    if payload["sources"]:
        return payload

    raise ProviderServiceError(
        code="movie_playback_unavailable",
        message="No playable movie sources were found.",
        retryable=True,
        provider="moviebox",
        correlation_id=correlation_id,
        fallback_used=True,
        user_action="Try another title or retry after the providers recover.",
        status_code=422,
    )


# ── TV playback ───────────────────────────────────────────────────────────────

async def resolve_tv_playback(
    *,
    tmdb_id: int,
    imdb_id: str | None,
    title: str,
    alt_titles: list[str] | None = None,
    year: int | None = None,
    season: int,
    episode: int,
) -> dict[str, Any]:
    correlation_id = uuid.uuid4().hex
    registry = get_provider_registry()
    attempts: list[dict[str, Any]] = []
    groups: list[dict[str, Any]] = []
    titles = [title, *(alt_titles or [])]

    moviebox_sources = await _resolve_moviebox_sources_by_title(
        registry=registry,
        correlation_id=correlation_id,
        titles=titles,
        media_type="series",
        year=year,
        season=season,
        episode=episode,
        attempts=attempts,
        fallback_used=False,
    )
    if moviebox_sources:
        groups.append({"id": "moviebox", "label": "Movie Box primary", "sources": moviebox_sources})

    try:
        embed_sources = await registry.execute(
            "embed",
            "sources",
            correlation_id=correlation_id,
            fallback_used=not bool(moviebox_sources),
            media_type="series",
            tmdb_id=tmdb_id,
            imdb_id=imdb_id,
            season=season,
            episode=episode,
        )
        if embed_sources:
            attempts.append(
                _attempt_payload(
                    provider="embed",
                    operation="sources",
                    success=True,
                    message=f"Prepared {len(embed_sources)} TV fallback sources.",
                    fallback_used=not bool(moviebox_sources),
                )
            )
            groups.append({"id": "embed", "label": "Embed fallback", "sources": embed_sources})
    except ProviderServiceError as error:
        attempts.append(
            _attempt_payload(
                provider="embed",
                operation="sources",
                success=False,
                message=error.message,
                fallback_used=not bool(moviebox_sources),
                retryable=error.retryable,
            )
        )

    payload = _resolution_payload(
        correlation_id=correlation_id,
        groups=groups,
        attempts=attempts,
        primary_provider="moviebox",
    )
    if payload["sources"]:
        return payload

    raise ProviderServiceError(
        code="tv_playback_unavailable",
        message=f"No playable TV sources were found for S{season}E{episode}.",
        retryable=True,
        provider="moviebox",
        correlation_id=correlation_id,
        fallback_used=True,
        user_action="Try another episode or retry after the providers recover.",
        status_code=422,
    )


