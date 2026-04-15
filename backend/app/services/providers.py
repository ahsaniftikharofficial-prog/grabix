from __future__ import annotations

import asyncio
import re
import sys
import time
import uuid
from dataclasses import dataclass
from importlib import import_module
from typing import Any, Protocol

from fastapi import HTTPException

from app.services.consumet import fetch_anime_episodes, fetch_anime_watch, get_health_status


def _main_module():
    main_module = sys.modules.get("main") or sys.modules.get("__main__") or sys.modules.get("backend.main")
    if main_module is not None:
        return main_module
    try:
        return import_module("main")
    except ModuleNotFoundError:
        return import_module("backend.main")


class ProviderAdapter(Protocol):
    name: str
    family: str
    policy: "ProviderPolicy"

    async def health(self, **kwargs) -> Any: ...

    async def discover(self, **kwargs) -> Any: ...

    async def search(self, **kwargs) -> Any: ...

    async def details(self, **kwargs) -> Any: ...

    async def sources(self, **kwargs) -> Any: ...

    async def download_options(self, **kwargs) -> Any: ...

    async def subtitles(self, **kwargs) -> Any: ...


@dataclass(slots=True)
class ProviderPolicy:
    timeout_seconds: float = 15.0
    retries: int = 1
    cooldown_seconds: float = 20.0
    circuit_breaker_threshold: int = 3


@dataclass(slots=True)
class ProviderCircuitState:
    failures: int = 0
    open_until: float = 0.0
    last_error: str = ""
    last_failure_at: float = 0.0


