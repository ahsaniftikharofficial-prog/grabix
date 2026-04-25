// player/helpers.ts
// Pure helper functions, constants, and CSS injection for the player.
// No React imports — this file can be unit-tested without a DOM.

import type { CSSProperties } from "react";
import type {
  SubtitleAppearanceSettings,
  SubtitleCue,
  SubtitlePosition,
  PlaybackCacheRecord,
} from "./types";
import type { StreamSource } from "../lib/streamProviders";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PLAYBACK_CACHE_PREFIX = "grabix:playback:";
export const EMBED_CACHE_TTL_MS = 1000 * 60 * 30;
export const EXTRACT_CACHE_TTL_MS = 1000 * 60 * 20;

export const PROVIDER_NAME_MAP: Record<string, string> = {
  hianime: "HiAnime",
  consumet: "Consumet",
  aniwatch: "AniWatch",
  gogoanime: "GogoAnime",
  zoro: "Zoro",
  "9anime": "9Anime",
};

// ---------------------------------------------------------------------------
// Provider / failure helpers
// ---------------------------------------------------------------------------

export function formatProviderName(provider: string): string {
  return PROVIDER_NAME_MAP[provider.trim().toLowerCase()] ?? provider;
}

export function failureLabel(kind: string): string {
  switch (kind) {
    case "timeout":           return "This source took too long to start.";
    case "blocked_embed":     return "This embed loaded but may be blocked or blank.";
    case "media_error":       return "Playback failed for this source.";
    case "unsupported_source":return "This source type is not supported by the current engine.";
    case "open_failed":       return "The local file could not be opened.";
    default:                  return "This source failed.";
  }
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

export function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const hours   = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  if (hours > 0)
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function parseTimestamp(value: string): number {
  const cleaned = value.trim().replace(",", ".");
  const parts = cleaned.split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

// ---------------------------------------------------------------------------
// Subtitle parsing
// ---------------------------------------------------------------------------

export function stripVttTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .trim();
}

export function parseSubtitleText(content: string): SubtitleCue[] {
  const normalized = (content || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!normalized) return [];

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
    const [startRaw, endRaw] = timeLine.split("-->").map((v) => v.trim());
    if (!startRaw || !endRaw) continue;
    const start = parseTimestamp(startRaw.split(" ")[0]);
    const end   = parseTimestamp(endRaw.split(" ")[0]);
    const textLines = lines.slice(timeLineIndex + 1);
    if (!textLines.length) continue;
    const text = stripVttTags(textLines.join("\n"));
    if (!text) continue;
    cues.push({ start, end, text });
  }
  return cues;
}

