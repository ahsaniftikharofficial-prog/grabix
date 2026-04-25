// player/useSourceManager.ts
// Source state, failover logic, episode/server switching, stream extraction & preparation.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BACKEND_API } from "../../lib/api";
import { inferStreamKind } from "../../lib/streamProviders";
import type { StreamSource } from "../../lib/streamProviders";
import { queueVideoDownload } from "../../lib/downloads";
import {
  EMBED_CACHE_TTL_MS, EXTRACT_CACHE_TTL_MS,
  canPrepareInternalSource, failureLabel,
  readPlaybackCache, resolveEmbedUrl, writePlaybackCache,
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
  // shared state setters from orchestrator
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
  const extractedSourcesRef  = useRef<StreamSource[]>([]);

  const [activeSubtitleText, setActiveSubtitleText]   = useState(subtitle ?? "");
  const [activeSearchTitle, setActiveSearchTitle]     = useState(subtitleSearchTitle ?? title);
  const [activeEpisode, setActiveEpisode]             = useState<number | null>(currentEpisode ?? null);
  const [runtimeSources, setRuntimeSources]           = useState<StreamSource[]>(sources ?? []);
  const [episodeLoading, setEpisodeLoading]           = useState(false);
  const [extractedSources, setExtractedSources]       = useState<StreamSource[]>([]);
  const [activeIndex, setActiveIndex]                 = useState(0);
  const [activeSourceOptionId, setActiveSourceOptionId] = useState(sourceOptions?.[0]?.id ?? "");
  const [resolvedEmbedUrl, setResolvedEmbedUrl]       = useState("");
  const [resolvedPlaybackUrl, setResolvedPlaybackUrl] = useState("");
  const [extracting, setExtracting]                   = useState(false);
  const [extractError, setExtractError]               = useState("");

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

  const allSources = useMemo(() => [...baseSources, ...extractedSources], [baseSources, extractedSources]);

  useEffect(() => { extractedSourcesRef.current = []; setExtractedSources([]); }, [baseSources]);

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
    setResolvedEmbedUrl(""); setResolvedPlaybackUrl(""); setExtractError("");
    embedLoadedRef.current = false;
    if (!activeSource) return;
    if (activeSource.kind === "embed") {
      // Fallback: if the iframe onLoad never fires (e.g. blocked by browser),
      // clear the spinner after 8 seconds so the user isn't stuck forever.
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

  // ── Stream extraction helpers ────────────────────────────────────────────────
  const extractDirectStreamUrl = useCallback(async (targetUrl: string): Promise<{ url: string; quality?: string; format?: string }> => {
    const resolved = await resolveEmbedUrl(API, targetUrl);
    const cacheKey = `extract:${resolved}`;
    const cached = readPlaybackCache<{ url: string; quality?: string; format?: string }>(cacheKey);
    if (cached?.url) return cached;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${API}/extract-stream?url=${encodeURIComponent(resolved)}`, { signal: ctrl.signal });
    window.clearTimeout(timer);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = (await res.json()) as { url?: string; quality?: string; format?: string };
    if (!data.url) throw new Error("No URL in response");
    const payload = { url: data.url, quality: data.quality, format: data.format };
    writePlaybackCache(cacheKey, payload, EXTRACT_CACHE_TTL_MS);
    return payload;
  }, [API]);

  const prepareInternalSource = useCallback(async (source: StreamSource, opts?: { labelPrefix?: string; notice?: string }): Promise<number> => {
    const sourceKey = source.externalUrl || source.url;
    const existing = extractedSourcesRef.current.findIndex(s => s.externalUrl === sourceKey);
    if (existing >= 0) return baseSources.length + existing;
    const data = await extractDirectStreamUrl(sourceKey);
    if (!data.url) throw new Error("No playable stream was returned.");
    const extracted: StreamSource = {
      id: `prepared-${Date.now()}`,
      label: opts?.labelPrefix ? `${opts.labelPrefix} Direct` : `${source.label} Direct`,
      provider: source.provider, kind: inferStreamKind(data.url), url: data.url,
      quality: data.quality ?? source.quality ?? "Auto",
      description: opts?.notice ?? "Prepared internal stream.",
      externalUrl: sourceKey, canExtract: false,
      subtitles: source.subtitles, language: source.language,
    };
    extractedSourcesRef.current = [...extractedSourcesRef.current, extracted];
    setExtractedSources([...extractedSourcesRef.current]);
    return baseSources.length + extractedSourcesRef.current.length - 1;
  }, [baseSources.length, extractDirectStreamUrl]);

  // ── Auto-prepare warm fallbacks ──────────────────────────────────────────────
  useEffect(() => {
    const candidates = baseSources.filter(canPrepareInternalSource).slice(0, 2);
    if (!candidates.length) return;
    let cancelled = false;
    const warm = async () => {
      for (const src of candidates) {
        if (cancelled) return;
        try { await prepareInternalSource(src, { notice: "Prepared internal failover stream." }); } catch { /* ignore */ }
      }
    };
    void warm();
    return () => { cancelled = true; };
  }, [baseSources, prepareInternalSource]);

  // ── Auto-extract direct stream for ALL embed sources (hybrid model) ──────────
  // Flow: iframe loads immediately → backend fast-extracts m3u8 in background
  //       → if found, silently switch to our HLS engine (full volume/controls)
  //       → if not found within timeout, stay on iframe — user never waits
  useEffect(() => {
    if (!activeSource || activeSource.kind !== "embed") return;
    const prov = activeSource.provider.toLowerCase();
    const sourceKey = activeSource.externalUrl || activeSource.url;
    if (extractedSourcesRef.current.some(s => s.externalUrl === sourceKey)) return;
    let cancelled = false;
    const prepare = async () => {
      try {
        const data = await extractDirectStreamUrl(activeSource.externalUrl || activeSource.url);
        if (!data.url || cancelled) return;
        const extracted: StreamSource = {
          id: `auto-extracted-${Date.now()}`, label: `${activeSource.label} Direct`,
          provider: activeSource.provider, kind: inferStreamKind(data.url), url: data.url,
          quality: data.quality ?? "Auto", description: "Auto-extracted — full player controls active",
          externalUrl: sourceKey, canExtract: false,
          subtitles: activeSource.subtitles, language: activeSource.language,
        };
        extractedSourcesRef.current = [...extractedSourcesRef.current, extracted];
        setExtractedSources([...extractedSourcesRef.current]);
        setActiveIndex(baseSources.length + extractedSourcesRef.current.length - 1);
        setFallbackNotice(prov.includes("moviebox")
          ? "Switched to direct MovieBox stream — full player controls active."
          : `Switched to direct ${activeSource.provider} stream — full player controls active.`);
      } catch { /* silent — iframe stays active if extraction fails */ }
    };
    void prepare();
    return () => { cancelled = true; };
  }, [activeSource, baseSources.length, extractDirectStreamUrl, setFallbackNotice]);

  // ── Volume boost → force internal source for embeds ──────────────────────────
  useEffect(() => {
    if (!activeSource || activeSource.kind !== "embed") return;
    const canPrepare = activeSource.provider.toLowerCase().includes("moviebox") || Boolean(activeSource.canExtract);
    if (!canPrepare) { setFallbackNotice("Volume boost is unavailable for this embedded source."); setVolumeBoost(100); return; }
    // This effect is only triggered by the orchestrator passing a changed volumeBoost
    // Handled in orchestrator to avoid circular dep — see usePlayerState.ts
  }, [activeSource, setFallbackNotice, setVolumeBoost]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleSourceSwitch = useCallback((index: number) => {
    setIsLoading(true); setIsPlaying(false);
    const next = allSources[index];
    if (next) sourceRetryCountsRef.current[`${index}:${next.externalUrl || next.url}`] = 0;
    setActiveIndex(index); setErrorText(""); setFallbackNotice("Switching stream..."); setExtractError("");
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
      extractedSourcesRef.current = []; setExtractedSources([]); setRuntimeSources(next.sources);
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
      extractedSourcesRef.current = []; setExtractedSources([]); setRuntimeSources(next.sources);
      setActiveSubtitleText(next.subtitle ?? ""); setActiveSearchTitle(next.subtitleSearchTitle ?? title);
      setActiveIndex(matchedIndex >= 0 ? matchedIndex : 0); setReloadKey((k) => k + 1);
    } catch (err) {
      setFallbackNotice(err instanceof Error ? err.message : "Could not switch server.");
    } finally { setEpisodeLoading(false); }
  }, [onSelectSourceOption, activeSourceOptionId, activeEpisode, currentEpisode, activeSource, title,
      setIsLoading, setIsPlaying, setErrorText, setFallbackNotice, setReloadKey]);

  const handleExtractStream = useCallback(async () => {
    if (!activeSource || extracting) return;
    setExtracting(true); setExtractError("");
    try {
      const data = await extractDirectStreamUrl(activeSource.externalUrl || activeSource.url);
      const extracted: StreamSource = {
        id: `extracted-${Date.now()}`, label: "Direct (Extracted)",
        provider: activeSource.provider, kind: inferStreamKind(data.url), url: data.url,
        quality: data.quality ?? "Auto", description: "Extracted direct stream",
        externalUrl: data.url, canExtract: false,
      };
      extractedSourcesRef.current = [...extractedSourcesRef.current, extracted];
      const newIndex = baseSources.length + extractedSourcesRef.current.length - 1;
      setExtractedSources([...extractedSourcesRef.current]); setActiveIndex(newIndex);
      setReloadKey((k) => k + 1);
      setFallbackNotice(`Extracted a direct stream from ${activeSource.provider}. Switched to it.`);
    } catch (err) {
      setExtractError(`Could not extract a direct stream: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally { setExtracting(false); }
  }, [activeSource, extracting, extractDirectStreamUrl, baseSources.length, setReloadKey, setFallbackNotice]);

  const handleDownloadCurrent = useCallback(async () => {
    if (!activeSource) return;
    if (!onDownload && !onDownloadSource) {
      const directSrc = allSources.find(s => s.kind === "direct" || s.kind === "hls") || activeSource;
      try {
        await queueVideoDownload({ url: directSrc.url, title, headers: directSrc.requestHeaders, forceHls: directSrc.kind === "hls" });
        setFallbackNotice("Download queued. Open Downloader to track progress.");
      } catch (err) { setFallbackNotice(err instanceof Error ? err.message : "Could not start download."); }
      return;
    }
    const dlSrc = allSources.find(s => s.kind === "direct" || s.kind === "hls" || s.kind === "local" || Boolean(s.canExtract)) || activeSource;
    try {
      if (dlSrc !== activeSource) setFallbackNotice(`Using ${dlSrc.provider} ${dlSrc.label} for download.`);
      if (dlSrc.kind === "direct" || dlSrc.kind === "hls" || dlSrc.kind === "local") {
        if (onDownloadSource) await onDownloadSource(dlSrc, title);
        else if (onDownload) await onDownload(dlSrc.url, title);
        return;
      }
      if (dlSrc.kind === "embed") {
        const data = await extractDirectStreamUrl(dlSrc.externalUrl || dlSrc.url);
        const extracted: StreamSource = { ...dlSrc, kind: inferStreamKind(data.url), url: data.url, externalUrl: dlSrc.externalUrl || dlSrc.url, canExtract: false };
        if (onDownloadSource) await onDownloadSource(extracted, title);
        else if (onDownload) await onDownload(data.url, title);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Download could not be started.";
      setFallbackNotice(msg); setExtractError(msg);
    }
  }, [activeSource, allSources, title, onDownload, onDownloadSource, extractDirectStreamUrl, setFallbackNotice]);

  const currentServerLabel = (() => {
    if (sourceOptions && sourceOptions.length > 0)
      return sourceOptions.find(o => o.id === activeSourceOptionId)?.label ?? "Auto";
    return activeSource?.label ?? "Auto";
  })();

  // Called from the iframe's onLoad event — clears the GRABIX loading spinner
  // immediately when the embed page finishes loading (instead of waiting 8s).
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
    extracting, extractError,
    episodeLoading,
    hasFallback, isDirectEngine, isEmbedEngine,
    isMovieBoxQualityMode, isAnimeQualityMode,
    goToNextSource, onSourcePlaying, prepareInternalSource,
    handleSourceSwitch, handleEpisodeSwitch, handleSourceOptionSwitch,
    handleExtractStream, handleDownloadCurrent,
    currentServerLabel,
  };
}
