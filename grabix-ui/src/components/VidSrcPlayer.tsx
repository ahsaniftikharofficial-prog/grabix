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
  IconSubtitle,
} from "./Icons";
import SubtitlePanel from "./SubtitlePanel";
import { BACKEND_API } from "../lib/api";
import { fetchStreamVariants, inferStreamKind } from "../lib/streamProviders";
import type { StreamSource } from "../lib/streamProviders";

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

function failureLabel(kind: FailureKind): string {
  switch (kind) {
    case "timeout":
      return "This source took too long to start.";
    case "blocked_embed":
      return "This embed loaded but may be blocked or blank.";
    case "media_error":
      return "Playback failed for this source.";
    case "unsupported_source":
      return "This source type is not supported by the current engine.";
    case "open_failed":
      return "The local file could not be opened.";
  }
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  if (hours > 0)
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function parseTimestamp(value: string): number {
  const cleaned = value.trim().replace(",", ".");
  const parts = cleaned.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return 0;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
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
    const lines = block
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);

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

    cues.push({
      start,
      end,
      text: textLines.join("\n"),
    });
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
  } catch {
    return null;
  }
}

function writePlaybackCache<T>(key: string, value: T, ttlMs: number) {
  if (typeof window === "undefined") return;
  try {
    const payload: PlaybackCacheRecord<T> = {
      expiresAt: Date.now() + ttlMs,
      value,
    };
    window.sessionStorage.setItem(`${PLAYBACK_CACHE_PREFIX}${key}`, JSON.stringify(payload));
  } catch {
    // Ignore cache write failures.
  }
}

function buildStreamProxyUrl(api: string, url: string, headers?: Record<string, string>): string {
  if (!url) return url;
  if (url.startsWith(`${api}/stream/proxy?`)) return url;
  if (url.startsWith("/stream/proxy?")) return `${api}${url}`;

  const params = new URLSearchParams({ url });
  if (headers && Object.keys(headers).length > 0) {
    params.set("headers_json", JSON.stringify(headers));
  }
  return `${api}/stream/proxy?${params.toString()}`;
}

