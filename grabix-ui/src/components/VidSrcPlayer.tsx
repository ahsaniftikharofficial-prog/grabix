import Hls from "hls.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconAlert, IconAudio, IconExpand, IconInfo, IconPause, IconPlay, IconServers, IconSubtitle } from "./Icons";
import type { StreamSource } from "../lib/streamProviders";

interface Props {
  title: string;
  subtitle?: string;
  poster?: string;
  embedUrl?: string;
  sources?: StreamSource[];
  onClose: () => void;
}

type FailureKind = "timeout" | "blocked_embed" | "media_error" | "unsupported_source" | "open_failed";

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
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function VidSrcPlayer({ embedUrl, title, subtitle, poster, sources, onClose }: Props) {
  const API = "http://127.0.0.1:8000";
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideChromeTimeoutRef = useRef<number | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const mediaNodeRef = useRef<MediaElementAudioSourceNode | null>(null);

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
                kind: "embed",
                url: embedUrl,
                description: "Embedded source",
                quality: "Auto",
                externalUrl: embedUrl,
              },
            ]
          : [],
    [embedUrl, sources]
  );

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

  const activeSource = baseSources[activeIndex] ?? null;
  const hasFallback = activeIndex < baseSources.length - 1;
  const isDirectEngine = activeSource?.kind === "direct" || activeSource?.kind === "hls" || activeSource?.kind === "local";
  const isEmbedEngine = activeSource?.kind === "embed";
  const compactControls = isEmbedEngine;

  const showControls = () => {
    setShowChrome(true);
    if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current);
    if (serverMenuOpen || volumeMenuOpen || subtitleMenuOpen) return;
    hideChromeTimeoutRef.current = window.setTimeout(() => setShowChrome(false), 2600);
  };

  useEffect(() => {
    setActiveIndex(0);
  }, [baseSources]);

  useEffect(() => {
    showControls();
    return () => {
      if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current);
    };
  }, [serverMenuOpen, volumeMenuOpen, subtitleMenuOpen]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key.toLowerCase() === "r") setReloadKey(key => key + 1);
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

  useEffect(() => {
    return () => {
      if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current);
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

  const goToNextSource = (reason: FailureKind) => {
    const message = failureLabel(reason);
    setLastFailure(message);

    if (hasFallback) {
      const nextSource = baseSources[activeIndex + 1];
      setFallbackNotice(`${message} Switched to ${nextSource.label} (${nextSource.provider}).`);
      setActiveIndex(index => index + 1);
      setReloadKey(key => key + 1);
      return;
    }

    setErrorText(message);
    setIsLoading(false);
    setStatusText("Failed");
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch {
      // Ignore unsupported fullscreen hosts.
    }
  };

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

    if (!activeSource) return;

    if (activeSource.kind === "embed") {
      const timeout = window.setTimeout(() => {
        setIsLoading(false);
        setStatusText("Slow source");
        setLastFailure("This source is taking longer than usual. If it stays blank, open the server picker and try another one.");
      }, 14000);
      return () => window.clearTimeout(timeout);
    }

    return undefined;
  }, [activeSource, reloadKey]);

  useEffect(() => {
    if (!activeSource || activeSource.kind !== "embed") return;

    let canceled = false;

    fetch(`${API}/resolve-embed?url=${encodeURIComponent(activeSource.url)}`)
      .then(r => r.json())
      .then(data => {
        if (canceled) return;
        const nextUrl = typeof data.url === "string" && data.url ? data.url : activeSource.url;
        setResolvedEmbedUrl(nextUrl);
      })
      .catch(() => {
        if (!canceled) setResolvedEmbedUrl(activeSource.url);
      });

    return () => {
      canceled = true;
    };
  }, [API, activeSource]);

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
      goToNextSource(activeSource.kind === "local" ? "open_failed" : "media_error");
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

  useEffect(() => {
    if (!isDirectEngine) return;
    const video = videoRef.current;
    if (!video) return;

    if (!audioContextRef.current) {
      const AudioContextCtor = window.AudioContext || ((window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
      if (AudioContextCtor) {
        const context = new AudioContextCtor();
        const mediaNode = context.createMediaElementSource(video);
        const gainNode = context.createGain();
        mediaNode.connect(gainNode);
        gainNode.connect(context.destination);
        audioContextRef.current = context;
        mediaNodeRef.current = mediaNode;
        gainNodeRef.current = gainNode;
      }
    }

    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volumeBoost / 100;
      video.volume = 1;
      void audioContextRef.current?.resume().catch(() => {});
    }
  }, [activeSource, isDirectEngine, volumeBoost]);

  useEffect(() => {
    const trackList = videoRef.current?.textTracks;
    if (!trackList || !subtitleUrl) return;
    for (let index = 0; index < trackList.length; index += 1) {
      trackList[index].mode = index === trackList.length - 1 ? "showing" : "disabled";
    }
  }, [subtitleUrl, activeSource]);

  const handleSourceSwitch = (index: number) => {
    setActiveIndex(index);
    setErrorText("");
    setFallbackNotice("");
    setReloadKey(key => key + 1);
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

  return (
    <div
      ref={rootRef}
      className="player-shell"
      onMouseMove={showControls}
      onClick={showControls}
    >
      <input ref={subtitleInputRef} type="file" accept=".vtt,text/vtt" style={{ display: "none" }} onChange={onSubtitlePicked} />

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
                setIsLoading(false);
                setStatusText("Embed loaded");
                window.setTimeout(() => {
                  setLastFailure("If the screen stays blank, open the server picker and try another source.");
                }, 1200);
              }}
            />
          )}

          {isDirectEngine && (
            <video
              key={`${activeSource.id}-${reloadKey}`}
              ref={videoRef}
              playsInline
              preload="metadata"
              poster={poster}
              className="player-video"
            >
              {subtitleUrl && <track key={subtitleUrl} default kind="subtitles" label={subtitleName || "Subtitles"} src={subtitleUrl} />}
            </video>
          )}

          {isLoading && (
            <div className="player-overlay">
              <div className="player-loader" />
              <div className="player-overlay-title">Loading {activeSource.provider}</div>
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
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <IconAlert size={15} color="#ffcf75" />
                <strong style={{ color: "#fff", fontSize: 13 }}>Playback failed for all sources.</strong>
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)", lineHeight: 1.6 }}>
                Open the server picker and try another source when more servers are available.
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="player-overlay">
          <IconInfo size={18} color="rgba(255,255,255,0.8)" />
          <div className="player-overlay-title">No source available</div>
          <div className="player-overlay-subtitle">{subtitle ?? "Add a stream provider to play this title."}</div>
        </div>
      )}

      {(fallbackNotice || errorText || lastFailure) && (
        <div className="player-floating-status">
          {errorText ? <IconAlert size={14} color="#ffd0cb" /> : <IconInfo size={14} color="#d7e9ff" />}
          <span>{errorText || fallbackNotice || lastFailure}</span>
        </div>
      )}

      <div className={`player-hover-ui${showChrome ? " visible" : ""}${compactControls ? " compact" : ""}`}>
        <div className="player-top-fade" />
        {!compactControls && <div className="player-bottom-fade" />}

        <div className={`player-controls-wrap${compactControls ? " compact" : ""}`}>
          {isDirectEngine && (
            <div className="player-timeline">
              <span>{formatTime(currentTime)}</span>
              <input className="player-progress-range" type="range" min={0} max={duration || 0} step={0.1} value={Math.min(currentTime, duration || 0)} onChange={handleSeek} />
              <span>{formatTime(duration)}</span>
            </div>
          )}

          <div className="player-control-row">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {isDirectEngine && (
                <button className="player-control-icon primary" onClick={togglePlayback} title={isPlaying ? "Pause" : "Play"} aria-label={isPlaying ? "Pause" : "Play"}>
                  {isPlaying ? <IconPause size={16} color="currentColor" /> : <IconPlay size={16} color="currentColor" />}
                </button>
              )}

              <div className="player-menu-wrap">
                <button className="player-control-icon" onClick={() => { setServerMenuOpen(open => !open); setVolumeMenuOpen(false); setSubtitleMenuOpen(false); }} title="Servers" aria-label="Servers">
                  <IconServers size={16} color="currentColor" />
                </button>
                {serverMenuOpen && (
                  <div className="player-popover">
                    {baseSources.map((source, index) => (
                      <button key={source.id} className={`player-popover-item${index === activeIndex ? " active" : ""}`} onClick={() => handleSourceSwitch(index)}>
                        <span>{source.label}</span>
                        <small>{source.provider}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="player-menu-wrap">
                <button className="player-control-icon" onClick={() => { setVolumeMenuOpen(open => !open); setServerMenuOpen(false); setSubtitleMenuOpen(false); }} title={`Volume ${volumeBoost}%`} aria-label={`Volume ${volumeBoost}%`}>
                  <IconAudio size={16} color="currentColor" />
                </button>
                {volumeMenuOpen && (
                  <div className="player-popover narrow">
                    <div className="player-popover-label">Volume boost</div>
                    <input type="range" min={0} max={500} step={25} value={volumeBoost} onChange={e => setVolumeBoost(Number(e.target.value))} />
                    <div className="player-mini-note">
                      {isEmbedEngine ? "Boost works only for direct/internal streams. Embed servers control their own audio." : "Audio boost can go up to 500% for quiet streams."}
                    </div>
                  </div>
                )}
              </div>

              <div className="player-menu-wrap">
                <button className="player-control-icon" onClick={() => { setSubtitleMenuOpen(open => !open); setServerMenuOpen(false); setVolumeMenuOpen(false); }} title="Subtitles" aria-label="Subtitles">
                  <IconSubtitle size={16} color="currentColor" />
                </button>
                {subtitleMenuOpen && (
                  <div className="player-popover narrow">
                    <div className="player-popover-label">Subtitles</div>
                    <button className="player-popover-item" onClick={() => subtitleInputRef.current?.click()}>
                      <span>{subtitleName ? "Replace local VTT" : "Load local VTT"}</span>
                      <small>{subtitleName || "API slot ready"}</small>
                    </button>
                    <div className="player-mini-note">
                      {isEmbedEngine ? "When you share the subtitle API, we can inject it here for supported providers. Embed servers may still limit subtitle control." : "Local VTT works now. API subtitle sources can plug into this panel next."}
                    </div>
                  </div>
                )}
              </div>

              <button className="player-control-icon" onClick={toggleFullscreen} title="Fullscreen" aria-label="Fullscreen">
                <IconExpand size={16} color="currentColor" />
              </button>
            </div>

            {!compactControls && (
              <div className="player-right-note">
                <span>{activeSource ? `${activeSource.provider} · ${statusText}` : "Waiting for source"}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
