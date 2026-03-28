import { BACKEND_API, fetchStreamVariants, type StreamSource } from "./streamProviders";

export interface DownloadQueueRequest {
  url: string;
  title?: string;
  thumbnail?: string;
  headers?: Record<string, string>;
  forceHls?: boolean;
}

export interface DownloadQualityOption {
  id: string;
  label: string;
  url: string;
  headers?: Record<string, string>;
  forceHls: boolean;
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
    const key = option.label.toLowerCase();
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
    });
  }

  return dedupeQualityOptions(results);
}

export async function queueVideoDownload(request: DownloadQueueRequest): Promise<void> {
  const params = new URLSearchParams({
    url: request.url,
    dl_type: "video",
  });

  if (request.title?.trim()) params.set("title", request.title.trim());
  if (request.thumbnail?.trim()) params.set("thumbnail", request.thumbnail.trim());
  if (request.headers && Object.keys(request.headers).length > 0) {
    params.set("headers_json", JSON.stringify(request.headers));
  }
  if (request.forceHls) params.set("force_hls", "true");

  let response: Response;
  try {
    response = await fetch(`${BACKEND_API}/download?${params.toString()}`);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Downloader could not be reached.");
  }

  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { detail?: string };
      detail = payload.detail || "";
    } catch {
      detail = "";
    }
    throw new Error(detail || `Downloader returned ${response.status}`);
  }

  window.dispatchEvent(new CustomEvent("grabix:navigate", { detail: { page: "downloader" } }));
}
