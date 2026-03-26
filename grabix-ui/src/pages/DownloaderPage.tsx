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

/** Parse a block of text into a clean list of URLs (one per line, skip blanks) */
function parseUrls(text: string): string[] {
  return text
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0 && (l.startsWith("http://") || l.startsWith("https://")));
}

export default function DownloaderPage({ queue, setQueue, pollingRef }: Props) {
  // ── Single-URL state ──────────────────────────────────────────────────────
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

  // ── Batch state ───────────────────────────────────────────────────────────
  const [batchMode, setBatchMode] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [batchFileType, setBatchFileType] = useState<FileType>("video");
  const [batchQuality, setBatchQuality] = useState("1080p");
  const [batchQueuing, setBatchQueuing] = useState(false);

  // ── Shared helpers ────────────────────────────────────────────────────────

  /** Start polling a single server task and update queue state */
  function startPolling(taskId: string, serverTaskId: string) {
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
  }

  /** Queue and start one download — used by both single and batch paths */
  async function enqueueDownload(
    downloadUrl: string,
    dlFileType: FileType,
    dlQuality: string,
    dlTrimStart = 0,
    dlTrimEnd = 0,
    dlTrimEnabled = false,
    dlUseCpu = false,
    previewInfo: VideoInfo | null = null,
  ) {
    const taskId = uid();
    const newItem: QueueItem = {
      id: taskId,
      serverId: "",
      url: downloadUrl,
      title: previewInfo?.title ?? downloadUrl,
      thumbnail: previewInfo?.thumbnail ?? "",
      format: dlFileType === "video" ? dlQuality : dlFileType,
      fileType: dlFileType,
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
      const res = await fetch(
        `${API}/download?url=${encodeURIComponent(downloadUrl)}&dl_type=${dlFileType}&quality=${dlQuality}&trim_start=${dlTrimStart}&trim_end=${dlTrimEnd}&trim_enabled=${dlTrimEnabled}&use_cpu=${dlUseCpu}`
      );
      const data = await res.json();
      const serverTaskId = data.task_id ?? taskId;
      setQueue(prev => prev.map(q => q.id === taskId ? { ...q, serverId: serverTaskId } : q));
      startPolling(taskId, serverTaskId);
    } catch {
      // Backend offline — simulate progress for testing
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
  }

  // ── Single URL handlers ───────────────────────────────────────────────────

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
      setInfo(MOCK_INFO);
      setTrimStart(0);
      setTrimEnd(MOCK_INFO.duration);
      setStatus("ok");
    }
  }, []);

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    const urls = parseUrls(text);
    if (urls.length > 1) {
      setBatchText(urls.join("\n"));
      setBatchMode(true);
      return;
    }
    setUrl(text);
    fetchInfo(text);
  };

  const handlePasteBtn = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const urls = parseUrls(text);
      if (urls.length > 1) {
        setBatchText(urls.join("\n"));
        setBatchMode(true);
        return;
      }
      setUrl(text);
      fetchInfo(text);
    } catch { setErrMsg("Clipboard access denied."); setStatus("error"); }
  };

  const startDownload = async () => {
    if (!info) return;
    const trimEnabled = trimOpen && trimEnd - trimStart < info.duration;
    await enqueueDownload(url, fileType, quality, trimStart, trimEnd, trimEnabled, useCpu, info);
  };

  // ── Batch handlers ────────────────────────────────────────────────────────

  const startBatchDownload = async () => {
    const urls = parseUrls(batchText);
    if (urls.length === 0) return;
    setBatchQueuing(true);
    // Fire all downloads concurrently — each gets its own queue entry immediately
    await Promise.all(urls.map(u => enqueueDownload(u, batchFileType, batchQuality)));
    setBatchQueuing(false);
    setBatchText("");
    setBatchMode(false);
  };

  const exitBatch = () => {
    setBatchMode(false);
    setBatchText("");
  };

  // ── Derived values ────────────────────────────────────────────────────────

  const activeCount = queue.filter(
    q => q.status === "downloading" || q.status === "queued" || q.status === "processing"
  ).length;

  const batchUrls = parseUrls(batchText);

  const FILE_TYPES: { id: FileType; label: string; Icon: React.FC<any> }[] = [
    { id: "video",     label: "Video",     Icon: IconVideo },
    { id: "audio",     label: "Audio",     Icon: IconAudio },
    { id: "thumbnail", label: "Thumbnail", Icon: IconImage },
    { id: "subtitle",  label: "Subtitle",  Icon: IconSubtitle },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

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
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>
            {batchMode ? "Batch mode — one URL per line" : "Paste a link to start downloading"}
          </div>
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
          {!batchMode && (
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setBatchMode(true)}>
              + Batch
            </button>
          )}
        </div>
      </div>

      {/* Scroll area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

        {batchMode ? (
          /* ══ BATCH MODE ══════════════════════════════════════════════════ */
          <div className="card card-padded fade-in">

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: 0.5, textTransform: "uppercase" }}>
                Batch Download
              </div>
              <button className="btn-icon" style={{ width: 26, height: 26 }} title="Exit batch mode" onClick={exitBatch}>
                <IconX size={13} />
              </button>
            </div>

            <textarea
              className="input-base"
              style={{
                width: "100%", minHeight: 140, resize: "vertical",
                fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.7,
                padding: "10px 12px",
              }}
              placeholder={"https://youtube.com/watch?v=aaa\nhttps://youtube.com/watch?v=bbb\nhttps://youtube.com/watch?v=ccc"}
              value={batchText}
              onChange={e => setBatchText(e.target.value)}
              spellCheck={false}
            />

            <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
              {batchUrls.length === 0
                ? "Paste one URL per line"
                : `${batchUrls.length} URL${batchUrls.length > 1 ? "s" : ""} detected`}
            </div>

            <div className="divider" style={{ margin: "14px 0" }} />

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>
                Download all as
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {FILE_TYPES.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    className={`filetype-tab${batchFileType === id ? " active" : ""}`}
                    onClick={() => setBatchFileType(id)}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {batchFileType === "video" && (
              <div style={{ marginBottom: 14 }} className="fade-in">
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>
                  Quality (applied to all)
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {["4K", "2K", "1080p", "720p", "480p", "360p"].map(q => (
                    <button
                      key={q}
                      className={`quality-chip${batchQuality === q ? " active" : ""}`}
                      onClick={() => setBatchQuality(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="divider" style={{ margin: "14px 0" }} />

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                className="btn btn-primary"
                style={{ height: 40, paddingLeft: 20, paddingRight: 20, fontSize: 14 }}
                disabled={batchUrls.length === 0 || batchQueuing}
                onClick={startBatchDownload}
              >
                {batchQueuing
                  ? <><IconRefresh size={14} className="spin" /> Queuing…</>
                  : <><IconDownload size={15} /> Download {batchUrls.length > 0 ? `${batchUrls.length} videos` : "all"}</>}
              </button>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Trim is not available in batch mode
              </div>
            </div>
          </div>

        ) : (
          /* ══ SINGLE URL MODE ═════════════════════════════════════════════ */
          <>
            {/* URL INPUT CARD */}
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

            {/* PREVIEW CARD */}
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

                {/* FILE TYPE */}
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

                {/* QUALITY */}
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

                {/* TRIM */}
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

                {/* DOWNLOAD BUTTON */}
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

            {/* EMPTY STATE */}
            {status === "idle" && (
              <div className="empty-state">
                <IconLink size={40} color="var(--text-muted)" />
                <p>Paste a video link to get started</p>
                <span>Supports YouTube, Vimeo, Twitter, and 1000+ sites via yt-dlp</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
