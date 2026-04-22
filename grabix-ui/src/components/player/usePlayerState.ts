// player/usePlayerState.ts
// Custom hook — all useState, useRef, useEffect, useCallback, and handlers
// for VidSrcPlayer. VidSrcPlayer.tsx imports this and passes the result
// straight to JSX / sub-components.

import Hls from "hls.js";
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type CSSProperties,
} from "react";
import { BACKEND_API } from "../lib/api";
import { inferStreamKind } from "../lib/streamProviders";
import type { StreamSource } from "../lib/streamProviders";
import { queueVideoDownload } from "../lib/downloads";
import {
  readJsonStorage,
  versionedStorageKey,
  writeJsonStorage,
} from "../lib/persistentState";
import type {
  Props,
  SubtitleAppearanceSettings,
  SubtitleCue,
  SubtitlePosition,
  SettingsScreen,
} from "./types";
import {
  SUBTITLE_APPEARANCE_STORAGE_KEY,
  SUBTITLE_POSITION_STORAGE_KEY,
  EMBED_CACHE_TTL_MS,
  EXTRACT_CACHE_TTL_MS,
  DEFAULT_SUBTITLE_APPEARANCE,
  DEFAULT_SUBTITLE_POSITION,
  buildSubtitleStyles,
  buildStreamProxyUrl,
  canPrepareInternalSource,
  failureLabel,
  findCurrentCue,
  parseSubtitleText,
  readPlaybackCache,
  resolveEmbedUrl,
  sanitizeSubtitleAppearance,
  sanitizeSubtitlePosition,
  shouldKeepHlsProxied,
  writePlaybackCache,
} from "./helpers";

// Re-export the storage keys that helpers.ts computes once
export { SUBTITLE_APPEARANCE_STORAGE_KEY, SUBTITLE_POSITION_STORAGE_KEY };

