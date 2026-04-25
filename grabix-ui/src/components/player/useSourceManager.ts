// player/useSourceManager.ts
// Source state, failover logic, episode/server switching.
// Stream extraction removed — embed sources play as iframes directly.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BACKEND_API } from "../../lib/api";
import { inferStreamKind } from "../../lib/streamProviders";
import type { StreamSource } from "../../lib/streamProviders";
import { queueVideoDownload } from "../../lib/downloads";
import {
  canPrepareInternalSource, failureLabel,
  resolveEmbedUrl,
} from "./helpers";
import type { Props } from "./types";

interface SourceManagerOptions {
  embedUrl?: string;
  sources?: StreamSource[];
  sourceOptions?: Props["sourceOptions"];
  currentEpisode?: number;
  episodeLabel: string;
  title: string;
  subtitle?: string;
  subtitleSearchTitle?: string;
  onSelectEpisode?: Props["onSelectEpisode"];
  onSelectSourceOption?: Props["onSelectSourceOption"];
  onDownload?: Props["onDownload"];
  onDownloadSource?: Props["onDownloadSource"];
  setIsLoading: (v: boolean) => void;
  setIsPlaying: (v: boolean) => void;
  setStatusText: (v: string) => void;
  setErrorText: (v: string) => void;
  setFallbackNotice: (v: string) => void;
  setReloadKey: React.Dispatch<React.SetStateAction<number>>;
  setVolumeBoost: (v: number) => void;
  showControls: () => void;
}