function shouldKeepHlsProxied(source: StreamSource): boolean {
  return (
    Boolean(source.requestHeaders && Object.keys(source.requestHeaders).length > 0) ||
    source.url.includes("/stream/proxy?")
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
    const response = await fetch(`${api}/resolve-embed?url=${encodeURIComponent(url)}`, {
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);
    if (!response.ok) return url;
    const payload = (await response.json()) as { url?: string };
    const resolved = payload.url || url;
    writePlaybackCache(cacheKey, resolved, EMBED_CACHE_TTL_MS);
    return resolved;
  } catch {
    return url;
  }
}

function canPrepareInternalSource(source: StreamSource): boolean {
  return source.kind === "embed" && (source.provider.toLowerCase().includes("moviebox") || Boolean(source.canExtract));
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
  onClose,
  onDownload,
  onDownloadSource,
}: Props) {
  const API = BACKEND_API;

  // Refs
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideChromeTimeoutRef = useRef<number | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const mediaNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  /**
   * Tracks whether the current embed iframe has fired its onLoad event.
   * Used to detect dead embeds that never load so we can auto-failover.
   */
  const embedLoadedRef = useRef(false);

  const [activeSubtitleText, setActiveSubtitleText] = useState(subtitle || "");
  const [activeSearchTitle, setActiveSearchTitle] = useState(subtitleSearchTitle || title);
  const [activeEpisode, setActiveEpisode] = useState<number | null>(currentEpisode ?? null);
  const [runtimeSources, setRuntimeSources] = useState<StreamSource[]>(sources ?? []);
  const [episodeLoading, setEpisodeLoading] = useState(false);

  // Sources from props (stable)
  const effectiveSources = runtimeSources.length > 0 ? runtimeSources : sources;

  const baseSources = useMemo<StreamSource[]>(
    () =>
      effectiveSources && effectiveSources.length > 0
        ? effectiveSources
        : embedUrl
          ? [
              {
                id: "legacy-source",
                label: "Main",
                provider: "Custom",
                kind: "embed" as const,
                url: embedUrl,
                description: "Embedded source",
                quality: "Auto",
                externalUrl: embedUrl,
              },
            ]
          : [],
    [effectiveSources, embedUrl]
  );

  // Sources extracted at runtime via backend (direct/HLS links)
  const extractedSourcesRef = useRef<StreamSource[]>([]);
  const [extractedSources, setExtractedSources] = useState<StreamSource[]>([]);

  // All sources: base props + runtime-extracted
  const allSources = useMemo(
    () => [...baseSources, ...extractedSources],
    [baseSources, extractedSources]
  );

  // Reset extracted sources when the base set changes (e.g. new title opened)
  useEffect(() => {
    extractedSourcesRef.current = [];
    setExtractedSources([]);
  }, [baseSources]);

  // ---------------------------------------------------------------------------
  // UI state
  // ---------------------------------------------------------------------------

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
  const [subtitleUrl, setSubtitleUrl] = useState("");
  const [subtitleName, setSubtitleName] = useState("");
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [showSubtitlePanel, setShowSubtitlePanel] = useState(false);
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [currentCue, setCurrentCue] = useState("");
  const [subtitleHint, setSubtitleHint] = useState("");
  const [activeSourceOptionId, setActiveSourceOptionId] = useState(sourceOptions?.[0]?.id ?? "");

  // Stream extraction state
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const activeSource = allSources[activeIndex] ?? null;
  const activeSubtitles = activeSource?.subtitles ?? [];
  const hasFallback = activeIndex < allSources.length - 1;
  const isDirectEngine =
    activeSource?.kind === "direct" ||
    activeSource?.kind === "hls" ||
    activeSource?.kind === "local";
  const isEmbedEngine = activeSource?.kind === "embed";
  const compactControls = isEmbedEngine;

  useEffect(() => {
    setRuntimeSources(sources ?? []);
    setActiveSubtitleText(subtitle || "");
    setActiveSearchTitle(subtitleSearchTitle || title);
    setActiveEpisode(currentEpisode ?? null);
  }, [sources, subtitle, subtitleSearchTitle, currentEpisode, title]);

  useEffect(() => {
    setActiveSourceOptionId(sourceOptions?.[0]?.id ?? "");
  }, [sourceOptions]);

  // ---------------------------------------------------------------------------
  // Chrome visibility
  // ---------------------------------------------------------------------------

  const showControls = () => {
    setShowChrome(true);
    if (hideChromeTimeoutRef.current)
      window.clearTimeout(hideChromeTimeoutRef.current);
    if (serverMenuOpen || volumeMenuOpen || subtitleMenuOpen) return;
    hideChromeTimeoutRef.current = window.setTimeout(
      () => setShowChrome(false),
      2600
    );
  };

  useEffect(() => {
    setActiveIndex(0);
  }, [baseSources]);

  useEffect(() => {
    showControls();
    return () => {
      if (hideChromeTimeoutRef.current)
        window.clearTimeout(hideChromeTimeoutRef.current);
    };
  }, [episodeMenuOpen, serverMenuOpen, volumeMenuOpen, subtitleMenuOpen, showSubtitlePanel]);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
      showControls();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handler);
    };
  }, [isDirectEngine, onClose]);

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (hideChromeTimeoutRef.current)
        window.clearTimeout(hideChromeTimeoutRef.current);
      if (subtitleUrl.startsWith("blob:")) URL.revokeObjectURL(subtitleUrl);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, [subtitleUrl]);

  // ---------------------------------------------------------------------------
  // Failover logic
  // ---------------------------------------------------------------------------

  const findPreparedSiblingIndex = (index: number): number => {
    const candidate = allSources[index];
    if (!candidate || candidate.kind !== "embed") return -1;
    const candidateKey = candidate.externalUrl || candidate.url;
    return allSources.findIndex(
      (source, sourceIndex) =>
        sourceIndex > index &&
        source.kind !== "embed" &&
        (source.externalUrl || source.url) === candidateKey
    );
  };

  const goToNextSource = (reason: FailureKind) => {
    const message = failureLabel(reason);

    if (hasFallback) {
      const immediateNextIndex = activeIndex + 1;
      const preparedSiblingIndex = findPreparedSiblingIndex(immediateNextIndex);
      const nextIndex = preparedSiblingIndex >= 0 ? preparedSiblingIndex : immediateNextIndex;
      const nextSource = allSources[nextIndex];
      setFallbackNotice(
        `${message} Switched to ${nextSource.label} (${nextSource.provider}).`
      );
      setActiveIndex(nextIndex);
      setReloadKey((key) => key + 1);
      return;
    }

    setErrorText(message);
    setIsLoading(false);
    setStatusText("Failed");
  };

  // ---------------------------------------------------------------------------
  // Source setup effect — resets UI on source / reload change
  // ---------------------------------------------------------------------------

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

    if (!activeSource) return;

    if (activeSource.kind === "embed") {
      // Auto-failover after 25 s if the iframe never fired onLoad
      const failoverTimeout = window.setTimeout(() => {
        if (!embedLoadedRef.current) {
          goToNextSource("timeout");
        }
      }, 8_000);

      return () => {
        window.clearTimeout(failoverTimeout);
      };
    }

    return undefined;
  }, [activeSource, reloadKey]);

  // ---------------------------------------------------------------------------
  // Embed URL resolution (backend /resolve-embed)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!activeSource || activeSource.kind !== "embed") return;

    let canceled = false;

    resolveEmbedUrl(API, activeSource.url)
      .then((nextUrl) => {
        if (canceled) return;
        setResolvedEmbedUrl(nextUrl || activeSource.url);
      })
      .catch(() => {
        if (!canceled) setResolvedEmbedUrl(activeSource.url);
      });

    return () => {
      canceled = true;
    };
  }, [API, activeSource]);

  useEffect(() => {
    if (!activeSource || activeSource.kind !== "hls") {
      setResolvedPlaybackUrl("");
      return;
    }

    let cancelled = false;
    setResolvedPlaybackUrl("");

    const resolveBestVariant = async () => {
      const sourceKey = activeSource.externalUrl || activeSource.url;
      const cachedUrl = readPlaybackCache<string>(`variant:${sourceKey}`);
      if (cachedUrl) {
        setResolvedPlaybackUrl(cachedUrl);
        return;
      }
      try {
        const variants = await fetchStreamVariants(
          sourceKey,
          activeSource.requestHeaders
        );
        if (cancelled || variants.length === 0) return;
        const best = pickBestVariant(variants);
        if (!best?.url || best.url === activeSource.url) return;
        const nextUrl = shouldKeepHlsProxied(activeSource)
          ? buildStreamProxyUrl(API, best.url, activeSource.requestHeaders)
          : best.url;
        writePlaybackCache(`variant:${sourceKey}`, nextUrl, VARIANT_CACHE_TTL_MS);
        setResolvedPlaybackUrl(nextUrl);
        setFallbackNotice(
          `Using the strongest ${best.label || "HLS"} variant${best.bandwidth ? ` (${Math.round(Number(best.bandwidth) / 1000)} kbps)` : ""}.`
        );
      } catch {
        if (!cancelled) {
          setResolvedPlaybackUrl("");
        }
      }
    };

    void resolveBestVariant();
    return () => {
      cancelled = true;
    };
  }, [API, activeSource]);

  // ---------------------------------------------------------------------------
  // Direct / HLS playback effect
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!activeSource || !isDirectEngine) return;

    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    video.pause();
    video.removeAttribute("src");
    video.load();
    setCurrentTime(0);
    setDuration(0);
    let sourceReady = false;
    const startupTimeout = window.setTimeout(() => {
      if (!sourceReady) {
        goToNextSource("timeout");
      }
    }, 20000);

    const handleCanPlay = () => {
      sourceReady = true;
      setIsLoading(false);
      setStatusText("Ready");
      setErrorText("");
    };
    const handleError = () => {
      sourceReady = true;
      goToNextSource(
        activeSource.kind === "local" ? "open_failed" : "media_error"
      );
    };
    const handleWaiting = () => {
      setIsLoading(true);
      setStatusText("Buffering");
    };
    const handlePlaying = () => {
      sourceReady = true;
      setIsLoading(false);
      setStatusText("Playing");
      setIsPlaying(true);
    };
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleDurationChange = () => setDuration(video.duration || 0);

    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("error", handleError);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("pause", handlePause);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("durationchange", handleDurationChange);

    if (activeSource.kind === "hls") {
      const defaultUrl = shouldKeepHlsProxied(activeSource)
        ? buildStreamProxyUrl(API, activeSource.url, activeSource.requestHeaders)
        : activeSource.url;
      const playbackUrl = resolvedPlaybackUrl || defaultUrl;
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 90,
          startFragPrefetch: true,
        });
        hlsRef.current = hls;
        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          hls.loadSource(playbackUrl);
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setStatusText("Buffering");
          void video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) goToNextSource("media_error");
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = playbackUrl;
        void video.play().catch(() => {});
      } else {
        goToNextSource("unsupported_source");
      }
    } else {
      video.src = activeSource.url;
      void video.play().catch(() => {});
    }

    return () => {
      window.clearTimeout(startupTimeout);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("error", handleError);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("durationchange", handleDurationChange);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [activeSource, isDirectEngine, reloadKey, resolvedPlaybackUrl]);

  // ---------------------------------------------------------------------------
  // Audio boost effect
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!isDirectEngine) return;
    const video = videoRef.current;
    if (!video) return;

    if (volumeBoost === 100) {
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = 1;
      }
      video.volume = 1;
      return;
    }

    if (!audioContextRef.current) {
      const AudioContextCtor =
        window.AudioContext ||
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;
      if (AudioContextCtor) {
        try {
          const context = new AudioContextCtor();
          const mediaNode = context.createMediaElementSource(video);
          const gainNode = context.createGain();
          mediaNode.connect(gainNode);
          gainNode.connect(context.destination);
          audioContextRef.current = context;
          mediaNodeRef.current = mediaNode;
          gainNodeRef.current = gainNode;
        } catch {
          setFallbackNotice(
            "Audio boost is unavailable for this stream, but playback should still work."
          );
          setVolumeBoost(100);
          return;
        }
      }
    }

    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volumeBoost / 100;
      video.volume = 1;
      video.muted = false;
      void audioContextRef.current?.resume().catch(() => {});
    }
  }, [activeSource, isDirectEngine, volumeBoost]);

  // ---------------------------------------------------------------------------
  // Subtitle track management
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const trackList = videoRef.current?.textTracks;
    if (!trackList) return;
    for (let index = 0; index < trackList.length; index += 1) {
      trackList[index].mode =
        subtitleUrl && subtitlesEnabled && index === trackList.length - 1 ? "showing" : "disabled";
    }
  }, [subtitleUrl, subtitlesEnabled, activeSource]);

  useEffect(() => {
    if (subtitleUrl.startsWith("blob:")) {
      URL.revokeObjectURL(subtitleUrl);
    }

    const firstSubtitle = activeSubtitles[0];
    if (firstSubtitle?.url) {
      setSubtitleUrl(firstSubtitle.url);
      setSubtitleName(firstSubtitle.label);
      setSubtitlesEnabled(true);
      return;
    }

    setSubtitleUrl("");
    setSubtitleName("");
    setSubtitlesEnabled(false);
    setSubtitleCues([]);
    setCurrentCue("");
    setSubtitleHint("");
  }, [activeSource]);

  useEffect(() => {
    if (!subtitleUrl || subtitleUrl.startsWith("blob:")) return;
    let cancelled = false;

    fetch(subtitleUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Subtitle load failed with ${response.status}`);
        }
        return response.text();
      })
      .then((content) => {
        if (cancelled) return;
        const cues = parseSubtitleText(content);
        setSubtitleCues(cues);
        if (cues.length > 0) {
          setSubtitleHint(`Subtitles loaded. Next line at ${formatTime(cues[0].start)}.`);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSubtitleCues([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [subtitleUrl]);

  useEffect(() => {
    if (!subtitleCues.length) {
      setCurrentCue("");
      setSubtitleHint("");
      return;
    }

    const cue = subtitleCues.find(
      (item) => currentTime >= item.start && currentTime <= item.end
    );
    setCurrentCue(cue?.text ?? "");

    if (cue) {
      setSubtitleHint("");
      return;
    }

    const nextCue = subtitleCues.find((item) => item.start > currentTime);
    if (nextCue) {
      setSubtitleHint(`Subtitles loaded. Next line at ${formatTime(nextCue.start)}.`);
      return;
    }

    setSubtitleHint("Subtitles loaded.");
  }, [currentTime, subtitleCues]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSourceSwitch = (index: number) => {
    setActiveIndex(index);
    setErrorText("");
    setFallbackNotice("");
    setExtractError("");
    setReloadKey((key) => key + 1);
    setEpisodeMenuOpen(false);
    setServerMenuOpen(false);
    showControls();
  };

  const handleEpisodeSwitch = async (episode: number) => {
    if ((!onSelectEpisode && !onSelectSourceOption) || episodeLoading || episode === activeEpisode) return;
    setEpisodeLoading(true);
    setErrorText("");
    setFallbackNotice("");
    try {
      const preferredProvider = activeSource?.provider;
      const preferredLabel = activeSource?.label;
      const next = onSelectSourceOption && activeSourceOptionId
        ? await onSelectSourceOption(activeSourceOptionId, episode)
        : await onSelectEpisode?.(episode);
      if (!next) {
        throw new Error(`Could not load ${episodeLabel.toLowerCase()} ${episode}.`);
      }
      const matchedIndex = next.sources.findIndex(
        (source) =>
          source.provider === preferredProvider && source.label === preferredLabel
      );
      extractedSourcesRef.current = [];
      setExtractedSources([]);
      setRuntimeSources(next.sources);
      setActiveSubtitleText(next.subtitle || "");
      setActiveSearchTitle(next.subtitleSearchTitle || `${title} ${episodeLabel} ${episode}`);
      setActiveEpisode(episode);
      setActiveIndex(matchedIndex >= 0 ? matchedIndex : 0);
      setReloadKey((key) => key + 1);
      setEpisodeMenuOpen(false);
    } catch (error) {
      setFallbackNotice(error instanceof Error ? error.message : `Could not load ${episodeLabel.toLowerCase()} ${episode}.`);
    } finally {
      setEpisodeLoading(false);
    }
  };

  const handleSourceOptionSwitch = async (optionId: string) => {
    if (!onSelectSourceOption || optionId === activeSourceOptionId) return;
    setEpisodeLoading(true);
    setErrorText("");
    setFallbackNotice("");
    try {
      const next = await onSelectSourceOption(optionId, activeEpisode ?? currentEpisode ?? undefined);
      extractedSourcesRef.current = [];
      setExtractedSources([]);
      setRuntimeSources(next.sources);
      setActiveSubtitleText(next.subtitle || "");
      setActiveSearchTitle(next.subtitleSearchTitle || title);
      setActiveSourceOptionId(optionId);
      setActiveIndex(0);
      setReloadKey((key) => key + 1);
      setServerMenuOpen(false);
    } catch (error) {
      setFallbackNotice(error instanceof Error ? error.message : "Could not switch server.");
    } finally {
      setEpisodeLoading(false);
    }
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video || !isDirectEngine) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
    showControls();
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch {
      // Ignore unsupported fullscreen hosts.
    }
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    const nextTime = Number(event.target.value);
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
    showControls();
  };

  const onSubtitlePicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (subtitleUrl.startsWith("blob:")) URL.revokeObjectURL(subtitleUrl);

    const objectUrl = URL.createObjectURL(file);
    setSubtitleUrl(objectUrl);
    setSubtitleName(file.name);
    setSubtitlesEnabled(true);
    setSubtitleCues([]);
    setCurrentCue("");
    setSubtitleHint("Subtitle track loaded.");
    setSubtitleMenuOpen(false);
    setShowSubtitlePanel(false);
    setFallbackNotice(`Loaded subtitles: ${file.name}`);
    event.target.value = "";
  };

  const handleSubtitleSelect = (url: string, label: string) => {
    if (subtitleUrl.startsWith("blob:") && subtitleUrl !== url) {
      URL.revokeObjectURL(subtitleUrl);
    }
    setSubtitleUrl(url);
    setSubtitleName(label);
    setSubtitlesEnabled(true);
    setSubtitleCues([]);
    setCurrentCue("");
    setSubtitleHint("Subtitle track loaded.");
    setSubtitleMenuOpen(false);
    setShowSubtitlePanel(false);
    setFallbackNotice(`Loaded subtitles: ${label}`);
  };

  const clearSubtitles = () => {
    if (subtitleUrl.startsWith("blob:")) {
      URL.revokeObjectURL(subtitleUrl);
    }
    setSubtitleUrl("");
    setSubtitleName("");
    setSubtitlesEnabled(false);
    setSubtitleCues([]);
    setCurrentCue("");
    setSubtitleHint("Subtitles off.");
    setSubtitleMenuOpen(false);
  };

  const toggleSubtitles = () => {
    if (activeSubtitles.length > 0 || subtitleUrl) {
      if (subtitlesEnabled) {
        clearSubtitles();
        return;
      }
      const firstSubtitle = activeSubtitles[0];
      if (firstSubtitle?.url) {
        handleSubtitleSelect(firstSubtitle.url, firstSubtitle.label);
      }
      return;
    }
    setShowSubtitlePanel((open) => !open);
  };

  const handleShellClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (showSubtitlePanel && !target.closest("[data-subtitle-panel='true']")) {
      setShowSubtitlePanel(false);
    }
    if (target.closest("button, input, select, textarea, a")) {
      showControls();
      return;
    }
    if (target.closest("[data-subtitle-panel='true']")) {
      showControls();
      return;
    }

    if (isDirectEngine && (target.tagName === "VIDEO" || target === rootRef.current)) {
      togglePlayback();
      return;
    }

    showControls();
  };

  const handleSubtitleLoaded = (content: string, label: string) => {
    if (subtitleUrl.startsWith("blob:")) {
      URL.revokeObjectURL(subtitleUrl);
    }

    const cues = parseSubtitleText(content);
    setSubtitleUrl("");
    setSubtitleName(label);
    setSubtitleCues(cues);
    setCurrentCue("");
    setSubtitleHint(
      cues.length > 0
        ? `Subtitles loaded. Next line at ${formatTime(cues[0].start)}.`
        : "Subtitle file loaded, but no timed lines were found."
    );
    setSubtitleMenuOpen(false);
    setShowSubtitlePanel(false);
    setFallbackNotice(`Loaded subtitles: ${label}`);
  };

  const extractDirectStreamUrl = async (
    targetUrl: string
  ): Promise<{ url: string; quality?: string; format?: string }> => {
    const resolvedUrl = await resolveEmbedUrl(API, targetUrl);
    const cacheKey = `extract:${resolvedUrl}`;
    const cached = readPlaybackCache<{ url: string; quality?: string; format?: string }>(cacheKey);
    if (cached?.url) {
      return cached;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 25000);
    const res = await fetch(`${API}/extract-stream?url=${encodeURIComponent(resolvedUrl)}`, {
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);
    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    const data = (await res.json()) as {
      url?: string;
      quality?: string;
      format?: string;
    };

    if (!data.url) {
      throw new Error("No URL in response");
    }

    const payload = {
      url: data.url,
      quality: data.quality,
      format: data.format,
    };
    writePlaybackCache(cacheKey, payload, EXTRACT_CACHE_TTL_MS);
    return payload;
  };

  /**
   * Ask the backend to extract a direct stream URL from the current embed.
   * On success: adds a Direct source to the list and switches to it.
   */
  const handleExtractStream = async () => {
    if (!activeSource || extracting) return;
    setExtracting(true);
    setExtractError("");

    try {
      const data = await extractDirectStreamUrl(
        activeSource.externalUrl || activeSource.url
      );

      const extracted: StreamSource = {
        id: `extracted-${Date.now()}`,
        label: "Direct (Extracted)",
        provider: activeSource.provider,
        kind: inferStreamKind(data.url),
        url: data.url,
        quality: data.quality ?? "Auto",
        description: "Extracted direct stream — playable and downloadable",
        externalUrl: data.url,
        canExtract: false,
      };

      // Append and switch to it (use ref to get sync length before setState)
      extractedSourcesRef.current = [
        ...extractedSourcesRef.current,
        extracted,
      ];
      const newIndex =
        baseSources.length + extractedSourcesRef.current.length - 1;
      setExtractedSources([...extractedSourcesRef.current]);
      setActiveIndex(newIndex);
      setReloadKey((k) => k + 1);
      setServerMenuOpen(false);
      setFallbackNotice(
        `Extracted a direct stream from ${activeSource.provider}. Switched to it.`
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown extraction error";
      setExtractError(`Could not extract a direct stream: ${message}`);
    } finally {
      setExtracting(false);
    }
  };

  const prepareInternalSource = async (
    source: StreamSource,
    options?: {
      labelPrefix?: string;
      notice?: string;
    }
  ): Promise<number> => {
    const sourceKey = source.externalUrl || source.url;
    const existingPreparedIndex = extractedSourcesRef.current.findIndex(
      (item) => item.externalUrl === sourceKey
    );
    if (existingPreparedIndex >= 0) {
      return baseSources.length + existingPreparedIndex;
    }

    const data = await extractDirectStreamUrl(sourceKey);
    if (!data.url) {
      throw new Error("No playable stream was returned.");
    }

    const extracted: StreamSource = {
      id: `prepared-${Date.now()}`,
      label: options?.labelPrefix ? `${options.labelPrefix} Direct` : `${source.label} Direct`,
      provider: source.provider,
      kind: inferStreamKind(data.url),
      url: data.url,
      quality: data.quality ?? source.quality ?? "Auto",
      description:
        options?.notice || "Prepared internal stream for playback, subtitles, and audio boost.",
      externalUrl: sourceKey,
      canExtract: false,
      subtitles: source.subtitles,
      language: source.language,
    };

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
        try {
          await prepareInternalSource(source, {
            notice: "Prepared internal failover stream.",
          });
        } catch {
          // Ignore background prewarm failures. Active playback still has its own failover path.
        }
      }
    };

    void warmFallbacks();
    return () => {
      cancelled = true;
    };
  }, [baseSources]);

  const handleDownloadCurrent = async () => {
    if (!activeSource || (!onDownload && !onDownloadSource)) return;
    const downloadSource =
      allSources.find(
        (source) =>
          source.kind === "direct" ||
          source.kind === "hls" ||
          source.kind === "local" ||
          Boolean(source.canExtract)
      ) || activeSource;
    try {
      if (downloadSource !== activeSource) {
        setFallbackNotice(`Using ${downloadSource.provider} ${downloadSource.label} for download.`);
      }
      if (downloadSource.kind === "direct" || downloadSource.kind === "hls" || downloadSource.kind === "local") {
        if (onDownloadSource) {
          await onDownloadSource(downloadSource, title);
        } else if (onDownload) {
          await onDownload(downloadSource.url, title);
        }
        return;
      }
      if (downloadSource.kind === "embed") {
        const data = await extractDirectStreamUrl(
          downloadSource.externalUrl || downloadSource.url
        );
        const extractedSource: StreamSource = {
          ...downloadSource,
          kind: inferStreamKind(data.url),
          url: data.url,
          externalUrl: downloadSource.externalUrl || downloadSource.url,
          canExtract: false,
        };
        if (onDownloadSource) {
          await onDownloadSource(extractedSource, title);
        } else if (onDownload) {
          await onDownload(data.url, title);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Download could not be started.";
      setFallbackNotice(message);
      setExtractError(message);
    }
  };

  useEffect(() => {
    if (!activeSource || activeSource.kind !== "embed") return;
    const providerName = activeSource.provider.toLowerCase();
    const shouldPrepareDirect =
      providerName.includes("moviebox") || Boolean(activeSource.canExtract);
    if (!shouldPrepareDirect) return;

    const sourceKey = activeSource.externalUrl || activeSource.url;
    const existingPreparedIndex = extractedSourcesRef.current.findIndex((source) => source.externalUrl === sourceKey);
    if (existingPreparedIndex >= 0) {
      setActiveIndex(baseSources.length + existingPreparedIndex);
      return;
    }

    const alreadyPrepared = extractedSourcesRef.current.some((source) => source.externalUrl === sourceKey);
    if (alreadyPrepared) return;

    let cancelled = false;
    const prepare = async () => {
      try {
        const data = await extractDirectStreamUrl(
          activeSource.externalUrl || activeSource.url
        );
        if (!data.url || cancelled) return;

        const extracted: StreamSource = {
          id: `auto-extracted-${Date.now()}`,
          label: `${activeSource.label} Direct`,
          provider: activeSource.provider,
          kind: inferStreamKind(data.url),
          url: data.url,
          quality: data.quality ?? "Auto",
          description: "Auto-prepared direct stream for quieter servers and downloads",
          externalUrl: sourceKey,
          canExtract: false,
          subtitles: activeSource.subtitles,
          language: activeSource.language,
        };

        extractedSourcesRef.current = [...extractedSourcesRef.current, extracted];
        setExtractedSources([...extractedSourcesRef.current]);
        const nextIndex = baseSources.length + extractedSourcesRef.current.length - 1;
        setActiveIndex(nextIndex);
        setFallbackNotice(
          providerName.includes("moviebox")
            ? "Prepared an internal MovieBox stream so playback, subtitles, and downloads work more reliably."
            : `Prepared an internal ${activeSource.provider} stream so iframe restrictions do not block playback.`
        );
      } catch {
        // Silent background preparation.
      }
    };

    void prepare();
    return () => {
      cancelled = true;
    };
  }, [API, activeSource, baseSources.length]);

  useEffect(() => {
    if (!activeSource || activeSource.kind !== "embed" || volumeBoost <= 100) return;

    const canPrepare =
      activeSource.provider.toLowerCase().includes("moviebox") || Boolean(activeSource.canExtract);
    if (!canPrepare) {
      setFallbackNotice("Volume boost is unavailable for this embedded source.");
      setVolumeBoost(100);
      return;
    }

    let cancelled = false;
    setFallbackNotice("Preparing an internal stream so volume boost can be applied...");

    const prepareForBoost = async () => {
      try {
        const nextIndex = await prepareInternalSource(activeSource, {
          notice: "Prepared internal stream for audio boost.",
        });
        if (cancelled) return;
        setActiveIndex(nextIndex);
        setReloadKey((value) => value + 1);
        setFallbackNotice("Switched to an internal stream so volume boost can be applied.");
      } catch {
        if (cancelled) return;
        setFallbackNotice("Volume boost is unavailable for this embedded source.");
        setVolumeBoost(100);
      }
    };

    void prepareForBoost();
    return () => {
      cancelled = true;
    };
  }, [activeSource, baseSources.length, volumeBoost]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={rootRef}
      className="player-shell"
      onMouseMove={showControls}
      onClick={handleShellClick}
    >
      <input
        ref={subtitleInputRef}
        type="file"
        accept=".vtt,text/vtt"
        style={{ display: "none" }}
        onChange={onSubtitlePicked}
      />

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

      {activeSource ? (
        <>
          {isEmbedEngine && (
            <iframe
              key={`${activeSource.id}-${reloadKey}`}
              src={resolvedEmbedUrl || activeSource.url}
              className="player-frame"
              allowFullScreen
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              referrerPolicy="unsafe-url"
              title={`${title} - ${activeSource.provider}`}
              onLoad={() => {
                embedLoadedRef.current = true;
                setIsLoading(false);
                setStatusText("Embed loaded");
              }}
            />
          )}

          {isDirectEngine && (
            <>
              <video
                key={`${activeSource.id}-${reloadKey}`}
                ref={videoRef}
                crossOrigin="anonymous"
                playsInline
                preload="auto"
                poster={poster}
                className="player-video"
                onClick={(event) => {
                  event.stopPropagation();
                  togglePlayback();
                }}
              >
                {subtitleUrl && (
                  <track
                    key={subtitleUrl}
                    default
                    kind="subtitles"
                    label={subtitleName || "Subtitles"}
                    src={subtitleUrl}
                  />
                )}
              </video>
              {currentCue && (
                <div
                  style={{
                    position: "absolute",
                    bottom: 72,
                    width: "100%",
                    textAlign: "center",
                    color: "white",
                    textShadow: "2px 2px 4px black",
                    fontSize: "1.1rem",
                    lineHeight: 1.45,
                    pointerEvents: "none",
                    zIndex: 10,
                    padding: "0 20px",
                    whiteSpace: "pre-line",
                  }}
                >
                  {currentCue}
                </div>
              )}
            </>
          )}

          {isLoading && (
            <div className="player-overlay">
              <div className="player-loader" />
              <div className="player-overlay-title">
                Loading {activeSource.provider}
              </div>
              <div className="player-overlay-subtitle">
                {activeSource.kind === "embed"
                  ? "Preparing the stream."
                  : activeSource.kind === "hls"
                    ? "Preparing the HLS stream."
                    : activeSource.kind === "local"
                      ? "Opening your local file."
                      : "Preparing direct playback."}
              </div>
            </div>
          )}

          {errorText && !hasFallback && (
            <div className="player-assist-card">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 8,
                }}
              >
                <IconAlert size={15} color="#ffcf75" />
                <strong style={{ color: "#fff", fontSize: 13 }}>
                  Playback failed for all sources.
                </strong>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,0.72)",
                  lineHeight: 1.6,
                }}
              >
                Open the server picker and try another source when more servers
                are available.
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="player-overlay">
          <IconInfo size={18} color="rgba(255,255,255,0.8)" />
          <div className="player-overlay-title">No source available</div>
          <div className="player-overlay-subtitle">
            {activeSubtitleText || subtitle || "Add a stream provider to play this title."}
          </div>
        </div>
      )}

      {(fallbackNotice || errorText) && (
        <div className="player-floating-status">
          {errorText ? (
            <IconAlert size={14} color="#ffd0cb" />
          ) : (
            <IconInfo size={14} color="#d7e9ff" />
          )}
          <span>{errorText || fallbackNotice}</span>
        </div>
      )}

      {!errorText && subtitleHint && (
        <div className="player-floating-status player-floating-status-right">
          <IconSubtitle size={14} color="#d7e9ff" />
          <span>{subtitleHint}</span>
        </div>
      )}

      <div
        className={`player-hover-ui${showChrome ? " visible" : ""}${
          compactControls ? " compact" : ""
        }`}
        style={{
          transform: showChrome ? "translateY(0)" : "translateY(10px)",
          transition: "opacity 220ms ease, transform 220ms ease",
        }}
      >
        <div className="player-top-fade" />
        {!compactControls && <div className="player-bottom-fade" />}

        <button
          className="player-control-icon player-back-button"
          onClick={onClose}
          title="Back"
          aria-label="Back"
          style={{ position: "absolute", top: 16, left: 16, zIndex: 12, pointerEvents: "auto" }}
        >
          <IconArrowLeft size={20} color="currentColor" />
        </button>

        <div
          className={`player-controls-wrap${compactControls ? " compact" : ""}`}
        >
          {isDirectEngine && (
            <div className="player-timeline">
              <span>{formatTime(currentTime)}</span>
              <input
                className="player-progress-range"
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(currentTime, duration || 0)}
                onChange={handleSeek}
              />
              <span>{formatTime(duration)}</span>
            </div>
          )}

          <div className="player-control-row">
            <div
              style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
            >
              {isDirectEngine && (
                <button
                  className="player-control-icon primary"
                  onClick={togglePlayback}
                  title={isPlaying ? "Pause" : "Play"}
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? (
                    <IconPause size={16} color="currentColor" />
                  ) : (
                    <IconPlay size={16} color="currentColor" />
                  )}
                </button>
              )}

              {episodeOptions && episodeOptions.length > 0 && (
                <div className="player-menu-wrap">
                  <button
                    className="player-control-btn"
                    onClick={() => {
                      setEpisodeMenuOpen((open) => !open);
                      setServerMenuOpen(false);
                      setVolumeMenuOpen(false);
                      setSubtitleMenuOpen(false);
                    }}
                    title={episodeLabel}
                    aria-label={episodeLabel}
                  >
                    <IconList size={16} color="currentColor" />
                    {activeEpisode ? `${episodeLabel} ${activeEpisode}` : episodeLabel}
                  </button>
                  {episodeMenuOpen && (
                    <div className="player-popover narrow" style={{ maxHeight: 280, overflowY: "auto" }}>
                      <div className="player-popover-label">{episodeLabel}s</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {episodeOptions.map((episode) => (
                          <button
                            key={episode}
                            className={`quality-chip${activeEpisode === episode ? " active" : ""}`}
                            onClick={() => void handleEpisodeSwitch(episode)}
                            disabled={episodeLoading}
                          >
                            {episode}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeEpisode && episodeOptions && episodeOptions.includes(activeEpisode + 1) && (
                <button
                  className="player-control-btn"
                  onClick={() => void handleEpisodeSwitch(activeEpisode + 1)}
                  title={`Next ${episodeLabel.toLowerCase()}`}
                  aria-label={`Next ${episodeLabel.toLowerCase()}`}
                  disabled={episodeLoading}
                >
                  Next {episodeLabel}
                </button>
              )}

              {/* Server picker */}
              <div className="player-menu-wrap">
                <button
                  className="player-control-icon"
                  onClick={() => {
                    setServerMenuOpen((open) => !open);
                    setVolumeMenuOpen(false);
                    setSubtitleMenuOpen(false);
                  }}
                  title="Servers"
                  aria-label="Servers"
                >
                  <IconServers size={16} color="currentColor" />
                </button>

                {serverMenuOpen && (
                  <div className="player-popover player-popover-animated">
                    {sourceOptions && sourceOptions.length > 0
                      ? sourceOptions.map((option) => (
                          <button
                            key={option.id}
                            className={`player-popover-item${
                              option.id === activeSourceOptionId ? " active" : ""
                            }`}
                            onClick={() => void handleSourceOptionSwitch(option.id)}
                          >
                            <span>{option.label}</span>
                            <small>{episodeLoading ? "Loading" : "HiAnime"}</small>
                          </button>
                        ))
                      : allSources.map((source, index) => (
                          <button
                            key={source.id}
                            className={`player-popover-item${
                              index === activeIndex ? " active" : ""
                            }`}
                            onClick={() => handleSourceSwitch(index)}
                          >
                            <span>{source.label}</span>
                            <small>{source.provider}</small>
                          </button>
                        ))}

                    {/* Divider + Extract button — shown only for embed sources */}
                    {isEmbedEngine && activeSource?.canExtract && (
                      <>
                        <div
                          style={{
                            height: 1,
                            background: "rgba(255,255,255,0.1)",
                            margin: "4px 0",
                          }}
                        />
                        <button
                          className="player-popover-item"
                          onClick={handleExtractStream}
                          disabled={extracting}
                          style={{ opacity: extracting ? 0.6 : 1 }}
                        >
                          <span>
                            {extracting ? "Extracting…" : "Extract Direct Stream"}
                          </span>
                          <small>
                            {extracting
                              ? "Please wait"
                              : "Play + download via yt-dlp"}
                          </small>
                        </button>
                        {extractError && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "#ffd0cb",
                              padding: "4px 8px",
                              lineHeight: 1.5,
                            }}
                          >
                            {extractError}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              <button
                className="player-control-icon"
                onClick={() => void handleDownloadCurrent()}
                title="Download"
                aria-label="Download"
                disabled={!activeSource}
              >
                <IconDownload size={16} color="currentColor" />
              </button>

              {/* Volume boost */}
              <div className="player-menu-wrap">
                <button
                  className="player-control-icon"
                  onClick={() => {
                    setVolumeMenuOpen((open) => !open);
                    setServerMenuOpen(false);
                    setSubtitleMenuOpen(false);
                  }}
                  title={`Volume ${volumeBoost}%`}
                  aria-label={`Volume ${volumeBoost}%`}
                >
                  <IconAudio size={16} color="currentColor" />
                </button>
                {volumeMenuOpen && (
                  <div className="player-popover narrow player-popover-animated">
                    <div className="player-popover-label">Volume boost</div>
                    <input
                      type="range"
                      min={0}
                      max={500}
                      step={25}
                      value={volumeBoost}
                      onChange={(e) => setVolumeBoost(Number(e.target.value))}
                    />
                    <div className="player-mini-note">
                      {isEmbedEngine
                        ? activeSource?.provider.toLowerCase().includes("moviebox")
                          ? "GRABIX will try to swap MovieBox embeds to an internal stream so boost can apply."
                          : "Boost works only for direct/internal streams. Embed servers control their own audio."
                        : "Audio boost can go up to 500% for quiet streams."}
                    </div>
                  </div>
                )}
              </div>

              {/* Subtitles */}
              <div className="player-menu-wrap">
                <button
                  className="player-control-icon"
                  onClick={() => {
                    toggleSubtitles();
                    setServerMenuOpen(false);
                    setVolumeMenuOpen(false);
                    setSubtitleMenuOpen(false);
                  }}
                  title={subtitlesEnabled ? "CC On" : "CC Off"}
                  aria-label={subtitlesEnabled ? "Disable subtitles" : "Enable subtitles"}
                >
                  <IconSubtitle size={16} color="currentColor" />
                </button>
              </div>

              {/* Fullscreen */}
              <button
                className="player-control-icon"
                onClick={toggleFullscreen}
                title="Fullscreen"
                aria-label="Fullscreen"
              >
                <IconExpand size={16} color="currentColor" />
              </button>
            </div>

            {!compactControls && (
              <div className="player-right-note">
                <span>
                  {activeSource
                    ? `${activeSource.provider} · ${statusText}`
                    : "Waiting for source"}
                </span>
                {subtitleName && (
                  <span style={{ marginLeft: 10 }}>
                    Subtitle: {subtitleName}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
