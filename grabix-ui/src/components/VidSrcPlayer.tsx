import Hls from "hls.js";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconAlert,
  IconArrowLeft,
  IconAudio,
  IconDownload,
  IconExpand,
  IconInfo,
  IconList,
  IconPause,
  IconPlay,
  IconServers,
  IconSettings,
  IconSubtitle,
} from "./Icons";
import SubtitlePanel from "./SubtitlePanel";
import { BACKEND_API } from "../lib/api";
import { fetchStreamVariants, inferStreamKind } from "../lib/streamProviders";
import type { StreamSource } from "../lib/streamProviders";
import { queueVideoDownload } from "../lib/downloads";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  title: string;
  subtitle?: string;
  subtitleSearchTitle?: string;
  poster?: string;
  embedUrl?: string;
  sources?: StreamSource[];
  sourceOptions?: Array<{ id: string; label: string }>;
  currentEpisode?: number;
  episodeOptions?: number[];
  episodeLabel?: string;
  onSelectSourceOption?: (optionId: string, episode?: number) => Promise<{
    sources: StreamSource[];
    subtitle?: string;
    subtitleSearchTitle?: string;
  }>;
  onSelectEpisode?: (episode: number) => Promise<{
    sources: StreamSource[];
    subtitle?: string;
    subtitleSearchTitle?: string;
  }>;
  mediaType?: "movie" | "tv";
  disableSubtitleSearch?: boolean;
  onClose: () => void;
  onDownload?: (url: string, title: string) => Promise<void> | void;
  onDownloadSource?: (source: StreamSource, title: string) => Promise<void> | void;
}

type FailureKind =
  | "timeout"
  | "blocked_embed"
  | "media_error"
  | "unsupported_source"
  | "open_failed";

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

interface PlaybackCacheRecord<T> {
  expiresAt: number;
  value: T;
}

const PLAYBACK_CACHE_PREFIX = "grabix:playback:";
const EMBED_CACHE_TTL_MS = 1000 * 60 * 30;
const EXTRACT_CACHE_TTL_MS = 1000 * 60 * 20;
const VARIANT_CACHE_TTL_MS = 1000 * 60 * 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatProviderName(provider: string): string {
  const map: Record<string, string> = {
    hianime: "HiAnime",
    consumet: "Consumet",
    aniwatch: "AniWatch",
    gogoanime: "GogoAnime",
    zoro: "Zoro",
    "9anime": "9Anime",
  };
  const key = provider.trim().toLowerCase();
  return map[key] ?? provider;
}

function failureLabel(kind: FailureKind): string {
  switch (kind) {
    case "timeout": return "This source took too long to start.";
    case "blocked_embed": return "This embed loaded but may be blocked or blank.";
    case "media_error": return "Playback failed for this source.";
    case "unsupported_source": return "This source type is not supported by the current engine.";
    case "open_failed": return "The local file could not be opened.";
  }
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  if (hours > 0)
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function parseTimestamp(value: string): number {
  const cleaned = value.trim().replace(",", ".");
  const parts = cleaned.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

function parseSubtitleText(content: string): SubtitleCue[] {
  const normalized = (content || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return [];
  const blocks = normalized
    .replace(/^WEBVTT\s*\n/i, "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trimEnd()).filter(Boolean);
    if (lines.length < 2) continue;
    const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeLineIndex === -1) continue;
    const timeLine = lines[timeLineIndex];
    const [startRaw, endRaw] = timeLine.split("-->").map((value) => value.trim());
    if (!startRaw || !endRaw) continue;
    const start = parseTimestamp(startRaw.split(" ")[0]);
    const end = parseTimestamp(endRaw.split(" ")[0]);
    const textLines = lines.slice(timeLineIndex + 1);
    if (!textLines.length) continue;
    cues.push({ start, end, text: textLines.join("\n") });
  }
  return cues;
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

function readPlaybackCache<T>(key: string): T | null {
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
  } catch { return null; }
}

function writePlaybackCache<T>(key: string, value: T, ttlMs: number) {
  if (typeof window === "undefined") return;
  try {
    const payload: PlaybackCacheRecord<T> = { expiresAt: Date.now() + ttlMs, value };
    window.sessionStorage.setItem(`${PLAYBACK_CACHE_PREFIX}${key}`, JSON.stringify(payload));
  } catch { /* Ignore */ }
}

function buildStreamProxyUrl(api: string, url: string, headers?: Record<string, string>): string {
  if (!url) return url;
  if (url.startsWith(`${api}/stream/proxy?`)) return url;
  if (url.startsWith(`${api}/stream/proxy/`)) return url;
  if (url.startsWith("/stream/proxy?")) return `${api}${url}`;
  if (url.startsWith("/stream/proxy/")) return `${api}${url}`;
  const params = new URLSearchParams({ url });
  if (headers && Object.keys(headers).length > 0) params.set("headers_json", JSON.stringify(headers));
  return `${api}/stream/proxy/playlist.m3u8?${params.toString()}`;
}

function shouldKeepHlsProxied(source: StreamSource): boolean {
  return (
    Boolean(source.requestHeaders && Object.keys(source.requestHeaders).length > 0) ||
    source.url.includes("/stream/proxy?") || source.url.includes("/stream/proxy/")
  );
}

async function resolveEmbedUrl(api: string, url: string): Promise<string> {
  if (!url) return url;
  const cacheKey = `embed:${url}`;
  const cached = readPlaybackCache<string>(cacheKey);
  if (cached) return cached;
  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12000);
    const response = await fetch(`${api}/resolve-embed?url=${encodeURIComponent(url)}`, { signal: controller.signal });
    window.clearTimeout(timeoutId);
    if (!response.ok) return url;
    const payload = (await response.json()) as { url?: string };
    const resolved = payload.url || url;
    writePlaybackCache(cacheKey, resolved, EMBED_CACHE_TTL_MS);
    return resolved;
  } catch { return url; }
}

function canPrepareInternalSource(source: StreamSource): boolean {
  return source.kind === "embed" && (source.provider.toLowerCase().includes("moviebox") || Boolean(source.canExtract));
}

// ---------------------------------------------------------------------------
// CSS Variables + Styles (injected once)
// ---------------------------------------------------------------------------

