import { useState, useRef, useCallback, useEffect } from "react";
import {
  IconSearch, IconPaste, IconLink, IconRefresh,
  IconVideo, IconAudio, IconImage, IconSubtitle,
  IconDownload, IconX, IconCheck, IconAlert,
  IconPlay, IconPause, IconStop, IconClock, IconScissors,
  IconFolder, IconInfo,
} from "../components/Icons";
import { PageEmptyState } from "../components/PageStates";
import TrimSlider from "../components/TrimSlider";
import { BACKEND_API, backendFetch, backendJson } from "../lib/api";
import { invoke } from "@tauri-apps/api/core";
const API = BACKEND_API;

type FileType = "video" | "audio" | "thumbnail" | "subtitle";
type Status = "idle" | "loading" | "ok" | "error";
type DownloadEngine = "standard" | "aria2";
type ProgressMode = "determinate" | "activity" | "processing";

interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  formats: string[];
}

interface QueueItem {
  id: string;
  serverId: string;
  url: string;
  title: string;
  thumbnail: string;
  format: string;
  fileType: FileType;
  status: "queued" | "downloading" | "processing" | "done" | "error" | "paused" | "canceling" | "failed" | "canceled";
  percent: number;
  speed: string;
  eta: string;
  downloaded: string;
  total: string;
  size: string;
  filePath: string;
  partialFilePath: string;
  error: string;
  canPause: boolean;
  recoverable: boolean;
  retryCount: number;
  failureCode: string;
  downloadEngine: DownloadEngine;
  requestedEngine: DownloadEngine;
  engineNote: string;
  bytesDownloaded: number;
  bytesTotal: number;
  progressMode: ProgressMode;
  stageLabel: string;
  variantLabel: string;
}

interface RuntimeDependency {
  id: string;
  label: string;
  available: boolean;
  path?: string;
  description?: string;
  install_supported?: boolean;
  job?: { status?: string; message?: string };
}

