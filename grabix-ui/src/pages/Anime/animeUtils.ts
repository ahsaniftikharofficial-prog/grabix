// anime/animeUtils.ts — pure helpers, Jikan fetchers, TMDB lookups, candidate search

import { searchConsumetDomain } from "../../lib/consumetProviders";
import type { ConsumetMediaSummary } from "../../lib/consumetProviders";
import { searchTmdbMedia } from "../../lib/tmdb";
import { fetchTmdbSeasonMap as fetchTmdbSeasonMapFromBackend } from "../../lib/tmdb";
import { searchMovieBox } from "../../lib/streamProviders";
import { BACKEND_API } from "../../lib/api";
import {
  JIKAN,
  NORMALIZED_IMAGE_URL_CACHE_MAX,
  TMDB_SEASON_CACHE_MAX,
  ANIME_FALLBACK_PROVIDERS,
  normalizedImageUrlCache,
  tmdbSeasonCache,
} from "./animeTypes";
import type { AnimeCardItem, LegacyAnime, Tab, TmdbEpisodeRef } from "./animeTypes";

// ── Image normalisation ───────────────────────────────────────────────────────

export function normalizeAnimeImageUrl(value?: string | null): string {
  const url = (value || "").trim();
  if (!url) return "";
  if (url.startsWith("/")) {
    return `${BACKEND_API}${url}`;
  }
  const normalized = url.startsWith("//") ? `https:${url}` : url;
  if (normalized.startsWith(BACKEND_API) || normalized.includes("/consumet/proxy?url=")) {
    return normalized;
  }
  if (/^https?:\/\//i.test(normalized)) {
    return `${BACKEND_API}/consumet/proxy?url=${encodeURIComponent(normalized)}`;
  }
  return normalized;
}

