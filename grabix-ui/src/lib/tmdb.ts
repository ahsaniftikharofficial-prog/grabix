import { BACKEND_API } from "./api";
import { getCachedJson } from "./cache";

export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
export const TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";

export type TmdbMediaType = "movie" | "tv" | "multi";
export type TmdbDiscoverCategory = "trending" | "popular" | "top_rated" | "on_the_air";

function buildMetadataUrl(path: string): string {
  return `${BACKEND_API}${path}`;
}

/**
 * Fetch cached metadata, gracefully returning null on 503/429/network errors
 * instead of throwing — prevents unhandled-rejection CORS noise in the console
 * when TMDB is temporarily unavailable.
 */
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
    // Network errors, TMDB down, API key missing — all silently return null so
    // the rest of the UI can continue working without TMDB.
    return null;
  }
}

export async function discoverTmdbMedia(
  mediaType: "movie" | "tv",
  category: TmdbDiscoverCategory,
  page = 1
): Promise<any> {
  return await fetchCachedMetadata(
    `metadata:tmdb:discover:${mediaType}:${category}:${page}`,
    `/metadata/tmdb/discover?media_type=${encodeURIComponent(mediaType)}&category=${encodeURIComponent(category)}&page=${page}`
  );
}

export async function searchTmdbMedia(mediaType: TmdbMediaType, query: string, page = 1): Promise<any> {
  return await fetchCachedMetadata(
    `metadata:tmdb:search:${mediaType}:${page}:${query.trim().toLowerCase()}`,
    `/metadata/tmdb/search?media_type=${encodeURIComponent(mediaType)}&query=${encodeURIComponent(query)}&page=${page}`
  );
}

export async function fetchTmdbDetails(
  mediaType: "movie" | "tv",
  id: number,
  appendToResponse = ""
): Promise<any> {
  const append = appendToResponse.trim();
  const suffix = append ? `&append_to_response=${encodeURIComponent(append)}` : "";
  return await fetchCachedMetadata(
    `metadata:tmdb:details:${mediaType}:${id}:${append}`,
    `/metadata/tmdb/details?media_type=${encodeURIComponent(mediaType)}&id=${id}${suffix}`
  );
}

export async function fetchTmdbTvSeason(id: number, season: number): Promise<any> {
  return await fetchCachedMetadata(
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
