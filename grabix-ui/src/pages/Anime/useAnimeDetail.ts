// anime/useAnimeDetail.ts — all state, effects, and handlers for the AnimeDetail panel

import { useEffect, useMemo, useRef, useState } from "react";
import { useFavorites } from "../../context/FavoritesContext";
import {
  fetchConsumetAnimeEpisodes,
  fetchConsumetDomainInfo,
  normalizeAudioPreference,
  searchConsumetAnime,
  type AudioPreference,
  type ConsumetEpisode,
  type ConsumetMediaSummary,
} from "../../lib/consumetProviders";
import { queueSubtitleDownload, queueVideoDownload, resolveSourceDownloadOptions } from "../../lib/downloads";
import { fetchMovieBoxSources, resolveAnimePlaybackSources, searchMovieBox, type StreamSource } from "../../lib/streamProviders";
import {
  checkHindiAvailability,
  dedupeItems,
  expandAnimeTitles,
  fetchJikanEpisodeCount,
  fetchJikanTrailerUrl,
  findTmdbId,
  resolveTmdbEpisodeNumber,
  searchAnimeFallbackCandidates,
  toCardItem,
} from "./animeUtils";
import type { AnimeAudioOption, AnimeCardItem, AnimeServerOption, Tab } from "./animeTypes";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlayerPayload = {
  title: string;
  subtitle?: string;
  subtitleSearchTitle?: string;
  poster?: string;
  sources: StreamSource[];
  mediaType?: "movie" | "tv";
  currentEpisode?: number;
  episodeOptions?: number[];
  episodeLabel?: string;
  sourceOptions?: Array<{ id: string; label: string }>;
  onSelectSourceOption?: (optionId: string, episode?: number) => Promise<{ sources: StreamSource[]; subtitle?: string; subtitleSearchTitle?: string }>;
  onSelectEpisode?: (episode: number) => Promise<{ sources: StreamSource[]; subtitle?: string; subtitleSearchTitle?: string }>;
};

interface UseAnimeDetailProps {
  anime: AnimeCardItem;
  onPlay: (payload: PlayerPayload) => void;
  consumetHealthy: boolean;
  consumetBaseUrl: string;
  activeTab: Tab;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAnimeDetail({ anime, onPlay, consumetHealthy, consumetBaseUrl, activeTab }: UseAnimeDetailProps) {
  const [finding, setFinding] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [tmdbId, setTmdbId] = useState<number | null>(null);
  const [candidateAnimes, setCandidateAnimes] = useState<AnimeCardItem[]>([anime]);
  const [resolvedAnime, setResolvedAnime] = useState<AnimeCardItem | null>(anime);
  const [episodes, setEpisodes] = useState<ConsumetEpisode[]>([]);
  const [episode, setEpisode] = useState(1);
  const [dubEpisodeCount, setDubEpisodeCount] = useState<number | null>(
    anime.provider === "hianime" && typeof anime.dub_episode_count === "number"
      ? anime.dub_episode_count
      : null
  );
  const hasDub = dubEpisodeCount === null ? false : (dubEpisodeCount === 0 ? false : episode <= dubEpisodeCount);
  const [audio, setAudio] = useState<AudioPreference>("original");
  const [server, setServer] = useState<AnimeServerOption>("auto");
  const [detailHint, setDetailHint] = useState("");
  const [knownEpisodeCount, setKnownEpisodeCount] = useState<number | null>(anime.episodes_count ?? null);
  const [hasHindiFallback, setHasHindiFallback] = useState(false);
  const [trailerUrl, setTrailerUrl] = useState(anime.trailer_url || "");
  const [downloading, setDownloading] = useState(false);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: "success" | "error" | "info" } | null>(null);
  const [downloadLanguage, setDownloadLanguage] = useState<"sub" | "dub" | "hindi">("dub");
  const [downloadServer, setDownloadServer] = useState<AnimeServerOption>("hd-1");
  const [downloadQuality, setDownloadQuality] = useState("source");
  const [downloadQualityOptions, setDownloadQualityOptions] = useState<Array<{ id: string; label: string; url: string; headers?: Record<string, string>; forceHls?: boolean }>>([]);
  const [downloadSubtitleTracks, setDownloadSubtitleTracks] = useState<Array<{ label: string; url: string; headers?: Record<string, string> }>>([]);
  const [downloadIncludeSubtitle, setDownloadIncludeSubtitle] = useState(false);
  const [downloadDialogLoading, setDownloadDialogLoading] = useState(false);
  const [downloadDialogError, setDownloadDialogError] = useState("");