/** O(log n) binary search — replaces O(n) .find() in the hot subtitle tick path */
export function findCurrentCue(cues: SubtitleCue[], t: number): SubtitleCue | null {
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

// ---------------------------------------------------------------------------
// Subtitle appearance
// ---------------------------------------------------------------------------

export const DEFAULT_SUBTITLE_APPEARANCE: SubtitleAppearanceSettings = {
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
export const DEFAULT_SUBTITLE_POSITION: SubtitlePosition = { x: 0, y: 0 };

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "").trim();
  const expanded = normalized.length === 3
    ? normalized.split("").map((p) => `${p}${p}`).join("")
    : normalized.padEnd(6, "0").slice(0, 6);
  const r = Number.parseInt(expanded.slice(0, 2), 16) || 0;
  const g = Number.parseInt(expanded.slice(2, 4), 16) || 0;
  const b = Number.parseInt(expanded.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${clampNumber(alpha, 0, 1)})`;
}

export function subtitleFontSize(scale: number): string {
  const s = clampNumber(scale, 0.8, 2.2);
  return `clamp(${(1.15 * s).toFixed(2)}rem, ${(1 * s).toFixed(2)}rem + ${(0.85 * s).toFixed(2)}vw, ${(1.9 * s).toFixed(2)}rem)`;
}

export function subtitleTextShadow(
  style: SubtitleAppearanceSettings["edgeStyle"],
  color: string,
): string {
  switch (style) {
    case "outline":
      return [
        `1px 0 0 ${color}`, `-1px 0 0 ${color}`,
        `0 1px 0 ${color}`,  `0 -1px 0 ${color}`,
        `1px 1px 0 ${color}`, `-1px 1px 0 ${color}`,
        `1px -1px 0 ${color}`, `-1px -1px 0 ${color}`,
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

export function buildSubtitleStyles(
  appearance: SubtitleAppearanceSettings,
): { window: CSSProperties; text: CSSProperties } {
  const edgeColor = hexToRgba(appearance.edgeColor, 1);
  return {
    window: {
      background: hexToRgba(appearance.windowColor, appearance.windowOpacity),
      padding: appearance.windowOpacity > 0 ? "0.18em 0.36em" : 0,
    },
    text: {
      background: hexToRgba(appearance.backgroundColor, appearance.backgroundOpacity),
      color: hexToRgba(appearance.textColor, appearance.textOpacity),
      padding: "0.28em 0.6em",
      fontSize: subtitleFontSize(appearance.fontScale),
      lineHeight: 1.4,
      fontWeight: 600,
      letterSpacing: "0.01em",
      fontFamily: appearance.fontFamily,
      textShadow: subtitleTextShadow(appearance.edgeStyle, edgeColor),
      WebkitTextStroke:
        appearance.edgeStyle === "outline" ? `0.45px ${edgeColor}` : undefined,
    },
  };
}

export function sanitizeSubtitleAppearance(
  raw: SubtitleAppearanceSettings,
): SubtitleAppearanceSettings {
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

export function sanitizeSubtitlePosition(raw: SubtitlePosition): SubtitlePosition {
  return {
    x: clampNumber(Number(raw.x) || 0, -640, 640),
    y: clampNumber(Number(raw.y) || 0, -360, 220),
  };
}

// ---------------------------------------------------------------------------
// Playback cache (sessionStorage)
// ---------------------------------------------------------------------------

export function readPlaybackCache<T>(key: string): T | null {
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

export function writePlaybackCache<T>(key: string, value: T, ttlMs: number) {
  if (typeof window === "undefined") return;
  try {
    const payload: PlaybackCacheRecord<T> = { expiresAt: Date.now() + ttlMs, value };
    window.sessionStorage.setItem(`${PLAYBACK_CACHE_PREFIX}${key}`, JSON.stringify(payload));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Stream URL helpers
// ---------------------------------------------------------------------------

export function buildStreamProxyUrl(
  api: string,
  url: string,
  headers?: Record<string, string>,
): string {
  if (!url) return url;
  if (url.startsWith(`${api}/stream/proxy?`)) return url;
  if (url.startsWith(`${api}/stream/proxy/`)) return url;
  if (url.startsWith("/stream/proxy?")) return `${api}${url}`;
  if (url.startsWith("/stream/proxy/")) return `${api}${url}`;
  const params = new URLSearchParams({ url });
  if (headers && Object.keys(headers).length > 0)
    params.set("headers_json", JSON.stringify(headers));
  return `${api}/stream/proxy/playlist.m3u8?${params.toString()}`;
}

export function shouldKeepHlsProxied(source: StreamSource): boolean {
  return (
    Boolean(source.requestHeaders && Object.keys(source.requestHeaders).length > 0) ||
    source.url.includes("/stream/proxy?") ||
    source.url.includes("/stream/proxy/")
  );
}

export async function resolveEmbedUrl(api: string, url: string): Promise<string> {
  if (!url) return url;
  const cacheKey = `embed:${url}`;
  const cached = readPlaybackCache<string>(cacheKey);
  if (cached) return cached;
  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12000);
    const response = await fetch(
      `${api}/resolve-embed?url=${encodeURIComponent(url)}`,
      { signal: controller.signal },
    );
    window.clearTimeout(timeoutId);
    if (!response.ok) return url;
    const payload = (await response.json()) as { url?: string };
    const resolved = payload.url || url;
    writePlaybackCache(cacheKey, resolved, EMBED_CACHE_TTL_MS);
    return resolved;
  } catch { return url; }
}

export function canPrepareInternalSource(source: StreamSource): boolean {
  return (
    source.kind === "embed" &&
    (source.provider.toLowerCase().includes("moviebox") || Boolean(source.canExtract))
  );
}

// ---------------------------------------------------------------------------
// CSS — injected once at module load, never re-diffed by React VDOM
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
  .gx-player { position: fixed; inset: 0; z-index: 9999; background: #000; font-family: system-ui, -apple-system, sans-serif; overflow: hidden; cursor: none; }
  .gx-player.controls-visible { cursor: default; }
  .gx-player video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  .gx-player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: none; }
  .gx-cue { position: absolute; bottom: 80px; left: 0; right: 0; text-align: center; pointer-events: none; z-index: 20; padding: 0 8%; }
  .gx-cue-window { display: inline-block; max-width: min(96vw, 1200px); border-radius: 8px; pointer-events: auto; cursor: grab; user-select: none; }
  .gx-cue-window.dragging { cursor: grabbing; }
  .gx-cue span { display: inline-block; max-width: min(92vw, 1100px); border-radius: 6px; white-space: pre-line; }
  .gx-controls { position: absolute; inset: 0; z-index: 10; display: flex; flex-direction: column; justify-content: flex-end; pointer-events: none; opacity: 0; transition: opacity var(--player-transition); }
  .gx-controls.visible { opacity: 1; pointer-events: none; }
  .gx-controls.visible .gx-bottom, .gx-controls.visible .gx-top { pointer-events: auto; }
  .gx-top { background: var(--player-top-gradient); padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; height: 56px; flex-shrink: 0; }
  .gx-top-right { display: flex; gap: 8px; align-items: center; }
  .gx-bottom { background: var(--player-overlay-gradient); padding: 0 20px 16px; flex-shrink: 0; }
  .gx-progress-wrap { position: relative; padding: 10px 0; cursor: pointer; }
  .gx-progress-track { height: 3px; background: var(--player-progress-bg); border-radius: 99px; position: relative; transition: height 150ms ease; overflow: visible; }
  .gx-progress-wrap:hover .gx-progress-track { height: 6px; }
  .gx-progress-fill { position: absolute; top: 0; left: 0; height: 100%; background: var(--player-progress-fill); border-radius: 99px; pointer-events: none; }
  .gx-progress-buffer { position: absolute; top: 0; left: 0; height: 100%; background: rgba(255,255,255,0.35); border-radius: 99px; pointer-events: none; }
  .gx-progress-thumb { position: absolute; top: 50%; transform: translate(-50%, -50%); width: 12px; height: 12px; background: white; border-radius: 50%; opacity: 0; transition: opacity 150ms ease; pointer-events: none; }
  .gx-progress-wrap:hover .gx-progress-thumb { opacity: 1; }
  .gx-progress-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
  .gx-preview { position: absolute; bottom: calc(100% + 10px); pointer-events: none; display: flex; flex-direction: column; align-items: center; gap: 4px; transform: translateX(-50%); animation: gx-fade-in 100ms ease; }
  .gx-preview img { width: 160px; height: 90px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.15); display: block; background: #111; }
  .gx-preview span { font-size: 11px; color: #fff; font-variant-numeric: tabular-nums; text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
  .gx-ctrl-row { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; gap: 8px; }
  .gx-ctrl-left, .gx-ctrl-right { display: flex; align-items: center; gap: 4px; }
  .gx-ctrl-center { font-size: 13px; color: var(--player-text-dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .gx-btn { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: transparent; border: none; border-radius: 8px; color: #fff; cursor: pointer; transition: background var(--player-transition); flex-shrink: 0; }
  .gx-btn:hover { background: rgba(255,255,255,0.1); }
  .gx-btn:disabled { opacity: 0.35; cursor: default; }
  .gx-btn.lg { width: 44px; height: 44px; border-radius: 10px; }
  .gx-btn.dim { color: rgba(255,255,255,0.4); }
  .gx-btn.dim:hover { color: #fff; }
  .gx-volume-wrap { position: relative; display: flex; align-items: center; }
  .gx-volume-slider-container { position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); background: var(--player-surface); border: 1px solid var(--player-border); border-radius: 10px; padding: 14px 12px 10px; backdrop-filter: blur(20px); opacity: 0; pointer-events: none; transition: opacity var(--player-transition); z-index: 50; min-width: 44px; }
  .gx-volume-wrap:hover .gx-volume-slider-container, .gx-volume-slider-container:hover { opacity: 1; pointer-events: auto; }
  .gx-volume-slider { writing-mode: vertical-lr; direction: rtl; width: 4px; height: 80px; appearance: none; -webkit-appearance: none; background: var(--player-progress-bg); border-radius: 99px; cursor: pointer; outline: none; }
  .gx-volume-slider::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 12px; height: 12px; background: #fff; border-radius: 50%; }
  .gx-boost-divider { height: 1px; background: var(--player-border); margin: 10px 0 8px; }
  .gx-boost-label { font-size: 9px; color: var(--player-text-dimmer); text-transform: uppercase; letter-spacing: 0.08em; text-align: center; margin-bottom: 6px; }
  .gx-boost-slider { writing-mode: vertical-lr; direction: rtl; width: 4px; height: 60px; appearance: none; -webkit-appearance: none; background: var(--player-progress-bg); border-radius: 99px; cursor: pointer; outline: none; accent-color: rgba(255,255,255,0.7); }
  .gx-boost-slider::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 10px; height: 10px; background: rgba(255,255,255,0.7); border-radius: 50%; }
  .gx-boost-val { font-size: 9px; color: var(--player-text-dim); text-align: center; margin-top: 4px; }
  .gx-settings-wrap { position: relative; }
  .gx-settings-panel { position: absolute; bottom: calc(100% + 8px); top: auto; right: 0; width: 240px; background: var(--player-surface); border: 1px solid var(--player-border); border-radius: 12px; backdrop-filter: blur(20px); overflow: hidden; z-index: 100; animation: gx-settings-in 150ms ease; }
  @keyframes gx-settings-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes gx-fade-in { from { opacity: 0; } to { opacity: 1; } }
  .gx-settings-screen { animation: gx-fade-in 150ms ease; }
  .gx-settings-row { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; height: 48px; cursor: pointer; color: #fff; font-size: 14px; border-radius: 8px; margin: 2px 4px; transition: background var(--player-transition); }
  .gx-settings-row:hover { background: var(--player-surface-hover); }
  .gx-settings-row-val { display: flex; align-items: center; gap: 6px; color: var(--player-text-dim); font-size: 13px; }
  .gx-settings-chevron { opacity: 0.4; font-size: 12px; }
  .gx-settings-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px 4px; color: #fff; font-size: 14px; font-weight: 600; }
  .gx-settings-header-btn { background: none; border: none; color: rgba(255,255,255,0.6); cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 4px; border-radius: 4px; transition: color var(--player-transition); }
  .gx-settings-header-btn:hover { color: #fff; }
  .gx-settings-item { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; height: 44px; cursor: pointer; color: #fff; font-size: 13px; border-radius: 8px; margin: 2px 4px; transition: background var(--player-transition); }
  .gx-settings-item:hover { background: var(--player-surface-hover); }
  .gx-settings-item.active { color: #fff; }
  .gx-settings-item .gx-check { opacity: 0; }
  .gx-settings-item.active .gx-check { opacity: 1; }
  .gx-settings-field { display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; }
  .gx-settings-field label { font-size: 11px; color: var(--player-text-dim); text-transform: uppercase; letter-spacing: 0.08em; }
  .gx-settings-field input[type="range"] { width: 100%; accent-color: #ffffff; }
  .gx-settings-field input[type="color"] { width: 100%; height: 34px; border: none; background: transparent; cursor: pointer; }
  .gx-settings-field select { width: 100%; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; padding: 8px 10px; font-size: 13px; }
  .gx-settings-split { display: grid; grid-template-columns: minmax(0, 1fr) 72px; gap: 10px; align-items: center; }
  .gx-settings-value { font-size: 12px; color: var(--player-text-dim); text-align: right; }
  .gx-settings-divider { height: 1px; background: var(--player-border); margin: 4px 12px; }
  .gx-settings-list { max-height: 240px; overflow-y: auto; padding-bottom: 6px; }
  .gx-settings-list::-webkit-scrollbar { width: 4px; }
  .gx-settings-list::-webkit-scrollbar-track { background: transparent; }
  .gx-settings-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 99px; }
  .gx-ep-wrap { position: relative; }
  .gx-ep-panel { position: absolute; bottom: calc(100% + 8px); right: 0; width: 220px; max-height: 260px; overflow-y: auto; background: var(--player-surface); border: 1px solid var(--player-border); border-radius: 12px; backdrop-filter: blur(20px); z-index: 100; animation: gx-settings-in 150ms ease; padding: 6px 0; }
  .gx-ep-panel::-webkit-scrollbar { width: 4px; }
  .gx-ep-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 99px; }
  .gx-ep-item { display: flex; align-items: center; justify-content: space-between; padding: 0 14px; height: 40px; cursor: pointer; color: #fff; font-size: 13px; transition: background var(--player-transition); }
  .gx-ep-item:hover { background: var(--player-surface-hover); }
  .gx-ep-item.active { font-weight: 600; }
  .gx-ep-item .gx-check { opacity: 0; }
  .gx-ep-item.active .gx-check { opacity: 1; }
  .gx-ep-label { font-size: 11px; color: var(--player-text-dimmer); padding: 6px 14px 2px; text-transform: uppercase; letter-spacing: 0.08em; }
  .gx-pause-overlay { position: absolute; bottom: 90px; left: 24px; pointer-events: none; z-index: 5; opacity: 0; transition: opacity 200ms ease; }
  .gx-pause-overlay.visible { opacity: 1; }
  .gx-pause-title { font-size: 22px; font-weight: 700; color: #fff; line-height: 1.2; }
  .gx-pause-sub { font-size: 14px; color: var(--player-text-dim); margin-top: 4px; }
  .gx-spinner-wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 8; pointer-events: none; background: radial-gradient(circle at center, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0.56) 100%); }
  .gx-spinner-panel { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; }
  .gx-spinner { width: 32px; height: 32px; border: 2px solid rgba(255,255,255,0.15); border-top-color: #fff; border-radius: 50%; animation: gx-spin 0.8s linear infinite; }
  @keyframes gx-spin { to { transform: rotate(360deg); } }
  .gx-spinner-label { color: #fff; font-size: 13px; font-weight: 600; letter-spacing: 0.01em; text-shadow: 0 1px 3px rgba(0,0,0,0.65); }
  .gx-error { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 15; gap: 12px; pointer-events: auto; }
  .gx-error-msg { color: rgba(255,255,255,0.8); font-size: 15px; }
  .gx-error-btn { background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.18); color: #fff; padding: 8px 20px; border-radius: 8px; font-size: 14px; cursor: pointer; transition: background var(--player-transition); }
  .gx-error-btn:hover { background: rgba(255,255,255,0.2); }
  .gx-notice { position: absolute; bottom: 100px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.75); border: 1px solid rgba(255,255,255,0.1); color: #fff; font-size: 12px; padding: 6px 14px; border-radius: 99px; white-space: nowrap; max-width: 80%; overflow: hidden; text-overflow: ellipsis; z-index: 30; pointer-events: none; display: flex; align-items: center; gap: 6px; backdrop-filter: blur(8px); }
  .gx-notice.error { color: #ffd0cb; }
  .gx-subtitle-panel { position: absolute; bottom: 80px; right: 20px; z-index: 200; }
  .gx-skip-btn { background: none; border: none; color: #fff; width: 40px; height: 40px; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: background var(--player-transition); }
  .gx-skip-btn:hover { background: rgba(255,255,255,0.1); }
  .gx-speed-label { font-size: 10px; font-weight: 800; color: #fff; letter-spacing: -0.5px; }
`;

if (typeof document !== "undefined") {
  if (!document.getElementById("gx-player-styles")) {
    const _s = document.createElement("style");
    _s.id = "gx-player-styles";
    _s.textContent = PLAYER_STYLES;
    document.head.appendChild(_s);
  }
}
