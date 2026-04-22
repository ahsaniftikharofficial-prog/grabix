// anime/AnimeDetail.tsx — detail panel JSX, reads all logic from useAnimeDetail hook

import { IconDownload, IconHeart, IconPlay, IconStar, IconX } from "../../components/Icons";
import AppToast from "../../components/AppToast";
import DownloadOptionsModal from "../../components/DownloadOptionsModal";
import { AUDIO_BUTTONS, SERVER_BUTTONS } from "./animeTypes";
import type { AnimeCardItem, AnimeServerOption, Tab } from "./animeTypes";
import { useAnimeDetail } from "./useAnimeDetail";
import type { PlayerPayload } from "./useAnimeDetail";
import type { StreamSource } from "../../lib/streamProviders";

interface AnimeDetailProps {
  anime: AnimeCardItem;
  onClose: () => void;
  onPlay: (payload: PlayerPayload) => void;
  consumetHealthy: boolean;
  consumetBaseUrl: string;
  activeTab: Tab;
}

export function AnimeDetail({ anime, onClose, onPlay, consumetHealthy, consumetBaseUrl, activeTab }: AnimeDetailProps) {
  const p = useAnimeDetail({ anime, onPlay, consumetHealthy, consumetBaseUrl, activeTab });

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--bg-surface)", borderRadius: 16, width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", gap: 16, padding: "20px 20px 0" }}>
          <img
            src={anime.image || "https://via.placeholder.com/100x145"}
            alt={p.title}
            referrerPolicy="no-referrer"
            style={{ width: 100, height: 145, objectFit: "cover", borderRadius: 10, flexShrink: 0, border: "1px solid var(--border)" }}
            onError={(e) => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/100x145"; }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, lineHeight: 1.3 }}>{p.title}</div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 8 }}>
              {anime.rating ? (
                <span style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 600, color: "#fdd663" }}>
                  <IconStar size={11} color="#fdd663" /> {anime.rating.toFixed(1)}
                </span>
              ) : null}
              {p.isMovie ? (
                p.totalEpisodes > 1
                  ? <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>{p.totalEpisodes} parts</span>
                  : <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>Movie</span>
              ) : p.totalEpisodes ? (
                <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>{p.totalEpisodes} eps</span>
              ) : null}
              {anime.status ? <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>{anime.status}</span> : null}
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {(anime.genres ?? []).slice(0, 4).map((genre) => (
                <span key={genre} style={{ background: "var(--bg-active)", color: "var(--text-accent)", padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 500 }}>{genre}</span>
              ))}
            </div>
          </div>
          <button className="btn-icon" style={{ alignSelf: "flex-start", flexShrink: 0 }} onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px 24px" }}>
          {anime.description && (
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 16 }}>
              {anime.description.length > 380 ? `${anime.description.slice(0, 380)}...` : anime.description}
            </div>
          )}
          <div style={{ fontSize: 12, color: p.finding ? "var(--text-muted)" : p.hasTrailer ? "var(--text-success)" : "var(--text-warning)", marginBottom: 14 }}>
            {p.finding ? "Resolving anime providers..." : p.detailHint || "Fallback playback only"}
          </div>

          {/* Episode selector */}
          {(!p.isMovie || p.totalEpisodes > 1) && (
            <div style={{ marginBottom: 18, padding: "14px 14px 12px", borderRadius: 14, background: "var(--bg-surface2)", border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 700 }}>{p.isMovie ? "Parts" : "Episodes"}</div>
                {p.episodeGroups > 1 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {Array.from({ length: p.episodeGroups }, (_, index) => {
                      const start = index * 50 + 1;
                      const end = Math.min(p.totalEpisodes, start + 49);
                      return (
                        <button
                          key={`${start}-${end}`}
                          className={`quality-chip${p.selectedGroup === index ? " active" : ""}`}
                          onClick={() => p.setEpisode(start)}
                          style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600 }}
                        >
                          {start}-{end}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", maxHeight: 176, overflowY: "auto", paddingRight: 4 }}>
                {p.visibleEpisodes.map((value) => (
                  <button
                    key={value}
                    className={`quality-chip${p.episode === value ? " active" : ""}`}
                    onClick={() => p.setEpisode(value)}
                    style={{ padding: "9px 14px", fontSize: 13, fontWeight: 700, minWidth: 52 }}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Audio / Server selectors */}
          <div style={{ display: "grid", gridTemplateColumns: p.audio !== "hi" ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)", gap: 12, marginBottom: 18, padding: "10px 0 0" }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Audio</div>
              <div className="anime-option-grid compact">
                {AUDIO_BUTTONS.filter((option) =>
                  (option.id !== "hi" || p.hasHindiFallback) &&
                  (option.id !== "en" || p.hasDub || p.dubEpisodeCount === null)
                ).map((option) =>
                  option.id === "en" && p.dubEpisodeCount === null ? (
                    <button key={option.id} className="anime-option-btn compact" disabled type="button" style={{ cursor: "default", opacity: 0.7 }}>
                      <strong className="pulse" style={{ display: "inline-block", background: "var(--border)", borderRadius: 4, color: "transparent", minWidth: 28, lineHeight: 1.6 }}>Dub</strong>
                      <span className="pulse" style={{ display: "inline-block", background: "var(--border)", borderRadius: 3, color: "transparent", minWidth: 72, lineHeight: 1.6 }}>Checking…</span>
                    </button>
                  ) : (
                    <button
                      key={option.id}
                      className={`anime-option-btn compact${p.audio === option.id ? " active" : ""}`}
                      onClick={() => p.setAudio(option.id)}
                      type="button"
                    >
                      <strong>{option.label}</strong>
                      <span>{option.help}</span>
                    </button>
                  )
                )}
              </div>
            </div>
            {p.audio !== "hi" && (
              <div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Server</div>
                <div className="anime-option-grid compact">
                  {SERVER_BUTTONS.map((option) => (
                    <button
                      key={option.id}
                      className={`anime-option-btn compact${p.server === option.id ? " active" : ""}`}
                      onClick={() => p.setServer(option.id as AnimeServerOption)}
                      type="button"
                    >
                      <strong>{option.label}</strong>
                      <span>{option.help}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
            <button className="btn btn-primary" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={() => void p.handlePlay()} disabled={p.playing}>
              <IconPlay size={15} /> {p.playing ? "Loading..." : "Play"}
            </button>
            <button className="btn btn-ghost" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={() => void p.handleDownload()} disabled={p.downloading}>
              <IconDownload size={15} /> {p.downloading ? "Queueing..." : "Download"}
            </button>
            <button className="btn btn-ghost" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={p.handleTrailer} disabled={!p.hasTrailer}>
              <IconPlay size={15} /> Trailer
            </button>
            <button
              className="btn btn-ghost"
              style={{ gap: 7, flex: 1, justifyContent: "center", color: p.fav ? "var(--text-danger)" : "var(--text-primary)" }}
              onClick={() => p.toggle({ id: `anime-${anime.mal_id ?? `${anime.provider}-${anime.id}`}`, title: p.title, poster: anime.image || "", type: "anime", malId: anime.mal_id, tmdbId: undefined })}
            >
              <IconHeart size={15} color={p.fav ? "var(--text-danger)" : "currentColor"} filled={p.fav} />
              {p.fav ? "Saved" : "Favorite"}
            </button>
          </div>
        </div>
      </div>

      {/* Download modal */}
      <DownloadOptionsModal
        visible={p.downloadDialogOpen}
        title={p.title}
        poster={anime.image}
        languageOptions={[
          { id: "sub", label: "Sub" },
          ...(p.hasDub ? [{ id: "dub", label: "Dub" }] : []),
          ...(p.hasHindiFallback ? [{ id: "hindi", label: "Hindi" }] : []),
        ]}
        selectedLanguage={p.downloadLanguage}
        onSelectLanguage={(value) => p.setDownloadLanguage(value as "sub" | "dub" | "hindi")}
        serverOptions={[]}
        selectedServer={p.downloadServer}
        onSelectServer={(value) => p.setDownloadServer(value as AnimeServerOption)}
        qualityOptions={p.downloadQualityOptions.map((option) => ({ id: option.id, label: option.label }))}
        selectedQuality={p.downloadQuality}
        onSelectQuality={p.setDownloadQuality}
        loading={p.downloadDialogLoading || p.downloading}
        error={p.downloadDialogError}
        extraContent={
          <div style={{ display: "grid", gap: 10 }}>
            {p.downloadSubtitleTracks.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-surface2)" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>Subtitles included automatically</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.downloadSubtitleTracks[0].label || "Episode subtitle"}
                  </div>
                </div>
                <button className="btn btn-ghost" type="button" onClick={() => void p.handleSubtitleOnlyDownload()} disabled={p.downloadDialogLoading || p.downloading}>
                  Subtitle Only
                </button>
              </div>
            )}
          </div>
        }
        onClose={() => p.setDownloadDialogOpen(false)}
        onConfirm={() => void p.confirmDownloadSelection()}
      />

      {p.toast ? <AppToast message={p.toast.message} variant={p.toast.variant} onClose={() => p.setToast(null)} /> : null}
    </div>
  );
}
