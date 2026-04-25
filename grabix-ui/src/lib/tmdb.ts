// grabix-ui/src/lib/tmdb.ts
// Calls TMDB directly from the browser when VITE_TMDB_KEY or VITE_TMDB_TOKEN is set.
// Falls back to the local backend proxy if neither is available.

export const TMDB_IMAGE_BASE    = "https://image.tmdb.org/t/p/w500";
export const TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";
export const TMDB_PROFILE_BASE  = "https://image.tmdb.org/t/p/w185";
const TMDB_API_BASE             = "https://api.themoviedb.org/3";

export type TmdbMediaType        = "movie" | "tv" | "multi";
export type TmdbDiscoverCategory = "trending" | "popular" | "top_rated" | "on_the_air";

// ── Auth credentials (set in .env) ────────────────────────────────────────────
// Use VITE_TMDB_TOKEN (Bearer / Read Access Token) — preferred
// OR  VITE_TMDB_KEY   (v3 API Key) — also works
const TMDB_TOKEN: string = (import.meta.env.VITE_TMDB_TOKEN as string) ?? "";
const TMDB_KEY:   string = (import.meta.env.VITE_TMDB_KEY   as string) ?? "";

function canCallDirect(): boolean {
  return Boolean(TMDB_TOKEN || TMDB_KEY);
}

// ── In-memory cache ───────────────────────────────────────────────────────────
const _mem = new Map<string, { exp: number; val: unknown }>();

function memGet<T>(key: string): T | null {
  const e = _mem.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) { _mem.delete(key); return null; }
  return e.val as T;
}

function memSet<T>(key: string, val: T, ttlMs: number): T {
  _mem.set(key, { exp: Date.now() + ttlMs, val });
  return val;
}

// ── Direct TMDB fetch (browser → TMDB) ───────────────────────────────────────
async function fetchDirect<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  ttlMs = 180_000
): Promise<T | null> {
  const key = `tmdb:direct:${path}:${JSON.stringify(params)}`;
  const cached = memGet<T>(key);
  if (cached !== null) return cached;

  try {
    const url = new URL(`${TMDB_API_BASE}${path}`);

    if (!TMDB_TOKEN && TMDB_KEY) {
      url.searchParams.set("api_key", TMDB_KEY);
    }

    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (TMDB_TOKEN) headers["Authorization"] = `Bearer ${TMDB_TOKEN}`;

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) return null;
    const data = (await res.json()) as T;
    return memSet(key, data, ttlMs);
  } catch {
    return null;
  }
}

// ── Backend proxy fetch (browser → localhost:8000 → TMDB) ────────────────────
import { BACKEND_API } from "./api";
import { getCachedJson } from "./cache";

async function fetchProxy<T>(
  cacheKey: string,
  path: string,
  ttlMs = 180_000
): Promise<T | null> {
  try {
    return await getCachedJson<T>({
      key: cacheKey,
      url: `${BACKEND_API}${path}`,
      ttlMs,
      scope: "session",
      mapError: async (r) => {
        if (r.status === 503) return "TMDB unavailable (503)";
        if (r.status === 429) return "TMDB rate limited (429)";
        if (r.status === 401) return "TMDB not configured (401)";
        return `Metadata failed ${r.status}`;
      },
    });
  } catch {
    return null;
  }
}

// ── Route to the right strategy ───────────────────────────────────────────────
async function tmdb<T>(
  directPath: string,
  directParams: Record<string, string | number | undefined>,
  proxyPath: string,
  ttlMs = 180_000
): Promise<T | null> {
  if (canCallDirect()) {
    return fetchDirect<T>(directPath, directParams, ttlMs);
  }
  return fetchProxy<T>(
    `metadata:tmdb:${proxyPath}`,
    `/metadata/tmdb/${proxyPath}`,
    ttlMs
  );
}

// ── Public API (same signatures as before — nothing else needs to change) ──────

export async function discoverTmdbMedia(
  mediaType: "movie" | "tv",
  category: TmdbDiscoverCategory,
  page = 1
): Promise<any> {
  const MAP: Record<string, string> = {
    "movie:trending":  "/trending/movie/week",
    "movie:popular":   "/movie/popular",
    "movie:top_rated": "/movie/top_rated",
    "tv:trending":     "/trending/tv/week",
    "tv:popular":      "/tv/popular",
    "tv:top_rated":    "/tv/top_rated",
    "tv:on_the_air":   "/tv/on_the_air",
  };
  const path = MAP[`${mediaType}:${category}`];
  if (!path) return null;
  return tmdb(
    path, { page },
    `discover?media_type=${mediaType}&category=${category}&page=${page}`
  );
}

