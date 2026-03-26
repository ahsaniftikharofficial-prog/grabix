import { useState, useRef, useCallback, useEffect } from "react";
import {
  IconSearch, IconPaste, IconLink, IconRefresh,
  IconVideo, IconAudio, IconImage, IconSubtitle,
  IconDownload, IconX, IconCheck, IconAlert,
  IconPlay, IconClock, IconFolder,
} from "../components/Icons";
import TrimSlider from "../components/TrimSlider";

const API = "http://127.0.0.1:8000";

type FileType = "video" | "audio" | "thumbnail" | "subtitle";
type Status = "idle" | "loading" | "ok" | "error";

interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: number;
  channel: string;
  formats: { height: number; label: string }[];
}

interface QueueItem {
  id: string;           // frontend display id (temp until server responds)
  serverId: string;     // real backend download id — used for polling
  title: string;
  thumbnail: string;
  format: string;
  fileType: FileType;
  status: "queued" | "downloading" | "paused" | "done" | "failed" | "canceled" | "canceling";
  percent: number;
  speed: string;
  eta: string;
  downloaded: string;
  total: string;
  error: string;
  filePath: string;
}

// Audio format / quality options
const AUDIO_FORMATS = ["mp3", "aac", "opus", "flac", "wav"] as const;
const AUDIO_QUALITIES = ["320", "256", "192", "128", "96"] as const;
const SUBTITLE_LANGS = ["en", "ar", "es", "fr", "de", "ja", "ko", "zh", "hi", "pt"] as const;
const THUMB_FORMATS = ["jpg", "png", "webp"] as const;

type AudioFormat = typeof AUDIO_FORMATS[number];
type AudioQuality = typeof AUDIO_QUALITIES[number];
type SubLang = typeof SUBTITLE_LANGS[number];
type ThumbFormat = typeof THUMB_FORMATS[number];

