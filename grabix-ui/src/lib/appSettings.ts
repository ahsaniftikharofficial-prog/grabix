// appSettings.ts — local app preferences stored in localStorage

export interface AppSettings {
  enable_media_cache: boolean;
  media_cache_days: number;
  anime_default_audio: string;
  anime_default_server: string;
}

const STORAGE_KEY = "grabix_app_settings";

const DEFAULTS: AppSettings = {
  enable_media_cache: true,
  media_cache_days: 7,
  anime_default_audio: "original",
  anime_default_server: "auto",
};

export function readLocalAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeLocalAppSettings(settings: Partial<AppSettings>): void {
  try {
    const current = readLocalAppSettings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...settings }));
  } catch {
    // localStorage unavailable — ignore silently
  }
}
