// player/useHlsEngine.ts
// HLS.js lifecycle, video event management, audio boost, thumbnail preview HLS.

import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import { buildStreamProxyUrl, shouldKeepHlsProxied } from "./helpers";
import type { StreamSource } from "../../lib/streamProviders";

interface HlsEngineOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  activeSource: StreamSource | null;
  isDirectEngine: boolean;
  reloadKey: number;
  resolvedPlaybackUrl: string;
  volumeBoost: number;
  setVolumeBoost: (v: number) => void;
  subtitleTickRef: React.RefObject<(t: number) => void>;
  setIsLoading: (v: boolean) => void;
  setStatusText: (v: string) => void;
  setIsPlaying: (v: boolean) => void;
  setFallbackNotice: (v: string) => void;
  goToNextSource: (reason: string) => void;
  onSourcePlaying: (sourceUrl: string) => void;
  API: string;
  baseSources: StreamSource[];
}

export function useHlsEngine({
  videoRef, activeSource, isDirectEngine, reloadKey,
  resolvedPlaybackUrl, volumeBoost, setVolumeBoost,
  subtitleTickRef, setIsLoading, setStatusText, setIsPlaying,
  setFallbackNotice, goToNextSource, onSourcePlaying, API, baseSources,
}: HlsEngineOptions) {
  const hlsRef         = useRef<Hls | null>(null);
  const previewHlsRef  = useRef<Hls | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef    = useRef<GainNode | null>(null);
  const mediaNodeRef   = useRef<MediaElementAudioSourceNode | null>(null);
  const previewThrottleRef     = useRef<number>(0);
  const previewSeekedCleanupRef = useRef<(() => void) | null>(null);

  // Direct-DOM refs for progress hot path
  const currentTimeRef  = useRef(0);
  const durationRef     = useRef(0);
  const fillRef         = useRef<HTMLDivElement>(null);
  const thumbRef        = useRef<HTMLDivElement>(null);
  const bufferRef       = useRef<HTMLDivElement>(null);
  const rangeRef        = useRef<HTMLInputElement>(null);
  const timeDisplayRef  = useRef<HTMLSpanElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const [hlsLevels, setHlsLevels]               = useState<Array<{ height: number; bitrate: number }>>([]);
  const [selectedHlsLevel, setSelectedHlsLevel] = useState<number>(-1);
  const [hlsAutoQuality, setHlsAutoQuality]     = useState(true);
  const [duration, setDuration]                 = useState(0);
  const [volume, setVolume]                     = useState(1);
  const [isMuted, setIsMuted]                   = useState(false);

  // Reset HLS levels when source list changes
  useEffect(() => {
    setHlsLevels([]); setSelectedHlsLevel(-1); setHlsAutoQuality(true);
  }, [baseSources]);

  // ── Main HLS / Direct playback ─────────────────────────────────────────────
  useEffect(() => {
    if (!activeSource || !isDirectEngine) return;
    const video = videoRef.current;
    if (!video) return;

    let bufTimeoutId: number | null = null;
    const clearBufTimeout = () => { if (bufTimeoutId !== null) { window.clearTimeout(bufTimeoutId); bufTimeoutId = null; } };
    const armBufTimeout   = () => { clearBufTimeout(); bufTimeoutId = window.setTimeout(() => { if (!video.paused) goToNextSource("media_error"); }, 12000); };

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    video.pause(); video.removeAttribute("src"); video.load();
    currentTimeRef.current = 0; durationRef.current = 0;
    if (fillRef.current)    fillRef.current.style.width = "0%";
    if (thumbRef.current)   thumbRef.current.style.left = "0%";
    if (bufferRef.current)  bufferRef.current.style.width = "0%";
    if (rangeRef.current)  { rangeRef.current.value = "0"; rangeRef.current.max = "0"; }
    if (timeDisplayRef.current) timeDisplayRef.current.textContent = "0:00";
    setDuration(0);

    let sourceReady = false;
    let restoreAudio = false;
    const origMuted  = video.muted;
    const origVolume = video.volume;
    const startupMs  = activeSource.kind === "hls" && shouldKeepHlsProxied(activeSource) ? 120_000 : 60_000;
    const startupTimer = window.setTimeout(() => { if (!sourceReady) goToNextSource("timeout"); }, startupMs);

    const markReady = (status = "Ready") => { sourceReady = true; setIsLoading(false); setStatusText(status); };
    const tryPlay = async () => {
      try { await video.play(); }
      catch {
        if (!video.muted) {
          try { restoreAudio = !origMuted; video.muted = true; video.volume = 0; await video.play(); return; } catch { /* fall through */ }
        }
        markReady(); setFallbackNotice("Stream is ready. Press play if it does not start automatically.");
      }
    };

    const onLoadStart    = () => { setIsLoading(true); setStatusText("Loading"); setIsPlaying(false); };
    const onCanPlay      = () => markReady();
    const onMetadata     = () => { const d = video.duration || 0; durationRef.current = d; setDuration(d); if (rangeRef.current) rangeRef.current.max = String(d); };
    const onLoadedData   = () => markReady();
    const onError        = () => { sourceReady = true; goToNextSource(activeSource.kind === "local" ? "open_failed" : "media_error"); };
    const onWaiting      = () => { setIsLoading(true); setStatusText("Buffering"); armBufTimeout(); };
    const onStalled      = () => { setIsLoading(true); setStatusText("Buffering"); armBufTimeout(); };
    const onPlaying      = () => {
      sourceReady = true; clearBufTimeout();
      onSourcePlaying(activeSource.externalUrl || activeSource.url);
      if (restoreAudio) { video.muted = origMuted; if (!origMuted) video.volume = origVolume || 1; restoreAudio = false; }
      else if (video.muted) { video.muted = false; video.volume = 1; }
      setIsLoading(false); setStatusText("Playing"); setIsPlaying(true);
    };
    const onPause        = () => setIsPlaying(false);
    const onTimeUpdate   = () => {
      const t = video.currentTime;
      const d = durationRef.current || video.duration || 0;
      currentTimeRef.current = t;
      const pct = d > 0 ? Math.min((t / d) * 100, 100) : 0;
      if (fillRef.current)       fillRef.current.style.width = `${pct}%`;
      if (thumbRef.current)      thumbRef.current.style.left = `${pct}%`;
      if (rangeRef.current)      rangeRef.current.value = String(t);
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = formatTimeLocal(t);
      if (bufferRef.current && video.buffered.length > 0 && d > 0)
        bufferRef.current.style.width = `${(video.buffered.end(video.buffered.length - 1) / d) * 100}%`;
      subtitleTickRef.current?.(t);
    };
    const onDurationChange = () => { const d = video.duration || 0; durationRef.current = d; setDuration(d); if (rangeRef.current) rangeRef.current.max = String(d); };
    const onVolumeChange   = () => { setVolume(video.volume); setIsMuted(video.muted); };

    const events: [string, EventListener][] = [
      ["loadstart", onLoadStart as EventListener], ["canplay", onCanPlay as EventListener],
      ["loadedmetadata", onMetadata as EventListener], ["loadeddata", onLoadedData as EventListener],
      ["error", onError as EventListener], ["waiting", onWaiting as EventListener],
      ["stalled", onStalled as EventListener], ["playing", onPlaying as EventListener],
      ["pause", onPause as EventListener], ["timeupdate", onTimeUpdate as EventListener],
      ["durationchange", onDurationChange as EventListener], ["volumechange", onVolumeChange as EventListener],
    ];
    events.forEach(([ev, fn]) => video.addEventListener(ev, fn));

    if (activeSource.kind === "hls") {
      const defaultUrl = shouldKeepHlsProxied(activeSource)
        ? buildStreamProxyUrl(API, activeSource.url, activeSource.requestHeaders)
        : activeSource.url;
      const playbackUrl = resolvedPlaybackUrl || defaultUrl;
      if (Hls.isSupported()) {
        const proxied = shouldKeepHlsProxied(activeSource);
        const hls = new Hls({
          enableWorker: true, lowLatencyMode: false,
          maxBufferLength: proxied ? 20 : 60, maxMaxBufferLength: proxied ? 60 : 600,
          backBufferLength: 120, startFragPrefetch: true,
          abrEwmaFastLive: 3, abrEwmaSlowLive: 9, abrEwmaFastVoD: 3, abrEwmaSlowVoD: 9,
          manifestLoadingMaxRetry: proxied ? 1 : 3, manifestLoadingRetryDelay: 1000,
          fragLoadingMaxRetry: proxied ? 2 : 4, fragLoadingRetryDelay: 500,
          levelLoadingMaxRetry: proxied ? 1 : 3, levelLoadingRetryDelay: 1000,
        });
        hlsRef.current = hls;
        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(playbackUrl));
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (hls.levels.length > 0) {
            setHlsLevels(hls.levels.map(l => ({ height: l.height || 0, bitrate: l.bitrate || 0 })));
            setSelectedHlsLevel(-1); setHlsAutoQuality(true);
            hls.currentLevel = -1; hls.loadLevel = -1; hls.nextLevel = -1;
          }
          setStatusText("Buffering"); void tryPlay();
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_, d) => setSelectedHlsLevel(typeof d.level === "number" ? d.level : -1));
        hls.on(Hls.Events.FRAG_BUFFERED, () => { if (!sourceReady) markReady("Buffering"); });
        hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) goToNextSource("media_error"); });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = playbackUrl; void tryPlay();
      } else { goToNextSource("unsupported_source"); }
    } else {
      video.src = activeSource.url; void tryPlay();
    }

    return () => {
      clearBufTimeout(); window.clearTimeout(startupTimer);
      events.forEach(([ev, fn]) => video.removeEventListener(ev, fn));
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [activeSource, isDirectEngine, reloadKey, resolvedPlaybackUrl]); // eslint-disable-line

  // ── Thumbnail preview HLS ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isDirectEngine || !activeSource?.url) return;
    const pv = previewVideoRef.current;
    if (!pv) return;
    if (previewHlsRef.current) { previewHlsRef.current.destroy(); previewHlsRef.current = null; }
    if (activeSource.kind === "hls") {
      const url = resolvedPlaybackUrl || (shouldKeepHlsProxied(activeSource)
        ? buildStreamProxyUrl(API, activeSource.url, activeSource.requestHeaders)
        : activeSource.url);
      if (Hls.isSupported()) {
        const ph = new Hls({ enableWorker: true, lowLatencyMode: false, startFragPrefetch: false, maxBufferLength: 8, maxMaxBufferLength: 16, backBufferLength: 8, manifestLoadingMaxRetry: 1, fragLoadingMaxRetry: 1, levelLoadingMaxRetry: 1 });
        previewHlsRef.current = ph;
        ph.attachMedia(pv);
        ph.on(Hls.Events.MEDIA_ATTACHED, () => ph.loadSource(url));
      } else { pv.src = url; }
    } else { pv.src = activeSource.url; }
    pv.muted = true; pv.preload = "metadata";
    return () => { if (previewHlsRef.current) { previewHlsRef.current.destroy(); previewHlsRef.current = null; } };
  }, [API, activeSource, isDirectEngine, resolvedPlaybackUrl]);

  // ── Audio boost ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isDirectEngine) return;
    const video = videoRef.current;
    if (!video) return;
    if (volumeBoost === 100) { if (gainNodeRef.current) gainNodeRef.current.gain.value = 1; video.volume = 1; return; }
    if (!audioContextRef.current) {
      const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        try {
          const ctx = new Ctor();
          const mediaNode = ctx.createMediaElementSource(video);
          const gain = ctx.createGain();
          mediaNode.connect(gain); gain.connect(ctx.destination);
          audioContextRef.current = ctx; mediaNodeRef.current = mediaNode; gainNodeRef.current = gain;
        } catch { setFallbackNotice("Audio boost is unavailable for this stream, but playback should still work."); setVolumeBoost(100); return; }
      }
    }
    if (gainNodeRef.current) { gainNodeRef.current.gain.value = volumeBoost / 100; video.volume = 1; video.muted = false; void audioContextRef.current?.resume().catch(() => {}); }
  }, [activeSource, isDirectEngine, volumeBoost, videoRef, setFallbackNotice, setVolumeBoost]);

  return {
    hlsRef, previewVideoRef, previewCanvasRef, previewThrottleRef, previewSeekedCleanupRef,
    fillRef, thumbRef, bufferRef, rangeRef, timeDisplayRef, currentTimeRef, durationRef,
    hlsLevels, selectedHlsLevel, setSelectedHlsLevel,
    hlsAutoQuality, setHlsAutoQuality,
    duration, volume, isMuted,
  };
}

function formatTimeLocal(v: number): string {
  if (!Number.isFinite(v) || v < 0) return "0:00";
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const s = Math.floor(v % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
