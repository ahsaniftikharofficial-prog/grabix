export type StreamKind = "embed" | "direct" | "hls" | "local";

export interface StreamSource {
  id: string;
  label: string;
  provider: string;
  kind: StreamKind;
  url: string;
  description?: string;
  quality?: string;
  mimeType?: string;
  fileName?: string;
  externalUrl?: string;
}

function makeSource(source: StreamSource): StreamSource {
  return source;
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
  });
}

export function createLocalFileSource(file: File): StreamSource {
  const objectUrl = URL.createObjectURL(file);
  return makeSource({
    id: `local-${Date.now()}-${file.name}`,
    label: "Local File",
    provider: "Device",
    kind: inferStreamKind(file.name, file.type) === "embed" ? "direct" : inferStreamKind(file.name, file.type),
    url: objectUrl,
    mimeType: file.type || undefined,
    fileName: file.name,
    description: "Local file playback",
    quality: "Source",
  });
}

export function getMovieSources(tmdbId: number): StreamSource[] {
  return [
    makeSource({
      id: `vsembed-movie-${tmdbId}`,
      label: "Server 1",
      provider: "VSEmbed",
      kind: "embed",
      url: `https://vsembed.ru/embed/movie/${tmdbId}/`,
      description: "Direct embed route used by VidSrc",
      quality: "Auto",
      externalUrl: `https://vsembed.ru/embed/movie/${tmdbId}/`,
    }),
    makeSource({
      id: `vidsrc-movie-${tmdbId}`,
      label: "Server 2",
      provider: "VIDSRC",
      kind: "embed",
      url: `https://vidsrc.to/embed/movie/${tmdbId}`,
      description: "VidSrc wrapper source",
      quality: "Auto",
      externalUrl: `https://vidsrc.to/embed/movie/${tmdbId}`,
    }),
  ];
}

export function getAnimeSources(tmdbId: number | null, trailerUrl?: string): StreamSource[] {
  const sources: StreamSource[] = [];

  if (tmdbId) {
    sources.push(
      makeSource({
        id: `vsembed-anime-${tmdbId}`,
        label: "Server 1",
        provider: "VSEmbed",
        kind: "embed",
        url: `https://vsembed.ru/embed/tv/${tmdbId}/`,
        description: "Direct embed route used by VidSrc",
        quality: "Auto",
        externalUrl: `https://vsembed.ru/embed/tv/${tmdbId}/`,
      }),
      makeSource({
        id: `vidsrc-anime-${tmdbId}`,
        label: "Server 2",
        provider: "VIDSRC",
        kind: "embed",
        url: `https://vidsrc.to/embed/tv/${tmdbId}`,
        description: "VidSrc wrapper source",
        quality: "Auto",
        externalUrl: `https://vidsrc.to/embed/tv/${tmdbId}`,
      })
    );
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
      })
    );
  }

  return sources;
}

export function getTvSources(tmdbId: number): StreamSource[] {
  return [
    makeSource({
      id: `vsembed-tv-${tmdbId}`,
      label: "Server 1",
      provider: "VSEmbed",
      kind: "embed",
      url: `https://vsembed.ru/embed/tv/${tmdbId}/`,
      description: "Direct TV embed route used by VidSrc",
      quality: "Auto",
      externalUrl: `https://vsembed.ru/embed/tv/${tmdbId}/`,
    }),
    makeSource({
      id: `vidsrc-tv-${tmdbId}`,
      label: "Server 2",
      provider: "VIDSRC",
      kind: "embed",
      url: `https://vidsrc.to/embed/tv/${tmdbId}`,
      description: "VidSrc TV wrapper source",
      quality: "Auto",
      externalUrl: `https://vidsrc.to/embed/tv/${tmdbId}`,
    }),
  ];
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
    }),
  ];
}
