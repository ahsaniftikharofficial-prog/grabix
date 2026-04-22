"""
backend/moviebox/moviebox_helpers.py — Pure helpers, type detection, payload builders.

No routes, no async fetch logic.
Imports only from moviebox_loader (no circular risk).
"""
from __future__ import annotations

import math
import re
import time
from difflib import SequenceMatcher
from urllib.parse import quote, urlparse

from fastapi import HTTPException

import moviebox.moviebox_loader as _loader
from moviebox.moviebox_loader import (
    SELF_BASE_URL,
    MOVIEBOX_CACHE_TTL_SECONDS,
    _BG_RETRY_INTERVAL,
    _ensure_moviebox,
    backend_logger,
)


# ── Format utility ────────────────────────────────────────────────────────────

def _format_bytes(num_bytes: int) -> str:
    """Return a human-readable byte string, e.g. '734.2 MB'."""
    if num_bytes <= 0:
        return "0 B"
    units = ("B", "KB", "MB", "GB", "TB")
    i = min(int(math.log(num_bytes, 1024)), len(units) - 1)
    return f"{num_bytes / (1024 ** i):.1f} {units[i]}"


# ── Availability guard ────────────────────────────────────────────────────────

def _moviebox_assert_available() -> None:
    """Raise HTTP 503 if moviebox_api is not loaded. Attempts lazy-load first."""
    _ensure_moviebox()
    if not _loader.MOVIEBOX_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail={
                "message": f"moviebox-api is not available: {_loader.MOVIEBOX_IMPORT_ERROR or 'not installed'}",
                "fallbacks": ["embed", "vidsrc"],
                "auto_retry": True,
                "retry_interval_seconds": _BG_RETRY_INTERVAL,
            },
        )


# ── In-memory item registry ───────────────────────────────────────────────────

def _moviebox_register_item(item) -> None:
    subject_id = str(getattr(item, "subjectId", "") or "")
    if subject_id:
        _loader.moviebox_item_registry[subject_id] = (
            time.time() + MOVIEBOX_CACHE_TTL_SECONDS,
            item,
        )


def _moviebox_register_items(items) -> None:
    for item in items or []:
        _moviebox_register_item(item)


def _moviebox_get_registered_item(subject_id: str | None):
    if not subject_id:
        return None
    cached = _loader.moviebox_item_registry.get(str(subject_id))
    if not cached:
        return None
    expires_at, item = cached
    if expires_at <= time.time():
        _loader.moviebox_item_registry.pop(str(subject_id), None)
        return None
    return item


# ── Type detection ────────────────────────────────────────────────────────────

def _moviebox_supports_downloadable_detail(item) -> bool:
    if item is None:
        return False
    return item.__class__.__name__ in {"SearchResultsItem", "ItemJsonDetailsModel"}


