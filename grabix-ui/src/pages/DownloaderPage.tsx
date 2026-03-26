import { useState, useCallback } from "react";
import {
  IconSearch, IconPaste, IconLink, IconRefresh,
  IconVideo, IconAudio, IconImage, IconSubtitle,
  IconDownload, IconX, IconCheck, IconAlert,
  IconPlay, IconClock, IconScissors,
} from "../components/Icons";
import TrimSlider from "../components/TrimSlider";
import { type FileType, type QueueItem } from "../types/queue";

const API = "http://127.0.0.1:8000";

type Status = "idle" | "loading" | "ok" | "error";

interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  formats: string[];
}

interface Props {
  queue: QueueItem[];
  setQueue: React.Dispatch<React.SetStateAction<QueueItem[]>>;
  pollingRef: React.MutableRefObject<Map<string, ReturnType<typeof setInterval>>>;
}

const MOCK_INFO: VideoInfo = {
  title: "One Piece Episode 1074 – Luffy's Gear 5 Awakening",
  thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  duration: 1420,
  uploader: "Toei Animation",
  formats: ["1080p", "720p", "480p", "360p", "144p"],
};

function secs(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function uid() { return Math.random().toString(36).slice(2); }

export default function DownloaderPage({ queue, setQueue, pollingRef }: Props) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [fileType, setFileType] = useState<FileType>("video");
  const [quality, setQuality] = useState("1080p");
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [trimOpen, setTrimOpen] = useState(false);
  const [useCpu, setUseCpu] = useState(false);

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
          duration: data.duration_seconds ?? 300,
          uploader: data.uploader ?? "",
          formats: data.formats ?? ["1080p", "720p", "480p"],
        };
        setInfo(parsed);
        setTrimStart(0);
        setTrimEnd(parsed.duration);
        setStatus("ok");
      } else {
        setErrMsg(data.error || "Could not fetch link.");
        setStatus("error");
      }
    } catch {
      // Backend offline — use mock data so UI is always testable
      setInfo(MOCK_INFO);
      setTrimStart(0);
      setTrimEnd(MOCK_INFO.duration);
      setStatus("ok");
    }
  }, []);

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    setUrl(text);
    fetchInfo(text);
  };

  const handlePasteBtn = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      fetchInfo(text);
    } catch { setErrMsg("Clipboard access denied."); setStatus("error"); }
  };

  const startDownload = async () => {
    if (!info) return;
    const taskId = uid();
    const newItem: QueueItem = {
      id: taskId,
      serverId: "",
      url,
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
      filePath: "",
      error: "",
    };
    setQueue(prev => [newItem, ...prev]);

    try {
      const trimEnabled = trimOpen && trimEnd - trimStart < info.duration;
      const res = await fetch(
        `${API}/download?url=${encodeURIComponent(url)}&dl_type=${fileType}&quality=${quality}&trim_start=${trimStart}&trim_end=${trimEnd}&trim_enabled=${trimEnabled}&use_cpu=${useCpu}`
      );
      const data = await res.json();
      const serverTaskId = data.task_id ?? taskId;

      setQueue(prev => prev.map(q => q.id === taskId ? { ...q, serverId: serverTaskId } : q));

      // Poll progress — interval stored in shared pollingRef so it survives page switches
      const interval = setInterval(async () => {
        try {
          const pr = await fetch(`${API}/download-status/${serverTaskId}`);
          const pd = await pr.json();
          setQueue(prev => prev.map(q => q.id === taskId
            ? {
                ...q,
                status: pd.status,
                percent: pd.percent ?? 0,
                speed: pd.speed ?? "",
                eta: pd.eta ?? "",
                downloaded: pd.downloaded ?? "",
                total: pd.total ?? "",
                filePath: pd.file_path ?? "",
                error: pd.error ?? "",
              }
            : q
          ));
          if (["done", "failed", "canceled", "error"].includes(pd.status)) {
            clearInterval(interval);
            pollingRef.current.delete(taskId);
          }
        } catch { clearInterval(interval); }
      }, 1000);
      pollingRef.current.set(taskId, interval);

    } catch {
      // Simulate progress for offline testing
      let pct = 0;
      const sim = setInterval(() => {
        pct = Math.min(100, pct + Math.random() * 8);
        setQueue(prev => prev.map(q => q.id === taskId
          ? { ...q, status: pct >= 100 ? "done" : "downloading", percent: Math.round(pct) }
          : q
        ));
        if (pct >= 100) clearInterval(sim);
      }, 400);
    }
  };

  const activeCount = queue.filter(
    q => q.status === "downloading" || q.status === "queued" || q.status === "processing"
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

            {/* ── TRIM (Video only) ── */}
            {fileType === "video" && (
              <div className="fade-in" style={{ marginBottom: 14 }}>
                <button
                  className={`btn btn-ghost${trimOpen ? " active" : ""}`}
                  style={{ fontSize: 12, gap: 6 }}
                  onClick={() => setTrimOpen(v => !v)}
                >
                  <IconScissors size={13} />
                  {trimOpen ? "Hide Trim" : "Trim video"}
                  {trimOpen && trimEnd - trimStart < info.duration && (
                    <span style={{ marginLeft: 4, color: "var(--text-accent)" }}>
                      · {secs(trimEnd - trimStart)}
                    </span>
                  )}
                </button>

                {trimOpen && (
                  <TrimSlider
                    duration={info.duration}
                    onTrimChange={(s, e) => { setTrimStart(s); setTrimEnd(e); }}
                  />
                )}
              </div>
            )}

            <div className="divider" />

            {/* ── DOWNLOAD BUTTON ROW ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button
                className="btn btn-primary"
                style={{ height: 40, paddingLeft: 20, paddingRight: 20, fontSize: 14 }}
                onClick={startDownload}
              >
                <IconDownload size={15} />
                Download {fileType === "video" ? quality : fileType}
                {fileType === "video" && trimOpen && trimEnd - trimStart < info.duration && ` (${secs(trimEnd - trimStart)})`}
              </button>

              {fileType === "video" && trimOpen && (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <div className="tooltip-wrap">
                    <button
                      className={`quality-chip${!useCpu ? " active" : ""}`}
                      style={{ fontSize: 11, gap: 5 }}
                      onClick={() => setUseCpu(false)}
                    >
                      ⚡ No CPU
                    </button>
                    <span className="tooltip-box" style={{ width: 190, whiteSpace: "normal", lineHeight: 1.5 }}>
                      ✅ Recommended. Instant, no re-encode. Trim snaps to nearest keyframe (±2s). No FFmpeg needed.
                    </span>
                  </div>
                  <div className="tooltip-wrap">
                    <button
                      className={`quality-chip${useCpu ? " active" : ""}`}
                      style={{ fontSize: 11, gap: 5 }}
                      onClick={() => setUseCpu(true)}
                    >
                      🔧 With CPU
                    </button>
                    <span className="tooltip-box" style={{ width: 190, whiteSpace: "normal", lineHeight: 1.5 }}>
                      Frame-accurate trim. Re-encodes with FFmpeg — slower, uses CPU. Requires FFmpeg installed.
                    </span>
                  </div>
                </div>
              )}

              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {fileType === "video" && `Saves as MP4 · ${quality}`}
                {fileType === "audio" && "Saves as MP3 · 192kbps"}
                {fileType === "thumbnail" && "Saves as JPG"}
                {fileType === "subtitle" && "Saves as SRT"}
              </div>
            </div>
          </div>
        )}

        {/* ── EMPTY STATE ── */}
        {status === "idle" && (
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
