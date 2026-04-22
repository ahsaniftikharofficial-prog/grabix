// grabix-ui/src/pages/downloader.types.ts
// Shared types, interfaces, and pure utility functions for the Downloader feature.

export const DOWNLOADER_QUEUE_STORAGE_KEY = "grabix:downloader-queue";

export type FileType      = "video" | "audio" | "thumbnail" | "subtitle";
export type Status        = "idle" | "loading" | "ok" | "error";
export type DownloadEngine = "standard" | "aria2";
export type ProgressMode  = "determinate" | "activity" | "processing";

export interface VideoInfo {
  title:     string;
  thumbnail: string;
  duration:  number;
  uploader:  string;
  formats:   string[];
}

export interface QueueItem {
  id:                      string;
  serverId:                string;
  url:                     string;
  title:                   string;
  thumbnail:               string;
  format:                  string;
  fileType:                FileType;
  status:                  "queued" | "downloading" | "processing" | "done" | "error" | "paused" | "canceling" | "failed" | "canceled";
  percent:                 number;
  speed:                   string;
  eta:                     string;
  downloaded:              string;
  total:                   string;
  size:                    string;
  filePath:                string;
  partialFilePath:         string;
  error:                   string;
  canPause:                boolean;
  recoverable:             boolean;
  retryCount:              number;
  failureCode:             string;
  downloadEngine:          DownloadEngine;
  requestedEngine:         DownloadEngine;
  engineNote:              string;
  bytesDownloaded:         number;
  bytesTotal:              number;
  progressMode:            ProgressMode;
  stageLabel:              string;
  variantLabel:            string;
  aria2Segments:           number[];
  aria2ConnectionSegments: number[];
}

export interface RuntimeDependency {
  id:                 string;
  label:              string;
  available:          boolean;
  path?:              string;
  description?:       string;
  install_supported?: boolean;
  job?:               { status?: string; message?: string };
}

export function toQueueItem(serverItem: any, previous?: QueueItem): QueueItem {
  const fileType = (serverItem.dl_type as FileType) || previous?.fileType || "video";
  return {
    id:                      serverItem.id                              ?? previous?.id               ?? uid(),
    serverId:                serverItem.id                              ?? previous?.serverId          ?? "",
    url:                     serverItem.url                             ?? previous?.url               ?? "",
    title:                   serverItem.title                           || previous?.title             || "Preparing download...",
    thumbnail:               serverItem.thumbnail                       || previous?.thumbnail         || "",
    format:                  serverItem.variant_label                   || previous?.format            || fileType,
    fileType,
    status:                  serverItem.status                          ?? previous?.status            ?? "queued",
    percent:                 serverItem.percent                         ?? previous?.percent           ?? 0,
    speed:                   serverItem.speed                           ?? previous?.speed             ?? "",
    eta:                     serverItem.eta                             ?? previous?.eta               ?? "",
    downloaded:              serverItem.downloaded                      ?? previous?.downloaded        ?? "",
    total:                   serverItem.total                           ?? previous?.total             ?? "",
    size:                    serverItem.size                            ?? previous?.size              ?? "",
    filePath:                serverItem.file_path                       ?? previous?.filePath          ?? "",
    partialFilePath:         serverItem.partial_file_path               ?? previous?.partialFilePath   ?? "",
    error:                   serverItem.error                           ?? previous?.error             ?? "",
    canPause:                serverItem.can_pause                       ?? previous?.canPause          ?? false,
    recoverable:             serverItem.recoverable                     ?? previous?.recoverable       ?? false,
    retryCount:              serverItem.retry_count                     ?? previous?.retryCount        ?? 0,
    failureCode:             serverItem.failure_code                    ?? previous?.failureCode       ?? "",
    downloadEngine:          serverItem.download_engine === "aria2"     ? "aria2"                     : previous?.downloadEngine    ?? "standard",
    requestedEngine:         serverItem.download_engine_requested === "aria2" ? "aria2"               : previous?.requestedEngine   ?? "standard",
    engineNote:              serverItem.engine_note                     ?? previous?.engineNote        ?? "",
    bytesDownloaded:         Number(serverItem.bytes_downloaded         ?? previous?.bytesDownloaded   ?? 0),
    bytesTotal:              Number(serverItem.bytes_total              ?? previous?.bytesTotal        ?? 0),
    progressMode:            (serverItem.progress_mode as ProgressMode) ?? previous?.progressMode     ?? "activity",
    stageLabel:              serverItem.stage_label                     ?? previous?.stageLabel        ?? "",
    variantLabel:            serverItem.variant_label                   ?? previous?.variantLabel      ?? "",
    aria2Segments:           Array.isArray(serverItem.aria2_segments)           ? serverItem.aria2_segments           : previous?.aria2Segments           ?? [],
    aria2ConnectionSegments: Array.isArray(serverItem.aria2_connection_segments) ? serverItem.aria2_connection_segments : previous?.aria2ConnectionSegments ?? [],
  };
}

export function secs(s: number) {
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function uid() { return Math.random().toString(36).slice(2); }

export function formatDisplaySpeed(speed: string): string {
  const clean = speed.replace(/\x1b\[[0-9;]*m/g, "").replace(/\u001b\[[0-9;]*m/g, "").trim();
  if (!clean) return "";
  if (clean.endsWith("/s")) return clean.replace("MiB", "MB").replace("KiB", "KB").replace("GiB", "GB");
  if (clean.endsWith("x"))  return clean;
  return clean;
}

export function parseDisplayedBytes(value: string): number {
  const clean = value.trim();
  if (!clean) return 0;
  const match = clean.match(/^([\d.]+)\s*(B|KB|MB|GB|TB|KIB|MIB|GIB|TIB)$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1, KB: 1000, MB: 1000 ** 2, GB: 1000 ** 3, TB: 1000 ** 4,
    KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4,
  };
  return Math.round(amount * (multipliers[unit] ?? 1));
}

export function variantLabelForRequest(
  fileType: FileType,
  quality: string,
  audioFormat: string,
  subtitleLang: string,
  thumbnailFormat: string,
): string {
  if (fileType === "video")    return quality;
  if (fileType === "audio")    return `${audioFormat}-192`;
  if (fileType === "subtitle") return `${subtitleLang}-subtitle`;
  return thumbnailFormat;
}

export function loadStoredQueue(): QueueItem[] {
  try {
    const raw = window.localStorage.getItem(DOWNLOADER_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function storeQueueSnapshot(queue: QueueItem[]) {
  try {
    window.localStorage.setItem(DOWNLOADER_QUEUE_STORAGE_KEY, JSON.stringify(queue.slice(0, 200)));
  } catch {
    // Ignore localStorage failures.
  }
}
