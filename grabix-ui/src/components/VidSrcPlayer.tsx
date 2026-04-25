// VidSrcPlayer.tsx — JSX-only root. All logic in player/usePlayerState.ts.
import { useEffect, useState } from "react";
import type { Props } from "./player/types";
import { usePlayerState } from "./player/usePlayerState";
import { formatTime } from "./player/helpers";
import SubtitlePanel from "./SubtitlePanel";
import { IconAlert, IconArrowLeft, IconDownload, IconExpand, IconInfo, IconList, IconPause, IconPlay, IconSettings, IconSubtitle } from "./Icons";
import "./player/helpers"; // side-effect: injects CSS once
import { SkipButton } from "./player/SkipButton";
import { NextEpisodeCountdown } from "./player/NextEpisodeCountdown";
import { SpeedSelector } from "./player/SpeedSelector";
import type { StreamSource } from "../lib/streamProviders";

// ── Floating server switcher — always visible, works with iframes ─────────────
function ServerSwitcher({
  sources,
  activeIndex,
  onSwitch,
}: {
  sources: StreamSource[];
  activeIndex: number;
  onSwitch: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  if (sources.length < 2) return null;

  const active = sources[activeIndex];

  return (
    <div
      style={{
        position: "absolute", top: 12, right: 12, zIndex: 200,
        display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6,
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Toggle button — always visible */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 10px", borderRadius: 20,
          background: "rgba(0,0,0,0.72)", border: "1px solid rgba(255,255,255,0.18)",
          color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer",
          backdropFilter: "blur(6px)", letterSpacing: "0.03em",
          transition: "background 0.15s",
        }}
        title="Switch Server"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12H19M5 12l4-4M5 12l4 4M19 12l-4-4M19 12l-4 4" />
        </svg>
        {active?.label ?? "Server"}
        <span style={{ opacity: 0.5, fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            background: "rgba(18,18,18,0.96)", border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10, overflow: "hidden", minWidth: 180,
            boxShadow: "0 12px 40px rgba(0,0,0,0.8)",
            backdropFilter: "blur(12px)",
          }}
        >
          <div style={{ padding: "8px 12px 6px", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Choose Server
          </div>
          {sources.map((src, i) => (
            <div
              key={src.id}
              onClick={() => { onSwitch(i); setOpen(false); }}
              style={{
                padding: "9px 14px", cursor: "pointer", fontSize: 12,
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                background: i === activeIndex ? "rgba(255,255,255,0.1)" : "transparent",
                color: i === activeIndex ? "#fff" : "rgba(255,255,255,0.7)",
                borderLeft: i === activeIndex ? "3px solid var(--accent, #e50914)" : "3px solid transparent",
                transition: "background 0.1s",
              }}
              onMouseEnter={e => { if (i !== activeIndex) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.06)"; }}
              onMouseLeave={e => { if (i !== activeIndex) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              <span style={{ fontWeight: i === activeIndex ? 700 : 400 }}>{src.label}</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{src.provider}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Extended props — extra Phase 4 additions on top of the base Props type
type ExtendedProps = Props & {
  /** Seconds at which Skip Intro button appears (default: disabled if 0) */
  introShowAt?: number;
  /** Seconds to seek to when Skip Intro is clicked */
  introSkipTo?: number;
  /** Seconds at which Skip Recap button appears (default: disabled if 0) */
  recapShowAt?: number;
  /** Seconds to seek to when Skip Recap is clicked */
  recapSkipTo?: number;
  /** Called when auto-play next episode countdown completes or user clicks Play Next */
  onNextEpisode?: () => void;
  /** Label for the next episode in the countdown widget */
  nextEpisodeLabel?: string;
  /** Storage key for persisting skip points (usually show ID or movie ID) */
  skipStorageKey?: string;
};

export default function VidSrcPlayer(rawProps: ExtendedProps) {
  const {
    introShowAt = 0, introSkipTo = 0,
    recapShowAt = 0, recapSkipTo = 0,
    onNextEpisode, nextEpisodeLabel = "Next Episode",
    skipStorageKey,
  } = rawProps;
  const props = rawProps as Props;
  const p = usePlayerState(props);
  const { title, episodeLabel = "Episode", episodeOptions, sourceOptions, onClose, onDownload, onDownloadSource, disableSubtitleSearch, mediaType } = props;

  // Reactive currentTime for SkipButton + NextEpisodeCountdown (direct engine only)
  const [currentTime, setCurrentTime] = useState(0);
  useEffect(() => {
    const video = p.videoRef?.current;
    if (!video) return;
    const onTime = () => setCurrentTime(video.currentTime);
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  });

  return (
    <div ref={p.rootRef} className={`gx-player${p.showChrome ? " controls-visible" : ""}`} onMouseMove={p.showControls} onClick={p.handleShellClick}>
      <input ref={p.subtitleInputRef} type="file" accept=".vtt,.srt,text/vtt,application/x-subrip,.sub,.txt" style={{ display: "none" }} onChange={p.onSubtitlePicked} />
      <video ref={p.previewVideoRef} style={{ display: "none" }} muted playsInline crossOrigin="anonymous" />
      <canvas ref={p.previewCanvasRef} style={{ display: "none" }} />

      {/* Video / Iframe */}
      {p.activeSource && p.isEmbedEngine && (
        <iframe key={`${p.activeSource.id}-${p.reloadKey}`} src={p.resolvedEmbedUrl || p.activeSource.url} allowFullScreen allow="autoplay; fullscreen; picture-in-picture; encrypted-media" referrerPolicy="unsafe-url" title={`${title} - ${p.activeSource.provider}`} onLoad={() => { p.embedLoadedRef.current = true; }} />
      )}
      {p.activeSource && p.isDirectEngine && (
        <video key={`${p.activeSource.id}-${p.reloadKey}`} ref={p.videoRef} crossOrigin="anonymous" playsInline preload="auto" poster={props.poster} onClick={(e) => { e.stopPropagation(); p.setShowSubtitlePanel(false); p.setSettingsOpen(false); p.togglePlayback(); }} />
      )}

      {/* Subtitle Cue */}
      {p.currentCue && p.isDirectEngine && (
        <div className="gx-cue" style={{ bottom: p.showChrome ? 90 : 24, transform: `translate(${p.subtitlePosition.x}px, ${p.subtitlePosition.y}px)` }}>
          <div className={`gx-cue-window${p.draggingSubtitle ? " dragging" : ""}`} style={p.subtitleStyles.window} onMouseDown={p.handleSubtitleDragStart} title="Drag subtitles">
            <span style={p.subtitleStyles.text}>{p.currentCue}</span>
          </div>
        </div>
      )}

      {/* Pause overlay */}
      {p.isDirectEngine && (
        <div className={`gx-pause-overlay${!p.isPlaying && !p.isLoading ? " visible" : ""}`}>
          <div className="gx-pause-title">{title}</div>
          {p.subtitle && <div className="gx-pause-sub">{p.subtitle}</div>}
        </div>
      )}

      {/* Spinner */}
      {p.isLoading && (
        <div className="gx-spinner-wrap"><div className="gx-spinner-panel"><div className="gx-spinner" /><div className="gx-spinner-label">{p.statusText || "Loading"}</div></div></div>
      )}

      {/* ── Always-visible floating server switcher ── */}
      <ServerSwitcher
        sources={p.allSources}
        activeIndex={p.activeIndex}
        onSwitch={(i) => { p.handleSourceSwitch(i); }}
      />

      {/* Error / No-source */}
      {p.errorText && !p.hasFallback && !p.isLoading && (
        <div className="gx-error">
          <div className="gx-error-msg">Couldn't load this source</div>
          {p.allSources.length > 1 && <button className="gx-error-btn" onClick={() => { p.setActiveIndex(i => Math.min(i + 1, p.allSources.length - 1)); p.setReloadKey(k => k + 1); p.setErrorText(""); }}>Try next source</button>}
        </div>
      )}
      {!p.activeSource && !p.isLoading && <div className="gx-error"><div className="gx-error-msg">No source available</div></div>}

      {/* Floating notice */}
      {(p.fallbackNotice || (p.extractError && !p.settingsOpen)) && (
        <div className={`gx-notice${p.extractError ? " error" : ""}`}>
          {p.extractError ? <IconAlert size={13} color="currentColor" /> : <IconInfo size={13} color="currentColor" />}
          <span>{p.extractError || p.fallbackNotice}</span>
        </div>
      )}

      {/* Subtitle panel */}
      {p.showSubtitlePanel && (
        <div className="gx-subtitle-panel" data-subtitle-panel="true">
          <SubtitlePanel mediaTitle={title} searchTitle={p.activeSearchTitle} mediaType={mediaType} visible={p.showSubtitlePanel} onClose={() => p.setShowSubtitlePanel(false)} onSubtitleLoaded={p.handleSubtitleLoaded} onOpenLocalFile={() => p.subtitleInputRef.current?.click()} onSelectTrack={p.handleSubtitleSelect} availableTracks={p.activeSubtitles} activeSubtitleName={p.subtitleName} onClearSubtitles={p.clearSubtitles} />
        </div>
      )}

      {/* Back button */}
      <button style={{ position: "absolute", top: 16, left: 16, zIndex: 50, pointerEvents: "auto" }} className="gx-btn lg" onClick={onClose} title="Back" aria-label="Back">
        <IconArrowLeft size={18} color="currentColor" />
      </button>

      {/* ── Skip Intro / Recap buttons (direct engine only) ── */}
      {p.isDirectEngine && introShowAt > 0 && (
        <SkipButton kind="intro" currentTime={currentTime} duration={p.duration}
          showAt={introShowAt} skipTo={introSkipTo}
          onSkip={(to) => { if (p.videoRef?.current) p.videoRef.current.currentTime = to; }}
          storageKey={skipStorageKey} />
      )}
      {p.isDirectEngine && recapShowAt > 0 && (
        <SkipButton kind="recap" currentTime={currentTime} duration={p.duration}
          showAt={recapShowAt} skipTo={recapSkipTo}
          onSkip={(to) => { if (p.videoRef?.current) p.videoRef.current.currentTime = to; }}
          storageKey={skipStorageKey} />
      )}

      {/* ── Next Episode Countdown (TV, direct engine only) ── */}
      {p.isDirectEngine && onNextEpisode && (
        <NextEpisodeCountdown currentTime={currentTime} duration={p.duration}
          nextEpisodeLabel={nextEpisodeLabel} onNext={onNextEpisode} />
      )}

      {/* ── Controls Overlay ── */}
      <div className={`gx-controls${p.showChrome ? " visible" : ""}`}>
        <div className="gx-bottom">

          {/* Progress bar */}
          {p.isDirectEngine && (
            <div ref={p.progressBarRef} className="gx-progress-wrap" onMouseMove={p.handleProgressHover} onMouseLeave={p.handleProgressLeave} style={{ position: "relative" }}>
              {p.hoverPreview?.visible && (
                <div className="gx-preview" style={{ left: Math.max(80, Math.min(p.hoverPreview.x, (p.progressBarWidthRef.current || 300) - 80)) }}>
                  {p.hoverPreview.dataUrl ? <img src={p.hoverPreview.dataUrl} alt="" /> : <div style={{ width: 160, height: 90, borderRadius: 6, background: "#111", border: "1px solid rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Preview</span></div>}
                  <span>{formatTime(p.hoverPreview.time)}</span>
                </div>
              )}
              <div className="gx-progress-track">
                <div ref={p.bufferRef} className="gx-progress-buffer" style={{ width: "0%" }} />
                <div ref={p.fillRef} className="gx-progress-fill" style={{ width: "0%" }} />
                <div ref={p.thumbRef} className="gx-progress-thumb" style={{ left: "0%" }} />
                <input ref={p.rangeRef} className="gx-progress-input" type="range" min={0} max={p.duration || 0} step={0.1} defaultValue={0} onChange={p.handleSeek} />
              </div>
            </div>
          )}

          <div className="gx-ctrl-row">
            {/* Left */}
            <div className="gx-ctrl-left">
              {p.isDirectEngine && (
                <>
                  <button className="gx-btn" onClick={p.togglePlayback} title={p.isPlaying ? "Pause" : "Play"} style={{ width: 44, height: 44 }}>
                    {p.isPlaying ? <IconPause size={22} color="currentColor" /> : <IconPlay size={22} color="currentColor" />}
                  </button>
                  <button className="gx-skip-btn" title="Back 10s" onClick={() => { const v = p.videoRef.current; if (v) v.currentTime = Math.max(v.currentTime - 10, 0); }}>
                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none"><path d="M13 4.5C8.3 4.5 4.5 8.3 4.5 13S8.3 21.5 13 21.5 21.5 17.7 21.5 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M13 4.5L9 2M13 4.5L9 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><text x="13.2" y="15" textAnchor="middle" fill="currentColor" fontSize="7.5" fontWeight="700" fontFamily="system-ui">10</text></svg>
                  </button>
                  <button className="gx-skip-btn" title="Forward 10s" onClick={() => { const v = p.videoRef.current; if (v) v.currentTime = Math.min(v.currentTime + 10, p.duration); }}>
                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none"><path d="M13 4.5C17.7 4.5 21.5 8.3 21.5 13S17.7 21.5 13 21.5 4.5 17.7 4.5 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M13 4.5L17 2M13 4.5L17 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><text x="12.8" y="15" textAnchor="middle" fill="currentColor" fontSize="7.5" fontWeight="700" fontFamily="system-ui">10</text></svg>
                  </button>
                  <div className="gx-volume-wrap">
                    <button className="gx-btn" title={p.isMuted ? "Unmute" : "Mute"} onClick={() => { const v = p.videoRef.current; if (v) { v.muted = !v.muted; } }}>
                      {p.isMuted || p.volume === 0
                        ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                        : p.volume < 0.5
                          ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                          : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                      }
                    </button>
                    <div className="gx-volume-slider-container">
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <input type="range" min={0} max={1} step={0.02} value={p.isMuted ? 0 : p.volume} className="gx-volume-slider" onChange={(e) => { const v = p.videoRef.current; if (v) { v.volume = Number(e.target.value); v.muted = Number(e.target.value) === 0; } }} onClick={e => e.stopPropagation()} />
                        {p.isDirectEngine && (<><div className="gx-boost-divider" /><div className="gx-boost-label">Boost</div><input type="range" min={100} max={500} step={25} value={p.volumeBoost} className="gx-boost-slider" onChange={(e) => p.setVolumeBoost(Number(e.target.value))} onClick={e => e.stopPropagation()} /><div className="gx-boost-val">{p.volumeBoost}%</div></>)}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Center */}
            {p.isDirectEngine && <div className="gx-ctrl-center"><span ref={p.timeDisplayRef}>0:00</span> / {formatTime(p.duration)}</div>}

            {/* Right */}
            <div className="gx-ctrl-right">
              <button className={`gx-btn${p.subtitlesEnabled ? "" : " dim"}`} title={p.subtitlesEnabled ? "CC On" : "CC Off"} onClick={p.toggleSubtitles}><IconSubtitle size={20} color="currentColor" /></button>

              {/* Speed pill — always-visible shortcut; full list also in Settings › Speed */}
              <SpeedSelector value={p.playbackSpeed} onChange={p.setPlaybackSpeed} enabled={p.isDirectEngine} />

              {episodeOptions && episodeOptions.length > 0 && (
                <div className="gx-ep-wrap">
                  <button className="gx-btn" title={episodeLabel} onClick={(e) => { e.stopPropagation(); p.setSettingsOpen(false); p.setSettingsScreen("main"); p.setEpisodeMenuOpen(open => !open); }}><IconList size={20} color="currentColor" /></button>
                  {p.episodeMenuOpen && (
                    <div className="gx-ep-panel">
                      <div className="gx-ep-label">{episodeLabel}s</div>
                      {episodeOptions.map(ep => (
                        <div key={ep} className={`gx-ep-item${p.activeEpisode === ep ? " active" : ""}`} onClick={() => { void p.handleEpisodeSwitch(ep); p.setEpisodeMenuOpen(false); }} style={{ opacity: p.episodeLoading ? 0.5 : 1 }}>
                          <span>{episodeLabel} {ep}</span><span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(onDownload || onDownloadSource || p.allSources.some(s => s.kind !== "embed")) && (
                <button className="gx-btn" title="Download" onClick={() => void p.handleDownloadCurrent()}><IconDownload size={20} color="currentColor" /></button>
              )}

              {/* Settings */}
              <div style={{ position: "relative" }} data-settings="true">
                <button className="gx-btn" title="Settings" onClick={(e) => { e.stopPropagation(); p.setEpisodeMenuOpen(false); p.setSettingsOpen(open => !open); p.setSettingsScreen("main"); }}><IconSettings size={20} color="currentColor" /></button>
                {p.settingsOpen && (
                  <div className="gx-settings-panel" style={{ bottom: "calc(100% + 8px)", top: "auto", right: 0 }} data-settings="true">

                    {p.settingsScreen === "main" && (
                      <div className="gx-settings-screen" style={{ padding: "4px 0 6px" }}>
                        {p.hasQualityOptions && <div className="gx-settings-row" onClick={() => p.setSettingsScreen("quality")}><span>Quality</span><div className="gx-settings-row-val"><span>{p.hasAdaptiveHlsLevels ? p.currentQualityLabel : (p.allSources[p.activeIndex]?.quality ?? p.activeSource?.label ?? "Auto")}</span><span className="gx-settings-chevron">›</span></div></div>}
                        <div className="gx-settings-row" onClick={() => p.setSettingsScreen("speed")}><span>Speed</span><div className="gx-settings-row-val"><span>{p.playbackSpeed === 1 ? "Normal" : `${p.playbackSpeed}×`}</span><span className="gx-settings-chevron">›</span></div></div>
                        {(p.activeSubtitles.length > 0 || Boolean(p.subtitleUrl) || !disableSubtitleSearch) && <div className="gx-settings-row" onClick={() => p.setSettingsScreen("subtitles")}><span>Subtitles</span><div className="gx-settings-row-val"><span>{p.subtitlesEnabled && p.subtitleName ? p.subtitleName.slice(0, 16) : p.subtitlesEnabled ? "On" : "Off"}</span><span className="gx-settings-chevron">›</span></div></div>}
                        {(p.allSources.length > 1 || (sourceOptions && sourceOptions.length > 0)) && <div className="gx-settings-row" onClick={() => p.setSettingsScreen("server")}><span>Server</span><div className="gx-settings-row-val"><span style={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.currentServerLabel}</span><span className="gx-settings-chevron">›</span></div></div>}
                        {episodeOptions && episodeOptions.length > 0 && <div className="gx-settings-row" onClick={() => p.setSettingsScreen("episodes")}><span>Episodes</span><div className="gx-settings-row-val"><span>{p.activeEpisode ? `${episodeLabel} ${p.activeEpisode}` : "Select"}</span><span className="gx-settings-chevron">›</span></div></div>}
                        {p.isEmbedEngine && (p.activeSource?.provider?.toLowerCase().includes("moviebox") || p.activeSource?.canExtract) && <div className="gx-settings-row" onClick={() => void p.handleExtractStream()}><span>{p.extracting ? "Extracting…" : "Extract Direct Stream"}</span></div>}
                      </div>
                    )}

                    {p.settingsScreen === "quality" && (
                      <div className="gx-settings-screen">
                        <div className="gx-settings-header"><button className="gx-settings-header-btn" onClick={() => p.setSettingsScreen("main")}>←</button>Quality</div>
                        <div className="gx-settings-list">
                          {p.hasAdaptiveHlsLevels ? (<>
                            <div className={`gx-settings-item${p.hlsAutoQuality ? " active" : ""}`} onClick={() => { p.setHlsAutoQuality(true); p.setSelectedHlsLevel(-1); if (p.hlsRef.current) { p.hlsRef.current.currentLevel = -1; p.hlsRef.current.loadLevel = -1; p.hlsRef.current.nextLevel = -1; } p.setSettingsScreen("main"); }}><span>Auto</span><span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span></div>
                            {p.hlsLevels.map(({ height, bitrate }, index) => (
                              <div key={index} className={`gx-settings-item${!p.hlsAutoQuality && p.selectedHlsLevel === index ? " active" : ""}`} onClick={() => { p.setHlsAutoQuality(false); p.setSelectedHlsLevel(index); if (p.hlsRef.current) { p.hlsRef.current.currentLevel = index; p.hlsRef.current.loadLevel = index; p.hlsRef.current.nextLevel = index; } p.setSettingsScreen("main"); }}>
                                <span>{height > 0 ? `${height}p` : `Level ${index + 1}`}</span>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{bitrate > 0 && <small style={{ fontSize: 11, color: "var(--player-text-dimmer)" }}>{Math.round(bitrate / 1000)} kbps</small>}<span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span></div>
                              </div>
                            ))}
                          </>) : (p.allSources.map((source, index) => (
                            <div key={source.id} className={`gx-settings-item${index === p.activeIndex ? " active" : ""}`} onClick={() => { p.handleSourceSwitch(index); p.setSettingsScreen("main"); }}><span>{source.quality ?? source.label}</span><span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span></div>
                          )))}
                        </div>
                      </div>
                    )}

                    {p.settingsScreen === "speed" && (
                      <div className="gx-settings-screen">
                        <div className="gx-settings-header"><button className="gx-settings-header-btn" onClick={() => p.setSettingsScreen("main")}>←</button>Playback Speed</div>
                        <div className="gx-settings-list">
                          {[0.5, 0.75, 1, 1.25, 1.5, 2].map(speed => (
                            <div key={speed} className={`gx-settings-item${p.playbackSpeed === speed ? " active" : ""}`} onClick={() => { p.setPlaybackSpeed(speed); p.setSettingsScreen("main"); }}><span>{speed === 1 ? "Normal" : `${speed}×`}</span><span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span></div>
                          ))}
                        </div>
                      </div>
                    )}

                    {p.settingsScreen === "subtitles" && (
                      <div className="gx-settings-screen">
                        <div className="gx-settings-header"><button className="gx-settings-header-btn" onClick={() => p.setSettingsScreen("main")}>{"<"}</button>Subtitles</div>
                        <div className="gx-settings-list">
                          <div className={`gx-settings-item${!p.subtitlesEnabled ? " active" : ""}`} onClick={() => { p.clearSubtitles(); p.setSettingsScreen("main"); }}><span>Off</span><span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>OK</span></div>
                          {p.activeSubtitles.map(track => (<div key={track.url} className={`gx-settings-item${p.subtitlesEnabled && p.subtitleUrl === track.url ? " active" : ""}`} onClick={() => { p.handleSubtitleSelect(track.url, track.label); p.setSettingsScreen("main"); }}><span>{track.label}</span><span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>OK</span></div>))}
                          <div className="gx-settings-divider" />
                          <div className="gx-settings-item" onClick={() => p.setSettingsScreen("subtitleAppearance")}><span>Appearance</span><div className="gx-settings-row-val"><span style={{ color: "var(--player-text-dimmer)" }}>Size and background</span><span className="gx-settings-chevron">{">"}</span></div></div>
                          <div className="gx-settings-item" onClick={() => { p.setShowSubtitlePanel(true); p.setSettingsOpen(false); }}><span>Search subtitles...</span></div>
                          <div className="gx-settings-item" onClick={() => { p.subtitleInputRef.current?.click(); p.setSettingsOpen(false); }}><span>Load from file...</span></div>
                        </div>
                      </div>
                    )}

                    {p.settingsScreen === "subtitleAppearance" && (
                      <div className="gx-settings-screen">
                        <div className="gx-settings-header"><button className="gx-settings-header-btn" onClick={() => p.setSettingsScreen("subtitles")}>{"<"}</button>Subtitle Appearance</div>
                        <div className="gx-settings-list">
                          <div className="gx-settings-field"><div className="gx-settings-split"><label>Size</label><span className="gx-settings-value">{p.subtitleAppearance.fontScale.toFixed(2)}x</span></div><input type="range" min="0.8" max="2.2" step="0.05" value={p.subtitleAppearance.fontScale} onChange={(e) => p.updateSubtitleAppearance("fontScale", Number(e.target.value))} /></div>
                          <div className="gx-settings-field"><div className="gx-settings-split"><label>Background Opacity</label><span className="gx-settings-value">{Math.round(p.subtitleAppearance.backgroundOpacity * 100)}%</span></div><input type="range" min="0" max="1" step="0.05" value={p.subtitleAppearance.backgroundOpacity} onChange={(e) => p.updateSubtitleAppearance("backgroundOpacity", Number(e.target.value))} /></div>
                          <div className="gx-settings-field"><label>Position</label><div className="gx-settings-value" style={{ textAlign: "left" }}>Drag the subtitle with your mouse in the player.</div></div>
                          <div className="gx-settings-divider" />
                          <div className="gx-settings-item" onClick={p.resetSubtitlePosition}><span>Reset position</span></div>
                          <div className="gx-settings-item" onClick={p.resetSubtitleAppearance}><span>Reset size/background</span></div>
                        </div>
                      </div>
                    )}

                    {p.settingsScreen === "server" && (
                      <div className="gx-settings-screen">
                        <div className="gx-settings-header"><button className="gx-settings-header-btn" onClick={() => p.setSettingsScreen("main")}>←</button>Server</div>
                        <div className="gx-settings-list">
                          {sourceOptions && sourceOptions.length > 0
                            ? sourceOptions.map(option => (<div key={option.id} className={`gx-settings-item${option.id === p.activeSourceOptionId ? " active" : ""}`} onClick={() => { void p.handleSourceOptionSwitch(option.id); p.setSettingsScreen("main"); }}><span>{option.label}</span><div style={{ display: "flex", alignItems: "center", gap: 8 }}>{p.episodeLoading && option.id === p.activeSourceOptionId && <small style={{ fontSize: 11, color: "var(--player-text-dimmer)" }}>Loading…</small>}<span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span></div></div>))
                            : p.allSources.map((source, index) => (<div key={source.id} className={`gx-settings-item${index === p.activeIndex ? " active" : ""}`} onClick={() => { p.handleSourceSwitch(index); p.setSettingsScreen("main"); }}><span>{source.label}</span><div style={{ display: "flex", alignItems: "center", gap: 8 }}><small style={{ fontSize: 11, color: "var(--player-text-dimmer)" }}>{source.provider}</small><span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span></div></div>))
                          }
                        </div>
                      </div>
                    )}

                    {p.settingsScreen === "episodes" && (
                      <div className="gx-settings-screen">
                        <div className="gx-settings-header"><button className="gx-settings-header-btn" onClick={() => p.setSettingsScreen("main")}>←</button>{episodeLabel}s</div>
                        <div className="gx-settings-list">
                          {(episodeOptions ?? []).map(ep => (<div key={ep} className={`gx-settings-item${p.activeEpisode === ep ? " active" : ""}`} onClick={() => { void p.handleEpisodeSwitch(ep); p.setSettingsScreen("main"); }} style={{ opacity: p.episodeLoading ? 0.5 : 1 }}><span>{episodeLabel} {ep}</span><span className="gx-check" style={{ color: "var(--player-text-dim)", fontSize: 14 }}>✓</span></div>))}
                        </div>
                      </div>
                    )}

                  </div>
                )}
              </div>

              <button className="gx-btn" onClick={p.toggleFullscreen} title="Fullscreen" aria-label="Fullscreen"><IconExpand size={20} color="currentColor" /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
