import { BACKEND_API, extractBackendErrorMessage } from "./api";
export { BACKEND_API } from "./api";
import { getCachedJson, getCachedValue, setCachedValue } from "./cache";

export type StreamKind = "embed" | "direct" | "hls" | "local";

export interface SubtitleTrack {
  id: string;
  label: string;
  language?: string;
  url: string;
  originalUrl?: string;
}

export interface StreamSource {
  id: string;
  label: string;
  provider: string;
  kind: StreamKind;
  url: string;
  requestHeaders?: Record<string, string>;
  language?: string;
  description?: string;
  quality?: string;
  mimeType?: string;
  fileName?: string;
  externalUrl?: string;
  canExtract?: boolean;
  subtitles?: SubtitleTrack[];
}

type ProviderIdType = "tmdb" | "imdb";

interface ProviderDef {
  id: string;
  label: string;
  provider: string;
  movie: string;
  tv: string;
  episode: string;
  movieIdType: ProviderIdType;
  tvIdType: ProviderIdType;
  canExtract: boolean;
}

interface MediaIds {
  tmdbId: number;
  imdbId?: string;
}

interface MovieBoxSourceResponse {
  label: string;
  provider: string;
  url: string;
  original_url?: string;
  quality?: string;
  server?: string;
  size_bytes?: number;
  size_label?: string;
  mime_type?: string;
  kind?: StreamKind;
  headers?: Record<string, string>;
  subtitles?: SubtitleTrack[];
}

export interface MovieBoxItem {
  id: string;
  title: string;
  description?: string;
  year?: number;
  poster?: string;
  poster_proxy?: string;
  media_type: "movie" | "series" | "anime";
  moviebox_media_type: "movie" | "series";
  country?: string;
  genres?: string[];
  imdb_rating?: number;
  imdb_rating_count?: number;
  detail_path?: string;
  corner?: string;
  has_resource?: boolean;
  subtitle_languages?: string[];
  is_hindi?: boolean;
  is_anime?: boolean;
  section?: string;
  duration_seconds?: number;
  available_seasons?: number[];
  season_episode_counts?: Record<number, number>;
}

export interface MovieBoxSection {
  id: string;
  title: string;
  subtitle?: string;
  items: MovieBoxItem[];
}

interface MovieBoxDiscoverResponse {
  sections: MovieBoxSection[];
  popular_searches: string[];
}

interface MovieBoxSearchResponse {
  query: string;
  page: number;
  per_page: number;
  media_type: "all" | "movie" | "series" | "anime";
  items: MovieBoxItem[];
}

interface MovieBoxDetailsResponse {
  provider: string;
  item: MovieBoxItem;
}

interface MovieBoxSourcesResponse {
  provider: string;
  media_type: "movie" | "series" | "anime";
  title: string;
  year?: number;
  season?: number | null;
  episode?: number | null;
  item?: MovieBoxItem;
  subtitles?: SubtitleTrack[];
  sources?: MovieBoxSourceResponse[];
}

export interface StreamVariant {
  label: string;
  url: string;
  bandwidth?: string;
}

const MOVIEBOX_CACHE_VERSION = "v2";
const PROVIDER_RESOLVE_CACHE_TTL_MS = 90_000;
const providerResolutionPending = new Map<string, Promise<StreamSource[]>>();
const playbackWarmPending = new Map<string, Promise<void>>();
const warmedOrigins = new Set<string>();
const PLAYBACK_CACHE_PREFIX = "grabix:playback:";
const EMBED_CACHE_TTL_MS = 1000 * 60 * 30;
const EXTRACT_CACHE_TTL_MS = 1000 * 60 * 20;
const VARIANT_CACHE_TTL_MS = 1000 * 60 * 10;

export interface ProviderSourceGroup {
  id: string;
  label: string;
  sources: StreamSource[];
}

interface PlaybackCacheRecord<T> {
  expiresAt: number;
  value: T;
}

