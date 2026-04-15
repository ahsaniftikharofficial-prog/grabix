import Hls from "hls.js";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  IconAlert,
  IconArrowLeft,
  IconDownload,
  IconExpand,
  IconInfo,
  IconList,
  IconPause,
  IconPlay,
  IconSettings,
  IconSubtitle,
} from "./Icons";
import SubtitlePanel from "./SubtitlePanel";
import { BACKEND_API } from "../lib/api";
import { inferStreamKind } from "../lib/streamProviders";
import type { StreamSource } from "../lib/streamProviders";
import { queueVideoDownload } from "../lib/downloads";
import { readJsonStorage, versionedStorageKey, writeJsonStorage } from "../lib/persistentState";

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

interface SubtitleAppearanceSettings {
  fontScale: number;
  fontFamily: string;
  textColor: string;
  textOpacity: number;
  edgeStyle: "shadow" | "outline" | "raised" | "depressed" | "none";
  edgeColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  windowColor: string;
  windowOpacity: number;
}

interface SubtitlePosition {
  x: number;
  y: number;
}

const PLAYBACK_CACHE_PREFIX = "grabix:playback:";
const EMBED_CACHE_TTL_MS = 1000 * 60 * 30;
const EXTRACT_CACHE_TTL_MS = 1000 * 60 * 20;
const SUBTITLE_APPEARANCE_STORAGE_KEY = versionedStorageKey("grabix:subtitle-appearance", "v1");
const SUBTITLE_POSITION_STORAGE_KEY = versionedStorageKey("grabix:subtitle-position", "v1");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROVIDER_NAME_MAP: Record<string, string> = {
  hianime: "HiAnime",
  consumet: "Consumet",
  aniwatch: "AniWatch",
  gogoanime: "GogoAnime",
  zoro: "Zoro",
  "9anime": "9Anime",
};

function formatProviderName(provider: string): string {
  return PROVIDER_NAME_MAP[provider.trim().toLowerCase()] ?? provider;
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

// Strip VTT/HTML inline tags (e.g. <c.white>, <i>, <b>, <00:00:01.000>, &amp; etc.)
// so raw cue text can be rendered safely as plain text.
function stripVttTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")      // remove all HTML/VTT tags
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .trim();
}

function parseSubtitleText(content: string): SubtitleCue[] {
  const normalized = (content || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!normalized) return [];

  // Strip only the WEBVTT header line. NOTE / STYLE / REGION blocks can remain:
  // the parser below ignores blocks that do not contain a cue timing line.
  const withoutHeader = /^WEBVTT\b/i.test(normalized)
    ? normalized.replace(/^WEBVTT[^\n]*(?:\n|$)/i, "").trimStart()
    : normalized;

  const blocks = withoutHeader
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
    const text = stripVttTags(textLines.join("\n"));
    if (!text) continue; // skip empty cues after tag-stripping
    cues.push({ start, end, text });
  }
  return cues;
}

// O(log n) binary search — replaces O(n) .find() in the hot subtitle tick path
function findCurrentCue(cues: SubtitleCue[], t: number): SubtitleCue | null {
  let lo = 0, hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const cue = cues[mid];
    if (t < cue.start) hi = mid - 1;
    else if (t > cue.end) lo = mid + 1;
    else return cue;
  }
  return null;
}

const DEFAULT_SUBTITLE_APPEARANCE: SubtitleAppearanceSettings = {
  fontScale: 1.05,
  fontFamily: "Arial, Helvetica, sans-serif",
  textColor: "#ffffff",
  textOpacity: 1,
  edgeStyle: "shadow",
  edgeColor: "#000000",
  backgroundColor: "#000000",
  backgroundOpacity: 0.72,
  windowColor: "#000000",
  windowOpacity: 0,
};
const DEFAULT_SUBTITLE_POSITION: SubtitlePosition = { x: 0, y: 0 };

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "").trim();
  const expanded = normalized.length === 3
    ? normalized.split("").map((part) => `${part}${part}`).join("")
    : normalized.padEnd(6, "0").slice(0, 6);
  const red = Number.parseInt(expanded.slice(0, 2), 16) || 0;
  const green = Number.parseInt(expanded.slice(2, 4), 16) || 0;
  const blue = Number.parseInt(expanded.slice(4, 6), 16) || 0;
  return `rgba(${red}, ${green}, ${blue}, ${clampNumber(alpha, 0, 1)})`;
}

function subtitleFontSize(scale: number): string {
  const safeScale = clampNumber(scale, 0.8, 2.2);
  return `clamp(${(1.15 * safeScale).toFixed(2)}rem, ${(1 * safeScale).toFixed(2)}rem + ${(0.85 * safeScale).toFixed(2)}vw, ${(1.9 * safeScale).toFixed(2)}rem)`;
}

function subtitleTextShadow(style: SubtitleAppearanceSettings["edgeStyle"], color: string): string {
  switch (style) {
    case "outline":
      return [
        `1px 0 0 ${color}`,
        `-1px 0 0 ${color}`,
        `0 1px 0 ${color}`,
        `0 -1px 0 ${color}`,
        `1px 1px 0 ${color}`,
        `-1px 1px 0 ${color}`,
        `1px -1px 0 ${color}`,
        `-1px -1px 0 ${color}`,
        "0 2px 5px rgba(0,0,0,0.85)",
      ].join(", ");
    case "raised":
      return `0 1px 0 rgba(255,255,255,0.22), 1px 1px 0 ${color}, 2px 2px 4px rgba(0,0,0,0.75)`;
    case "depressed":
      return `0 -1px 0 rgba(255,255,255,0.18), -1px -1px 0 ${color}, -2px -2px 4px rgba(0,0,0,0.75)`;
    case "none":
      return "none";
    case "shadow":
    default:
      return `0 2px 4px ${color}, 0 0 10px rgba(0,0,0,0.55)`;
  }
}

