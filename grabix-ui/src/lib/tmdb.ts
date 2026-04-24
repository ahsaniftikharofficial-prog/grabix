import { BACKEND_API } from "./api";
import { getCachedJson } from "./cache";

export const TMDB_IMAGE_BASE    = "https://image.tmdb.org/t/p/w500";
export const TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";
export const TMDB_PROFILE_BASE  = "https://image.tmdb.org/t/p/w185";

export type TmdbMediaType        = "movie" | "tv" | "multi";
export type TmdbDiscoverCategory = "trending" | "popular" | "top_rated" | "on_the_air";

function buildMetadataUrl(path: string): string {
  return `${BACKEND_API}${path}`;
}

async function fetchCachedMetadata<T>(
  key: string,
  path: string,
  ttlMs = 180_000
): Promise<T | null> {
  try {
    return await getCachedJson<T>({
      key,
      url: buildMetadataUrl(path),
      ttlMs,
      scope: "session",
      mapError: async (response) => {
        if (response.status === 503) return "TMDB service temporarily unavailable (503)";
        if (response.status === 429) return "TMDB rate limit exceeded (429)";
        if (response.status === 401) return "TMDB API key not configured (401)";
        return `Metadata request failed with ${response.status}`;
      },
    });
  } catch {
    return null;
  }
}

export async function discoverTmdbMedia(
  mediaType: "movie" | "tv",
  category: TmdbDiscoverCategory,
  page = 1
): Promise<any> {
  return fetchCachedMetadata(
    `metadata:tmdb:discover:${mediaType}:${category}:${page}`,
    `/metadata/tmdb/discover?media_type=${mediaType}&category=${category}&page=${page}`
  );
}

export async function searchTmdbMedia(mediaType: TmdbMediaType, query: string, page = 1): Promise<any> {
  return fetchCachedMetadata(
    `metadata:tmdb:search:${mediaType}:${page}:${query.trim().toLowerCase()}`,
    `/metadata/tmdb/search?media_type=${mediaType}&query=${encodeURIComponent(query)}&page=${page}`
  );
}

export async function fetchTmdbDetails(
  mediaType: "movie" | "tv",
  id: number,
  appendToResponse = ""
): Promise<any> {
  const suffix = appendToResponse.trim() ? `&append_to_response=${encodeURIComponent(appendToResponse)}` : "";
  return fetchCachedMetadata(
    `metadata:tmdb:details:${mediaType}:${id}:${appendToResponse}`,
    `/metadata/tmdb/details?media_type=${mediaType}&id=${id}${suffix}`
  );
}

export async function fetchTmdbTvSeason(id: number, season: number): Promise<any> {
  return fetchCachedMetadata(
    `metadata:tmdb:tv-season:${id}:${season}`,
    `/metadata/tmdb/tv-season?id=${id}&season=${season}`
  );
}

export async function fetchTmdbSeasonMap(id: number): Promise<Array<{ season: number; count: number }>> {
  const payload = await fetchCachedMetadata<{ seasons?: Array<{ season: number; count: number }> }>(
    `metadata:tmdb:tv-season-map:${id}`,
    `/metadata/tmdb/tv-season-map?id=${id}`
  );
  return payload?.seasons ?? [];
}

// ── New Netflix-style API calls ───────────────────────────────────────────────

export async function fetchTmdbGenres(mediaType: "movie" | "tv"): Promise<any> {
  return fetchCachedMetadata(
    `metadata:tmdb:genres:${mediaType}`,
    `/metadata/tmdb/genres?media_type=${mediaType}`,
    86_400_000 // cache 24 hours — genres rarely change
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
  const params = new URLSearchParams({
    media_type: mediaType,
    genre_id: String(genreId),
    page: String(page),
    sort_by: sortBy,
  });
  if (year)      params.set("year", String(year));
  if (minRating) params.set("min_rating", String(minRating));
  return fetchCachedMetadata(
    `metadata:tmdb:discover-genre:${mediaType}:${genreId}:${page}:${sortBy}:${year}:${minRating}`,
    `/metadata/tmdb/discover-genre?${params}`
  );
}

export async function fetchTmdbRecommendations(mediaType: "movie" | "tv", id: number, page = 1): Promise<any> {
  return fetchCachedMetadata(
    `metadata:tmdb:recs:${mediaType}:${id}:${page}`,
    `/metadata/tmdb/recommendations?media_type=${mediaType}&id=${id}&page=${page}`
  );
}

export async function fetchTmdbCredits(mediaType: "movie" | "tv", id: number): Promise<any> {
  return fetchCachedMetadata(
    `metadata:tmdb:credits:${mediaType}:${id}`,
    `/metadata/tmdb/credits?media_type=${mediaType}&id=${id}`,
    3_600_000
  );
}

export async function fetchTmdbVideos(mediaType: "movie" | "tv", id: number): Promise<any> {
  return fetchCachedMetadata(
    `metadata:tmdb:videos:${mediaType}:${id}`,
    `/metadata/tmdb/videos?media_type=${mediaType}&id=${id}`,
    3_600_000
  );
}

export async function fetchTmdbNowPlaying(page = 1): Promise<any> {
  return fetchCachedMetadata(
    `metadata:tmdb:now-playing:${page}`,
    `/metadata/tmdb/now-playing?page=${page}`
  );
}

export async function fetchTmdbUpcoming(page = 1): Promise<any> {
  return fetchCachedMetadata(
    `metadata:tmdb:upcoming:${page}`,
    `/metadata/tmdb/upcoming?page=${page}`
  );
}

export async function fetchTmdbAiringToday(page = 1): Promise<any> {
  return fetchCachedMetadata(
    `metadata:tmdb:airing-today:${page}`,
    `/metadata/tmdb/airing-today?page=${page}`
  );
}

export async function fetchTmdbWatchProviders(mediaType: "movie" | "tv", id: number): Promise<any> {
  return fetchCachedMetadata(
    `metadata:tmdb:watch-providers:${mediaType}:${id}`,
    `/metadata/tmdb/watch-providers?media_type=${mediaType}&id=${id}`,
    3_600_000
  );
}