interface ProviderResolutionAttempt {
  provider: string;
  operation: string;
  success: boolean;
  message: string;
  fallback_used: boolean;
  retryable: boolean;
}

interface ProviderResolutionError {
  code: string;
  message: string;
  retryable: boolean;
  provider: string;
  fallback_used: boolean;
  correlation_id: string;
  user_action: string;
}

interface ProviderResolutionResponse {
  correlation_id: string;
  primary_provider: string;
  fallback_used: boolean;
  sources: StreamSource[];
  attempts: ProviderResolutionAttempt[];
  error?: ProviderResolutionError | null;
}

export interface AnimePlaybackCandidate {
  provider: string;
  animeId: string;
  episodeId?: string;
  title?: string;
  altTitle?: string;
}

const EMBED_PROVIDERS: ProviderDef[] = [
  {
    id: "vidsrc-mov",
    label: "Server 1",
    provider: "VidSrc.mov",
    movie: "https://vidsrc.mov/embed/movie/{id}",
    tv: "https://vidsrc.mov/embed/tv/{id}/1/1",
    episode: "https://vidsrc.mov/embed/tv/{id}/{season}/{episode}",
    movieIdType: "tmdb",
    tvIdType: "tmdb",
    canExtract: true,
  },
  {
    id: "vidsrc-to",
    label: "Server 2",
    provider: "VidSrc.to",
    movie: "https://vidsrc.to/embed/movie/{id}",
    tv: "https://vidsrc.to/embed/tv/{id}/1/1",
    episode: "https://vidsrc.to/embed/tv/{id}/{season}/{episode}",
    movieIdType: "tmdb",
    tvIdType: "tmdb",
    canExtract: true,
  },
  {
    id: "vidsrc-me",
    label: "Server 3",
    provider: "VidSrc.me",
    movie: "https://vidsrc.me/embed/movie?imdb={id}",
    tv: "https://vidsrc.me/embed/tv?imdb={id}&season=1&episode=1",
    episode: "https://vidsrc.me/embed/tv?imdb={id}&season={season}&episode={episode}",
    movieIdType: "imdb",
    tvIdType: "imdb",
    canExtract: true,
  },
  {
    id: "2embed",
    label: "Server 4",
    provider: "2embed",
    movie: "https://www.2embed.cc/embed/{id}",
    tv: "https://www.2embed.cc/embedtv/{id}&s=1&e=1",
    episode: "https://www.2embed.cc/embedtv/{id}&s={season}&e={episode}",
    movieIdType: "imdb",
    tvIdType: "imdb",
    canExtract: true,
  },
  {
    id: "multiembed",
    label: "Server 5",
    provider: "Multiembed",
    movie: "https://multiembed.mov/?video_id={id}&tmdb=1",
    tv: "https://multiembed.mov/?video_id={id}&tmdb=1&s=1&e=1",
    episode: "https://multiembed.mov/?video_id={id}&tmdb=1&s={season}&e={episode}",
    movieIdType: "tmdb",
    tvIdType: "tmdb",
    canExtract: false,
  },
];

function makeSource(source: StreamSource): StreamSource {
  return source;
}

function sourceDedupKey(source: StreamSource): string {
  return [
    source.provider.trim().toLowerCase(),
    (source.externalUrl || source.url).trim().toLowerCase(),
    (source.language || "").trim().toLowerCase(),
  ].join("|");
}

export function readPlaybackCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${PLAYBACK_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlaybackCacheRecord<T>;
    if (!parsed?.expiresAt || Date.now() >= parsed.expiresAt) {
      window.sessionStorage.removeItem(`${PLAYBACK_CACHE_PREFIX}${key}`);
      return null;
    }
    return parsed.value ?? null;
  } catch {
    return null;
  }
}

export function writePlaybackCache<T>(key: string, value: T, ttlMs: number) {
  if (typeof window === "undefined") return;
  try {
    const payload: PlaybackCacheRecord<T> = {
      expiresAt: Date.now() + ttlMs,
      value,
    };
    window.sessionStorage.setItem(`${PLAYBACK_CACHE_PREFIX}${key}`, JSON.stringify(payload));
  } catch {
    // Ignore cache write failures.
  }
}

