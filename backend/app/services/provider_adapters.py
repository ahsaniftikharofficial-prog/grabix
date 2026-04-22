"""
provider_adapters.py — concrete provider adapter classes and the registry singleton.

Dependency order: types → registry → helpers → adapters
The global get_provider_registry() singleton lives here because it needs all adapters.
"""
from __future__ import annotations

import sys
from importlib import import_module
from typing import Any

from app.services.consumet import fetch_anime_episodes, fetch_anime_watch, get_health_status
from app.services.provider_helpers import (
    _build_provider_sources,
    _infer_stream_kind,
    _map_consumet_watch_payload,
    _stream_source,
)
from app.services.provider_registry import ProviderRegistry
from app.services.provider_types import BaseProviderAdapter, ProviderPolicy, ProviderServiceError


# ── main module accessor ──────────────────────────────────────────────────────

def _main_module():
    main_module = sys.modules.get("main") or sys.modules.get("__main__") or sys.modules.get("backend.main")
    if main_module is not None:
        return main_module
    try:
        return import_module("main")
    except ModuleNotFoundError:
        return import_module("backend.main")


# ── Concrete adapters ─────────────────────────────────────────────────────────

class MovieBoxProviderAdapter(BaseProviderAdapter):
    def __init__(self) -> None:
        super().__init__(
            name="moviebox",
            family="moviebox",
            policy=ProviderPolicy(timeout_seconds=18.0, retries=1, cooldown_seconds=20.0, circuit_breaker_threshold=3),
        )

    async def health(self, **kwargs) -> Any:
        main_module = _main_module()
        if bool(getattr(main_module, "MOVIEBOX_AVAILABLE", False)):
            return {"status": "online", "message": "Movie Box provider is available."}
        raise ProviderServiceError(
            code="moviebox_unavailable",
            message=str(getattr(main_module, "MOVIEBOX_IMPORT_ERROR", "") or "Movie Box provider is unavailable."),
            retryable=True,
            provider=self.name,
            user_action="Use embed fallback sources while Movie Box is unavailable.",
            status_code=503,
        )

    async def discover(self, **kwargs) -> Any:
        return await _main_module()._moviebox_discover_payload()

    async def search(self, **kwargs) -> Any:
        return await _main_module().moviebox_search_items(
            query=kwargs.get("query", ""),
            page=int(kwargs.get("page", 1) or 1),
            per_page=int(kwargs.get("per_page", 12) or 12),
            media_type=kwargs.get("media_type", "all"),
            hindi_only=bool(kwargs.get("hindi_only", False)),
            anime_only=bool(kwargs.get("anime_only", False)),
            prefer_hindi=bool(kwargs.get("prefer_hindi", False)),
            sort_by=kwargs.get("sort_by", "search"),
        )

    async def details(self, **kwargs) -> Any:
        return await _main_module().moviebox_details(
            subject_id=kwargs.get("subject_id"),
            title=kwargs.get("title"),
            media_type=kwargs.get("media_type", "movie"),
            year=kwargs.get("year"),
        )

    async def sources(self, **kwargs) -> Any:
        payload = await _main_module().moviebox_sources(
            subject_id=kwargs.get("subject_id"),
            title=kwargs.get("title"),
            media_type=kwargs.get("media_type", "movie"),
            year=kwargs.get("year"),
            season=int(kwargs.get("season", 1) or 1),
            episode=int(kwargs.get("episode", 1) or 1),
        )
        return [
            _stream_source(
                source_id=str(item.get("id") or f"moviebox-{index}"),
                label=str(item.get("label") or item.get("quality") or f"Source {index + 1}"),
                provider=str(item.get("provider") or "Movie Box"),
                kind=str(item.get("kind") or _infer_stream_kind(str(item.get("url") or ""), str(item.get("mime_type") or ""))),
                url=str(item.get("url") or ""),
                description=f"{item.get('provider') or 'Movie Box'} direct source",
                quality=str(item.get("quality") or "Auto"),
                mime_type=str(item.get("mime_type") or ""),
                file_name=str(item.get("size_label") or ""),
                external_url=str(item.get("original_url") or item.get("url") or ""),
                can_extract=False,
                subtitles=list(item.get("subtitles") or []),
                language=str(item.get("server") or ""),
            )
            for index, item in enumerate(payload.get("sources") or [])
            if isinstance(item, dict) and item.get("url")
        ]

    async def download_options(self, **kwargs) -> Any:
        return await self.sources(**kwargs)

    async def subtitles(self, **kwargs) -> Any:
        sources = await self.sources(**kwargs)
        subtitles: list[dict[str, Any]] = []
        for source in sources:
            subtitles.extend(source.get("subtitles") or [])
        return subtitles


