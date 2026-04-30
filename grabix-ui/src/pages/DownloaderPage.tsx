// grabix-ui/src/pages/DownloaderPage.tsx
// Thin coordinator: owns UI state, delegates queue/download logic to useDownloaderQueue,
// and composes DownloaderPreview + QueueCard.

import { useState, useCallback, useEffect } from "react";
import {
  IconSearch, IconPaste, IconLink, IconRefresh,
  IconDownload, IconX, IconAlert,
} from "../components/Icons";
import { PageEmptyState } from "../components/PageStates";
import { BACKEND_API, backendFetch, backendJson, waitForBackendCoreReady } from "../lib/api";
import { useRuntimeHealth } from "../context/RuntimeHealthContext";
import { invoke } from "@tauri-apps/api/core";
import {
  FileType, Status, DownloadEngine, VideoInfo, RuntimeDependency,
} from "./downloader.types";
import { useDownloaderQueue } from "./useDownloaderQueue";
import { DownloaderPreview } from "./DownloaderPreview";
import { QueueCard } from "./QueueCard";

const API = BACKEND_API;

export default function DownloaderPage({ onDownloadStarting }: { onDownloadStarting?: () => void }) {
  const { runtimeState } = useRuntimeHealth();

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [url,             setUrl]             = useState("");
  const [batchMode,       setBatchMode]       = useState(false);
  const [batchUrls,       setBatchUrls]       = useState("");
  const [status,          setStatus]          = useState<Status>("idle");
  const [info,            setInfo]            = useState<VideoInfo | null>(null);
  const [errMsg,          setErrMsg]          = useState("");
  const [fileType,        setFileType]        = useState<FileType>("video");
  const [quality,         setQuality]         = useState("1080p");
  const [downloadEngine,  setDownloadEngine]  = useState<DownloadEngine>("standard");
  const [aria2Available,  setAria2Available]  = useState(false);
  const [dependencies,    setDependencies]    = useState<Record<string, RuntimeDependency>>({});
  const [audioFormat,     setAudioFormat]     = useState("mp3");
  const [subtitleLang,    setSubtitleLang]    = useState("en");
  const [thumbnailFormat, setThumbnailFormat] = useState("jpg");
  const [trimStart,       setTrimStart]       = useState(0);
  const [trimEnd,         setTrimEnd]         = useState(0);
  const [trimOpen,        setTrimOpen]        = useState(false);
  const [useCpu,          setUseCpu]          = useState(false);

  const { queue, startDownload, startBatch, removeFromQueue, clearAllQueue, doAction, doReveal } =
    useDownloaderQueue();

  // ── Deps + settings polling (stays here; SSE is inside the hook) ─────────────
  useEffect(() => {
    let active = true;

    const syncDependencies = async () => {
      try {
        const res  = await backendFetch(`${API}/runtime/dependencies`);
        if (!res.ok) return;
        const data = (await res.json()) as { dependencies?: Record<string, RuntimeDependency> };
        if (!active) return;
        setDependencies(data.dependencies ?? {});
        setAria2Available(Boolean(data.dependencies?.aria2?.available));
      } catch { if (!active) return; }
    };

    backendJson<Record<string, unknown>>(`${API}/settings`)
      .then((data) => {
        if (!active) return;
        if (data.default_download_engine === "aria2" || data.default_download_engine === "standard") {
          setDownloadEngine(data.default_download_engine as DownloadEngine);
        }
      })
      .catch(() => undefined);

    void syncDependencies();
    const depInterval = setInterval(syncDependencies, 10000);
    return () => { active = false; clearInterval(depInterval); };
  }, []);

  // ── fetchInfo ─────────────────────────────────────────────────────────────────
  const fetchInfo = useCallback(async (inputUrl: string) => {
    if (!inputUrl.trim()) return;
    setStatus("loading"); setInfo(null); setErrMsg("");
    const isReady = await waitForBackendCoreReady(30000, 500);
    if (!isReady) {
      setErrMsg("Backend is still starting up. Please wait a moment and try again.");
      setStatus("error"); return;
    }
    try {
      const res  = await backendFetch(`${API}/check-link?url=${encodeURIComponent(inputUrl)}`);
      const data = await res.json();
      if (data.valid) {
        const parsed: VideoInfo = {
          title: data.title, thumbnail: data.thumbnail,
          duration: data.duration_seconds ?? 300,
          uploader: data.uploader ?? "", formats: data.formats ?? ["1080p", "720p", "480p"],
        };
        setInfo(parsed); setTrimStart(0); setTrimEnd(parsed.duration); setStatus("ok");
      } else {
        setErrMsg(data.error || "Could not fetch link."); setStatus("error");
      }
    } catch {
      setErrMsg("Could not reach the backend. Make sure the app is running and try again.");
      setStatus("error");
    }
  }, []);

  // ── Clipboard helpers ─────────────────────────────────────────────────────────
 const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();                          // stop browser default insert
    const text = e.clipboardData.getData("text").trim();
    if (!text) return;
    setUrl(text);
    fetchInfo(text);
};

  const readClipboard = async () => {
    try { return await navigator.clipboard.readText(); }
    catch { return invoke<string>("read_clipboard_text"); }
  };

  const handlePasteBtn = async () => {
    try {
      const text = await readClipboard();
      if (!text.trim()) { setErrMsg("Clipboard is empty."); setStatus("error"); return; }
      setUrl(text); fetchInfo(text);
    } catch {
      setErrMsg("Clipboard access denied. Use Ctrl+V if another app is blocking clipboard access.");
      setStatus("error");
    }
  };

  const handleBatchPasteBtn = async () => {
    try {
      const text = await readClipboard();
      if (!text.trim()) { setErrMsg("Clipboard is empty."); setStatus("error"); return; }
      setBatchUrls((prev) => [prev.trim(), text.trim()].filter(Boolean).join("\n"));
    } catch {
      setErrMsg("Clipboard access denied. Use Ctrl+V if another app is blocking clipboard access.");
      setStatus("error");
    }
  };

  // ── Other helpers ─────────────────────────────────────────────────────────────
  const installDependency = async (depId: string) => {
    try {
      const res = await backendFetch(`${API}/runtime/dependencies/install?dep_id=${encodeURIComponent(depId)}`, { method: "POST" }, { sensitive: true });
      if (!res.ok) throw new Error(`Could not start ${depId} installation.`);
    } catch {
      setErrMsg(`Could not start ${depId} installation.`); setStatus("error");
    }
  };

  const visibleDependencies = Object.values(dependencies).filter(
    (d) => !d.available || d.job?.status === "installing" || d.job?.status === "failed"
  );
  const activeCount = queue.filter((q) => q.status === "downloading" || q.status === "queued" || q.status === "processing").length;
  const sharedDownloadParams = { fileType, quality, audioFormat, subtitleLang, thumbnailFormat, downloadEngine, trimStart, trimEnd, trimOpen, useCpu, onDownloadStarting };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>

      {/* Topbar */}
      <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Downloader</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>Paste a link to start downloading</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {activeCount > 0 && (
            <span style={{ fontSize: 12, color: "var(--text-accent)", background: "var(--accent-light)", padding: "4px 10px", borderRadius: 99, fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>
              <span className="pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />
              {activeCount} downloading
            </span>
          )}
          {queue.length > 0 && (
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => void clearAllQueue()}>Clear all</button>
          )}
        </div>
      </div>

      {/* Scroll area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* URL input card */}
        <div className="card card-padded">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: 0.5, textTransform: "uppercase" }}>{batchMode ? "Batch URLs" : "Video URL"}</div>
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => { setBatchMode((v) => !v); setInfo(null); setStatus("idle"); }}>
              {batchMode ? "Single URL" : "Batch / Multiple"}
            </button>
          </div>

          {batchMode ? (
            <div>
              <textarea
                className="input-base"
                style={{ width: "100%", minHeight: 110, padding: "10px 14px", resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12 }}
                placeholder={"Paste one URL per line:\nhttps://youtube.com/watch?v=...\nhttps://youtube.com/watch?v=..."}
                value={batchUrls}
                onChange={(e) => setBatchUrls(e.target.value)}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                <button className="btn btn-ghost" onClick={handleBatchPasteBtn} style={{ height: 36 }}>
                  <IconDownload size={14} />Paste
                </button>
                <button className="btn btn-primary" onClick={() => { void startBatch(batchUrls, sharedDownloadParams); setBatchUrls(""); setBatchMode(false); }} disabled={!batchUrls.trim()} style={{ height: 36 }}>
                  <IconDownload size={14} />Queue All ({batchUrls.split("\n").filter((u) => u.trim()).length} URLs)
                </button>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Each URL is queued immediately at current settings below</span>
              </div>
            </div>
          ) : (
            <div>
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
                    onChange={(e) => setUrl(e.target.value)}
                    onPaste={handlePaste}
                    onKeyDown={(e) => e.key === "Enter" && fetchInfo(url)}
                  />
                  {url && (
                    <button onClick={() => { setUrl(""); setInfo(null); setStatus("idle"); }} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", padding: 2 }}>
                      <IconX size={14} />
                    </button>
                  )}
                </div>
                <div className="tooltip-wrap">
                  <button className="btn-icon" onClick={handlePasteBtn} title="Paste from clipboard"><IconPaste size={15} /></button>
                  <span className="tooltip-box">Paste from clipboard</span>
                </div>
                <button className="btn btn-primary" onClick={() => fetchInfo(url)} disabled={status === "loading" || !url.trim()} style={{ minWidth: 90 }}>
                  {status === "loading" ? <><IconRefresh size={14} className="spin" /> Fetching...</> : <><IconSearch size={14} /> Fetch</>}
                </button>
              </div>
              {status === "error" && (
                <div className="fade-in" style={{ marginTop: 10, padding: "10px 14px", borderRadius: "var(--radius-sm)", background: "var(--bg-surface2)", border: "1px solid var(--danger)", display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-danger)" }}>
                  <IconAlert size={15} />{errMsg}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Preview card */}
        {status === "ok" && info && (
          <DownloaderPreview
            info={info} fileType={fileType} setFileType={setFileType}
            quality={quality} setQuality={setQuality}
            downloadEngine={downloadEngine} setDownloadEngine={setDownloadEngine}
            aria2Available={aria2Available}
            audioFormat={audioFormat} setAudioFormat={setAudioFormat}
            subtitleLang={subtitleLang} setSubtitleLang={setSubtitleLang}
            thumbnailFormat={thumbnailFormat} setThumbnailFormat={setThumbnailFormat}
            trimStart={trimStart} trimEnd={trimEnd} setTrimStart={setTrimStart} setTrimEnd={setTrimEnd}
            trimOpen={trimOpen} setTrimOpen={setTrimOpen}
            useCpu={useCpu} setUseCpu={setUseCpu}
            onDownload={() => void startDownload({ ...sharedDownloadParams, url, info })}
            visibleDependencies={visibleDependencies}
            onInstallDep={(id) => void installDependency(id)}
          />
        )}

        {/* Download queue */}
        {queue.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>Queue ({queue.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {queue.map((item) => <QueueCard key={item.id} item={item} onRemove={removeFromQueue} onAction={doAction} onReveal={doReveal} />)}
            </div>
          </div>
        )}

        {/* Empty state */}
        {status === "idle" && queue.length === 0 && (
          <PageEmptyState
            title="Paste a video link to get started"
            subtitle="Supports YouTube, Vimeo, Twitter, and 1000+ sites via yt-dlp."
            icon={<IconLink size={40} color="var(--text-muted)" />}
          />
        )}
      </div>
    </div>
  );
}
