// grabix-ui/src/pages/DownloaderPreview.tsx
// Renders the full preview card (thumbnail, meta, file-type tabs, all option selectors,
// trim toggle, and the download button row) after a link has been fetched successfully.

import TrimSlider from "../components/TrimSlider";
import {
  IconVideo, IconAudio, IconImage, IconSubtitle,
  IconDownload, IconPlay, IconClock, IconCheck, IconScissors,
} from "../components/Icons";
import { VideoInfo, FileType, DownloadEngine, RuntimeDependency, secs } from "./downloader.types";

interface DownloaderPreviewProps {
  info:              VideoInfo;
  fileType:          FileType;
  setFileType:       (t: FileType) => void;
  quality:           string;
  setQuality:        (q: string) => void;
  downloadEngine:    DownloadEngine;
  setDownloadEngine: (e: DownloadEngine) => void;
  aria2Available:    boolean;
  audioFormat:       string;
  setAudioFormat:    (f: string) => void;
  subtitleLang:      string;
  setSubtitleLang:   (l: string) => void;
  thumbnailFormat:   string;
  setThumbnailFormat:(f: string) => void;
  trimStart:         number;
  trimEnd:           number;
  setTrimStart:      (s: number) => void;
  setTrimEnd:        (e: number) => void;
  trimOpen:          boolean;
  setTrimOpen:       React.Dispatch<React.SetStateAction<boolean>>;
  useCpu:            boolean;
  setUseCpu:         React.Dispatch<React.SetStateAction<boolean>>;
  onDownload:        () => void;
  visibleDependencies: RuntimeDependency[];
  onInstallDep:      (id: string) => void;
}

const FILE_TYPES: { id: FileType; label: string; Icon: React.FC<any> }[] = [
  { id: "video",     label: "Video",     Icon: IconVideo    },
  { id: "audio",     label: "Audio",     Icon: IconAudio    },
  { id: "thumbnail", label: "Thumbnail", Icon: IconImage    },
  { id: "subtitle",  label: "Subtitle",  Icon: IconSubtitle },
];