function secs(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function uid() { return Math.random().toString(36).slice(2); }

function SelectRow({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", width: 110, flexShrink: 0, fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map(opt => (
          <button
            key={opt}
            className={`quality-chip${value === opt ? " active" : ""}`}
            onClick={() => onChange(opt)}
          >
            {opt.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DownloaderPage() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [fileType, setFileType] = useState<FileType>("video");

  // Video options
  const [quality, setQuality] = useState("best");
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [trimEnabled, setTrimEnabled] = useState(false);

  // Audio options
  const [audioFormat, setAudioFormat] = useState<AudioFormat>("mp3");
  const [audioQuality, setAudioQuality] = useState<AudioQuality>("192");

  // Subtitle options
  const [subLang, setSubLang] = useState<SubLang>("en");

  // Thumbnail options
  const [thumbFormat, setThumbFormat] = useState<ThumbFormat>("jpg");

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      pollingRef.current.forEach(clearInterval);
    };
  }, []);

  const fetchInfo = useCallback(async (inputUrl: string) => {
    if (!inputUrl.trim()) return;
    setStatus("loading");
    setInfo(null);
    setErrMsg("");
    try {
      const res = await fetch(`${API}/check-link?url=${encodeURIComponent(inputUrl)}`);
      const data = await res.json();
      if (data.valid) {
        const parsed: VideoInfo = {
          title: data.title,
          thumbnail: data.thumbnail,
          duration: data.duration ?? 300,
          channel: data.channel ?? "",
          formats: data.formats ?? [{ height: 1080, label: "1080p" }, { height: 720, label: "720p" }],
        };
        setInfo(parsed);
        setTrimStart(0);
        setTrimEnd(parsed.duration);
        setTrimEnabled(false);
        // Default quality to best available
        if (parsed.formats.length > 0) setQuality(parsed.formats[0].label);
        setStatus("ok");
      } else {
        setErrMsg(data.error || "Could not fetch link.");
        setStatus("error");
      }
    } catch {
      setErrMsg("Backend is offline. Start the Python server first.");
      setStatus("error");
    }
  }, []);

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    setUrl(text);
    setTimeout(() => fetchInfo(text), 80);
  };

  const handlePasteBtn = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      fetchInfo(text);
    } catch { setErrMsg("Clipboard access denied."); setStatus("error"); }
  };

  // ── FIXED: poll uses the real backend serverId ──
  const startPolling = (frontendId: string, serverId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/download-status/${serverId}`);
        const pd = await res.json();

        if (pd.status === "not_found") {
          clearInterval(interval);
          pollingRef.current.delete(frontendId);
          return;
        }

        setQueue(prev => prev.map(q =>
          q.id === frontendId
            ? {
                ...q,
                status: pd.status,
                percent: pd.percent ?? 0,
                speed: pd.speed ?? "",
                eta: pd.eta ?? "",
                downloaded: pd.downloaded ?? "",
                total: pd.total ?? "",
                error: pd.error ?? "",
                filePath: pd.file_path ?? "",
              }
            : q
        ));

        if (pd.status === "done" || pd.status === "failed" || pd.status === "canceled") {
          clearInterval(interval);
          pollingRef.current.delete(frontendId);
        }
      } catch {
        // keep polling — transient network error
      }
    }, 800);
    pollingRef.current.set(frontendId, interval);
  };

  const startDownload = async () => {
    if (!info) return;

    const frontendId = uid();
    const newItem: QueueItem = {
      id: frontendId,
      serverId: "",   // filled after backend responds
      title: info.title,
      thumbnail: info.thumbnail,
      format: fileType === "video" ? quality : fileType,
      fileType,
      status: "queued",
      percent: 0,
      speed: "",
      eta: "",
      downloaded: "",
      total: "",
      error: "",
      filePath: "",
    };
    setQueue(prev => [newItem, ...prev]);

    try {
      // Build query params matching backend signature exactly
      const params = new URLSearchParams({
        url,
        dl_type: fileType,
        quality: fileType === "video" ? quality.replace("p", "") : "best",
        audio_format: audioFormat,
        audio_quality: audioQuality,
        subtitle_lang: subLang,
        thumbnail_format: thumbFormat,
        trim_start: String(trimEnabled ? trimStart : 0),
        trim_end: String(trimEnabled ? trimEnd : 0),
        trim_enabled: String(trimEnabled && trimEnd > trimStart),
      });

      const res = await fetch(`${API}/download?${params}`, { method: "POST" });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Server error ${res.status}`);
      }

      const data = await res.json();
      const serverId: string = data.id; // backend returns { id, folder }

      // Patch the queue item with real serverId
      setQueue(prev => prev.map(q =>
        q.id === frontendId ? { ...q, serverId, status: "queued" } : q
      ));

      // Start polling with real backend ID
      startPolling(frontendId, serverId);

    } catch (err: any) {
      setQueue(prev => prev.map(q =>
        q.id === frontendId
          ? { ...q, status: "failed", error: err.message || "Failed to start download." }
          : q
      ));
    }
  };

  const handleAction = async (item: QueueItem, action: "pause" | "resume" | "cancel" | "retry") => {
    if (!item.serverId) return;
    try {
      await fetch(`${API}/downloads/${item.serverId}/action?action=${action}`, { method: "POST" });
      if (action === "retry") {
        // re-attach polling
        setQueue(prev => prev.map(q =>
          q.id === item.id ? { ...q, status: "queued", percent: 0, error: "" } : q
        ));
        startPolling(item.id, item.serverId);
      }
    } catch { /* ignore */ }
  };

  const removeFromQueue = (id: string) => {
    const interval = pollingRef.current.get(id);
    if (interval) { clearInterval(interval); pollingRef.current.delete(id); }
    setQueue(prev => prev.filter(q => q.id !== id));
  };

  const openFolder = async (filePath: string) => {
    try {
      await fetch(`${API}/open-download-folder?path=${encodeURIComponent(filePath)}`, { method: "POST" });
    } catch { /* ignore */ }
  };

  const activeCount = queue.filter(q =>
    q.status === "downloading" || q.status === "queued"
  ).length;

  const FILE_TYPES: { id: FileType; label: string; Icon: React.FC<any> }[] = [
    { id: "video",     label: "Video",     Icon: IconVideo },
    { id: "audio",     label: "Audio",     Icon: IconAudio },
    { id: "thumbnail", label: "Thumbnail", Icon: IconImage },
    { id: "subtitle",  label: "Subtitle",  Icon: IconSubtitle },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>

      {/* Topbar */}
      <div style={{
        padding: "14px 24px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Downloader</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>Paste a link to start downloading</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {activeCount > 0 && (
            <span style={{
              fontSize: 12, color: "var(--text-accent)",
              background: "var(--accent-light)", padding: "4px 10px",
              borderRadius: 99, fontWeight: 500,
              display: "flex", alignItems: "center", gap: 5,
            }}>
              <span className="pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />
              {activeCount} downloading
            </span>
          )}
          {queue.length > 0 && (
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => {
              pollingRef.current.forEach(clearInterval);
              pollingRef.current.clear();
              setQueue([]);
            }}>
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Scroll area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── URL INPUT CARD ── */}
        <div className="card card-padded">
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 10, letterSpacing: 0.5, textTransform: "uppercase" }}>
            Video URL
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <IconLink size={15} color="var(--text-muted)" />
              </div>
              <input
                className="input-base"
                style={{ paddingLeft: 38, paddingRight: url ? 36 : 14 }}
                placeholder="https://youtube.com/watch?v=..."
                value={url}
                onChange={e => setUrl(e.target.value)}
                onPaste={handlePaste}
                onKeyDown={e => e.key === "Enter" && fetchInfo(url)}
              />
              {url && (
                <button
                  onClick={() => { setUrl(""); setInfo(null); setStatus("idle"); }}
                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", padding: 2 }}
                >
                  <IconX size={14} />
                </button>
              )}
            </div>
            <div className="tooltip-wrap">
              <button className="btn-icon" onClick={handlePasteBtn} title="Paste from clipboard">
                <IconPaste size={15} />
              </button>
              <span className="tooltip-box">Paste from clipboard</span>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => fetchInfo(url)}
              disabled={status === "loading" || !url.trim()}
              style={{ minWidth: 90 }}
            >
              {status === "loading"
                ? <><IconRefresh size={14} className="spin" /> Fetching...</>
                : <><IconSearch size={14} /> Fetch</>}
            </button>
          </div>

          {status === "error" && (
            <div className="fade-in" style={{
              marginTop: 10, padding: "10px 14px", borderRadius: "var(--radius-sm)",
              background: "var(--bg-surface2)", border: "1px solid var(--danger)",
              display: "flex", alignItems: "center", gap: 8,
              fontSize: 13, color: "var(--text-danger)",
            }}>
              <IconAlert size={15} />
              {errMsg}
            </div>
          )}
        </div>

        {/* ── PREVIEW CARD ── */}
        {status === "ok" && info && (
          <div className="card card-padded fade-in">
            {/* Thumbnail + meta */}
            <div style={{ display: "flex", gap: 14, marginBottom: 16 }}>
              <div style={{ position: "relative", flexShrink: 0 }}>
                <img
                  src={info.thumbnail}
                  alt=""
                  style={{ width: 140, height: 90, objectFit: "cover", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}
                />
                <div style={{
                  position: "absolute", bottom: 5, right: 5,
                  background: "rgba(0,0,0,0.75)", color: "white",
                  fontSize: 11, padding: "2px 5px", borderRadius: 4,
                  display: "flex", alignItems: "center", gap: 3,
                  fontFamily: "var(--font-mono)",
                }}>
                  <IconPlay size={9} color="white" />
                  {secs(info.duration)}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4, marginBottom: 4 }}>{info.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                  <IconClock size={12} />
                  {secs(info.duration)}
                  {info.channel && <> · {info.channel}</>}
                </div>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  background: "var(--accent-light)", color: "var(--text-accent)",
                  fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 99,
                }}>
                  <IconCheck size={11} />
                  Ready to download
                </div>
              </div>
            </div>

            <div className="divider" />

            {/* ── FILE TYPE TABS ── */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>
                Download as
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {FILE_TYPES.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    className={`filetype-tab${fileType === id ? " active" : ""}`}
                    onClick={() => setFileType(id)}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── VIDEO OPTIONS ── */}
            {fileType === "video" && (
              <div className="fade-in" style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>
                  Quality
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                  <button
                    className={`quality-chip${quality === "best" ? " active" : ""}`}
                    onClick={() => setQuality("best")}
                  >
                    Best
                  </button>
                  {info.formats.map((f) => (
                    <button
                      key={f.label}
                      className={`quality-chip${quality === f.label ? " active" : ""}`}
                      onClick={() => setQuality(f.label)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Trim toggle + slider */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: trimEnabled ? 10 : 0 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "var(--text-secondary)", userSelect: "none" }}>
                    <div
                      onClick={() => setTrimEnabled(v => !v)}
                      style={{
                        width: 36, height: 20, borderRadius: 99,
                        background: trimEnabled ? "var(--accent)" : "var(--border)",
                        position: "relative", transition: "background 0.2s", cursor: "pointer", flexShrink: 0,
                      }}
                    >
                      <div style={{
                        position: "absolute", top: 3, left: trimEnabled ? 18 : 3,
                        width: 14, height: 14, borderRadius: "50%", background: "white",
                        transition: "left 0.2s",
                      }} />
                    </div>
                    Trim clip
                    {trimEnabled && (
                      <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                        {secs(trimStart)} – {secs(trimEnd)} ({secs(trimEnd - trimStart)})
                      </span>
                    )}
                  </label>
                </div>

                {trimEnabled && (
                  <div className="fade-in">
                    <TrimSlider
                      duration={info.duration}
                      onTrimChange={(s, e) => { setTrimStart(s); setTrimEnd(e); }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* ── AUDIO OPTIONS ── */}
            {fileType === "audio" && (
              <div className="fade-in" style={{ marginBottom: 14 }}>
                <SelectRow label="Format" value={audioFormat} options={AUDIO_FORMATS} onChange={v => setAudioFormat(v as AudioFormat)} />
                <SelectRow label="Bitrate" value={audioQuality} options={AUDIO_QUALITIES} onChange={v => setAudioQuality(v as AudioQuality)} />
              </div>
            )}

            {/* ── SUBTITLE OPTIONS ── */}
            {fileType === "subtitle" && (
              <div className="fade-in" style={{ marginBottom: 14 }}>
                <SelectRow label="Language" value={subLang} options={SUBTITLE_LANGS} onChange={v => setSubLang(v as SubLang)} />
              </div>
            )}

            {/* ── THUMBNAIL OPTIONS ── */}
            {fileType === "thumbnail" && (
              <div className="fade-in" style={{ marginBottom: 14 }}>
                <SelectRow label="Format" value={thumbFormat} options={THUMB_FORMATS} onChange={v => setThumbFormat(v as ThumbFormat)} />
              </div>
            )}

            <div className="divider" />

            {/* ── DOWNLOAD BUTTON ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                className="btn btn-primary"
                style={{ height: 40, paddingLeft: 20, paddingRight: 20, fontSize: 14 }}
                onClick={startDownload}
              >
                <IconDownload size={15} />
                Download
                {fileType === "video" && ` · ${quality === "best" ? "Best quality" : quality}`}
                {fileType === "audio" && ` · ${audioFormat.toUpperCase()} ${audioQuality}k`}
                {fileType === "subtitle" && ` · ${subLang.toUpperCase()}`}
                {fileType === "thumbnail" && ` · ${thumbFormat.toUpperCase()}`}
                {fileType === "video" && trimEnabled && ` (${secs(trimEnd - trimStart)})`}
              </button>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Saves to ~/Downloads/GRABIX
              </div>
            </div>
          </div>
        )}

        {/* ── DOWNLOAD QUEUE ── */}
        {queue.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>
              Queue ({queue.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {queue.map((item) => (
                <QueueCard
                  key={item.id}
                  item={item}
                  onRemove={removeFromQueue}
                  onAction={handleAction}
                  onOpenFolder={openFolder}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── EMPTY STATE ── */}
        {status === "idle" && queue.length === 0 && (
          <div className="empty-state">
            <IconLink size={40} color="var(--text-muted)" />
            <p>Paste a video link to get started</p>
            <span>Supports YouTube, Vimeo, Twitter, and 1000+ sites via yt-dlp</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Queue Card ──────────────────────────────────────────────────────────────

interface QueueCardProps {
  item: QueueItem;
  onRemove: (id: string) => void;
  onAction: (item: QueueItem, action: "pause" | "resume" | "cancel" | "retry") => void;
  onOpenFolder: (path: string) => void;
}

function QueueCard({ item, onRemove, onAction, onOpenFolder }: QueueCardProps) {
  const isActive = item.status === "downloading" || item.status === "queued";
  const isPaused = item.status === "paused";
  const isDone = item.status === "done";
  const isFailed = item.status === "failed" || item.status === "canceled";

  const statusColors: Record<string, string> = {
    done: "var(--success)",
    failed: "var(--danger)",
    canceled: "var(--text-muted)",
    downloading: "var(--accent)",
    paused: "var(--warning)",
    queued: "var(--text-muted)",
    canceling: "var(--text-muted)",
  };

  const statusLabels: Record<string, string> = {
    done: "Done",
    failed: "Failed",
    canceled: "Canceled",
    downloading: "Downloading…",
    paused: "Paused",
    queued: "Queued",
    canceling: "Canceling…",
  };

  return (
    <div className="card fade-in" style={{ padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Thumbnail */}
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt=""
            style={{ width: 52, height: 34, objectFit: "cover", borderRadius: 5, flexShrink: 0, border: "1px solid var(--border)" }}
          />
        ) : (
          <div style={{ width: 52, height: 34, borderRadius: 5, background: "var(--bg-surface2)", flexShrink: 0, border: "1px solid var(--border)" }} />
        )}

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {item.title || "Preparing…"}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
            <span style={{ fontSize: 11, color: statusColors[item.status] ?? "var(--text-muted)", fontWeight: 500 }}>
              {statusLabels[item.status] ?? item.status}
            </span>
            {item.speed && isActive && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.speed}</span>
            )}
            {item.eta && isActive && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>ETA {item.eta}</span>
            )}
            {item.total && (
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
                {isActive ? `${item.downloaded} / ${item.total}` : item.total}
              </span>
            )}
            {!item.total && (
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
                {item.format.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {isDone && item.filePath && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onOpenFolder(item.filePath)}>
                <IconFolder size={13} />
              </button>
              <span className="tooltip-box">Open folder</span>
            </div>
          )}
          {isActive && item.serverId && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onAction(item, "pause")}>
                {/* Pause icon — inline SVG since we might not have it in Icons */}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
                  <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
                </svg>
              </button>
              <span className="tooltip-box">Pause</span>
            </div>
          )}
          {isPaused && item.serverId && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onAction(item, "resume")}>
                <IconPlay size={13} />
              </button>
              <span className="tooltip-box">Resume</span>
            </div>
          )}
          {isFailed && item.serverId && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onAction(item, "retry")}>
                <IconRefresh size={13} />
              </button>
              <span className="tooltip-box">Retry</span>
            </div>
          )}
          <div className="tooltip-wrap">
            <button
              className="btn-icon"
              style={{ width: 28, height: 28 }}
              onClick={() => {
                if (isActive && item.serverId) onAction(item, "cancel");
                onRemove(item.id);
              }}
            >
              <IconX size={13} />
            </button>
            <span className="tooltip-box">{isActive ? "Cancel" : "Remove"}</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      {(isActive || isPaused) && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontFamily: "var(--font-mono)" }}>
            <span>{item.percent.toFixed(0)}%</span>
          </div>
          <div className="progress-bar-bg">
            <div
              className="progress-bar-fill"
              style={{
                width: `${item.percent}%`,
                background: isPaused ? "var(--warning)" : "var(--accent)",
                transition: isPaused ? "none" : "width 0.5s ease",
              }}
            />
          </div>
        </div>
      )}

      {/* Done bar (full) */}
      {isDone && (
        <div style={{ marginTop: 8 }}>
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{ width: "100%", background: "var(--success)" }} />
          </div>
        </div>
      )}

      {/* Error message */}
      {(item.status === "failed") && item.error && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-danger)", display: "flex", alignItems: "center", gap: 5 }}>
          <IconAlert size={13} /> {item.error}
        </div>
      )}
    </div>
  );
}