function toQueueItem(serverItem: any, previous?: QueueItem): QueueItem {
  const fileType = (serverItem.dl_type as FileType) || previous?.fileType || "video";
  return {
    id: serverItem.id ?? previous?.id ?? uid(),
    serverId: serverItem.id ?? previous?.serverId ?? "",
    url: serverItem.url ?? previous?.url ?? "",
    title: serverItem.title || previous?.title || "Preparing download...",
    thumbnail: serverItem.thumbnail || previous?.thumbnail || "",
    format: serverItem.variant_label || previous?.format || fileType,
    fileType,
    status: serverItem.status ?? previous?.status ?? "queued",
    percent: serverItem.percent ?? previous?.percent ?? 0,
    speed: serverItem.speed ?? previous?.speed ?? "",
    eta: serverItem.eta ?? previous?.eta ?? "",
    downloaded: serverItem.downloaded ?? previous?.downloaded ?? "",
    total: serverItem.total ?? previous?.total ?? "",
    size: serverItem.size ?? previous?.size ?? "",
    filePath: serverItem.file_path ?? previous?.filePath ?? "",
    partialFilePath: serverItem.partial_file_path ?? previous?.partialFilePath ?? "",
    error: serverItem.error ?? previous?.error ?? "",
    canPause: serverItem.can_pause ?? previous?.canPause ?? false,
    recoverable: serverItem.recoverable ?? previous?.recoverable ?? false,
    retryCount: serverItem.retry_count ?? previous?.retryCount ?? 0,
    failureCode: serverItem.failure_code ?? previous?.failureCode ?? "",
    downloadEngine: serverItem.download_engine === "aria2" ? "aria2" : previous?.downloadEngine ?? "standard",
    requestedEngine: serverItem.download_engine_requested === "aria2" ? "aria2" : previous?.requestedEngine ?? "standard",
    engineNote: serverItem.engine_note ?? previous?.engineNote ?? "",
    bytesDownloaded: Number(serverItem.bytes_downloaded ?? previous?.bytesDownloaded ?? 0),
    bytesTotal: Number(serverItem.bytes_total ?? previous?.bytesTotal ?? 0),
    progressMode: (serverItem.progress_mode as ProgressMode) ?? previous?.progressMode ?? "activity",
    stageLabel: serverItem.stage_label ?? previous?.stageLabel ?? "",
    variantLabel: serverItem.variant_label ?? previous?.variantLabel ?? "",
  };
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

function formatDisplaySpeed(speed: string): string {
  const clean = speed.replace(/\x1b\[[0-9;]*m/g, "").replace(/\u001b\[[0-9;]*m/g, "").trim();
  if (!clean) return "";
  if (clean.endsWith("/s")) {
    return clean.replace("MiB", "MB").replace("KiB", "KB").replace("GiB", "GB");
  }
  if (clean.endsWith("x")) {
    return clean;
  }
  return clean;
}

function parseDisplayedBytes(value: string): number {
  const clean = value.trim();
  if (!clean) return 0;

  const match = clean.match(/^([\d.]+)\s*(B|KB|MB|GB|TB|KIB|MIB|GIB|TIB)$/i);
  if (!match) return 0;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return 0;

  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    TB: 1000 ** 4,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
  };

  return Math.round(amount * (multipliers[unit] ?? 1));
}

function variantLabelForRequest(
  fileType: FileType,
  quality: string,
  audioFormat: string,
  subtitleLang: string,
  thumbnailFormat: string,
): string {
  if (fileType === "video") return quality;
  if (fileType === "audio") return `${audioFormat}-192`;
  if (fileType === "subtitle") return `${subtitleLang}-subtitle`;
  return thumbnailFormat;
}

export default function DownloaderPage() {
  const [url, setUrl] = useState("");
  const [batchMode, setBatchMode] = useState(false);
  const [batchUrls, setBatchUrls] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [fileType, setFileType] = useState<FileType>("video");
  const [quality, setQuality] = useState("1080p");
  const [downloadEngine, setDownloadEngine] = useState<DownloadEngine>("standard");
  const [aria2Available, setAria2Available] = useState(false);
  const [dependencies, setDependencies] = useState<Record<string, RuntimeDependency>>({});
  const [audioFormat, setAudioFormat] = useState("mp3");
  const [subtitleLang, setSubtitleLang] = useState("en");
  const [thumbnailFormat, setThumbnailFormat] = useState("jpg");
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [trimOpen, setTrimOpen] = useState(false);
  const [useCpu, setUseCpu] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const visibleDependencies = Object.values(dependencies).filter(
    (dependency) => !dependency.available || dependency.job?.status === "installing" || dependency.job?.status === "failed"
  );

  useEffect(() => {
    let active = true;

    const syncBackendQueue = async () => {
      try {
        const response = await fetch(`${API}/downloads`);
        if (!response.ok) return;
        const data = (await response.json()) as any[];
        if (!active) return;

        setQueue((prev) => {
          const previousById = new Map(prev.map((item) => [item.serverId || item.id, item]));
          const synced = data.map((serverItem) => toQueueItem(serverItem, previousById.get(serverItem.id)));
          const pendingLocal = prev.filter((item) => {
            if (item.serverId) return false;
            return !synced.some((serverItem) =>
              serverItem.url === item.url &&
              serverItem.fileType === item.fileType &&
              serverItem.variantLabel === item.variantLabel
            );
          });
          return [...pendingLocal, ...synced];
        });
      } catch {
        // Ignore sync failures while backend is offline.
      }
    };

    const syncDependencies = async () => {
      try {
        const response = await backendFetch(`${API}/runtime/dependencies`);
        if (!response.ok) return;
        const data = (await response.json()) as { dependencies?: Record<string, RuntimeDependency> };
        if (!active) return;
        setDependencies(data.dependencies ?? {});
        setAria2Available(Boolean(data.dependencies?.aria2?.available));
      } catch {
        if (!active) return;
      }
    };

    backendJson<Record<string, unknown>>(`${API}/settings`)
      .then((data: Record<string, unknown>) => {
        if (!active) return;
        if (data.default_download_engine === "aria2" || data.default_download_engine === "standard") {
          setDownloadEngine(data.default_download_engine);
        }
      })
      .catch(() => undefined);

    void syncBackendQueue();
    void syncDependencies();
    const interval = setInterval(syncBackendQueue, 1000);
    const depInterval = setInterval(syncDependencies, 2500);

    return () => {
      active = false;
      clearInterval(interval);
      clearInterval(depInterval);
      pollingRef.current.forEach((timer) => clearInterval(timer));
      pollingRef.current.clear();
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

  // Auto-fetch on paste
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    setUrl(text);
    fetchInfo(text);
  };

  const handlePasteBtn = async () => {
    try {
      let text = "";
      try {
        text = await navigator.clipboard.readText();
      } catch {
        text = await invoke<string>("read_clipboard_text");
      }
      if (!text.trim()) {
        setErrMsg("Clipboard is empty.");
        setStatus("error");
        return;
      }
      setUrl(text);
      fetchInfo(text);
    } catch {
      setErrMsg("Clipboard access denied. Use Ctrl+V if another app is blocking clipboard access.");
      setStatus("error");
    }
  };

  const handleBatchPasteBtn = async () => {
    try {
      let text = "";
      try {
        text = await navigator.clipboard.readText();
      } catch {
        text = await invoke<string>("read_clipboard_text");
      }
      if (!text.trim()) {
        setErrMsg("Clipboard is empty.");
        setStatus("error");
        return;
      }
      setBatchUrls((prev) => [prev.trim(), text.trim()].filter(Boolean).join("\n"));
    } catch {
      setErrMsg("Clipboard access denied. Use Ctrl+V if another app is blocking clipboard access.");
      setStatus("error");
    }
  };

  const installDependency = async (depId: string) => {
    try {
      const response = await backendFetch(`${API}/runtime/dependencies/install?dep_id=${encodeURIComponent(depId)}`, { method: "POST" }, { sensitive: true });
      if (!response.ok) {
        throw new Error(`Could not start ${depId} installation.`);
      }
    } catch {
      setErrMsg(`Could not start ${depId} installation.`);
      setStatus("error");
    }
  };

  const startDownload = async () => {
    if (!info) return;
    const taskId = uid();
    const effectiveDownloadEngine: DownloadEngine = fileType === "thumbnail" || fileType === "subtitle" ? "standard" : downloadEngine;
    const variantLabel = variantLabelForRequest(fileType, quality, audioFormat, subtitleLang, thumbnailFormat);
    const newItem: QueueItem = {
      id: taskId,
      serverId: "",
      url: url,
      title: info.title,
      thumbnail: info.thumbnail,
      format: variantLabel,
      fileType,
      status: "queued",
      percent: 0,
      speed: "",
      eta: "",
      downloaded: "",
      total: "",
      size: "",
      filePath: "",
      partialFilePath: "",
      error: "",
      canPause: false,
      recoverable: false,
      retryCount: 0,
      failureCode: "",
      downloadEngine: effectiveDownloadEngine,
      requestedEngine: effectiveDownloadEngine,
      engineNote: "",
      bytesDownloaded: 0,
      bytesTotal: 0,
      progressMode: "activity",
      stageLabel: "Queued",
      variantLabel,
    };
    setQueue(prev => [newItem, ...prev]);

    try {
      const trimEnabled = trimOpen && trimEnd - trimStart < info!.duration;
      const res = await backendFetch(`${API}/download?url=${encodeURIComponent(url)}&title=${encodeURIComponent(info.title || "")}&thumbnail=${encodeURIComponent(info.thumbnail || "")}&dl_type=${fileType}&quality=${quality}&audio_format=${audioFormat}&subtitle_lang=${subtitleLang}&thumbnail_format=${thumbnailFormat}&trim_start=${trimStart}&trim_end=${trimEnd}&trim_enabled=${trimEnabled}&use_cpu=${useCpu}&download_engine=${encodeURIComponent(effectiveDownloadEngine)}`, undefined, { sensitive: true });
      if (!res.ok) {
        throw new Error(`Download request failed with ${res.status}`);
      }
      const data = await res.json();
      const serverTaskId = data.task_id ?? taskId;

      setQueue(prev => prev.map(q => q.id === taskId ? { ...q, id: serverTaskId, serverId: serverTaskId } : q));

      const interval = setInterval(async () => {
        try {
          const pr = await backendFetch(`${API}/download-status/${serverTaskId}`, undefined, { sensitive: true });
          const pd = await pr.json();
          setQueue(prev => prev.map(q => (q.serverId || q.id) === serverTaskId
            ? {
                ...q,
                status: pd.status,
                percent: pd.percent ?? 0,
                speed: pd.speed ?? "",
                eta: pd.eta ?? "",
                downloaded: pd.downloaded ?? "",
                total: pd.total ?? "",
                size: pd.size ?? "",
                filePath: pd.file_path ?? "",
                partialFilePath: pd.partial_file_path ?? q.partialFilePath,
                error: pd.error ?? "",
                canPause: pd.can_pause ?? q.canPause,
                bytesDownloaded: pd.bytes_downloaded ?? q.bytesDownloaded,
                bytesTotal: pd.bytes_total ?? q.bytesTotal,
                progressMode: pd.progress_mode ?? q.progressMode,
                stageLabel: pd.stage_label ?? q.stageLabel,
                variantLabel: pd.variant_label ?? q.variantLabel,
              }
            : q
          ));
          if (["done", "failed", "canceled", "error"].includes(pd.status)) {
            clearInterval(interval);
            pollingRef.current.delete(serverTaskId);
          }
        } catch (error) {
          clearInterval(interval);
          pollingRef.current.delete(serverTaskId);
          setQueue(prev => prev.map(q => (q.serverId || q.id) === serverTaskId
            ? {
                ...q,
                status: "failed",
                error: error instanceof Error ? error.message : "Could not read live download status.",
                recoverable: true,
              }
            : q
          ));
        }
      }, 1000);
      pollingRef.current.set(serverTaskId, interval);

    } catch (error) {
      setQueue(prev => prev.map(q => q.id === taskId
        ? {
            ...q,
            status: "failed",
            error: error instanceof Error ? error.message : "Download could not be started.",
            recoverable: true,
          }
        : q
      ));
      setErrMsg(error instanceof Error ? error.message : "Download could not be started.");
      setStatus("error");
    }
  };

  // Batch: queue every non-empty URL from the textarea
  const startBatch = async () => {
    const urls = batchUrls.split("\n").map(u => u.trim()).filter(Boolean);
    if (!urls.length) return;
    for (const bUrl of urls) {
      const taskId = uid();
      const effectiveDownloadEngine: DownloadEngine = fileType === "thumbnail" || fileType === "subtitle" ? "standard" : downloadEngine;
      const variantLabel = variantLabelForRequest(fileType, quality, audioFormat, subtitleLang, thumbnailFormat);
      const newItem: QueueItem = {
        id: taskId, serverId: "", url: bUrl,
        title: bUrl.length > 60 ? bUrl.slice(0, 57) + "…" : bUrl,
        thumbnail: "", format: variantLabel,
        fileType, status: "queued", percent: 0, speed: "", eta: "",
        downloaded: "", total: "", size: "", filePath: "", error: "", canPause: false,
        partialFilePath: "", recoverable: false, retryCount: 0, failureCode: "",
        downloadEngine: effectiveDownloadEngine,
        requestedEngine: effectiveDownloadEngine,
        engineNote: "",
        bytesDownloaded: 0,
        bytesTotal: 0,
        progressMode: "activity",
        stageLabel: "Queued",
        variantLabel,
      };
      setQueue(prev => [newItem, ...prev]);
      try {
        const trimEnabled = trimOpen && info && trimEnd - trimStart < info.duration;
        const res = await backendFetch(`${API}/download?url=${encodeURIComponent(bUrl)}&title=${encodeURIComponent(newItem.title)}&dl_type=${fileType}&quality=${quality}&audio_format=${audioFormat}&subtitle_lang=${subtitleLang}&thumbnail_format=${thumbnailFormat}&trim_start=${trimStart}&trim_end=${trimEnd}&trim_enabled=${trimEnabled}&use_cpu=${useCpu}&download_engine=${encodeURIComponent(effectiveDownloadEngine)}`, undefined, { sensitive: true });
        if (!res.ok) {
          throw new Error(`Download request failed with ${res.status}`);
        }
        const data = await res.json();
        const serverTaskId = data.task_id ?? taskId;
      setQueue(prev => prev.map(q => q.id === taskId ? { ...q, id: serverTaskId, serverId: serverTaskId } : q));
        const interval = setInterval(async () => {
          try {
            const pr = await backendFetch(`${API}/download-status/${serverTaskId}`, undefined, { sensitive: true });
            const pd = await pr.json();
            setQueue(prev => prev.map(q => (q.serverId || q.id) === serverTaskId
              ? {
                  ...q,
                  status: pd.status,
                  percent: pd.percent ?? 0,
                  speed: pd.speed ?? "",
                  eta: pd.eta ?? "",
                  downloaded: pd.downloaded ?? "",
                  total: pd.total ?? "",
                  size: pd.size ?? "",
                  filePath: pd.file_path ?? "",
                  partialFilePath: pd.partial_file_path ?? q.partialFilePath,
                  error: pd.error ?? "",
                  canPause: pd.can_pause ?? q.canPause,
                  bytesDownloaded: pd.bytes_downloaded ?? q.bytesDownloaded,
                  bytesTotal: pd.bytes_total ?? q.bytesTotal,
                  progressMode: pd.progress_mode ?? q.progressMode,
                  stageLabel: pd.stage_label ?? q.stageLabel,
                  variantLabel: pd.variant_label ?? q.variantLabel,
                }
              : q
            ));
            if (["done", "failed", "canceled", "error"].includes(pd.status)) {
              clearInterval(interval); pollingRef.current.delete(serverTaskId);
            }
          } catch (error) {
            clearInterval(interval);
            pollingRef.current.delete(serverTaskId);
            setQueue(prev => prev.map(q => (q.serverId || q.id) === serverTaskId
              ? {
                  ...q,
                  status: "failed",
                  error: error instanceof Error ? error.message : "Could not read live download status.",
                  recoverable: true,
                }
              : q
            ));
          }
        }, 1000);
        pollingRef.current.set(serverTaskId, interval);
      } catch (error) {
        setQueue(prev => prev.map(q => q.id === taskId
          ? {
              ...q,
              status: "failed",
              error: error instanceof Error ? error.message : "Download could not be started.",
              recoverable: true,
            }
          : q
        ));
      }
    }
    setBatchUrls("");
    setBatchMode(false);
  };

  const removeFromQueue = async (item: QueueItem) => {
    const key = item.serverId || item.id;
    const interval = pollingRef.current.get(key);
    if (interval) { clearInterval(interval); pollingRef.current.delete(key); }

    if (item.serverId) {
      try {
        await backendFetch(`${API}/downloads/${item.serverId}`, { method: "DELETE" }, { sensitive: true });
      } catch {
        // Ignore backend delete errors and still remove locally.
      }
    }

    setQueue(prev => prev.filter(q => q.id !== item.id));
  };

  const clearAllQueue = async () => {
    const items = [...queue];
    pollingRef.current.forEach((interval) => clearInterval(interval));
    pollingRef.current.clear();
    await Promise.allSettled(
      items
        .filter((item) => item.serverId)
        .map((item) => backendFetch(`${API}/downloads/${item.serverId}`, { method: "DELETE" }, { sensitive: true }))
    );
    setQueue([]);
  };

  const activeCount = queue.filter(q => q.status === "downloading" || q.status === "queued" || q.status === "processing").length;

  const doAction = async (item: QueueItem, action: string) => {
    if (!item.serverId) return;
    setQueue((prev) =>
      prev.map((entry) =>
        entry.id !== item.id
          ? entry
          : {
              ...entry,
              status:
                action === "pause" ? "paused" :
                action === "resume" ? "downloading" :
                action === "cancel" ? "canceling" :
                entry.status,
            }
      )
    );
    try {
      const response = await backendFetch(`${API}/downloads/${item.serverId}/action?action=${action}`, { method: "POST" }, { sensitive: true });
      if (!response.ok) {
        throw new Error(`Action failed with ${response.status}`);
      }
    } catch {
      setQueue((prev) => prev.map((entry) => entry.id === item.id ? item : entry));
    }
  };

  const doReveal = async (item: QueueItem) => {
    if (!item.filePath) return;
    try {
      const response = await backendFetch(`${API}/open-download-folder?path=${encodeURIComponent(item.filePath)}`, { method: "POST" }, { sensitive: true });
      if (!response.ok) {
        throw new Error(`Open folder failed with ${response.status}`);
      }
    } catch { /* offline */ }
  };

  const FILE_TYPES: { id: FileType; label: string; Icon: React.FC<any> }[] = [
    { id: "video",    label: "Video",     Icon: IconVideo },
    { id: "audio",    label: "Audio",     Icon: IconAudio },
    { id: "thumbnail",label: "Thumbnail", Icon: IconImage },
    { id: "subtitle", label: "Subtitle",  Icon: IconSubtitle },
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
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12 }}
              onClick={() => void clearAllQueue()}
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Scroll area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── URL INPUT CARD ── */}
        <div className="card card-padded">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: 0.5, textTransform: "uppercase" }}>
              {batchMode ? "Batch URLs" : "Video URL"}
            </div>
            <button
              className={`btn btn-ghost`}
              style={{ fontSize: 11, padding: "3px 10px" }}
              onClick={() => { setBatchMode(v => !v); setInfo(null); setStatus("idle"); }}
            >
              {batchMode ? "Single URL" : "Batch / Multiple"}
            </button>
          </div>

          {batchMode ? (
            /* ── BATCH INPUT ── */
            <div>
              <textarea
                className="input-base"
                style={{ width: "100%", minHeight: 110, padding: "10px 14px", resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12 }}
                placeholder={"Paste one URL per line:\nhttps://youtube.com/watch?v=...\nhttps://youtube.com/watch?v=..."}
                value={batchUrls}
                onChange={e => setBatchUrls(e.target.value)}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                <button
                  className="btn btn-ghost"
                  onClick={handleBatchPasteBtn}
                  style={{ height: 36 }}
                >
                  <IconPaste size={14} />
                  Paste
                </button>
                <button
                  className="btn btn-primary"
                  onClick={startBatch}
                  disabled={!batchUrls.trim()}
                  style={{ height: 36 }}
                >
                  <IconDownload size={14} />
                  Queue All ({batchUrls.split("\n").filter(u => u.trim()).length} URLs)
                </button>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Each URL is queued immediately at current settings below
                </span>
              </div>
            </div>
          ) : (
            /* ── SINGLE URL INPUT ── */
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

              {/* Error */}
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
          )}
        </div>

        {/* ── PREVIEW CARD ── */}
        {status === "ok" && info && (
          <div className="card card-padded fade-in">
            <div style={{ display: "flex", gap: 14, marginBottom: 16 }}>
              {/* Thumbnail */}
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

              {/* Meta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4, marginBottom: 4 }}>{info.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                  <IconClock size={12} />
                  {secs(info.duration)}
                  {info.uploader && <> · {info.uploader}</>}
                </div>
                {/* Source badge */}
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
            <div style={{ marginBottom: 14 }} className="fade-in">
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>
                Download Engine
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  className={`quality-chip${(fileType === "thumbnail" || fileType === "subtitle" || downloadEngine === "standard") ? " active" : ""}`}
                  onClick={() => setDownloadEngine("standard")}
                >
                  Standard (stable)
                </button>
                {fileType !== "thumbnail" && fileType !== "subtitle" && (
                  <button
                    className={`quality-chip${downloadEngine === "aria2" ? " active" : ""}`}
                    onClick={() => setDownloadEngine("aria2")}
                  >
                    aria2 (fast)
                  </button>
                )}
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                {fileType === "thumbnail" || fileType === "subtitle"
                  ? "Small files always use the Standard downloader so GRABIX can keep them simple and reliable."
                  : aria2Available
                  ? "aria2 is best for direct-file downloads. GRABIX automatically falls back to Standard for unsupported cases."
                  : "aria2 is not installed right now, so Standard remains the active downloader."}
              </div>
              {visibleDependencies.length > 0 && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  {visibleDependencies.map((dependency) => (
                    <div key={dependency.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 10px", background: "var(--bg-surface2)", borderRadius: 10 }}>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{dependency.label}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                          {dependency.available ? (dependency.path || "Installed") : (dependency.description || "Not installed")}
                        </div>
                        {dependency.job?.message && (
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{dependency.job.message}</div>
                        )}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: dependency.available ? "var(--text-success)" : "var(--text-warning)" }}>
                        {dependency.available ? "Installed" : (dependency.job?.status === "installing" ? "Installing..." : dependency.job?.status === "failed" ? "Install failed" : "Missing")}
                      </span>
                      {!dependency.available && dependency.install_supported !== false && dependency.job?.status !== "installing" && (
                        <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => void installDependency(dependency.id)}>
                          {dependency.job?.status === "failed" ? "Retry install" : "Install"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

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

            {/* ── AUDIO FORMAT (Audio only) ── */}
            {fileType === "audio" && (
              <div style={{ marginBottom: 14 }} className="fade-in">
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>
                  Audio Format
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(["mp3", "m4a", "opus", "flac", "wav"] as const).map(fmt => (
                    <button
                      key={fmt}
                      className={`quality-chip${audioFormat === fmt ? " active" : ""}`}
                      onClick={() => setAudioFormat(fmt)}
                    >
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── SUBTITLE LANGUAGE (Subtitle only) ── */}
            {fileType === "subtitle" && (
              <div style={{ marginBottom: 14 }} className="fade-in">
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>
                  Language
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[
                    { code: "en", label: "English" },
                    { code: "es", label: "Spanish" },
                    { code: "fr", label: "French" },
                    { code: "de", label: "German" },
                    { code: "ja", label: "Japanese" },
                    { code: "zh", label: "Chinese" },
                    { code: "ar", label: "Arabic" },
                    { code: "pt", label: "Portuguese" },
                    { code: "ur", label: "Urdu" },
                  ].map(({ code, label }) => (
                    <button
                      key={code}
                      className={`quality-chip${subtitleLang === code ? " active" : ""}`}
                      onClick={() => setSubtitleLang(code)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {fileType === "thumbnail" && (
              <div style={{ marginBottom: 14 }} className="fade-in">
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" }}>
                  Thumbnail Format
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(["jpg", "png", "webp"] as const).map((format) => (
                    <button
                      key={format}
                      className={`quality-chip${thumbnailFormat === format ? " active" : ""}`}
                      onClick={() => setThumbnailFormat(format)}
                    >
                      {format.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── TRIM TOGGLE + PANEL (Video only) ── */}
            {fileType === "video" && (
              <div className="fade-in" style={{ marginBottom: 14 }}>
                {/* Toggle button row */}
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

                {/* Collapsible trim panel */}
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
              <button className="btn btn-primary" style={{ height: 40, paddingLeft: 20, paddingRight: 20, fontSize: 14 }} onClick={startDownload}>
                <IconDownload size={15} />
                Download {fileType === "video" ? quality : fileType}
                {fileType === "video" && trimOpen && trimEnd - trimStart < info.duration && ` (${secs(trimEnd - trimStart)})`}
              </button>

              {/* CPU mode buttons — only relevant when trim is active */}
              {fileType === "video" && trimOpen && (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {/* No CPU button */}
                  <div className="tooltip-wrap">
                    <button
                      className={`quality-chip${!useCpu ? " active" : ""}`}
                      style={{ fontSize: 11, gap: 5 }}
                      onClick={() => setUseCpu(false)}
                    >
                      No CPU
                    </button>
                    <span className="tooltip-box" style={{ width: 190, whiteSpace: "normal", lineHeight: 1.5 }}>
                      ✅ Recommended. Instant, no re-encode. Trim snaps to nearest keyframe (±2s). No FFmpeg needed.
                    </span>
                  </div>
                  {/* With CPU button */}
                  <div className="tooltip-wrap">
                    <button
                      className={`quality-chip${useCpu ? " active" : ""}`}
                      style={{ fontSize: 11, gap: 5 }}
                      onClick={() => setUseCpu(true)}
                    >
                      With CPU
                    </button>
                    <span className="tooltip-box" style={{ width: 190, whiteSpace: "normal", lineHeight: 1.5 }}>
                      Frame-accurate trim. Re-encodes with FFmpeg — slower, uses CPU. Requires FFmpeg installed.
                    </span>
                  </div>
                </div>
              )}

              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {fileType === "video" && `Saves as MP4 · ${quality}`}
                {fileType === "audio" && `Saves as ${audioFormat.toUpperCase()} · 192kbps`}
                {fileType === "thumbnail" && `Saves as ${thumbnailFormat.toUpperCase()}`}
                {fileType === "subtitle" && `Saves as available subtitle · ${subtitleLang.toUpperCase()}`}
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
              {queue.map((item) => <QueueCard key={item.id} item={item} onRemove={removeFromQueue} onAction={doAction} onReveal={doReveal} />)}
            </div>
          </div>
        )}

        {/* ── EMPTY STATE ── */}
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

function QueueCard({
  item, onRemove, onAction, onReveal,
}: {
  item: QueueItem;
  onRemove: (item: QueueItem) => void | Promise<void>;
  onAction: (item: QueueItem, action: string) => void;
  onReveal: (item: QueueItem) => void;
}) {
  const [showProps, setShowProps] = useState(false);

  const isActive   = item.status === "downloading" || item.status === "queued" || item.status === "processing";
  const isPaused   = item.status === "paused";
  const isDone     = item.status === "done";
  const isFailed   = item.status === "failed" || item.status === "error" || item.status === "canceled";

  const statusColors: Record<string, string> = {
    done: "var(--success)", failed: "var(--danger)", error: "var(--danger)", canceled: "var(--text-muted)",
    downloading: "var(--accent)", processing: "var(--warning)", queued: "var(--text-muted)", paused: "var(--warning)",
    canceling: "var(--text-muted)",
  };
  const statusLabels: Record<string, string> = {
    done: "Done", failed: "Failed", error: "Failed", canceled: "Canceled",
    downloading: "Downloading", processing: "Processing…", queued: "Queued", paused: "Paused",
    canceling: "Canceling…",
  };
  const statusLabel =
    item.status === "paused" && item.recoverable
      ? "Paused for recovery"
      : item.status === "failed" && item.recoverable
        ? "Needs retry"
        : (statusLabels[item.status] ?? item.status);

  // Clean up raw speed string: strip ANSI codes and extra whitespace
  const cleanSpeed = formatDisplaySpeed(item.speed);
  const progressMode = item.progressMode || (item.status === "processing" ? "processing" : item.total ? "determinate" : "activity");
  const showProcessingProgress = progressMode === "processing";
  const showDeterminateProgress = progressMode === "determinate" && !showProcessingProgress;
  const activityBytes = item.bytesDownloaded || parseDisplayedBytes(item.downloaded || item.size);
  const activityFillPercent = activityBytes > 0
    ? Math.min(92, Math.max(12, 92 * (1 - Math.exp(-activityBytes / (96 * 1024 * 1024)))))
    : 28;
  const progressLabel = showDeterminateProgress
    ? `${item.percent}%`
    : item.stageLabel || (showProcessingProgress ? "Processing" : item.status === "queued" ? "Queued" : "Downloading");
  const statsSummary = [
    showDeterminateProgress ? progressLabel : item.stageLabel || "",
    cleanSpeed || "",
    item.eta && item.eta !== "0s" ? `${item.eta} remaining` : "",
  ].filter(Boolean).join(" — ");

  return (
    <div className="card fade-in" style={{ padding: "12px 14px" }}>
      {/* ── Row 1: thumbnail + title + action buttons ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <img src={item.thumbnail || "https://via.placeholder.com/96x64?text=DL"} alt="" style={{ width: 48, height: 32, objectFit: "cover", borderRadius: 5, flexShrink: 0, border: "1px solid var(--border)", background: "var(--bg-surface2)" }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
            <span style={{ fontSize: 11, color: statusColors[item.status] ?? "var(--text-muted)", fontWeight: 600 }}>
              {statusLabel}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.format.toUpperCase()}</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.downloadEngine === "aria2" ? "aria2" : "Standard"}</span>
          </div>
          {item.engineNote && (
            <div style={{ marginTop: 3, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
              {item.engineNote}
            </div>
          )}
          {statsSummary && (isActive || isPaused) && (
            <div style={{ marginTop: 3, fontSize: 11, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {statsSummary}
            </div>
          )}
        </div>

        {/* ── Action buttons ── */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
          {/* Pause — only while downloading */}
          {isActive && item.canPause && item.status !== "queued" && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onAction(item, "pause")}>
                <IconPause size={13} />
              </button>
              <span className="tooltip-box">Pause</span>
            </div>
          )}
          {/* Resume — only while paused */}
          {isPaused && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onAction(item, "resume")}>
                <IconPlay size={13} />
              </button>
              <span className="tooltip-box">Resume</span>
            </div>
          )}
          {/* Stop — while active or paused */}
          {(isActive || isPaused) && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28, color: "var(--text-danger)" }} onClick={() => onAction(item, "cancel")}>
                <IconStop size={13} />
              </button>
              <span className="tooltip-box">Stop</span>
            </div>
          )}
          {/* Retry — only when failed/canceled */}
          {isFailed && item.serverId && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onAction(item, "retry")}>
                <IconRefresh size={13} />
              </button>
              <span className="tooltip-box">Retry</span>
            </div>
          )}
          {/* Reveal in Explorer — always when done; backend falls back to DOWNLOAD_DIR if no file path */}
          {isDone && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onReveal(item)}>
                <IconFolder size={13} />
              </button>
              <span className="tooltip-box">Reveal in Explorer</span>
            </div>
          )}
          {/* Properties — show inline details */}
          {(isDone || isFailed) && (
            <div className="tooltip-wrap">
              <button className={`btn-icon${showProps ? " active" : ""}`} style={{ width: 28, height: 28 }} onClick={() => setShowProps(v => !v)}>
                <IconInfo size={13} />
              </button>
              <span className="tooltip-box">Properties</span>
            </div>
          )}
          {/* Remove */}
          <div className="tooltip-wrap">
            <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => void onRemove(item)}>
              <IconX size={13} />
            </button>
            <span className="tooltip-box">Remove</span>
          </div>
        </div>
      </div>

      {/* ── Row 2: Progress bar + stats ── */}
      {(isActive || isPaused) && (
        <div style={{ marginTop: 10 }}>
          {/* Progress bar */}
          <div className="progress-bar-bg">
            <div
              className={`progress-bar-fill${showProcessingProgress ? " indeterminate" : ""}`}
              style={{ width: showDeterminateProgress ? `${item.percent}%` : `${activityFillPercent}%`, opacity: isPaused ? 0.5 : 1 }}
            />
          </div>
          {/* Stats row */}
          <div style={{ display: "flex", alignItems: "center", gap: 0, marginTop: 6 }}>
            {/* Percent pill */}
            <span style={{
              fontSize: 11, fontWeight: 700, color: "var(--text-accent)",
              background: "var(--accent-light)", padding: "2px 7px", borderRadius: 99, marginRight: 8,
            }}>
              {progressLabel}
            </span>
            {/* Downloaded / Total */}
            {item.downloaded && (
              <span style={{ fontSize: 11, color: "var(--text-secondary)", marginRight: 6 }}>
                {item.downloaded}{item.total ? ` / ${item.total}` : ""}
              </span>
            )}
            {/* Speed */}
            {cleanSpeed && (
              <span style={{
                fontSize: 11, fontWeight: 600, color: "var(--text-primary)",
                background: "var(--bg-surface2)", padding: "1px 6px", borderRadius: 5, marginRight: 6,
              }}>
                ↓ {cleanSpeed}
              </span>
            )}
            {/* ETA */}
            {item.eta && item.eta !== "0s" && (
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto", display: "flex", alignItems: "center", gap: 3 }}>
                <IconClock size={11} /> {item.eta}
              </span>
            )}
          </div>
          {/* File path while downloading */}
          {item.filePath && (
            <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.filePath}
            </div>
          )}
        </div>
      )}

      {/* ── Done: compact summary ── */}
      {isDone && (
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-success)" }}>
          <IconCheck size={12} />
          <span>Download complete</span>
          {item.total && <span style={{ color: "var(--text-muted)" }}>· {item.total}</span>}
        </div>
      )}

      {/* ── Error message ── */}
      {(item.status === "error" || item.status === "failed") && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-danger)", display: "flex", alignItems: "center", gap: 5 }}>
          <IconAlert size={13} /> {item.error || "Download failed. Try again."}
        </div>
      )}

      {item.status === "paused" && item.recoverable && item.error && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-warning)", display: "flex", alignItems: "center", gap: 5 }}>
          <IconAlert size={13} /> {item.error}
        </div>
      )}

      {/* ── Properties panel (inline toggle) ── */}
      {showProps && (
        <div style={{
          marginTop: 10, padding: "10px 12px",
          background: "var(--bg-surface2)", borderRadius: "var(--radius-sm)",
          fontSize: 11, color: "var(--text-secondary)",
          display: "flex", flexDirection: "column", gap: 5,
        }}>
          {[
            ["Type",   item.fileType.charAt(0).toUpperCase() + item.fileType.slice(1)],
            ["Format", item.format.toUpperCase()],
            ["Status", statusLabel],
            ["Recovery", item.recoverable ? "Yes" : "No"],
            ["Retries", String(item.retryCount || 0)],
            ["Size",   item.total || item.size || "—"],
            ["Path",   item.filePath || "—"],
            ["Partial", item.partialFilePath || "—"],
            ["URL",    item.url || "—"],
          ].map(([label, value]) => (
            <div key={label} style={{ display: "flex", gap: 0 }}>
              <span style={{ color: "var(--text-muted)", minWidth: 54, flexShrink: 0 }}>{label}</span>
              <span style={{ wordBreak: "break-all", color: "var(--text-primary)" }}>{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