class EmbedProviderAdapter(BaseProviderAdapter):
    def __init__(self) -> None:
        super().__init__(
            name="embed",
            family="embed",
            policy=ProviderPolicy(timeout_seconds=6.0, retries=0, cooldown_seconds=10.0, circuit_breaker_threshold=4),
        )

    async def health(self, **kwargs) -> Any:
        return {"status": "online", "message": "Embed fallback templates are ready."}

    async def sources(self, **kwargs) -> Any:
        return _build_provider_sources(
            media_type=str(kwargs.get("media_type", "movie")),
            tmdb_id=kwargs.get("tmdb_id"),
            imdb_id=kwargs.get("imdb_id"),
            season=int(kwargs.get("season", 1) or 1),
            episode=int(kwargs.get("episode", 1) or 1),
            trailer_url=kwargs.get("trailer_url"),
        )

    async def download_options(self, **kwargs) -> Any:
        return await self.sources(**kwargs)


class AnimeResolvedProviderAdapter(BaseProviderAdapter):
    def __init__(self) -> None:
        super().__init__(
            name="anime-resolved",
            family="anime-resolved",
            policy=ProviderPolicy(timeout_seconds=40.0, retries=0, cooldown_seconds=8.0, circuit_breaker_threshold=5),
        )

    async def health(self, **kwargs) -> Any:
        consumet = await get_health_status()
        if consumet.get("healthy"):
            return {"status": "online", "message": "HiAnime primary resolver is healthy."}
        raise ProviderServiceError(
            code="anime_primary_degraded",
            message=str(consumet.get("message") or "Anime primary resolver is degraded."),
            retryable=True,
            provider=self.name,
            user_action="Retry the anime provider chain in a moment.",
            status_code=503,
        )

    async def sources(self, **kwargs) -> Any:
        main_module = _main_module()
        payload = main_module.AnimeResolveRequest(
            episodeId=str(kwargs.get("episode_id") or ""),
            animeId=str(kwargs.get("anime_id") or ""),
            title=str(kwargs.get("title") or ""),
            altTitle=str(kwargs.get("alt_title") or ""),
            episodeNumber=int(kwargs.get("episode_number", 1) or 1),
            audio=str(kwargs.get("audio") or "original"),
            server=str(kwargs.get("server") or "auto"),
            isMovie=bool(kwargs.get("is_movie", False)),
            tmdbId=kwargs.get("tmdb_id"),
            purpose=str(kwargs.get("purpose") or "play"),
        )
        resolved = await main_module.anime_resolve_source(payload)
        source = resolved.get("source") or {}
        url = str(source.get("url") or "").strip()
        if not url:
            return []
        # Filter out embed sources — embed URLs (e.g. MegaCloud/VidStreaming iframes)
        # are unplayable and show "We're Sorry" pages; only keep hls/direct streams.
        source_kind = str(source.get("kind") or "direct")
        if source_kind == "embed":
            return []
        subtitles = [
            {
                "id": f"anime-resolved-sub-{index}",
                "label": str(track.get("label") or track.get("lang") or f"Subtitle {index + 1}"),
                "language": str(track.get("lang") or ""),
                "url": str(track.get("url") or ""),
            }
            for index, track in enumerate(resolved.get("subtitles") or [])
            if isinstance(track, dict) and track.get("url")
        ]
        # Ensure anime HLS/direct streams always route through the backend proxy.
        # HiAnime CDN (MegaCloud/bunnycdn) rejects segment requests without a
        # Referer header. If the watch payload didn't include headers, inject a
        # safe default so shouldKeepHlsProxied() returns true in the player.
        raw_headers = dict(source.get("headers") or {})
        if not raw_headers:
            raw_headers = {"Referer": "https://megacloud.blog/"}

        return [
            _stream_source(
                source_id=f"anime-resolved-{kwargs.get('anime_id') or 'candidate'}-{kwargs.get('episode_number', 1)}",
                label=str(resolved.get("selectedServer") or resolved.get("provider") or "HiAnime"),
                provider=str(resolved.get("provider") or "HiAnime"),
                kind=str(source.get("kind") or "direct"),
                url=url,
                description=str(resolved.get("strategy") or "Resolved anime source"),
                quality="HLS" if str(source.get("kind") or "") == "hls" else "Auto",
                external_url=url,
                can_extract=False,
                subtitles=subtitles,
                request_headers=raw_headers,
            )
        ]

    async def download_options(self, **kwargs) -> Any:
        return await self.sources(**kwargs)

    async def subtitles(self, **kwargs) -> Any:
        sources = await self.sources(**kwargs)
        return list(sources[0].get("subtitles") or []) if sources else []


