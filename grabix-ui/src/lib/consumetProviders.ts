import { BACKEND_API, type StreamSource } from "./streamProviders";

export type ConsumetDomain = "anime" | "manga" | "books" | "comics" | "light-novels";
export type AudioPreference = "hi" | "en" | "original";

export interface ConsumetMediaSummary {
  id: string;
  provider: string;
  type: string;
  title: string;
  alt_title?: string;
  image?: string;
  description?: string;
  year?: number | null;
  rating?: number | null;
  status?: string;
  genres: string[];
  languages: string[];
  url?: string;
  raw?: unknown;
  mal_id?: number;
  anilist_id?: number;
  mangadex_id?: string;
  episodes_count?: number;
  dub_episode_count?: number;
  trailer_url?: string;
}

export interface ConsumetEpisode {
  id: string;
  provider: string;
  number: number;
  title: string;
  is_filler?: boolean;
  languages: string[];
  raw?: unknown;
}

export interface ConsumetChapter {
  id: string;
  provider: string;
  number: string;
  title?: string;
  language?: string;
  released_at?: string;
  raw?: unknown;
}

export interface ConsumetMediaDetail {
  domain: string;
  provider: string;
  item: ConsumetMediaSummary & {
    episodes?: ConsumetEpisode[];
    chapters?: ConsumetChapter[];
  };
  raw?: unknown;
}

export interface ConsumetWatchResult {
  provider: string;
  requested_audio: string;
  available_audio: string[];
  selected_server?: string;
  category?: string;
  headers?: Record<string, string>;
  download?: string;
  subtitles: Array<{
    id: string;
    label: string;
    language?: string;
    url: string;
    originalUrl?: string;
  }>;
  sources: StreamSource[];
  raw?: unknown;
}

export interface ConsumetHealth {
  configured: boolean;
  healthy: boolean;
  api_base?: string;
  message: string;
  default_audio_priority: string[];
  default_subtitle_priority: string[];
}

export interface ConsumetNewsItem {
  id: string;
  title: string;
  description?: string;
  image?: string;
  url?: string;
  published_at?: string;
  topic?: string;
  raw?: unknown;
}

export interface ConsumetNewsArticle extends ConsumetNewsItem {
  content?: string;
}

export function toConsumetProxyUrl(url: string): string {
  return url ? `${BACKEND_API}/consumet/proxy?url=${encodeURIComponent(url)}` : "";
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Unknown request failure.");
}

const memoryCache = new Map<string, { expiresAt: number; value: unknown }>();
const pendingRequests = new Map<string, Promise<unknown>>();

function getMemoryCache<T>(key: string): T | null {
  const cached = memoryCache.get(key);
  if (!cached) return null;
  if (Date.now() >= cached.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return cached.value as T;
}

function setMemoryCache(key: string, value: unknown, ttlMs: number) {
  memoryCache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

function getStorageCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { expiresAt?: number; value?: T };
    if (!parsed?.expiresAt || Date.now() >= parsed.expiresAt) {
      window.localStorage.removeItem(key);
      return null;
    }
    return (parsed.value as T) ?? null;
  } catch {
    return null;
  }
}

function setStorageCache(key: string, value: unknown, ttlMs: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ expiresAt: Date.now() + ttlMs, value }));
  } catch {
    // Ignore storage write failures.
  }
}

async function getCachedJson<T>(
  cacheKey: string,
  path: string,
  ttlMs: number,
  useStorage = false
): Promise<T> {
  const cached = getMemoryCache<T>(cacheKey) ?? (useStorage ? getStorageCache<T>(cacheKey) : null);
  if (cached) return cached;

  const pending = pendingRequests.get(cacheKey);
  if (pending) return pending as Promise<T>;

  const request = getJson<T>(path)
    .then((value) => {
      setMemoryCache(cacheKey, value, ttlMs);
      if (useStorage) {
        setStorageCache(cacheKey, value, ttlMs);
      }
      return value;
    })
    .finally(() => {
      pendingRequests.delete(cacheKey);
    });

  pendingRequests.set(cacheKey, request as Promise<unknown>);
  return request;
}

