export const MANGA_SOURCES = {
  ANILIST: "anilist",
  JIKAN: "jikan",
  MANGADEX: "mangadex",
  COMICK: "comick",
} as const;

export const BACKEND_BASE = "http://127.0.0.1:8000";

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

async function getJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Unable to reach the manga service.");
  }

  if (!response.ok) {
    let detail = "";
    try {
      const data = (await response.json()) as { detail?: string };
      detail = typeof data?.detail === "string" ? data.detail : "";
    } catch {
      detail = "";
    }
    throw new Error(detail || `Server error: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchTrendingManga(page = 1): Promise<MangaDiscoveryItem[]> {
  const data = await getJson<{ items: MangaDiscoveryItem[] }>(MANGA_ENDPOINTS.trending(page));
  return data.items ?? [];
}

export async function fetchSeasonalManga(year: number, season: string): Promise<MangaDiscoveryItem[]> {
  const data = await getJson<{ items: MangaDiscoveryItem[] }>(MANGA_ENDPOINTS.seasonal(year, season));
  return data.items ?? [];
}

export async function searchManga(query: string, source = "anilist", page = 1): Promise<MangaDiscoveryItem[]> {
  const data = await getJson<{ items: MangaDiscoveryItem[] }>(MANGA_ENDPOINTS.search(query, source, page));
  return data.items ?? [];
}

export async function fetchMangaDetails(id: string | number, source = "anilist_id"): Promise<MangaDetailsResponse> {
  return await getJson<MangaDetailsResponse>(MANGA_ENDPOINTS.details(id, source));
}

export async function fetchMangaChapters(id: string, language = "en"): Promise<MangaChapter[]> {
  const data = await getJson<{ items: MangaChapter[] }>(MANGA_ENDPOINTS.chapters(id, language));
  return data.items ?? [];
}

export async function fetchMangaPages(chapterId: string): Promise<string[]> {
  const data = await getJson<{ pages: string[] }>(MANGA_ENDPOINTS.pages(chapterId));
  return data.pages ?? [];
}

export async function fetchMangaRecommendations(id: string | number): Promise<MangaDiscoveryItem[]> {
  const data = await getJson<{ items: MangaDiscoveryItem[] }>(MANGA_ENDPOINTS.recommendations(id));
  return data.items ?? [];
}

export async function fetchComickFrontpage(section = "trending", page = 1, limit = 12, days = 7): Promise<MangaDiscoveryItem[]> {
  const data = await getJson<{ items: MangaDiscoveryItem[] }>(MANGA_ENDPOINTS.frontpage(section, page, limit, days));
  return data.items ?? [];
}

export async function fetchComickChapters(title: string): Promise<{ match: MangaDiscoveryItem | null; items: MangaChapter[]; total: number }> {
  return await getJson<{ match: MangaDiscoveryItem | null; items: MangaChapter[]; total: number }>(MANGA_ENDPOINTS.comickChapters(title));
}

export async function fetchComickPages(url: string): Promise<string[]> {
  const data = await getJson<{ pages: string[] }>(MANGA_ENDPOINTS.comickPages(url));
  return data.pages ?? [];
}