def _normalize_moviebox_title(value: str) -> str:
    cleaned = re.sub(r"\[[^\]]+\]", "", value or "")
    cleaned = re.sub(r"[^a-z0-9]+", " ", cleaned.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def _moviebox_media_type_value(media_type: str) -> str:
    normalized = (media_type or "all").strip().lower()
    if normalized not in {"all", "movie", "series", "anime"}:
        raise HTTPException(
            status_code=400,
            detail="media_type must be one of: all, movie, series, anime",
        )
    return normalized


def _moviebox_media_type_from_item(item) -> str:
    if getattr(item, "subjectType", None) == _loader.MovieBoxSubjectType.MOVIES:
        return "movie"
    return "series"


def _moviebox_is_hindi(item) -> bool:
    haystack = " ".join([
        str(getattr(item, "title",       "") or ""),
        str(getattr(item, "corner",      "") or ""),
        str(getattr(item, "countryName", "") or ""),
        " ".join(str(v) for v in (getattr(item, "genre",     None) or [])),
        " ".join(str(v) for v in (getattr(item, "subtitles", None) or [])),
        str(getattr(item, "description", "") or ""),
    ]).lower()
    return any(
        token in haystack
        for token in ("hindi", "hin", "dubbed", "dual audio", "multi audio", "bollywood")
    ) or (getattr(item, "countryName", "") or "").lower() == "india"


def _moviebox_is_anime(item) -> bool:
    genres  = [str(g).lower() for g in (getattr(item, "genre", None) or [])]
    country = (getattr(item, "countryName", "") or "").lower()
    title   = (getattr(item, "title",       "") or "").lower()
    return "anime" in genres or country == "japan" or "anime" in title


def _moviebox_release_year(item) -> int | None:
    release_date = getattr(item, "releaseDate", None)
    return getattr(release_date, "year", None)


# ── Scoring ───────────────────────────────────────────────────────────────────

def _moviebox_match_score(
    item,
    title: str,
    year: int | None,
    prefer_hindi: bool = True,
    anime_only: bool = False,
) -> float:
    target    = _normalize_moviebox_title(title)
    candidate = _normalize_moviebox_title(getattr(item, "title", ""))
    score     = SequenceMatcher(None, target, candidate).ratio() * 100

    if target and candidate == target:
        score += 30
    elif target and target in candidate:
        score += 15

    release_year = _moviebox_release_year(item)
    if year is not None and release_year == year:
        score += 25
    if getattr(item, "hasResource", False):
        score += 10
    if prefer_hindi and _moviebox_is_hindi(item):
        score += 12
    if anime_only:
        score += 18 if _moviebox_is_anime(item) else -35

    return score


# ── Proxy URL builders ────────────────────────────────────────────────────────

def _moviebox_poster_proxy_url(url: str) -> str:
    return f"{SELF_BASE_URL}/moviebox/poster?url={quote(url, safe='')}"

def _moviebox_subtitle_proxy_url(url: str) -> str:
    return f"{SELF_BASE_URL}/moviebox/subtitle?url={quote(url, safe='')}"

def _moviebox_stream_proxy_url(url: str) -> str:
    return f"{SELF_BASE_URL}/moviebox/proxy-stream?url={quote(url, safe='')}"


# ── Payload builders ──────────────────────────────────────────────────────────

def _moviebox_card_payload(item, section: str | None = None) -> dict:
    raw_poster = str(getattr(getattr(item, "cover", None), "url", "") or "")
    media_type = _moviebox_media_type_from_item(item)
    return {
        "id":               str(getattr(item, "subjectId", "") or ""),
        "title":            getattr(item, "title",       "") or "Unknown",
        "description":      getattr(item, "description", "") or "",
        "year":             _moviebox_release_year(item),
        "poster":           raw_poster,
        "poster_proxy":     _moviebox_poster_proxy_url(raw_poster) if raw_poster else "",
        "media_type":       "anime" if _moviebox_is_anime(item) else media_type,
        "moviebox_media_type": media_type,
        "country":          getattr(item, "countryName",      "") or "",
        "genres":           list(getattr(item, "genre",       None) or []),
        "imdb_rating":      getattr(item, "imdbRatingValue",  None),
        "imdb_rating_count": getattr(item, "imdbRatingCount", None),
        "detail_path":      getattr(item, "detailPath",       "") or "",
        "corner":           getattr(item, "corner",           "") or "",
        "has_resource":     getattr(item, "hasResource",      False),
        "subtitle_languages": list(getattr(item, "subtitles", None) or []),
        "is_hindi":         _moviebox_is_hindi(item),
        "is_anime":         _moviebox_is_anime(item),
        "section":          section or "",
    }


def _moviebox_caption_payload(caption) -> dict:
    language = getattr(caption, "lanName", None) or getattr(caption, "lan", None) or "Subtitle"
    raw_url  = str(getattr(caption, "url", "") or "")
    return {
        "id":           str(getattr(caption, "id", "") or language),
        "language":     getattr(caption, "lan", "") or "",
        "label":        language,
        "url":          _moviebox_subtitle_proxy_url(raw_url) if raw_url else "",
        "original_url": raw_url,
    }


def _moviebox_source_payload(media_file, captions: list[dict] | None = None) -> dict:
    resolution = int(getattr(media_file, "resolution", 0) or 0)
    size       = int(getattr(media_file, "size",       0) or 0)
    quality    = f"{resolution}p" if resolution > 0 else "Auto"
    raw_url    = str(getattr(media_file, "url", "") or "")
    server     = urlparse(raw_url).netloc or "moviebox"
    return {
        "provider":    "MovieBox",
        "label":       f"MovieBox {quality}",
        "url":         _moviebox_stream_proxy_url(raw_url) if raw_url else "",
        "original_url": raw_url,
        "server":      server,
        "quality":     quality,
        "resolution":  resolution,
        "size_bytes":  size,
        "size_label":  _format_bytes(size),
        "kind":        "direct",
        "mime_type":   "video/mp4",
        "headers":     {"Referer": "https://moviebox.ng/", "User-Agent": "Mozilla/5.0"},
        "subtitles":   captions or [],
    }


# ── List helpers ──────────────────────────────────────────────────────────────

def _moviebox_unique_items(items) -> list:
    deduped: list = []
    seen:    set[str] = set()
    for item in items or []:
        subject_id = str(getattr(item, "subjectId", "") or "")
        if not subject_id or subject_id in seen:
            continue
        seen.add(subject_id)
        deduped.append(item)
    return deduped


def _moviebox_filter_items(
    items,
    media_type:  str  = "all",
    hindi_only:  bool = False,
    anime_only:  bool = False,
) -> list:
    filtered: list = []
    for item in items or []:
        item_media_type = _moviebox_media_type_from_item(item)
        is_anime = _moviebox_is_anime(item)
        is_hindi = _moviebox_is_hindi(item)
        if media_type == "movie"  and item_media_type != "movie":   continue
        if media_type == "series" and item_media_type != "series":  continue
        if media_type == "anime"  and not is_anime:                 continue
        if anime_only and not is_anime:                             continue
        if hindi_only and not is_hindi:                             continue
        filtered.append(item)
    return filtered


def _moviebox_sort_items(items, sort_by: str = "search", query: str = "") -> list:
    normalized_sort = (sort_by or "search").lower()
    if normalized_sort == "rating":
        return sorted(items,
                      key=lambda item: float(getattr(item, "imdbRatingValue", 0) or 0),
                      reverse=True)
    if normalized_sort == "recent":
        return sorted(items,
                      key=lambda item: (
                          _moviebox_release_year(item) or 0,
                          float(getattr(item, "imdbRatingValue", 0) or 0),
                      ),
                      reverse=True)
    return sorted(items,
                  key=lambda item: _moviebox_match_score(item, query, None, True, False),
                  reverse=True)


def _moviebox_pick_category(categories: dict[str, list], keywords: list[str]) -> list:
    for category_title, items in categories.items():
        lowered = category_title.lower()
        if all(kw in lowered for kw in keywords):
            return items
    return []


# ── Text helpers ──────────────────────────────────────────────────────────────

def _moviebox_guess_seasons(title: str) -> list[int]:
    m = re.search(r"S(\d+)\s*-\s*S?(\d+)", title or "", re.IGNORECASE)
    if m:
        start, end = int(m.group(1)), int(m.group(2))
        if start <= end:
            return list(range(start, min(end, start + 24) + 1))
    m = re.search(r"S(\d+)", title or "", re.IGNORECASE)
    if m:
        return [int(m.group(1))]
    return [1]


def _moviebox_base_title(title: str) -> str:
    cleaned = re.sub(r"\[(.*?)\]", "",   title or "", flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(hindi|urdu|punjabi|dub|dubbed)\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip(" -")


def _moviebox_extract_season_episode_counts(payload) -> dict[int, int]:
    counts: dict[int, int] = {}

    def register(season_value, episode_value) -> None:
        try:
            s = int(season_value  or 0)
            e = int(episode_value or 0)
        except Exception:
            return
        if s > 0 and e > 0:
            counts[s] = max(counts.get(s, 0), e)

    def visit(node) -> None:
        if isinstance(node, dict):
            lowered     = {str(k).lower(): k for k in node.keys()}
            season_key  = next((lowered[n] for n in ("se", "season", "seasonnumber", "season_number")
                                if n in lowered), None)
            episode_key = next((lowered[n] for n in ("maxep", "episodecount", "episodes",
                                                      "epcount", "episode_count", "latestep")
                                if n in lowered), None)
            if season_key is not None and episode_key is not None:
                register(node.get(season_key), node.get(episode_key))
            for v in node.values():
                visit(v)
            return

        if isinstance(node, (list, tuple, set)):
            for item in node:
                visit(item)
            return

        sv = getattr(node, "se",     None) or getattr(node, "season",       None)
        ev = getattr(node, "maxEp",  None) or getattr(node, "episodeCount", None) or getattr(node, "episodes", None)
        if sv is not None and ev is not None:
            register(sv, ev)

        for attr in ("seasons", "seasonList", "episodes", "episodeList",
                     "resource", "resData", "subject"):
            try:
                child = getattr(node, attr, None)
            except Exception:
                child = None
            if child is not None:
                visit(child)

    visit(payload)
    return counts


def _moviebox_total_episode_count(season_episode_counts: dict[int, int] | None) -> int:
    return sum(int(v or 0) for v in (season_episode_counts or {}).values())


# ── Subtitle conversion ───────────────────────────────────────────────────────

def _moviebox_srt_to_vtt(content: str) -> str:
    safe = (content or "").replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
    if safe.startswith("WEBVTT"):
        return safe
    lines = ["WEBVTT", ""]
    for line in safe.split("\n"):
        lines.append(line.replace(",", ".") if "-->" in line else line)
    return "\n".join(lines)