export function useSourceManager({
  embedUrl, sources, sourceOptions, currentEpisode, episodeLabel, title,
  subtitle, subtitleSearchTitle, onSelectEpisode, onSelectSourceOption,
  onDownload, onDownloadSource,
  setIsLoading, setIsPlaying, setStatusText, setErrorText,
  setFallbackNotice, setReloadKey, setVolumeBoost, showControls,
}: SourceManagerOptions) {
  const API = BACKEND_API;

  const embedLoadedRef       = useRef(false);
  const sourceRetryCountsRef = useRef<Record<string, number>>({});

  const [activeSubtitleText, setActiveSubtitleText] = useState(subtitle ?? "");
  const [activeSearchTitle, setActiveSearchTitle]   = useState(subtitleSearchTitle ?? title);
  const [activeEpisode, setActiveEpisode]           = useState<number | null>(currentEpisode ?? null);
  const [runtimeSources, setRuntimeSources]         = useState<StreamSource[]>(sources ?? []);
  const [episodeLoading, setEpisodeLoading]         = useState(false);
  const [activeIndex, setActiveIndex]               = useState(0);
  const [activeSourceOptionId, setActiveSourceOptionId] = useState(sourceOptions?.[0]?.id ?? "");
  const [resolvedEmbedUrl, setResolvedEmbedUrl]     = useState("");
  const [resolvedPlaybackUrl, setResolvedPlaybackUrl] = useState("");

  // Sync incoming props → state
  useEffect(() => {
    setRuntimeSources(sources ?? []);
    setActiveSubtitleText(subtitle ?? "");
    setActiveSearchTitle(subtitleSearchTitle ?? title);
    setActiveEpisode(currentEpisode ?? null);
  }, [sources, subtitle, subtitleSearchTitle, currentEpisode, title]);

  useEffect(() => { setActiveSourceOptionId(sourceOptions?.[0]?.id ?? ""); }, [sourceOptions]);

  const effectiveSources = runtimeSources.length > 0 ? runtimeSources : sources;
  const baseSources = useMemo<StreamSource[]>(() =>
    effectiveSources && effectiveSources.length > 0
      ? effectiveSources
      : embedUrl
        ? [{ id: "legacy-source", label: "Main", provider: "Custom", kind: "embed" as const, url: embedUrl, description: "Embedded source", quality: "Auto", externalUrl: embedUrl }]
        : [],
  [effectiveSources, embedUrl]);

  const allSources = baseSources;

  const activeSource    = allSources[activeIndex] ?? null;
  const activeSubtitles = activeSource?.subtitles ?? [];
  const hasFallback     = activeIndex < allSources.length - 1;

  const isDirectEngine = useMemo(
    () => activeSource?.kind === "direct" || activeSource?.kind === "hls" || activeSource?.kind === "local",
    [activeSource],
  );
  const isEmbedEngine = useMemo(() => activeSource?.kind === "embed", [activeSource]);
  const isMovieBoxQualityMode = useMemo(
    () => allSources.length > 0 && allSources.every(s => s.provider.toLowerCase().includes("moviebox") || s.provider.toLowerCase().includes("movie box")),
    [allSources],
  );
  const isAnimeQualityMode = useMemo(
    () => allSources.length > 1 && allSources.every(s => Boolean(s.quality) && !s.provider.toLowerCase().includes("moviebox")),
    [allSources],
  );

  // ── Source setup effect ──────────────────────────────────────────────────────
  useEffect(() => {
    setIsLoading(true); setIsPlaying(false); setErrorText("");
    setStatusText(activeSource ? `Loading ${activeSource.provider}` : "No source");
    setResolvedEmbedUrl(""); setResolvedPlaybackUrl("");
    embedLoadedRef.current = false;
    if (!activeSource) return;
    if (activeSource.kind === "embed") {
      const t = window.setTimeout(() => {
        if (!embedLoadedRef.current) {
          embedLoadedRef.current = true;
          setFallbackNotice("Stream is taking a while. Use the server picker to switch if needed.");
          setIsLoading(false);
        }
      }, 8_000);
      return () => window.clearTimeout(t);
    }
  }, [activeSource]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Embed URL resolution ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeSource || activeSource.kind !== "embed") return;
    let canceled = false;
    resolveEmbedUrl(API, activeSource.url)
      .then((url) => { if (!canceled) setResolvedEmbedUrl(url || activeSource.url); })
      .catch(() => { if (!canceled) setResolvedEmbedUrl(activeSource.url); });
    return () => { canceled = true; };
  }, [API, activeSource]);

  // ── Failover ─────────────────────────────────────────────────────────────────
  const findPreparedSiblingIndex = useCallback((index: number): number => {
    const candidate = allSources[index];
    if (!candidate || candidate.kind !== "embed") return -1;
    const key = candidate.externalUrl || candidate.url;
    return allSources.findIndex((s, i) => i > index && s.kind !== "embed" && (s.externalUrl || s.url) === key);
  }, [allSources]);

  const goToNextSource = useCallback((reason: string) => {
    const message = failureLabel(reason);
    const currentKey = activeSource ? `${activeIndex}:${activeSource.externalUrl || activeSource.url}` : String(activeIndex);
    const retryCount = sourceRetryCountsRef.current[currentKey] ?? 0;
    const canRetry = Boolean(activeSource) &&
      (activeSource!.kind === "hls" || activeSource!.kind === "direct") && retryCount < 5;
    if (canRetry) {
      sourceRetryCountsRef.current[currentKey] = retryCount + 1;
      setErrorText(""); setIsLoading(true); setIsPlaying(false); setStatusText("Retrying");
      setFallbackNotice(`${message} Retrying stream (${retryCount + 1}/5)...`);
      setReloadKey((k) => k + 1);
      return;
    }
    if (hasFallback) {
      const next = activeIndex + 1;
      const sibling = findPreparedSiblingIndex(next);
      const nextIndex = sibling >= 0 ? sibling : next;
      const nextSrc = allSources[nextIndex];
      sourceRetryCountsRef.current[currentKey] = 0;
      setFallbackNotice(`${message} Switched to ${nextSrc.label} (${nextSrc.provider}).`);
      setActiveIndex(nextIndex); setReloadKey((k) => k + 1);
      return;
    }
    sourceRetryCountsRef.current[currentKey] = 0;
    setErrorText(message); setIsLoading(false); setStatusText("Failed");
  }, [activeSource, activeIndex, allSources, hasFallback, findPreparedSiblingIndex,
      setErrorText, setIsLoading, setIsPlaying, setStatusText, setFallbackNotice, setReloadKey]);

  const onSourcePlaying = useCallback((sourceUrl: string) => {
    const key = `${activeIndex}:${sourceUrl}`;
    sourceRetryCountsRef.current[key] = 0;
  }, [activeIndex]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleSourceSwitch = useCallback((index: number) => {
    setIsLoading(true); setIsPlaying(false);
    const next = allSources[index];
    if (next) sourceRetryCountsRef.current[`${index}:${next.externalUrl || next.url}`] = 0;
    setActiveIndex(index); setErrorText(""); setFallbackNotice("Switching stream...");
    setReloadKey((k) => k + 1);
    showControls();
  }, [allSources, setIsLoading, setIsPlaying, setErrorText, setFallbackNotice, setReloadKey, showControls]);

  const handleEpisodeSwitch = useCallback(async (episode: number) => {
    if ((!onSelectEpisode && !onSelectSourceOption) || episodeLoading || episode === activeEpisode) return;
    setEpisodeLoading(true); setIsLoading(true); setIsPlaying(false); setErrorText("");
    setFallbackNotice(`Loading ${episodeLabel.toLowerCase()} ${episode}...`);
    try {
      const preferredProvider = activeSource?.provider;
      const preferredLabel    = activeSource?.label;
      const next = onSelectEpisode
        ? await onSelectEpisode(episode)
        : onSelectSourceOption && activeSourceOptionId
          ? await onSelectSourceOption(activeSourceOptionId, episode)
          : undefined;
      if (!next) throw new Error(`Could not load ${episodeLabel.toLowerCase()} ${episode}.`);
      const matchedIndex = next.sources.findIndex(s => s.provider === preferredProvider && s.label === preferredLabel);
      setRuntimeSources(next.sources);
      setActiveSubtitleText(next.subtitle ?? "");
      setActiveSearchTitle(next.subtitleSearchTitle ?? `${title} ${episodeLabel} ${episode}`);
      setActiveEpisode(episode); setActiveIndex(matchedIndex >= 0 ? matchedIndex : 0);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setFallbackNotice(err instanceof Error ? err.message : `Could not load ${episodeLabel.toLowerCase()} ${episode}.`);
    } finally { setEpisodeLoading(false); }
  }, [onSelectEpisode, onSelectSourceOption, episodeLoading, activeEpisode, episodeLabel,
      activeSource, activeSourceOptionId, title, setIsLoading, setIsPlaying, setErrorText,
      setFallbackNotice, setReloadKey]);

  const handleSourceOptionSwitch = useCallback(async (optionId: string) => {
    if (!onSelectSourceOption || optionId === activeSourceOptionId) return;
    setEpisodeLoading(true); setIsLoading(true); setIsPlaying(false); setErrorText("");
    setFallbackNotice("Switching server...");
    try {
      setActiveSourceOptionId(optionId);
      const targetEpisode = activeEpisode ?? currentEpisode ?? undefined;
      let next: Awaited<ReturnType<NonNullable<Props["onSelectSourceOption"]>>> | undefined;
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        try { next = await onSelectSourceOption(optionId, targetEpisode); break; }
        catch (e) { lastErr = e; if (attempt < 5) await new Promise(r => window.setTimeout(r, 500 * attempt)); }
      }
      if (!next) throw lastErr ?? new Error("Server switch failed.");
      const matchedIndex = next.sources.findIndex(s => s.provider === activeSource?.provider && s.label === activeSource?.label);
      setRuntimeSources(next.sources);
      setActiveSubtitleText(next.subtitle ?? ""); setActiveSearchTitle(next.subtitleSearchTitle ?? title);
      setActiveIndex(matchedIndex >= 0 ? matchedIndex : 0); setReloadKey((k) => k + 1);
    } catch (err) {
      setFallbackNotice(err instanceof Error ? err.message : "Could not switch server.");
    } finally { setEpisodeLoading(false); }
  }, [onSelectSourceOption, activeSourceOptionId, activeEpisode, currentEpisode, activeSource, title,
      setIsLoading, setIsPlaying, setErrorText, setFallbackNotice, setReloadKey]);

  const handleDownloadCurrent = useCallback(async () => {
    if (!activeSource) return;
    const directSrc = allSources.find(s => s.kind === "direct" || s.kind === "hls") || activeSource;
    try {
      await queueVideoDownload({ url: directSrc.url, title, headers: directSrc.requestHeaders, forceHls: directSrc.kind === "hls" });
      setFallbackNotice("Download queued. Open Downloader to track progress.");
    } catch (err) {
      setFallbackNotice(err instanceof Error ? err.message : "Could not start download.");
    }
  }, [activeSource, allSources, title, setFallbackNotice]);

  const currentServerLabel = (() => {
    if (sourceOptions && sourceOptions.length > 0)
      return sourceOptions.find(o => o.id === activeSourceOptionId)?.label ?? "Auto";
    return activeSource?.label ?? "Auto";
  })();

  const onEmbedLoaded = useCallback(() => {
    if (!embedLoadedRef.current) {
      embedLoadedRef.current = true;
      setIsLoading(false);
      setStatusText("");
    }
  }, [setIsLoading, setStatusText]);

  return {
    API,
    embedLoadedRef,
    onEmbedLoaded,
    baseSources, allSources, activeSource, activeSubtitles, activeIndex, setActiveIndex,
    activeEpisode, activeSearchTitle, activeSubtitleText,
    activeSourceOptionId, setActiveSourceOptionId,
    resolvedEmbedUrl, resolvedPlaybackUrl, setResolvedPlaybackUrl,
    extracting: false, extractError: "",
    episodeLoading,
    hasFallback, isDirectEngine, isEmbedEngine,
    isMovieBoxQualityMode, isAnimeQualityMode,
    goToNextSource, onSourcePlaying,
    prepareInternalSource: async (_s: StreamSource) => 0,
    handleSourceSwitch, handleEpisodeSwitch, handleSourceOptionSwitch,
    handleExtractStream: async () => {},
    handleDownloadCurrent,
    currentServerLabel,
  };
}
