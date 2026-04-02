import { BACKEND_API, fetchStreamVariants, type StreamSource } from "./streamProviders";

export interface DownloadQueueRequest {
  url: string;
  title?: string;
  thumbnail?: string;
  headers?: Record<string, string>;
  forceHls?: boolean;
  category?: string;
  tags?: string[];
  downloadEngine?: "standard" | "aria2";
}

export interface SubtitleDownloadRequest {
  url: string;
  title?: string;
  headers?: Record<string, string>;
  category?: string;
  tags?: string[];
  downloadEngine?: "standard" | "aria2";
}

export interface DownloadQualityOption {
  id: string;
  label: string;
  url: string;
  headers?: Record<string, string>;
  forceHls: boolean;
  sizeBytes?: number;
  sizeLabel?: string;
  serverId?: string;
  serverLabel?: string;
}

function normalizeBackendDetail(detail: unknown): string {
  if (typeof detail === "string") return detail.trim();
  if (!detail || typeof detail !== "object") return "";

  const record = detail as Record<string, unknown>;
  const directMessage = record.message;
  if (typeof directMessage === "string" && directMessage.trim()) {
    return directMessage.trim();
  }

  const pieces = Object.entries(record)
    .map(([key, value]) => {
      if (typeof value === "string" && value.trim()) {
        return `${key}: ${value.trim()}`;
      }
      if (typeof value === "number" || typeof value === "boolean") {
        return `${key}: ${String(value)}`;
      }
      return "";
    })
    .filter(Boolean);

  return pieces.join(" | ");
}

function qualityWeight(label: string): number {
  const normalized = String(label || "").trim().toLowerCase();
  const numeric = normalized.match(/(\d{3,4})p/);
  if (numeric) return Number(numeric[1]);
  if (normalized === "4k") return 2160;
  if (normalized === "2k") return 1440;
  if (normalized === "source") return 9999;
  if (normalized === "auto") return 1;
  return 0;
}

function dedupeQualityOptions(options: DownloadQualityOption[]): DownloadQualityOption[] {
  const seen = new Set<string>();
  const ordered = [...options].sort((left, right) => qualityWeight(right.label) - qualityWeight(left.label));
  return ordered.filter((option) => {
    const key = `${option.serverLabel || "default"}:${option.label.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function resolveSourceDownloadOptions(sources: StreamSource[]): Promise<DownloadQualityOption[]> {
  const results: DownloadQualityOption[] = [];

  for (const source of sources) {
    const preferredUrl = source.provider === "MovieBox" ? source.url : (source.externalUrl || source.url);
    const url = (preferredUrl || "").trim();
    if (!url) continue;
    const serverLabel = (source.language || source.provider || "Server").trim();
    const sizeLabel = (source.fileName || "").trim();

    if (source.kind === "hls") {
      try {
        const variants = await fetchStreamVariants(url, source.requestHeaders);
        if (variants.length > 0) {
          results.push(
            ...variants.map((variant, index) => ({
              id: `${variant.label}-${index}`,
              label: variant.label || source.quality || "Auto",
              url: variant.url,
              headers: source.requestHeaders,
              forceHls: true,
              sizeLabel,
              serverId: serverLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
              serverLabel,
            }))
          );
          continue;
        }
      } catch {
        // Fall through to the raw HLS source when variants cannot be read.
      }
    }

    results.push({
      id: `${source.id}-${source.quality || source.kind || "source"}`,
      label: source.quality || (source.kind === "direct" ? "Source" : "Auto"),
      url,
      headers: source.requestHeaders,
      forceHls: source.kind === "hls",
      sizeLabel,
      serverId: serverLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      serverLabel,
    });
  }

  return dedupeQualityOptions(results);
}

export async function queueVideoDownload(request: DownloadQueueRequest): Promise<void> {
  let response: Response;
  try {
    const params = new URLSearchParams({
      url: request.url,
      title: request.title?.trim() || "",
      thumbnail: request.thumbnail?.trim() || "",
      dl_type: "video",
      headers_json:
        request.headers && Object.keys(request.headers).length > 0
          ? JSON.stringify(request.headers)
          : "",
      force_hls: String(Boolean(request.forceHls)),
      category: request.category?.trim() || "",
      tags_csv: Array.isArray(request.tags) ? request.tags.filter(Boolean).join(",") : "",
      download_engine: request.downloadEngine || "",
    });
    response = await fetch(`${BACKEND_API}/download?${params.toString()}`);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Downloader could not be reached.");
  }

  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { detail?: unknown };
      detail = normalizeBackendDetail(payload.detail);
    } catch {
      detail = "";
    }
    throw new Error(detail || `Downloader returned ${response.status}`);
  }

  window.dispatchEvent(new CustomEvent("grabix:navigate", { detail: { page: "downloader" } }));
}

export async function queueSubtitleDownload(request: SubtitleDownloadRequest): Promise<void> {
  let response: Response;
  try {
    const params = new URLSearchParams({
      url: request.url,
      title: request.title?.trim() || "",
      dl_type: "subtitle",
      headers_json:
        request.headers && Object.keys(request.headers).length > 0
          ? JSON.stringify(request.headers)
          : "",
      category: request.category?.trim() || "",
      tags_csv: Array.isArray(request.tags) ? request.tags.filter(Boolean).join(",") : "",
      download_engine: request.downloadEngine || "",
    });
    response = await fetch(`${BACKEND_API}/download?${params.toString()}`);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Subtitle downloader could not be reached.");
  }

  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { detail?: unknown };
      detail = normalizeBackendDetail(payload.detail);
    } catch {
      detail = "";
    }
    throw new Error(detail || `Subtitle downloader returned ${response.status}`);
  }

  window.dispatchEvent(new CustomEvent("grabix:navigate", { detail: { page: "downloader" } }));
}
