// player/types.ts
// All TypeScript types shared across the player sub-modules.

import type { StreamSource } from "../../lib/streamProviders";

// ---------------------------------------------------------------------------
// Public component props
// ---------------------------------------------------------------------------

export interface Props {
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

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export type FailureKind =
  | "timeout"
  | "blocked_embed"
  | "media_error"
  | "unsupported_source"
  | "open_failed";

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface PlaybackCacheRecord<T> {
  expiresAt: number;
  value: T;
}

export interface SubtitleAppearanceSettings {
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

export interface SubtitlePosition {
  x: number;
  y: number;
}

export type SettingsScreen =
  | "main"
  | "quality"
  | "speed"
  | "subtitles"
  | "subtitleAppearance"
  | "server"
  | "episodes";
