// player/useSubtitleEngine.ts
// Subtitle loading, VTT parsing, cue tracking, appearance settings, subtitle drag.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { versionedStorageKey, readJsonStorage, writeJsonStorage } from "../../lib/persistentState";
import type { StreamSource } from "../../lib/streamProviders";
import type { SubtitleAppearanceSettings, SubtitleCue, SubtitlePosition } from "./types";
import {
  DEFAULT_SUBTITLE_APPEARANCE, DEFAULT_SUBTITLE_POSITION,
  buildSubtitleStyles, findCurrentCue, parseSubtitleText,
  sanitizeSubtitleAppearance, sanitizeSubtitlePosition,
} from "./helpers";

export const SUBTITLE_APPEARANCE_STORAGE_KEY = versionedStorageKey("grabix:subtitle-appearance", "v1");
export const SUBTITLE_POSITION_STORAGE_KEY   = versionedStorageKey("grabix:subtitle-position", "v1");

interface SubtitleEngineOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  activeSource: StreamSource | null;
  activeSubtitles: Array<{ url: string; label: string }>;
  isDirectEngine: boolean;
  API: string;
  setFallbackNotice: (v: string) => void;
  playbackSpeed: number;
  disableSubtitleSearch: boolean;
}

export function useSubtitleEngine({
  videoRef, activeSource, activeSubtitles, isDirectEngine,
  API, setFallbackNotice, playbackSpeed, disableSubtitleSearch,
}: SubtitleEngineOptions) {
  const subtitleInputRef  = useRef<HTMLInputElement>(null);
  const subtitleCuesRef   = useRef<SubtitleCue[]>([]);
  const currentCueRef     = useRef("");
  const subtitleDragRef   = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  // Subtitle tick — used by HLS engine's timeupdate (hot path, no React render)
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

  const [subtitleUrl, setSubtitleUrl]             = useState("");
  const [subtitleName, setSubtitleName]           = useState("");
  const [subtitlesEnabled, setSubtitlesEnabled]   = useState(true);
  const [showSubtitlePanel, setShowSubtitlePanel] = useState(false);
  const [subtitleCues, setSubtitleCues]           = useState<SubtitleCue[]>([]);
  const [currentCue, setCurrentCue]               = useState("");
  const [draggingSubtitle, setDraggingSubtitle]   = useState(false);

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

  const subtitleStyles = useMemo(() => buildSubtitleStyles(subtitleAppearance), [subtitleAppearance]);

  // Persist appearance / position
  useEffect(() => { writeJsonStorage("local", SUBTITLE_APPEARANCE_STORAGE_KEY, subtitleAppearance); }, [subtitleAppearance]);
  useEffect(() => { writeJsonStorage("local", SUBTITLE_POSITION_STORAGE_KEY, subtitlePosition); }, [subtitlePosition]);

  // Sync cues ref to state
  useEffect(() => { subtitleCuesRef.current = subtitleCues; }, [subtitleCues]);

  // Playback speed
  useEffect(() => {
    const v = videoRef.current;
    if (v && isDirectEngine) v.playbackRate = playbackSpeed;
  }, [playbackSpeed, isDirectEngine, videoRef]);

  // Reset subtitles when source changes
  useEffect(() => {
    if (subtitleUrl.startsWith("blob:")) URL.revokeObjectURL(subtitleUrl);
    const first = activeSubtitles[0];
    if (first?.url) {
      setSubtitleUrl(first.url); setSubtitleName(first.label); setSubtitlesEnabled(true);
      return;
    }
    currentCueRef.current = "";
    setSubtitleUrl(""); setSubtitleName(""); setSubtitlesEnabled(false);
    setSubtitleCues([]); setCurrentCue("");
  }, [activeSource]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync <track> modes
  useEffect(() => {
    const trackList = videoRef.current?.textTracks;
    if (!trackList) return;
    for (let i = 0; i < trackList.length; i += 1) {
      trackList[i].mode = subtitleUrl && subtitlesEnabled && i === trackList.length - 1 ? "showing" : "disabled";
    }
  }, [subtitleUrl, subtitlesEnabled, activeSource, videoRef]);

  // Fetch and parse subtitle file
  useEffect(() => {
    if (!subtitleUrl || subtitleUrl.startsWith("blob:")) return;
    let cancelled = false;
    const fetchSubtitleContent = async (): Promise<string> => {
      try {
        const ctrl = new AbortController();
        const timer = window.setTimeout(() => ctrl.abort(), 6000);
        try {
          const res = await fetch(subtitleUrl, { signal: ctrl.signal });
          if (res.ok) return await res.text();
        } finally { window.clearTimeout(timer); }
      } catch { /* CORS — fall through to proxy */ }
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
        if (!cancelled) {
          setSubtitleCues([]); setSubtitlesEnabled(false);
          setFallbackNotice("Could not load subtitles. The CDN blocked the request. Try a different server or load a local file.");
        }
      });
    return () => { cancelled = true; };
  }, [subtitleUrl, API, setFallbackNotice]);

  useEffect(() => {
    if (!subtitleCues.length) { currentCueRef.current = ""; setCurrentCue(""); }
  }, [subtitleCues]);

  // Subtitle drag
  useEffect(() => {
    if (!draggingSubtitle) return;
    const onMove = (e: MouseEvent) => {
      const drag = subtitleDragRef.current;
      if (!drag) return;
      setSubtitlePosition(sanitizeSubtitlePosition({ x: drag.originX + (e.clientX - drag.startX), y: drag.originY + (e.clientY - drag.startY) }));
    };
    const onUp = () => { subtitleDragRef.current = null; setDraggingSubtitle(false); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [draggingSubtitle]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const clearSubtitles = useCallback(() => {
    if (subtitleUrl.startsWith("blob:")) URL.revokeObjectURL(subtitleUrl);
    setSubtitleUrl(""); setSubtitleName(""); setSubtitlesEnabled(false);
    currentCueRef.current = ""; setSubtitleCues([]); setCurrentCue("");
  }, [subtitleUrl]);

  const handleSubtitleSelect = useCallback((url: string, label: string) => {
    if (subtitleUrl.startsWith("blob:") && subtitleUrl !== url) URL.revokeObjectURL(subtitleUrl);
    setSubtitleUrl(url); setSubtitleName(label); setSubtitlesEnabled(true);
    currentCueRef.current = ""; setSubtitleCues([]); setCurrentCue("");
    setShowSubtitlePanel(false); setFallbackNotice(`Loaded subtitles: ${label}`);
  }, [subtitleUrl, setFallbackNotice]);

  const handleSubtitleLoaded = useCallback((content: string, label: string) => {
    if (subtitleUrl.startsWith("blob:")) URL.revokeObjectURL(subtitleUrl);
    const cues = parseSubtitleText(content);
    currentCueRef.current = "";
    setSubtitleUrl(""); setSubtitleName(label); setSubtitlesEnabled(true);
    setSubtitleCues(cues); setCurrentCue(""); setShowSubtitlePanel(false);
    setFallbackNotice(`Loaded subtitles: ${label}`);
  }, [subtitleUrl, setFallbackNotice]);

  const onSubtitlePicked = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (subtitleUrl.startsWith("blob:")) URL.revokeObjectURL(subtitleUrl);
    currentCueRef.current = "";
    setSubtitleUrl(""); setSubtitleName(file.name); setSubtitlesEnabled(true);
    setSubtitleCues([]); setCurrentCue(""); setShowSubtitlePanel(false);
    void file.text()
      .then((content) => {
        const cues = parseSubtitleText(content);
        setSubtitleCues(cues);
        setFallbackNotice(cues.length > 0 ? `Loaded subtitles: ${file.name}` : `Loaded ${file.name}, but no subtitle cues were found.`);
      })
      .catch(() => { setSubtitleName(""); setSubtitlesEnabled(false); setSubtitleCues([]); setCurrentCue(""); setFallbackNotice(`Could not read subtitle file: ${file.name}`); });
    e.target.value = "";
  }, [subtitleUrl, setFallbackNotice]);

  const toggleSubtitles = useCallback(() => {
    if (activeSubtitles.length > 0 || subtitleUrl) {
      if (subtitlesEnabled) { clearSubtitles(); return; }
      const first = activeSubtitles[0];
      if (first?.url) {
        if (subtitleUrl.startsWith("blob:") && subtitleUrl !== first.url) URL.revokeObjectURL(subtitleUrl);
        setSubtitleUrl(""); setSubtitleCues([]); setCurrentCue("");
        setTimeout(() => { setSubtitleUrl(first.url); setSubtitleName(first.label); setSubtitlesEnabled(true); }, 0);
      }
      return;
    }
    if (disableSubtitleSearch) return;
    setShowSubtitlePanel((open) => !open);
  }, [activeSubtitles, subtitleUrl, subtitlesEnabled, clearSubtitles, disableSubtitleSearch]);

  const updateSubtitleAppearance = useCallback(<K extends keyof SubtitleAppearanceSettings>(key: K, value: SubtitleAppearanceSettings[K]) => {
    setSubtitleAppearance((cur) => sanitizeSubtitleAppearance({ ...cur, [key]: value }));
  }, []);
  const resetSubtitleAppearance = useCallback(() => setSubtitleAppearance(DEFAULT_SUBTITLE_APPEARANCE), []);
  const resetSubtitlePosition   = useCallback(() => setSubtitlePosition(DEFAULT_SUBTITLE_POSITION), []);
  const handleSubtitleDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    subtitleDragRef.current = { startX: e.clientX, startY: e.clientY, originX: subtitlePosition.x, originY: subtitlePosition.y };
    setDraggingSubtitle(true);
  }, [subtitlePosition]);

  return {
    subtitleInputRef, subtitleTickRef,
    subtitleUrl, subtitleName, subtitlesEnabled, showSubtitlePanel, setShowSubtitlePanel,
    subtitleCues, currentCue, subtitleAppearance, subtitlePosition, draggingSubtitle,
    subtitleStyles,
    clearSubtitles, handleSubtitleSelect, handleSubtitleLoaded, onSubtitlePicked,
    toggleSubtitles, updateSubtitleAppearance, resetSubtitleAppearance, resetSubtitlePosition,
    handleSubtitleDragStart,
  };
}