export function usePlayerState(props: Props) {
  const {
    embedUrl, title, subtitle, subtitleSearchTitle, poster,
    sources, sourceOptions, currentEpisode, episodeOptions,
    episodeLabel = "Episode", onSelectSourceOption, onSelectEpisode,
    mediaType = "movie", disableSubtitleSearch = false,
    onClose, onDownload, onDownloadSource,
  } = props;

  const API = BACKEND_API;

  // ── Refs ────────────────────────────────────────────────────────────────────
  const rootRef                = useRef<HTMLDivElement>(null);
  const videoRef               = useRef<HTMLVideoElement>(null);
  const hlsRef                 = useRef<Hls | null>(null);
  const previewHlsRef          = useRef<Hls | null>(null);
  const subtitleInputRef       = useRef<HTMLInputElement>(null);
  const audioContextRef        = useRef<AudioContext | null>(null);
  const gainNodeRef            = useRef<GainNode | null>(null);
  const mediaNodeRef           = useRef<MediaElementAudioSourceNode | null>(null);
  const embedLoadedRef         = useRef(false);
  const progressBarWidthRef    = useRef(0);
  const progressBarRef         = useRef<HTMLDivElement>(null);
  const sourceRetryCountsRef   = useRef<Record<string, number>>({});
  const previewVideoRef        = useRef<HTMLVideoElement>(null);
  const previewCanvasRef       = useRef<HTMLCanvasElement>(null);
  const previewThrottleRef     = useRef<number>(0);
  const previewHoveringRef     = useRef(false);
  const previewSeekedCleanupRef= useRef<(() => void) | null>(null);
  const hideChromeTimeoutRef   = useRef<number | null>(null);

  // Direct-DOM refs for progress bar hot path
  const currentTimeRef  = useRef(0);
  const durationRef     = useRef(0);
  const fillRef         = useRef<HTMLDivElement>(null);
  const thumbRef        = useRef<HTMLDivElement>(null);
  const bufferRef       = useRef<HTMLDivElement>(null);
  const rangeRef        = useRef<HTMLInputElement>(null);
  const timeDisplayRef  = useRef<HTMLSpanElement>(null);

  // Subtitle refs
  const subtitleCuesRef = useRef<SubtitleCue[]>([]);
  const currentCueRef   = useRef("");

  // State-mirror refs to avoid stale closures
  const isPlayingRef      = useRef(true);
  const errorTextRef      = useRef("");
  const settingsOpenRef   = useRef(false);
  const episodeMenuOpenRef= useRef(false);

  // Subtitle tick (hot path — no React on every timeupdate)
  const subtitleTickRef = useRef((t: number) => {
    const cues = subtitleCuesRef.current;
    if (!cues.length) return;
    const cue = findCurrentCue(cues, t);
    const text = cue?.text ?? "";
    if (text !== currentCueRef.current) {
      currentCueRef.current = text;
      setCurrentCue(text);
    }
  });

  // ── HLS quality state ───────────────────────────────────────────────────────
  const [hlsLevels, setHlsLevels] = useState<Array<{ height: number; bitrate: number }>>([]);
  const [selectedHlsLevel, setSelectedHlsLevel] = useState<number>(-1);
  const [hlsAutoQuality, setHlsAutoQuality] = useState(true);

  // ── Source state ────────────────────────────────────────────────────────────
  const [activeSubtitleText, setActiveSubtitleText] = useState(subtitle || "");
  const [activeSearchTitle, setActiveSearchTitle] = useState(subtitleSearchTitle || title);
  const [activeEpisode, setActiveEpisode] = useState<number | null>(currentEpisode ?? null);
  const [runtimeSources, setRuntimeSources] = useState<StreamSource[]>(sources ?? []);
  const [episodeLoading, setEpisodeLoading] = useState(false);

  const effectiveSources = runtimeSources.length > 0 ? runtimeSources : sources;
  const baseSources = useMemo<StreamSource[]>(
    () =>
      effectiveSources && effectiveSources.length > 0
        ? effectiveSources
        : embedUrl
          ? [{ id: "legacy-source", label: "Main", provider: "Custom", kind: "embed" as const, url: embedUrl, description: "Embedded source", quality: "Auto", externalUrl: embedUrl }]
          : [],
    [effectiveSources, embedUrl],
  );

  const extractedSourcesRef = useRef<StreamSource[]>([]);
  const [extractedSources, setExtractedSources] = useState<StreamSource[]>([]);
  const allSources = useMemo(() => [...baseSources, ...extractedSources], [baseSources, extractedSources]);

  useEffect(() => { extractedSourcesRef.current = []; setExtractedSources([]); }, [baseSources]);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [activeIndex, setActiveIndex]           = useState(0);
  const [reloadKey, setReloadKey]               = useState(0);
  const [isLoading, setIsLoading]               = useState(true);
  const [statusText, setStatusText]             = useState("Connecting");
  const [errorText, setErrorText]               = useState("");
  const [fallbackNotice, setFallbackNotice]     = useState("");
  const [resolvedEmbedUrl, setResolvedEmbedUrl] = useState("");
  const [resolvedPlaybackUrl, setResolvedPlaybackUrl] = useState("");
  const [showChrome, setShowChrome]             = useState(true);
  const [episodeMenuOpen, setEpisodeMenuOpen]   = useState(false);
  const [volumeBoost, setVolumeBoost]           = useState(100);
  const [isPlaying, setIsPlaying]               = useState(true);
  const [duration, setDuration]                 = useState(0);
  const [volume, setVolume]                     = useState(1);
  const [isMuted, setIsMuted]                   = useState(false);
  const [subtitleUrl, setSubtitleUrl]           = useState("");
  const [subtitleName, setSubtitleName]         = useState("");
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [showSubtitlePanel, setShowSubtitlePanel] = useState(false);
  const [subtitleCues, setSubtitleCues]         = useState<SubtitleCue[]>([]);
  const [currentCue, setCurrentCue]             = useState("");
  const [activeSourceOptionId, setActiveSourceOptionId] = useState(sourceOptions?.[0]?.id ?? "");
  const [extracting, setExtracting]             = useState(false);
  const [extractError, setExtractError]         = useState("");
  const [playbackSpeed, setPlaybackSpeed]       = useState(1);
  const [, setIsFullscreen]                     = useState(false);
  const [settingsOpen, setSettingsOpen]         = useState(false);
  const [settingsScreen, setSettingsScreen]     = useState<SettingsScreen>("main");
  const [subtitleAppearance, setSubtitleAppearance] = useState<SubtitleAppearanceSettings>(() =>
    sanitizeSubtitleAppearance(
      readJsonStorage<SubtitleAppearanceSettings>("local", SUBTITLE_APPEARANCE_STORAGE_KEY, DEFAULT_SUBTITLE_APPEARANCE),
    ),
  );
  const [subtitlePosition, setSubtitlePosition] = useState<SubtitlePosition>(() =>
    sanitizeSubtitlePosition(
      readJsonStorage<SubtitlePosition>("local", SUBTITLE_POSITION_STORAGE_KEY, DEFAULT_SUBTITLE_POSITION),
    ),
  );
  const [draggingSubtitle, setDraggingSubtitle] = useState(false);
  const subtitleDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{ x: number; time: number; dataUrl: string; visible: boolean } | null>(null);

  // ── Derived values ──────────────────────────────────────────────────────────
  const activeSource     = allSources[activeIndex] ?? null;
  const activeSubtitles  = activeSource?.subtitles ?? [];
  const hasFallback      = activeIndex < allSources.length - 1;
  const isMovieBoxQualityMode = useMemo(
    () => allSources.length > 0 && allSources.every(s => s.provider.toLowerCase().includes("moviebox") || s.provider.toLowerCase().includes("movie box")),
    [allSources],
  );
  const isDirectEngine = useMemo(
    () => activeSource?.kind === "direct" || activeSource?.kind === "hls" || activeSource?.kind === "local",
    [activeSource],
  );
  const isEmbedEngine = useMemo(() => activeSource?.kind === "embed", [activeSource]);
  const isAnimeQualityMode = useMemo(
    () => allSources.length > 1 && allSources.every(s => Boolean(s.quality) && !s.provider.toLowerCase().includes("moviebox")),
    [allSources],
  );
  const hasQualityOptions = useMemo(
    () => hlsLevels.length > 1 || isMovieBoxQualityMode || isAnimeQualityMode,
    [hlsLevels, isMovieBoxQualityMode, isAnimeQualityMode],
  );
  const hasAdaptiveHlsLevels = hlsLevels.length > 1;

  const subtitleStyles = useMemo(() => buildSubtitleStyles(subtitleAppearance), [subtitleAppearance]);

  // ── Persist subtitle appearance / position ──────────────────────────────────
  useEffect(() => { writeJsonStorage("local", SUBTITLE_APPEARANCE_STORAGE_KEY, subtitleAppearance); }, [subtitleAppearance]);
  useEffect(() => { writeJsonStorage("local", SUBTITLE_POSITION_STORAGE_KEY, subtitlePosition); }, [subtitlePosition]);

  // ── Sync incoming props → state ─────────────────────────────────────────────
  useEffect(() => {
    setRuntimeSources(sources ?? []);
    setActiveSubtitleText(subtitle || "");
    setActiveSearchTitle(subtitleSearchTitle || title);
    setActiveEpisode(currentEpisode ?? null);
  }, [sources, subtitle, subtitleSearchTitle, currentEpisode, title]);

  // ── Subtitle drag ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!draggingSubtitle) return;
    const onMove = (event: MouseEvent) => {
      const drag = subtitleDragRef.current;
      if (!drag) return;
      setSubtitlePosition(sanitizeSubtitlePosition({
        x: drag.originX + (event.clientX - drag.startX),
        y: drag.originY + (event.clientY - drag.startY),
      }));
    };
    const onUp = () => { subtitleDragRef.current = null; setDraggingSubtitle(false); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [draggingSubtitle]);

  useEffect(() => { setActiveSourceOptionId(sourceOptions?.[0]?.id ?? ""); }, [sourceOptions]);

  // ── State-mirror refs ───────────────────────────────────────────────────────
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { errorTextRef.current = errorText; }, [errorText]);
  useEffect(() => { settingsOpenRef.current = settingsOpen; }, [settingsOpen]);
  useEffect(() => { episodeMenuOpenRef.current = episodeMenuOpen; }, [episodeMenuOpen]);
  useEffect(() => { subtitleCuesRef.current = subtitleCues; }, [subtitleCues]);

  // ── Chrome visibility ───────────────────────────────────────────────────────
  const showControls = useCallback(() => {
    setShowChrome(true);
    if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current);
    if (errorTextRef.current || settingsOpenRef.current || episodeMenuOpenRef.current) return;
    hideChromeTimeoutRef.current = window.setTimeout(() => {
      if (isPlayingRef.current && !errorTextRef.current) setShowChrome(false);
    }, 3000);
  }, []);

  useEffect(() => { setActiveIndex(0); setHlsLevels([]); setSelectedHlsLevel(-1); setHlsAutoQuality(true); }, [baseSources]);
  useEffect(() => {
    showControls();
    return () => { if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current); };
  }, [episodeMenuOpen, showSubtitlePanel, settingsOpen, showControls]);

  useEffect(() => {
    if (!isPlaying || errorText) {
      setShowChrome(true);
      if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current);
    }
  }, [isPlaying, errorText]);

  useEffect(() => {
    if (!fallbackNotice) return;
    const t = window.setTimeout(() => setFallbackNotice(""), 4000);
    return () => window.clearTimeout(t);
  }, [fallbackNotice]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (settingsOpen) { setSettingsOpen(false); return; } onClose(); }
      if (e.key.toLowerCase() === "r") setReloadKey((k) => k + 1);
      if (e.key === " ") {
        e.preventDefault();
        if (isDirectEngine) {
          const video = videoRef.current;
          if (!video) return;
          if (video.paused) void video.play().catch(() => {}); else video.pause();
        }
      }
      if (e.key === "ArrowRight" && isDirectEngine) {
        const v = videoRef.current; if (v) v.currentTime = Math.min(v.currentTime + 10, duration);
      }
      if (e.key === "ArrowLeft" && isDirectEngine) {
        const v = videoRef.current; if (v) v.currentTime = Math.max(v.currentTime - 10, 0);
      }
      showControls();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handler);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", handler); };
  }, [isDirectEngine, onClose, settingsOpen, duration, showControls]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current);
      if (subtitleUrl.startsWith("blob:")) URL.revokeObjectURL(subtitleUrl);
      if (audioContextRef.current) { void audioContextRef.current.close().catch(() => {}); audioContextRef.current = null; }
    };
  }, [subtitleUrl]);

  // ── Failover logic ──────────────────────────────────────────────────────────
  const findPreparedSiblingIndex = (index: number): number => {
    const candidate = allSources[index];
    if (!candidate || candidate.kind !== "embed") return -1;
    const candidateKey = candidate.externalUrl || candidate.url;
    return allSources.findIndex((s, i) => i > index && s.kind !== "embed" && (s.externalUrl || s.url) === candidateKey);
  };

  const goToNextSource = (reason: string) => {
    const message = failureLabel(reason);
    const currentSourceKey = activeSource ? `${activeIndex}:${activeSource.externalUrl || activeSource.url}` : String(activeIndex);
    const currentRetryCount = sourceRetryCountsRef.current[currentSourceKey] ?? 0;
    const canRetryCurrentSource =
      Boolean(activeSource) &&
      (activeSource.kind === "hls" || activeSource.kind === "direct") &&
      currentRetryCount < 5;

    if (canRetryCurrentSource) {
      sourceRetryCountsRef.current[currentSourceKey] = currentRetryCount + 1;
      setErrorText(""); setIsLoading(true); setIsPlaying(false); setStatusText("Retrying");
      setFallbackNotice(`${message} Retrying stream (${currentRetryCount + 1}/5)...`);
      setReloadKey((k) => k + 1);
      return;
    }
    if (hasFallback) {
      const immediateNextIndex = activeIndex + 1;
      const preparedSiblingIndex = findPreparedSiblingIndex(immediateNextIndex);
      const nextIndex = preparedSiblingIndex >= 0 ? preparedSiblingIndex : immediateNextIndex;
      const nextSource = allSources[nextIndex];
      sourceRetryCountsRef.current[currentSourceKey] = 0;
      setFallbackNotice(`${message} Switched to ${nextSource.label} (${nextSource.provider}).`);
      setActiveIndex(nextIndex); setReloadKey((k) => k + 1);
      return;
    }
    sourceRetryCountsRef.current[currentSourceKey] = 0;
    setErrorText(message); setIsLoading(false); setStatusText("Failed");
  };

  // ── Source setup effect ─────────────────────────────────────────────────────
  useEffect(() => {
    setIsLoading(true); setIsPlaying(false); setErrorText("");
    setStatusText(activeSource ? `Loading ${activeSource.provider}` : "No source");
    setResolvedEmbedUrl(""); setEpisodeMenuOpen(false); setShowSubtitlePanel(false);
    setExtractError(""); embedLoadedRef.current = false;
    setSettingsOpen(false); setSettingsScreen("main"); setHoverPreview(null);

    if (!activeSource) return;
    if (activeSource.kind === "embed") {
      const noticeTimeout = window.setTimeout(() => {
        if (!embedLoadedRef.current) {
          embedLoadedRef.current = true;
          setFallbackNotice("Stream is taking a while and is still connecting. Use the server picker to switch if needed.");
          setIsLoading(false);
        }
      }, 45_000);
      return () => { window.clearTimeout(noticeTimeout); };
    }
    return undefined;
  }, [activeSource, reloadKey]);

  // ── Embed URL resolution ────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeSource || activeSource.kind !== "embed") return;
    let canceled = false;
    resolveEmbedUrl(API, activeSource.url)
      .then((nextUrl) => { if (!canceled) setResolvedEmbedUrl(nextUrl || activeSource.url); })
      .catch(() => { if (!canceled) setResolvedEmbedUrl(activeSource.url); });
    return () => { canceled = true; };
  }, [API, activeSource]);

  useEffect(() => { setResolvedPlaybackUrl(""); }, [activeSource]);

  // ── HLS / Direct playback effect ────────────────────────────────────────────
  useEffect(() => {
    if (!activeSource || !isDirectEngine) return;
    const video = videoRef.current;
    if (!video) return;
    let bufferTimeoutId: number | null = null;
    const clearBufferTimeout = () => { if (bufferTimeoutId !== null) { window.clearTimeout(bufferTimeoutId); bufferTimeoutId = null; } };
    const armBufferTimeout = () => { clearBufferTimeout(); bufferTimeoutId = window.setTimeout(() => { if (!video.paused) goToNextSource("media_error"); }, 12000); };

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    video.pause(); video.removeAttribute("src"); video.load();
    currentTimeRef.current = 0; durationRef.current = 0;
    if (fillRef.current) fillRef.current.style.width = "0%";
    if (thumbRef.current) thumbRef.current.style.left = "0%";
    if (bufferRef.current) bufferRef.current.style.width = "0%";
    if (rangeRef.current) { rangeRef.current.value = "0"; rangeRef.current.max = "0"; }
    if (timeDisplayRef.current) timeDisplayRef.current.textContent = "0:00";
    setDuration(0);

    let sourceReady = false;
    let shouldRestoreAudioAfterStart = false;
    const originalMuted = video.muted;
    const originalVolume = video.volume;
    const startupTimeoutMs = activeSource.kind === "hls" && shouldKeepHlsProxied(activeSource) ? 120_000 : 60_000;
    const startupTimeout = window.setTimeout(() => { if (!sourceReady) goToNextSource("timeout"); }, startupTimeoutMs);
    const markSourceReady = (nextStatus = "Ready") => { sourceReady = true; setIsLoading(false); setStatusText(nextStatus); setErrorText(""); };
    const attemptPlayback = async () => {
      try { await video.play(); }
      catch {
        if (!video.muted) {
          try { shouldRestoreAudioAfterStart = !originalMuted; video.muted = true; video.volume = 0; await video.play(); return; }
          catch { /* fall through */ }
        }
        markSourceReady("Ready");
        setFallbackNotice("Stream is ready. Press play if it does not start automatically.");
      }
    };

    const handleLoadStart = () => { setIsLoading(true); setStatusText("Loading"); setIsPlaying(false); };
    const handleCanPlay = () => markSourceReady("Ready");
    const handleLoadedMetadata = () => {
      const d = video.duration || 0; durationRef.current = d; setDuration(d);
      if (rangeRef.current) rangeRef.current.max = String(d);
    };
    const handleLoadedData = () => markSourceReady("Ready");
    const handleError = () => { sourceReady = true; goToNextSource(activeSource.kind === "local" ? "open_failed" : "media_error"); };
    const handleWaiting = () => { setIsLoading(true); setStatusText("Buffering"); armBufferTimeout(); };
    const handleStalled = () => { setIsLoading(true); setStatusText("Buffering"); armBufferTimeout(); };
    const handlePlaying = () => {
      sourceReady = true; clearBufferTimeout();
      const currentSourceKey = `${activeIndex}:${activeSource.externalUrl || activeSource.url}`;
      sourceRetryCountsRef.current[currentSourceKey] = 0;
      if (shouldRestoreAudioAfterStart) {
        video.muted = originalMuted;
        if (!originalMuted) video.volume = originalVolume || 1;
        shouldRestoreAudioAfterStart = false;
      } else if (video.muted) { video.muted = false; video.volume = 1; }
      setIsLoading(false); setStatusText("Playing"); setIsPlaying(true);
    };
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => {
      const t = video.currentTime;
      const d = durationRef.current || video.duration || 0;
      currentTimeRef.current = t;
      const pct = d > 0 ? Math.min((t / d) * 100, 100) : 0;
      const pctStr = `${pct}%`;
      if (fillRef.current) fillRef.current.style.width = pctStr;
      if (thumbRef.current) thumbRef.current.style.left = pctStr;
      if (rangeRef.current) rangeRef.current.value = String(t);
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = formatTimeLocal(t);
      if (bufferRef.current && video.buffered.length > 0 && d > 0) {
        bufferRef.current.style.width = `${(video.buffered.end(video.buffered.length - 1) / d) * 100}%`;
      }
      subtitleTickRef.current(t);
    };
    const handleDurationChange = () => {
      const d = video.duration || 0; durationRef.current = d; setDuration(d);
      if (rangeRef.current) rangeRef.current.max = String(d);
    };
    const handleVolumeChange = () => { setVolume(video.volume); setIsMuted(video.muted); };

    video.addEventListener("loadstart", handleLoadStart);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("error", handleError);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("stalled", handleStalled);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("pause", handlePause);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("durationchange", handleDurationChange);
    video.addEventListener("volumechange", handleVolumeChange);

    if (activeSource.kind === "hls") {
      const defaultUrl = shouldKeepHlsProxied(activeSource)
        ? buildStreamProxyUrl(API, activeSource.url, activeSource.requestHeaders)
        : activeSource.url;
      const playbackUrl = resolvedPlaybackUrl || defaultUrl;
      if (Hls.isSupported()) {
        const isProxied = shouldKeepHlsProxied(activeSource);
        const hls = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: isProxied ? 20 : 60, maxMaxBufferLength: isProxied ? 60 : 600, backBufferLength: 120, startFragPrefetch: true, abrEwmaFastLive: 3, abrEwmaSlowLive: 9, abrEwmaFastVoD: 3, abrEwmaSlowVoD: 9, manifestLoadingMaxRetry: isProxied ? 1 : 3, manifestLoadingRetryDelay: 1000, fragLoadingMaxRetry: isProxied ? 2 : 4, fragLoadingRetryDelay: 500, levelLoadingMaxRetry: isProxied ? 1 : 3, levelLoadingRetryDelay: 1000 });
        hlsRef.current = hls;
        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, () => { hls.loadSource(playbackUrl); });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (hls.levels.length > 0) {
            setHlsLevels(hls.levels.map(l => ({ height: l.height || 0, bitrate: l.bitrate || 0 })));
            setSelectedHlsLevel(-1); setHlsAutoQuality(true);
            hls.currentLevel = -1; hls.loadLevel = -1; hls.nextLevel = -1;
          }
          setStatusText("Buffering"); void attemptPlayback();
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => { setSelectedHlsLevel(typeof data.level === "number" ? data.level : -1); });
        hls.on(Hls.Events.FRAG_BUFFERED, () => { if (!sourceReady) markSourceReady("Buffering"); });
        hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) goToNextSource("media_error"); });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = playbackUrl; void attemptPlayback();
      } else { goToNextSource("unsupported_source"); }
    } else {
      video.src = activeSource.url; void attemptPlayback();
    }
    return () => {
      clearBufferTimeout(); window.clearTimeout(startupTimeout);
      video.removeEventListener("loadstart", handleLoadStart);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("error", handleError);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("stalled", handleStalled);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("durationchange", handleDurationChange);
      video.removeEventListener("volumechange", handleVolumeChange);
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [activeSource, isDirectEngine, reloadKey, resolvedPlaybackUrl]);

  // ── Thumbnail preview video source ──────────────────────────────────────────
  useEffect(() => {
    if (!isDirectEngine || !activeSource?.url) return;
    const pv = previewVideoRef.current;
    if (!pv) return;
    if (previewHlsRef.current) { previewHlsRef.current.destroy(); previewHlsRef.current = null; }
    if (activeSource.kind === "hls") {
      const url = resolvedPlaybackUrl || (shouldKeepHlsProxied(activeSource) ? buildStreamProxyUrl(API, activeSource.url, activeSource.requestHeaders) : activeSource.url);
      if (Hls.isSupported()) {
        const previewHls = new Hls({ enableWorker: true, lowLatencyMode: false, startFragPrefetch: false, maxBufferLength: 8, maxMaxBufferLength: 16, backBufferLength: 8, manifestLoadingMaxRetry: 1, fragLoadingMaxRetry: 1, levelLoadingMaxRetry: 1 });
        previewHlsRef.current = previewHls;
        previewHls.attachMedia(pv);
        previewHls.on(Hls.Events.MEDIA_ATTACHED, () => { previewHls.loadSource(url); });
      } else { pv.src = url; }
    } else { pv.src = activeSource.url; }
    pv.muted = true; pv.preload = "metadata";
    return () => { if (previewHlsRef.current) { previewHlsRef.current.destroy(); previewHlsRef.current = null; } };
  }, [API, activeSource, isDirectEngine, resolvedPlaybackUrl]);

  // ── Audio boost ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isDirectEngine) return;
    const video = videoRef.current;
    if (!video) return;
    if (volumeBoost === 100) { if (gainNodeRef.current) gainNodeRef.current.gain.value = 1; video.volume = 1; return; }
    if (!audioContextRef.current) {
      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextCtor) {
        try {
          const context = new AudioContextCtor();
          const mediaNode = context.createMediaElementSource(video);
          const gainNode = context.createGain();
          mediaNode.connect(gainNode); gainNode.connect(context.destination);
          audioContextRef.current = context; mediaNodeRef.current = mediaNode; gainNodeRef.current = gainNode;
        } catch { setFallbackNotice("Audio boost is unavailable for this stream, but playback should still work."); setVolumeBoost(100); return; }
      }
    }
    if (gainNodeRef.current) { gainNodeRef.current.gain.value = volumeBoost / 100; video.volume = 1; video.muted = false; void audioContextRef.current?.resume().catch(() => {}); }
  }, [activeSource, isDirectEngine, volumeBoost]);

  // ── Subtitle track management ────────────────────────────────────────────────
  useEffect(() => {
    const trackList = videoRef.current?.textTracks;
    if (!trackList) return;
    for (let i = 0; i < trackList.length; i += 1) {
      trackList[i].mode = subtitleUrl && subtitlesEnabled && i === trackList.length - 1 ? "showing" : "disabled";
    }
  }, [subtitleUrl, subtitlesEnabled, activeSource]);

  useEffect(() => {
    if (subtitleUrl.startsWith("blob:")) URL.revokeObjectURL(subtitleUrl);
    const firstSubtitle = activeSubtitles[0];
    if (firstSubtitle?.url) { setSubtitleUrl(firstSubtitle.url); setSubtitleName(firstSubtitle.label); setSubtitlesEnabled(true); return; }
    currentCueRef.current = "";
    setSubtitleUrl(""); setSubtitleName(""); setSubtitlesEnabled(false); setSubtitleCues([]); setCurrentCue("");
  }, [activeSource]);

  useEffect(() => {
    if (!subtitleUrl || subtitleUrl.startsWith("blob:")) return;
    let cancelled = false;
    const fetchSubtitleContent = async (): Promise<string> => {
      try {
        const directCtrl = new AbortController();
        const directTimer = window.setTimeout(() => directCtrl.abort(), 6000);
        try {
          const res = await fetch(subtitleUrl, { signal: directCtrl.signal });
          if (res.ok) return await res.text();
        } finally { window.clearTimeout(directTimer); }
      } catch { /* CORS or network — fall through to backend proxy */ }
      const proxyUrl = `${API}/subtitles/download?url=${encodeURIComponent(subtitleUrl)}&title=subtitle&language=en&type=anime&source=player&format=vtt`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`Subtitle proxy failed with ${res.status}`);
      return await res.text();
    };
    fetchSubtitleContent()
      .then((content) => {
        if (cancelled) return;
        const cues = parseSubtitleText(content);
        setSubtitleCues(cues);
        if (!cues.length) setFallbackNotice("Subtitles loaded but no cues were found. The file may be empty or use an unsupported format.");
      })
      .catch(() => {
        if (!cancelled) { setSubtitleCues([]); setSubtitlesEnabled(false); setFallbackNotice("Could not load subtitles. The CDN blocked the request. Try a different server or load a local file."); }
      });
    return () => { cancelled = true; };
  }, [subtitleUrl]);

  useEffect(() => {
    if (!subtitleCues.length) { currentCueRef.current = ""; setCurrentCue(""); }
  }, [subtitleCues]);

  useEffect(() => {
    const v = videoRef.current;
    if (v && isDirectEngine) v.playbackRate = playbackSpeed;
  }, [playbackSpeed, isDirectEngine]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSourceSwitch = (index: number) => {
    setIsLoading(true); setIsPlaying(false); setDuration(0);
    const nextSource = allSources[index];
    if (nextSource) sourceRetryCountsRef.current[`${index}:${nextSource.externalUrl || nextSource.url}`] = 0;
    setActiveIndex(index); setErrorText(""); setFallbackNotice("Switching stream..."); setExtractError("");
    setReloadKey((k) => k + 1); setEpisodeMenuOpen(false); setSettingsOpen(false); showControls();
  };

  const updateSubtitleAppearance = <K extends keyof SubtitleAppearanceSettings>(key: K, value: SubtitleAppearanceSettings[K]) => {
    setSubtitleAppearance((current) => sanitizeSubtitleAppearance({ ...current, [key]: value }));
  };
  const resetSubtitleAppearance = () => setSubtitleAppearance(DEFAULT_SUBTITLE_APPEARANCE);
  const resetSubtitlePosition   = () => setSubtitlePosition(DEFAULT_SUBTITLE_POSITION);

  const handleSubtitleDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    subtitleDragRef.current = { startX: event.clientX, startY: event.clientY, originX: subtitlePosition.x, originY: subtitlePosition.y };
    setDraggingSubtitle(true);
  };

  const handleEpisodeSwitch = async (episode: number) => {
    if ((!onSelectEpisode && !onSelectSourceOption) || episodeLoading || episode === activeEpisode) return;
    setEpisodeLoading(true); setIsLoading(true); setIsPlaying(false); setErrorText(""); setFallbackNotice(`Loading ${episodeLabel.toLowerCase()} ${episode}...`);
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
      setActiveSubtitleText(next.subtitle || ""); setActiveSearchTitle(next.subtitleSearchTitle || `${title} ${episodeLabel} ${episode}`);
      setActiveEpisode(episode); setActiveIndex(matchedIndex >= 0 ? matchedIndex : 0);
      setReloadKey((k) => k + 1); setEpisodeMenuOpen(false); setSettingsOpen(false);
    } catch (error) {
      setFallbackNotice(error instanceof Error ? error.message : `Could not load ${episodeLabel.toLowerCase()} ${episode}.`);
    } finally { setEpisodeLoading(false); }
  };

  const handleSourceOptionSwitch = async (optionId: string) => {
    if (!onSelectSourceOption || optionId === activeSourceOptionId) return;
    setEpisodeLoading(true); setIsLoading(true); setIsPlaying(false); setErrorText(""); setFallbackNotice("Switching server...");
    try {
      setActiveSourceOptionId(optionId);
      const targetEpisode = activeEpisode ?? currentEpisode ?? undefined;
      let next: Awaited<ReturnType<NonNullable<Props["onSelectSourceOption"]>>> | undefined;
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        try { next = await onSelectSourceOption(optionId, targetEpisode); break; }
        catch (error) {
          lastError = error;
          if (attempt < 5) await new Promise(r => window.setTimeout(r, 500 * attempt));
        }
      }
      if (!next) throw lastError ?? new Error("Server switch failed.");
      const matchedIndex = next.sources.findIndex(s => s.provider === activeSource?.provider && s.label === activeSource?.label);
      extractedSourcesRef.current = []; setExtractedSources([]); setRuntimeSources(next.sources);
      setActiveSubtitleText(next.subtitle || ""); setActiveSearchTitle(next.subtitleSearchTitle || title);
      setActiveIndex(matchedIndex >= 0 ? matchedIndex : 0); setReloadKey((k) => k + 1); setSettingsOpen(false);
    } catch (error) {
      setFallbackNotice(error instanceof Error ? error.message : "Could not switch server.");
    } finally { setEpisodeLoading(false); }
  };

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video || !isDirectEngine) return;
    if (video.paused) void video.play().catch(() => {}); else video.pause();
    showControls();
  }, [isDirectEngine, showControls]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch { /* ignore */ }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const nextTime = Number(e.target.value);
    video.currentTime = nextTime; currentTimeRef.current = nextTime;
    const d = durationRef.current || video.duration || 0;
    const pct = d > 0 ? Math.min((nextTime / d) * 100, 100) : 0;
    if (fillRef.current) fillRef.current.style.width = `${pct}%`;
    if (thumbRef.current) thumbRef.current.style.left = `${pct}%`;
    if (timeDisplayRef.current) timeDisplayRef.current.textContent = formatTimeLocal(nextTime);
    showControls();
  };

  const onSubtitlePicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (subtitleUrl.startsWith("blob:")) URL.revokeObjectURL(subtitleUrl);
    currentCueRef.current = "";
    setSubtitleUrl(""); setSubtitleName(file.name); setSubtitlesEnabled(true); setSubtitleCues([]); setCurrentCue(""); setShowSubtitlePanel(false);
    void file.text()
      .then((content) => {
        const cues = parseSubtitleText(content);
        setSubtitleCues(cues);
        setFallbackNotice(cues.length > 0 ? `Loaded subtitles: ${file.name}` : `Loaded ${file.name}, but no subtitle cues were found.`);
      })
      .catch(() => { setSubtitleName(""); setSubtitlesEnabled(false); setSubtitleCues([]); setCurrentCue(""); setFallbackNotice(`Could not read subtitle file: ${file.name}`); });
    event.target.value = "";
  };

  const handleSubtitleSelect = (url: string, label: string) => {
    if (subtitleUrl.startsWith("blob:") && subtitleUrl !== url) URL.revokeObjectURL(subtitleUrl);
    setSubtitleUrl(url); setSubtitleName(label); setSubtitlesEnabled(true);
    currentCueRef.current = "";
    setSubtitleCues([]); setCurrentCue(""); setShowSubtitlePanel(false); setFallbackNotice(`Loaded subtitles: ${label}`);
  };

  const clearSubtitles = () => {
    if (subtitleUrl.startsWith("blob:")) URL.revokeObjectURL(subtitleUrl);
    setSubtitleUrl(""); setSubtitleName(""); setSubtitlesEnabled(false);
    currentCueRef.current = "";
    setSubtitleCues([]); setCurrentCue("");
  };

  const toggleSubtitles = () => {
    if (activeSubtitles.length > 0 || subtitleUrl) {
      if (subtitlesEnabled) { clearSubtitles(); return; }
      const firstSubtitle = activeSubtitles[0];
      if (firstSubtitle?.url) {
        if (subtitleUrl.startsWith("blob:") && subtitleUrl !== firstSubtitle.url) URL.revokeObjectURL(subtitleUrl);
        setSubtitleUrl(""); setSubtitleCues([]); setCurrentCue("");
        setTimeout(() => { setSubtitleUrl(firstSubtitle.url); setSubtitleName(firstSubtitle.label); setSubtitlesEnabled(true); }, 0);
      }
      return;
    }
    if (disableSubtitleSearch) return;
    setShowSubtitlePanel((open) => !open);
  };

  const handleSubtitleLoaded = (content: string, label: string) => {
    if (subtitleUrl.startsWith("blob:")) URL.revokeObjectURL(subtitleUrl);
    const cues = parseSubtitleText(content);
    currentCueRef.current = "";
    setSubtitleUrl(""); setSubtitleName(label); setSubtitlesEnabled(true); setSubtitleCues(cues); setCurrentCue("");
    setShowSubtitlePanel(false); setFallbackNotice(`Loaded subtitles: ${label}`);
  };

  const extractDirectStreamUrl = async (targetUrl: string): Promise<{ url: string; quality?: string; format?: string }> => {
    const resolvedUrl = await resolveEmbedUrl(API, targetUrl);
    const cacheKey = `extract:${resolvedUrl}`;
    const cached = readPlaybackCache<{ url: string; quality?: string; format?: string }>(cacheKey);
    if (cached?.url) return cached;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 25000);
    const res = await fetch(`${API}/extract-stream?url=${encodeURIComponent(resolvedUrl)}`, { signal: controller.signal });
    window.clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = (await res.json()) as { url?: string; quality?: string; format?: string };
    if (!data.url) throw new Error("No URL in response");
    const payload = { url: data.url, quality: data.quality, format: data.format };
    writePlaybackCache(cacheKey, payload, EXTRACT_CACHE_TTL_MS);
    return payload;
  };

  const handleExtractStream = async () => {
    if (!activeSource || extracting) return;
    setExtracting(true); setExtractError("");
    try {
      const data = await extractDirectStreamUrl(activeSource.externalUrl || activeSource.url);
      const extracted: StreamSource = { id: `extracted-${Date.now()}`, label: "Direct (Extracted)", provider: activeSource.provider, kind: inferStreamKind(data.url), url: data.url, quality: data.quality ?? "Auto", description: "Extracted direct stream", externalUrl: data.url, canExtract: false };
      extractedSourcesRef.current = [...extractedSourcesRef.current, extracted];
      const newIndex = baseSources.length + extractedSourcesRef.current.length - 1;
      setExtractedSources([...extractedSourcesRef.current]); setActiveIndex(newIndex);
      setReloadKey((k) => k + 1); setSettingsOpen(false);
      setFallbackNotice(`Extracted a direct stream from ${activeSource.provider}. Switched to it.`);
    } catch (err) {
      setExtractError(`Could not extract a direct stream: ${err instanceof Error ? err.message : "Unknown extraction error"}`);
    } finally { setExtracting(false); }
  };

  const prepareInternalSource = async (source: StreamSource, options?: { labelPrefix?: string; notice?: string }): Promise<number> => {
    const sourceKey = source.externalUrl || source.url;
    const existingIndex = extractedSourcesRef.current.findIndex(item => item.externalUrl === sourceKey);
    if (existingIndex >= 0) return baseSources.length + existingIndex;
    const data = await extractDirectStreamUrl(sourceKey);
    if (!data.url) throw new Error("No playable stream was returned.");
    const extracted: StreamSource = { id: `prepared-${Date.now()}`, label: options?.labelPrefix ? `${options.labelPrefix} Direct` : `${source.label} Direct`, provider: source.provider, kind: inferStreamKind(data.url), url: data.url, quality: data.quality ?? source.quality ?? "Auto", description: options?.notice || "Prepared internal stream.", externalUrl: sourceKey, canExtract: false, subtitles: source.subtitles, language: source.language };
    extractedSourcesRef.current = [...extractedSourcesRef.current, extracted];
    setExtractedSources([...extractedSourcesRef.current]);
    return baseSources.length + extractedSourcesRef.current.length - 1;
  };

  useEffect(() => {
    const candidates = baseSources.filter(canPrepareInternalSource).slice(0, 2);
    if (candidates.length === 0) return;
    let cancelled = false;
    const warmFallbacks = async () => {
      for (const source of candidates) {
        if (cancelled) return;
        try { await prepareInternalSource(source, { notice: "Prepared internal failover stream." }); } catch { /* ignore */ }
      }
    };
    void warmFallbacks();
    return () => { cancelled = true; };
  }, [baseSources]);

  const handleDownloadCurrent = async () => {
    if (!activeSource) return;
    if (!onDownload && !onDownloadSource) {
      const directSource = allSources.find(s => s.kind === "direct" || s.kind === "hls") || activeSource;
      try { await queueVideoDownload({ url: directSource.url, title, headers: directSource.requestHeaders, forceHls: directSource.kind === "hls" }); setFallbackNotice("Download queued. Open Downloader to track progress."); }
      catch (err) { setFallbackNotice(err instanceof Error ? err.message : "Could not start download."); }
      return;
    }
    const downloadSource = allSources.find(s => s.kind === "direct" || s.kind === "hls" || s.kind === "local" || Boolean(s.canExtract)) || activeSource;
    try {
      if (downloadSource !== activeSource) setFallbackNotice(`Using ${downloadSource.provider} ${downloadSource.label} for download.`);
      if (downloadSource.kind === "direct" || downloadSource.kind === "hls" || downloadSource.kind === "local") {
        if (onDownloadSource) await onDownloadSource(downloadSource, title);
        else if (onDownload) await onDownload(downloadSource.url, title);
        return;
      }
      if (downloadSource.kind === "embed") {
        const data = await extractDirectStreamUrl(downloadSource.externalUrl || downloadSource.url);
        const extractedSource: StreamSource = { ...downloadSource, kind: inferStreamKind(data.url), url: data.url, externalUrl: downloadSource.externalUrl || downloadSource.url, canExtract: false };
        if (onDownloadSource) await onDownloadSource(extractedSource, title);
        else if (onDownload) await onDownload(data.url, title);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Download could not be started.";
      setFallbackNotice(message); setExtractError(message);
    }
  };

  useEffect(() => {
    if (!activeSource || activeSource.kind !== "embed") return;
    const providerName = activeSource.provider.toLowerCase();
    if (!providerName.includes("moviebox") && !Boolean(activeSource.canExtract)) return;
    const sourceKey = activeSource.externalUrl || activeSource.url;
    const existingPreparedIndex = extractedSourcesRef.current.findIndex(s => s.externalUrl === sourceKey);
    if (existingPreparedIndex >= 0) { setActiveIndex(baseSources.length + existingPreparedIndex); return; }
    if (extractedSourcesRef.current.some(s => s.externalUrl === sourceKey)) return;
    let cancelled = false;
    const prepare = async () => {
      try {
        const data = await extractDirectStreamUrl(activeSource.externalUrl || activeSource.url);
        if (!data.url || cancelled) return;
        const extracted: StreamSource = { id: `auto-extracted-${Date.now()}`, label: `${activeSource.label} Direct`, provider: activeSource.provider, kind: inferStreamKind(data.url), url: data.url, quality: data.quality ?? "Auto", description: "Auto-prepared direct stream", externalUrl: sourceKey, canExtract: false, subtitles: activeSource.subtitles, language: activeSource.language };
        extractedSourcesRef.current = [...extractedSourcesRef.current, extracted];
        setExtractedSources([...extractedSourcesRef.current]);
        const nextIndex = baseSources.length + extractedSourcesRef.current.length - 1;
        setActiveIndex(nextIndex);
        setFallbackNotice(providerName.includes("moviebox") ? "Prepared an internal MovieBox stream so playback, subtitles, and downloads work more reliably." : `Prepared an internal ${activeSource.provider} stream so iframe restrictions do not block playback.`);
      } catch { /* silent */ }
    };
    void prepare();
    return () => { cancelled = true; };
  }, [API, activeSource, baseSources.length]);

  useEffect(() => {
    if (!activeSource || activeSource.kind !== "embed" || volumeBoost <= 100) return;
    const canPrepare = activeSource.provider.toLowerCase().includes("moviebox") || Boolean(activeSource.canExtract);
    if (!canPrepare) { setFallbackNotice("Volume boost is unavailable for this embedded source."); setVolumeBoost(100); return; }
    let cancelled = false;
    setFallbackNotice("Preparing an internal stream so volume boost can be applied...");
    const prepareForBoost = async () => {
      try {
        const nextIndex = await prepareInternalSource(activeSource, { notice: "Prepared internal stream for audio boost." });
        if (cancelled) return;
        setActiveIndex(nextIndex); setReloadKey(v => v + 1); setFallbackNotice("Switched to an internal stream so volume boost can be applied.");
      } catch { if (cancelled) return; setFallbackNotice("Volume boost is unavailable for this embedded source."); setVolumeBoost(100); }
    };
    void prepareForBoost();
    return () => { cancelled = true; };
  }, [activeSource, baseSources.length, volumeBoost]);

  const handleShellClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (showSubtitlePanel && !target.closest("[data-subtitle-panel='true']")) setShowSubtitlePanel(false);
    if (settingsOpen && !target.closest("[data-settings='true']")) { setSettingsOpen(false); setSettingsScreen("main"); }
    if (target.closest("button, input, select, textarea, a")) { showControls(); return; }
    if (target.closest("[data-subtitle-panel='true']")) { showControls(); return; }
    if (target.closest("[data-settings='true']")) { showControls(); return; }
    if (episodeMenuOpen) setEpisodeMenuOpen(false);
    if (isDirectEngine) { togglePlayback(); return; }
    showControls();
  }, [showSubtitlePanel, settingsOpen, episodeMenuOpen, isDirectEngine, showControls, togglePlayback]);

  const handleProgressHover = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    previewHoveringRef.current = true;
    const d = durationRef.current;
    if (!d) return;
    const rect = e.currentTarget.getBoundingClientRect();
    progressBarWidthRef.current = rect.width;
    const ratio = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
    const hoverTime = ratio * d;
    const x = e.clientX - rect.left;
    if (!isDirectEngine) { setHoverPreview({ x, time: hoverTime, dataUrl: "", visible: true }); return; }
    const now = Date.now();
    if (now - previewThrottleRef.current < 150) { setHoverPreview(prev => prev ? { ...prev, x, time: hoverTime } : { x, time: hoverTime, dataUrl: "", visible: true }); return; }
    previewThrottleRef.current = now;
    const pv = previewVideoRef.current;
    const canvas = previewCanvasRef.current;
    if (!pv || !canvas) { setHoverPreview({ x, time: hoverTime, dataUrl: "", visible: true }); return; }
    if (previewSeekedCleanupRef.current) { previewSeekedCleanupRef.current(); previewSeekedCleanupRef.current = null; }
    const drawPreviewFrame = () => {
      if (!previewHoveringRef.current) { pv.removeEventListener("seeked", onSeeked); previewSeekedCleanupRef.current = null; return; }
      try {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = 160; canvas.height = 90;
        ctx.drawImage(pv, 0, 0, 160, 90);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        setHoverPreview({ x, time: hoverTime, dataUrl, visible: true });
      } catch { setHoverPreview({ x, time: hoverTime, dataUrl: "", visible: true }); }
      pv.removeEventListener("seeked", onSeeked); previewSeekedCleanupRef.current = null;
    };
    const onSeeked = () => { drawPreviewFrame(); };
    const seekToHoverTime = () => { try { pv.currentTime = hoverTime; } catch { setHoverPreview({ x, time: hoverTime, dataUrl: "", visible: true }); } };
    if (pv.readyState < 1) {
      const onLoadedMetadata = () => { pv.removeEventListener("loadedmetadata", onLoadedMetadata); seekToHoverTime(); };
      pv.addEventListener("loadedmetadata", onLoadedMetadata, { once: true }); pv.load();
      setHoverPreview({ x, time: hoverTime, dataUrl: "", visible: true });
    } else { seekToHoverTime(); }
    pv.addEventListener("seeked", onSeeked);
    previewSeekedCleanupRef.current = () => pv.removeEventListener("seeked", onSeeked);
  }, [isDirectEngine]);

  const handleProgressLeave = () => {
    previewHoveringRef.current = false;
    if (previewSeekedCleanupRef.current) { previewSeekedCleanupRef.current(); previewSeekedCleanupRef.current = null; }
    setHoverPreview(null);
  };

  // ── Settings helpers ─────────────────────────────────────────────────────────
  const currentQualityLabel = hlsAutoQuality || selectedHlsLevel === -1
    ? "Auto"
    : hlsLevels[selectedHlsLevel]?.height ? `${hlsLevels[selectedHlsLevel].height}p` : "Auto";

  const currentServerLabel = (() => {
    if (sourceOptions && sourceOptions.length > 0)
      return sourceOptions.find(o => o.id === activeSourceOptionId)?.label ?? "Auto";
    return activeSource?.label ?? "Auto";
  })();

  // ── Return everything the JSX needs ─────────────────────────────────────────
  return {
    // Props pass-through (for sub-components that need them)
    title, subtitle: activeSubtitleText, poster, mediaType, disableSubtitleSearch,
    episodeLabel, episodeOptions, sourceOptions, onClose, onDownload, onDownloadSource,
    // Refs
    rootRef, videoRef, hlsRef, subtitleInputRef, previewVideoRef, previewCanvasRef,
    embedLoadedRef, progressBarRef, progressBarWidthRef,
    fillRef, thumbRef, bufferRef, rangeRef, timeDisplayRef,
    // State
    API, allSources, baseSources, activeSource, activeSubtitles, activeIndex,
    activeEpisode, activeSearchTitle, activeSourceOptionId,
    reloadKey, isLoading, statusText, errorText, fallbackNotice,
    resolvedEmbedUrl, resolvedPlaybackUrl, showChrome,
    episodeMenuOpen, setEpisodeMenuOpen,
    volumeBoost, setVolumeBoost,
    isPlaying, duration, volume, isMuted,
    subtitleUrl, subtitleName, subtitlesEnabled, showSubtitlePanel, setShowSubtitlePanel,
    subtitleCues, currentCue, extracting, extractError,
    playbackSpeed, setPlaybackSpeed,
    settingsOpen, setSettingsOpen, settingsScreen, setSettingsScreen,
    subtitleAppearance, subtitlePosition, draggingSubtitle,
    hoverPreview,
    hlsLevels, selectedHlsLevel, setSelectedHlsLevel, hlsAutoQuality, setHlsAutoQuality,
    // Derived
    hasFallback, isDirectEngine, isEmbedEngine,
    isMovieBoxQualityMode, isAnimeQualityMode, hasQualityOptions, hasAdaptiveHlsLevels,
    subtitleStyles,
    currentQualityLabel, currentServerLabel,
    episodeLoading,
    // Handlers
    showControls, handleShellClick, handleProgressHover, handleProgressLeave,
    togglePlayback, toggleFullscreen, handleSeek,
    handleSourceSwitch, handleSourceOptionSwitch, handleEpisodeSwitch,
    handleSubtitleSelect, handleSubtitleLoaded, handleSubtitleDragStart,
    clearSubtitles, toggleSubtitles, onSubtitlePicked,
    updateSubtitleAppearance, resetSubtitleAppearance, resetSubtitlePosition,
    handleExtractStream, handleDownloadCurrent,
    setActiveIndex, setReloadKey, setErrorText,
  };
}

// Inline formatTime to avoid circular import (helpers.ts has no React dep).
function formatTimeLocal(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = Math.floor(value % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Re-export storage key constants so helpers.ts doesn't need React
const SUBTITLE_APPEARANCE_STORAGE_KEY = versionedStorageKey("grabix:subtitle-appearance", "v1");
const SUBTITLE_POSITION_STORAGE_KEY   = versionedStorageKey("grabix:subtitle-position", "v1");
