from __future__ import annotations

from typing import Any

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.services.providers import (
    ProviderServiceError,
    resolve_anime_playback,
    resolve_movie_playback,
    resolve_tv_playback,
)
from app.services.logging_utils import get_logger, log_event

router = APIRouter()
logger = get_logger("providers")


class MovieResolveRequest(BaseModel):
    tmdb_id: int
    imdb_id: str | None = None
    title: str = Field(..., min_length=1)
    alt_titles: list[str] = Field(default_factory=list)
    year: int | None = None


class TvResolveRequest(MovieResolveRequest):
    season: int = Field(1, ge=1)
    episode: int = Field(1, ge=1)


class AnimeResolveCandidate(BaseModel):
    provider: str = Field(..., min_length=1)
    anime_id: str = Field(..., min_length=1)
    episode_id: str | None = None
    title: str | None = None
    alt_title: str | None = None


class AnimeResolvePlaybackRequest(BaseModel):
    title: str = Field(..., min_length=1)
    alt_title: str = ""
    alt_titles: list[str] = Field(default_factory=list)
    tmdb_id: int | None = None
    fallback_season: int = Field(1, ge=1)
    fallback_episode: int = Field(1, ge=1)
    episode_number: int = Field(1, ge=1)
    audio: str = "original"
    server: str = "auto"
    is_movie: bool = False
    purpose: str = "play"
    candidates: list[AnimeResolveCandidate] = Field(default_factory=list)


def _provider_error_response(error: ProviderServiceError, correlation_id: str = "") -> JSONResponse:
    log_event(
        logger,
        logging.WARNING,
        event="provider_resolution_failed",
        message=error.message,
        correlation_id=correlation_id,
        details={"provider": error.provider, "code": error.code, "retryable": error.retryable},
    )
    return JSONResponse(status_code=error.status_code, content={"error": error.to_payload()})


def _unexpected_provider_error(provider: str, error: Exception, correlation_id: str = "") -> JSONResponse:
    wrapped = ProviderServiceError(
        code="provider_route_failed",
        message=str(error) or "Provider resolution failed unexpectedly.",
        retryable=True,
        provider=provider,
        user_action="Retry the request or check the startup diagnostics.",
        status_code=500,
    )
    return _provider_error_response(wrapped, correlation_id)


@router.post("/providers/resolve/movie")
async def provider_resolve_movie(payload: MovieResolveRequest, request: Request):
    correlation_id = str(getattr(request.state, "correlation_id", "") or "")
    try:
        return await resolve_movie_playback(
            tmdb_id=payload.tmdb_id,
            imdb_id=payload.imdb_id,
            title=payload.title,
            alt_titles=payload.alt_titles,
            year=payload.year,
        )
    except ProviderServiceError as error:
        return _provider_error_response(error, correlation_id)
    except Exception as error:
        return _unexpected_provider_error("movie", error, correlation_id)


@router.post("/providers/resolve/tv")
async def provider_resolve_tv(payload: TvResolveRequest, request: Request):
    correlation_id = str(getattr(request.state, "correlation_id", "") or "")
    try:
        return await resolve_tv_playback(
            tmdb_id=payload.tmdb_id,
            imdb_id=payload.imdb_id,
            title=payload.title,
            alt_titles=payload.alt_titles,
            year=payload.year,
            season=payload.season,
            episode=payload.episode,
        )
    except ProviderServiceError as error:
        return _provider_error_response(error, correlation_id)
    except Exception as error:
        return _unexpected_provider_error("tv", error, correlation_id)


@router.post("/providers/resolve/anime")
async def provider_resolve_anime(payload: AnimeResolvePlaybackRequest, request: Request):
    correlation_id = str(getattr(request.state, "correlation_id", "") or "")
    try:
        candidates: list[dict[str, Any]] = [item.model_dump() for item in payload.candidates]
        return await resolve_anime_playback(
            title=payload.title,
            alt_title=payload.alt_title,
            alt_titles=payload.alt_titles,
            tmdb_id=payload.tmdb_id,
            fallback_season=payload.fallback_season,
            fallback_episode=payload.fallback_episode,
            episode_number=payload.episode_number,
            audio=payload.audio,
            server=payload.server,
            is_movie=payload.is_movie,
            purpose=payload.purpose,
            candidates=candidates,
        )
    except ProviderServiceError as error:
        return _provider_error_response(error, correlation_id)
    except Exception as error:
        return _unexpected_provider_error("anime", error, correlation_id)