export function setBoundedCacheEntry<K, V>(cache: Map<K, V>, key: K, value: V, maxSize: number) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  while (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value as K | undefined;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

export function normalizeAnimeImageUrlMemo(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const cached = normalizedImageUrlCache.get(raw);
  if (cached !== undefined) {
    return cached;
  }
  const normalized = normalizeAnimeImageUrl(raw);
  setBoundedCacheEntry(normalizedImageUrlCache, raw, normalized, NORMALIZED_IMAGE_URL_CACHE_MAX);
  return normalized;
}

// ── Item mappers ──────────────────────────────────────────────────────────────

export function toCardItem(item: ConsumetMediaSummary): AnimeCardItem {
  return {
    ...item,
    image: normalizeAnimeImageUrlMemo(item.image),
    episodes_count: item.episodes_count,
  };
}

export function mapLegacyAnime(item: LegacyAnime): AnimeCardItem {
  return {
    id: String(item.mal_id),
    provider: "jikan",
    type: "anime",
    title: item.title_english ?? item.title,
    alt_title: item.title,
    image: normalizeAnimeImageUrlMemo(item.images.jpg.large_image_url ?? item.images.jpg.image_url),
    description: item.synopsis,
    year: item.year,
    rating: item.score ?? null,
    status: item.status,
    genres: (item.genres ?? []).map((genre) => genre.name),
    languages: ["original"],
    url: item.url,
    mal_id: item.mal_id,
    episodes_count: item.episodes,
    trailer_url: item.trailer?.embed_url,
  };
}

export function dedupeItems(items: AnimeCardItem[]): AnimeCardItem[] {
  const seen = new Set<string>();
  const result: AnimeCardItem[] = [];
  for (const item of items) {
    const key = `${item.provider}-${item.id}`;
    if (!item.id || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

// ── Jikan API ─────────────────────────────────────────────────────────────────

export async function searchJikanAnime(query: string, page = 1): Promise<AnimeCardItem[]> {
  const response = await fetch(`${JIKAN}/anime?q=${encodeURIComponent(query)}&page=${page}&limit=20&sfw=true`);
  const data = (await response.json()) as { data?: LegacyAnime[] };
  return (data.data ?? []).map(mapLegacyAnime);
}

export async function fetchJikanDiscover(tab: Tab, page = 1): Promise<AnimeCardItem[]> {
  const path =
    tab === "popular"
      ? `/top/anime?filter=bypopularity&page=${page}&limit=20`
      : tab === "toprated"
        ? `/top/anime?filter=favorite&page=${page}&limit=20`
        : tab === "seasonal"
          ? `/seasons/now?page=${page}&limit=20`
          : tab === "movie"
            ? `/top/anime?type=movie&page=${page}&limit=20`
            : `/top/anime?page=${page}&limit=20`;
  const response = await fetch(`${JIKAN}${path}`);
  const data = (await response.json()) as { data?: LegacyAnime[] };
  return (data.data ?? []).map(mapLegacyAnime);
}

export async function fetchJikanEpisodeCount(malId?: number): Promise<number | null> {
  if (!malId) return null;
  try {
    const response = await fetch(`${JIKAN}/anime/${malId}/full`);
    const data = (await response.json()) as { data?: { episodes?: number | null } };
    return data.data?.episodes ?? null;
  } catch {
    return null;
  }
}

export async function fetchJikanTrailerUrl(malId?: number, fallbackTitle?: string): Promise<string | null> {
  const tryMal = async (id: number) => {
    const response = await fetch(`${JIKAN}/anime/${id}/full`);
    const data = (await response.json()) as { data?: { trailer?: { embed_url?: string | null } } };
    return data.data?.trailer?.embed_url ?? null;
  };

  try {
    if (malId) {
      const direct = await tryMal(malId);
      if (direct) return direct;
    }
    if (fallbackTitle?.trim()) {
      const results = await searchJikanAnime(fallbackTitle, 1);
      const match = results.find((item) => item.mal_id);
      if (match?.mal_id) {
        return await tryMal(match.mal_id);
      }
    }
  } catch {
    return null;
  }
  return null;
}

// ── Title utilities ───────────────────────────────────────────────────────────

export function expandAnimeTitles(...titles: Array<string | undefined>): string[] {
  const values = new Set<string>();
  for (const rawTitle of titles) {
    const title = rawTitle?.trim();
    if (!title) continue;
    values.add(title);
    values.add(title.replace(/[:\-|].*$/, "").trim());
    values.add(title.replace(/\(.*?\)/g, "").trim());
    values.add(title.replace(/season\s+\d+/i, "").trim());
  }
  return [...values].filter(Boolean);
}

export async function searchAnimeFallbackCandidates(...titles: Array<string | undefined>): Promise<AnimeCardItem[]> {
  const titleCandidates = expandAnimeTitles(...titles).slice(0, 4);
  if (titleCandidates.length === 0) return [];

  const providerMatches = new Map<string, AnimeCardItem[]>();
  const requests = titleCandidates.flatMap((title) =>
    ANIME_FALLBACK_PROVIDERS.map((provider) =>
      searchConsumetDomain("anime", title, provider, 1).then((items) => ({ provider, items }))
    )
  );
  const settled = await Promise.allSettled(requests);

  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const current = providerMatches.get(result.value.provider) ?? [];
    const nextItems = result.value.items
      .map(toCardItem)
      .filter((item) => Boolean(item.id))
      .slice(0, Math.max(0, 2 - current.length));
    if (nextItems.length > 0) {
      providerMatches.set(result.value.provider, [...current, ...nextItems]);
    }
  }

  return dedupeItems([...providerMatches.values()].flat());
}

// ── TMDB lookups ──────────────────────────────────────────────────────────────

async function searchTmdbTv(query: string): Promise<number | null> {
  const data = (await searchTmdbMedia("tv", query, 1)) as { results?: Array<{ id?: number; name?: string; original_name?: string }> } | null;
  return data?.results?.[0]?.id ?? null;
}

async function searchTmdbMulti(query: string): Promise<number | null> {
  const data = (await searchTmdbMedia("multi", query, 1)) as { results?: Array<{ id?: number; media_type?: string }> } | null;
  const tvMatch = data?.results?.find((item) => item.media_type === "tv");
  return tvMatch?.id ?? null;
}

export async function findTmdbId(...titles: Array<string | undefined>): Promise<number | null> {
  const candidates = expandAnimeTitles(...titles);
  for (const title of candidates) {
    try {
      const tvId = await searchTmdbTv(title);
      if (tvId) return tvId;
      const multiId = await searchTmdbMulti(title);
      if (multiId) return multiId;
    } catch {
      continue;
    }
  }
  return null;
}

export async function fetchTmdbSeasonMap(tmdbId: number): Promise<Array<{ season: number; count: number }>> {
  const cached = tmdbSeasonCache.get(tmdbId);
  if (cached) return cached;
  const seasons = await fetchTmdbSeasonMapFromBackend(tmdbId);
  setBoundedCacheEntry(tmdbSeasonCache, tmdbId, seasons, TMDB_SEASON_CACHE_MAX);
  return seasons;
}

export async function resolveTmdbEpisodeNumber(tmdbId: number | null, episodeNumber: number): Promise<TmdbEpisodeRef | null> {
  if (!tmdbId || episodeNumber < 1) return null;
  try {
    const seasons = await fetchTmdbSeasonMap(tmdbId);
    if (seasons.length === 0) return { season: 1, episode: episodeNumber };

    let remaining = episodeNumber;
    for (const season of seasons) {
      if (remaining <= season.count) {
        return { season: season.season, episode: remaining };
      }
      remaining -= season.count;
    }
  } catch {
    return { season: 1, episode: episodeNumber };
  }
  return { season: 1, episode: episodeNumber };
}

// ── MovieBox hindi availability check ────────────────────────────────────────

export async function checkHindiAvailability(titleCandidates: string[]): Promise<boolean> {
  const results = await Promise.allSettled(
    titleCandidates.map((candidateTitle) =>
      searchMovieBox({
        query: candidateTitle,
        page: 1,
        perPage: 6,
        mediaType: "anime",
        animeOnly: true,
        preferHindi: true,
        sortBy: "search",
      })
    )
  );
  return results.some(
    (result) =>
      result.status === "fulfilled" &&
      result.value.items.some((item) => Boolean(item.is_hindi))
  );
}
