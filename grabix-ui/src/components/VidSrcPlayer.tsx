import Hls from "hls.js";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconAlert,
  IconAudio,
  IconExpand,
  IconInfo,
  IconPause,
  IconPlay,
  IconServers,
  IconSubtitle,
} from "./Icons";
import { inferStreamKind } from "../lib/streamProviders";
import type { StreamSource } from "../lib/streamProviders";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  title: string;
  subtitle?: string;
  poster?: string;
  embedUrl?: string;
  sources?: StreamSource[];
  onClose: () => void;
  /**
   * Called when the user successfully extracts a direct stream URL.
   * Lets the parent page route it to the downloader.
   */
  onExtractedUrl?: (url: string, title: string) => void;
}

type FailureKind =
  | "timeout"
  | "blocked_embed"
  | "media_error"
  | "unsupported_source"
  | "open_failed";

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function VidSrcPlayer({
  embedUrl,
  title,
  subtitle,
  poster,
  sources,
  onClose,
  onExtractedUrl,
}: Props) {
  const API = "http://127.0.0.1:8000";

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

  // Sources from props (stable)
  const baseSources = useMemo<StreamSource[]>(
    () =>
      sources && sources.length > 0
        ? sources
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
    [embedUrl, sources]
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
  const [lastFailure, setLastFailure] = useState("");
  const [fallbackNotice, setFallbackNotice] = useState("");
  const [resolvedEmbedUrl, setResolvedEmbedUrl] = useState("");
  const [showChrome, setShowChrome] = useState(true);
  const [serverMenuOpen, setServerMenuOpen] = useState(false);
  const [volumeMenuOpen, setVolumeMenuOpen] = useState(false);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [volumeBoost, setVolumeBoost] = useState(100);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [subtitleUrl, setSubtitleUrl] = useState("");
  const [subtitleName, setSubtitleName] = useState("");

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
  }, [serverMenuOpen, volumeMenuOpen, subtitleMenuOpen]);

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

  const goToNextSource = (reason: FailureKind) => {
    const message = failureLabel(reason);
    setLastFailure(message);

    if (hasFallback) {
      const nextSource = allSources[activeIndex + 1];
      setFallbackNotice(
        `${message} Switched to ${nextSource.label} (${nextSource.provider}).`
      );
      setActiveIndex((index) => index + 1);
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
    setLastFailure("");
    setStatusText(activeSource ? `Loading ${activeSource.provider}` : "No source");
    setResolvedEmbedUrl("");
    setServerMenuOpen(false);
    setVolumeMenuOpen(false);
    setSubtitleMenuOpen(false);
    setExtractError("");
    embedLoadedRef.current = false;

    if (!activeSource) return;

    if (activeSource.kind === "embed") {
      // Slow-source warning after 14 s
      const slowTimeout = window.setTimeout(() => {
        setIsLoading(false);
        setStatusText("Slow source");
        setLastFailure(
          "This source is taking longer than usual. If it stays blank, open the server picker and try another one."
        );
      }, 14_000);

      // Auto-failover after 25 s if the iframe never fired onLoad
      const failoverTimeout = window.setTimeout(() => {
        if (!embedLoadedRef.current) {
          goToNextSource("timeout");
        }
      }, 25_000);

      return () => {
        window.clearTimeout(slowTimeout);
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

    fetch(`${API}/resolve-embed?url=${encodeURIComponent(activeSource.url)}`)
      .then((r) => r.json())
      .then((data) => {
        if (canceled) return;
        const nextUrl =
          typeof data.url === "string" && data.url
            ? data.url
            : activeSource.url;
        setResolvedEmbedUrl(nextUrl);
      })
      .catch(() => {
        if (!canceled) setResolvedEmbedUrl(activeSource.url);
      });

    return () => {
      canceled = true;
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

    const handleCanPlay = () => {
      setIsLoading(false);
      setStatusText("Ready");
      setErrorText("");
    };
    const handleError = () => {
      goToNextSource(
        activeSource.kind === "local" ? "open_failed" : "media_error"
      );
    };
    const handleWaiting = () => {
      setIsLoading(true);
      setStatusText("Buffering");
    };
    const handlePlaying = () => {
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
      if (Hls.isSupported()) {
        const hls = new Hls();
        hlsRef.current = hls;
        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          hls.loadSource(activeSource.url);
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          void video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) goToNextSource("media_error");
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = activeSource.url;
        void video.play().catch(() => {});
      } else {
        goToNextSource("unsupported_source");
      }
    } else {
      video.src = activeSource.url;
      void video.play().catch(() => {});
    }

    return () => {
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
  }, [activeSource, isDirectEngine, reloadKey]);

  // ---------------------------------------------------------------------------
  // Audio boost effect
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!isDirectEngine) return;
    const video = videoRef.current;
    if (!video) return;

    if (volumeBoost === 100) {
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
      void audioContextRef.current?.resume().catch(() => {});
    }
  }, [activeSource, isDirectEngine, volumeBoost]);

  // ---------------------------------------------------------------------------
  // Subtitle track management
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const trackList = videoRef.current?.textTracks;
    if (!trackList || !subtitleUrl) return;
    for (let index = 0; index < trackList.length; index += 1) {
      trackList[index].mode =
        index === trackList.length - 1 ? "showing" : "disabled";
    }
  }, [subtitleUrl, activeSource]);

  useEffect(() => {
    if (subtitleUrl.startsWith("blob:")) {
      URL.revokeObjectURL(subtitleUrl);
    }

    const firstSubtitle = activeSubtitles[0];
    if (firstSubtitle?.url) {
      setSubtitleUrl(firstSubtitle.url);
      setSubtitleName(firstSubtitle.label);
      return;
    }

    setSubtitleUrl("");
    setSubtitleName("");
  }, [activeSource]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSourceSwitch = (index: number) => {
    setActiveIndex(index);
    setErrorText("");
    setFallbackNotice("");
    setExtractError("");
    setReloadKey((key) => key + 1);
    setServerMenuOpen(false);
    showControls();
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
    setSubtitleMenuOpen(false);
    setFallbackNotice(`Loaded subtitles: ${file.name}`);
    event.target.value = "";
  };

  const handleSubtitleSelect = (url: string, label: string) => {
    if (subtitleUrl.startsWith("blob:") && subtitleUrl !== url) {
      URL.revokeObjectURL(subtitleUrl);
    }
    setSubtitleUrl(url);
    setSubtitleName(label);
    setSubtitleMenuOpen(false);
    setFallbackNotice(`Loaded subtitles: ${label}`);
  };

  const clearSubtitles = () => {
    if (subtitleUrl.startsWith("blob:")) {
      URL.revokeObjectURL(subtitleUrl);
    }
    setSubtitleUrl("");
    setSubtitleName("");
    setSubtitleMenuOpen(false);
  };

  /**
   * Ask the backend to extract a direct stream URL from the current embed.
   * On success: adds a Direct source to the list and switches to it.
   * If onExtractedUrl is provided, also notifies the parent (for downloader).
   */
  const handleExtractStream = async () => {
    if (!activeSource || extracting) return;
    setExtracting(true);
    setExtractError("");

    try {
      const res = await fetch(
        `${API}/extract-stream?url=${encodeURIComponent(activeSource.url)}`
      );
      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      const data = (await res.json()) as {
        url?: string;
        quality?: string;
        format?: string;
      };

      if (!data.url) throw new Error("No URL in response");

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

      onExtractedUrl?.(data.url, title);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown extraction error";
      setExtractError(`Could not extract a direct stream: ${message}`);
    } finally {
      setExtracting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={rootRef}
      className="player-shell"
      onMouseMove={showControls}
      onClick={showControls}
    >
      <input
        ref={subtitleInputRef}
        type="file"
        accept=".vtt,text/vtt"
        style={{ display: "none" }}
        onChange={onSubtitlePicked}
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
                window.setTimeout(() => {
                  setLastFailure(
                    "If the screen stays blank, open the server picker and try another source."
                  );
                }, 1200);
              }}
            />
          )}

          {isDirectEngine && (
            <video
              key={`${activeSource.id}-${reloadKey}`}
              ref={videoRef}
              crossOrigin="anonymous"
              playsInline
              preload="metadata"
              poster={poster}
              className="player-video"
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
            {subtitle ?? "Add a stream provider to play this title."}
          </div>
        </div>
      )}

      {(fallbackNotice || errorText || lastFailure) && (
        <div className="player-floating-status">
          {errorText ? (
            <IconAlert size={14} color="#ffd0cb" />
          ) : (
            <IconInfo size={14} color="#d7e9ff" />
          )}
          <span>{errorText || fallbackNotice || lastFailure}</span>
        </div>
      )}

      <div
        className={`player-hover-ui${showChrome ? " visible" : ""}${
          compactControls ? " compact" : ""
        }`}
      >
        <div className="player-top-fade" />
        {!compactControls && <div className="player-bottom-fade" />}

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
                  <div className="player-popover">
                    {/* Source list */}
                    {allSources.map((source, index) => (
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
                  <div className="player-popover narrow">
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
                        ? "Boost works only for direct/internal streams. Embed servers control their own audio."
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
                    setSubtitleMenuOpen((open) => !open);
                    setServerMenuOpen(false);
                    setVolumeMenuOpen(false);
                  }}
                  title="Subtitles"
                  aria-label="Subtitles"
                >
                  <IconSubtitle size={16} color="currentColor" />
                </button>
                {subtitleMenuOpen && (
                  <div className="player-popover narrow">
                    <div className="player-popover-label">Subtitles</div>
                    <button
                      className="player-popover-item"
                      onClick={() => subtitleInputRef.current?.click()}
                    >
                      <span>
                        {subtitleName ? "Replace local VTT" : "Load local VTT"}
                      </span>
                      <small>{subtitleName || "API slot ready"}</small>
                    </button>
                    {activeSubtitles.length > 0 &&
                      activeSubtitles.map((track) => (
                        <button
                          key={track.id}
                          className="player-popover-item"
                          onClick={() => handleSubtitleSelect(track.url, track.label)}
                        >
                          <span>{track.label}</span>
                          <small>{track.language || "Movie Box subtitle"}</small>
                        </button>
                      ))}
                    {subtitleUrl && (
                      <button className="player-popover-item" onClick={clearSubtitles}>
                        <span>Disable subtitles</span>
                        <small>Hide the current subtitle track</small>
                      </button>
                    )}
                    <div className="player-mini-note">
                      {isEmbedEngine
                        ? "When you share the subtitle API, we can inject it here for supported providers. Embed servers may still limit subtitle control."
                        : activeSubtitles.length > 0
                          ? "Movie Box subtitles are ready here, and you can still load a local VTT file."
                          : "Local VTT works now. API subtitle sources can plug into this panel next."}
                    </div>
                  </div>
                )}
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
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
