// lib/trailerResolver.ts — resolves a YouTube trailer key from TMDB videos API
import { fetchTmdbVideos } from "./tmdb";

export interface TrailerResult {
  key: string;
  name: string;
}

const cache = new Map<string, TrailerResult | null>();

/**
 * Returns the best YouTube trailer key for a given TMDB item.
 * Priority: Official Trailer > Trailer > Teaser.
 * Returns null if no suitable video found.
 */
export async function resolveTrailer(
  mediaType: "movie" | "tv",
  id: number
): Promise<TrailerResult | null> {
  const cacheKey = `${mediaType}:${id}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  try {
    const data = await fetchTmdbVideos(mediaType, id);
    const results: any[] = data?.results ?? [];

    const youtubeVideos = results.filter(
      (v) => v.site === "YouTube" && v.type !== "Clip" && v.type !== "Featurette"
    );

    const pick =
      youtubeVideos.find(
        (v) => v.type === "Trailer" && v.name.toLowerCase().includes("official")
      ) ||
      youtubeVideos.find((v) => v.type === "Trailer") ||
      youtubeVideos.find((v) => v.type === "Teaser") ||
      youtubeVideos[0] ||
      null;

    const result: TrailerResult | null = pick
      ? { key: pick.key as string, name: pick.name as string }
      : null;

    cache.set(cacheKey, result);
    return result;
  } catch {
    cache.set(cacheKey, null);
    return null;
  }
}
