// anime/animeTypes.ts — shared types, constants, and module-level caches for AnimePage

import type { ConsumetMediaSummary } from "../../lib/consumetProviders";

// ── Tab & option types ────────────────────────────────────────────────────────

export type Tab = "trending" | "popular" | "toprated" | "seasonal" | "movie" | "schedule" | "genre";
export type TmdbEpisodeRef = { season: number; episode: number };
export type AnimeAudioOption = "en" | "original" | "hi";
export type AnimeServerOption = "auto" | "hd-1" | "hd-2";
export type TrendingPeriod = "daily" | "weekly" | "monthly";

// ── Data types ────────────────────────────────────────────────────────────────

export interface LegacyAnime {
  mal_id: number;
  title: string;
  title_english?: string;
  images: { jpg: { image_url: string; large_image_url?: string } };
  synopsis?: string;
  score?: number;
  episodes?: number;
  status?: string;
  genres?: { name: string }[];
  year?: number;
  trailer?: { embed_url?: string };
  url?: string;
}

export interface AnimeCardItem extends ConsumetMediaSummary {
  mal_id?: number;
  episodes_count?: number;
  trailer_url?: string;
}

// ── Module-level caches ───────────────────────────────────────────────────────

export const tmdbSeasonCache = new Map<number, Array<{ season: number; count: number }>>();
export const TMDB_SEASON_CACHE_MAX = 200;
export const NORMALIZED_IMAGE_URL_CACHE_MAX = 2000;
export const normalizedImageUrlCache = new Map<string, string>();

// ── UI constants ──────────────────────────────────────────────────────────────

export const AUDIO_BUTTONS: Array<{ id: AnimeAudioOption; label: string; help: string }> = [
  { id: "en", label: "Dub", help: "English audio first" },
  { id: "original", label: "Sub", help: "Original audio first" },
  { id: "hi", label: "Hindi", help: "Movie Box only when available" },
];

export const SERVER_BUTTONS: Array<{ id: AnimeServerOption; label: string; help: string }> = [
  { id: "auto", label: "Auto", help: "Fastest available source" },
  { id: "hd-1", label: "HD-1", help: "HiAnime primary" },
  { id: "hd-2", label: "HD-2", help: "HiAnime backup" },
];

export const ANIME_FALLBACK_PROVIDERS = ["animekai", "kickassanime", "animepahe"] as const;

export const JIKAN = "https://api.jikan.moe/v4";
