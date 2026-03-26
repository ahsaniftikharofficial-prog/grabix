import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

type Page = "downloader" | "settings";
type DLType = "video" | "audio" | "thumbnail" | "subtitle";
type DownloaderMode = "single" | "batch";

interface VideoFormat { height: number; label: string; }
interface VideoInfo { valid: boolean; title?: string; thumbnail?: string; duration?: number; channel?: string; error?: string; formats?: VideoFormat[]; }
interface QueueItem { id: string; status: string; percent: number; speed: string; eta: string; downloaded?: string; total?: string; size?: string; title: string; error?: string; file_path?: string; folder?: string; created_at?: string; dl_type?: string; }
interface HistoryItem { id: string; title: string; dl_type: string; status: string; file_path?: string; created_at?: string; }
interface BatchItem { id: string; url: string; normalizedUrl: string; fetchState: "idle" | "loading" | "ready" | "error"; info: VideoInfo | null; quality: string; trimEnabled: boolean; trimStart: number; trimEnd: number; }

const B = "http://127.0.0.1:8000";
const AUTO_PREVIEW_DELAY_MS = 150;
const ACTIVE_POLL_MS = 1200;
const ASSET_ORDER: DLType[] = ["video", "audio", "thumbnail", "subtitle"];

function normalizeUrl(input: string) { return input.trim(); }
function formatTimestamp(totalSeconds: number) { const safe = Math.max(0, Math.floor(totalSeconds)); const hours = Math.floor(safe / 3600); const minutes = Math.floor((safe % 3600) / 60); const seconds = safe % 60; if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`; return `${minutes}:${String(seconds).padStart(2, "0")}`; }
function toTimestampField(totalSeconds: number) { const safe = Math.max(0, Math.floor(totalSeconds)); const hours = Math.floor(safe / 3600); const minutes = Math.floor((safe % 3600) / 60); const seconds = safe % 60; return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`; }
function parseTimestampField(value: string) { const parts = value.trim().split(":").map(Number); if (parts.length === 0 || parts.some(Number.isNaN)) return null; if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]); if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]); if (parts.length === 1) return Math.max(0, parts[0]); return null; }
function getQualityLabel(height: number) { if (height >= 4320) return "8K"; if (height >= 2880) return "5K"; if (height >= 2160) return "4K"; return `${height}p`; }
function getAvailableQualities(info: VideoInfo | null) { return [...(info?.formats || [])].filter((f) => Boolean(f.height)).sort((a, b) => b.height - a.height).filter((f, index, list) => list.findIndex((entry) => entry.height === f.height) === index); }
function getDefaultTrimEnd(duration?: number) { if (!duration || duration <= 0) return 60; return Math.min(duration, Math.max(30, Math.min(120, Math.floor(duration * 0.25)))); }
function parseBatchUrls(text: string) { return text.split(/\r?\n/).map(normalizeUrl).filter(Boolean).filter((entry, index, list) => list.indexOf(entry) === index); }

function Glyph({ path, size = 16 }: { path: ReactNode; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{path}</svg>;
}

function IconButton({ title, onClick, children, disabled = false }: { title: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button title={title} onClick={onClick} disabled={disabled} style={{ width: "34px", height: "34px", borderRadius: "12px", border: "1px solid rgba(148,163,184,0.24)", background: "rgba(255,255,255,0.72)", color: "#1e293b", display: "grid", placeItems: "center", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, backdropFilter: "blur(12px)" }}>
      {children}
    </button>
  );
}

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", userSelect: "none" }}>
      <div style={{ width: "48px", height: "48px", borderRadius: "18px", display: "grid", placeItems: "center", background: "linear-gradient(140deg,#0f172a 0%,#334155 100%)", boxShadow: "0 14px 32px rgba(15,23,42,0.18)" }}>
        <span style={{ fontSize: "24px", fontWeight: 900, color: "#f8fafc", letterSpacing: "-0.08em" }}>G</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <span style={{ fontSize: "18px", fontWeight: 900, color: "#0f172a", letterSpacing: "0.18em" }}>GRABIX</span>
        <span style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.22em", color: "#64748b", fontWeight: 700 }}>Media Desktop</span>
      </div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <button onClick={() => onChange(!value)} style={{ width: "40px", height: "22px", borderRadius: "999px", border: "none", cursor: "pointer", position: "relative", background: value ? "#2563eb" : "#cbd5e1" }}><span style={{ position: "absolute", top: "3px", left: value ? "21px" : "3px", width: "16px", height: "16px", borderRadius: "50%", background: "#fff", transition: "left 0.16s ease", boxShadow: "0 2px 6px rgba(15,23,42,0.18)" }} /></button>;
}

function Segmented({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: { id: string; label: string }[] }) {
  return <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px", borderRadius: "16px", background: "rgba(255,255,255,0.78)", border: "1px solid rgba(148,163,184,0.22)", backdropFilter: "blur(12px)" }}>{options.map((option) => { const active = value === option.id; return <button key={option.id} onClick={() => onChange(option.id)} style={{ border: "none", cursor: "pointer", padding: "10px 14px", borderRadius: "12px", background: active ? "#0f172a" : "transparent", color: active ? "#fff" : "#475569", fontSize: "13px", fontWeight: 700 }}>{option.label}</button>; })}</div>;
}