export function buildStreamProxyUrl(
  url: string,
  headers?: Record<string, string>,
  api = BACKEND_API
): string {
  if (!url) return url;
  if (url.startsWith(`${api}/stream/proxy?`)) return url;
  if (url.startsWith("/stream/proxy?")) return `${api}${url}`;

  const params = new URLSearchParams({ url });
  if (headers && Object.keys(headers).length > 0) {
    params.set("headers_json", JSON.stringify(headers));
  }
  return `${api}/stream/proxy?${params.toString()}`;
}

export function shouldKeepHlsProxied(source: StreamSource): boolean {
  return (
    Boolean(source.requestHeaders && Object.keys(source.requestHeaders).length > 0) ||
    source.url.includes("/stream/proxy?")
  );
}

function qualityScore(label: string): number {
  const normalized = String(label || "").trim().toLowerCase();
  const numeric = normalized.match(/(\d{3,4})p/);
  if (numeric) return Number(numeric[1]);
  if (normalized === "4k") return 2160;
  if (normalized === "2k") return 1440;
  return 0;
}

function pickBestVariant(
  variants: Array<{ label: string; url: string; bandwidth?: string }>
): { label: string; url: string; bandwidth?: string } | null {
  if (!variants.length) return null;
  return [...variants].sort((left, right) => {
    const qualityDiff = qualityScore(right.label) - qualityScore(left.label);
    if (qualityDiff !== 0) return qualityDiff;
    return Number(right.bandwidth || 0) - Number(left.bandwidth || 0);
  })[0];
}

export function preconnectPlaybackOrigin(url: string) {
  if (typeof document === "undefined" || !url) return;
  try {
    const origin = new URL(url, window.location.href).origin;
    if (!/^https?:/i.test(origin) || warmedOrigins.has(origin)) return;
    warmedOrigins.add(origin);

    const dnsPrefetch = document.createElement("link");
    dnsPrefetch.rel = "dns-prefetch";
    dnsPrefetch.href = origin;
    document.head.appendChild(dnsPrefetch);

    const preconnect = document.createElement("link");
    preconnect.rel = "preconnect";
    preconnect.href = origin;
    preconnect.crossOrigin = "anonymous";
    document.head.appendChild(preconnect);
  } catch {
    // Ignore invalid URLs and hosts that reject preconnect.
  }
}

export async function resolveEmbedUrl(url: string, api = BACKEND_API): Promise<string> {
  if (!url) return url;
  const cacheKey = `embed:${url}`;
  const cached = readPlaybackCache<string>(cacheKey);
  if (cached) {
    preconnectPlaybackOrigin(cached);
    return cached;
  }
  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12000);
    const response = await fetch(`${api}/resolve-embed?url=${encodeURIComponent(url)}`, {
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);
    if (!response.ok) return url;
    const payload = (await response.json()) as { url?: string };
    const resolved = payload.url || url;
    writePlaybackCache(cacheKey, resolved, EMBED_CACHE_TTL_MS);
    preconnectPlaybackOrigin(resolved);
    return resolved;
  } catch {
    return url;
  }
}

