/**
 * aniwatchProviders.ts
 *
 * PRIMARY anime data source for Grabix.
 * Calls the /aniwatch/ backend routes which hit the local consumet-local
 * Node.js server (aniwatch npm, aniwatchtv.to mirror) with an 8-second
 * timeout — failing fast to Jikan fallback instead of hanging for 45s.
 *
 * Items returned use provider="hianime" so the existing watch/stream/download
 * flow in consumetProviders.ts works without any changes.
 */

import { BACKEND_API } from "./api";
import type { ConsumetMediaSummary } from "./consumetProviders";

// Re-export ConsumetMediaSummary so callers don't need two imports
export type { ConsumetMediaSummary };

export type AniwatchSection =
  | "trending"
  | "popular"
  | "toprated"
  | "seasonal"
  | "movie"
  | "subbed"
  | "dubbed"
  | "ova"
  | "ona"
  | "tv"
  | "special"
  | "recently-updated"
  | "recently-added"
  | "top-upcoming";

export type AniwatchPeriod = "daily" | "weekly" | "monthly";

export interface AniwatchDiscoverResult {
  section: string;
  page: number;
  source: string;
  has_next: boolean;
  items: ConsumetMediaSummary[];
}

export interface AniwatchSearchResult {
  query: string;
  page: number;
  source: string;
  has_next: boolean;
  items: ConsumetMediaSummary[];
}

export interface AniwatchGenre {
  id: string;
  name: string;
}

export interface AniwatchScheduledAnime {
  id: string;
  title: string;
  image: string;
  url: string;
  time: string;
}

export interface AniwatchScheduleResult {
  date: string;
  source: string;
  scheduled: AniwatchScheduledAnime[];
}

export interface AniwatchHealth {
  healthy: boolean;
  source: string;
  base?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// In-memory cache (same pattern as consumetProviders.ts)
// ---------------------------------------------------------------------------

const _memCache = new Map<string, { expiresAt: number; value: unknown }>();
const _pending = new Map<string, Promise<unknown>>();

function memGet<T>(key: string): T | null {
  const entry = _memCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    _memCache.delete(key);
    return null;
  }
  return entry.value as T;
}

function memSet(key: string, value: unknown, ttlMs: number) {
  _memCache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

async function cachedGet<T>(key: string, path: string, ttlMs: number): Promise<T> {
  const cached = memGet<T>(key);
  if (cached) return cached;

  const pending = _pending.get(key);
  if (pending) return pending as Promise<T>;

  const req = (async (): Promise<T> => {
    const resp = await fetch(`${BACKEND_API}${path}`);
    if (!resp.ok) {
      let detail = "";
      try {
        const body = await resp.json();
        detail =
          (body as { detail?: string }).detail ||
          (body as { message?: string }).message ||
          "";
      } catch {
        // ignore
      }
      throw new Error(detail || `Request failed with ${resp.status}`);
    }
    const data = (await resp.json()) as T;
    memSet(key, data, ttlMs);
    return data;
  })().finally(() => _pending.delete(key));

  _pending.set(key, req as Promise<unknown>);
  return req;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchAniwatchHealth(): Promise<AniwatchHealth> {
  return cachedGet<AniwatchHealth>(
    "aniwatch:health",
    "/aniwatch/health",
    30_000,
  );
}

/**
 * Discover anime by section.
 * Primary: AniWatch local server (aniwatchtv.to) → Fallback: Jikan.
 * Items carry provider="hianime" so play/download flow works unchanged.
 */
export async function fetchAniwatchDiscover(
  section: AniwatchSection = "trending",
  page = 1,
  period: AniwatchPeriod = "daily",
): Promise<AniwatchDiscoverResult> {
  const key = `aniwatch:discover:${section}:${page}:${period}`;
  const path = `/aniwatch/discover?section=${encodeURIComponent(section)}&page=${page}&period=${encodeURIComponent(period)}`;
  return cachedGet<AniwatchDiscoverResult>(key, path, 300_000);
}

/**
 * Search anime.
 * Primary: AniWatch → Fallback: Jikan.
 */
export async function searchAniwatch(
  query: string,
  page = 1,
): Promise<AniwatchSearchResult> {
  const key = `aniwatch:search:${page}:${query.trim().toLowerCase()}`;
  const path = `/aniwatch/search?query=${encodeURIComponent(query)}&page=${page}`;
  return cachedGet<AniwatchSearchResult>(key, path, 120_000);
}

/**
 * Get list of available genres.
 */
export async function fetchAniwatchGenres(): Promise<AniwatchGenre[]> {
  const data = await cachedGet<{ genres: AniwatchGenre[] }>(
    "aniwatch:genres",
    "/aniwatch/genres",
    3_600_000,
  );
  return data.genres ?? [];
}

/**
 * Get anime by genre.
 */
export async function fetchAniwatchGenreAnime(
  genre: string,
  page = 1,
): Promise<AniwatchDiscoverResult> {
  const key = `aniwatch:genre:${genre.toLowerCase()}:${page}`;
  const path = `/aniwatch/genre/${encodeURIComponent(genre)}?page=${page}`;
  return cachedGet<AniwatchDiscoverResult>(key, path, 300_000);
}

/**
 * Get airing schedule for a date (YYYY-MM-DD).
 */
export async function fetchAniwatchSchedule(
  date: string,
): Promise<AniwatchScheduleResult> {
  const key = `aniwatch:schedule:${date}`;
  const path = `/aniwatch/schedule?date=${encodeURIComponent(date)}`;
  return cachedGet<AniwatchScheduleResult>(key, path, 600_000);
}

/**
 * Get spotlight/hero anime.
 */
export async function fetchAniwatchSpotlight(): Promise<ConsumetMediaSummary[]> {
  const data = await cachedGet<{ items: ConsumetMediaSummary[] }>(
    "aniwatch:spotlight",
    "/aniwatch/spotlight",
    300_000,
  );
  return data.items ?? [];
}

/**
 * Warm multiple sections in the background.
 * Call after the initial section loads to pre-populate cache.
 */
export function warmAniwatchSections(
  sections: AniwatchSection[],
  period: AniwatchPeriod = "daily",
): void {
  void Promise.allSettled(
    sections.map((s) => fetchAniwatchDiscover(s, 1, s === "trending" ? period : "daily")),
  );
}