async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND_API}${path}`);
  } catch (error) {
    throw normalizeError(error);
  }

  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { detail?: string };
      detail = typeof payload?.detail === "string" ? payload.detail : "";
    } catch {
      detail = "";
    }
    throw new Error(detail || `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export function normalizeAudioPreference(value?: string | null): AudioPreference {
  const normalized = (value || "hi").trim().toLowerCase();
  if (normalized === "en" || normalized === "original") return normalized;
  return "hi";
}

function dedupeByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function sortSourcesByAudioPreference(sources: StreamSource[], audio: AudioPreference): StreamSource[] {
  const order = audio === "hi" ? ["hi", "en", "original"] : audio === "en" ? ["en", "original", "hi"] : ["original", "en", "hi"];
  return [...sources].sort((left, right) => {
    const leftRank = order.indexOf((left.language || "original").toLowerCase());
    const rightRank = order.indexOf((right.language || "original").toLowerCase());
    return (leftRank === -1 ? order.length : leftRank) - (rightRank === -1 ? order.length : rightRank);
  });
}

export async function fetchConsumetHealth(): Promise<ConsumetHealth> {
  const health = await getCachedJson<ConsumetHealth>("consumet:health", "/consumet/health", 120_000, true);
  if (!health.healthy && /all connection attempts failed|consumet request failed/i.test(health.message || "")) {
    return {
      ...health,
      message: "Consumet is still warming up. GRABIX can already use its built-in anime fallbacks.",
    };
  }
  return health;
}

export async function fetchConsumetAnimeDiscover(
  section: "trending" | "popular" | "toprated" | "seasonal" | "movie",
  page = 1,
  period: "daily" | "weekly" | "monthly" = "daily"
): Promise<ConsumetMediaSummary[]> {
  const cacheKey = `consumet:discover:anime:${section}:${page}:${period}`;
  const data = await getCachedJson<{ items: ConsumetMediaSummary[] }>(
    cacheKey,
    `/consumet/discover/anime?section=${encodeURIComponent(section)}&page=${page}&period=${encodeURIComponent(period)}`,
    300_000,
    true
  );
  return data.items ?? [];
}

export async function fetchConsumetMangaDiscover(section: "trending" | "seasonal" | "hot", page = 1): Promise<ConsumetMediaSummary[]> {
  const data = await getCachedJson<{ items: ConsumetMediaSummary[] }>(
    `consumet:discover:manga:${section}:${page}`,
    `/consumet/discover/manga?section=${encodeURIComponent(section)}&page=${page}`,
    300_000,
    true
  );
  return data.items ?? [];
}

export async function searchConsumetDomain(domain: ConsumetDomain, query: string, provider: string, page = 1): Promise<ConsumetMediaSummary[]> {
  const data = await getCachedJson<{ items: ConsumetMediaSummary[] }>(
    `consumet:search:${domain}:${provider}:${page}:${query.trim().toLowerCase()}`,
    `/consumet/search/${domain}?query=${encodeURIComponent(query)}&provider=${encodeURIComponent(provider)}&page=${page}`,
    180_000,
    true
  );
  return data.items ?? [];
}

export async function fetchConsumetDomainInfo(domain: ConsumetDomain | "movie" | "tv", id: string, provider: string): Promise<ConsumetMediaDetail> {
  return await getCachedJson<ConsumetMediaDetail>(
    `consumet:info:${domain}:${provider}:${id}`,
    `/consumet/info/${domain}?id=${encodeURIComponent(id)}&provider=${encodeURIComponent(provider)}`,
    300_000
  );
}

export async function fetchConsumetAnimeEpisodes(id: string, provider: string): Promise<ConsumetEpisode[]> {
  const data = await getCachedJson<{ items: ConsumetEpisode[] }>(
    `consumet:episodes:${provider}:${id}`,
    `/consumet/episodes/anime?id=${encodeURIComponent(id)}&provider=${encodeURIComponent(provider)}`,
    300_000
  );
  return data.items ?? [];
}

export async function fetchConsumetMangaChapters(id: string, provider = "mangadex"): Promise<ConsumetChapter[]> {
  const data = await getCachedJson<{ items: ConsumetChapter[] }>(
    `consumet:manga:chapters:${provider}:${id}`,
    `/consumet/chapters/manga?id=${encodeURIComponent(id)}&provider=${encodeURIComponent(provider)}`,
    300_000
  );
  return data.items ?? [];
}