export async function extractDirectStreamUrl(
  targetUrl: string,
  api = BACKEND_API
): Promise<{ url: string; quality?: string; format?: string }> {
  const directCacheKey = `extract:${targetUrl}`;
  const directCached = readPlaybackCache<{ url: string; quality?: string; format?: string }>(directCacheKey);
  if (directCached?.url) {
    preconnectPlaybackOrigin(directCached.url);
    return directCached;
  }

  const resolvedUrl = await resolveEmbedUrl(targetUrl, api);
  const resolvedCacheKey = `extract:${resolvedUrl}`;
  const cached =
    readPlaybackCache<{ url: string; quality?: string; format?: string }>(resolvedCacheKey) ??
    readPlaybackCache<{ url: string; quality?: string; format?: string }>(directCacheKey);
  if (cached?.url) {
    preconnectPlaybackOrigin(cached.url);
    if (resolvedCacheKey !== directCacheKey) {
      writePlaybackCache(directCacheKey, cached, EXTRACT_CACHE_TTL_MS);
    }
    return cached;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 25000);
  const response = await fetch(`${api}/extract-stream?url=${encodeURIComponent(resolvedUrl)}`, {
    signal: controller.signal,
  });
  window.clearTimeout(timeoutId);
  if (!response.ok) {
    throw new Error(`Server returned ${response.status}`);
  }

  const data = (await response.json()) as {
    url?: string;
    quality?: string;
    format?: string;
  };

  if (!data.url) {
    throw new Error("No URL in response");
  }

  const payload = {
    url: data.url,
    quality: data.quality,
    format: data.format,
  };
  writePlaybackCache(directCacheKey, payload, EXTRACT_CACHE_TTL_MS);
  writePlaybackCache(resolvedCacheKey, payload, EXTRACT_CACHE_TTL_MS);
  preconnectPlaybackOrigin(payload.url);
  return payload;
}

export function canPrepareInternalSource(source: StreamSource): boolean {
  return source.kind === "embed" && (source.provider.toLowerCase().includes("moviebox") || Boolean(source.canExtract));
}

export function getPreparedStreamSource(
  source: StreamSource,
  options?: {
    labelPrefix?: string;
    notice?: string;
  }
): StreamSource | null {
  const sourceKey = source.externalUrl || source.url;
  const cached = readPlaybackCache<{ url: string; quality?: string; format?: string }>(`extract:${sourceKey}`);
  if (!cached?.url) return null;

  return makeSource({
    id: `prepared-cache-${source.id}`,
    label: options?.labelPrefix ? `${options.labelPrefix} Direct` : `${source.label} Direct`,
    provider: source.provider,
    kind: inferStreamKind(cached.url, cached.format),
    url: cached.url,
    quality: cached.quality ?? source.quality ?? "Auto",
    description:
      options?.notice || "Prepared internal stream for faster playback, subtitles, and downloads.",
    externalUrl: sourceKey,
    canExtract: false,
    subtitles: source.subtitles,
    language: source.language,
  });
}

function getPreferredHlsPlaybackUrl(source: StreamSource): string {
  const sourceKey = source.externalUrl || source.url;
  const cachedUrl = readPlaybackCache<string>(`variant:${sourceKey}`);
  if (cachedUrl) {
    preconnectPlaybackOrigin(cachedUrl);
    return cachedUrl;
  }
  const fallbackUrl = shouldKeepHlsProxied(source)
    ? buildStreamProxyUrl(source.url, source.requestHeaders)
    : source.url;
  preconnectPlaybackOrigin(fallbackUrl);
  return fallbackUrl;
}

export async function prewarmPlaybackSource(source: StreamSource): Promise<void> {
  const sourceKey = source.externalUrl || source.url;
  const warmKey = `${source.kind}:${sourceKey}`;
  const pending = playbackWarmPending.get(warmKey);
  if (pending) {
    await pending;
    return;
  }

  const request = (async () => {
    if (source.kind === "direct" || source.kind === "local") {
      preconnectPlaybackOrigin(source.url);
      return;
    }

    if (source.kind === "hls") {
      const fallbackUrl = getPreferredHlsPlaybackUrl(source);
      preconnectPlaybackOrigin(fallbackUrl);
      const cachedUrl = readPlaybackCache<string>(`variant:${sourceKey}`);
      if (cachedUrl) return;

      const variants = await fetchStreamVariants(sourceKey, source.requestHeaders);
      const best = pickBestVariant(variants);
      if (!best?.url || best.url === source.url) return;
      const nextUrl = shouldKeepHlsProxied(source)
        ? buildStreamProxyUrl(best.url, source.requestHeaders)
        : best.url;
      writePlaybackCache(`variant:${sourceKey}`, nextUrl, VARIANT_CACHE_TTL_MS);
      preconnectPlaybackOrigin(nextUrl);
      return;
    }

    const resolvedUrl = await resolveEmbedUrl(source.url);
    preconnectPlaybackOrigin(resolvedUrl);
    if (canPrepareInternalSource(source)) {
      const extracted = await extractDirectStreamUrl(sourceKey);
      preconnectPlaybackOrigin(extracted.url);
    }
  })().finally(() => {
    playbackWarmPending.delete(warmKey);
  });

  playbackWarmPending.set(warmKey, request);
  await request;
}

