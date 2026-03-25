import { useState, useEffect, useRef } from "react";

interface VideoInfo {
  valid: boolean;
  title?: string;
  thumbnail?: string;
  duration?: number;
  error?: string;
}

interface ProgressInfo {
  status: "starting" | "downloading" | "processing" | "done" | "error" | "not_found";
  percent?: number;
  speed?: string;
  folder?: string;
  error?: string;
}

interface HistoryItem {
  id: string;
  title: string;
  format: string;
  thumbnail?: string;
  status: "done" | "error";
}

const API = "http://127.0.0.1:8000";

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function App() {
  const [dark, setDark] = useState(true);
  const [url, setUrl] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [format, setFormat] = useState("video");
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [folder, setFolder] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeNav, setActiveNav] = useState("download");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!downloadId) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/progress/${downloadId}`);
        const data: ProgressInfo = await res.json();
        setProgress(data);
        if (data.status === "done") {
          clearInterval(pollRef.current!);
          if (videoInfo?.title) {
            setHistory(h => [{
              id: downloadId,
              title: videoInfo.title!,
              format: format === "audio" ? "MP3" : "MP4",
              thumbnail: videoInfo.thumbnail,
              status: "done",
            }, ...h.slice(0, 19)]);
          }
        }
        if (data.status === "error") clearInterval(pollRef.current!);
      } catch { /* backend busy */ }
    }, 1000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [downloadId]);

  const checkVideo = async () => {
    if (!url.trim()) return;
    setChecking(true);
    setVideoInfo(null);
    setProgress(null);
    setDownloadId(null);
    try {
      const res = await fetch(`${API}/check-link?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      setVideoInfo(data);
    } catch {
      setVideoInfo({ valid: false, error: "Cannot connect to backend. Is it running?" });
    } finally {
      setChecking(false);
    }
  };

  const startDownload = async () => {
    if (!url.trim()) return;
    setProgress({ status: "starting", percent: 0 });
    try {
      const res = await fetch(`${API}/download?url=${encodeURIComponent(url)}&format=${format}`);
      const data = await res.json();
      setDownloadId(data.download_id);
      setFolder(data.folder);
    } catch {
      setProgress({ status: "error", error: "Could not connect to backend." });
    }
  };

  const isDownloading = ["starting","downloading","processing"].includes(progress?.status ?? "");
  const pct = progress?.percent ?? 0;

  const t = {
    bg: dark ? "#0b0c10" : "#f2f2f5",
    sb: dark ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.6)",
    sbBorder: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)",
    surface: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
    surfaceHover: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
    card: dark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.9)",
    cardBorder: dark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.09)",
    input: dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)",
    inputBorder: dark ? "rgba(255,255,255,0.11)" : "rgba(0,0,0,0.13)",
    text: dark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.87)",
    textSub: dark ? "rgba(255,255,255,0.42)" : "rgba(0,0,0,0.42)",
    textHint: dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.22)",
    accent: "#5b6ef5",
    accentSoft: dark ? "rgba(91,110,245,0.14)" : "rgba(91,110,245,0.1)",
    accentBorder: "rgba(91,110,245,0.25)",
    progressBg: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.09)",
    topbar: dark ? "rgba(11,12,16,0.85)" : "rgba(242,242,245,0.85)",
    shadow: dark ? "0 8px 32px rgba(0,0,0,0.45)" : "0 4px 24px rgba(0,0,0,0.08)",
    green: "#22c55e",
    red: "#ef4444",
  };

  const navItems = [
    { id:"download", label:"Download", icon:<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> },
    { id:"library", label:"Library", icon:<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> },
    { id:"browse", label:"Browse", icon:<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> },
    { id:"history", label:"History", icon:<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 15 10 8 14 12 21 5"/><polyline points="17 5 21 5 21 9"/></svg> },
  ];

  return (
    <div style={{ display:"flex", height:"100vh", width:"100vw", background:t.bg, fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif", color:t.text, overflow:"hidden", transition:"background 0.3s,color 0.3s" }}>

      {/* Sidebar */}
      <aside style={{ width:220, minWidth:220, background:t.sb, borderRight:`1px solid ${t.sbBorder}`, display:"flex", flexDirection:"column", backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)", transition:"background 0.3s" }}>

        {/* Brand */}
        <div style={{ padding:"22px 18px 18px", borderBottom:`1px solid ${t.sbBorder}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:34, height:34, background:"linear-gradient(135deg,#5b6ef5,#8b5cf6)", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:"#fff", letterSpacing:.5, flexShrink:0, boxShadow:"0 4px 14px rgba(91,110,245,0.4)" }}>GX</div>
            <div>
              <div style={{ fontSize:15, fontWeight:700, letterSpacing:.5, color:t.text }}>GRABIX</div>
              <div style={{ fontSize:10, color:t.textHint, letterSpacing:.4 }}>Phase 1 · Download Engine</div>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <nav style={{ padding:"10px 8px", flex:1 }}>
          <div style={{ fontSize:9, fontWeight:600, color:t.textHint, letterSpacing:"0.12em", textTransform:"uppercase", padding:"10px 12px 6px" }}>Menu</div>
          {navItems.map(item => {
            const active = activeNav === item.id;
            return (
              <div key={item.id} onClick={() => setActiveNav(item.id)}
                onMouseEnter={e => { if (!active)(e.currentTarget as HTMLDivElement).style.background = t.surfaceHover; }}
                onMouseLeave={e => { if (!active)(e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", borderRadius:9, cursor:"pointer", marginBottom:1, background:active ? t.accentSoft : "transparent", color:active ? t.accent : t.textSub, fontWeight:active ? 500 : 400, fontSize:13, transition:"all 0.15s", border:active ? `1px solid ${t.accentBorder}` : "1px solid transparent" }}>
                <span style={{ opacity:active ? 1 : 0.5, transition:"opacity 0.15s", display:"flex" }}>{item.icon}</span>
                {item.label}
                {item.id === "download" && isDownloading && (
                  <span style={{ marginLeft:"auto", width:6, height:6, borderRadius:"50%", background:t.accent, boxShadow:`0 0 8px ${t.accent}`, display:"inline-block" }} />
                )}
              </div>
            );
          })}

          <div style={{ height:1, background:t.sbBorder, margin:"10px 6px" }} />

          {["Queue","Settings"].map(label => (
            <div key={label}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = t.surfaceHover}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
              style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", borderRadius:9, cursor:"pointer", marginBottom:1, color:t.textSub, fontSize:13, transition:"background 0.15s" }}>
              <span style={{ opacity:.4, display:"flex" }}>
                {label === "Queue"
                  ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                  : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>}
              </span>
              {label}
            </div>
          ))}
        </nav>

        {/* Bottom: theme toggle + storage */}
        <div style={{ padding:"12px 12px 20px", borderTop:`1px solid ${t.sbBorder}` }}>
          <button onClick={() => setDark(d => !d)} style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"9px 12px", background:t.surface, border:`1px solid ${t.inputBorder}`, borderRadius:10, cursor:"pointer", color:t.textSub, fontSize:12, marginBottom:14, fontFamily:"inherit", transition:"all 0.2s" }}>
            <span style={{ display:"flex", alignItems:"center", gap:8 }}>
              {dark
                ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>}
              {dark ? "Dark mode" : "Light mode"}
            </span>
            <div style={{ width:32, height:17, background:dark ? t.accent : "rgba(0,0,0,0.18)", borderRadius:99, position:"relative", transition:"background 0.25s" }}>
              <div style={{ position:"absolute", top:2, left:dark ? 16 : 2, width:13, height:13, background:"#fff", borderRadius:"50%", transition:"left 0.25s", boxShadow:"0 1px 3px rgba(0,0,0,0.3)" }} />
            </div>
          </button>

          <div style={{ padding:"0 2px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
              <span style={{ fontSize:10, color:t.textHint }}>Storage</span>
              <span style={{ fontSize:10, color:t.textHint }}>2.3 / 6.1 GB</span>
            </div>
            <div style={{ height:2, background:t.progressBg, borderRadius:99 }}>
              <div style={{ width:"38%", height:2, background:`linear-gradient(90deg,${t.accent},#8b5cf6)`, borderRadius:99 }} />
            </div>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <main style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0, overflow:"hidden" }}>

        {/* Topbar */}
        <div style={{ height:54, display:"flex", alignItems:"center", padding:"0 24px", gap:12, borderBottom:`1px solid ${t.sbBorder}`, backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)", background:t.topbar, transition:"background 0.3s", flexShrink:0 }}>
          <div style={{ fontSize:14, fontWeight:600, color:t.text, textTransform:"capitalize", minWidth:60 }}>{activeNav}</div>

          {/* URL bar */}
          <div onClick={() => inputRef.current?.focus()} style={{ flex:1, maxWidth:480, height:32, background:t.input, border:`1px solid ${t.inputBorder}`, borderRadius:99, display:"flex", alignItems:"center", padding:"0 14px", gap:8, margin:"0 auto", cursor:"text" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={t.textHint} strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
            <input ref={inputRef} type="text" placeholder="Paste any video link..." value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && checkVideo()} disabled={isDownloading}
              style={{ flex:1, background:"transparent", border:"none", outline:"none", fontSize:12, color:t.text, fontFamily:"inherit" }} />
            {url && <span onClick={() => setUrl("")} style={{ cursor:"pointer", opacity:.4, fontSize:16, lineHeight:1, color:t.text }}>×</span>}
          </div>

          <button onClick={checkVideo} disabled={checking || !url.trim() || isDownloading}
            onMouseDown={e => (e.currentTarget.style.transform = "scale(0.96)")}
            onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}
            style={{ height:32, padding:"0 18px", background:`linear-gradient(135deg,${t.accent},#8b5cf6)`, border:"none", borderRadius:99, fontSize:12, fontWeight:600, color:"#fff", cursor:checking||!url.trim()||isDownloading ? "not-allowed" : "pointer", opacity:checking||!url.trim()||isDownloading ? 0.5 : 1, transition:"opacity 0.2s,transform 0.1s", boxShadow:"0 2px 14px rgba(91,110,245,0.35)", fontFamily:"inherit", whiteSpace:"nowrap" }}>
            {checking ? "Checking..." : "Check link"}
          </button>
        </div>

        {/* Body */}
        <div style={{ flex:1, display:"flex", overflow:"hidden" }}>

          {/* Feed */}
          <div style={{ flex:1, padding:24, display:"flex", flexDirection:"column", gap:14, overflowY:"auto" }}>

            {/* Error */}
            {videoInfo && !videoInfo.valid && (
              <div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:13, padding:"13px 17px", fontSize:13, color:"#f87171", display:"flex", alignItems:"center", gap:10 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {videoInfo.error || "Invalid link."}
              </div>
            )}

            {/* Video card */}
            {videoInfo?.valid && (
              <div style={{ background:t.card, border:`1px solid ${t.cardBorder}`, borderRadius:16, overflow:"hidden", boxShadow:t.shadow, backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)" }}>
                <div style={{ display:"flex" }}>
                  <div style={{ position:"relative", flexShrink:0 }}>
                    {videoInfo.thumbnail
                      ? <img src={videoInfo.thumbnail} alt="" style={{ width:176, height:99, objectFit:"cover", display:"block" }} />
                      : <div style={{ width:176, height:99, background:dark ? "#1a1d2e" : "#e5e7f0", display:"flex", alignItems:"center", justifyContent:"center" }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={t.textHint} strokeWidth="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>}
                    {videoInfo.duration && (
                      <span style={{ position:"absolute", bottom:6, right:6, fontSize:9, color:"#fff", background:"rgba(0,0,0,0.65)", padding:"2px 6px", borderRadius:4 }}>{formatDuration(videoInfo.duration)}</span>
                    )}
                  </div>
                  <div style={{ flex:1, padding:"14px 18px", display:"flex", flexDirection:"column", justifyContent:"space-between" }}>
                    <div>
                      <div style={{ fontSize:13, fontWeight:500, color:t.text, lineHeight:1.45, marginBottom:4 }}>{videoInfo.title}</div>
                      <div style={{ fontSize:11, color:t.textSub }}>{videoInfo.duration ? formatDuration(videoInfo.duration) : ""} · Ready</div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:12 }}>
                      <select value={format} onChange={e => setFormat(e.target.value)} disabled={isDownloading} style={{ height:30, padding:"0 10px", background:t.input, border:`1px solid ${t.inputBorder}`, borderRadius:8, fontSize:11, color:t.text, fontFamily:"inherit", cursor:"pointer", outline:"none" }}>
                        <option value="video">MP4 Video</option>
                        <option value="audio">MP3 Audio</option>
                      </select>
                      <button onClick={startDownload} disabled={isDownloading}
                        onMouseDown={e => (e.currentTarget.style.transform="scale(0.96)")}
                        onMouseUp={e => (e.currentTarget.style.transform="scale(1)")}
                        style={{ height:30, padding:"0 16px", background:isDownloading ? t.surface : `linear-gradient(135deg,${t.accent},#8b5cf6)`, border:isDownloading ? `1px solid ${t.inputBorder}` : "none", borderRadius:8, fontSize:11, fontWeight:600, color:isDownloading ? t.textSub : "#fff", cursor:isDownloading ? "not-allowed" : "pointer", display:"flex", alignItems:"center", gap:6, transition:"all 0.15s", boxShadow:isDownloading ? "none" : "0 2px 10px rgba(91,110,245,0.3)", marginLeft:"auto", fontFamily:"inherit" }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
                        {isDownloading ? "Downloading..." : "Download"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Progress */}
            {progress && (
              <div style={{ background:progress.status==="done" ? "rgba(34,197,94,0.06)" : progress.status==="error" ? "rgba(239,68,68,0.06)" : t.accentSoft, border:`1px solid ${progress.status==="done" ? "rgba(34,197,94,0.2)" : progress.status==="error" ? "rgba(239,68,68,0.2)" : t.accentBorder}`, borderRadius:14, padding:"15px 18px", backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)", transition:"all 0.4s" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:11 }}>
                  <div style={{ width:7, height:7, borderRadius:"50%", flexShrink:0, background:progress.status==="done" ? t.green : progress.status==="error" ? t.red : t.accent, boxShadow:`0 0 8px ${progress.status==="done" ? t.green : progress.status==="error" ? t.red : t.accent}` }} />
                  <div style={{ flex:1, fontSize:12, fontWeight:500, color:t.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                    {progress.status==="done" && "Download complete ✓"}
                    {progress.status==="error" && "Download failed"}
                    {progress.status==="starting" && "Starting..."}
                    {progress.status==="downloading" && (videoInfo?.title ?? "Downloading...")}
                    {progress.status==="processing" && "Processing file..."}
                  </div>
                  {progress.speed && <div style={{ fontSize:11, color:t.textSub, flexShrink:0 }}>{progress.speed}</div>}
                </div>
                {progress.status !== "error" && (
                  <div style={{ height:2, background:t.progressBg, borderRadius:99, marginBottom:9, overflow:"hidden" }}>
                    <div style={{ height:2, width:`${pct}%`, background:progress.status==="done" ? `linear-gradient(90deg,${t.green},#16a34a)` : `linear-gradient(90deg,${t.accent},#8b5cf6)`, borderRadius:99, transition:"width 0.6s ease" }} />
                  </div>
                )}
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:t.textSub }}>
                  <span style={{ color:t.text, fontWeight:500 }}>{pct}%</span>
                  {progress.status==="done" && folder && <span style={{ fontSize:10 }}>Saved → {folder}</span>}
                  {progress.status==="error" && <span style={{ color:t.red }}>{progress.error}</span>}
                </div>
              </div>
            )}

            {/* Empty state */}
            {!videoInfo && !progress && (
              <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, opacity:.45, minHeight:300 }}>
                <div style={{ width:52, height:52, borderRadius:15, border:`1.5px dashed ${t.inputBorder}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={t.textSub} strokeWidth="1.5"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
                </div>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontSize:14, fontWeight:500, color:t.textSub, marginBottom:4 }}>Paste a link to get started</div>
                  <div style={{ fontSize:12, color:t.textHint }}>YouTube, Twitter, Instagram and more</div>
                </div>
              </div>
            )}
          </div>

          {/* History panel */}
          <aside style={{ width:236, borderLeft:`1px solid ${t.sbBorder}`, display:"flex", flexDirection:"column", background:t.sb, backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)", transition:"background 0.3s" }}>
            <div style={{ padding:"14px 16px 11px", fontSize:10, fontWeight:600, color:t.textHint, letterSpacing:"0.1em", textTransform:"uppercase", borderBottom:`1px solid ${t.sbBorder}` }}>Recent downloads</div>
            <div style={{ flex:1, overflowY:"auto", padding:"4px 0" }}>
              {history.length === 0 ? (
                <div style={{ padding:"28px 16px", textAlign:"center", fontSize:12, color:t.textHint }}>Downloads appear here</div>
              ) : (
                history.map(item => (
                  <div key={item.id}
                    onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = t.surfaceHover}
                    onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
                    style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 14px", cursor:"pointer", transition:"background 0.12s" }}>
                    <div style={{ width:44, height:28, borderRadius:6, flexShrink:0, background:item.thumbnail ? "transparent" : (dark ? "#1a1d2e" : "#e5e7f0"), overflow:"hidden" }}>
                      {item.thumbnail && <img src={item.thumbnail} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11, color:t.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", marginBottom:2 }}>{item.title}</div>
                      <div style={{ fontSize:10, color:t.textHint }}>{item.format}</div>
                    </div>
                    <span style={{ fontSize:9, padding:"2px 7px", borderRadius:99, fontWeight:600, flexShrink:0, background:item.format==="MP3" ? "rgba(139,92,246,0.15)" : "rgba(34,197,94,0.12)", color:item.format==="MP3" ? "#a78bfa" : "#4ade80" }}>{item.format}</span>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