export function DownloaderPreview(p: DownloaderPreviewProps) {
  return (
    <div className="card card-padded fade-in">
      {/* Thumbnail + meta */}
      <div style={{ display: "flex", gap: 14, marginBottom: 16 }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <img src={p.info.thumbnail} alt="" style={{ width: 140, height: 90, objectFit: "cover", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }} />
          <div style={{ position: "absolute", bottom: 5, right: 5, background: "rgba(0,0,0,0.75)", color: "white", fontSize: 11, padding: "2px 5px", borderRadius: 4, display: "flex", alignItems: "center", gap: 3, fontFamily: "var(--font-mono)" }}>
            <IconPlay size={9} color="white" />{secs(p.info.duration)}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4, marginBottom: 4 }}>{p.info.title}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <IconClock size={12} />{secs(p.info.duration)}{p.info.uploader && <> · {p.info.uploader}</>}
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--accent-light)", color: "var(--text-accent)", fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 99 }}>
            <IconCheck size={11} />Ready to download
          </div>
        </div>
      </div>

      <div className="divider" />

      {/* File type tabs */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>Download as</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {FILE_TYPES.map(({ id, label, Icon }) => (
            <button key={id} className={`filetype-tab${p.fileType === id ? " active" : ""}`} onClick={() => p.setFileType(id)}>
              <Icon size={14} />{label}
            </button>
          ))}
        </div>
      </div>

      {/* Download engine */}
      <div style={{ marginBottom: 14 }} className="fade-in">
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>Download Engine</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className={`quality-chip${(p.fileType === "thumbnail" || p.fileType === "subtitle" || p.downloadEngine === "standard") ? " active" : ""}`} onClick={() => p.setDownloadEngine("standard")}>
            Standard (stable)
          </button>
          {p.fileType !== "thumbnail" && p.fileType !== "subtitle" && (
            <button className={`quality-chip${p.downloadEngine === "aria2" ? " active" : ""}`} onClick={() => p.setDownloadEngine("aria2")}>
              aria2 (fast)
            </button>
          )}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
          {p.fileType === "thumbnail" || p.fileType === "subtitle"
            ? "Small files always use the Standard downloader so GRABIX can keep them simple and reliable."
            : p.aria2Available
            ? "aria2 is best for direct-file downloads. GRABIX automatically falls back to Standard for unsupported cases."
            : "aria2 is not installed right now, so Standard remains the active downloader."}
        </div>
        {p.visibleDependencies.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {p.visibleDependencies.map((dep) => (
              <div key={dep.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 10px", background: "var(--bg-surface2)", borderRadius: 10 }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{dep.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{dep.available ? (dep.path || "Installed") : (dep.description || "Not installed")}</div>
                  {dep.job?.message && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{dep.job.message}</div>}
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: dep.available ? "var(--text-success)" : "var(--text-warning)" }}>
                  {dep.available ? "Installed" : dep.job?.status === "installing" ? "Installing..." : dep.job?.status === "failed" ? "Install failed" : "Missing"}
                </span>
                {!dep.available && dep.install_supported !== false && dep.job?.status !== "installing" && (
                  <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => p.onInstallDep(dep.id)}>
                    {dep.job?.status === "failed" ? "Retry install" : "Install"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quality (video only) */}
      {p.fileType === "video" && (
        <div style={{ marginBottom: 14 }} className="fade-in">
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>Quality</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {p.info.formats.map((f) => (
              <button key={f} className={`quality-chip${p.quality === f ? " active" : ""}`} onClick={() => p.setQuality(f)}>{f}</button>
            ))}
          </div>
        </div>
      )}

      {/* Audio format */}
      {p.fileType === "audio" && (
        <div style={{ marginBottom: 14 }} className="fade-in">
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>Audio Format</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(["mp3", "m4a", "opus", "flac", "wav"] as const).map((fmt) => (
              <button key={fmt} className={`quality-chip${p.audioFormat === fmt ? " active" : ""}`} onClick={() => p.setAudioFormat(fmt)}>{fmt.toUpperCase()}</button>
            ))}
          </div>
        </div>
      )}

      {/* Subtitle language */}
      {p.fileType === "subtitle" && (
        <div style={{ marginBottom: 14 }} className="fade-in">
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>Language</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { code: "en", label: "English" }, { code: "es", label: "Spanish" }, { code: "fr", label: "French" },
              { code: "de", label: "German" },  { code: "ja", label: "Japanese" },{ code: "zh", label: "Chinese" },
              { code: "ar", label: "Arabic" },  { code: "pt", label: "Portuguese" },{ code: "ur", label: "Urdu" },
            ].map(({ code, label }) => (
              <button key={code} className={`quality-chip${p.subtitleLang === code ? " active" : ""}`} onClick={() => p.setSubtitleLang(code)}>{label}</button>
            ))}
          </div>
        </div>
      )}

      {/* Thumbnail format */}
      {p.fileType === "thumbnail" && (
        <div style={{ marginBottom: 14 }} className="fade-in">
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>Thumbnail Format</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(["jpg", "png", "webp"] as const).map((fmt) => (
              <button key={fmt} className={`quality-chip${p.thumbnailFormat === fmt ? " active" : ""}`} onClick={() => p.setThumbnailFormat(fmt)}>{fmt.toUpperCase()}</button>
            ))}
          </div>
        </div>
      )}

      {/* Trim toggle + panel (video only) */}
      {p.fileType === "video" && (
        <div className="fade-in" style={{ marginBottom: 14 }}>
          <button className={`btn btn-ghost${p.trimOpen ? " active" : ""}`} style={{ fontSize: 12, gap: 6 }} onClick={() => p.setTrimOpen((v) => !v)}>
            <IconScissors size={13} />
            {p.trimOpen ? "Hide Trim" : "Trim video"}
            {p.trimOpen && p.trimEnd - p.trimStart < p.info.duration && (
              <span style={{ marginLeft: 4, color: "var(--text-accent)" }}>· {secs(p.trimEnd - p.trimStart)}</span>
            )}
          </button>
          {p.trimOpen && (
            <TrimSlider duration={p.info.duration} onTrimChange={(s, e) => { p.setTrimStart(s); p.setTrimEnd(e); }} />
          )}
        </div>
      )}

      <div className="divider" />

      {/* Download button row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-primary" style={{ height: 40, paddingLeft: 20, paddingRight: 20, fontSize: 14 }} onClick={p.onDownload}>
          <IconDownload size={15} />
          Download {p.fileType === "video" ? p.quality : p.fileType}
          {p.fileType === "video" && p.trimOpen && p.trimEnd - p.trimStart < p.info.duration && ` (${secs(p.trimEnd - p.trimStart)})`}
        </button>
        {p.fileType === "video" && p.trimOpen && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <div className="tooltip-wrap">
              <button className={`quality-chip${!p.useCpu ? " active" : ""}`} style={{ fontSize: 11 }} onClick={() => p.setUseCpu(false)}>No CPU</button>
              <span className="tooltip-box" style={{ width: 190, whiteSpace: "normal", lineHeight: 1.5 }}>✅ Recommended. Instant, no re-encode. Trim snaps to nearest keyframe (±2s). No FFmpeg needed.</span>
            </div>
            <div className="tooltip-wrap">
              <button className={`quality-chip${p.useCpu ? " active" : ""}`} style={{ fontSize: 11 }} onClick={() => p.setUseCpu(true)}>With CPU</button>
              <span className="tooltip-box" style={{ width: 190, whiteSpace: "normal", lineHeight: 1.5 }}>Frame-accurate trim. Re-encodes with FFmpeg — slower, uses CPU. Requires FFmpeg installed.</span>
            </div>
          </div>
        )}
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {p.fileType === "video"     && `Saves as MP4 · ${p.quality}`}
          {p.fileType === "audio"     && `Saves as ${p.audioFormat.toUpperCase()} · 192kbps`}
          {p.fileType === "thumbnail" && `Saves as ${p.thumbnailFormat.toUpperCase()}`}
          {p.fileType === "subtitle"  && `Saves as available subtitle · ${p.subtitleLang.toUpperCase()}`}
        </div>
      </div>
    </div>
  );
}