export async function prewarmPlaybackSources(
  sources: StreamSource[],
  limit = 2
): Promise<void> {
  const candidates = sources.filter((source) => Boolean(source?.url)).slice(0, Math.max(limit, 0));
  if (candidates.length === 0) return;
  await Promise.allSettled(candidates.map((source) => prewarmPlaybackSource(source)));
}

export function mergeProviderSourceGroups(groups: ProviderSourceGroup[]): StreamSource[] {
  const merged: StreamSource[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const source of group.sources) {
      const key = sourceDedupKey(source);
      if (!source.url || seen.has(key)) continue;
      seen.add(key);
      merged.push({
        ...source,
        description: source.description || `${group.label} source`,
      });
    }
  }

  return merged;
}

async function readProviderResolutionError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: ProviderResolutionError; detail?: unknown };
    const message =
      payload.error?.message ||
      extractBackendErrorMessage(payload, "") ||
      `Request failed with ${response.status}`;
    const action = payload.error?.user_action ? ` ${payload.error.user_action}` : "";
    return `${message}${action}`.trim();
  } catch {
    return `Request failed with ${response.status}`;
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function resolveProviderPlayback(
  path: string,
  payload: Record<string, unknown>
): Promise<StreamSource[]> {
  const cacheKey = `provider:resolve:${path}:${stableSerialize(payload)}`;
  const cached =
    getCachedValue<StreamSource[]>(cacheKey, "memory") ??
    getCachedValue<StreamSource[]>(cacheKey, "session");
  if (cached) {
    return cached;
  }

  const pending = providerResolutionPending.get(cacheKey);
  if (pending) {
    return await pending;
  }

  const request = fetch(`${BACKEND_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(await readProviderResolutionError(response));
      }

      const data = (await response.json()) as ProviderResolutionResponse;
      const sources = data.sources ?? [];
      setCachedValue(cacheKey, sources, PROVIDER_RESOLVE_CACHE_TTL_MS, "memory");
      setCachedValue(cacheKey, sources, PROVIDER_RESOLVE_CACHE_TTL_MS, "session");
      return sources;
    })
    .finally(() => {
      providerResolutionPending.delete(cacheKey);
    });

  providerResolutionPending.set(cacheKey, request);
  return await request;
}

function mapMovieBoxSource(
  mediaType: "movie" | "series" | "anime",
  source: MovieBoxSourceResponse,
  index: number
): StreamSource {
  return makeSource({
    id: `moviebox-${mediaType}-${Date.now()}-${index}`,
    label: source.label,
    provider: source.provider,
    kind: source.kind ?? inferStreamKind(source.url, source.mime_type),
    url: source.url,
    description: `${source.provider} direct source`,
    quality: source.quality ?? "Auto",
    mimeType: source.mime_type,
    externalUrl: source.original_url ?? source.url,
    language: source.server,
    fileName: source.size_label,
    canExtract: false,
    subtitles: source.subtitles ?? [],
  });
}

function normalizeMediaIds(tmdbIdOrIds: number | MediaIds, imdbId?: string): MediaIds {
  return typeof tmdbIdOrIds === "number"
    ? { tmdbId: tmdbIdOrIds, imdbId }
    : tmdbIdOrIds;
}

function resolveProviderId(idType: ProviderIdType, ids: MediaIds): string | null {
  if (idType === "imdb") {
    return ids.imdbId?.trim() || null;
  }
  return String(ids.tmdbId);
}

function buildUrl(template: string, id: string, season?: number, episode?: number): string {
  return template
    .replace("{id}", id)
    .replace("{season}", String(season ?? 1))
    .replace("{episode}", String(episode ?? 1));
}

function buildProviderSources(kind: "movie" | "tv", ids: MediaIds, season?: number, episode?: number): StreamSource[] {
  const episodeTag = season !== undefined && episode !== undefined ? `-s${season}e${episode}` : "";

  return EMBED_PROVIDERS.flatMap((provider) => {
    const providerId = resolveProviderId(
      kind === "movie" ? provider.movieIdType : provider.tvIdType,
      ids
    );

    if (!providerId) {
      return [];
    }

    let url: string;
    if (kind === "movie") {
      url = buildUrl(provider.movie, providerId);
    } else if (season !== undefined && episode !== undefined) {
      url = buildUrl(provider.episode, providerId, season, episode);
    } else {
      url = buildUrl(provider.tv, providerId);
    }

    return [
      makeSource({
        id: `${provider.id}-${kind}-${ids.tmdbId}${episodeTag}`,
        label: provider.label,
        provider: provider.provider,
        kind: "embed",
        url,
        description: `${provider.provider} ${kind === "movie" ? "movie" : "series"} stream`,
        quality: "Auto",
        externalUrl: url,
        canExtract: provider.canExtract,
      }),
    ];
  });
}

export function inferStreamKind(url: string, mimeType?: string): StreamKind {
  const normalizedUrl = url.toLowerCase();
  const normalizedMime = mimeType?.toLowerCase() ?? "";

  if (normalizedMime.includes("mpegurl") || normalizedUrl.includes(".m3u8")) return "hls";

  if (
    normalizedMime.startsWith("video/") ||
    normalizedUrl.endsWith(".mp4") ||
    normalizedUrl.endsWith(".webm") ||
    normalizedUrl.endsWith(".mov") ||
    normalizedUrl.endsWith(".mkv") ||
    normalizedUrl.endsWith(".ogv")
  ) {
    return "direct";
  }

  return "embed";
}

export function createCustomSource(url: string, provider = "Custom", label = "Custom"): StreamSource {
  return makeSource({
    id: `custom-${Date.now()}`,
    label,
    provider,
    kind: inferStreamKind(url),
    url,
    description: "User-provided source",
    quality: "Auto",
    externalUrl: url,
    canExtract: false,
  });
}

export function createLocalFileSource(file: File): StreamSource {
  const objectUrl = URL.createObjectURL(file);
  const inferredKind = inferStreamKind(file.name, file.type);

  return makeSource({
    id: `local-${Date.now()}-${file.name}`,
    label: "Local File",
    provider: "Device",
    kind: inferredKind === "embed" ? "direct" : inferredKind,
    url: objectUrl,
    mimeType: file.type || undefined,
    fileName: file.name,
    description: "Local file playback",
    quality: "Source",
    canExtract: false,
  });
}

export function getMovieSources(tmdbIdOrIds: number | MediaIds, imdbId?: string): StreamSource[] {
  return buildProviderSources("movie", normalizeMediaIds(tmdbIdOrIds, imdbId));
}

export function getTvSources(
  tmdbIdOrIds: number | MediaIds,
  options?: { imdbId?: string; season?: number; episode?: number }
): StreamSource[] {
  const ids = normalizeMediaIds(tmdbIdOrIds, options?.imdbId);
  return buildProviderSources("tv", ids, options?.season, options?.episode);
}

export function getTvEpisodeSources(
  tmdbIdOrIds: number | MediaIds,
  season: number,
  episode: number,
  imdbId?: string
): StreamSource[] {
  return buildProviderSources("tv", normalizeMediaIds(tmdbIdOrIds, imdbId), season, episode);
}

export function getAnimeSources(tmdbId: number | null, trailerUrl?: string): StreamSource[] {
  const sources: StreamSource[] = [];

  if (tmdbId) {
    sources.push(...buildProviderSources("tv", { tmdbId }));
  }

  if (trailerUrl) {
    sources.push(
      makeSource({
        id: "trailer-fallback",
        label: "Trailer",
        provider: "Fallback",
        kind: "embed",
        url: trailerUrl,
        description: "Trailer fallback when the main stream is unavailable",
        quality: "Preview",
        externalUrl: trailerUrl,
        canExtract: false,
      })
    );
  }

  return sources;
}

export function getAnimeEpisodeSources(
  tmdbId: number | null,
  season: number,
  episode: number,
  trailerUrl?: string
): StreamSource[] {
  const sources: StreamSource[] = [];

  if (tmdbId) {
    sources.push(...buildProviderSources("tv", { tmdbId }, season, episode));
  }

  if (trailerUrl) {
    sources.push(
      makeSource({
        id: "trailer-fallback",
        label: "Trailer",
        provider: "Fallback",
        kind: "embed",
        url: trailerUrl,
        description: "Trailer fallback when the main stream is unavailable",
        quality: "Preview",
        externalUrl: trailerUrl,
        canExtract: false,
      })
    );
  }

  return sources;
}

export async function resolveMoviePlaybackSources(options: {
  tmdbId: number;
  imdbId?: string;
  title: string;
  altTitles?: string[];
  year?: number;
}): Promise<StreamSource[]> {
  return await resolveProviderPlayback("/providers/resolve/movie", {
    tmdb_id: options.tmdbId,
    imdb_id: options.imdbId || null,
    title: options.title,
    alt_titles: options.altTitles ?? [],
    year: options.year ?? null,
  });
}

export async function resolveTvPlaybackSources(options: {
  tmdbId: number;
  imdbId?: string;
  title: string;
  altTitles?: string[];
  year?: number;
  season: number;
  episode: number;
}): Promise<StreamSource[]> {
  return await resolveProviderPlayback("/providers/resolve/tv", {
    tmdb_id: options.tmdbId,
    imdb_id: options.imdbId || null,
    title: options.title,
    alt_titles: options.altTitles ?? [],
    year: options.year ?? null,
    season: options.season,
    episode: options.episode,
  });
}

export async function resolveAnimePlaybackSources(options: {
  title: string;
  altTitle?: string;
  altTitles?: string[];
  tmdbId?: number | null;
  fallbackSeason?: number;
  fallbackEpisode?: number;
  episodeNumber: number;
  audio: string;
  server: string;
  isMovie?: boolean;
  purpose?: "play" | "download";
  candidates?: AnimePlaybackCandidate[];
}): Promise<StreamSource[]> {
  return await resolveProviderPlayback("/providers/resolve/anime", {
    title: options.title,
    alt_title: options.altTitle || "",
    alt_titles: options.altTitles ?? [],
    tmdb_id: options.tmdbId ?? null,
    fallback_season: options.fallbackSeason ?? 1,
    fallback_episode: options.fallbackEpisode ?? options.episodeNumber,
    episode_number: options.episodeNumber,
    audio: options.audio,
    server: options.server,
    is_movie: Boolean(options.isMovie),
    purpose: options.purpose ?? "play",
    candidates: (options.candidates ?? []).map((candidate) => ({
      provider: candidate.provider,
      anime_id: candidate.animeId,
      episode_id: candidate.episodeId,
      title: candidate.title,
      alt_title: candidate.altTitle,
    })),
  });
}

export function getArchiveMovieSources(identifier: string): StreamSource[] {
  return [
    makeSource({
      id: `archive-${identifier}`,
      label: "Archive",
      provider: "Archive.org",
      kind: "embed",
      url: `https://archive.org/embed/${identifier}`,
      description: "Public-domain archive stream",
      quality: "Source",
      externalUrl: `https://archive.org/details/${identifier}`,
      canExtract: false,
    }),
  ];
}