  const resolvedSourceCacheRef = useRef<Record<string, StreamSource>>({});
  const resolvedPlayableSourcesCacheRef = useRef<Record<string, StreamSource[]>>({});
  const episodeCacheRef = useRef<Record<string, ConsumetEpisode[]>>({});
  const episodeRequestCacheRef = useRef<Record<string, Promise<ConsumetEpisode[]>>>({});
  const resolvedSourcePromiseCacheRef = useRef<Record<string, Promise<StreamSource | null>>>({});
  const resolvedPlayableSourcesPromiseCacheRef = useRef<Record<string, Promise<StreamSource[]>>>({});

  const { isFav, toggle } = useFavorites();

  // ── Derived values ────────────────────────────────────────────────────────

  const title = anime.title;
  const rawType = String((anime.raw as { type?: string } | undefined)?.type || "").toLowerCase();
  const isMovie = activeTab === "movie" || rawType === "movie";
  const selectionLabel = isMovie ? "Part" : "Episode";
  const fav = isFav(`anime-${anime.mal_id ?? `${anime.provider}-${anime.id}`}`);

  const fallbackEpisodeCount = Math.max(knownEpisodeCount ?? anime.episodes_count ?? 12, 1);
  const totalEpisodes = Math.max(episodes.length || fallbackEpisodeCount, 1);
  const episodeGroups = Math.ceil(totalEpisodes / 50);
  const selectedGroup = Math.floor((episode - 1) / 50);
  const episodeStart = selectedGroup * 50 + 1;
  const episodeEnd = Math.min(totalEpisodes, episodeStart + 49);
  const visibleEpisodes = useMemo(
    () => Array.from({ length: Math.max(0, episodeEnd - episodeStart + 1) }, (_, index) => episodeStart + index),
    [episodeStart, episodeEnd]
  );
  const hasTrailer = Boolean(trailerUrl);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!hasDub && audio === "en") setAudio("original");
  }, [hasDub]);

  useEffect(() => {
    let cancelled = false;
    setFinding(true);
    setEpisodes([]);
    setEpisode(1);
    setDubEpisodeCount(
      anime.provider === "hianime" && typeof anime.dub_episode_count === "number"
        ? anime.dub_episode_count
        : null
    );
    setAudio("original");
    setServer("auto");
    setDetailHint(
      consumetHealthy
        ? `Preparing playback via ${String(anime.provider || "anime").toUpperCase()}...`
        : "Preparing playback with GRABIX fallback providers..."
    );
    setResolvedAnime(anime);
    setCandidateAnimes([anime]);
    setKnownEpisodeCount(anime.episodes_count ?? null);
    episodeCacheRef.current = {};
    setHasHindiFallback(false);
    setTrailerUrl(anime.trailer_url || "");
    resolvedSourceCacheRef.current = {};
    resolvedPlayableSourcesCacheRef.current = {};
    episodeRequestCacheRef.current = {};
    resolvedSourcePromiseCacheRef.current = {};
    resolvedPlayableSourcesPromiseCacheRef.current = {};
    setFinding(false);

    // Fast sub/dub detection via local sidecar (HiAnime only)
    if (anime.provider === "hianime" && anime.id) {
      fetch(`${consumetBaseUrl}/anime/hianime/info?id=${encodeURIComponent(anime.id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((info: { subEpisodeCount?: number; dubEpisodeCount?: number; episodes?: ConsumetEpisode[] } | null) => {
          if (!info || cancelled) return;
          const dubCount = info.dubEpisodeCount ?? 0;
          setDubEpisodeCount(dubCount);
          if (Array.isArray(info.episodes) && info.episodes.length > 0) {
            episodeCacheRef.current = {
              ...episodeCacheRef.current,
              [`hianime-${anime.id}`]: info.episodes,
            };
            setEpisodes(info.episodes);
            setKnownEpisodeCount(info.episodes.length);
          }
        })
        .catch(() => {/* silent — slower path below still runs as backup */});
    }

    Promise.allSettled([
      findTmdbId(anime.title, anime.alt_title),
      anime.provider !== "hianime" && consumetHealthy
        ? searchConsumetAnime(anime.title)
        : Promise.resolve([] as ConsumetMediaSummary[]),
      searchAnimeFallbackCandidates(anime.title, anime.alt_title),
      fetchJikanEpisodeCount(anime.mal_id),
    ]).then(async ([tmdbResult, searchResult, fallbackSearchResult, jikanResult]) => {
      if (cancelled) return;

      setTmdbId(tmdbResult.status === "fulfilled" ? tmdbResult.value : null);
      if (jikanResult.status === "fulfilled" && jikanResult.value) {
        setKnownEpisodeCount(jikanResult.value);
      }

      const fallbackCandidates = fallbackSearchResult.status === "fulfilled" ? fallbackSearchResult.value : [];
      const nextCandidates = anime.provider !== "hianime"
        ? dedupeItems([anime, ...(searchResult.status === "fulfilled" ? searchResult.value.map(toCardItem) : []), ...fallbackCandidates])
        : dedupeItems([anime, ...fallbackCandidates]);
      setCandidateAnimes(nextCandidates);

      if (anime.provider === "hianime" && typeof anime.dub_episode_count === "number") {
        setDubEpisodeCount(anime.dub_episode_count);
      }

      const titleCandidates = expandAnimeTitles(anime.title, anime.alt_title).slice(0, 4);
      void checkHindiAvailability(titleCandidates).then((available) => {
        if (!cancelled) setHasHindiFallback(available);
      });

      setResolvedAnime(nextCandidates[0] ?? anime);
      if (!consumetHealthy) {
        setDetailHint("HiAnime is degraded. GRABIX will try AnimeKai, KickAssAnime, and AnimePahe.");
      } else if (nextCandidates.length > 0) {
        setDetailHint(`Ready to play. Using ${nextCandidates[0].provider.toUpperCase()} first.`);
      } else {
        setDetailHint("Ready to play with anime fallback providers.");
      }

      void (async () => {
        for (const candidate of nextCandidates) {
          try {
            const detail = await fetchConsumetDomainInfo("anime", candidate.id, candidate.provider);
            const nextEpisodes = detail.item.episodes ?? await fetchConsumetAnimeEpisodes(candidate.id, candidate.provider);
            if (cancelled) return;
            episodeCacheRef.current = {
              ...episodeCacheRef.current,
              [`${candidate.provider}-${candidate.id}`]: nextEpisodes,
            };
            if (nextEpisodes.length > 0) {
              setResolvedAnime({ ...candidate, ...detail.item, provider: candidate.provider, id: candidate.id });
              const detailDubCount = typeof detail.item.dub_episode_count === "number"
                ? detail.item.dub_episode_count
                : (detail.item.languages ?? []).some((l: string) => l === "en" || l === "dub") ? Infinity : 0;
              setDubEpisodeCount(detailDubCount);
              setEpisodes(nextEpisodes);
              setKnownEpisodeCount((current) => Math.max(current ?? 0, nextEpisodes.length));
              setDetailHint(`Episode sources available via ${candidate.provider.toUpperCase()}`);
              return;
            }
          } catch {
            continue;
          }
        }
        if (!cancelled) {
          setDetailHint(
            consumetHealthy
              ? "Episode metadata is limited right now. GRABIX will keep using fallback playback providers."
              : "Episode metadata is limited, but GRABIX fallback playback is still available."
          );
        }
      })();
    }).catch(() => {
      if (!cancelled) {
        setFinding(false);
        setDetailHint("Playback information could not be resolved right now.");
      }
    });

    return () => { cancelled = true; };
  }, [anime.id, anime.provider, anime.title, anime.alt_title, consumetHealthy, consumetBaseUrl]);

  useEffect(() => {
    let cancelled = false;
    if (anime.trailer_url) {
      setTrailerUrl(anime.trailer_url);
      return () => { cancelled = true; };
    }
    void fetchJikanTrailerUrl(anime.mal_id, anime.title).then((url) => {
      if (!cancelled && url) setTrailerUrl(url);
    });
    return () => { cancelled = true; };
  }, [anime.mal_id, anime.title, anime.trailer_url]);

  useEffect(() => {
    if (!downloadDialogOpen) return;
    void loadDownloadOptions(downloadLanguage, downloadServer);
  }, [downloadDialogOpen, downloadLanguage, downloadServer, episode]);

  useEffect(() => {
    const normalizedAudio = normalizeAudioPreference(audio);
    if (normalizedAudio === "hi") return;
    const warm = async () => {
      try {
        await resolvePlayableSources(episode, { audio: normalizedAudio, server });
      } catch { /* silent warm */ }
    };
    void warm();
  }, [audio, server, episode, totalEpisodes, resolvedAnime, candidateAnimes]);

  // ── Source resolution helpers ─────────────────────────────────────────────

  const getWatchCandidates = () => (
    resolvedAnime
      ? [resolvedAnime, ...candidateAnimes.filter((item) => `${item.provider}-${item.id}` !== `${resolvedAnime.provider}-${resolvedAnime.id}`)]
      : candidateAnimes
  );

  const getCachedEpisodesForCandidate = (candidate: AnimeCardItem): ConsumetEpisode[] => {
    const cacheKey = `${candidate.provider}-${candidate.id}`;
    const cachedEpisodes = episodeCacheRef.current[cacheKey];
    if (Array.isArray(cachedEpisodes) && cachedEpisodes.length > 0) return cachedEpisodes;
    if (resolvedAnime && `${resolvedAnime.provider}-${resolvedAnime.id}` === cacheKey && episodes.length > 0) return episodes;
    return [];
  };

  const getCandidateEpisodeId = (candidate: AnimeCardItem, targetEpisode = episode): string | undefined => {
    const cachedEpisodes = getCachedEpisodesForCandidate(candidate);
    const exactEpisode = cachedEpisodes.find((item) => Number(item.number) === Number(targetEpisode));
    const fallbackEpisode = exactEpisode ?? cachedEpisodes[0];
    const episodeId = String(fallbackEpisode?.id || "").trim();
    return episodeId || undefined;
  };

  const resolveAnimeSourceViaBackend = async (
    targetEpisode = episode,
    purpose: "play" | "download" = "play",
    overrides?: { audio?: AudioPreference; server?: AnimeServerOption }
  ): Promise<StreamSource | null> => {
    const rawNormalizedAudio = normalizeAudioPreference(overrides?.audio ?? audio);
    const animeLanguages: string[] = anime.languages ?? [];
    const normalizedAudio = (rawNormalizedAudio === "hi" && !animeLanguages.includes("hi"))
      ? "sub"
      : rawNormalizedAudio;
    if (normalizedAudio === "hi") return null;
    const requestedServer = overrides?.server ?? server;
    const cacheKey = `${purpose}:${normalizedAudio}:${requestedServer}:${targetEpisode}`;
    const cached = resolvedSourceCacheRef.current[cacheKey];
    if (cached) return cached;
    const pending = resolvedSourcePromiseCacheRef.current[cacheKey];
    if (pending) return pending;

    const request = (async () => {
      let lastMessage = "";
      try {
        const sources = await resolveAnimePlaybackSources({
          title: anime.title,
          altTitle: anime.alt_title || "",
          altTitles: expandAnimeTitles(anime.title, anime.alt_title).slice(1),
          tmdbId,
          fallbackSeason: 1,
          fallbackEpisode: targetEpisode,
          episodeNumber: targetEpisode,
          audio: normalizedAudio,
          server: requestedServer,
          isMovie,
          purpose,
          candidates: getWatchCandidates().map((candidate) => ({
            provider: candidate.provider,
            animeId: candidate.id,
            episodeId: getCandidateEpisodeId(candidate, targetEpisode),
            title: candidate.title,
            altTitle: candidate.alt_title || "",
          })),
        });
        const resolvedSource = sources[0] ?? null;
        if (resolvedSource) resolvedSourceCacheRef.current[cacheKey] = resolvedSource;
        return resolvedSource;
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : "";
      }
      if (lastMessage) throw new Error(lastMessage);
      return null;
    })();

    resolvedSourcePromiseCacheRef.current[cacheKey] = request;
    try {
      return await request;
    } finally {
      delete resolvedSourcePromiseCacheRef.current[cacheKey];
    }
  };

  const resolveAnimePlaybackSourcesViaBackend = async (
    targetEpisode = episode,
    overrides?: { audio?: AudioPreference; server?: AnimeServerOption }
  ): Promise<StreamSource[]> => {
    const requestedAudio = normalizeAudioPreference(overrides?.audio ?? audio);
    const requestedServer = overrides?.server ?? server;
    const cacheKey = `play:${requestedAudio}:${requestedServer}:${targetEpisode}`;
    const cached = resolvedPlayableSourcesCacheRef.current[cacheKey];
    if (cached) return cached;
    const pending = resolvedPlayableSourcesPromiseCacheRef.current[cacheKey];
    if (pending) return pending;

    const request = (async () => {
      const tmdbEpisode = await resolveTmdbEpisodeNumber(tmdbId, targetEpisode);
      const sources = await resolveAnimePlaybackSources({
        title: anime.title,
        altTitle: anime.alt_title || "",
        altTitles: expandAnimeTitles(anime.title, anime.alt_title).slice(1),
        tmdbId,
        fallbackSeason: tmdbEpisode?.season ?? 1,
        fallbackEpisode: tmdbEpisode?.episode ?? targetEpisode,
        episodeNumber: targetEpisode,
        audio: requestedAudio,
        server: requestedServer,
        isMovie,
        purpose: "play",
        candidates: getWatchCandidates().map((candidate) => ({
          provider: candidate.provider,
          animeId: candidate.id,
          episodeId: getCandidateEpisodeId(candidate, targetEpisode),
          title: candidate.title,
          altTitle: candidate.alt_title || "",
        })),
      });
      resolvedPlayableSourcesCacheRef.current[cacheKey] = sources;
      if (sources[0]) resolvedSourceCacheRef.current[cacheKey] = sources[0];
      return sources;
    })();

    resolvedPlayableSourcesPromiseCacheRef.current[cacheKey] = request;
    try {
      return await request;
    } finally {
      delete resolvedPlayableSourcesPromiseCacheRef.current[cacheKey];
    }
  };

  const resolveMovieBoxAnimeSources = async (
    targetEpisode = episode,
    options?: { preferHindi?: boolean }
  ): Promise<StreamSource[]> => {
    const preferHindi = Boolean(options?.preferHindi);
    const titleCandidates = expandAnimeTitles(anime.title, anime.alt_title).slice(0, 6);
    const movieBoxMatches = new Map<string, { id: string; title?: string; year?: number; moviebox_media_type?: "movie" | "series"; is_hindi?: boolean }>();

    for (const candidateTitle of titleCandidates) {
      try {
        const result = await searchMovieBox({ query: candidateTitle, page: 1, perPage: 8, mediaType: "anime", animeOnly: true, preferHindi, sortBy: "search" });
        for (const item of result.items) movieBoxMatches.set(item.id, item);
      } catch { continue; }
    }

    const rankedMatches = [...movieBoxMatches.values()].sort((left, right) => {
      if (preferHindi && Boolean(left.is_hindi) !== Boolean(right.is_hindi)) return left.is_hindi ? -1 : 1;
      return 0;
    });

    for (const item of rankedMatches.slice(0, 6)) {
      try {
        const sources = await fetchMovieBoxSources({ subjectId: item.id, title: item.title || title, mediaType: item.moviebox_media_type === "movie" ? "movie" : "series", year: item.year, season: 1, episode: targetEpisode });
        if (sources.length > 0) return sources;
      } catch { continue; }
    }

    for (const candidateTitle of titleCandidates) {
      try {
        const sources = await fetchMovieBoxSources({ title: candidateTitle, mediaType: isMovie ? "movie" : "anime", season: 1, episode: targetEpisode });
        if (sources.length > 0) return sources;
      } catch {
        if (isMovie) continue;
        try {
          const seriesSources = await fetchMovieBoxSources({ title: candidateTitle, mediaType: "series", season: 1, episode: targetEpisode });
          if (seriesSources.length > 0) return seriesSources;
        } catch { continue; }
      }
    }

    return [];
  };

  const resolveHindiMovieBoxSources = async (targetEpisode = episode): Promise<StreamSource[]> =>
    resolveMovieBoxAnimeSources(targetEpisode, { preferHindi: true });

  const isMovieBoxSource = (source: StreamSource): boolean => {
    const provider = `${source.provider || ""} ${source.description || ""}`.toLowerCase();
    return provider.includes("moviebox") || provider.includes("movie box");
  };

  const mergeAnimeFallbackSources = async (
    primarySources: StreamSource[],
    _targetEpisode = episode,
    requestedAudioOverride?: AudioPreference
  ): Promise<StreamSource[]> => {
    if (normalizeAudioPreference(requestedAudioOverride ?? audio) === "hi") return primarySources;
    return primarySources.filter((source) => !isMovieBoxSource(source));
  };

  const resolvePlayableSources = async (
    targetEpisode = episode,
    overrides?: { audio?: AudioPreference; server?: AnimeServerOption }
  ): Promise<StreamSource[]> => {
    const requestedAudio = normalizeAudioPreference(overrides?.audio ?? audio);
    const requestedServer = overrides?.server ?? server;

    if (anime.provider === "hianime") {
      const cat = (hasDub && requestedAudio === "en") ? "dub" : "sub";
      const cachedEps = episodeCacheRef.current[`hianime-${anime.id}`] ?? episodes;
      const ep = cachedEps.find((e) => Number(e.number) === Number(targetEpisode)) ?? cachedEps[0];
      const epId = ep?.id ? String(ep.id).trim() : undefined;
      if (epId) {
        const serversToTry = requestedServer === "auto" ? (["hd-2", "hd-1"] as const) : ([requestedServer] as const);
        for (const tryServer of serversToTry) {
          try {
            const r = await fetch(
              `${consumetBaseUrl}/anime/hianime/watch/${encodeURIComponent(epId)}?server=${tryServer}&category=${cat}`,
              { signal: AbortSignal.timeout(8000) }
            );
            if (!r.ok) continue;
            const watchData = await r.json() as {
              sources?: Array<{ url: string; quality?: string; isM3U8?: boolean; isEmbed?: boolean }>;
              subtitles?: Array<{ lang?: string; url?: string }>;
              headers?: Record<string, string>;
            };
            if (!watchData.sources?.length) continue;
            const playableSources = watchData.sources.filter(
              (src) => src.isM3U8 || (!src.isEmbed && src.url && !src.url.includes("megacloud.blog"))
            );
            if (playableSources.length === 0) continue;
            const subs = (watchData.subtitles ?? [])
              .filter((s) => Boolean(s.url) && !(s.lang ?? "").toLowerCase().includes("thumbnail"))
              .map((s, si) => ({ id: s.lang ?? `sub-${si}`, label: s.lang ?? "Subtitle", language: s.lang, url: s.url! }));
            const sources: StreamSource[] = playableSources.map((src, i) => ({
              id: `hianime-sidecar-${epId}-${cat}-${i}`,
              label: `HiAnime ${cat === "dub" ? "DUB" : "SUB"}`,
              provider: "hianime",
              kind: src.isM3U8 ? "hls" : "direct",
              url: src.url,
              quality: src.quality,
              subtitles: subs,
            }));
            resolvedPlayableSourcesCacheRef.current[`play:${requestedAudio}:${requestedServer}:${targetEpisode}`] = sources;
            return sources;
          } catch { /* try next server */ }
        }
        throw new Error(
          "Could not load stream from HiAnime. The consumet sidecar may be down or the aniwatch package may be outdated."
        );
      }
    }
    return await resolveAnimePlaybackSourcesViaBackend(targetEpisode, { audio: requestedAudio, server: requestedServer });
  };

  // ── Player builders ───────────────────────────────────────────────────────

  const buildSubtitleText = (targetEpisode = episode) => {
    const normalizedAudio = normalizeAudioPreference(audio);
    return normalizedAudio === "hi"
      ? `Hindi playback from Movie Box - ${selectionLabel} ${targetEpisode}`
      : `Anime playback with ${normalizedAudio === "en" ? "English dub" : "sub"} preference - ${selectionLabel} ${targetEpisode}`;
  };

  const buildSubtitleSearchTitle = (targetEpisode = episode) =>
    `${title} ${selectionLabel} ${targetEpisode}`.trim();

  const playerServerOptions = (() => {
    const normalizedAudio = normalizeAudioPreference(audio);
    const subOptions = [
      { id: "hd-1:original", label: "HiAnime SUB" },
      { id: "hd-2:original", label: "HiAnime SUB-2" },
    ];
    const dubOptions = hasDub
      ? [{ id: "hd-1:en", label: "HiAnime DUB" }, { id: "hd-2:en", label: "HiAnime DUB-2" }]
      : [];
    return normalizedAudio === "en" ? [...dubOptions, ...subOptions] : [...subOptions, ...dubOptions];
  })();

  const resolvePlayerServerOption = async (optionId: string, targetEpisode = episode) => {
    const [requestedServer, requestedAudio] = optionId.split(":") as [AnimeServerOption, AudioPreference];
    const sources = await mergeAnimeFallbackSources(
      await resolvePlayableSources(targetEpisode, { audio: requestedAudio, server: requestedServer }),
      targetEpisode,
      requestedAudio
    );
    if (sources.length === 0) {
      throw new Error(`No playable source was found for ${optionId.replace(":", " ").toUpperCase()}.`);
    }
    return {
      sources,
      subtitle: requestedAudio === "en"
        ? `Anime playback with English dub - ${selectionLabel} ${targetEpisode}`
        : `Anime playback with subtitles - ${selectionLabel} ${targetEpisode}`,
      subtitleSearchTitle: buildSubtitleSearchTitle(targetEpisode),
    };
  };

  const buildInstantPlayableSources = (targetEpisode = episode): StreamSource[] => {
    const normalizedAudio = normalizeAudioPreference(audio);
    const cachedResolved = resolvedPlayableSourcesCacheRef.current[`play:${normalizedAudio}:${server}:${targetEpisode}`];
    if (cachedResolved?.length) return cachedResolved;
    return [];
  };

  const buildPlayerPayload = async (targetEpisode = episode) => {
    const sources = await mergeAnimeFallbackSources(await resolvePlayableSources(targetEpisode), targetEpisode, audio);
    const normalizedAudio = normalizeAudioPreference(audio);
    if (sources.length === 0) {
      throw new Error(
        normalizedAudio === "hi"
          ? "No Hindi sources were found for this title."
          : `No playable anime sources were found from HiAnime or the anime fallback providers for ${selectionLabel.toLowerCase()} ${targetEpisode}.`
      );
    }
    return {
      sources,
      subtitle: buildSubtitleText(targetEpisode),
      subtitleSearchTitle: buildSubtitleSearchTitle(targetEpisode),
    };
  };

  // ── Download helpers ──────────────────────────────────────────────────────

  const loadDownloadOptions = async (
    requestedLanguage = downloadLanguage,
    requestedServer = downloadServer
  ) => {
    setDownloadDialogLoading(true);
    setDownloadDialogError("");
    try {
      if (requestedLanguage === "hindi") {
        const sources = await resolveHindiMovieBoxSources(episode);
        if (sources.length === 0) {
          setDownloadQualityOptions([]);
          setDownloadSubtitleTracks([]);
          setDownloadIncludeSubtitle(false);
          setDownloadQuality("");
          setDownloadDialogError("No Hindi source available. Try downloading in English.");
          return;
        }
        const options = await resolveSourceDownloadOptions(sources);
        setDownloadQualityOptions(options);
        setDownloadSubtitleTracks((sources[0]?.subtitles ?? []).filter((track) => Boolean(track.url)).map((track) => ({
          label: track.label,
          url: track.url,
          headers: sources[0]?.requestHeaders,
        })));
        setDownloadIncludeSubtitle(false);
        setDownloadQuality(options[0]?.id || "");
        return;
      }

      const requestedAudio = requestedLanguage === "dub" ? "en" : "original";
      let source = await resolveAnimeSourceViaBackend(episode, "download", { audio: requestedAudio, server: requestedServer });
      if (!source && requestedServer !== "auto") source = await resolveAnimeSourceViaBackend(episode, "download", { audio: requestedAudio, server: "auto" });
      if (!source) source = await resolveAnimeSourceViaBackend(episode, "play", { audio: requestedAudio, server: requestedServer });
      if (!source && requestedServer !== "auto") source = await resolveAnimeSourceViaBackend(episode, "play", { audio: requestedAudio, server: "auto" });

      if (!source) {
        setDownloadQualityOptions([]);
        setDownloadSubtitleTracks([]);
        setDownloadIncludeSubtitle(false);
        setDownloadQuality("");
        setDownloadDialogError("No downloadable source was found for that selection.");
        return;
      }

      const options = await resolveSourceDownloadOptions([source]);
      if (options.length === 0) {
        setDownloadQualityOptions([]);
        setDownloadSubtitleTracks([]);
        setDownloadIncludeSubtitle(false);
        setDownloadQuality("");
        setDownloadDialogError("No downloadable quality was found for that selection.");
        return;
      }
      setDownloadQualityOptions(options);
      const subtitles = (source.subtitles ?? []).filter((track) => Boolean(track.url)).map((track) => ({
        label: track.label, url: track.url, headers: source?.requestHeaders,
      }));
      setDownloadSubtitleTracks(subtitles);
      setDownloadIncludeSubtitle(subtitles.length > 0);
      setDownloadQuality(options[0]?.id || "");
    } catch (error) {
      setDownloadQualityOptions([]);
      setDownloadSubtitleTracks([]);
      setDownloadIncludeSubtitle(false);
      setDownloadQuality("");
      setDownloadDialogError(error instanceof Error ? error.message : "Download options could not be loaded.");
    } finally {
      setDownloadDialogLoading(false);
    }
  };

  // ── Action handlers ───────────────────────────────────────────────────────

  const handlePlay = async () => {
    if (playing) return;
    const normalizedAudio = normalizeAudioPreference(audio);
    const instantSources = normalizedAudio === "hi" ? [] : buildInstantPlayableSources(episode);

    if (instantSources.length > 0) {
      onPlay({
        title,
        subtitle: buildSubtitleText(episode),
        subtitleSearchTitle: buildSubtitleSearchTitle(episode),
        poster: anime.image,
        sources: instantSources,
        mediaType: isMovie ? "movie" : "tv",
        currentEpisode: episode,
        episodeOptions: totalEpisodes > 1 ? Array.from({ length: totalEpisodes }, (_, index) => index + 1) : undefined,
        episodeLabel: selectionLabel,
        sourceOptions: normalizedAudio === "hi" ? undefined : [...playerServerOptions],
        onSelectSourceOption: normalizedAudio === "hi"
          ? undefined
          : async (optionId: string, nextEpisode?: number) => resolvePlayerServerOption(optionId, nextEpisode ?? episode),
        onSelectEpisode: async (nextEpisode: number) => {
          const nextInstantSources = buildInstantPlayableSources(nextEpisode);
          if (nextInstantSources.length > 0) {
            return { sources: nextInstantSources, subtitle: buildSubtitleText(nextEpisode), subtitleSearchTitle: buildSubtitleSearchTitle(nextEpisode) };
          }
          return buildPlayerPayload(nextEpisode);
        },
      });
      return;
    }

    setPlaying(true);
    try {
      const initialPayload = await buildPlayerPayload(episode);
      onPlay({
        title,
        subtitle: initialPayload.subtitle,
        subtitleSearchTitle: initialPayload.subtitleSearchTitle,
        poster: anime.image,
        sources: initialPayload.sources,
        mediaType: isMovie ? "movie" : "tv",
        currentEpisode: episode,
        episodeOptions: totalEpisodes > 1 ? Array.from({ length: totalEpisodes }, (_, index) => index + 1) : undefined,
        episodeLabel: selectionLabel,
        sourceOptions: normalizeAudioPreference(audio) === "hi" ? undefined : [...playerServerOptions],
        onSelectSourceOption: normalizeAudioPreference(audio) === "hi"
          ? undefined
          : async (optionId: string, nextEpisode?: number) => resolvePlayerServerOption(optionId, nextEpisode ?? episode),
        onSelectEpisode: async (nextEpisode: number) => buildPlayerPayload(nextEpisode),
      });
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : "No playable anime sources were found for this episode.", variant: "error" });
    } finally {
      setPlaying(false);
    }
  };

  const handleDownload = async () => {
    if (downloading) return;
    setDownloadLanguage(hasDub ? "dub" : "sub");
    setDownloadServer("auto");
    setDownloadQuality("");
    setDownloadQualityOptions([]);
    setDownloadSubtitleTracks([]);
    setDownloadIncludeSubtitle(true);
    setDownloadDialogError("");
    setDownloadDialogOpen(true);
  };

  const confirmDownloadSelection = async () => {
    if (downloading) return;
    const selectedOption = downloadQualityOptions.find((option) => option.id === downloadQuality);
    if (!selectedOption) { setDownloadDialogError("Choose a quality before downloading."); return; }
    if (downloadLanguage === "sub" && downloadIncludeSubtitle && downloadSubtitleTracks.length === 0) {
      setDownloadDialogError("No subtitle file is available for this episode."); return;
    }

    const languageLabel = downloadLanguage === "hindi" ? "Hindi" : downloadLanguage === "dub" ? "Dub" : "Sub";
    const formattedTitle = isMovie
      ? `${title} — ${languageLabel} — ${selectedOption.label}`
      : `${title} — ${selectionLabel} ${String(episode).padStart(2, "0")} — ${languageLabel} — ${selectedOption.label}`;

    setDownloading(true);
    try {
      await queueVideoDownload({ url: selectedOption.url, title: formattedTitle, thumbnail: anime.image, headers: selectedOption.headers, forceHls: selectedOption.forceHls, category: "Anime", tags: [languageLabel, isMovie ? "Movie" : selectionLabel] });
      if (downloadSubtitleTracks[0]?.url) {
        const subtitleTitle = isMovie
          ? `${title} [${languageLabel}] Subtitles`
          : `${title} - Episode ${String(episode).padStart(2, "0")} [${languageLabel}] Subtitles`;
        await queueSubtitleDownload({ url: downloadSubtitleTracks[0].url, title: subtitleTitle, headers: downloadSubtitleTracks[0].headers, category: "Anime", tags: ["Subtitle", isMovie ? "Movie" : selectionLabel] });
      }
      setDownloadDialogOpen(false);
    } catch (error) {
      setDownloadDialogError(error instanceof Error ? error.message : "Download could not be started.");
    } finally {
      setDownloading(false);
    }
  };

  const handleSubtitleOnlyDownload = async () => {
    if (downloading) return;
    const subtitleTrack = downloadSubtitleTracks[0];
    if (!subtitleTrack?.url) { setDownloadDialogError("No subtitle file is available for this episode."); return; }
    setDownloading(true);
    try {
      await queueSubtitleDownload({ url: subtitleTrack.url, title: isMovie ? `${title} Subtitle` : `${title} EP ${episode} Subtitle`, headers: subtitleTrack.headers, category: "Anime", tags: ["Subtitle", isMovie ? "Movie" : selectionLabel] });
      setDownloadDialogOpen(false);
    } catch (error) {
      setDownloadDialogError(error instanceof Error ? error.message : "Subtitle download could not be started.");
    } finally {
      setDownloading(false);
    }
  };

  const handleTrailer = () => {
    if (!trailerUrl) { setToast({ message: "Trailer is not available for this title.", variant: "info" }); return; }
    onPlay({
      title: `${title} Trailer`,
      subtitle: "Official trailer playback",
      subtitleSearchTitle: `${title} Trailer`,
      poster: anime.image,
      mediaType: "movie",
      sources: [{
        id: `trailer-${anime.id}`,
        label: "Trailer",
        provider: "Trailer",
        kind: "embed",
        url: trailerUrl,
        description: "Official trailer",
        quality: "Preview",
        externalUrl: trailerUrl,
        canExtract: false,
      }],
    });
  };

  return {
    // state
    finding, playing, episode, setEpisode, audio, setAudio, server, setServer,
    detailHint, hasHindiFallback, hasDub, dubEpisodeCount,
    hasTrailer, totalEpisodes, episodeGroups, selectedGroup, visibleEpisodes,
    downloading, downloadDialogOpen, setDownloadDialogOpen,
    downloadLanguage, setDownloadLanguage, downloadServer, setDownloadServer,
    downloadQuality, setDownloadQuality, downloadQualityOptions,
    downloadSubtitleTracks, downloadDialogLoading, downloadDialogError,
    toast, setToast, fav, toggle,
    // derived
    title, isMovie, selectionLabel,
    // handlers
    handlePlay, handleDownload, handleSubtitleOnlyDownload, handleTrailer,
    confirmDownloadSelection,
    // server options (for player)
    playerServerOptions,
  };
}