class ConsumetAnimeProviderAdapter(BaseProviderAdapter):
    def __init__(self) -> None:
        super().__init__(
            name="consumet-watch",
            family="consumet-watch",
            policy=ProviderPolicy(timeout_seconds=40.0, retries=0, cooldown_seconds=8.0, circuit_breaker_threshold=5),
        )

    async def health(self, **kwargs) -> Any:
        payload = await get_health_status()
        if payload.get("healthy"):
            return {"status": "online", "message": str(payload.get("message") or "Consumet anime watch is healthy.")}
        raise ProviderServiceError(
            code="consumet_degraded",
            message=str(payload.get("message") or "Consumet anime watch is degraded."),
            retryable=True,
            provider=self.name,
            user_action="Use the built-in anime fallback chain.",
            status_code=503,
        )

    async def details(self, **kwargs) -> Any:
        media_id = str(kwargs.get("media_id") or "").strip()
        provider = str(kwargs.get("provider") or "hianime").strip() or "hianime"
        if not media_id:
            raise ProviderServiceError(
                code="anime_id_required",
                message="Anime provider id is required.",
                retryable=False,
                provider=self.name,
                user_action="Choose an anime result before requesting playback.",
                status_code=400,
            )
        return await fetch_anime_episodes(provider=provider, media_id=media_id)

    async def sources(self, **kwargs) -> Any:
        provider = str(kwargs.get("provider") or "hianime").strip() or "hianime"
        media_id = str(kwargs.get("media_id") or "").strip()
        episode_id = str(kwargs.get("episode_id") or "").strip()
        episode_number = int(kwargs.get("episode_number", 1) or 1)
        audio = str(kwargs.get("audio") or "original").strip().lower() or "original"
        server = str(kwargs.get("server") or "auto").strip().lower() or "auto"

        if not episode_id:
            details = await self.details(provider=provider, media_id=media_id)
            items = details.get("items") or []
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
            episode_id = str((selected or {}).get("id") or "").strip()

        if not episode_id:
            raise ProviderServiceError(
                code="anime_episode_not_found",
                message=f"No episode metadata was found for episode {episode_number}.",
                retryable=False,
                provider=self.name,
                user_action="Refresh the anime episode list and try again.",
                status_code=404,
            )

        payload = await fetch_anime_watch(
            provider=provider,
            episode_id=episode_id,
            server=None if server == "auto" else server,
            audio=audio,
        )
        return _map_consumet_watch_payload(provider, payload)

    async def download_options(self, **kwargs) -> Any:
        return await self.sources(**kwargs)

    async def subtitles(self, **kwargs) -> Any:
        sources = await self.sources(**kwargs)
        return list(sources[0].get("subtitles") or []) if sources else []


# ── Registry singleton ────────────────────────────────────────────────────────

_PROVIDER_REGISTRY: ProviderRegistry | None = None


def get_provider_registry() -> ProviderRegistry:
    global _PROVIDER_REGISTRY
    if _PROVIDER_REGISTRY is None:
        registry = ProviderRegistry()
        registry.register(MovieBoxProviderAdapter())
        registry.register(EmbedProviderAdapter())
        registry.register(AnimeResolvedProviderAdapter())
        registry.register(ConsumetAnimeProviderAdapter())
        _PROVIDER_REGISTRY = registry
    return _PROVIDER_REGISTRY


def provider_registry_snapshot() -> dict[str, Any]:
    return get_provider_registry().snapshot()
