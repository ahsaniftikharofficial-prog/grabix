"""
provider_adapters.py — concrete provider adapter classes and the registry singleton.

Dependency order: types → registry → helpers → adapters
The global get_provider_registry() singleton lives here because it needs all adapters.
"""
from __future__ import annotations

import sys
from importlib import import_module
from typing import Any

from app.services.provider_helpers import (
    _build_provider_sources,
    _infer_stream_kind,
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


# ── Registry singleton ────────────────────────────────────────────────────────

_PROVIDER_REGISTRY: ProviderRegistry | None = None


def get_provider_registry() -> ProviderRegistry:
    global _PROVIDER_REGISTRY
    if _PROVIDER_REGISTRY is None:
        registry = ProviderRegistry()
        registry.register(MovieBoxProviderAdapter())
        registry.register(EmbedProviderAdapter())
        _PROVIDER_REGISTRY = registry
    return _PROVIDER_REGISTRY


def provider_registry_snapshot() -> dict[str, Any]:
    return get_provider_registry().snapshot()