export async function fetchMovieBoxDiscover(): Promise<MovieBoxDiscoverResponse> {
  return await getCachedJson<MovieBoxDiscoverResponse>({
    key: `${MOVIEBOX_CACHE_VERSION}:moviebox:discover`,
    url: `${BACKEND_API}/moviebox/discover`,
    ttlMs: 180_000,
    scope: "local",
  });
}

export async function searchMovieBox(options: {
  query: string;
  page?: number;
  perPage?: number;
  mediaType?: "all" | "movie" | "series" | "anime";
  hindiOnly?: boolean;
  animeOnly?: boolean;
  preferHindi?: boolean;
  sortBy?: "search" | "recent" | "rating";
}): Promise<MovieBoxSearchResponse> {
  const params = new URLSearchParams({
    query: options.query,
    page: String(options.page ?? 1),
    per_page: String(options.perPage ?? 24),
    media_type: options.mediaType ?? "all",
    hindi_only: String(Boolean(options.hindiOnly)),
    anime_only: String(Boolean(options.animeOnly)),
    prefer_hindi: String(options.preferHindi ?? true),
    sort_by: options.sortBy ?? "search",
  });

  return await getCachedJson<MovieBoxSearchResponse>({
    key: `${MOVIEBOX_CACHE_VERSION}:moviebox:search:${params.toString()}`,
    url: `${BACKEND_API}/moviebox/search-items?${params.toString()}`,
    ttlMs: 120_000,
    scope: "local",
  });
}