function PreviewSkeleton() {
  const style = { background: "linear-gradient(90deg,#e2e8f0 0%,#f8fafc 50%,#e2e8f0 100%)", backgroundSize: "240% 100%", animation: "grabixPulse 1.4s linear infinite" } as CSSProperties;
  return <div style={{ display: "flex", gap: "14px", alignItems: "center", padding: "8px 0" }}><div style={{ width: "148px", height: "84px", borderRadius: "18px", ...style }} /><div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}><div style={{ width: "58%", height: "14px", borderRadius: "999px", ...style }} /><div style={{ width: "28%", height: "12px", borderRadius: "999px", ...style }} /><div style={{ width: "35%", height: "12px", borderRadius: "999px", ...style }} /></div></div>;
}

function DualTrim({ duration, start, end, onChangeStart, onChangeEnd, muted, accent, inputStyle }: { duration: number; start: number; end: number; onChangeStart: (value: number) => void; onChangeEnd: (value: number) => void; muted: string; accent: string; inputStyle: CSSProperties }) {
  const safeDuration = Math.max(1, duration);
  const startPct = (start / safeDuration) * 100;
  const endPct = (end / safeDuration) * 100;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div><label style={{ display: "block", marginBottom: "6px", fontSize: "11px", color: muted }}>Start</label><input type="text" inputMode="numeric" value={toTimestampField(start)} onChange={(e) => { const parsed = parseTimestampField(e.target.value); if (parsed === null) return; onChangeStart(Math.min(parsed, Math.max(0, end - 1))); }} style={{ ...inputStyle, width: "100%", fontFamily: "monospace" }} /></div>
        <div><label style={{ display: "block", marginBottom: "6px", fontSize: "11px", color: muted }}>End</label><input type="text" inputMode="numeric" value={toTimestampField(end)} onChange={(e) => { const parsed = parseTimestampField(e.target.value); if (parsed === null) return; onChangeEnd(Math.max(start + 1, Math.min(parsed, safeDuration))); }} style={{ ...inputStyle, width: "100%", fontFamily: "monospace" }} /></div>
      </div>
      <div style={{ position: "relative", height: "46px", paddingTop: "18px" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: "24px", height: "6px", borderRadius: "999px", background: "rgba(148,163,184,0.18)" }} />
        <div style={{ position: "absolute", top: "24px", left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%`, height: "6px", borderRadius: "999px", background: accent, boxShadow: "0 0 18px rgba(37,99,235,0.18)" }} />
        <input type="range" min={0} max={safeDuration} value={start} onChange={(e) => onChangeStart(Math.min(Number(e.target.value), Math.max(0, end - 1)))} style={{ position: "absolute", left: 0, top: "9px", width: "100%", appearance: "none", background: "transparent", accentColor: accent }} />
        <input type="range" min={0} max={safeDuration} value={end} onChange={(e) => onChangeEnd(Math.max(start + 1, Math.min(Number(e.target.value), safeDuration)))} style={{ position: "absolute", left: 0, top: "9px", width: "100%", appearance: "none", background: "transparent", accentColor: accent }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "18px", fontSize: "11px", color: muted, fontFamily: "monospace" }}><span>{formatTimestamp(start)}</span><span>{formatTimestamp(end)}</span></div>
      </div>
    </div>
  );
}

function AssetPicker({ selected, onToggle, muted, activeBg, idleBg, activeColor, idleColor }: { selected: DLType[]; onToggle: (type: DLType) => void; muted: string; activeBg: string; idleBg: string; activeColor: string; idleColor: string; }) {
  const items = [{ id: "video" as DLType, label: "Video" }, { id: "audio" as DLType, label: "Audio" }, { id: "thumbnail" as DLType, label: "Thumb" }, { id: "subtitle" as DLType, label: "Subs" }];
  return <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><span style={{ fontSize: "11px", color: muted }}>Assets</span><div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>{items.map((item) => { const active = selected.includes(item.id); return <button key={item.id} onClick={() => onToggle(item.id)} style={{ border: "none", cursor: "pointer", padding: "10px 14px", borderRadius: "14px", background: active ? activeBg : idleBg, color: active ? activeColor : idleColor, fontWeight: 800, fontSize: "12px" }}>{item.label}</button>; })}</div></div>;
}

export default function App() {
  const [page, setPage] = useState<Page>("downloader");
  const [dark, setDark] = useState(false);
  const [mode, setMode] = useState<DownloaderMode>("single");
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<DLType[]>(["video"]);
  const [quality, setQuality] = useState("best");
  const [audioFmt, setAudioFmt] = useState("mp3");
  const [audioQ, setAudioQ] = useState("192");
  const [subLang, setSubLang] = useState("en");
  const [thumbFmt, setThumbFmt] = useState("jpg");
  const [trim, setTrim] = useState(false);
  const [trimS, setTrimS] = useState(0);
  const [trimE, setTrimE] = useState(60);
  const [batchText, setBatchText] = useState("");
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchFetching, setBatchFetching] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [downloadsList, setDownloadsList] = useState<QueueItem[]>([]);
  const [queueExpanded, setQueueExpanded] = useState(true);
  const [folderActionMsg, setFolderActionMsg] = useState("");
  const [settings, setSettings] = useState({ folder: "~/Downloads/GRABIX", maxConcurrent: 3, naming: "%(title)s.%(ext)s", defaultQ: "best", defaultAudio: "mp3", autoPaste: true, notify: true, embedThumb: true, embedSubs: false, proxy: false });
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewCacheRef = useRef<Record<string, VideoInfo>>({});
  const previewRequestIdRef = useRef(0);

  const c = { bg: dark ? "#070710" : "#eef2f7", side: dark ? "#0a0a16" : "rgba(255,255,255,0.76)", sideBrd: dark ? "#14142a" : "rgba(148,163,184,0.22)", tx: dark ? "#e8e8f4" : "#0f172a", muted: dark ? "#8181a7" : "#64748b", line: dark ? "rgba(80,88,122,0.26)" : "rgba(148,163,184,0.18)", surface: dark ? "#0f1720" : "rgba(255,255,255,0.72)", input: dark ? "#090915" : "rgba(255,255,255,0.9)", inputBorder: dark ? "rgba(71,85,105,0.38)" : "rgba(148,163,184,0.22)", blue: "#2563eb", green: "#16a34a", red: "#dc2626", amber: "#f59e0b" };
  const inputStyle: CSSProperties = { background: c.input, border: `1px solid ${c.inputBorder}`, color: c.tx, borderRadius: "14px", padding: "12px 14px", fontSize: "13px", outline: "none", boxShadow: dark ? "none" : "0 16px 44px rgba(148,163,184,0.08)" };

  const navItems = [
    { id: "downloader" as Page, label: "Downloader", icon: <Glyph path={<><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 20h16" /></>} /> },
    { id: "settings" as Page, label: "Settings", icon: <Glyph path={<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>} /> },
  ];
  const availableQualities = useMemo(() => getAvailableQualities(info), [info]);
  const activeQueueItems = downloadsList.filter((item) => !["done", "failed", "canceled"].includes(item.status));
  const completedQueueItems = downloadsList.filter((item) => ["done", "failed", "canceled"].includes(item.status));
  const currentActive = activeQueueItems[0] || null;
  const batchReadyCount = batchItems.filter((item) => item.info?.valid).length;

  const toggleAsset = (type: DLType) => setSelectedAssets((prev) => {
    if (prev.includes(type)) return prev.length === 1 ? prev : prev.filter((entry) => entry !== type);
    return [...prev, type].sort((a, b) => ASSET_ORDER.indexOf(a) - ASSET_ORDER.indexOf(b));
  });

  const fetchQueue = async () => {
    try {
      const [historyRes, downloadsRes] = await Promise.all([fetch(`${B}/history`), fetch(`${B}/downloads`)]);
      setHistory(await historyRes.json());
      setDownloadsList(await downloadsRes.json());
    } catch {}
  };

  useEffect(() => {
    if (page !== "downloader") return;
    void fetchQueue();
    const timer = setInterval(() => void fetchQueue(), ACTIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [page]);

  const fetchPreview = async (rawUrl: string) => {
    const cleaned = normalizeUrl(rawUrl);
    if (!cleaned) return;
    const requestId = ++previewRequestIdRef.current;
    const cached = previewCacheRef.current[cleaned];
    if (cached) { setInfo(cached); setLoading(false); return; }
    setLoading(true);
    setInfo(null);
    try {
      const response = await fetch(`${B}/check-link?url=${encodeURIComponent(cleaned)}`);
      const data: VideoInfo = await response.json();
      if (requestId !== previewRequestIdRef.current) return;
      if (data.valid) {
        previewCacheRef.current[cleaned] = data;
        setInfo(data);
        const formats = getAvailableQualities(data);
        setQuality(formats[0] ? `${formats[0].height}p` : "best");
        if (data.duration) { setTrimS(0); setTrimE(getDefaultTrimEnd(data.duration)); }
      } else {
        setInfo(data);
      }
    } catch {
      if (requestId !== previewRequestIdRef.current) return;
      setInfo({ valid: false, error: "Cannot connect to backend. Run: uvicorn main:app --reload" });
    } finally {
      if (requestId === previewRequestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== "single") return;
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    const cleaned = normalizeUrl(url);
    if (!cleaned) { setInfo(null); setLoading(false); return; }
    if (!/^https?:\/\//i.test(cleaned)) return;
    previewTimerRef.current = setTimeout(() => { void fetchPreview(cleaned); }, AUTO_PREVIEW_DELAY_MS);
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); };
  }, [url, mode]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (mode === "single") setUrl(text);
      else setBatchText((prev) => prev ? `${prev}\n${text}` : text);
    } catch {}
  };

  const openDownloadFolder = async (path = "") => {
    setFolderActionMsg("");
    try {
      const response = await fetch(`${B}/open-download-folder?path=${encodeURIComponent(path)}`, { method: "POST" });
      if (!response.ok) { const err = await response.json(); throw new Error(err.detail || "Could not open folder"); }
      setFolderActionMsg("Opened in Explorer.");
    } catch (error) {
      setFolderActionMsg(error instanceof Error ? error.message : "Could not open folder.");
    }
  };

  const runDownloadAction = async (id: string, action: "pause" | "resume" | "cancel" | "retry") => {
    try { await fetch(`${B}/downloads/${id}/action?action=${action}`, { method: "POST" }); await fetchQueue(); } catch {}
  };

  const stopAllDownloads = async () => {
    try { await fetch(`${B}/downloads/stop-all`, { method: "POST" }); await fetchQueue(); } catch {}
  };

  const enqueueDownload = async (downloadUrl: string, type: DLType, opts?: { quality?: string; trimEnabled?: boolean; trimStart?: number; trimEnd?: number; }) => {
    const params = new URLSearchParams({
      url: downloadUrl,
      dl_type: type,
      quality: opts?.quality ?? quality,
      audio_format: audioFmt,
      audio_quality: audioQ,
      subtitle_lang: subLang,
      thumbnail_format: thumbFmt,
      trim_enabled: String(type === "video" && Boolean(opts?.trimEnabled)),
      trim_start: String(type === "video" ? opts?.trimStart ?? trimS : 0),
      trim_end: String(type === "video" ? opts?.trimEnd ?? trimE : 0),
    });
    await fetch(`${B}/download?${params.toString()}`, { method: "POST" });
  };

  const handleSingleDownload = async () => {
    if (!info?.valid) return;
    for (const type of selectedAssets) {
      await enqueueDownload(normalizeUrl(url), type, { quality, trimEnabled: trim, trimStart: trimS, trimEnd: trimE });
    }
    setQueueExpanded(true);
    await fetchQueue();
  };

  const fetchBatchData = async () => {
    const urls = parseBatchUrls(batchText);
    setBatchItems(urls.map((normalizedUrl) => ({ id: crypto.randomUUID(), url: normalizedUrl, normalizedUrl, fetchState: "loading", info: null, quality: "best", trimEnabled: false, trimStart: 0, trimEnd: 60 })));
    if (urls.length === 0) return;
    setBatchFetching(true);
    for (const normalizedUrl of urls) {
      const cached = previewCacheRef.current[normalizedUrl];
      let data: VideoInfo;
      try {
        data = cached || await fetch(`${B}/check-link?url=${encodeURIComponent(normalizedUrl)}`).then((r) => r.json());
        if (data.valid) previewCacheRef.current[normalizedUrl] = data;
      } catch {
        data = { valid: false, error: "Preview failed" };
      }
      const qualities = getAvailableQualities(data);
      setBatchItems((prev) => prev.map((item) => item.normalizedUrl !== normalizedUrl ? item : { ...item, fetchState: data.valid ? "ready" : "error", info: data, quality: qualities[0] ? `${qualities[0].height}p` : "best", trimStart: 0, trimEnd: data.valid ? getDefaultTrimEnd(data.duration) : item.trimEnd }));
    }
    setBatchFetching(false);
  };

  const handleBatchDownload = async () => {
    const validItems = batchItems.filter((item) => item.info?.valid);
    for (const item of validItems) {
      for (const type of selectedAssets) {
        await enqueueDownload(item.normalizedUrl, type, { quality: type === "video" ? item.quality || quality : quality, trimEnabled: item.trimEnabled, trimStart: item.trimStart, trimEnd: item.trimEnd });
      }
    }
    setQueueExpanded(true);
    await fetchQueue();
  };

  useEffect(() => {
    if (mode !== "single" || !selectedAssets.includes("video") || quality === "best") return;
    if (!availableQualities.some((entry) => `${entry.height}p` === quality)) setQuality("best");
  }, [mode, selectedAssets, quality, availableQualities]);

  const queueRows = [...activeQueueItems, ...completedQueueItems];
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: dark ? "#070710" : "linear-gradient(180deg,#f8fafc 0%,#eef2f7 100%)", color: c.tx, fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif" }}>
      <style>{`
        @keyframes grabixPulse {0% { background-position: 0% 50%; }100% { background-position: 240% 50%; }}
        @keyframes queueShimmer {0% { background-position: 0 0; }100% { background-position: 60px 0; }}
      `}</style>
      <aside style={{ width: "228px", flexShrink: 0, display: "flex", flexDirection: "column", background: c.side, borderRight: `1px solid ${c.sideBrd}`, backdropFilter: "blur(16px)" }}>
        <div style={{ padding: "22px 18px 16px" }}><Logo /></div>
        <nav style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "6px 10px", flex: 1 }}>
          {navItems.map((item) => { const active = page === item.id; return <button key={item.id} onClick={() => setPage(item.id)} style={{ border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "10px", width: "100%", textAlign: "left", padding: "11px 12px", borderRadius: "14px", background: active ? "#0f172a" : "transparent", color: active ? "#fff" : c.muted, fontSize: "13px", fontWeight: active ? 700 : 600 }}>{item.icon}{item.label}</button>; })}
        </nav>
        <div style={{ padding: "10px", borderTop: `1px solid ${c.sideBrd}` }}>
          <button onClick={() => setDark((prev) => !prev)} style={{ width: "100%", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "10px", padding: "11px 12px", borderRadius: "14px", background: "transparent", color: c.muted, fontSize: "13px", fontWeight: 600 }}>
            <Glyph path={dark ? <><circle cx="12" cy="12" r="5" /><path d="M12 1v2" /><path d="M12 21v2" /><path d="m4.22 4.22 1.42 1.42" /><path d="m18.36 18.36 1.42 1.42" /><path d="M1 12h2" /><path d="M21 12h2" /></> : <path d="M21 12.79A9 9 0 1 1 11.21 3c0 5.04 4.1 9.14 9.14 9.79Z" />} />
            {dark ? "Light Mode" : "Dark Mode"}
          </button>
        </div>
      </aside>
      <main style={{ flex: 1, padding: "34px 30px 40px" }}>
        {page === "downloader" ? (
          <div style={{ maxWidth: "1280px", margin: "0 auto", width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "18px", marginBottom: "18px", flexWrap: "wrap" }}>
              <div><h1 style={{ margin: 0, fontSize: "24px", fontWeight: 800 }}>Downloader</h1><p style={{ margin: "6px 0 0", fontSize: "13px", color: c.muted }}>Core GRABIX flow. Fast input, real queue, minimal controls.</p></div>
              <Segmented value={mode} onChange={(value) => setMode(value as DownloaderMode)} options={[{ id: "single", label: "Single" }, { id: "batch", label: "Batch" }]} />
            </div>

            {mode === "single" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "8px", alignItems: "center" }}>
                  <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void fetchPreview(url)} placeholder="Paste a video URL" style={{ ...inputStyle, padding: "15px 16px", fontSize: "14px" }} />
                  <button onClick={handlePaste} style={{ border: `1px solid ${c.inputBorder}`, cursor: "pointer", borderRadius: "14px", background: c.surface, color: c.tx, fontWeight: 700, padding: "14px 16px" }}>Paste</button>
                  <button onClick={() => void fetchPreview(url)} disabled={!normalizeUrl(url)} style={{ border: "none", cursor: !normalizeUrl(url) ? "not-allowed" : "pointer", borderRadius: "14px", background: c.blue, color: "#fff", fontWeight: 800, padding: "14px 18px", opacity: !normalizeUrl(url) ? 0.45 : 1 }}>{loading ? "Loading..." : "Refresh"}</button>
                </div>

                {loading && <PreviewSkeleton />}
                {!loading && info?.valid && (
                  <div style={{ display: "grid", gridTemplateColumns: "176px 1fr", gap: "18px", alignItems: "start", paddingTop: "6px" }}>
                    {info.thumbnail && <img src={info.thumbnail} alt="" style={{ width: "176px", height: "100px", borderRadius: "24px", objectFit: "cover", boxShadow: "0 18px 50px rgba(15,23,42,0.12)" }} />}
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                      <div><div style={{ fontSize: "18px", fontWeight: 800, lineHeight: 1.35 }}>{info.title}</div><div style={{ marginTop: "6px", display: "flex", gap: "10px", flexWrap: "wrap", color: c.muted, fontSize: "12px" }}><span>{info.channel}</span><span>{formatTimestamp(info.duration || 0)}</span></div></div>
                      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr auto", gap: "12px", alignItems: "end" }}>
                        <AssetPicker selected={selectedAssets} onToggle={toggleAsset} muted={c.muted} activeBg="#0f172a" idleBg={c.surface} activeColor="#fff" idleColor={c.tx} />
                        <div>{selectedAssets.includes("video") && <><label style={{ display: "block", marginBottom: "6px", fontSize: "11px", color: c.muted }}>Video Quality</label><select value={quality} onChange={(e) => setQuality(e.target.value)} style={{ ...inputStyle, width: "100%" }}><option value="best">Best Available</option>{availableQualities.map((entry) => <option key={entry.height} value={`${entry.height}p`}>{getQualityLabel(entry.height)}</option>)}</select></>}</div>
                        <div>{selectedAssets.includes("audio") && <><label style={{ display: "block", marginBottom: "6px", fontSize: "11px", color: c.muted }}>Audio</label><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}><select value={audioFmt} onChange={(e) => setAudioFmt(e.target.value)} style={{ ...inputStyle, width: "100%" }}><option value="mp3">MP3</option><option value="m4a">M4A</option><option value="flac">FLAC</option><option value="wav">WAV</option><option value="opus">Opus</option></select><select value={audioQ} onChange={(e) => setAudioQ(e.target.value)} style={{ ...inputStyle, width: "100%" }}><option value="320">320 kbps</option><option value="192">192 kbps</option><option value="128">128 kbps</option></select></div></>}</div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                          {selectedAssets.includes("video") && <button onClick={() => { if (!trim && info.duration) { setTrimS(0); setTrimE(getDefaultTrimEnd(info.duration)); } setTrim((prev) => !prev); }} style={{ border: `1px solid ${c.inputBorder}`, background: trim ? "rgba(37,99,235,0.08)" : c.surface, color: trim ? c.blue : c.tx, borderRadius: "14px", padding: "12px 14px", cursor: "pointer", fontWeight: 700 }}>Trim</button>}
                          <button onClick={() => void handleSingleDownload()} style={{ border: "none", background: c.blue, color: "#fff", borderRadius: "14px", padding: "12px 18px", cursor: "pointer", fontWeight: 800 }}>Add To Queue</button>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                        {selectedAssets.includes("subtitle") && <div><label style={{ display: "block", marginBottom: "6px", fontSize: "11px", color: c.muted }}>Subtitle Language</label><select value={subLang} onChange={(e) => setSubLang(e.target.value)} style={{ ...inputStyle, minWidth: "170px" }}><option value="en">English</option><option value="ja">Japanese</option><option value="ur">Urdu</option><option value="ar">Arabic</option></select></div>}
                        {selectedAssets.includes("thumbnail") && <div><label style={{ display: "block", marginBottom: "6px", fontSize: "11px", color: c.muted }}>Thumbnail Format</label><select value={thumbFmt} onChange={(e) => setThumbFmt(e.target.value)} style={{ ...inputStyle, minWidth: "170px" }}><option value="jpg">JPG</option><option value="png">PNG</option><option value="webp">WEBP</option></select></div>}
                      </div>
                      {trim && selectedAssets.includes("video") && <div style={{ padding: "14px 0 6px" }}><DualTrim duration={info.duration || 1} start={trimS} end={trimE} onChangeStart={setTrimS} onChangeEnd={setTrimE} muted={c.muted} accent={c.blue} inputStyle={inputStyle} /></div>}
                    </div>
                  </div>
                )}
                {info && !info.valid && !loading && <div style={{ padding: "12px 14px", borderRadius: "16px", background: "rgba(220,38,38,0.08)", color: c.red, border: "1px solid rgba(220,38,38,0.16)" }}>{info.error}</div>}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.15fr 360px", gap: "18px", alignItems: "start" }}>
                  <div>
                    <textarea value={batchText} onChange={(e) => setBatchText(e.target.value)} placeholder="Paste one URL per line" style={{ ...inputStyle, width: "100%", minHeight: "186px", resize: "vertical", lineHeight: 1.5 }} />
                    <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                      <button onClick={handlePaste} style={{ border: `1px solid ${c.inputBorder}`, background: c.surface, color: c.tx, borderRadius: "14px", padding: "11px 14px", cursor: "pointer", fontWeight: 700 }}>Paste</button>
                      <button onClick={() => void fetchBatchData()} disabled={parseBatchUrls(batchText).length === 0 || batchFetching} style={{ border: "none", background: "#0f172a", color: "#fff", borderRadius: "14px", padding: "11px 16px", cursor: parseBatchUrls(batchText).length > 0 && !batchFetching ? "pointer" : "not-allowed", opacity: parseBatchUrls(batchText).length > 0 && !batchFetching ? 1 : 0.45, fontWeight: 800 }}>{batchFetching ? "Fetching..." : "Fetch Data"}</button>
                      <button onClick={() => void handleBatchDownload()} disabled={batchReadyCount === 0} style={{ border: "none", background: c.blue, color: "#fff", borderRadius: "14px", padding: "11px 16px", cursor: batchReadyCount > 0 ? "pointer" : "not-allowed", opacity: batchReadyCount > 0 ? 1 : 0.45, fontWeight: 800 }}>Download All</button>
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: "12px" }}>
                    <AssetPicker selected={selectedAssets} onToggle={toggleAsset} muted={c.muted} activeBg="#0f172a" idleBg={c.surface} activeColor="#fff" idleColor={c.tx} />
                    {selectedAssets.includes("video") && <div><label style={{ display: "block", marginBottom: "6px", fontSize: "11px", color: c.muted }}>Default Video Quality</label><select value={quality} onChange={(e) => setQuality(e.target.value)} style={{ ...inputStyle, width: "100%" }}><option value="best">Best Available</option></select></div>}
                    {selectedAssets.includes("audio") && <div style={{ display: "grid", gap: "12px" }}><div><label style={{ display: "block", marginBottom: "6px", fontSize: "11px", color: c.muted }}>Audio Format</label><select value={audioFmt} onChange={(e) => setAudioFmt(e.target.value)} style={{ ...inputStyle, width: "100%" }}><option value="mp3">MP3</option><option value="m4a">M4A</option><option value="flac">FLAC</option></select></div><div><label style={{ display: "block", marginBottom: "6px", fontSize: "11px", color: c.muted }}>Audio Bitrate</label><select value={audioQ} onChange={(e) => setAudioQ(e.target.value)} style={{ ...inputStyle, width: "100%" }}><option value="320">320 kbps</option><option value="192">192 kbps</option><option value="128">128 kbps</option></select></div></div>}
                    {selectedAssets.includes("subtitle") && <div><label style={{ display: "block", marginBottom: "6px", fontSize: "11px", color: c.muted }}>Subtitle Language</label><select value={subLang} onChange={(e) => setSubLang(e.target.value)} style={{ ...inputStyle, width: "100%" }}><option value="en">English</option><option value="ja">Japanese</option><option value="ur">Urdu</option><option value="ar">Arabic</option></select></div>}
                    {selectedAssets.includes("thumbnail") && <div><label style={{ display: "block", marginBottom: "6px", fontSize: "11px", color: c.muted }}>Thumbnail Format</label><select value={thumbFmt} onChange={(e) => setThumbFmt(e.target.value)} style={{ ...inputStyle, width: "100%" }}><option value="jpg">JPG</option><option value="png">PNG</option><option value="webp">WEBP</option></select></div>}
                  </div>
                </div>
                {batchItems.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {batchItems.map((item) => {
                    const qualities = getAvailableQualities(item.info);
                    return (
                      <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "14px", alignItems: "start", padding: "14px 0", borderTop: `1px solid ${c.line}` }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                            <div style={{ width: "44px", height: "44px", borderRadius: "14px", overflow: "hidden", background: "rgba(148,163,184,0.12)", flexShrink: 0 }}>
                              {item.info?.thumbnail ? <img src={item.info.thumbnail} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : item.fetchState === "loading" ? <div style={{ width: "100%", height: "100%", background: "linear-gradient(90deg,#e2e8f0 0%,#f8fafc 50%,#e2e8f0 100%)", backgroundSize: "240% 100%", animation: "grabixPulse 1.4s linear infinite" }} /> : null}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: "13px", fontWeight: 800, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{item.info?.title || item.url}</div>
                              <div style={{ marginTop: "4px", fontSize: "12px", color: item.fetchState === "error" ? c.red : c.muted }}>
                                {item.fetchState === "loading" ? "Fetching metadata..." : item.info?.valid ? `${item.info.channel || "Unknown"} · ${formatTimestamp(item.info.duration || 0)}` : item.info?.error || "Preview failed"}
                              </div>
                            </div>
                          </div>
                          {item.info?.valid && <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                            {selectedAssets.includes("video") && <select value={item.quality} onChange={(e) => setBatchItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, quality: e.target.value } : entry))} style={{ ...inputStyle, minWidth: "180px" }}><option value="best">Best Available</option>{qualities.map((entry) => <option key={entry.height} value={`${entry.height}p`}>{getQualityLabel(entry.height)}</option>)}</select>}
                            {selectedAssets.includes("video") && <div style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ fontSize: "12px", color: c.muted }}>Trim</span><Toggle value={item.trimEnabled} onChange={(value) => setBatchItems((prev) => prev.map((entry) => entry.id !== item.id ? entry : { ...entry, trimEnabled: value, trimStart: 0, trimEnd: value ? getDefaultTrimEnd(entry.info?.duration) : entry.trimEnd }))} /></div>}
                          </div>}
                          {item.info?.valid && item.trimEnabled && selectedAssets.includes("video") && <DualTrim duration={item.info.duration || 1} start={item.trimStart} end={item.trimEnd} onChangeStart={(value) => setBatchItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, trimStart: value } : entry))} onChangeEnd={(value) => setBatchItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, trimEnd: value } : entry))} muted={c.muted} accent={c.blue} inputStyle={inputStyle} />}
                        </div>
                        <IconButton title="Remove item" onClick={() => setBatchItems((prev) => prev.filter((entry) => entry.id !== item.id))}><Glyph path={<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" /></>} /></IconButton>
                      </div>
                    );
                  })}
                </div>}
              </div>
            )}

            <div style={{ marginTop: "28px", borderTop: `1px solid ${c.line}`, paddingTop: "18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}><h2 style={{ margin: 0, fontSize: "15px", fontWeight: 800 }}>Queue</h2><span style={{ fontSize: "12px", color: c.muted }}>{activeQueueItems.length} active</span><span style={{ fontSize: "12px", color: c.muted }}>{completedQueueItems.length + history.filter((entry) => !downloadsList.some((item) => item.id === entry.id)).length} complete</span></div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}><IconButton title="Stop all downloads" onClick={() => void stopAllDownloads()} disabled={activeQueueItems.length === 0}><Glyph path={<rect x="6" y="6" width="12" height="12" rx="2" />} /></IconButton><IconButton title={queueExpanded ? "Collapse queue" : "Expand queue"} onClick={() => setQueueExpanded((prev) => !prev)}><Glyph path={queueExpanded ? <path d="m18 15-6-6-6 6" /> : <path d="m6 9 6 6 6-6" />} /></IconButton></div>
              </div>
              {folderActionMsg && <p style={{ margin: "10px 0 0", fontSize: "11px", color: c.muted }}>{folderActionMsg}</p>}

              {!queueExpanded ? (
                <div style={{ marginTop: "16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "14px", padding: "14px 0" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 700 }}>{currentActive?.title || "No active downloads"}</div>
                    {currentActive && <>
                      <div style={{ marginTop: "8px", height: "8px", borderRadius: "999px", background: "rgba(148,163,184,0.16)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${currentActive.percent || 0}%`, background: `linear-gradient(90deg, ${c.blue}, #60a5fa, ${c.blue})`, backgroundSize: "60px 100%", animation: currentActive.status === "downloading" ? "queueShimmer 1s linear infinite" : "none", borderRadius: "999px", transition: "width 0.35s ease" }} />
                      </div>
                      <div style={{ marginTop: "8px", display: "flex", gap: "10px", flexWrap: "wrap", fontSize: "11px", color: c.muted }}>
                        <span>{currentActive.percent}%</span>
                        {currentActive.downloaded && <span>{currentActive.total ? `${currentActive.downloaded} / ${currentActive.total}` : currentActive.downloaded}</span>}
                        {currentActive.speed && <span>{currentActive.speed}</span>}
                        {currentActive.eta && <span>ETA {currentActive.eta}</span>}
                      </div>
                    </>}
                  </div>
                  <IconButton title="Open download folder" onClick={() => void openDownloadFolder(currentActive?.file_path || currentActive?.folder || "")}><Glyph path={<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />} /></IconButton>
                </div>
              ) : (
                <div style={{ marginTop: "14px", display: "flex", flexDirection: "column" }}>
                  {queueRows.map((item) => {
                    const tint = item.status === "done" ? c.green : item.status === "failed" || item.status === "canceled" ? c.red : item.status === "paused" ? c.amber : c.blue;
                    const barStyle: CSSProperties = {
                      height: "100%",
                      width: `${item.percent || 0}%`,
                      background: item.status === "downloading" ? `linear-gradient(90deg, ${tint}, #93c5fd, ${tint})` : tint,
                      backgroundSize: "60px 100%",
                      animation: item.status === "downloading" ? "queueShimmer 1s linear infinite" : "none",
                      borderRadius: "999px",
                      transition: "width 0.35s ease",
                    };
                    return (
                      <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "12px", alignItems: "center", padding: "14px 0", borderTop: `1px solid ${c.line}` }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "13px", fontWeight: 800, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{item.title || "Untitled download"}</span>
                            <span style={{ fontSize: "11px", color: c.muted, textTransform: "uppercase" }}>{item.dl_type || "download"}</span>
                            <span style={{ fontSize: "11px", color: tint, fontWeight: 800, textTransform: "capitalize" }}>{item.status}</span>
                          </div>
                          <div style={{ marginTop: "10px", height: "8px", borderRadius: "999px", background: "rgba(148,163,184,0.16)", overflow: "hidden" }}>
                            <div style={barStyle} />
                          </div>
                          <div style={{ marginTop: "8px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "11px", color: c.tx, fontWeight: 800 }}>{item.percent}%</span>
                            {(item.downloaded || item.total || item.size) && <span style={{ fontSize: "11px", color: c.muted }}>{item.downloaded && item.total ? `${item.downloaded} / ${item.total}` : item.size || item.downloaded}</span>}
                            {item.speed && <span style={{ fontSize: "11px", color: c.muted }}>{item.speed}</span>}
                            {item.eta && <span style={{ fontSize: "11px", color: c.muted }}>ETA {item.eta}</span>}
                            {item.error && <span style={{ fontSize: "11px", color: c.red }}>{item.error}</span>}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center", justifyContent: "flex-end" }}>
                          {item.status === "downloading" && <IconButton title="Pause" onClick={() => void runDownloadAction(item.id, "pause")}><Glyph path={<><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>} /></IconButton>}
                          {item.status === "paused" && <IconButton title="Resume" onClick={() => void runDownloadAction(item.id, "resume")}><Glyph path={<polygon points="8 5 19 12 8 19 8 5" />} /></IconButton>}
                          {["queued", "downloading", "paused", "canceling"].includes(item.status) && <IconButton title="Cancel" onClick={() => void runDownloadAction(item.id, "cancel")}><Glyph path={<rect x="6" y="6" width="12" height="12" rx="2" />} /></IconButton>}
                          {["failed", "canceled"].includes(item.status) && <IconButton title="Retry" onClick={() => void runDownloadAction(item.id, "retry")}><Glyph path={<><path d="M23 4v6h-6" /><path d="M20.49 15A9 9 0 1 1 23 10" /></>} /></IconButton>}
                          <IconButton title="Open folder" onClick={() => void openDownloadFolder(item.file_path || item.folder || "")}><Glyph path={<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />} /></IconButton>
                        </div>
                      </div>
                    );
                  })}
                  {history.filter((entry) => !downloadsList.some((item) => item.id === entry.id)).map((entry) => <div key={`history-${entry.id}`} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "12px", alignItems: "center", padding: "12px 0", borderTop: `1px solid ${c.line}` }}><div><div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}><span style={{ fontSize: "13px", fontWeight: 600 }}>{entry.title}</span><span style={{ fontSize: "11px", color: c.muted, textTransform: "uppercase" }}>{entry.dl_type}</span><span style={{ fontSize: "11px", color: entry.status === "done" ? c.green : entry.status === "failed" ? c.red : c.blue, fontWeight: 800, textTransform: "capitalize" }}>{entry.status}</span></div></div><IconButton title="Open folder" onClick={() => void openDownloadFolder(entry.file_path || "")}><Glyph path={<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />} /></IconButton></div>)}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: "980px", margin: "0 auto", width: "100%" }}>
            <h1 style={{ margin: "0 0 18px", fontSize: "24px", fontWeight: 800 }}>Settings</h1>
            <div style={{ display: "grid", gap: "14px" }}>
              {[{ title: "Downloads", rows: [{ label: "Download Folder", desc: "Where files are saved", ctrl: <input type="text" value={settings.folder} onChange={(e) => setSettings((prev) => ({ ...prev, folder: e.target.value }))} style={{ ...inputStyle, width: "220px" }} /> }, { label: "Max Concurrent", desc: "Downloads at same time", ctrl: <select value={settings.maxConcurrent} onChange={(e) => setSettings((prev) => ({ ...prev, maxConcurrent: Number(e.target.value) }))} style={inputStyle}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select> }, { label: "File Naming Template", desc: "yt-dlp output template", ctrl: <input type="text" value={settings.naming} onChange={(e) => setSettings((prev) => ({ ...prev, naming: e.target.value }))} style={{ ...inputStyle, width: "240px", fontFamily: "monospace", opacity: 0.78 }} /> }] }, { title: "Defaults", rows: [{ label: "Default Video Quality", desc: "Pre-selected quality", ctrl: <select value={settings.defaultQ} onChange={(e) => setSettings((prev) => ({ ...prev, defaultQ: e.target.value }))} style={inputStyle}><option value="best">Best</option><option value="2160p">2160p</option><option value="1440p">1440p</option><option value="1080p">1080p</option></select> }, { label: "Default Audio Format", desc: "Format for extractions", ctrl: <select value={settings.defaultAudio} onChange={(e) => setSettings((prev) => ({ ...prev, defaultAudio: e.target.value }))} style={inputStyle}><option>MP3</option><option>M4A</option><option>FLAC</option><option>WAV</option></select> }] }, { title: "Behavior", rows: [{ label: "Auto-paste from Clipboard", desc: "Fill URL when app opens", ctrl: <Toggle value={settings.autoPaste} onChange={(value) => setSettings((prev) => ({ ...prev, autoPaste: value }))} /> }, { label: "Notify on Complete", desc: "System notification", ctrl: <Toggle value={settings.notify} onChange={(value) => setSettings((prev) => ({ ...prev, notify: value }))} /> }, { label: "Embed Thumbnail in Audio", desc: "Not fully implemented yet", ctrl: <Toggle value={settings.embedThumb} onChange={(value) => setSettings((prev) => ({ ...prev, embedThumb: value }))} /> }, { label: "Embed Subtitles in Video", desc: "Not fully implemented yet", ctrl: <Toggle value={settings.embedSubs} onChange={(value) => setSettings((prev) => ({ ...prev, embedSubs: value }))} /> }, { label: "Use Proxy", desc: "Not fully implemented yet", ctrl: <Toggle value={settings.proxy} onChange={(value) => setSettings((prev) => ({ ...prev, proxy: value }))} /> }] }].map((section) => <div key={section.title} style={{ background: "rgba(255,255,255,0.54)", border: `1px solid ${c.line}`, borderRadius: "22px", overflow: "hidden", backdropFilter: "blur(16px)" }}><div style={{ padding: "14px 18px", borderBottom: `1px solid ${c.line}` }}><p style={{ margin: 0, fontSize: "13px", fontWeight: 800 }}>{section.title}</p></div>{section.rows.map((row, index) => <div key={row.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "14px 18px", borderTop: index === 0 ? "none" : `1px solid ${c.line}`, opacity: row.desc.includes("Not fully implemented") ? 0.72 : 1 }}><div><p style={{ margin: 0, fontSize: "13px", fontWeight: 700 }}>{row.label}</p><p style={{ margin: "4px 0 0", fontSize: "12px", color: c.muted }}>{row.desc}</p></div><div>{row.ctrl}</div></div>)}</div>)}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