export async function fetchConsumetAnimeWatch(
  episodeId: string,
  provider: string,
  audio: AudioPreference,
  server?: string
): Promise<ConsumetWatchResult> {
  const params = new URLSearchParams({
    episode_id: episodeId,
    provider,
    audio,
  });
  if (server) params.set("server", server);

  const data = await getCachedJson<ConsumetWatchResult>(
    `consumet:watch:${provider}:${episodeId}:${audio}:${server || "auto"}`,
    `/consumet/watch/anime?${params.toString()}`,
    90_000
  );
  return {
    ...data,
    sources: sortSourcesByAudioPreference(data.sources ?? [], audio),
  };
}

export async function fetchConsumetMangaRead(chapterId: string, provider = "mangadex"): Promise<string[]> {
  const data = await getCachedJson<{ pages: string[] }>(
    `consumet:manga:read:${provider}:${chapterId}`,
    `/consumet/read/manga?chapter_id=${encodeURIComponent(chapterId)}&provider=${encodeURIComponent(provider)}`,
    600_000
  );
  return data.pages ?? [];
}

export async function fetchConsumetGenericRead(domain: Exclude<ConsumetDomain, "anime" | "manga">, id: string, provider: string): Promise<unknown> {
  const data = await getCachedJson<{ content: unknown }>(
    `consumet:read:${domain}:${provider}:${id}`,
    `/consumet/read/${domain}?id=${encodeURIComponent(id)}&provider=${encodeURIComponent(provider)}`,
    600_000,
    true
  );
  return data.content;
}

export async function fetchConsumetNews(topic?: string): Promise<ConsumetNewsItem[]> {
  const suffix = topic ? `?topic=${encodeURIComponent(topic)}` : "";
  const data = await getCachedJson<{ items: ConsumetNewsItem[] }>(
    `consumet:news:feed:${topic || "all"}`,
    `/consumet/news/feed${suffix}`,
    300_000,
    true
  );
  return data.items ?? [];
}

export async function fetchConsumetNewsArticle(id: string): Promise<ConsumetNewsArticle> {
  return await getCachedJson<ConsumetNewsArticle>(
    `consumet:news:article:${id}`,
    `/consumet/news/article?id=${encodeURIComponent(id)}`,
    600_000,
    true
  );
}

export async function fetchConsumetMetaSearch(query: string, type: "movie" | "tv"): Promise<ConsumetMediaSummary[]> {
  const data = await getCachedJson<{ items: ConsumetMediaSummary[] }>(
    `consumet:meta:search:${type}:${query.trim().toLowerCase()}`,
    `/consumet/meta/search?query=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}`,
    180_000,
    true
  );
  return data.items ?? [];
}

export async function fetchConsumetMetaInfo(id: string, type: "movie" | "tv"): Promise<{ id: string; type: string; item: ConsumetMediaSummary }> {
  return await getCachedJson<{ id: string; type: string; item: ConsumetMediaSummary }>(
    `consumet:meta:info:${type}:${id}`,
    `/consumet/meta/info?id=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}`,
    300_000,
    true
  );
}

export async function searchConsumetAnime(query: string, page = 1): Promise<ConsumetMediaSummary[]> {
  const [hianime, zoro, gogo] = await Promise.allSettled([
    searchConsumetDomain("anime", query, "hianime", page),
    searchConsumetDomain("anime", query, "zoro", page),
    searchConsumetDomain("anime", query, "gogoanime", page),
  ]);

  const combined = [
    ...(hianime.status === "fulfilled" ? hianime.value : []),
    ...(zoro.status === "fulfilled" ? zoro.value : []),
    ...(gogo.status === "fulfilled" ? gogo.value : []),
  ];

  if (!combined.length) {
    const reason = [hianime, zoro, gogo]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => normalizeError(result.reason).message)[0];
    if (reason) throw new Error(reason);
  }

  return dedupeByKey(combined, (item) => `${item.provider}:${item.id}`);
}

export async function searchConsumetManga(query: string): Promise<ConsumetMediaSummary[]> {
  return await searchConsumetDomain("manga", query, "mangadex");
}
