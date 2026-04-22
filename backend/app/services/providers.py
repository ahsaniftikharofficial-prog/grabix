"""
providers.py — backward-compatibility shim.

Everything that was in the old monolithic providers.py is now split across:
  provider_types.py      — types, errors, base adapter
  provider_registry.py   — ProviderRegistry class
  provider_helpers.py    — pure helpers, stream utilities
  provider_adapters.py   — concrete adapters + registry singleton
  provider_resolvers.py  — resolve_movie_playback, resolve_tv_playback, resolve_anime_playback

This file re-exports the public API so that no other file needs to change its imports.
DO NOT add logic here.
"""
from __future__ import annotations

# ── Types ─────────────────────────────────────────────────────────────────────
from app.services.provider_types import (
    BaseProviderAdapter,
    ProviderAdapter,
    ProviderCircuitState,
    ProviderPolicy,
    ProviderServiceError,
    _is_retryable_status,
    _provider_error_from_exception,
)

# ── Registry ──────────────────────────────────────────────────────────────────
from app.services.provider_registry import ProviderRegistry

# ── Helpers ───────────────────────────────────────────────────────────────────
from app.services.provider_helpers import (
    EMBED_PROVIDERS,
    _anime_title_match_score,
    _attempt_payload,
    _build_provider_sources,
    _discover_anime_candidates_by_title,
    _infer_stream_kind,
    _map_consumet_watch_payload,
    _normalize_title_for_match,
    _resolution_payload,
    _resolve_direct_anime_provider_sources,
    _source_dedup_key,
    _stream_source,
    _unique_titles,
    merge_provider_source_groups,
)

# ── Adapters + singleton ──────────────────────────────────────────────────────
from app.services.provider_adapters import (
    AnimeResolvedProviderAdapter,
    ConsumetAnimeProviderAdapter,
    EmbedProviderAdapter,
    MovieBoxProviderAdapter,
    _main_module,
    get_provider_registry,
    provider_registry_snapshot,
)

# ── Resolvers ─────────────────────────────────────────────────────────────────
from app.services.provider_resolvers import (
    _resolve_moviebox_sources_by_title,
    resolve_anime_playback,
    resolve_movie_playback,
    resolve_tv_playback,
)

__all__ = [
    # types
    "ProviderAdapter",
    "ProviderPolicy",
    "ProviderCircuitState",
    "ProviderServiceError",
    "BaseProviderAdapter",
    # registry
    "ProviderRegistry",
    "get_provider_registry",
    "provider_registry_snapshot",
    # helpers
    "merge_provider_source_groups",
    "EMBED_PROVIDERS",
    # adapters
    "MovieBoxProviderAdapter",
    "EmbedProviderAdapter",
    "AnimeResolvedProviderAdapter",
    "ConsumetAnimeProviderAdapter",
    # resolvers
    "resolve_movie_playback",
    "resolve_tv_playback",
    "resolve_anime_playback",
]