function sanitizeSubtitleAppearance(raw: SubtitleAppearanceSettings): SubtitleAppearanceSettings {
  return {
    fontScale: clampNumber(Number(raw.fontScale) || DEFAULT_SUBTITLE_APPEARANCE.fontScale, 0.8, 2.2),
    fontFamily: String(raw.fontFamily || DEFAULT_SUBTITLE_APPEARANCE.fontFamily),
    textColor: String(raw.textColor || DEFAULT_SUBTITLE_APPEARANCE.textColor),
    textOpacity: clampNumber(Number(raw.textOpacity) || 0, 0, 1),
    edgeStyle: ["shadow", "outline", "raised", "depressed", "none"].includes(String(raw.edgeStyle))
      ? raw.edgeStyle
      : DEFAULT_SUBTITLE_APPEARANCE.edgeStyle,
    edgeColor: String(raw.edgeColor || DEFAULT_SUBTITLE_APPEARANCE.edgeColor),
    backgroundColor: String(raw.backgroundColor || DEFAULT_SUBTITLE_APPEARANCE.backgroundColor),
    backgroundOpacity: clampNumber(Number(raw.backgroundOpacity) || 0, 0, 1),
    windowColor: String(raw.windowColor || DEFAULT_SUBTITLE_APPEARANCE.windowColor),
    windowOpacity: clampNumber(Number(raw.windowOpacity) || 0, 0, 1),
  };
}

function sanitizeSubtitlePosition(raw: SubtitlePosition): SubtitlePosition {
  return {
    x: clampNumber(Number(raw.x) || 0, -640, 640),
    y: clampNumber(Number(raw.y) || 0, -360, 220),
  };
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
    padding: 0 8%;
  }
  .gx-cue-window {
    display: inline-block;
    max-width: min(96vw, 1200px);
    border-radius: 8px;
    pointer-events: auto;
    cursor: grab;
    user-select: none;
  }
  .gx-cue-window.dragging { cursor: grabbing; }
  .gx-cue span {
    display: inline-block;
    max-width: min(92vw, 1100px);
    border-radius: 6px;
    white-space: pre-line;
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
    width: 40px; height: 40px;
    display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: 8px;
    color: #fff; cursor: pointer;
    transition: background var(--player-transition);
    flex-shrink: 0;
  }
  .gx-btn:hover { background: rgba(255,255,255,0.1); }
  .gx-btn:disabled { opacity: 0.35; cursor: default; }
  .gx-btn.lg { width: 44px; height: 44px; border-radius: 10px; }
  .gx-btn.dim { color: rgba(255,255,255,0.4); }
  .gx-btn.dim:hover { color: #fff; }

  /* Volume area */
  .gx-volume-wrap { position: relative; display: flex; align-items: center; }
  .gx-volume-slider-container {
    position: absolute; bottom: calc(100% + 8px); left: 50%;
    transform: translateX(-50%);
    background: var(--player-surface);
    border: 1px solid var(--player-border);
    border-radius: 10px; padding: 14px 12px 10px;
    backdrop-filter: blur(20px);
    opacity: 0; pointer-events: none;
    transition: opacity var(--player-transition);
    z-index: 50;
    min-width: 44px;
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
  .gx-boost-divider { height: 1px; background: var(--player-border); margin: 10px 0 8px; }
  .gx-boost-label { font-size: 9px; color: var(--player-text-dimmer); text-transform: uppercase; letter-spacing: 0.08em; text-align: center; margin-bottom: 6px; }
  .gx-boost-slider {
    writing-mode: vertical-lr; direction: rtl;
    width: 4px; height: 60px;
    appearance: none; -webkit-appearance: none;
    background: var(--player-progress-bg);
    border-radius: 99px; cursor: pointer; outline: none;
    accent-color: rgba(255,255,255,0.7);
  }
  .gx-boost-slider::-webkit-slider-thumb {
    appearance: none; -webkit-appearance: none;
    width: 10px; height: 10px;
    background: rgba(255,255,255,0.7); border-radius: 50%;
  }
  .gx-boost-val { font-size: 9px; color: var(--player-text-dim); text-align: center; margin-top: 4px; }

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
  .gx-settings-field { display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; }
  .gx-settings-field label { font-size: 11px; color: var(--player-text-dim); text-transform: uppercase; letter-spacing: 0.08em; }
  .gx-settings-field input[type="range"] { width: 100%; accent-color: #ffffff; }
  .gx-settings-field input[type="color"] { width: 100%; height: 34px; border: none; background: transparent; cursor: pointer; }
  .gx-settings-field select {
    width: 100%;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    color: #fff;
    padding: 8px 10px;
    font-size: 13px;
  }
  .gx-settings-split { display: grid; grid-template-columns: minmax(0, 1fr) 72px; gap: 10px; align-items: center; }
  .gx-settings-value { font-size: 12px; color: var(--player-text-dim); text-align: right; }
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
    background: radial-gradient(circle at center, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0.56) 100%);
  }
  .gx-spinner-panel {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 10px;
  }
  .gx-spinner {
    width: 32px; height: 32px;
    border: 2px solid rgba(255,255,255,0.15);
    border-top-color: #fff;
    border-radius: 50%;
    animation: gx-spin 0.8s linear infinite;
  }
  @keyframes gx-spin { to { transform: rotate(360deg); } }
  .gx-spinner-label {
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.01em;
    text-shadow: 0 1px 3px rgba(0,0,0,0.65);
  }

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
    width: 40px; height: 40px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; flex-shrink: 0;
    transition: background var(--player-transition);
  }
  .gx-skip-btn:hover { background: rgba(255,255,255,0.1); }

  /* Speed label chip */
  .gx-speed-label {
    font-size: 10px; font-weight: 800; color: #fff;
    letter-spacing: -0.5px;
  }
