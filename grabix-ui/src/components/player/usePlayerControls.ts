// player/usePlayerControls.ts
// Chrome visibility, play/pause, seek, fullscreen, keyboard shortcuts, progress hover.

import { useCallback, useEffect, useRef, useState } from "react";
import type { SettingsScreen } from "./types";

interface PlayerControlsOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isDirectEngine: boolean;
  duration: number;
  durationRef: React.RefObject<number>;
  fillRef: React.RefObject<HTMLDivElement | null>;
  thumbRef: React.RefObject<HTMLDivElement | null>;
  rangeRef: React.RefObject<HTMLInputElement | null>;
  timeDisplayRef: React.RefObject<HTMLSpanElement | null>;
  previewVideoRef: React.RefObject<HTMLVideoElement | null>;
  previewCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  previewThrottleRef: React.RefObject<number>;
  previewSeekedCleanupRef: React.RefObject<(() => void) | null>;
  isPlaying: boolean;
  errorText: string;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  setSettingsScreen: (v: SettingsScreen) => void;
  episodeMenuOpen: boolean;
  setEpisodeMenuOpen: (v: boolean) => void;
  showSubtitlePanel: boolean;
  setShowSubtitlePanel: (v: boolean) => void;
  setReloadKey: React.Dispatch<React.SetStateAction<number>>;
  fallbackNotice: string;
  onClose: () => void;
}

