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
    _discover_anime_candidates_by_title,
    _resolution_payload,
    _resolve_direct_anime_provider_sources,
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
    anime_only: bool = False,
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
                anime_only=anime_only,
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


# ── Anime playback ────────────────────────────────────────────────────────────

async def resolve_anime_playback(
    *,
    title: str,
    alt_title: str = "",
    alt_titles: list[str] | None = None,
    tmdb_id: int | None = None,
    fallback_season: int = 1,
    fallback_episode: int = 1,
    episode_number: int = 1,
    audio: str = "original",
    server: str = "auto",
    is_movie: bool = False,
    purpose: str = "play",
    candidates: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    correlation_id = uuid.uuid4().hex
    registry = get_provider_registry()
    attempts: list[dict[str, Any]] = []
    groups: list[dict[str, Any]] = []
    normalized_audio = (audio or "original").strip().lower() or "original"
    title_candidates = _unique_titles([title, alt_title, *(alt_titles or [])])
    candidate_items = list(candidates or [])
    resolved_episode_ids: dict[str, str] = {}
    # Returning the first playable provider keeps the Play action responsive.
    # Collecting every fallback provider up front adds avoidable latency.
    collect_all_sources = False
    successful_watch_providers: set[str] = set()
    attempted_candidate_keys: set[str] = set()

    if normalized_audio == "hi":
        hindi_sources = await _resolve_moviebox_sources_by_title(
            registry=registry,
            correlation_id=correlation_id,
            titles=title_candidates,
            media_type="movie" if is_movie else "anime",
            season=max(1, fallback_season),
            episode=max(1, fallback_episode or episode_number),
            prefer_hindi=True,
            anime_only=not is_movie,
            attempts=attempts,
            fallback_used=False,
        )
        if hindi_sources:
            groups.append({"id": "moviebox-hindi", "label": "Hindi Movie Box", "sources": hindi_sources})
            return _resolution_payload(
                correlation_id=correlation_id,
                groups=groups,
                attempts=attempts,
                primary_provider="moviebox",
            )
        raise ProviderServiceError(
            code="anime_hindi_sources_unavailable",
            message="No Hindi anime sources were found for this title.",
            retryable=True,
            provider="moviebox",
            correlation_id=correlation_id,
            fallback_used=False,
            user_action="Switch to dubbed or subbed playback.",
            status_code=422,
        )

    async def _attempt_watch_candidates(items: list[dict[str, Any]]) -> bool:
        for candidate in items:
            provider_name = str(candidate.get("provider") or "hianime").strip() or "hianime"
            anime_id = str(candidate.get("anime_id") or candidate.get("animeId") or candidate.get("id") or "").strip()
            if not anime_id:
                continue

            candidate_key = f"{provider_name}:{anime_id}:{episode_number}"
            if candidate_key in attempted_candidate_keys or provider_name in successful_watch_providers:
                continue
            attempted_candidate_keys.add(candidate_key)

            episode_id = str(candidate.get("episode_id") or candidate.get("episodeId") or "").strip()
            if not episode_id:
                episode_id = resolved_episode_ids.get(candidate_key, "")

            try:
                watch_sources, episode_id = await _resolve_direct_anime_provider_sources(
                    provider_name=provider_name,
                    anime_id=anime_id,
                    episode_id=episode_id,
                    episode_number=episode_number,
                    audio=normalized_audio,
                    server=server,
                )
                if episode_id:
                    resolved_episode_ids[candidate_key] = episode_id
                if watch_sources:
                    attempts.append(
                        _attempt_payload(
                            provider="consumet-watch" if provider_name == "hianime" else provider_name,
                            operation="sources",
                            success=True,
                            message=f"Prepared {len(watch_sources)} anime sources via {provider_name}.",
                            fallback_used=not bool(groups),
                        )
                    )
                    successful_watch_providers.add(provider_name)
                    groups.append({"id": f"consumet-{provider_name}", "label": f"{provider_name} watch fallback", "sources": watch_sources})
                    if not collect_all_sources:
                        return True
            except Exception as error:
                from app.services.provider_types import _provider_error_from_exception
                normalized_error = _provider_error_from_exception(
                    error,
                    provider="consumet-watch" if provider_name == "hianime" else provider_name,
                    correlation_id=correlation_id,
                    fallback_used=not bool(groups),
                )
                attempts.append(
                    _attempt_payload(
                        provider="consumet-watch" if provider_name == "hianime" else provider_name,
                        operation="sources",
                        success=False,
                        message=normalized_error.message,
                        fallback_used=not bool(groups),
                        retryable=normalized_error.retryable,
                    )
                )
        return False

    await _attempt_watch_candidates(candidate_items)

    if not groups:
        candidate_items = await _discover_anime_candidates_by_title(
            titles=title_candidates,
            existing_candidates=candidate_items,
        )
        await _attempt_watch_candidates(candidate_items)

    if not groups:
        for candidate in candidate_items:
            provider_name = str(candidate.get("provider") or "hianime").strip() or "hianime"
            if provider_name != "hianime":
                continue

            anime_id = str(candidate.get("anime_id") or candidate.get("animeId") or candidate.get("id") or "").strip()
            if not anime_id:
                continue

            candidate_key = f"{provider_name}:{anime_id}:{episode_number}"
            episode_id = str(candidate.get("episode_id") or candidate.get("episodeId") or "").strip()
            if not episode_id:
                episode_id = resolved_episode_ids.get(candidate_key, "")

            if not episode_id:
                try:
                    episode_payload = await registry.execute(
                        "consumet-watch",
                        "details",
                        correlation_id=correlation_id,
                        fallback_used=True,
                        provider=provider_name,
                        media_id=anime_id,
                    )
                    selected = None
                    for item in episode_payload.get("items") or []:
                        try:
                            if int(item.get("number") or 0) == episode_number:
                                selected = item
                                break
                        except Exception:
                            continue
                    if selected is None:
                        items = list(episode_payload.get("items") or [])
                        selected = items[0] if items else None
                    episode_id = str((selected or {}).get("id") or "").strip()
                    if episode_id:
                        resolved_episode_ids[candidate_key] = episode_id
                except ProviderServiceError as error:
                    attempts.append(
                        _attempt_payload(
                            provider="consumet-watch",
                            operation="details",
                            success=False,
                            message=error.message,
                            fallback_used=True,
                            retryable=error.retryable,
                        )
                    )
                    episode_id = ""

            if not episode_id:
                continue

            try:
                resolved_sources = await registry.execute(
                    "anime-resolved",
                    "sources",
                    correlation_id=correlation_id,
                    fallback_used=True,
                    episode_id=episode_id,
                    anime_id=anime_id,
                    title=title,
                    alt_title=alt_title,
                    episode_number=episode_number,
                    audio=normalized_audio,
                    server=server,
                    is_movie=is_movie,
                    tmdb_id=tmdb_id,
                    purpose=purpose,
                )
                if resolved_sources:
                    attempts.append(
                        _attempt_payload(
                            provider="anime-resolved",
                            operation="sources",
                            success=True,
                            message=f"Resolved fallback anime sources via {provider_name}.",
                            fallback_used=True,
                        )
                    )
                    groups.append({"id": "anime-resolved", "label": "Backend resolved fallback", "sources": resolved_sources})
                    break
            except ProviderServiceError as error:
                attempts.append(
                    _attempt_payload(
                        provider="anime-resolved",
                        operation="sources",
                        success=False,
                        message=error.message,
                        fallback_used=True,
                        retryable=error.retryable,
                    )
                )

    # Non-Hindi anime playback is intentionally limited to anime providers only:
    # HiAnime primary, then AnimeKai / KickAssAnime / AnimePahe fallbacks.
    # MovieBox remains reserved for the Hindi-only path above.

    payload = _resolution_payload(
        correlation_id=correlation_id,
        groups=groups,
        attempts=attempts,
        primary_provider=(groups[0].get("id") or "anime") if groups else "anime",
    )
    if payload["sources"]:
        return payload

    raise ProviderServiceError(
        code="anime_playback_unavailable",
        message=f"No playable anime sources were found for episode {episode_number}.",
        retryable=True,
        provider="anime-resolved",
        correlation_id=correlation_id,
        fallback_used=True,
        user_action="Retry the episode or try again after the providers recover.",
        status_code=422,
    )
