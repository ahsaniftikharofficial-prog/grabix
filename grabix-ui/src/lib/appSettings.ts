import { readJsonStorage, versionedStorageKey, writeJsonStorage } from "./persistentState";

export interface AppSettings {
  theme: string;
  auto_fetch: boolean;
  notifications: boolean;
  default_format: string;
  default_quality: string;
  default_download_engine: "standard" | "aria2";
  download_folder: string;
  enable_media_cache: boolean;
  media_cache_days: number;
  metadata_cache_mode: "session" | "persistent";
  anime_default_audio: "en" | "original" | "hi";
  anime_default_server: "auto" | "hd-1" | "hd-2";
  anime_auto_play_next: boolean;
  anime_show_trailers: boolean;
  anime_preload_next_episode: boolean;
  anime_prefer_fallback: boolean;
  moviebox_prefer_hindi: boolean;
  movies_prefer_quality: "1080p" | "720p" | "480p";
  tv_prefer_quality: "1080p" | "720p" | "480p";
  show_ratings_badges: boolean;
  manga_default_language: string;
  manga_reader_mode: "standard" | "fast" | "backup" | "auto";
  manga_auto_open_first_chapter: boolean;
  compact_media_cards: boolean;
  reduced_motion: boolean;
  adult_content_enabled: boolean;
  adult_password_configured: boolean;
}

const SETTINGS_VERSION = "v2";
const SETTINGS_KEY = versionedStorageKey("grabix:app-settings", SETTINGS_VERSION);

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: "dark",
  auto_fetch: true,
  notifications: true,
  default_format: "mp4",
  default_quality: "1080p",
  default_download_engine: "standard",
  download_folder: "~/Downloads/GRABIX",
  enable_media_cache: true,
  media_cache_days: 14,
  metadata_cache_mode: "persistent",
  anime_default_audio: "en",
  anime_default_server: "auto",
  anime_auto_play_next: true,
  anime_show_trailers: true,
  anime_preload_next_episode: true,
  anime_prefer_fallback: false,
  moviebox_prefer_hindi: true,
  movies_prefer_quality: "1080p",
  tv_prefer_quality: "1080p",
  show_ratings_badges: true,
  manga_default_language: "en",
  manga_reader_mode: "standard",
  manga_auto_open_first_chapter: false,
  compact_media_cards: false,
  reduced_motion: false,
  adult_content_enabled: false,
  adult_password_configured: false,
};

export function normalizeAppSettings(value: Partial<AppSettings> | null | undefined): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    ...(value || {}),
    default_download_engine: value?.default_download_engine === "aria2" ? "aria2" : "standard",
    metadata_cache_mode: value?.metadata_cache_mode === "session" ? "session" : "persistent",
    anime_default_audio:
      value?.anime_default_audio === "hi" || value?.anime_default_audio === "original"
        ? value.anime_default_audio
        : "en",
    anime_default_server:
      value?.anime_default_server === "hd-1" || value?.anime_default_server === "hd-2"
        ? value.anime_default_server
        : "auto",
    movies_prefer_quality:
      value?.movies_prefer_quality === "720p" || value?.movies_prefer_quality === "480p"
        ? value.movies_prefer_quality
        : "1080p",
    tv_prefer_quality:
      value?.tv_prefer_quality === "720p" || value?.tv_prefer_quality === "480p"
        ? value.tv_prefer_quality
        : "1080p",
    manga_reader_mode:
      value?.manga_reader_mode === "fast" || value?.manga_reader_mode === "backup" || value?.manga_reader_mode === "auto"
        ? value.manga_reader_mode
        : "standard",
    media_cache_days: Math.max(1, Math.min(30, Number(value?.media_cache_days) || DEFAULT_APP_SETTINGS.media_cache_days)),
  };
}

export function readLocalAppSettings(): AppSettings {
  return normalizeAppSettings(readJsonStorage<Partial<AppSettings>>("local", SETTINGS_KEY, DEFAULT_APP_SETTINGS));
}

export function writeLocalAppSettings(value: Partial<AppSettings>): AppSettings {
  const next = normalizeAppSettings({ ...readLocalAppSettings(), ...value });
  writeJsonStorage("local", SETTINGS_KEY, next);
  return next;
}

