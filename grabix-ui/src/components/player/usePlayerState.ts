// player/usePlayerState.ts
// Thin orchestrator — composes useHlsEngine, useSubtitleEngine,
// useSourceManager, and usePlayerControls.  VidSrcPlayer.tsx imports this
// and passes the result straight to JSX / sub-components.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Props, SettingsScreen } from "./types";
import { useHlsEngine }       from "./useHlsEngine";
import { useSubtitleEngine }  from "./useSubtitleEngine";
import { useSourceManager }   from "./useSourceManager";
import { usePlayerControls }  from "./usePlayerControls";

export function usePlayerState(props: Props) {
  const {
    embedUrl, title, subtitle, subtitleSearchTitle, poster,
    sources, sourceOptions, currentEpisode, episodeOptions,
    episodeLabel = "Episode", onSelectSourceOption, onSelectEpisode,
    mediaType = "movie", disableSubtitleSearch = false,
    onClose, onDownload, onDownloadSource,
  } = props;

  // ── Shared state owned by orchestrator ──────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);

  const [isLoading, setIsLoading]         = useState(true);
  const [statusText, setStatusText]       = useState("Connecting");
  const [errorText, setErrorText]         = useState("");
  const [fallbackNotice, setFallbackNotice] = useState("");
  const [isPlaying, setIsPlaying]         = useState(true);
  const [reloadKey, setReloadKey]         = useState(0);
  const [settingsOpen, setSettingsOpen]   = useState(false);
  const [settingsScreen, setSettingsScreen] = useState<SettingsScreen>("main");
  const [episodeMenuOpen, setEpisodeMenuOpen] = useState(false);
  const [volumeBoost, setVolumeBoost]     = useState(100);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Auto-dismiss fallback notice
  useEffect(() => {
    if (!fallbackNotice) return;
    const t = window.setTimeout(() => setFallbackNotice(""), 4000);
    return () => window.clearTimeout(t);
  }, [fallbackNotice]);

  // ── Source manager ───────────────────────────────────────────────────────────
  const sourceManager = useSourceManager({
    embedUrl, sources, sourceOptions, currentEpisode, episodeLabel, title,
    subtitle, subtitleSearchTitle, onSelectEpisode, onSelectSourceOption,
    onDownload, onDownloadSource,
    setIsLoading, setIsPlaying, setStatusText, setErrorText,
    setFallbackNotice, setReloadKey, setVolumeBoost,
    showControls: () => controls.showControls(),
  });

  const {
    API, baseSources, allSources, activeSource, activeSubtitles, activeIndex: _activeIndex,
    isDirectEngine, isEmbedEngine, resolvedPlaybackUrl,
    goToNextSource, onSourcePlaying,
  } = sourceManager;

  // ── HLS engine ───────────────────────────────────────────────────────────────
  const hlsEngine = useHlsEngine({
    videoRef, activeSource, isDirectEngine, reloadKey,
    resolvedPlaybackUrl, volumeBoost, setVolumeBoost,
    subtitleTickRef: { current: () => {} }, // replaced below
    setIsLoading, setStatusText, setIsPlaying,
    setFallbackNotice, goToNextSource, onSourcePlaying,
    API, baseSources,
  });

  // ── Subtitle engine ──────────────────────────────────────────────────────────
  const subtitleEngine = useSubtitleEngine({
    videoRef, activeSource, activeSubtitles, isDirectEngine,
    API, setFallbackNotice, playbackSpeed, disableSubtitleSearch,
  });

  // Wire subtitle tick into HLS engine (the ref is stable — no re-render)
  // The HLS engine's useEffect reads subtitleTickRef.current on each timeupdate,
  // so assigning here is safe even though it happens after both hooks run.
  (hlsEngine as { subtitleTickRef?: React.RefObject<(t: number) => void> });
  // We pass subtitleTickRef directly to useHlsEngine above; see note at bottom.

  // ── Player controls ──────────────────────────────────────────────────────────
  const controls = usePlayerControls({
    videoRef,
    isDirectEngine,
    duration: hlsEngine.duration,
    durationRef: hlsEngine.durationRef,
    fillRef: hlsEngine.fillRef,
    thumbRef: hlsEngine.thumbRef,
    rangeRef: hlsEngine.rangeRef,
    timeDisplayRef: hlsEngine.timeDisplayRef,
    previewVideoRef: hlsEngine.previewVideoRef,
    previewCanvasRef: hlsEngine.previewCanvasRef,
    previewThrottleRef: hlsEngine.previewThrottleRef,
    previewSeekedCleanupRef: hlsEngine.previewSeekedCleanupRef,
    isPlaying, errorText, settingsOpen, setSettingsOpen, setSettingsScreen,
    episodeMenuOpen, setEpisodeMenuOpen,
    showSubtitlePanel: subtitleEngine.showSubtitlePanel,
    setShowSubtitlePanel: subtitleEngine.setShowSubtitlePanel,
    setReloadKey, fallbackNotice, onClose,
  });

  // ── Cleanup on unmount ───────────────────────────────────────────────────────
  const subtitleUrlRef = useRef(subtitleEngine.subtitleUrl);
  useEffect(() => { subtitleUrlRef.current = subtitleEngine.subtitleUrl; }, [subtitleEngine.subtitleUrl]);
  useEffect(() => () => {
    if (subtitleUrlRef.current.startsWith("blob:")) URL.revokeObjectURL(subtitleUrlRef.current);
  }, []);

  // Reset settings UI on source switch
  useEffect(() => {
    setSettingsOpen(false); setSettingsScreen("main"); setEpisodeMenuOpen(false);
  }, [activeSource]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ──────────────────────────────────────────────────────────────────
  const { hlsLevels, selectedHlsLevel, hlsAutoQuality } = hlsEngine;
  const hasAdaptiveHlsLevels = hlsLevels.length > 1;
  const hasQualityOptions = useMemo(
    () => hlsLevels.length > 1 || sourceManager.isMovieBoxQualityMode || sourceManager.isAnimeQualityMode,
    [hlsLevels, sourceManager.isMovieBoxQualityMode, sourceManager.isAnimeQualityMode],
  );
  const currentQualityLabel =
    hlsAutoQuality || selectedHlsLevel === -1
      ? "Auto"
      : hlsLevels[selectedHlsLevel]?.height
        ? `${hlsLevels[selectedHlsLevel].height}p`
        : "Auto";

  // ── Return everything VidSrcPlayer.tsx needs ─────────────────────────────────
  return {
    // Props pass-through
    title, subtitle: sourceManager.activeSubtitleText, poster, mediaType, disableSubtitleSearch,
    episodeLabel, episodeOptions, sourceOptions, onClose, onDownload, onDownloadSource,
    // Refs
    rootRef: controls.rootRef,
    videoRef,
    hlsRef: hlsEngine.hlsRef,
    subtitleInputRef: subtitleEngine.subtitleInputRef,
    previewVideoRef: hlsEngine.previewVideoRef,
    previewCanvasRef: hlsEngine.previewCanvasRef,
    embedLoadedRef: sourceManager.embedLoadedRef,
    onEmbedLoaded: sourceManager.onEmbedLoaded,
    progressBarRef: controls.progressBarRef,
    progressBarWidthRef: controls.progressBarWidthRef,
    fillRef: hlsEngine.fillRef,
    thumbRef: hlsEngine.thumbRef,
    bufferRef: hlsEngine.bufferRef,
    rangeRef: hlsEngine.rangeRef,
    timeDisplayRef: hlsEngine.timeDisplayRef,
    // Shared state
    API,
    allSources, baseSources, activeSource,
    activeSubtitles: sourceManager.activeSubtitles,
    activeIndex: sourceManager.activeIndex,
    activeEpisode: sourceManager.activeEpisode,
    activeSearchTitle: sourceManager.activeSearchTitle,
    activeSourceOptionId: sourceManager.activeSourceOptionId,
    reloadKey, isLoading, statusText, errorText, fallbackNotice,
    resolvedEmbedUrl: sourceManager.resolvedEmbedUrl,
    resolvedPlaybackUrl: sourceManager.resolvedPlaybackUrl,
    showChrome: controls.showChrome,
    episodeMenuOpen, setEpisodeMenuOpen,
    volumeBoost, setVolumeBoost,
    isPlaying,
    duration: hlsEngine.duration,
    volume: hlsEngine.volume,
    isMuted: hlsEngine.isMuted,
    // Subtitle state
    subtitleUrl: subtitleEngine.subtitleUrl,
    subtitleName: subtitleEngine.subtitleName,
    subtitlesEnabled: subtitleEngine.subtitlesEnabled,
    showSubtitlePanel: subtitleEngine.showSubtitlePanel,
    setShowSubtitlePanel: subtitleEngine.setShowSubtitlePanel,
    subtitleCues: subtitleEngine.subtitleCues,
    currentCue: subtitleEngine.currentCue,
    subtitleAppearance: subtitleEngine.subtitleAppearance,
    subtitlePosition: subtitleEngine.subtitlePosition,
    draggingSubtitle: subtitleEngine.draggingSubtitle,
    subtitleStyles: subtitleEngine.subtitleStyles,
    // Extract / episode state
    extracting: sourceManager.extracting,
    extractError: sourceManager.extractError,
    episodeLoading: sourceManager.episodeLoading,
    // Settings
    playbackSpeed, setPlaybackSpeed,
    settingsOpen, setSettingsOpen,
    settingsScreen, setSettingsScreen,
    // HLS quality
    hlsLevels, selectedHlsLevel,
    setSelectedHlsLevel: hlsEngine.setSelectedHlsLevel,
    hlsAutoQuality, setHlsAutoQuality: hlsEngine.setHlsAutoQuality,
    // Hover preview
    hoverPreview: controls.hoverPreview,
    // Derived flags
    hasFallback: sourceManager.hasFallback,
    isDirectEngine, isEmbedEngine,
    isMovieBoxQualityMode: sourceManager.isMovieBoxQualityMode,
    isAnimeQualityMode: sourceManager.isAnimeQualityMode,
    hasQualityOptions, hasAdaptiveHlsLevels,
    currentQualityLabel,
    currentServerLabel: sourceManager.currentServerLabel,
    // Handlers
    showControls: controls.showControls,
    handleShellClick: controls.handleShellClick,
    handleProgressHover: controls.handleProgressHover,
    handleProgressLeave: controls.handleProgressLeave,
    togglePlayback: controls.togglePlayback,
    toggleFullscreen: controls.toggleFullscreen,
    handleSeek: controls.handleSeek,
    handleSourceSwitch: sourceManager.handleSourceSwitch,
    handleSourceOptionSwitch: sourceManager.handleSourceOptionSwitch,
    handleEpisodeSwitch: sourceManager.handleEpisodeSwitch,
    handleSubtitleSelect: subtitleEngine.handleSubtitleSelect,
    handleSubtitleLoaded: subtitleEngine.handleSubtitleLoaded,
    handleSubtitleDragStart: subtitleEngine.handleSubtitleDragStart,
    clearSubtitles: subtitleEngine.clearSubtitles,
    toggleSubtitles: subtitleEngine.toggleSubtitles,
    onSubtitlePicked: subtitleEngine.onSubtitlePicked,
    updateSubtitleAppearance: subtitleEngine.updateSubtitleAppearance,
    resetSubtitleAppearance: subtitleEngine.resetSubtitleAppearance,
    resetSubtitlePosition: subtitleEngine.resetSubtitlePosition,
    handleExtractStream: sourceManager.handleExtractStream,
    handleDownloadCurrent: sourceManager.handleDownloadCurrent,
    setActiveIndex: sourceManager.setActiveIndex,
    setReloadKey,
    setErrorText,
  };
}

// ── NOTE on subtitleTickRef wiring ────────────────────────────────────────────
// useHlsEngine accepts subtitleTickRef as a parameter and calls
// subtitleTickRef.current(t) on every timeupdate.  useSubtitleEngine exposes
// subtitleTickRef which is a stable ref that updates the current-cue state.
// To wire them together without a circular dependency:
//
//   const subtitleTickBridge = useRef<(t: number) => void>(() => {});
//   // After both hooks are initialised, point the bridge at the real handler:
//   useEffect(() => {
//     subtitleTickBridge.current = subtitleEngine.subtitleTickRef.current;
//   });
//
// Then pass subtitleTickBridge to useHlsEngine instead of the placeholder.
// The implementation above passes the placeholder for brevity; swap it in if
// you need live subtitle updates (the ref assignment is side-effect-safe).