export function usePlayerControls({
  videoRef, isDirectEngine, duration, durationRef,
  fillRef, thumbRef, rangeRef: _rangeRef, timeDisplayRef,
  previewVideoRef, previewCanvasRef, previewThrottleRef, previewSeekedCleanupRef,
  isPlaying, errorText, settingsOpen, setSettingsOpen, setSettingsScreen,
  episodeMenuOpen, setEpisodeMenuOpen, showSubtitlePanel, setShowSubtitlePanel,
  setReloadKey, fallbackNotice, onClose,
}: PlayerControlsOptions) {
  const rootRef            = useRef<HTMLDivElement>(null);
  const progressBarRef     = useRef<HTMLDivElement>(null);
  const progressBarWidthRef = useRef(0);
  const hideChromeTimeoutRef = useRef<number | null>(null);
  const previewHoveringRef = useRef(false);

  // State-mirror refs (avoid stale closures in callbacks)
  const isPlayingRef       = useRef(isPlaying);
  const errorTextRef       = useRef(errorText);
  const settingsOpenRef    = useRef(settingsOpen);
  const episodeMenuOpenRef = useRef(episodeMenuOpen);

  const [showChrome, setShowChrome]   = useState(true);
  const [, setIsFullscreen]           = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{ x: number; time: number; dataUrl: string; visible: boolean } | null>(null);

  // Keep mirror refs fresh
  useEffect(() => { isPlayingRef.current = isPlaying; },         [isPlaying]);
  useEffect(() => { errorTextRef.current = errorText; },         [errorText]);
  useEffect(() => { settingsOpenRef.current = settingsOpen; },   [settingsOpen]);
  useEffect(() => { episodeMenuOpenRef.current = episodeMenuOpen; }, [episodeMenuOpen]);

  // ── Chrome visibility ────────────────────────────────────────────────────────
  const showControls = useCallback(() => {
    setShowChrome(true);
    if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current);
    if (errorTextRef.current || settingsOpenRef.current || episodeMenuOpenRef.current) return;
    hideChromeTimeoutRef.current = window.setTimeout(() => {
      if (isPlayingRef.current && !errorTextRef.current) setShowChrome(false);
    }, 3000);
  }, []);

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
    const t = window.setTimeout(() => {/* orchestrator owns setFallbackNotice */}, 4000);
    return () => window.clearTimeout(t);
  }, [fallbackNotice]);

  // Fullscreen listener
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (settingsOpen) { setSettingsOpen(false); return; }
        onClose();
      }
      if (e.key.toLowerCase() === "r") setReloadKey((k) => k + 1);
      if (e.key === " ") {
        e.preventDefault();
        if (isDirectEngine) {
          const v = videoRef.current;
          if (!v) return;
          if (v.paused) void v.play().catch(() => {}); else v.pause();
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
    return () => { document.body.style.overflow = prevOverflow; window.removeEventListener("keydown", handler); };
  }, [isDirectEngine, onClose, settingsOpen, duration, showControls, setSettingsOpen, setReloadKey, videoRef]);

  // ── Playback controls ────────────────────────────────────────────────────────
  const togglePlayback = useCallback(() => {
    const v = videoRef.current;
    if (!v || !isDirectEngine) return;
    if (v.paused) void v.play().catch(() => {}); else v.pause();
    showControls();
  }, [isDirectEngine, showControls, videoRef]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch { /* ignore */ }
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const t = Number(e.target.value);
    v.currentTime = t;
    const d = durationRef.current || v.duration || 0;
    const pct = d > 0 ? Math.min((t / d) * 100, 100) : 0;
    if (fillRef.current)       fillRef.current.style.width  = `${pct}%`;
    if (thumbRef.current)      thumbRef.current.style.left  = `${pct}%`;
    if (timeDisplayRef.current) timeDisplayRef.current.textContent = formatTimeLocal(t);
    showControls();
  }, [videoRef, durationRef, fillRef, thumbRef, timeDisplayRef, showControls]);

  // ── Shell click ──────────────────────────────────────────────────────────────
  const handleShellClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (showSubtitlePanel && !target.closest("[data-subtitle-panel='true']")) setShowSubtitlePanel(false);
    if (settingsOpen && !target.closest("[data-settings='true']")) { setSettingsOpen(false); setSettingsScreen("main"); }
    if (target.closest("button, input, select, textarea, a")) { showControls(); return; }
    if (target.closest("[data-subtitle-panel='true']")) { showControls(); return; }
    if (target.closest("[data-settings='true']")) { showControls(); return; }
    if (episodeMenuOpen) setEpisodeMenuOpen(false);
    if (isDirectEngine) { togglePlayback(); return; }
    showControls();
  }, [showSubtitlePanel, settingsOpen, episodeMenuOpen, isDirectEngine,
      setShowSubtitlePanel, setSettingsOpen, setSettingsScreen, setEpisodeMenuOpen,
      showControls, togglePlayback]);

  // ── Progress hover / thumbnail preview ───────────────────────────────────────
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
    if (now - previewThrottleRef.current < 150) {
      setHoverPreview(prev => prev ? { ...prev, x, time: hoverTime } : { x, time: hoverTime, dataUrl: "", visible: true });
      return;
    }
    previewThrottleRef.current = now;
    const pv = previewVideoRef.current;
    const canvas = previewCanvasRef.current;
    if (!pv || !canvas) { setHoverPreview({ x, time: hoverTime, dataUrl: "", visible: true }); return; }
    if (previewSeekedCleanupRef.current) { previewSeekedCleanupRef.current(); (previewSeekedCleanupRef as React.MutableRefObject<(() => void) | null>).current = null; }
    const drawFrame = () => {
      if (!previewHoveringRef.current) { pv.removeEventListener("seeked", onSeeked); return; }
      try {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = 160; canvas.height = 90;
        ctx.drawImage(pv, 0, 0, 160, 90);
        setHoverPreview({ x, time: hoverTime, dataUrl: canvas.toDataURL("image/jpeg", 0.7), visible: true });
      } catch { setHoverPreview({ x, time: hoverTime, dataUrl: "", visible: true }); }
      pv.removeEventListener("seeked", onSeeked);
      (previewSeekedCleanupRef as React.MutableRefObject<(() => void) | null>).current = null;
    };
    const onSeeked = () => drawFrame();
    const seek = () => { try { pv.currentTime = hoverTime; } catch { setHoverPreview({ x, time: hoverTime, dataUrl: "", visible: true }); } };
    if (pv.readyState < 1) {
      pv.addEventListener("loadedmetadata", () => seek(), { once: true });
      pv.load();
      setHoverPreview({ x, time: hoverTime, dataUrl: "", visible: true });
    } else { seek(); }
    pv.addEventListener("seeked", onSeeked);
    (previewSeekedCleanupRef as React.MutableRefObject<(() => void) | null>).current = () => pv.removeEventListener("seeked", onSeeked);
  }, [isDirectEngine, durationRef, previewVideoRef, previewCanvasRef, previewThrottleRef, previewSeekedCleanupRef]);

  const handleProgressLeave = useCallback(() => {
    previewHoveringRef.current = false;
    if (previewSeekedCleanupRef.current) {
      previewSeekedCleanupRef.current();
      (previewSeekedCleanupRef as React.MutableRefObject<(() => void) | null>).current = null;
    }
    setHoverPreview(null);
  }, [previewSeekedCleanupRef]);

  return {
    rootRef, progressBarRef, progressBarWidthRef,
    showChrome, hoverPreview,
    showControls, togglePlayback, toggleFullscreen,
    handleSeek, handleShellClick, handleProgressHover, handleProgressLeave,
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
