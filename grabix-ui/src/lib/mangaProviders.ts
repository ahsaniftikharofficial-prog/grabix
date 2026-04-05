import { BACKEND_API, extractBackendErrorMessage } from "./api";
import { getCachedJson } from "./cache";

export const MANGA_SOURCES = {
  ANILIST: "anilist",
  JIKAN: "jikan",
  MANGADEX: "mangadex",
  COMICK: "comick",
} as const;

export const BACKEND_BASE = BACKEND_API;

export const MANGA_ENDPOINTS = {
  trending: (page = 1) => `${BACKEND_BASE}/manga/trending?page=${page}`,
  search: (query: string, source = "anilist", page = 1) =>
    `${BACKEND_BASE}/manga/search?query=${encodeURIComponent(query)}&source=${source}&page=${page}`,
  details: (id: string | number, source = "anilist_id") =>
    `${BACKEND_BASE}/manga/${id}/details?source=${source}`,
  chapters: (id: string, lang = "en") =>
    `${BACKEND_BASE}/manga/${id}/chapters?language=${lang}`,
  pages: (chapterId: string) => `${BACKEND_BASE}/manga/chapter/${chapterId}/pages`,
  recommendations: (id: string | number) => `${BACKEND_BASE}/manga/recommendations/${id}`,
  seasonal: (year: number, season: string) =>
    `${BACKEND_BASE}/manga/seasonal?year=${year}&season=${season}`,
  frontpage: (section = "trending", page = 1, limit = 12, days = 7) =>
    `${BACKEND_BASE}/manga/frontpage?section=${encodeURIComponent(section)}&page=${page}&limit=${limit}&days=${days}`,
  comickChapters: (title: string) =>
    `${BACKEND_BASE}/manga/comick/chapters?title=${encodeURIComponent(title)}`,
  comickPages: (url: string) =>
    `${BACKEND_BASE}/manga/comick/pages?url=${encodeURIComponent(url)}`,
  imageProxy: (url: string) =>
    `${BACKEND_BASE}/manga/image-proxy?url=${encodeURIComponent(url)}`,
} as const;

export interface MangaDiscoveryItem {
  anilist_id?: number;
  mal_id?: number;
  mangadex_id?: string;
  title: string;
  cover_image: string;
  score: number;
  genres: string[];
  status: string;
  description: string;
  year?: number;
}

export interface MangaMetadata {
  mal_id?: number;
  title: string;
  score: number;
  rank?: number;
  synopsis: string;
  genres: string[];
  authors: string[];
  serialization: string;
  status: string;
  chapters?: number | null;
  cover_image: string;
}

export interface MangaDexDetails {
  mangadex_id: string;
  title: string;
  description: string;
  cover_image: string;
  status: string;
  genres: string[];
  year?: number;
}

export interface MangaChapter {
  chapter_id: string;
  chapter_number: string;
  title?: string | null;
  language: string;
  pages: number;
  published_at: string;
  provider?: "mangadex" | "comick";
  source_name?: string;
  chapter_url?: string;
}

export interface MangaRelatedItem {
  relation?: string;
  mal_id?: number;
  title: string;
}

export interface MangaDetailsResponse {
  anilist: MangaDiscoveryItem | null;
  jikan: MangaMetadata | null;
  mangadex: MangaDexDetails | null;
  comick: {
    title: string;
    cover_image: string;
    source?: string;
    comick_source?: string;
    comick_url?: string;
  } | null;
  related: MangaRelatedItem[];
  chapter_count: number;
}

async function getCachedMangaJson<T>(key: string, url: string, ttlMs: number, scope: "memory" | "session" | "local" = "local"): Promise<T> {
  return await getCachedJson<T>({
    key,
    url,
    ttlMs,
    scope,
    mapError: async (response) => {
      let detail = "";
      try {
        const data = await response.json();
        detail = extractBackendErrorMessage(data, "");
      } catch {
        detail = "";
      }
      return detail || `Server error: ${response.status}`;
    },
  });
}

export function toMangaImageProxy(url: string): string {
  return url ? MANGA_ENDPOINTS.imageProxy(url) : "";
}

export async function fetchTrendingManga(page = 1): Promise<MangaDiscoveryItem[]> {
  const data = await getCachedMangaJson<{ items: MangaDiscoveryItem[] }>(
    `manga:trending:${page}`,
    MANGA_ENDPOINTS.trending(page),
    300_000
  );
  return data.items ?? [];
}

export async function fetchSeasonalManga(year: number, season: string): Promise<MangaDiscoveryItem[]> {
  const data = await getCachedMangaJson<{ items: MangaDiscoveryItem[] }>(
    `manga:seasonal:${year}:${season}`,
    MANGA_ENDPOINTS.seasonal(year, season),
    300_000
  );
  return data.items ?? [];
}

export async function searchManga(query: string, source = "anilist", page = 1): Promise<MangaDiscoveryItem[]> {
  const data = await getCachedMangaJson<{ items: MangaDiscoveryItem[] }>(
    `manga:search:${source}:${page}:${query.trim().toLowerCase()}`,
    MANGA_ENDPOINTS.search(query, source, page),
    180_000
  );
  return data.items ?? [];
}

export async function fetchMangaDetails(id: string | number, source = "anilist_id"): Promise<MangaDetailsResponse> {
  return await getCachedMangaJson<MangaDetailsResponse>(
    `manga:details:${source}:${id}`,
    MANGA_ENDPOINTS.details(id, source),
    300_000
  );
}

export async function fetchMangaChapters(id: string, language = "en"): Promise<MangaChapter[]> {
  const data = await getCachedMangaJson<{ items: MangaChapter[] }>(
    `manga:chapters:${id}:${language}`,
    MANGA_ENDPOINTS.chapters(id, language),
    300_000
  );
  return data.items ?? [];
}

export async function fetchMangaPages(chapterId: string): Promise<string[]> {
  const data = await getCachedMangaJson<{ pages: string[] }>(
    `manga:pages:${chapterId}`,
    MANGA_ENDPOINTS.pages(chapterId),
    600_000,
    "session"
  );
  return (data.pages ?? []).map(toMangaImageProxy);
}

export async function fetchMangaRecommendations(id: string | number): Promise<MangaDiscoveryItem[]> {
  const data = await getCachedMangaJson<{ items: MangaDiscoveryItem[] }>(
    `manga:recommendations:${id}`,
    MANGA_ENDPOINTS.recommendations(id),
    300_000
  );
  return data.items ?? [];
}

export async function fetchComickFrontpage(section = "trending", page = 1, limit = 12, days = 7): Promise<MangaDiscoveryItem[]> {
  const data = await getCachedMangaJson<{ items: MangaDiscoveryItem[] }>(
    `manga:frontpage:${section}:${page}:${limit}:${days}`,
    MANGA_ENDPOINTS.frontpage(section, page, limit, days),
    300_000
  );
  return data.items ?? [];
}

export async function fetchComickChapters(title: string): Promise<{ match: MangaDiscoveryItem | null; items: MangaChapter[]; total: number }> {
  return await getCachedMangaJson<{ match: MangaDiscoveryItem | null; items: MangaChapter[]; total: number }>(
    `manga:comick:chapters:${title.trim().toLowerCase()}`,
    MANGA_ENDPOINTS.comickChapters(title),
    300_000
  );
}

export async function fetchComickPages(url: string): Promise<string[]> {
  const data = await getCachedMangaJson<{ pages: string[] }>(
    `manga:comick:pages:${url}`,
    MANGA_ENDPOINTS.comickPages(url),
    600_000,
    "session"
  );
  return (data.pages ?? []).map(toMangaImageProxy);
}
