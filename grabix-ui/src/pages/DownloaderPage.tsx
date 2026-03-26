import { useState, useRef, useCallback } from "react";
import {
  IconSearch, IconPaste, IconLink, IconRefresh,
  IconVideo, IconAudio, IconImage, IconSubtitle,
  IconDownload, IconX, IconCheck, IconAlert,
  IconPlay, IconClock, IconScissors,
} from "../components/Icons";
import TrimSlider from "../components/TrimSlider";

const API = "http://127.0.0.1:8000";

type FileType = "video" | "audio" | "thumbnail" | "subtitle";
type Status = "idle" | "loading" | "ok" | "error";

interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  formats: string[];
}

interface QueueItem {
  id: string;
  title: string;
  thumbnail: string;
  format: string;
  fileType: FileType;
  status: "queued" | "downloading" | "processing" | "done" | "error" | "failed" | "canceled";
  percent: number;
  speed: string;
  eta: string;
  downloaded: string;
  total: string;
  error: string;
}

function secs(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function uid() { return Math.random().toString(36).slice(2); }

export default function DownloaderPage() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [fileType, setFileType] = useState<FileType>("video");
  const [quality, setQuality] = useState("1080p");
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [trimEnabled, setTrimEnabled] = useState(false);   // FIX: trim is OFF by default
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // ── Fetch info from real backend ──────────────────────────────────────────
  const fetchInfo = useCallback(async (inputUrl: string) => {
    if (!inputUrl.trim()) return;
    setStatus("loading");
    setInfo(null);
    setErrMsg("");
    setTrimEnabled(false); // reset trim toggle on new fetch

    try {
      const res = await fetch(`${API}/check-link?url=${encodeURIComponent(inputUrl)}`);
      const data = await res.json();

      if (data.valid) {
        // FIX: backend returns "duration" not "duration_seconds" — handle both
        const dur = data.duration ?? data.duration_seconds ?? 0;
        // FIX: formats is now a plain string array ["1080p","720p",...] from backend
        const fmts: string[] = Array.isArray(data.formats) ? data.formats : ["1080p", "720p", "480p", "360p"];

        const parsed: VideoInfo = {
          title: data.title ?? "Unknown",
          thumbnail: data.thumbnail ?? "",
          duration: dur,
          uploader: data.uploader ?? data.channel ?? "",
          formats: fmts,
        };

        setInfo(parsed);
        setTrimStart(0);
        setTrimEnd(dur);
        // Default to best available quality
        setQuality(fmts[0] ?? "1080p");
        setStatus("ok");
      } else {
        setErrMsg(data.error || "Could not fetch link.");
        setStatus("error");
      }
    } catch {
      setErrMsg("Backend is offline. Start the Python server and try again.");
      setStatus("error");
    }
  }, []);

  // Auto-fetch on paste
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

  // ── Start download ────────────────────────────────────────────────────────
  const startDownload = async () => {
    if (!info) return;
    const taskId = uid();

    const newItem: QueueItem = {
      id: taskId,
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
    };
    setQueue(prev => [newItem, ...prev]);

    try {
      // FIX: send trim_enabled flag so backend knows whether to actually trim
      const params = new URLSearchParams({
        url,
        dl_type: fileType,
        quality,
        trim_start: String(trimStart),
        trim_end: String(trimEnd),
        trim_enabled: String(trimEnabled && fileType === "video"),
      });

      const res = await fetch(`${API}/download?${params}`, { method: "POST" });
      const data = await res.json();
      const serverTaskId: string = data.id ?? taskId;

      // FIX: poll /progress/{id} — this endpoint now exists in fixed backend
      const interval = setInterval(async () => {
        try {
          const pr = await fetch(`${API}/progress/${serverTaskId}`);
          const pd = await pr.json();

          // Map backend "failed" → our "error" so QueueCard shows error state
          const mappedStatus = pd.status === "failed" ? "error" : pd.status;

          setQueue(prev => prev.map(q =>
            q.id === taskId
              ? {
                  ...q,
                  status: mappedStatus,
                  percent: pd.percent ?? 0,
                  speed: pd.speed ?? "",
                  eta: pd.eta ?? "",
                  downloaded: pd.downloaded ?? "",
                  total: pd.total ?? "",
                  error: pd.error ?? "",
                }
              : q
          ));

          if (pd.status === "done" || pd.status === "failed" || pd.status === "canceled") {
            clearInterval(interval);
            pollingRef.current.delete(taskId);
          }
        } catch {
          clearInterval(interval);
          pollingRef.current.delete(taskId);
        }
      }, 800);

      pollingRef.current.set(taskId, interval);

    } catch (err) {
      setQueue(prev => prev.map(q =>
        q.id === taskId
          ? { ...q, status: "error", error: "Could not reach backend. Is the server running?" }
          : q
      ));
    }
  };

  const removeFromQueue = (id: string) => {
    const interval = pollingRef.current.get(id);
    if (interval) { clearInterval(interval); pollingRef.current.delete(id); }
    setQueue(prev => prev.filter(q => q.id !== id));
  };

  const activeCount = queue.filter(q =>
    q.status === "downloading" || q.status === "queued" || q.status === "processing"
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
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setQueue([])}>
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
                  {info.uploader && <> · {info.uploader}</>}
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

            {/* ── QUALITY (Video only) ── */}
            {fileType === "video" && (
              <div style={{ marginBottom: 14 }} className="fade-in">
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>
                  Quality
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {info.formats.map((f) => (
                    <button
                      key={f}
                      className={`quality-chip${quality === f ? " active" : ""}`}
                      onClick={() => setQuality(f)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── TRIM TOGGLE (Video only) ── */}
            {fileType === "video" && (
              <div style={{ marginBottom: trimEnabled ? 0 : 14 }} className="fade-in">
                <button
                  className={`filetype-tab${trimEnabled ? " active" : ""}`}
                  style={{ fontSize: 12, gap: 6 }}
                  onClick={() => setTrimEnabled(v => !v)}
                >
                  <IconScissors size={13} />
                  {trimEnabled ? "Trim: ON" : "Trim: OFF"}
                </button>
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 10 }}>
                  {trimEnabled ? "Drag sliders below to set clip range" : "Click to trim before downloading"}
                </span>
              </div>
            )}

            {/* ── TRIM SLIDER — only shown when trimEnabled ── */}
            {fileType === "video" && trimEnabled && (
              <div className="fade-in" style={{ marginTop: 10 }}>
                <TrimSlider
                  duration={info.duration}
                  onTrimChange={(s, e) => { setTrimStart(s); setTrimEnd(e); }}
                />
              </div>
            )}

            <div className="divider" style={{ marginTop: 14 }} />

            {/* ── DOWNLOAD BUTTON ROW ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                className="btn btn-primary"
                style={{ height: 40, paddingLeft: 20, paddingRight: 20, fontSize: 14 }}
                onClick={startDownload}
              >
                <IconDownload size={15} />
                Download {fileType === "video" ? quality : fileType}
                {fileType === "video" && trimEnabled && trimEnd - trimStart < info.duration
                  ? ` (${secs(trimEnd - trimStart)})`
                  : ""}
              </button>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {fileType === "video" && `Saves as MP4 · ${quality}`}
                {fileType === "audio" && "Saves as MP3 · 192kbps"}
                {fileType === "thumbnail" && "Saves as JPG"}
                {fileType === "subtitle" && "Saves as SRT"}
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
              {queue.map((item) => <QueueCard key={item.id} item={item} onRemove={removeFromQueue} />)}
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

// ── Queue Card ────────────────────────────────────────────────────────────────
function QueueCard({ item, onRemove }: { item: QueueItem; onRemove: (id: string) => void }) {
  const isActive = item.status === "downloading" || item.status === "queued" || item.status === "processing";
  const isDone = item.status === "done";
  const isError = item.status === "error" || item.status === "failed" || item.status === "canceled";

  const statusColors: Record<string, string> = {
    done: "var(--success)",
    error: "var(--danger)", failed: "var(--danger)", canceled: "var(--danger)",
    downloading: "var(--accent)",
    processing: "var(--warning)",
    queued: "var(--text-muted)",
  };
  const statusLabels: Record<string, string> = {
    done: "Done ✓", error: "Failed", failed: "Failed", canceled: "Canceled",
    downloading: "Downloading…", processing: "Processing…", queued: "Queued",
  };

  return (
    <div className="card fade-in" style={{ padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {item.thumbnail && (
          <img
            src={item.thumbnail}
            alt=""
            style={{ width: 48, height: 32, objectFit: "cover", borderRadius: 5, flexShrink: 0, border: "1px solid var(--border)" }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
            <span style={{ fontSize: 11, color: statusColors[item.status] ?? "var(--text-muted)", fontWeight: 500 }}>
              {statusLabels[item.status] ?? item.status}
            </span>
            {/* FIX: show speed when downloading */}
            {item.speed && isActive && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.speed}</span>
            )}
            {/* FIX: show ETA when downloading */}
            {item.eta && isActive && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>ETA {item.eta}</span>
            )}
            {/* FIX: show file size info */}
            {item.total && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {isActive ? `${item.downloaded} / ${item.total}` : item.total}
              </span>
            )}
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
              {item.format.toUpperCase()}
            </span>
          </div>
        </div>
        <div className="tooltip-wrap">
          <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onRemove(item.id)}>
            <IconX size={13} />
          </button>
          <span className="tooltip-box">Remove</span>
        </div>
      </div>

      {/* FIX: progress bar shown for active downloads with real percent */}
      {isActive && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontFamily: "var(--font-mono)" }}>
            <span>{item.percent}%</span>
            <span>{item.speed}</span>
          </div>
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{ width: `${item.percent}%`, transition: "width 0.5s ease" }} />
          </div>
        </div>
      )}

      {/* FIX: full-width green bar when done */}
      {isDone && (
        <div style={{ marginTop: 8 }}>
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{ width: "100%", background: "var(--success)" }} />
          </div>
        </div>
      )}

      {isError && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-danger)", display: "flex", alignItems: "center", gap: 5 }}>
          <IconAlert size={13} /> {item.error || "Download failed. Check the URL and try again."}
        </div>
      )}
    </div>
  );
}