const PLAYER_STYLES = `
  :root {
    --player-bg: #000000;
    --player-text: #ffffff;
    --player-text-dim: rgba(255,255,255,0.55);
    --player-text-dimmer: rgba(255,255,255,0.30);
    --player-surface: rgba(18,18,18,0.92);
    --player-surface-hover: rgba(35,35,35,0.95);
    --player-border: rgba(255,255,255,0.08);
    --player-progress-bg: rgba(255,255,255,0.20);
    --player-progress-fill: #ffffff;
    --player-progress-thumb: #ffffff;
    --player-overlay-gradient: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 40%, transparent 100%);
    --player-top-gradient: linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 100%);
    --player-radius: 10px;
    --player-transition: 150ms ease;
  }

  .gx-player {
    position: fixed; inset: 0; z-index: 9999;
    background: #000;
    font-family: system-ui, -apple-system, sans-serif;
    overflow: hidden;
    cursor: none;
  }
  .gx-player.controls-visible { cursor: default; }

  .gx-player video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  .gx-player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: none; }

  /* Subtitle cue */
  .gx-cue {
    position: absolute; bottom: 80px; left: 0; right: 0;
    text-align: center; pointer-events: none; z-index: 20;
    padding: 0 10%;
  }
  .gx-cue span {
    display: inline-block;
    background: rgba(0,0,0,0.65);
    color: #fff; padding: 4px 12px; border-radius: 4px;
    font-size: 1.05rem; line-height: 1.5;
    white-space: pre-line;
    text-shadow: 1px 1px 3px rgba(0,0,0,0.8);
  }

  /* Controls overlay */
  .gx-controls {
    position: absolute; inset: 0; z-index: 10;
    display: flex; flex-direction: column;
    justify-content: flex-end;
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--player-transition);
  }
  .gx-controls.visible { opacity: 1; pointer-events: auto; }

  /* Top bar */
  .gx-top {
    background: var(--player-top-gradient);
    padding: 16px 20px;
    display: flex; align-items: center; justify-content: space-between;
    height: 56px; flex-shrink: 0;
  }
  .gx-top-right { display: flex; gap: 8px; align-items: center; }

  /* Bottom bar */
  .gx-bottom {
    background: var(--player-overlay-gradient);
    padding: 0 20px 16px;
    flex-shrink: 0;
  }

  /* Progress bar */
  .gx-progress-wrap {
    position: relative;
    padding: 10px 0;
    cursor: pointer;
  }
  .gx-progress-track {
    height: 3px;
    background: var(--player-progress-bg);
    border-radius: 99px;
    position: relative;
    transition: height 150ms ease;
    overflow: visible;
  }
  .gx-progress-wrap:hover .gx-progress-track { height: 6px; }
  .gx-progress-fill {
    position: absolute; top: 0; left: 0; height: 100%;
    background: var(--player-progress-fill);
    border-radius: 99px; pointer-events: none;
  }
  .gx-progress-buffer {
    position: absolute; top: 0; left: 0; height: 100%;
    background: rgba(255,255,255,0.35);
    border-radius: 99px; pointer-events: none;
  }
  .gx-progress-thumb {
    position: absolute; top: 50%; transform: translate(-50%, -50%);
    width: 12px; height: 12px;
    background: white; border-radius: 50%;
    opacity: 0; transition: opacity 150ms ease;
    pointer-events: none;
  }
  .gx-progress-wrap:hover .gx-progress-thumb { opacity: 1; }
  .gx-progress-input {
    position: absolute; inset: 0; opacity: 0;
    cursor: pointer; width: 100%; height: 100%;
  }

  /* Hover preview */
  .gx-preview {
    position: absolute; bottom: calc(100% + 10px);
    pointer-events: none;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    transform: translateX(-50%);
    animation: gx-fade-in 100ms ease;
  }
  .gx-preview img {
    width: 160px; height: 90px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.15);
    display: block;
    background: #111;
  }
  .gx-preview span {
    font-size: 11px; color: #fff;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 1px 3px rgba(0,0,0,0.8);
  }

  /* Controls row */
  .gx-ctrl-row {
    display: flex; align-items: center;
    justify-content: space-between;
    margin-top: 6px;
    gap: 8px;
  }
  .gx-ctrl-left, .gx-ctrl-right {
    display: flex; align-items: center; gap: 4px;
  }
  .gx-ctrl-center {
    font-size: 13px; color: var(--player-text-dim);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* Icon buttons */
  .gx-btn {
    width: 32px; height: 32px;
    display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: 6px;
    color: #fff; cursor: pointer;
    transition: background var(--player-transition);
    flex-shrink: 0;
  }
  .gx-btn:hover { background: rgba(255,255,255,0.1); }
  .gx-btn:disabled { opacity: 0.35; cursor: default; }
  .gx-btn.lg { width: 36px; height: 36px; border-radius: 8px; }
  .gx-btn.dim { color: rgba(255,255,255,0.4); }
  .gx-btn.dim:hover { color: #fff; }

  /* Volume area */
  .gx-volume-wrap { position: relative; display: flex; align-items: center; }
  .gx-volume-slider-container {
    position: absolute; bottom: calc(100% + 8px); left: 50%;
    transform: translateX(-50%);
    background: var(--player-surface);
    border: 1px solid var(--player-border);
    border-radius: 8px; padding: 12px 10px;
    backdrop-filter: blur(20px);
    opacity: 0; pointer-events: none;
    transition: opacity var(--player-transition);
    z-index: 50;
  }
  .gx-volume-wrap:hover .gx-volume-slider-container,
  .gx-volume-slider-container:hover { opacity: 1; pointer-events: auto; }
  .gx-volume-slider {
    writing-mode: vertical-lr;
    direction: rtl;
    width: 4px; height: 80px;
    appearance: none; -webkit-appearance: none;
    background: var(--player-progress-bg);
    border-radius: 99px; cursor: pointer; outline: none;
  }
  .gx-volume-slider::-webkit-slider-thumb {
    appearance: none; -webkit-appearance: none;
    width: 12px; height: 12px;
    background: #fff; border-radius: 50%;
  }

  /* Settings panel */
  .gx-settings-wrap { position: relative; }
  .gx-settings-panel {
    position: absolute; bottom: calc(100% + 8px); top: auto; right: 0;
    width: 240px;
    background: var(--player-surface);
    border: 1px solid var(--player-border);
    border-radius: 12px;
    backdrop-filter: blur(20px);
    overflow: hidden;
    z-index: 100;
    animation: gx-settings-in 150ms ease;
  }
  @keyframes gx-settings-in {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes gx-fade-in {
    from { opacity: 0; } to { opacity: 1; }
  }
  .gx-settings-screen { animation: gx-fade-in 150ms ease; }
  .gx-settings-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 16px; height: 48px; cursor: pointer;
    color: #fff; font-size: 14px;
    border-radius: 8px; margin: 2px 4px;
    transition: background var(--player-transition);
  }
  .gx-settings-row:hover { background: var(--player-surface-hover); }
  .gx-settings-row-val {
    display: flex; align-items: center; gap: 6px;
    color: var(--player-text-dim); font-size: 13px;
  }
  .gx-settings-chevron { opacity: 0.4; font-size: 12px; }
  .gx-settings-header {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 16px 4px;
    color: #fff; font-size: 14px; font-weight: 600;
  }
  .gx-settings-header-btn {
    background: none; border: none; color: rgba(255,255,255,0.6);
    cursor: pointer; font-size: 16px; line-height: 1;
    padding: 2px 4px; border-radius: 4px;
    transition: color var(--player-transition);
  }
  .gx-settings-header-btn:hover { color: #fff; }
  .gx-settings-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 16px; height: 44px; cursor: pointer;
    color: #fff; font-size: 13px;
    border-radius: 8px; margin: 2px 4px;
    transition: background var(--player-transition);
  }
  .gx-settings-item:hover { background: var(--player-surface-hover); }
  .gx-settings-item.active { color: #fff; }
  .gx-settings-item .gx-check { opacity: 0; }
  .gx-settings-item.active .gx-check { opacity: 1; }
  .gx-settings-divider {
    height: 1px; background: var(--player-border);
    margin: 4px 12px;
  }
  .gx-settings-list { max-height: 240px; overflow-y: auto; padding-bottom: 6px; }
  .gx-settings-list::-webkit-scrollbar { width: 4px; }
  .gx-settings-list::-webkit-scrollbar-track { background: transparent; }
  .gx-settings-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 99px; }

  /* Episode picker popover */
  .gx-ep-wrap { position: relative; }
  .gx-ep-panel {
    position: absolute; bottom: calc(100% + 8px); right: 0;
    width: 220px; max-height: 260px;
    overflow-y: auto;
    background: var(--player-surface);
    border: 1px solid var(--player-border);
    border-radius: 12px;
    backdrop-filter: blur(20px);
    z-index: 100;
    animation: gx-settings-in 150ms ease;
    padding: 6px 0;
  }
  .gx-ep-panel::-webkit-scrollbar { width: 4px; }
  .gx-ep-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 99px; }
  .gx-ep-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 14px; height: 40px; cursor: pointer;
    color: #fff; font-size: 13px;
    transition: background var(--player-transition);
  }
  .gx-ep-item:hover { background: var(--player-surface-hover); }
  .gx-ep-item.active { font-weight: 600; }
  .gx-ep-item .gx-check { opacity: 0; }
  .gx-ep-item.active .gx-check { opacity: 1; }
  .gx-ep-label {
    font-size: 11px; color: var(--player-text-dimmer);
    padding: 6px 14px 2px; text-transform: uppercase; letter-spacing: 0.08em;
  }

  /* Pause overlay */
  .gx-pause-overlay {
    position: absolute; bottom: 90px; left: 24px;
    pointer-events: none; z-index: 5;
    opacity: 0; transition: opacity 200ms ease;
  }
  .gx-pause-overlay.visible { opacity: 1; }
  .gx-pause-title { font-size: 22px; font-weight: 700; color: #fff; line-height: 1.2; }
  .gx-pause-sub { font-size: 14px; color: var(--player-text-dim); margin-top: 4px; }

  /* Loading spinner */
  .gx-spinner-wrap {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    z-index: 8; pointer-events: none;
  }
  .gx-spinner {
    width: 32px; height: 32px;
    border: 2px solid rgba(255,255,255,0.15);
    border-top-color: #fff;
    border-radius: 50%;
    animation: gx-spin 0.8s linear infinite;
  }
  @keyframes gx-spin { to { transform: rotate(360deg); } }

  /* Error / notice */
  .gx-error {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    z-index: 15; gap: 12px;
    pointer-events: auto;
  }
  .gx-error-msg { color: rgba(255,255,255,0.8); font-size: 15px; }
  .gx-error-btn {
    background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.18);
    color: #fff; padding: 8px 20px; border-radius: 8px;
    font-size: 14px; cursor: pointer;
    transition: background var(--player-transition);
  }
  .gx-error-btn:hover { background: rgba(255,255,255,0.2); }

  /* Floating notice */
  .gx-notice {
    position: absolute; bottom: 100px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,0.75); border: 1px solid rgba(255,255,255,0.1);
    color: #fff; font-size: 12px; padding: 6px 14px; border-radius: 99px;
    white-space: nowrap; max-width: 80%; overflow: hidden; text-overflow: ellipsis;
    z-index: 30; pointer-events: none; display: flex; align-items: center; gap: 6px;
    backdrop-filter: blur(8px);
  }
  .gx-notice.error { color: #ffd0cb; }

  /* Subtitle panel container */
  .gx-subtitle-panel {
    position: absolute; bottom: 80px; right: 20px;
    z-index: 200;
  }

  /* Skip buttons */
  .gx-skip-btn {
    background: none; border: none; color: #fff;
    width: 32px; height: 32px; border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; cursor: pointer; flex-shrink: 0;
    transition: background var(--player-transition);
    position: relative;
  }
  .gx-skip-btn:hover { background: rgba(255,255,255,0.1); }
  .gx-skip-btn svg { position: absolute; }

  /* Speed label chip */
  .gx-speed-label {
    font-size: 10px; font-weight: 800; color: #fff;
    letter-spacing: -0.5px;
  }
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function VidSrcPlayer({
  embedUrl,
  title,
  subtitle,
  subtitleSearchTitle,
  poster,
  sources,
  sourceOptions,
  currentEpisode,
  episodeOptions,
  episodeLabel = "Episode",
  onSelectSourceOption,
  onSelectEpisode,
  mediaType = "movie",
  disableSubtitleSearch = false,
  onClose,
  onDownload,
  onDownloadSource,
}: Props) {
  const API = BACKEND_API;

  // Refs
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [hlsLevels, setHlsLevels] = useState<Array<{ height: number; bitrate: number }>>([]);
  const [selectedHlsLevel, setSelectedHlsLevel] = useState<number>(-1);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const hideChromeTimeoutRef = useRef<number | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const mediaNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const embedLoadedRef = useRef(false);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const progressBarWidthRef = useRef(0);

  // Thumbnail preview refs
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewThrottleRef = useRef<number>(0);

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
    [effectiveSources, embedUrl]
  );

  const extractedSourcesRef = useRef<StreamSource[]>([]);
  const [extractedSources, setExtractedSources] = useState<StreamSource[]>([]);
  const allSources = useMemo(() => [...baseSources, ...extractedSources], [baseSources, extractedSources]);

  useEffect(() => { extractedSourcesRef.current = []; setExtractedSources([]); }, [baseSources]);

  // UI state
  const [activeIndex, setActiveIndex] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [statusText, setStatusText] = useState("Connecting");
  const [errorText, setErrorText] = useState("");
  const [fallbackNotice, setFallbackNotice] = useState("");
  const [resolvedEmbedUrl, setResolvedEmbedUrl] = useState("");
  const [resolvedPlaybackUrl, setResolvedPlaybackUrl] = useState("");
  const [showChrome, setShowChrome] = useState(true);
  const [episodeMenuOpen, setEpisodeMenuOpen] = useState(false);
  const [serverMenuOpen, setServerMenuOpen] = useState(false);
  const [volumeMenuOpen, setVolumeMenuOpen] = useState(false);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [volumeBoost, setVolumeBoost] = useState(100);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [subtitleUrl, setSubtitleUrl] = useState("");
  const [subtitleName, setSubtitleName] = useState("");
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [showSubtitlePanel, setShowSubtitlePanel] = useState(false);
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [currentCue, setCurrentCue] = useState("");
  const [subtitleHint, setSubtitleHint] = useState("");
  const [activeSourceOptionId, setActiveSourceOptionId] = useState(sourceOptions?.[0]?.id ?? "");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Settings panel
  const [settingsOpen, setSettingsOpen] = useState(false);
  type SettingsScreen = "main" | "quality" | "speed" | "subtitles" | "server" | "episodes";
  const [settingsScreen, setSettingsScreen] = useState<SettingsScreen>("main");

  // Thumbnail hover preview
  const [hoverPreview, setHoverPreview] = useState<{
    x: number; time: number; dataUrl: string; visible: boolean;
  } | null>(null);

  // Derived
  const activeSource = allSources[activeIndex] ?? null;
  const activeSubtitles = activeSource?.subtitles ?? [];
  const hasFallback = activeIndex < allSources.length - 1;
  const isMovieBoxQualityMode = allSources.length > 0 && allSources.every(s => s.provider.toLowerCase().includes("moviebox") || s.provider.toLowerCase().includes("movie box"));
  const isDirectEngine = activeSource?.kind === "direct" || activeSource?.kind === "hls" || activeSource?.kind === "local";
  const isEmbedEngine = activeSource?.kind === "embed";

  useEffect(() => {
    setRuntimeSources(sources ?? []);
    setActiveSubtitleText(subtitle || "");
    setActiveSearchTitle(subtitleSearchTitle || title);
    setActiveEpisode(currentEpisode ?? null);
  }, [sources, subtitle, subtitleSearchTitle, currentEpisode, title]);

  useEffect(() => { setActiveSourceOptionId(sourceOptions?.[0]?.id ?? ""); }, [sourceOptions]);

  // Chrome visibility
  const showControls = () => {
    setShowChrome(true);
    if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current);
    // Never auto-hide when there's an error, menus open, or video is paused
    if (errorText || settingsOpen || serverMenuOpen || volumeMenuOpen || subtitleMenuOpen || qualityMenuOpen || episodeMenuOpen) return;
    hideChromeTimeoutRef.current = window.setTimeout(() => {
      if (isPlaying && !errorText) setShowChrome(false);
    }, 3000);
  };

  useEffect(() => { setActiveIndex(0); setHlsLevels([]); setSelectedHlsLevel(-1); }, [baseSources]);
  useEffect(() => { showControls(); return () => { if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current); }; }, [episodeMenuOpen, serverMenuOpen, volumeMenuOpen, subtitleMenuOpen, showSubtitlePanel, settingsOpen]);

  // Keep controls visible when paused or errored
  useEffect(() => {
    if (!isPlaying || errorText) {
      setShowChrome(true);
      if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current);
    }
  }, [isPlaying, errorText]);

  // Fullscreen listener
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenechange", onChange);
    return () => document.removeEventListener("fullscreenechange", onChange);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (settingsOpen) { setSettingsOpen(false); return; } onClose(); }
      if (e.key.toLowerCase() === "r") setReloadKey((key) => key + 1);
      if (e.key === " ") {
        e.preventDefault();
        if (isDirectEngine) {
          const video = videoRef.current;
          if (!video) return;
          if (video.paused) void video.play().catch(() => {});
          else video.pause();
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
  }, [isDirectEngine, onClose, settingsOpen, duration]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current);
      if (subtitleUrl.startsWith("blob:")) URL.revokeObjectURL(subtitleUrl);
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (audioContextRef.current) { void audioContextRef.current.close().catch(() => {}); audioContextRef.current = null; }
    };
  }, [subtitleUrl]);

  // Failover logic
  const findPreparedSiblingIndex = (index: number): number => {
    const candidate = allSources[index];
    if (!candidate || candidate.kind !== "embed") return -1;
    const candidateKey = candidate.externalUrl || candidate.url;
    return allSources.findIndex((source, sourceIndex) => sourceIndex > index && source.kind !== "embed" && (source.externalUrl || source.url) === candidateKey);
  };

  const goToNextSource = (reason: FailureKind) => {
    const message = failureLabel(reason);
    if (hasFallback) {
      const immediateNextIndex = activeIndex + 1;
      const preparedSiblingIndex = findPreparedSiblingIndex(immediateNextIndex);
      const nextIndex = preparedSiblingIndex >= 0 ? preparedSiblingIndex : immediateNextIndex;
      const nextSource = allSources[nextIndex];
      setFallbackNotice(`${message} Switched to ${nextSource.label} (${nextSource.provider}).`);
      setActiveIndex(nextIndex);
      setReloadKey((key) => key + 1);
      return;
    }
    setErrorText(message);
    setIsLoading(false);
    setStatusText("Failed");
  };

  // Source setup
  useEffect(() => {
    setIsLoading(true);
    setErrorText("");
    setFallbackNotice("");
    setStatusText(activeSource ? `Loading ${activeSource.provider}` : "No source");
    setResolvedEmbedUrl("");
    setEpisodeMenuOpen(false);
    setServerMenuOpen(false);
    setVolumeMenuOpen(false);
    setSubtitleMenuOpen(false);
    setShowSubtitlePanel(false);
    setExtractError("");
    embedLoadedRef.current = false;
    setSettingsOpen(false);
    setSettingsScreen("main");
    setHoverPreview(null);

    if (!activeSource) return;
    if (activeSource.kind === "embed") {
      const noticeTimeout = window.setTimeout(() => {
        if (!embedLoadedRef.current) {
          embedLoadedRef.current = true;
          setFallbackNotice("Stream is taking a while — still connecting. Use the server picker to switch if needed.");
          setIsLoading(false);
        }
      }, 45_000);
      return () => { window.clearTimeout(noticeTimeout); };
    }
    return undefined;
  }, [activeSource, reloadKey]);

  // Embed URL resolution
  useEffect(() => {
    if (!activeSource || activeSource.kind !== "embed") return;
    let canceled = false;
    resolveEmbedUrl(API, activeSource.url).then((nextUrl) => { if (!canceled) setResolvedEmbedUrl(nextUrl || activeSource.url); }).catch(() => { if (!canceled) setResolvedEmbedUrl(activeSource.url); });
    return () => { canceled = true; };
  }, [API, activeSource]);

  useEffect(() => {
    if (!activeSource || activeSource.kind !== "hls") { setResolvedPlaybackUrl(""); return; }
    if (shouldKeepHlsProxied(activeSource)) { setResolvedPlaybackUrl(""); return; }
    let cancelled = false;
    setResolvedPlaybackUrl("");
    const resolveBestVariant = async () => {
      const sourceKey = activeSource.externalUrl || activeSource.url;
      const cachedUrl = readPlaybackCache<string>(`variant:${sourceKey}`);
      if (cachedUrl) { setResolvedPlaybackUrl(cachedUrl); return; }
      try {
        const variants = await fetchStreamVariants(sourceKey, activeSource.requestHeaders);
        if (cancelled || variants.length === 0) return;
        const best = pickBestVariant(variants);
        if (!best?.url || best.url === activeSource.url) return;
        const nextUrl = shouldKeepHlsProxied(activeSource) ? buildStreamProxyUrl(API, best.url, activeSource.requestHeaders) : best.url;
        writePlaybackCache(`variant:${sourceKey}`, nextUrl, VARIANT_CACHE_TTL_MS);
        setResolvedPlaybackUrl(nextUrl);
        setFallbackNotice(`Using the strongest ${best.label || "HLS"} variant${best.bandwidth ? ` (${Math.round(Number(best.bandwidth) / 1000)} kbps)` : ""}.`);
      } catch { if (!cancelled) setResolvedPlaybackUrl(""); }
    };
    void resolveBestVariant();
    return () => { cancelled = true; };
  }, [API, activeSource]);

  // Direct / HLS playback effect
  useEffect(() => {
    if (!activeSource || !isDirectEngine) return;
    const video = videoRef.current;
    if (!video) return;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    video.pause();
    video.removeAttribute("src");
    video.load();
    setCurrentTime(0);
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
    const handleCanPlay = () => markSourceReady("Ready");
    const handleLoadedMetadata = () => markSourceReady("Ready");
    const handleLoadedData = () => markSourceReady("Ready");
    const handleError = () => { sourceReady = true; goToNextSource(activeSource.kind === "local" ? "open_failed" : "media_error"); };
    const handleWaiting = () => { setIsLoading(true); setStatusText("Buffering"); };
    const handlePlaying = () => {
      sourceReady = true;
      if (shouldRestoreAudioAfterStart) {
        video.muted = originalMuted;
        if (!originalMuted) video.volume = originalVolume || 1;
        shouldRestoreAudioAfterStart = false;
      } else if (video.muted) {
        // Ensure volume is restored if muted from autoplay workaround
        video.muted = false;
        video.volume = 1;
      }
      setIsLoading(false); setStatusText("Playing"); setIsPlaying(true);
    };
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      if (video.buffered.length > 0 && video.duration) {
        setBuffered((video.buffered.end(video.buffered.length - 1) / video.duration) * 100);
      }
    };
    const handleDurationChange = () => setDuration(video.duration || 0);
    const handleVolumeChange = () => { setVolume(video.volume); setIsMuted(video.muted); };
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("error", handleError);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("pause", handlePause);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("durationchange", handleDurationChange);
    video.addEventListener("volumechange", handleVolumeChange);
    if (activeSource.kind === "hls") {
      const defaultUrl = shouldKeepHlsProxied(activeSource) ? buildStreamProxyUrl(API, activeSource.url, activeSource.requestHeaders) : activeSource.url;
      const playbackUrl = resolvedPlaybackUrl || defaultUrl;
      if (Hls.isSupported()) {
        const isProxied = shouldKeepHlsProxied(activeSource);
        const hls = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: isProxied ? 20 : 60, maxMaxBufferLength: isProxied ? 60 : 600, backBufferLength: 120, startFragPrefetch: true, abrEwmaFastLive: 3, abrEwmaSlowLive: 9, abrEwmaFastVoD: 3, abrEwmaSlowVoD: 9, manifestLoadingMaxRetry: isProxied ? 1 : 3, manifestLoadingRetryDelay: 1000, fragLoadingMaxRetry: isProxied ? 2 : 4, fragLoadingRetryDelay: 500, levelLoadingMaxRetry: isProxied ? 1 : 3, levelLoadingRetryDelay: 1000 });
        hlsRef.current = hls;
        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, () => { hls.loadSource(playbackUrl); });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (hls.levels.length > 0) { setHlsLevels(hls.levels.map(l => ({ height: l.height || 0, bitrate: l.bitrate || 0 }))); setSelectedHlsLevel(-1); hls.currentLevel = -1; }
          setStatusText("Buffering");
          void attemptPlayback();
        });
        hls.on(Hls.Events.FRAG_BUFFERED, () => { if (!sourceReady) markSourceReady("Buffering"); });
        hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) goToNextSource("media_error"); });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = playbackUrl; void attemptPlayback();
      } else { goToNextSource("unsupported_source"); }
    } else {
      video.src = activeSource.url;
      void attemptPlayback();
    }
    return () => {
      window.clearTimeout(startupTimeout);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("error", handleError);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("durationchange", handleDurationChange);
      video.removeEventListener("volumechange", handleVolumeChange);
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [activeSource, isDirectEngine, reloadKey, resolvedPlaybackUrl]);

  // Thumbnail preview video source
  useEffect(() => {
    if (!isDirectEngine || !activeSource?.url) return;
    const pv = previewVideoRef.current;
    if (!pv) return;
    if (activeSource.kind === "hls") {
      const url = resolvedPlaybackUrl || (shouldKeepHlsProxied(activeSource) ? buildStreamProxyUrl(API, activeSource.url, activeSource.requestHeaders) : activeSource.url);
      pv.src = url;
    } else {
      pv.src = activeSource.url;
    }
    pv.muted = true;
    pv.preload = "metadata";
  }, [activeSource, isDirectEngine, resolvedPlaybackUrl]);

  // Audio boost
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

  // Subtitle track management
  useEffect(() => {
    const trackList = videoRef.current?.textTracks;
    if (!trackList) return;
    for (let index = 0; index < trackList.length; index += 1) {
      trackList[index].mode = subtitleUrl && subtitlesEnabled && index === trackList.length - 1 ? "showing" : "disabled";
    }
  }, [subtitleUrl, subtitlesEnabled, activeSource]);

  useEffect(() => {
    if (subtitleUrl.startsWith("blob:")) URL.revokeObjectURL(subtitleUrl);
    const firstSubtitle = activeSubtitles[0];
    if (firstSubtitle?.url) { setSubtitleUrl(firstSubtitle.url); setSubtitleName(firstSubtitle.label); setSubtitlesEnabled(true); return; }
    setSubtitleUrl(""); setSubtitleName(""); setSubtitlesEnabled(false); setSubtitleCues([]); setCurrentCue(""); setSubtitleHint("");
  }, [activeSource]);

  useEffect(() => {
    if (!subtitleUrl || subtitleUrl.startsWith("blob:")) return;
    let cancelled = false;
    fetch(subtitleUrl).then((response) => { if (!response.ok) throw new Error(`Subtitle load failed with ${response.status}`); return response.text(); }).then((content) => { if (cancelled) return; const cues = parseSubtitleText(content); setSubtitleCues(cues); if (cues.length > 0) setSubtitleHint(`Subtitles loaded. Next line at ${formatTime(cues[0].start)}.`); }).catch(() => { if (!cancelled) setSubtitleCues([]); });
    return () => { cancelled = true; };
  }, [subtitleUrl]);

  useEffect(() => {
    if (!subtitleCues.length) { setCurrentCue(""); setSubtitleHint(""); return; }
    const cue = subtitleCues.find((item) => currentTime >= item.start && currentTime <= item.end);
    setCurrentCue(cue?.text ?? "");
    if (cue) { setSubtitleHint(""); return; }
    const nextCue = subtitleCues.find((item) => item.start > currentTime);
    if (nextCue) { setSubtitleHint(`Subtitles loaded. Next line at ${formatTime(nextCue.start)}.`); return; }
    setSubtitleHint("Subtitles loaded.");
  }, [currentTime, subtitleCues]);

  // Playback speed sync
  useEffect(() => {
    const v = videoRef.current;
    if (v && isDirectEngine) v.playbackRate = playbackSpeed;
  }, [playbackSpeed, isDirectEngine]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSourceSwitch = (index: number) => {
    setActiveIndex(index); setErrorText(""); setFallbackNotice(""); setExtractError("");
    setReloadKey((key) => key + 1); setEpisodeMenuOpen(false); setServerMenuOpen(false);
    setSettingsOpen(false); showControls();
  };

  const handleEpisodeSwitch = async (episode: number) => {
    if ((!onSelectEpisode && !onSelectSourceOption) || episodeLoading || episode === activeEpisode) return;
    setEpisodeLoading(true); setErrorText(""); setFallbackNotice("");
    try {
      const preferredProvider = activeSource?.provider;
      const preferredLabel = activeSource?.label;
      const next = onSelectSourceOption && activeSourceOptionId ? await onSelectSourceOption(activeSourceOptionId, episode) : await onSelectEpisode?.(episode);
      if (!next) throw new Error(`Could not load ${episodeLabel.toLowerCase()} ${episode}.`);
      const matchedIndex = next.sources.findIndex(s => s.provider === preferredProvider && s.label === preferredLabel);
      extractedSourcesRef.current = []; setExtractedSources([]); setRuntimeSources(next.sources);
      setActiveSubtitleText(next.subtitle || ""); setActiveSearchTitle(next.subtitleSearchTitle || `${title} ${episodeLabel} ${episode}`);
      setActiveEpisode(episode); setActiveIndex(matchedIndex >= 0 ? matchedIndex : 0);
      setReloadKey((key) => key + 1); setEpisodeMenuOpen(false); setSettingsOpen(false);
    } catch (error) { setFallbackNotice(error instanceof Error ? error.message : `Could not load ${episodeLabel.toLowerCase()} ${episode}.`); }
    finally { setEpisodeLoading(false); }
  };

  const handleSourceOptionSwitch = async (optionId: string) => {
    if (!onSelectSourceOption || optionId === activeSourceOptionId) return;
    setEpisodeLoading(true); setErrorText(""); setFallbackNotice("");
    try {
      const next = await onSelectSourceOption(optionId, activeEpisode ?? currentEpisode ?? undefined);
      extractedSourcesRef.current = []; setExtractedSources([]); setRuntimeSources(next.sources);
      setActiveSubtitleText(next.subtitle || ""); setActiveSearchTitle(next.subtitleSearchTitle || title);
      setActiveSourceOptionId(optionId); setActiveIndex(0); setReloadKey((key) => key + 1);
      setServerMenuOpen(false); setSettingsOpen(false);
    } catch (error) { setFallbackNotice(error instanceof Error ? error.message : "Could not switch server."); }
    finally { setEpisodeLoading(false); }
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video || !isDirectEngine) return;
    if (video.paused) void video.play().catch(() => {}); else video.pause();
    showControls();
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch { /* Ignore */ }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    const nextTime = Number(e.target.value);
    video.currentTime = nextTime; setCurrentTime(nextTime); showControls();
  };

  const onSubtitlePicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (subtitleUrl.startsWith("blob:")) URL.revokeObjectURL(subtitleUrl);
    const objectUrl = URL.createObjectURL(file);
    setSubtitleUrl(objectUrl); setSubtitleName(file.name); setSubtitlesEnabled(true);
    setSubtitleCues([]); setCurrentCue(""); setSubtitleHint("Subtitle track loaded.");
    setSubtitleMenuOpen(false); setShowSubtitlePanel(false);
    setFallbackNotice(`Loaded subtitles: ${file.name}`); event.target.value = "";
  };

  const handleSubtitleSelect = (url: string, label: string) => {
    if (subtitleUrl.startsWith("blob:") && subtitleUrl !== url) URL.revokeObjectURL(subtitleUrl);
    setSubtitleUrl(url); setSubtitleName(label); setSubtitlesEnabled(true);
    setSubtitleCues([]); setCurrentCue(""); setSubtitleHint("Subtitle track loaded.");
    setSubtitleMenuOpen(false); setShowSubtitlePanel(false); setFallbackNotice(`Loaded subtitles: ${label}`);
  };

  const clearSubtitles = () => {
    if (subtitleUrl.startsWith("blob:")) URL.revokeObjectURL(subtitleUrl);
    setSubtitleUrl(""); setSubtitleName(""); setSubtitlesEnabled(false);
    setSubtitleCues([]); setCurrentCue(""); setSubtitleHint("Subtitles off."); setSubtitleMenuOpen(false);
  };

  const toggleSubtitles = () => {
    if (activeSubtitles.length > 0 || subtitleUrl) {
      if (subtitlesEnabled) { clearSubtitles(); return; }
      const firstSubtitle = activeSubtitles[0];
      if (firstSubtitle?.url) handleSubtitleSelect(firstSubtitle.url, firstSubtitle.label);
      return;
    }
    if (disableSubtitleSearch) { setSubtitleHint("No subtitles available for this source."); return; }
    setShowSubtitlePanel((open) => !open);
  };

  const handleSubtitleLoaded = (content: string, label: string) => {
    if (subtitleUrl.startsWith("blob:")) URL.revokeObjectURL(subtitleUrl);
    const cues = parseSubtitleText(content);
    setSubtitleUrl(""); setSubtitleName(label); setSubtitleCues(cues); setCurrentCue("");
    setSubtitleHint(cues.length > 0 ? `Subtitles loaded. Next line at ${formatTime(cues[0].start)}.` : "Subtitle file loaded, but no timed lines were found.");
    setSubtitleMenuOpen(false); setShowSubtitlePanel(false); setFallbackNotice(`Loaded subtitles: ${label}`);
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
      setReloadKey((k) => k + 1); setServerMenuOpen(false); setSettingsOpen(false);
      setFallbackNotice(`Extracted a direct stream from ${activeSource.provider}. Switched to it.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown extraction error";
      setExtractError(`Could not extract a direct stream: ${message}`);
    } finally { setExtracting(false); }
  };

  const prepareInternalSource = async (source: StreamSource, options?: { labelPrefix?: string; notice?: string }): Promise<number> => {
    const sourceKey = source.externalUrl || source.url;
    const existingPreparedIndex = extractedSourcesRef.current.findIndex(item => item.externalUrl === sourceKey);
    if (existingPreparedIndex >= 0) return baseSources.length + existingPreparedIndex;
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
    } catch (error) { const message = error instanceof Error ? error.message : "Download could not be started."; setFallbackNotice(message); setExtractError(message); }
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

  const handleShellClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (showSubtitlePanel && !target.closest("[data-subtitle-panel='true']")) setShowSubtitlePanel(false);
    if (settingsOpen && !target.closest("[data-settings='true']")) { setSettingsOpen(false); setSettingsScreen("main"); }
    if (target.closest("button, input, select, textarea, a")) { showControls(); return; }
    if (target.closest("[data-subtitle-panel='true']")) { showControls(); return; }
    if (target.closest("[data-settings='true']")) { showControls(); return; }
    if (serverMenuOpen) setServerMenuOpen(false);
    if (volumeMenuOpen) setVolumeMenuOpen(false);
    if (subtitleMenuOpen) setSubtitleMenuOpen(false);
    if (episodeMenuOpen) setEpisodeMenuOpen(false);
    if (isDirectEngine && (target.tagName === "VIDEO" || target === rootRef.current)) { togglePlayback(); return; }
    showControls();
  };

  // Progress bar hover (thumbnail preview)
  const handleProgressHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    progressBarWidthRef.current = rect.width;
    const ratio = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
    const hoverTime = ratio * duration;
    const x = e.clientX - rect.left;

    if (!isDirectEngine) {
      setHoverPreview({ x, time: hoverTime, dataUrl: "", visible: true });
      return;
    }

    const now = Date.now();
    if (now - previewThrottleRef.current < 150) {
      setHoverPreview(prev => prev ? { ...prev, x, time: hoverTime } : { x, time: hoverTime, dataUrl: "", visible: true });
      return;
    }
    previewThrottleRef.current = now;

    const pv = previewVideoRef.current;
    const canvas = previewCanvasRef.current;
    if (!pv || !canvas) { setHoverPreview({ x, time: hoverTime, dataUrl: "", visible: true }); return; }

    pv.currentTime = hoverTime;
    const onSeeked = () => {
      try {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = 160; canvas.height = 90;
        ctx.drawImage(pv, 0, 0, 160, 90);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        setHoverPreview({ x, time: hoverTime, dataUrl, visible: true });
      } catch { setHoverPreview({ x, time: hoverTime, dataUrl: "", visible: true }); }
      pv.removeEventListener("seeked", onSeeked);
    };
    pv.addEventListener("seeked", onSeeked);
  };

  const handleProgressLeave = () => setHoverPreview(null);

  // Settings helpers
  const currentQualityLabel = selectedHlsLevel === -1
    ? "Auto"
    : hlsLevels[selectedHlsLevel]?.height ? `${hlsLevels[selectedHlsLevel].height}p` : "Auto";

  const currentServerLabel = (() => {
    if (sourceOptions && sourceOptions.length > 0) {
      return sourceOptions.find(o => o.id === activeSourceOptionId)?.label ?? "Auto";
    }
    return activeSource?.label ?? "Auto";
  })();

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={rootRef}
      className={`gx-player${showChrome ? " controls-visible" : ""}`}
      onMouseMove={() => { showControls(); }}
      onClick={handleShellClick}
    >
      <style>{PLAYER_STYLES}</style>

      <input ref={subtitleInputRef} type="file" accept=".vtt,text/vtt" style={{ display: "none" }} onChange={onSubtitlePicked} />
      {/* Hidden elements for preview generation */}
      <video ref={previewVideoRef} style={{ display: "none" }} muted playsInline crossOrigin="anonymous" />
      <canvas ref={previewCanvasRef} style={{ display: "none" }} />

      {/* ---- Video / Iframe ---- */}
      {activeSource && isEmbedEngine && (
        <iframe
          key={`${activeSource.id}-${reloadKey}`}
          src={resolvedEmbedUrl || activeSource.url}
          allowFullScreen
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          referrerPolicy="unsafe-url"
          title={`${title} - ${activeSource.provider}`}
          onLoad={() => { embedLoadedRef.current = true; setIsLoading(false); setStatusText("Embed loaded"); }}
        />
      )}

      {activeSource && isDirectEngine && (
        <video
          key={`${activeSource.id}-${reloadKey}`}
          ref={videoRef}
          crossOrigin="anonymous"
          playsInline
          preload="auto"
          poster={poster}
          onClick={(event) => { event.stopPropagation(); setShowSubtitlePanel(false); setServerMenuOpen(false); setVolumeMenuOpen(false); setSubtitleMenuOpen(false); setSettingsOpen(false); togglePlayback(); }}
        >
          {subtitleUrl && <track key={subtitleUrl} default kind="subtitles" label={subtitleName || "Subtitles"} src={subtitleUrl} />}
        </video>
      )}

      {/* ---- Subtitle Cue ---- */}
      {currentCue && isDirectEngine && (
        <div className="gx-cue" style={{ bottom: showChrome ? 90 : 24 }}>
          <span>{currentCue}</span>
        </div>
      )}

      {/* ---- Pause overlay (cineby-style) ---- */}
      {isDirectEngine && (
        <div className={`gx-pause-overlay${!isPlaying && !isLoading ? " visible" : ""}`}>
          <div className="gx-pause-title">{title}</div>
          {activeSubtitleText && <div className="gx-pause-sub">{activeSubtitleText}</div>}
        </div>
      )}

      {/* ---- Buffering/Loading spinner ---- */}
      {isLoading && (
        <div className="gx-spinner-wrap">
          <div className="gx-spinner" />
        </div>
      )}

      {/* ---- Error state ---- */}
      {errorText && !hasFallback && !isLoading && (
        <div className="gx-error">
          <div className="gx-error-msg">Couldn't load this source</div>
          {allSources.length > 1 && (
            <button className="gx-error-btn" onClick={() => { setActiveIndex(i => Math.min(i + 1, allSources.length - 1)); setReloadKey(k => k + 1); setErrorText(""); }}>
              Try next source
            </button>
          )}
        </div>
      )}

      {/* ---- No source ---- */}
      {!activeSource && !isLoading && (
        <div className="gx-error">
          <div className="gx-error-msg">No source available</div>
        </div>
      )}

      {/* ---- Floating notice ---- */}
      {(fallbackNotice || (extractError && !settingsOpen)) && (
        <div className={`gx-notice${extractError ? " error" : ""}`}>
          {extractError
            ? <IconAlert size={13} color="currentColor" />
            : <IconInfo size={13} color="currentColor" />}
          <span>{extractError || fallbackNotice}</span>
        </div>
      )}

      {/* ---- Subtitle panel ---- */}
      {showSubtitlePanel && (
        <div className="gx-subtitle-panel" data-subtitle-panel="true">
          <SubtitlePanel
            mediaTitle={title}
            searchTitle={activeSearchTitle}
            mediaType={mediaType}
            visible={showSubtitlePanel}
            onClose={() => setShowSubtitlePanel(false)}
            onSubtitleLoaded={handleSubtitleLoaded}
            onOpenLocalFile={() => subtitleInputRef.current?.click()}
            onSelectTrack={handleSubtitleSelect}
            availableTracks={activeSubtitles}
            activeSubtitleName={subtitleName}
            onClearSubtitles={clearSubtitles}
          />
        </div>
      )}

      {/* ============================================================
          BACK BUTTON — always visible, outside controls overlay
          ============================================================ */}
      <button
        style={{ position: "absolute", top: 16, left: 16, zIndex: 50, pointerEvents: "auto" }}
        className="gx-btn lg"
        onClick={onClose}
        title="Back"
        aria-label="Back"
      >
        <IconArrowLeft size={16} color="currentColor" />
      </button>

      {/* ============================================================
          CONTROLS OVERLAY
          ============================================================ */}
      <div className={`gx-controls${showChrome ? " visible" : ""}`}>

        {/* ---- BOTTOM BAR ---- */}
        <div className="gx-bottom">
          {/* Progress bar */}
          {isDirectEngine && (
            <div
              ref={progressBarRef}
              className="gx-progress-wrap"
              onMouseMove={handleProgressHover}
              onMouseLeave={handleProgressLeave}
              style={{ position: "relative" }}
            >
              {/* Thumbnail preview */}
              {hoverPreview?.visible && (
                <div
                  className="gx-preview"
                  style={{ left: Math.max(80, Math.min(hoverPreview.x, (progressBarWidthRef.current || 300) - 80)) }}
                >
                  {hoverPreview.dataUrl
                    ? <img src={hoverPreview.dataUrl} alt="" />
                    : <div style={{ width: 160, height: 90, borderRadius: 6, background: "#111", border: "1px solid rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Preview</span>
                      </div>
                  }
                  <span>{formatTime(hoverPreview.time)}</span>
                </div>
              )}

              <div className="gx-progress-track">
                <div className="gx-progress-buffer" style={{ width: `${buffered}%` }} />
                <div className="gx-progress-fill" style={{ width: `${duration ? Math.min((currentTime / duration) * 100, 100) : 0}%` }} />
                <div className="gx-progress-thumb" style={{ left: `${duration ? Math.min((currentTime / duration) * 100, 100) : 0}%` }} />
                <input
                  className="gx-progress-input"
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.1}
                  value={Math.min(currentTime, duration || 0)}
                  onChange={handleSeek}
                />
              </div>
            </div>
          )}

          {/* Controls row */}
          <div className="gx-ctrl-row">

            {/* Left group: skip-back | play/pause | skip-forward | volume */}
            <div className="gx-ctrl-left">
              {isDirectEngine && (
                <>
                  {/* Skip back 10s */}
                  <button className="gx-skip-btn" title="Back 10s" onClick={() => { const v = videoRef.current; if (v) v.currentTime = Math.max(v.currentTime - 10, 0); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                      <path d="M3 3v5h5"/>
                    </svg>
                    <span style={{ position: "absolute", fontSize: 7, fontWeight: 800, lineHeight: 1, top: "58%", left: "50%", transform: "translate(-50%,-50%)" }}>10</span>
                  </button>

                  {/* Play/Pause */}
                  <button className="gx-btn" onClick={togglePlayback} title={isPlaying ? "Pause" : "Play"} aria-label={isPlaying ? "Pause" : "Play"} style={{ width: 34, height: 34 }}>
                    {isPlaying
                      ? <IconPause size={15} color="currentColor" />
                      : <IconPlay size={15} color="currentColor" />
                    }
                  </button>

                  {/* Skip forward 10s */}
                  <button className="gx-skip-btn" title="Forward 10s" onClick={() => { const v = videoRef.current; if (v) v.currentTime = Math.min(v.currentTime + 10, duration); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                      <path d="M21 3v5h-5"/>
                    </svg>
                    <span style={{ position: "absolute", fontSize: 7, fontWeight: 800, lineHeight: 1, top: "58%", left: "50%", transform: "translate(-50%,-50%)" }}>10</span>
                  </button>

                  {/* Volume */}
                  <div className="gx-volume-wrap">
                    <button
                      className="gx-btn"
                      title={isMuted ? "Unmute" : "Mute"}
                      onClick={() => { const v = videoRef.current; if (v) { v.muted = !v.muted; setIsMuted(v.muted); } }}
                    >
                      {isMuted || volume === 0
                        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                        : volume < 0.5
                          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                          : <IconAudio size={14} color="currentColor" />
                      }
                    </button>
                    <div className="gx-volume-slider-container">
                      <input
                        type="range" min={0} max={1} step={0.02}
                        value={isMuted ? 0 : volume}
                        className="gx-volume-slider"
                        onChange={(e) => { const v = videoRef.current; if (v) { v.volume = Number(e.target.value); v.muted = Number(e.target.value) === 0; } }}
                        onClick={e => e.stopPropagation()}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Center: time */}
            {isDirectEngine && (
              <div className="gx-ctrl-center">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            )}

            {/* Right group: CC | episodes | settings | fullscreen */}
            <div className="gx-ctrl-right">
              {/* CC toggle */}
              <button
                className={`gx-btn${subtitlesEnabled ? "" : " dim"}`}
                title={subtitlesEnabled ? "CC On" : "CC Off"}
                onClick={() => { toggleSubtitles(); }}
              >
                <IconSubtitle size={14} color="currentColor" />
              </button>

              {/* Episode picker */}
              {episodeOptions && episodeOptions.length > 0 && (
                <div className="gx-ep-wrap">
                  <button
                    className="gx-btn"
                    title={episodeLabel}
                    onClick={(e) => { e.stopPropagation(); setEpisodeMenuOpen(open => !open); }}
                  >
                    <IconList size={14} color="currentColor" />
                  </button>
                  {episodeMenuOpen && (
                    <div className="gx-ep-panel">
                      <div className="gx-ep-label">{episodeLabel}s</div>
                      {episodeOptions.map(ep => (
                        <div
                          key={ep}
                          className={`gx-ep-item${activeEpisode === ep ? " active" : ""}`}
                          onClick={() => { void handleEpisodeSwitch(ep); setEpisodeMenuOpen(false); }}
                          style={{ opacity: episodeLoading ? 0.5 : 1 }}
                        >
                          <span>{episodeLabel} {ep}</span>
                          <span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Settings — opens upward from bottom bar */}
              <div style={{ position: "relative" }} data-settings="true">
                <button
                  className="gx-btn"
                  title="Settings"
                  aria-label="Settings"
                  onClick={(e) => { e.stopPropagation(); setSettingsOpen(open => !open); setSettingsScreen("main"); }}
                >
                  <IconSettings size={14} color="currentColor" />
                </button>

                {settingsOpen && (
                  <div className="gx-settings-panel" style={{ bottom: "calc(100% + 8px)", top: "auto", right: 0 }} data-settings="true">
                    {settingsScreen === "main" && (
                      <div className="gx-settings-screen" style={{ padding: "4px 0 6px" }}>
                        {(hlsLevels.length > 1 || isMovieBoxQualityMode) && (
                          <div className="gx-settings-row" onClick={() => setSettingsScreen("quality")}>
                            <span>Quality</span>
                            <div className="gx-settings-row-val">
                              <span>{currentQualityLabel}</span>
                              <span className="gx-settings-chevron">›</span>
                            </div>
                          </div>
                        )}
                        <div className="gx-settings-row" onClick={() => setSettingsScreen("speed")}>
                          <span>Speed</span>
                          <div className="gx-settings-row-val">
                            <span>{playbackSpeed === 1 ? "Normal" : `${playbackSpeed}×`}</span>
                            <span className="gx-settings-chevron">›</span>
                          </div>
                        </div>
                        {!disableSubtitleSearch && (
                          <div className="gx-settings-row" onClick={() => setSettingsScreen("subtitles")}>
                            <span>Subtitles</span>
                            <div className="gx-settings-row-val">
                              <span>{subtitlesEnabled && subtitleName ? subtitleName.slice(0, 16) : subtitlesEnabled ? "On" : "Off"}</span>
                              <span className="gx-settings-chevron">›</span>
                            </div>
                          </div>
                        )}
                        {(allSources.length > 1 || (sourceOptions && sourceOptions.length > 0)) && (
                          <div className="gx-settings-row" onClick={() => setSettingsScreen("server")}>
                            <span>Server</span>
                            <div className="gx-settings-row-val">
                              <span style={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentServerLabel}</span>
                              <span className="gx-settings-chevron">›</span>
                            </div>
                          </div>
                        )}
                        {episodeOptions && episodeOptions.length > 0 && (
                          <div className="gx-settings-row" onClick={() => setSettingsScreen("episodes")}>
                            <span>Episodes</span>
                            <div className="gx-settings-row-val">
                              {activeEpisode && <span>Ep {activeEpisode}</span>}
                              <span className="gx-settings-chevron">›</span>
                            </div>
                          </div>
                        )}
                        <div className="gx-settings-divider" />
                        <div style={{ padding: "6px 16px 4px" }}>
                          <div style={{ fontSize: 11, color: "var(--player-text-dimmer)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Volume boost</div>
                          <input
                            type="range" min={0} max={500} step={25} value={volumeBoost}
                            onChange={(e) => setVolumeBoost(Number(e.target.value))}
                            style={{ width: "100%", accentColor: "#fff" }}
                            onClick={e => e.stopPropagation()}
                          />
                          <div style={{ fontSize: 11, color: "var(--player-text-dim)", marginTop: 4, textAlign: "right" }}>{volumeBoost}%</div>
                        </div>
                        <div className="gx-settings-divider" />
                        <div className="gx-settings-row" onClick={() => { void handleDownloadCurrent(); setSettingsOpen(false); }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <IconDownload size={13} color="currentColor" />
                            Download
                          </span>
                        </div>
                        {isEmbedEngine && activeSource?.canExtract && (
                          <div className="gx-settings-row" onClick={() => { void handleExtractStream(); }} style={{ opacity: extracting ? 0.5 : 1 }}>
                            <span>{extracting ? "Extracting…" : "Extract Direct Stream"}</span>
                            <div className="gx-settings-row-val"><small style={{ fontSize: 11 }}>yt-dlp</small></div>
                          </div>
                        )}
                      </div>
                    )}

                    {settingsScreen === "quality" && (
                      <div className="gx-settings-screen">
                        <div className="gx-settings-header">
                          <button className="gx-settings-header-btn" onClick={() => setSettingsScreen("main")}>←</button>
                          Quality
                        </div>
                        <div className="gx-settings-list">
                          {isMovieBoxQualityMode ? (
                            allSources.map((source, index) => (
                              <div key={source.id} className={`gx-settings-item${index === activeIndex ? " active" : ""}`} onClick={() => { handleSourceSwitch(index); setSettingsScreen("main"); }}>
                                <span>{source.quality || source.label}</span>
                                <span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span>
                              </div>
                            ))
                          ) : (
                            <>
                              <div className={`gx-settings-item${selectedHlsLevel === -1 ? " active" : ""}`} onClick={() => { setSelectedHlsLevel(-1); if (hlsRef.current) hlsRef.current.currentLevel = -1; setSettingsScreen("main"); }}>
                                <span>Auto</span>
                                <span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span>
                              </div>
                              {[...hlsLevels].map((l, i) => ({ ...l, index: i })).sort((a, b) => b.height - a.height).map(({ height, bitrate, index }) => (
                                <div key={index} className={`gx-settings-item${selectedHlsLevel === index ? " active" : ""}`} onClick={() => { setSelectedHlsLevel(index); if (hlsRef.current) { hlsRef.current.currentLevel = index; hlsRef.current.loadLevel = index; hlsRef.current.nextLevel = index; } setSettingsScreen("main"); }}>
                                  <span>{height > 0 ? `${height}p` : `Level ${index + 1}`}</span>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    {bitrate > 0 && <small style={{ fontSize: 11, color: "var(--player-text-dimmer)" }}>{Math.round(bitrate / 1000)} kbps</small>}
                                    <span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span>
                                  </div>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {settingsScreen === "speed" && (
                      <div className="gx-settings-screen">
                        <div className="gx-settings-header">
                          <button className="gx-settings-header-btn" onClick={() => setSettingsScreen("main")}>←</button>
                          Playback Speed
                        </div>
                        <div className="gx-settings-list">
                          {[0.5, 0.75, 1, 1.25, 1.5, 2].map(speed => (
                            <div key={speed} className={`gx-settings-item${playbackSpeed === speed ? " active" : ""}`} onClick={() => { setPlaybackSpeed(speed); setSettingsScreen("main"); }}>
                              <span>{speed === 1 ? "Normal" : `${speed}×`}</span>
                              <span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {settingsScreen === "subtitles" && (
                      <div className="gx-settings-screen">
                        <div className="gx-settings-header">
                          <button className="gx-settings-header-btn" onClick={() => setSettingsScreen("main")}>←</button>
                          Subtitles
                        </div>
                        <div className="gx-settings-list">
                          <div className={`gx-settings-item${!subtitlesEnabled ? " active" : ""}`} onClick={() => { clearSubtitles(); setSettingsScreen("main"); }}>
                            <span>Off</span>
                            <span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span>
                          </div>
                          {activeSubtitles.map(track => (
                            <div key={track.url} className={`gx-settings-item${subtitlesEnabled && subtitleUrl === track.url ? " active" : ""}`} onClick={() => { handleSubtitleSelect(track.url, track.label); setSettingsScreen("main"); }}>
                              <span>{track.label}</span>
                              <span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span>
                            </div>
                          ))}
                          <div className="gx-settings-divider" />
                          <div className="gx-settings-item" onClick={() => { setShowSubtitlePanel(true); setSettingsOpen(false); }}>
                            <span>Search subtitles…</span>
                          </div>
                          <div className="gx-settings-item" onClick={() => { subtitleInputRef.current?.click(); setSettingsOpen(false); }}>
                            <span>Load from file…</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {settingsScreen === "server" && (
                      <div className="gx-settings-screen">
                        <div className="gx-settings-header">
                          <button className="gx-settings-header-btn" onClick={() => setSettingsScreen("main")}>←</button>
                          Server
                        </div>
                        <div className="gx-settings-list">
                          {sourceOptions && sourceOptions.length > 0
                            ? sourceOptions.map(option => (
                                <div key={option.id} className={`gx-settings-item${option.id === activeSourceOptionId ? " active" : ""}`} onClick={() => { void handleSourceOptionSwitch(option.id); setSettingsScreen("main"); }}>
                                  <span>{option.label}</span>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    {episodeLoading && option.id === activeSourceOptionId && <small style={{ fontSize: 11, color: "var(--player-text-dimmer)" }}>Loading…</small>}
                                    <span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span>
                                  </div>
                                </div>
                              ))
                            : allSources.map((source, index) => (
                                <div key={source.id} className={`gx-settings-item${index === activeIndex ? " active" : ""}`} onClick={() => { handleSourceSwitch(index); setSettingsScreen("main"); }}>
                                  <span>{source.label}</span>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <small style={{ fontSize: 11, color: "var(--player-text-dimmer)" }}>{formatProviderName(source.provider)}</small>
                                    <span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span>
                                  </div>
                                </div>
                              ))
                          }
                        </div>
                      </div>
                    )}

                    {settingsScreen === "episodes" && (
                      <div className="gx-settings-screen">
                        <div className="gx-settings-header">
                          <button className="gx-settings-header-btn" onClick={() => setSettingsScreen("main")}>←</button>
                          {episodeLabel}s
                        </div>
                        <div className="gx-settings-list">
                          {(episodeOptions ?? []).map(ep => (
                            <div key={ep} className={`gx-settings-item${activeEpisode === ep ? " active" : ""}`} onClick={() => { void handleEpisodeSwitch(ep); setSettingsScreen("main"); }} style={{ opacity: episodeLoading ? 0.5 : 1 }}>
                              <span>{episodeLabel} {ep}</span>
                              <span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Fullscreen */}
              <button className="gx-btn" onClick={toggleFullscreen} title="Fullscreen" aria-label="Fullscreen">
                <IconExpand size={14} color="currentColor" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