`;

// Inject styles once at module load — never re-diffed by React VDOM
if (typeof document !== "undefined") {
  if (!document.getElementById("gx-player-styles")) {
    const _s = document.createElement("style");
    _s.id = "gx-player-styles";
    _s.textContent = PLAYER_STYLES;
    document.head.appendChild(_s);
  }
}

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
  const previewHlsRef = useRef<Hls | null>(null);
  const [hlsLevels, setHlsLevels] = useState<Array<{ height: number; bitrate: number }>>([]);
  const [selectedHlsLevel, setSelectedHlsLevel] = useState<number>(-1);
  const [hlsAutoQuality, setHlsAutoQuality] = useState(true);
  const hideChromeTimeoutRef = useRef<number | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const mediaNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const embedLoadedRef = useRef(false);
  const progressBarWidthRef = useRef(0);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const sourceRetryCountsRef = useRef<Record<string, number>>({});

  // Thumbnail preview refs
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewThrottleRef = useRef<number>(0);
  const previewHoveringRef = useRef(false);
  const previewSeekedCleanupRef = useRef<(() => void) | null>(null);

  // Direct-DOM refs for progress bar — bypass React for the 4–25×/sec timeupdate hot path
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);

  // Subtitle refs — binary search tick, avoids O(n) scan + avoids redundant setState
  const subtitleCuesRef = useRef<SubtitleCue[]>([]);
  const currentCueRef = useRef("");

  // State-mirror refs for showControls stale-closure fix
  const isPlayingRef = useRef(true);
  const errorTextRef = useRef("");
  const settingsOpenRef = useRef(false);
  const episodeMenuOpenRef = useRef(false);

  // Subtitle tick — called from handleTimeUpdate, no React involvement unless cue changes
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
  const [volumeBoost, setVolumeBoost] = useState(100);
  const [isPlaying, setIsPlaying] = useState(true);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [subtitleUrl, setSubtitleUrl] = useState("");
  const [subtitleName, setSubtitleName] = useState("");
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [showSubtitlePanel, setShowSubtitlePanel] = useState(false);
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [currentCue, setCurrentCue] = useState("");
  const [activeSourceOptionId, setActiveSourceOptionId] = useState(sourceOptions?.[0]?.id ?? "");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [, setIsFullscreen] = useState(false);
  const [subtitleAppearance, setSubtitleAppearance] = useState<SubtitleAppearanceSettings>(() =>
    sanitizeSubtitleAppearance(
      readJsonStorage<SubtitleAppearanceSettings>("local", SUBTITLE_APPEARANCE_STORAGE_KEY, DEFAULT_SUBTITLE_APPEARANCE)
    )
  );
  const [subtitlePosition, setSubtitlePosition] = useState<SubtitlePosition>(() =>
    sanitizeSubtitlePosition(
      readJsonStorage<SubtitlePosition>("local", SUBTITLE_POSITION_STORAGE_KEY, DEFAULT_SUBTITLE_POSITION)
    )
  );
  const [draggingSubtitle, setDraggingSubtitle] = useState(false);
  const subtitleDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  // Settings panel
  const [settingsOpen, setSettingsOpen] = useState(false);
  type SettingsScreen = "main" | "quality" | "speed" | "subtitles" | "subtitleAppearance" | "server" | "episodes";
  const [settingsScreen, setSettingsScreen] = useState<SettingsScreen>("main");

  // Thumbnail hover preview
  const [hoverPreview, setHoverPreview] = useState<{
    x: number; time: number; dataUrl: string; visible: boolean;
  } | null>(null);

  // Derived — memoized so downstream useCallbacks don't re-create on every render
  const activeSource = allSources[activeIndex] ?? null;
  const activeSubtitles = activeSource?.subtitles ?? [];
  const hasFallback = activeIndex < allSources.length - 1;
  const isMovieBoxQualityMode = useMemo(
    () => allSources.length > 0 && allSources.every(s => s.provider.toLowerCase().includes("moviebox") || s.provider.toLowerCase().includes("movie box")),
    [allSources]
  );
  const isDirectEngine = useMemo(
    () => activeSource?.kind === "direct" || activeSource?.kind === "hls" || activeSource?.kind === "local",
    [activeSource]
  );
  const isEmbedEngine = useMemo(() => activeSource?.kind === "embed", [activeSource]);
  const isAnimeQualityMode = useMemo(
    () => allSources.length > 1 && allSources.every(s => Boolean(s.quality) && !s.provider.toLowerCase().includes("moviebox")),
    [allSources]
  );
  const hasQualityOptions = useMemo(
    () => hlsLevels.length > 1 || isMovieBoxQualityMode || isAnimeQualityMode,
    [hlsLevels, isMovieBoxQualityMode, isAnimeQualityMode]
  );
  const hasAdaptiveHlsLevels = hlsLevels.length > 1;
  const subtitleWindowStyle = useMemo<CSSProperties>(() => ({
    background: hexToRgba(subtitleAppearance.windowColor, subtitleAppearance.windowOpacity),
    padding: subtitleAppearance.windowOpacity > 0 ? "0.18em 0.36em" : 0,
  }), [subtitleAppearance]);
  const subtitleTextStyle = useMemo<CSSProperties>(() => {
    const edgeColor = hexToRgba(subtitleAppearance.edgeColor, 1);
    return {
      background: hexToRgba(subtitleAppearance.backgroundColor, subtitleAppearance.backgroundOpacity),
      color: hexToRgba(subtitleAppearance.textColor, subtitleAppearance.textOpacity),
      padding: "0.28em 0.6em",
      fontSize: subtitleFontSize(subtitleAppearance.fontScale),
      lineHeight: 1.4,
      fontWeight: 600,
      letterSpacing: "0.01em",
      fontFamily: subtitleAppearance.fontFamily,
      textShadow: subtitleTextShadow(subtitleAppearance.edgeStyle, edgeColor),
      WebkitTextStroke: subtitleAppearance.edgeStyle === "outline" ? `0.45px ${edgeColor}` : undefined,
    };
  }, [subtitleAppearance]);

  useEffect(() => {
    writeJsonStorage("local", SUBTITLE_APPEARANCE_STORAGE_KEY, subtitleAppearance);
  }, [subtitleAppearance]);
  useEffect(() => {
    writeJsonStorage("local", SUBTITLE_POSITION_STORAGE_KEY, subtitlePosition);
  }, [subtitlePosition]);

  useEffect(() => {
    setRuntimeSources(sources ?? []);
    setActiveSubtitleText(subtitle || "");
    setActiveSearchTitle(subtitleSearchTitle || title);
    setActiveEpisode(currentEpisode ?? null);
  }, [sources, subtitle, subtitleSearchTitle, currentEpisode, title]);

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
    const onUp = () => {
      subtitleDragRef.current = null;
      setDraggingSubtitle(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingSubtitle]);

  useEffect(() => { setActiveSourceOptionId(sourceOptions?.[0]?.id ?? ""); }, [sourceOptions]);

  // Keep state-mirror refs in sync (used by showControls to avoid stale closures)
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { errorTextRef.current = errorText; }, [errorText]);
  useEffect(() => { settingsOpenRef.current = settingsOpen; }, [settingsOpen]);
  useEffect(() => { episodeMenuOpenRef.current = episodeMenuOpen; }, [episodeMenuOpen]);
  useEffect(() => { subtitleCuesRef.current = subtitleCues; }, [subtitleCues]);

  // Chrome visibility — stable forever (no stale closures; all state reads via refs)
  const showControls = useCallback(() => {
    setShowChrome(true);
    if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current);
    if (errorTextRef.current || settingsOpenRef.current || episodeMenuOpenRef.current) return;
    hideChromeTimeoutRef.current = window.setTimeout(() => {
      if (isPlayingRef.current && !errorTextRef.current) setShowChrome(false);
    }, 3000);
  }, []);

  useEffect(() => { setActiveIndex(0); setHlsLevels([]); setSelectedHlsLevel(-1); setHlsAutoQuality(true); }, [baseSources]);
  useEffect(() => { showControls(); return () => { if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current); }; }, [episodeMenuOpen, showSubtitlePanel, settingsOpen, showControls]);

  // Keep controls visible when paused or errored
  useEffect(() => {
    if (!isPlaying || errorText) {
      setShowChrome(true);
      if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current);
    }
  }, [isPlaying, errorText]);

  // Auto-dismiss floating notice after 4 seconds
  useEffect(() => {
    if (!fallbackNotice) return;
    const t = window.setTimeout(() => setFallbackNotice(""), 4000);
    return () => window.clearTimeout(t);
  }, [fallbackNotice]);

  // Fullscreen listener
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
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
      // NOTE: do NOT destroy HLS here. HLS is already destroyed in the
      // [activeSource, isDirectEngine, reloadKey, resolvedPlaybackUrl] effect
      // cleanup. Destroying it here too would kill the stream every time the
      // subtitle URL changes (e.g. on CC toggle), resetting playback to 0.
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
    const currentSourceKey = activeSource ? `${activeIndex}:${activeSource.externalUrl || activeSource.url}` : String(activeIndex);
    const currentRetryCount = sourceRetryCountsRef.current[currentSourceKey] ?? 0;
    const canRetryCurrentSource =
      Boolean(activeSource) &&
      (activeSource.kind === "hls" || activeSource.kind === "direct") &&
      currentRetryCount < 5;

    if (canRetryCurrentSource) {
      sourceRetryCountsRef.current[currentSourceKey] = currentRetryCount + 1;
      setErrorText("");
      setIsLoading(true);
      setIsPlaying(false);
      setStatusText("Retrying");
      setFallbackNotice(`${message} Retrying stream (${currentRetryCount + 1}/5)...`);
      setReloadKey((key) => key + 1);
      return;
    }
    if (hasFallback) {
      const immediateNextIndex = activeIndex + 1;
      const preparedSiblingIndex = findPreparedSiblingIndex(immediateNextIndex);
      const nextIndex = preparedSiblingIndex >= 0 ? preparedSiblingIndex : immediateNextIndex;
      const nextSource = allSources[nextIndex];
      sourceRetryCountsRef.current[currentSourceKey] = 0;
      setFallbackNotice(`${message} Switched to ${nextSource.label} (${nextSource.provider}).`);
      setActiveIndex(nextIndex);
      setReloadKey((key) => key + 1);
      return;
    }
    sourceRetryCountsRef.current[currentSourceKey] = 0;
    setErrorText(message);
    setIsLoading(false);
    setStatusText("Failed");
  };

  // Source setup
  useEffect(() => {
    setIsLoading(true);
    setIsPlaying(false);
    setErrorText("");
    setStatusText(activeSource ? `Loading ${activeSource.provider}` : "No source");
    setResolvedEmbedUrl("");
    setEpisodeMenuOpen(false);
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
          setFallbackNotice("Stream is taking a while and is still connecting. Use the server picker to switch if needed.");
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
    setResolvedPlaybackUrl("");
  }, [activeSource]);

  // Direct / HLS playback effect
  useEffect(() => {
    if (!activeSource || !isDirectEngine) return;
    const video = videoRef.current;
    if (!video) return;
    let bufferTimeoutId: number | null = null;
    const clearBufferTimeout = () => {
      if (bufferTimeoutId !== null) {
        window.clearTimeout(bufferTimeoutId);
        bufferTimeoutId = null;
      }
    };
    const armBufferTimeout = () => {
      clearBufferTimeout();
      bufferTimeoutId = window.setTimeout(() => {
        if (!video.paused) {
          goToNextSource("media_error");
        }
      }, 12000);
    };
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    video.pause();
    video.removeAttribute("src");
    video.load();
    currentTimeRef.current = 0;
    durationRef.current = 0;
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
      const d = video.duration || 0;
      durationRef.current = d;
      setDuration(d);
      if (rangeRef.current) rangeRef.current.max = String(d);
    };
    const handleLoadedData = () => markSourceReady("Ready");
    const handleError = () => { sourceReady = true; goToNextSource(activeSource.kind === "local" ? "open_failed" : "media_error"); };
    const handleWaiting = () => { setIsLoading(true); setStatusText("Buffering"); armBufferTimeout(); };
    const handleStalled = () => { setIsLoading(true); setStatusText("Buffering"); armBufferTimeout(); };
    const handlePlaying = () => {
      sourceReady = true;
      clearBufferTimeout();
      const currentSourceKey = `${activeIndex}:${activeSource.externalUrl || activeSource.url}`;
      sourceRetryCountsRef.current[currentSourceKey] = 0;
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
      const t = video.currentTime;
      const d = durationRef.current || video.duration || 0;
      currentTimeRef.current = t;
      // Update progress bar DOM directly — zero React involvement on this hot path
      const pct = d > 0 ? Math.min((t / d) * 100, 100) : 0;
      const pctStr = `${pct}%`;
      if (fillRef.current) fillRef.current.style.width = pctStr;
      if (thumbRef.current) thumbRef.current.style.left = pctStr;
      if (rangeRef.current) rangeRef.current.value = String(t);
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = formatTime(t);
      if (bufferRef.current && video.buffered.length > 0 && d > 0) {
        bufferRef.current.style.width = `${(video.buffered.end(video.buffered.length - 1) / d) * 100}%`;
      }
      // Subtitle lookup via binary search — only setState when cue actually changes
      subtitleTickRef.current(t);
    };
    const handleDurationChange = () => {
      const d = video.duration || 0;
      durationRef.current = d;
      setDuration(d);
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
      const defaultUrl = shouldKeepHlsProxied(activeSource) ? buildStreamProxyUrl(API, activeSource.url, activeSource.requestHeaders) : activeSource.url;
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
            setSelectedHlsLevel(-1);
            setHlsAutoQuality(true);
            hls.currentLevel = -1;
            hls.loadLevel = -1;
            hls.nextLevel = -1;
          }
          setStatusText("Buffering");
          void attemptPlayback();
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
          setSelectedHlsLevel(typeof data.level === "number" ? data.level : -1);
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
      clearBufferTimeout();
      window.clearTimeout(startupTimeout);
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

  // Thumbnail preview video source
  useEffect(() => {
    if (!isDirectEngine || !activeSource?.url) return;
    const pv = previewVideoRef.current;
    if (!pv) return;
    if (previewHlsRef.current) {
      previewHlsRef.current.destroy();
      previewHlsRef.current = null;
    }
    if (activeSource.kind === "hls") {
      const url = resolvedPlaybackUrl || (shouldKeepHlsProxied(activeSource) ? buildStreamProxyUrl(API, activeSource.url, activeSource.requestHeaders) : activeSource.url);
      if (Hls.isSupported()) {
        const previewHls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          startFragPrefetch: false,
          maxBufferLength: 8,
          maxMaxBufferLength: 16,
          backBufferLength: 8,
          manifestLoadingMaxRetry: 1,
          fragLoadingMaxRetry: 1,
          levelLoadingMaxRetry: 1,
        });
        previewHlsRef.current = previewHls;
        previewHls.attachMedia(pv);
        previewHls.on(Hls.Events.MEDIA_ATTACHED, () => { previewHls.loadSource(url); });
      } else {
        pv.src = url;
      }
    } else {
      pv.src = activeSource.url;
    }
    pv.muted = true;
    pv.preload = "metadata";
    return () => {
      if (previewHlsRef.current) {
        previewHlsRef.current.destroy();
        previewHlsRef.current = null;
      }
    };
  }, [API, activeSource, isDirectEngine, resolvedPlaybackUrl]);

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
    currentCueRef.current = "";
    setSubtitleUrl(""); setSubtitleName(""); setSubtitlesEnabled(false); setSubtitleCues([]); setCurrentCue("");
  }, [activeSource]);

  useEffect(() => {
    if (!subtitleUrl || subtitleUrl.startsWith("blob:")) return;
    let cancelled = false;

    const fetchSubtitleContent = async (): Promise<string> => {
      // Fast path: try fetching the subtitle URL directly.
      // This works for CORS-permissive sources (e.g. OpenSubtitles, local blobs).
      try {
        const directCtrl = new AbortController();
        const directTimer = window.setTimeout(() => directCtrl.abort(), 6000);
        try {
          const res = await fetch(subtitleUrl, { signal: directCtrl.signal });
          if (res.ok) return await res.text();
        } finally {
          window.clearTimeout(directTimer);
        }
      } catch {
        // CORS policy, missing Referer, or network error.
        // Some subtitle CDNs fail here and need the backend proxy.
      }

      // Backend proxy path: the server has no CORS restrictions and forwards
      // the correct Referer/headers to CDN subtitle endpoints.
      const proxyUrl =
        `${API}/subtitles/download?url=${encodeURIComponent(subtitleUrl)}` +
        `&title=subtitle&language=en&type=anime&source=player&format=vtt`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`Subtitle proxy failed with ${res.status}`);
      return await res.text();
    };

    fetchSubtitleContent()
      .then((content) => {
        if (cancelled) return;
        const cues = parseSubtitleText(content);
        setSubtitleCues(cues);
        if (!cues.length) {
          setFallbackNotice("Subtitles loaded but no cues were found. The file may be empty or use an unsupported format.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSubtitleCues([]);
          setSubtitlesEnabled(false);
          setFallbackNotice("Could not load subtitles. The CDN blocked the request. Try a different server or load a local file.");
        }
      });

    return () => { cancelled = true; };
  }, [subtitleUrl]);

  useEffect(() => {
    // When subtitle cues are cleared, reset the displayed cue immediately
    if (!subtitleCues.length) {
      currentCueRef.current = "";
      setCurrentCue("");
    }
  }, [subtitleCues]);

  // Playback speed sync
  useEffect(() => {
    const v = videoRef.current;
    if (v && isDirectEngine) v.playbackRate = playbackSpeed;
  }, [playbackSpeed, isDirectEngine]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSourceSwitch = (index: number) => {
    setIsLoading(true); setIsPlaying(false); setDuration(0);
    const nextSource = allSources[index];
    if (nextSource) {
      sourceRetryCountsRef.current[`${index}:${nextSource.externalUrl || nextSource.url}`] = 0;
    }
    setActiveIndex(index); setErrorText(""); setFallbackNotice("Switching stream..."); setExtractError("");
    setReloadKey((key) => key + 1); setEpisodeMenuOpen(false);
    setSettingsOpen(false); showControls();
  };

  const updateSubtitleAppearance = <K extends keyof SubtitleAppearanceSettings>(key: K, value: SubtitleAppearanceSettings[K]) => {
    setSubtitleAppearance((current) => sanitizeSubtitleAppearance({ ...current, [key]: value }));
  };

  const resetSubtitleAppearance = () => {
    setSubtitleAppearance(DEFAULT_SUBTITLE_APPEARANCE);
  };

  const resetSubtitlePosition = () => {
    setSubtitlePosition(DEFAULT_SUBTITLE_POSITION);
  };

  const handleSubtitleDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    subtitleDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: subtitlePosition.x,
      originY: subtitlePosition.y,
    };
    setDraggingSubtitle(true);
  };

  const handleEpisodeSwitch = async (episode: number) => {
    if ((!onSelectEpisode && !onSelectSourceOption) || episodeLoading || episode === activeEpisode) return;
    setEpisodeLoading(true); setIsLoading(true); setIsPlaying(false); setErrorText(""); setFallbackNotice(`Loading ${episodeLabel.toLowerCase()} ${episode}...`);
    try {
      const preferredProvider = activeSource?.provider;
      const preferredLabel = activeSource?.label;
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
      setReloadKey((key) => key + 1); setEpisodeMenuOpen(false); setSettingsOpen(false);
    } catch (error) { setFallbackNotice(error instanceof Error ? error.message : `Could not load ${episodeLabel.toLowerCase()} ${episode}.`); }
    finally { setEpisodeLoading(false); }
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
        try {
          next = await onSelectSourceOption(optionId, targetEpisode);
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 5) {
            setFallbackNotice(`Switching server... retrying link fetch (${attempt}/5)`);
            await new Promise((resolve) => window.setTimeout(resolve, 250));
          }
        }
      }
      if (!next) throw lastError instanceof Error ? lastError : new Error("Could not switch server.");
      extractedSourcesRef.current = []; setExtractedSources([]); setRuntimeSources(next.sources);
      setActiveSubtitleText(next.subtitle || ""); setActiveSearchTitle(next.subtitleSearchTitle || title);
      setActiveIndex(0); setReloadKey((key) => key + 1);
      setSettingsOpen(false);
    } catch (error) { setFallbackNotice(error instanceof Error ? error.message : "Could not switch server."); }
    finally { setEpisodeLoading(false); }
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
    } catch { /* Ignore */ }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const nextTime = Number(e.target.value);
    video.currentTime = nextTime;
    currentTimeRef.current = nextTime;
    const d = durationRef.current || video.duration || 0;
    const pct = d > 0 ? Math.min((nextTime / d) * 100, 100) : 0;
    if (fillRef.current) fillRef.current.style.width = `${pct}%`;
    if (thumbRef.current) thumbRef.current.style.left = `${pct}%`;
    if (timeDisplayRef.current) timeDisplayRef.current.textContent = formatTime(nextTime);
    showControls();
  };

  const onSubtitlePicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (subtitleUrl.startsWith("blob:")) URL.revokeObjectURL(subtitleUrl);
    currentCueRef.current = "";
    setSubtitleUrl("");
    setSubtitleName(file.name);
    setSubtitlesEnabled(true);
    setSubtitleCues([]);
    setCurrentCue("");
    setShowSubtitlePanel(false);
    void file.text()
      .then((content) => {
        const cues = parseSubtitleText(content);
        setSubtitleCues(cues);
        setFallbackNotice(
          cues.length > 0
            ? `Loaded subtitles: ${file.name}`
            : `Loaded ${file.name}, but no subtitle cues were found.`
        );
      })
      .catch(() => {
        setSubtitleName("");
        setSubtitlesEnabled(false);
        setSubtitleCues([]);
        setCurrentCue("");
        setFallbackNotice(`Could not read subtitle file: ${file.name}`);
      });
    event.target.value = "";
  };

  const handleSubtitleSelect = (url: string, label: string) => {
    if (subtitleUrl.startsWith("blob:") && subtitleUrl !== url) URL.revokeObjectURL(subtitleUrl);
    setSubtitleUrl(url); setSubtitleName(label); setSubtitlesEnabled(true);
    currentCueRef.current = "";
    setSubtitleCues([]); setCurrentCue("");
    setShowSubtitlePanel(false); setFallbackNotice(`Loaded subtitles: ${label}`);
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
      // Turn subtitles ON — reload the first available track.
      // We always clear cues first so the fetch useEffect re-runs even if
      // the URL hasn't changed (e.g. toggling off then on again).
      const firstSubtitle = activeSubtitles[0];
      if (firstSubtitle?.url) {
        if (subtitleUrl.startsWith("blob:") && subtitleUrl !== firstSubtitle.url) URL.revokeObjectURL(subtitleUrl);
        setSubtitleUrl("");                         // force useEffect to re-fire on next tick
        setSubtitleCues([]); setCurrentCue("");
        setTimeout(() => {
          setSubtitleUrl(firstSubtitle.url);
          setSubtitleName(firstSubtitle.label);
          setSubtitlesEnabled(true);
        }, 0);
      }
      return;
    }
    if (disableSubtitleSearch) { return; }
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

  // Progress bar hover (thumbnail preview)
  const handleProgressHover = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    previewHoveringRef.current = true;
    const d = durationRef.current;
    if (!d) return;
    const rect = e.currentTarget.getBoundingClientRect();
    progressBarWidthRef.current = rect.width;
    const ratio = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
    const hoverTime = ratio * d;
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
      pv.removeEventListener("seeked", onSeeked);
      previewSeekedCleanupRef.current = null;
    };
    const onSeeked = () => { drawPreviewFrame(); };
    const seekToHoverTime = () => {
      try {
        pv.currentTime = hoverTime;
      } catch {
        setHoverPreview({ x, time: hoverTime, dataUrl: "", visible: true });
      }
    };
    if (pv.readyState < 1) {
      const onLoadedMetadata = () => {
        pv.removeEventListener("loadedmetadata", onLoadedMetadata);
        seekToHoverTime();
      };
      pv.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
      pv.load();
      setHoverPreview({ x, time: hoverTime, dataUrl: "", visible: true });
    } else {
      seekToHoverTime();
    }
    pv.addEventListener("seeked", onSeeked);
    previewSeekedCleanupRef.current = () => pv.removeEventListener("seeked", onSeeked);
  }, [isDirectEngine]);

  const handleProgressLeave = () => {
    previewHoveringRef.current = false;
    if (previewSeekedCleanupRef.current) { previewSeekedCleanupRef.current(); previewSeekedCleanupRef.current = null; }
    setHoverPreview(null);
  };

  // Settings helpers
  const currentQualityLabel = hlsAutoQuality || selectedHlsLevel === -1
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
      onMouseMove={showControls}
      onClick={handleShellClick}
    >
      <input ref={subtitleInputRef} type="file" accept=".vtt,.srt,text/vtt,application/x-subrip,.sub,.txt" style={{ display: "none" }} onChange={onSubtitlePicked} />
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
          onClick={(event) => { event.stopPropagation(); setShowSubtitlePanel(false); setSettingsOpen(false); togglePlayback(); }}
        >
        </video>
      )}

      {/* ---- Subtitle Cue ---- */}
      {currentCue && isDirectEngine && (
        <div className="gx-cue" style={{ bottom: showChrome ? 90 : 24, transform: `translate(${subtitlePosition.x}px, ${subtitlePosition.y}px)` }}>
          <div
            className={`gx-cue-window${draggingSubtitle ? " dragging" : ""}`}
            style={subtitleWindowStyle}
            onMouseDown={handleSubtitleDragStart}
            title="Drag subtitles"
          >
            <span style={subtitleTextStyle}>{currentCue}</span>
          </div>
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
          <div className="gx-spinner-panel">
            <div className="gx-spinner" />
            <div className="gx-spinner-label">{statusText || "Loading"}</div>
          </div>
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
        <IconArrowLeft size={18} color="currentColor" />
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
                <div ref={bufferRef} className="gx-progress-buffer" style={{ width: "0%" }} />
                <div ref={fillRef} className="gx-progress-fill" style={{ width: "0%" }} />
                <div ref={thumbRef} className="gx-progress-thumb" style={{ left: "0%" }} />
                <input
                  ref={rangeRef}
                  className="gx-progress-input"
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.1}
                  defaultValue={0}
                  onChange={handleSeek}
                />
              </div>
            </div>
          )}

          {/* Controls row */}
          <div className="gx-ctrl-row">

            {/* Left group: play/pause | skip-back | skip-forward | volume */}
            <div className="gx-ctrl-left">
              {isDirectEngine && (
                <>
                  {/* Play/Pause — leftmost, largest */}
                  <button className="gx-btn" onClick={togglePlayback} title={isPlaying ? "Pause" : "Play"} aria-label={isPlaying ? "Pause" : "Play"} style={{ width: 44, height: 44 }}>
                    {isPlaying
                      ? <IconPause size={22} color="currentColor" />
                      : <IconPlay size={22} color="currentColor" />
                    }
                  </button>

                  {/* Skip back 10s */}
                  <button className="gx-skip-btn" title="Back 10s" onClick={() => { const v = videoRef.current; if (v) v.currentTime = Math.max(v.currentTime - 10, 0); }}>
                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13 4.5C8.3 4.5 4.5 8.3 4.5 13S8.3 21.5 13 21.5 21.5 17.7 21.5 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                      <path d="M13 4.5L9 2M13 4.5L9 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      <text x="13.2" y="15" textAnchor="middle" fill="currentColor" fontSize="7.5" fontWeight="700" fontFamily="system-ui,-apple-system,sans-serif">10</text>
                    </svg>
                  </button>

                  {/* Skip forward 10s */}
                  <button className="gx-skip-btn" title="Forward 10s" onClick={() => { const v = videoRef.current; if (v) v.currentTime = Math.min(v.currentTime + 10, duration); }}>
                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13 4.5C17.7 4.5 21.5 8.3 21.5 13S17.7 21.5 13 21.5 4.5 17.7 4.5 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                      <path d="M13 4.5L17 2M13 4.5L17 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      <text x="12.8" y="15" textAnchor="middle" fill="currentColor" fontSize="7.5" fontWeight="700" fontFamily="system-ui,-apple-system,sans-serif">10</text>
                    </svg>
                  </button>

                  {/* Volume */}
                  <div className="gx-volume-wrap">
                    <button
                      className="gx-btn"
                      title={isMuted ? "Unmute" : "Mute"}
                      onClick={() => { const v = videoRef.current; if (v) { v.muted = !v.muted; setIsMuted(v.muted); } }}
                    >
                      {isMuted || volume === 0
                        ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                        : volume < 0.5
                          ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                          : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                      }
                    </button>
                    <div className="gx-volume-slider-container">
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <input
                          type="range" min={0} max={1} step={0.02}
                          value={isMuted ? 0 : volume}
                          className="gx-volume-slider"
                          onChange={(e) => { const v = videoRef.current; if (v) { v.volume = Number(e.target.value); v.muted = Number(e.target.value) === 0; } }}
                          onClick={e => e.stopPropagation()}
                        />
                        {isDirectEngine && (
                          <>
                            <div className="gx-boost-divider" />
                            <div className="gx-boost-label">Boost</div>
                            <input
                              type="range" min={100} max={500} step={25} value={volumeBoost}
                              className="gx-boost-slider"
                              onChange={(e) => setVolumeBoost(Number(e.target.value))}
                              onClick={e => e.stopPropagation()}
                            />
                            <div className="gx-boost-val">{volumeBoost}%</div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Center: time */}
            {isDirectEngine && (
              <div className="gx-ctrl-center">
                <span ref={timeDisplayRef}>0:00</span> / {formatTime(duration)}
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
                <IconSubtitle size={20} color="currentColor" />
              </button>

              {/* Episode picker */}
              {episodeOptions && episodeOptions.length > 0 && (
                <div className="gx-ep-wrap">
                  <button
                    className="gx-btn"
                    title={episodeLabel}
                    onClick={(e) => { e.stopPropagation(); setSettingsOpen(false); setSettingsScreen("main"); setEpisodeMenuOpen(open => !open); }}
                  >
                    <IconList size={20} color="currentColor" />
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
                  onClick={(e) => { e.stopPropagation(); setEpisodeMenuOpen(false); setSettingsOpen(open => !open); setSettingsScreen("main"); }}
                >
                  <IconSettings size={20} color="currentColor" />
                </button>

                {settingsOpen && (
                  <div className="gx-settings-panel" style={{ bottom: "calc(100% + 8px)", top: "auto", right: 0 }} data-settings="true">
                    {settingsScreen === "main" && (
                      <div className="gx-settings-screen" style={{ padding: "4px 0 6px" }}>
                        {hasQualityOptions && (
                          <div className="gx-settings-row" onClick={() => setSettingsScreen("quality")}>
                            <span>Quality</span>
                            <div className="gx-settings-row-val">
                              <span>{hasAdaptiveHlsLevels ? currentQualityLabel : (allSources[activeIndex]?.quality ?? activeSource?.label ?? "Auto")}</span>
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
                        {(activeSubtitles.length > 0 || Boolean(subtitleUrl) || !disableSubtitleSearch) && (
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
                          {!hasAdaptiveHlsLevels && (isMovieBoxQualityMode || isAnimeQualityMode) ? (
                            allSources.map((source, index) => (
                              <div key={source.id} className={`gx-settings-item${index === activeIndex ? " active" : ""}`} onClick={() => { handleSourceSwitch(index); setSettingsScreen("main"); }}>
                                <span>{source.quality || source.label}</span>
                                <span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span>
                              </div>
                            ))
                          ) : (
                            <>
                              <div className={`gx-settings-item${hlsAutoQuality ? " active" : ""}`} onClick={() => { setHlsAutoQuality(true); setSelectedHlsLevel(-1); if (hlsRef.current) { hlsRef.current.currentLevel = -1; hlsRef.current.loadLevel = -1; hlsRef.current.nextLevel = -1; } setSettingsScreen("main"); }}>
                                <span>Auto</span>
                                <span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span>
                              </div>
                              {[...hlsLevels].map((l, i) => ({ ...l, index: i })).sort((a, b) => b.height - a.height).map(({ height, bitrate, index }) => (
                                <div key={index} className={`gx-settings-item${!hlsAutoQuality && selectedHlsLevel === index ? " active" : ""}`} onClick={() => { setHlsAutoQuality(false); setSelectedHlsLevel(index); if (hlsRef.current) { hlsRef.current.currentLevel = index; hlsRef.current.loadLevel = index; hlsRef.current.nextLevel = index; } setSettingsScreen("main"); }}>
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
                          <button className="gx-settings-header-btn" onClick={() => setSettingsScreen("main")}>{"<"}</button>
                          Subtitles
                        </div>
                        <div className="gx-settings-list">
                          <div className={`gx-settings-item${!subtitlesEnabled ? " active" : ""}`} onClick={() => { clearSubtitles(); setSettingsScreen("main"); }}>
                            <span>Off</span>
                            <span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>OK</span>
                          </div>
                          {activeSubtitles.map(track => (
                            <div key={track.url} className={`gx-settings-item${subtitlesEnabled && subtitleUrl === track.url ? " active" : ""}`} onClick={() => { handleSubtitleSelect(track.url, track.label); setSettingsScreen("main"); }}>
                              <span>{track.label}</span>
                              <span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>OK</span>
                            </div>
                          ))}
                          <div className="gx-settings-divider" />
                          <div className="gx-settings-item" onClick={() => setSettingsScreen("subtitleAppearance")}>
                            <span>Appearance</span>
                            <div className="gx-settings-row-val">
                              <span style={{ color: "var(--player-text-dimmer)" }}>Size and background</span>
                              <span className="gx-settings-chevron">{">"}</span>
                            </div>
                          </div>
                          <div className="gx-settings-item" onClick={() => { setShowSubtitlePanel(true); setSettingsOpen(false); }}>
                            <span>Search subtitles...</span>
                          </div>
                          <div className="gx-settings-item" onClick={() => { subtitleInputRef.current?.click(); setSettingsOpen(false); }}>
                            <span>Load from file...</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {settingsScreen === "subtitleAppearance" && (
                      <div className="gx-settings-screen">
                        <div className="gx-settings-header">
                          <button className="gx-settings-header-btn" onClick={() => setSettingsScreen("subtitles")}>{"<"}</button>
                          Subtitle Appearance
                        </div>
                        <div className="gx-settings-list">
                          <div className="gx-settings-field">
                            <div className="gx-settings-split">
                              <label>Size</label>
                              <span className="gx-settings-value">{subtitleAppearance.fontScale.toFixed(2)}x</span>
                            </div>
                            <input type="range" min="0.8" max="2.2" step="0.05" value={subtitleAppearance.fontScale} onChange={(event) => updateSubtitleAppearance("fontScale", Number(event.target.value))} />
                          </div>
                          <div className="gx-settings-field">
                            <div className="gx-settings-split">
                              <label>Background Opacity</label>
                              <span className="gx-settings-value">{Math.round(subtitleAppearance.backgroundOpacity * 100)}%</span>
                            </div>
                            <input type="range" min="0" max="1" step="0.05" value={subtitleAppearance.backgroundOpacity} onChange={(event) => updateSubtitleAppearance("backgroundOpacity", Number(event.target.value))} />
                          </div>
                          <div className="gx-settings-field">
                            <label>Position</label>
                            <div className="gx-settings-value" style={{ textAlign: "left" }}>Drag the subtitle with your mouse in the player.</div>
                          </div>
                          <div className="gx-settings-divider" />
                          <div className="gx-settings-item" onClick={resetSubtitlePosition}>
                            <span>Reset position</span>
                          </div>
                          <div className="gx-settings-item" onClick={resetSubtitleAppearance}>
                            <span>Reset size/background</span>
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
                <IconExpand size={20} color="currentColor" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