export async function searchTmdbMedia(
  mediaType: TmdbMediaType,
  query: string,
  page = 1
): Promise<any> {
  return tmdb(
    `/search/${mediaType}`, { query, page },
    `search?media_type=${mediaType}&query=${encodeURIComponent(query)}&page=${page}`
  );
}

export async function fetchTmdbDetails(
  mediaType: "movie" | "tv",
  id: number,
  appendToResponse = ""
): Promise<any> {
  const extra: Record<string, string | undefined> = appendToResponse.trim()
    ? { append_to_response: appendToResponse }
    : {};
  return tmdb(
    `/${mediaType}/${id}`, extra,
    `details?media_type=${mediaType}&id=${id}`
  );
}

export async function fetchTmdbTvSeason(id: number, season: number): Promise<any> {
  return tmdb(
    `/tv/${id}/season/${season}`, {},
    `tv-season?id=${id}&season=${season}`
  );
}

export async function fetchTmdbSeasonMap(
  id: number
): Promise<Array<{ season: number; count: number }>> {
  if (canCallDirect()) {
    const details = await fetchDirect<any>(`/tv/${id}`, {});
    if (!details) return [];
    return (details.seasons ?? [])
      .filter((s: any) => s.season_number > 0 && s.episode_count > 0)
      .map((s: any) => ({ season: s.season_number as number, count: s.episode_count as number }));
  }
  const payload = await fetchProxy<{ seasons?: Array<{ season: number; count: number }> }>(
    `metadata:tmdb:tv-season-map:${id}`,
    `/metadata/tmdb/tv-season-map?id=${id}`
  );
  return payload?.seasons ?? [];
}

export async function fetchTmdbGenres(mediaType: "movie" | "tv"): Promise<any> {
  return tmdb(
    `/genre/${mediaType}/list`, {},
    `genres?media_type=${mediaType}`,
    86_400_000
  );
}

export async function discoverTmdbByGenre(
  mediaType: "movie" | "tv",
  genreId: number,
  page = 1,
  sortBy = "popularity.desc",
  year?: number,
  minRating?: number
): Promise<any> {
  const params: Record<string, string | number | undefined> = {
    with_genres: genreId,
    page,
    sort_by: sortBy,
  };
  if (year) {
    params[mediaType === "movie" ? "primary_release_year" : "first_air_date_year"] = year;
  }
  if (minRating) params["vote_average.gte"] = minRating;

  return tmdb(
    `/discover/${mediaType}`, params,
    `discover-genre?media_type=${mediaType}&genre_id=${genreId}&page=${page}&sort_by=${sortBy}`
  );
}

export async function fetchTmdbRecommendations(
  mediaType: "movie" | "tv",
  id: number,
  page = 1
): Promise<any> {
  return tmdb(
    `/${mediaType}/${id}/recommendations`, { page },
    `recommendations?media_type=${mediaType}&id=${id}&page=${page}`
  );
}

export async function fetchTmdbCredits(
  mediaType: "movie" | "tv",
  id: number
): Promise<any> {
  return tmdb(
    `/${mediaType}/${id}/credits`, {},
    `credits?media_type=${mediaType}&id=${id}`,
    3_600_000
  );
}

export async function fetchTmdbVideos(
  mediaType: "movie" | "tv",
  id: number
): Promise<any> {
  return tmdb(
    `/${mediaType}/${id}/videos`, {},
    `videos?media_type=${mediaType}&id=${id}`,
    3_600_000
  );
}

export async function fetchTmdbNowPlaying(page = 1): Promise<any> {
  return tmdb("/movie/now_playing", { page }, `now-playing?page=${page}`);
}

export async function fetchTmdbUpcoming(page = 1): Promise<any> {
  return tmdb("/movie/upcoming", { page }, `upcoming?page=${page}`);
}

export async function fetchTmdbAiringToday(page = 1): Promise<any> {
  return tmdb("/tv/airing_today", { page }, `airing-today?page=${page}`);
}

export async function fetchTmdbWatchProviders(
  mediaType: "movie" | "tv",
  id: number
): Promise<any> {
  if (canCallDirect()) {
    const data = await fetchDirect<any>(
      `/${mediaType}/${id}/watch/providers`, {},
      3_600_000
    );
    const us = data?.results?.US ?? {};
    return { providers: { flatrate: us.flatrate ?? [] } };
  }
  return fetchProxy(
    `metadata:tmdb:watch-providers:${mediaType}:${id}`,
    `/metadata/tmdb/watch-providers?media_type=${mediaType}&id=${id}`,
    3_600_000
  );
}
