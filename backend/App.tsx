import { useState, useRef } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────
type FormatType = "video" | "audio" | "thumbnail" | "subtitles";
type QualityType = "best" | "2160" | "1080" | "720" | "480" | "360";

interface VideoInfo {
  valid: boolean;
  title?: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  view_count?: number;
  upload_date?: string;
  error?: string;
}

interface ProgressState {
  active: boolean;
  percent: number;
  speed: string;
  eta: string;
  done: boolean;
  error: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatDuration(secs: number): string {
  if (!secs) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatViews(n: number): string {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K views`;
  return `${n} views`;
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [fetching, setFetching] = useState(false);
  const [format, setFormat] = useState<FormatType>("video");
  const [quality, setQuality] = useState<QualityType>("best");
  const [trimOn, setTrimOn] = useState(false);
  const [trimStart, setTrimStart] = useState("00:00");
  const [trimEnd, setTrimEnd] = useState("00:00");
  const [progress, setProgress] = useState<ProgressState>({
    active: false, percent: 0, speed: "", eta: "", done: false, error: "",
  });
  const [activePage, setActivePage] = useState("download");
  const evtRef = useRef<EventSource | null>(null);

  // ── Fetch video info ────────────────────────────────────────────────────
  const handleFetch = async () => {
    if (!url.trim()) return;
    setFetching(true);
    setInfo(null);
    setProgress({ active: false, percent: 0, speed: "", eta: "", done: false, error: "" });
    try {
      const res = await fetch(`http://127.0.0.1:8000/info?url=${encodeURIComponent(url)}`);
      const data: VideoInfo = await res.json();
      setInfo(data);
      if (data.valid && data.duration) {
        setTrimEnd(formatDuration(data.duration));
      }
    } catch {
      setInfo({ valid: false, error: "Cannot connect to GRABIX backend. Make sure it's running." });
    } finally {
      setFetching(false);
    }
  };