export async function fetchMovieBoxDetails(options: {
  subjectId?: string;
  title?: string;
  mediaType: "movie" | "series" | "anime";
  year?: number;
}): Promise<MovieBoxItem> {
  const params = new URLSearchParams({
    media_type: options.mediaType,
  });

  if (options.subjectId) params.set("subject_id", options.subjectId);
  if (options.title) params.set("title", options.title);
  if (options.year) params.set("year", String(options.year));

  const data = await getCachedJson<MovieBoxDetailsResponse>({
    key: `${MOVIEBOX_CACHE_VERSION}:moviebox:details:${params.toString()}`,
    url: `${BACKEND_API}/moviebox/details?${params.toString()}`,
    ttlMs: 300_000,
    scope: "local",
  });
  return data.item;
}

export async function fetchMovieBoxSources(options: {
  subjectId?: string;
  title?: string;
  mediaType: "movie" | "series" | "anime";
  year?: number;
  season?: number;
  episode?: number;
}): Promise<StreamSource[]> {
  const params = new URLSearchParams({
    media_type: options.mediaType,
  });

  if (options.subjectId) params.set("subject_id", options.subjectId);
  if (options.title) params.set("title", options.title);
  if (options.year) params.set("year", String(options.year));
  if (options.mediaType !== "movie") {
    params.set("season", String(options.season ?? 1));
    params.set("episode", String(options.episode ?? 1));
  }

  const data = await getCachedJson<MovieBoxSourcesResponse>({
    key: `${MOVIEBOX_CACHE_VERSION}:moviebox:sources:${params.toString()}`,
    url: `${BACKEND_API}/moviebox/sources?${params.toString()}`,
    ttlMs: 90_000,
    scope: "session",
  });
  return (data.sources ?? []).map((source, index) => mapMovieBoxSource(options.mediaType, source, index));
}

export async function fetchStreamVariants(url: string, headers?: Record<string, string>): Promise<StreamVariant[]> {
  const params = new URLSearchParams({ url });
  if (headers && Object.keys(headers).length > 0) {
    params.set("headers_json", JSON.stringify(headers));
  }
  const data = await getCachedJson<{ variants?: StreamVariant[] }>({
    key: `stream:variants:${params.toString()}`,
    url: `${BACKEND_API}/stream/variants?${params.toString()}`,
    ttlMs: 120_000,
    scope: "session",
  });
  return data.variants ?? [];
}