class ProviderServiceError(RuntimeError):
    def __init__(
        self,
        *,
        code: str,
        message: str,
        retryable: bool,
        provider: str,
        correlation_id: str | None = None,
        fallback_used: bool = False,
        user_action: str = "Try again in a moment.",
        status_code: int = 502,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.provider = provider
        self.correlation_id = correlation_id or uuid.uuid4().hex
        self.fallback_used = fallback_used
        self.user_action = user_action
        self.status_code = status_code
        self.details = details or {}

    def to_payload(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "provider": self.provider,
            "fallback_used": self.fallback_used,
            "correlation_id": self.correlation_id,
            "user_action": self.user_action,
        }


def _is_retryable_status(status_code: int) -> bool:
    return status_code in {408, 409, 423, 425, 429, 500, 502, 503, 504}


def _provider_error_from_exception(
    error: Exception,
    *,
    provider: str,
    correlation_id: str,
    fallback_used: bool = False,
) -> ProviderServiceError:
    if isinstance(error, ProviderServiceError):
        if not error.correlation_id:
            error.correlation_id = correlation_id
        return error

    if isinstance(error, HTTPException):
        detail = error.detail
        if isinstance(detail, dict):
            message = str(detail.get("message") or detail.get("detail") or f"{provider} request failed.")
            details = detail
        else:
            message = str(detail or f"{provider} request failed.")
            details = {}
        return ProviderServiceError(
            code=f"{provider.replace(' ', '_').lower()}_http_error",
            message=message,
            retryable=_is_retryable_status(error.status_code),
            provider=provider,
            correlation_id=correlation_id,
            fallback_used=fallback_used,
            user_action="Switch sources or retry after the provider recovers." if _is_retryable_status(error.status_code) else "Try another provider or source.",
            status_code=error.status_code,
            details=details,
        )

    return ProviderServiceError(
        code=f"{provider.replace(' ', '_').lower()}_execution_failed",
        message=str(error) or f"{provider} failed to respond.",
        retryable=True,
        provider=provider,
        correlation_id=correlation_id,
        fallback_used=fallback_used,
        user_action="Try again or let GRABIX fall back to the next provider.",
        status_code=502,
    )


class BaseProviderAdapter:
    def __init__(self, *, name: str, family: str, policy: ProviderPolicy | None = None) -> None:
        self.name = name
        self.family = family
        self.policy = policy or ProviderPolicy()

    async def _unsupported(self, operation: str) -> Any:
        raise ProviderServiceError(
            code="unsupported_operation",
            message=f"{self.name} does not support {operation}.",
            retryable=False,
            provider=self.name,
            user_action="Use a different provider path.",
            status_code=400,
        )

    async def health(self, **kwargs) -> Any:
        return await self._unsupported("health")

    async def discover(self, **kwargs) -> Any:
        return await self._unsupported("discover")

    async def search(self, **kwargs) -> Any:
        return await self._unsupported("search")

    async def details(self, **kwargs) -> Any:
        return await self._unsupported("details")

    async def sources(self, **kwargs) -> Any:
        return await self._unsupported("sources")

    async def download_options(self, **kwargs) -> Any:
        return await self._unsupported("download_options")

    async def subtitles(self, **kwargs) -> Any:
        return await self._unsupported("subtitles")


class ProviderRegistry:
    def __init__(self) -> None:
        self._providers: dict[str, ProviderAdapter] = {}
        self._circuit_states: dict[str, ProviderCircuitState] = {}

    def register(self, adapter: ProviderAdapter) -> None:
        self._providers[adapter.name] = adapter
        self._circuit_states.setdefault(adapter.family, ProviderCircuitState())

    def snapshot(self) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        now = time.time()
        for name, adapter in self._providers.items():
            state = self._circuit_states.setdefault(adapter.family, ProviderCircuitState())
            payload[name] = {
                "family": adapter.family,
                "timeout_seconds": adapter.policy.timeout_seconds,
                "retries": adapter.policy.retries,
                "cooldown_seconds": adapter.policy.cooldown_seconds,
                "circuit_breaker_threshold": adapter.policy.circuit_breaker_threshold,
                "failures": state.failures,
                "cooldown_remaining_seconds": max(0, int(state.open_until - now)),
                "circuit_open": state.open_until > now,
                "last_error": state.last_error,
                "last_failure_at": int(state.last_failure_at) if state.last_failure_at else 0,
            }
        return payload

    async def execute(
        self,
        provider_name: str,
        operation: str,
        *,
        correlation_id: str,
        fallback_used: bool = False,
        **kwargs,
    ) -> Any:
        adapter = self._providers.get(provider_name)
        if adapter is None:
            raise ProviderServiceError(
                code="provider_not_registered",
                message=f"Provider '{provider_name}' is not registered.",
                retryable=False,
                provider=provider_name,
                correlation_id=correlation_id,
                fallback_used=fallback_used,
                user_action="Check the provider configuration.",
                status_code=500,
            )

        state = self._circuit_states.setdefault(adapter.family, ProviderCircuitState())
        now = time.time()
        if state.open_until > now:
            raise ProviderServiceError(
                code="provider_circuit_open",
                message=f"{adapter.name} is cooling down after repeated failures.",
                retryable=True,
                provider=adapter.name,
                correlation_id=correlation_id,
                fallback_used=fallback_used,
                user_action="Wait a few seconds or use the next fallback provider.",
                status_code=503,
                details={"cooldown_remaining_seconds": max(1, int(state.open_until - now))},
            )

        method = getattr(adapter, operation, None)
        if method is None:
            raise ProviderServiceError(
                code="provider_operation_missing",
                message=f"{adapter.name} cannot perform {operation}.",
                retryable=False,
                provider=adapter.name,
                correlation_id=correlation_id,
                fallback_used=fallback_used,
                user_action="Use a different provider path.",
                status_code=400,
            )

        last_error: ProviderServiceError | None = None
        for attempt_index in range(adapter.policy.retries + 1):
            try:
                result = await asyncio.wait_for(method(**kwargs), timeout=adapter.policy.timeout_seconds)
                state.failures = 0
                state.open_until = 0.0
                state.last_error = ""
                return result
            except Exception as error:
                normalized = _provider_error_from_exception(
                    error,
                    provider=adapter.name,
                    correlation_id=correlation_id,
                    fallback_used=fallback_used,
                )
                state.failures += 1
                state.last_error = normalized.message
                state.last_failure_at = time.time()
                last_error = normalized

                if state.failures >= adapter.policy.circuit_breaker_threshold:
                    state.open_until = time.time() + adapter.policy.cooldown_seconds

                if attempt_index >= adapter.policy.retries or not normalized.retryable:
                    raise normalized

                await asyncio.sleep(min(0.35 * (attempt_index + 1), 1.0))

        if last_error is not None:
            raise last_error

        raise ProviderServiceError(
            code="provider_execution_unknown",
            message=f"{adapter.name} did not return a result.",
            retryable=True,
            provider=adapter.name,
            correlation_id=correlation_id,
        )


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


async def _resolve_direct_anime_provider_sources(
    *,
    provider_name: str,
    anime_id: str,
    episode_id: str,
    episode_number: int,
    audio: str,
    server: str,
) -> tuple[list[dict[str, Any]], str]:
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
        media_type = str(kwargs.get("media_type", "movie"))
        return [
            _stream_source(
                source_id=f"moviebox-{media_type}-{index}",
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