  // ── Paste from clipboard ────────────────────────────────────────────────
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text);
    } catch {
      // fallback: user can type
    }
  };

  // ── Start download with SSE progress ────────────────────────────────────
  const handleDownload = () => {
    if (!info?.valid || progress.active) return;

    // close any existing stream
    evtRef.current?.close();

    setProgress({ active: true, percent: 0, speed: "", eta: "", done: false, error: "" });

    const params = new URLSearchParams({
      url,
      format,
      quality,
      trim: trimOn ? "1" : "0",
      start: trimStart,
      end: trimEnd,
    });

    const es = new EventSource(`http://127.0.0.1:8000/download?${params}`);
    evtRef.current = es;

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.status === "progress") {
          setProgress(prev => ({
            ...prev,
            percent: msg.percent ?? prev.percent,
            speed: msg.speed ?? prev.speed,
            eta: msg.eta ?? prev.eta,
          }));
        } else if (msg.status === "done") {
          setProgress(prev => ({ ...prev, active: false, percent: 100, done: true, speed: "", eta: "" }));
          es.close();
        } else if (msg.status === "error") {
          setProgress(prev => ({ ...prev, active: false, error: msg.message ?? "Download failed." }));
          es.close();
        }
      } catch {}
    };

    es.onerror = () => {
      setProgress(prev => ({ ...prev, active: false, error: "Lost connection to backend." }));
      es.close();
    };
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={styles.root}>

      {/* SIDEBAR */}
      <div style={styles.sidebar}>
        <div style={styles.logo}>G<br/>R<br/>A<br/>B<br/>I<br/>X</div>
        <NavIcon icon="⬇" label="Download" active={activePage === "download"} onClick={() => setActivePage("download")} />
        <NavIcon icon="📁" label="Library"  active={activePage === "library"}  onClick={() => setActivePage("library")} />
        <NavIcon icon="⛩"  label="Anime"    active={activePage === "anime"}    onClick={() => setActivePage("anime")} />
        <NavIcon icon="🎬" label="Movies"   active={activePage === "movies"}   onClick={() => setActivePage("movies")} />
        <div style={{ flex: 1 }} />
        <NavIcon icon="⚙" label="Settings" active={activePage === "settings"} onClick={() => setActivePage("settings")} />
      </div>

      {/* MAIN */}
      <div style={styles.main}>

        {/* TOPBAR */}
        <div style={styles.topbar}>
          <span style={styles.topbarMuted}>GRABIX</span>
          <span style={styles.topbarSep}>›</span>
          <span style={styles.topbarPage}>Downloader</span>
        </div>

        {/* CONTENT */}
        <div style={styles.content}>

          {/* ── LEFT PANEL ── */}
          <div style={styles.leftPanel}>

            {/* URL INPUT */}
            <Section label="Paste Link">
              <div style={styles.urlBox}>
                <textarea
                  style={styles.urlInput}
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleFetch()}
                  rows={2}
                />
                <div style={styles.urlActions}>
                  <button style={{ ...styles.btn, ...styles.btnGhost }} onClick={handlePaste}>
                    📋 Paste
                  </button>
                  <button
                    style={{ ...styles.btn, ...styles.btnPrimary, flex: 1, justifyContent: "center", opacity: fetching ? 0.7 : 1 }}
                    onClick={handleFetch}
                    disabled={fetching}
                  >
                    {fetching ? "⏳ Fetching..." : "🔍 Fetch Info"}
                  </button>
                </div>
              </div>
            </Section>

            {/* FORMAT TYPE — only show after successful fetch */}
            {info?.valid && (
              <Section label="Download Type">
                <div style={styles.formatGrid}>
                  {(["video", "audio", "thumbnail", "subtitles"] as FormatType[]).map(f => (
                    <FormatBtn
                      key={f}
                      icon={f === "video" ? "🎬" : f === "audio" ? "🎵" : f === "thumbnail" ? "🖼" : "💬"}
                      label={f.charAt(0).toUpperCase() + f.slice(1)}
                      active={format === f}
                      onClick={() => setFormat(f)}
                    />
                  ))}
                </div>
              </Section>
            )}

            {/* QUALITY — only for video/audio */}
            {info?.valid && (format === "video" || format === "audio") && (
              <Section label="Quality">
                <div style={styles.qualityRow}>
                  {(["best", "2160", "1080", "720", "480", "360"] as QualityType[]).map(q => (
                    <button
                      key={q}
                      style={{
                        ...styles.qualityChip,
                        ...(quality === q ? styles.qualityChipActive : {}),
                      }}
                      onClick={() => setQuality(q)}
                    >
                      {q === "best" ? "BEST" : q === "2160" ? "4K" : `${q}p`}
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {/* TRIM — only for video/audio */}
            {info?.valid && (format === "video" || format === "audio") && (
              <Section label="">
                <div style={styles.trimBox}>
                  <div style={styles.trimHeader}>
                    <span style={styles.sectionLabel}>✂ Trim Before Download</span>
                    <div
                      style={{ ...styles.toggle, ...(trimOn ? styles.toggleOn : {}) }}
                      onClick={() => setTrimOn(t => !t)}
                    >
                      <div style={{ ...styles.toggleKnob, ...(trimOn ? styles.toggleKnobOn : {}) }} />
                    </div>
                  </div>
                  <div style={{ ...styles.trimInputs, opacity: trimOn ? 1 : 0.35, pointerEvents: trimOn ? "auto" : "none" }}>
                    <input
                      style={styles.timeInput}
                      value={trimStart}
                      onChange={e => setTrimStart(e.target.value)}
                      placeholder="00:00"
                    />
                    <span style={{ color: "#6b7280", fontSize: 16 }}>→</span>
                    <input
                      style={styles.timeInput}
                      value={trimEnd}
                      onChange={e => setTrimEnd(e.target.value)}
                      placeholder="00:00"
                    />
                  </div>
                </div>
              </Section>
            )}

            {/* DOWNLOAD BUTTON */}
            {info?.valid && (
              <button
                style={{ ...styles.dlBtn, opacity: progress.active ? 0.6 : 1 }}
                onClick={handleDownload}
                disabled={progress.active}
              >
                ⬇ Download Now
              </button>
            )}

          </div>

          {/* ── RIGHT PANEL — Preview ── */}
          <div style={styles.rightPanel}>

            {/* Empty state */}
            {!info && !fetching && (
              <div style={styles.emptyState}>
                <div style={{ fontSize: 52, opacity: 0.2 }}>🎞</div>
                <div style={styles.emptyText}>
                  Paste a video link on the left and hit <strong>Fetch Info</strong> to see the preview, title, and available qualities.
                </div>
              </div>
            )}

            {fetching && (
              <div style={styles.emptyState}>
                <div style={{ fontSize: 40, opacity: 0.4 }}>⏳</div>
                <div style={styles.emptyText}>Fetching video information…</div>
              </div>
            )}

            {info && !info.valid && (
              <div style={styles.errorBox}>
                ⚠ {info.error || "Invalid link or unsupported site."}
              </div>
            )}

            {info?.valid && (
              <>
                <div style={styles.sectionLabel}>Preview</div>

                {/* Thumbnail */}
                <div style={styles.previewCard}>
                  <div style={styles.thumbWrap}>
                    {info.thumbnail ? (
                      <img src={info.thumbnail} alt="thumbnail" style={styles.thumbImg} />
                    ) : (
                      <div style={{ ...styles.thumbImg, background: "#1d2229", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, opacity: 0.3 }}>🎬</div>
                    )}
                    <div style={styles.thumbOverlay}>
                      {info.duration ? (
                        <span style={styles.durBadge}>{formatDuration(info.duration)}</span>
                      ) : null}
                    </div>
                  </div>

                  <div style={styles.previewMeta}>
                    <div style={styles.videoTitle}>{info.title}</div>
                    <div style={styles.metaRow}>
                      {info.view_count ? <Tag color="green">{formatViews(info.view_count)}</Tag> : null}
                      {info.uploader ? <Tag color="blue">{info.uploader}</Tag> : null}
                      {info.upload_date ? <Tag>{info.upload_date.slice(0, 4)}</Tag> : null}
                    </div>
                  </div>
                </div>

                {/* Progress */}
                {(progress.active || progress.done || progress.error) && (
                  <div style={styles.progressCard}>
                    <div style={styles.progressHeader}>
                      <span style={styles.progressLabel}>
                        {progress.error ? "⚠ Error" : progress.done ? "✅ Download Complete!" : "⬇ Downloading…"}
                      </span>
                      <span style={styles.progressPct}>{Math.round(progress.percent)}%</span>
                    </div>
                    <div style={styles.progressBg}>
                      <div style={{ ...styles.progressFill, width: `${progress.percent}%` }} />
                    </div>
                    <div style={styles.progressSub}>
                      <span style={styles.progressSubText}>
                        {progress.error || (progress.done ? "Saved to Downloads/GRABIX" : progress.speed)}
                      </span>
                      {!progress.done && !progress.error && (
                        <span style={styles.progressSubText}>{progress.eta}</span>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function NavIcon({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <div
      title={label}
      onClick={onClick}
      style={{
        width: 40, height: 40, borderRadius: 10,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", fontSize: 16, transition: "all 0.15s",
        background: active ? "rgba(59,130,246,0.15)" : "transparent",
        border: active ? "1px solid rgba(59,130,246,0.35)" : "1px solid transparent",
        color: active ? "#3b82f6" : "#6b7280",
      }}
    >
      {icon}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      {label && <div style={styles.sectionLabel}>{label}</div>}
      {children}
    </div>
  );
}

function FormatBtn({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: active ? "rgba(59,130,246,0.12)" : "#161a1f",
        border: `1px solid ${active ? "#3b82f6" : "#2a2f38"}`,
        borderRadius: 10, padding: "10px 6px",
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 5, cursor: "pointer", transition: "all 0.15s",
      }}
    >
      <div style={{ fontSize: 20 }}>{icon}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: active ? "#3b82f6" : "#6b7280" }}>{label}</div>
    </div>
  );
}

function Tag({ children, color }: { children: React.ReactNode; color?: "green" | "blue" }) {
  const colors = {
    green: { color: "#10b981", borderColor: "rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.08)" },
    blue:  { color: "#06b6d4", borderColor: "rgba(6,182,212,0.3)",  background: "rgba(6,182,212,0.08)"  },
  };
  const c = color ? colors[color] : { color: "#6b7280", borderColor: "#2a2f38", background: "#1d2229" };
  return (
    <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 600, border: `1px solid ${c.borderColor}`, color: c.color, background: c.background, fontFamily: "monospace" }}>
      {children}
    </span>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  root:         { display: "flex", height: "100vh", background: "#0d0f12", color: "#e8eaf0", fontFamily: "'DM Sans', 'Segoe UI', sans-serif", fontSize: 13, overflow: "hidden" },
  sidebar:      { width: 60, background: "#161a1f", borderRight: "1px solid #2a2f38", display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 0", gap: 8, flexShrink: 0 },
  logo:         { fontFamily: "monospace", fontSize: 9, fontWeight: 700, color: "#3b82f6", letterSpacing: 2, textAlign: "center", lineHeight: 1.6, marginBottom: 14 },
  main:         { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  topbar:       { height: 44, borderBottom: "1px solid #2a2f38", display: "flex", alignItems: "center", padding: "0 20px", gap: 10, flexShrink: 0 },
  topbarMuted:  { fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "1.5px" },
  topbarSep:    { color: "#2a2f38" },
  topbarPage:   { fontSize: 11, fontWeight: 600, color: "#e8eaf0", textTransform: "uppercase", letterSpacing: "1.5px" },
  content:      { flex: 1, display: "flex", overflow: "hidden" },
  leftPanel:    { width: 380, borderRight: "1px solid #2a2f38", padding: "20px 18px", display: "flex", flexDirection: "column", gap: 18, overflowY: "auto", flexShrink: 0 },
  sectionLabel: { fontSize: 10, fontWeight: 700, letterSpacing: "2px", color: "#6b7280", textTransform: "uppercase", marginBottom: 9, display: "block" },
  urlBox:       { background: "#161a1f", border: "1px solid #2a2f38", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 },
  urlInput:     { background: "transparent", border: "none", outline: "none", color: "#e8eaf0", fontFamily: "monospace", fontSize: 11, width: "100%", resize: "none", lineHeight: 1.5 },
  urlActions:   { display: "flex", gap: 8, borderTop: "1px solid #2a2f38", paddingTop: 10 },
  btn:          { padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none", fontFamily: "inherit", transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6 },
  btnGhost:     { background: "#1d2229", color: "#6b7280", border: "1px solid #2a2f38" },
  btnPrimary:   { background: "#3b82f6", color: "white", display: "flex" },
  formatGrid:   { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 },
  qualityRow:   { display: "flex", gap: 6, flexWrap: "wrap" },
  qualityChip:  { padding: "6px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "monospace", border: "1px solid #2a2f38", background: "#161a1f", color: "#6b7280", transition: "all 0.15s" },
  qualityChipActive: { background: "#3b82f6", borderColor: "#3b82f6", color: "white" },
  trimBox:      { background: "#161a1f", border: "1px solid #2a2f38", borderRadius: 12, padding: "14px 16px" },
  trimHeader:   { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  trimInputs:   { display: "flex", gap: 10, alignItems: "center", transition: "opacity 0.2s" },
  toggle:       { width: 32, height: 18, background: "#2a2f38", borderRadius: 9, position: "relative", cursor: "pointer", transition: "background 0.2s", flexShrink: 0 },
  toggleOn:     { background: "#3b82f6" },
  toggleKnob:   { position: "absolute", width: 14, height: 14, background: "white", borderRadius: "50%", top: 2, left: 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.5)" },
  toggleKnobOn: { left: 16 },
  timeInput:    { flex: 1, background: "#1d2229", border: "1px solid #2a2f38", borderRadius: 8, padding: "8px 12px", color: "#e8eaf0", fontFamily: "monospace", fontSize: 13, fontWeight: 700, textAlign: "center", outline: "none", width: "100%" },
  dlBtn:        { background: "linear-gradient(135deg, #3b82f6, #06b6d4)", border: "none", borderRadius: 12, padding: 14, color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%", fontFamily: "inherit", letterSpacing: "0.5px", transition: "opacity 0.2s" },
  rightPanel:   { flex: 1, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" },
  emptyState:   { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#6b7280", gap: 12 },
  emptyText:    { fontSize: 13, textAlign: "center", lineHeight: 1.6, maxWidth: 280 },
  errorBox:     { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "14px 16px", color: "#ef4444", fontSize: 13 },
  previewCard:  { background: "#161a1f", border: "1px solid #2a2f38", borderRadius: 14, overflow: "hidden" },
  thumbWrap:    { position: "relative", width: "100%", paddingBottom: "56.25%", background: "#000", overflow: "hidden" },
  thumbImg:     { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" } as React.CSSProperties,
  thumbOverlay: { position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.75))", display: "flex", alignItems: "flex-end", padding: 14 },
  durBadge:     { background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, padding: "3px 8px", fontSize: 10, fontFamily: "monospace", color: "white" },
  previewMeta:  { padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 },
  videoTitle:   { fontSize: 14, fontWeight: 600, lineHeight: 1.4, color: "#e8eaf0" },
  metaRow:      { display: "flex", gap: 8, flexWrap: "wrap" },
  progressCard: { background: "#161a1f", border: "1px solid #2a2f38", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 },
  progressHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  progressLabel: { fontSize: 12, fontWeight: 600, color: "#e8eaf0" },
  progressPct:  { fontFamily: "monospace", fontSize: 12, color: "#3b82f6" },
  progressBg:   { height: 5, background: "#1d2229", borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3, background: "linear-gradient(90deg, #3b82f6, #06b6d4)", transition: "width 0.3s ease" },
  progressSub:  { display: "flex", justifyContent: "space-between" },
  progressSubText: { fontSize: 10, color: "#6b7280", fontFamily: "monospace" },
};
