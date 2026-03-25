import { useState, useRef, useEffect } from "react";

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

function secToTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
  return `${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
}

function timeToSec(t: string): number {
  const parts = t.split(":").map(Number);
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
  if (parts.length === 2) return parts[0]*60 + parts[1];
  return 0;
}

function formatViews(n: number): string {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${(n/1_000).toFixed(0)}K views`;
  return `${n} views`;
}

// ── Dual-handle trim slider ──────────────────────────────────────────────────
function TrimSlider({ duration, startSec, endSec, onChange }: {
  duration: number; startSec: number; endSec: number;
  onChange: (start: number, end: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start"|"end"|null>(null);

  const pctStart = duration > 0 ? (startSec / duration) * 100 : 0;
  const pctEnd   = duration > 0 ? (endSec   / duration) * 100 : 100;

  function getSecFromEvent(e: MouseEvent | TouchEvent): number {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(pct * duration);
  }

  useEffect(() => {
    function onMove(e: MouseEvent | TouchEvent) {
      if (!dragging.current) return;
      const sec = getSecFromEvent(e);
      if (dragging.current === "start") onChange(Math.min(sec, endSec - 1), endSec);
      else onChange(startSec, Math.max(sec, startSec + 1));
    }
    function onUp() { dragging.current = null; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [startSec, endSec, duration]);

  const knob: React.CSSProperties = {
    width: 18, height: 18, borderRadius: "50%",
    background: "#4f8ef7", border: "2.5px solid #fff",
    boxShadow: "0 1px 5px rgba(0,0,0,.5)",
    position: "absolute", top: "50%",
    transform: "translate(-50%,-50%)",
    cursor: "grab", zIndex: 2, touchAction: "none",
  };

  return (
    <div style={{ position:"relative", height:20, marginTop:4 }}>
      <div ref={trackRef} style={{
        position:"absolute", left:0, right:0, top:"50%",
        transform:"translateY(-50%)", height:4,
        background:"#252b35", borderRadius:2,
      }}>
        <div style={{
          position:"absolute", left:`${pctStart}%`,
          width:`${pctEnd - pctStart}%`,
          height:"100%", background:"#4f8ef7", borderRadius:2,
        }} />
      </div>
      <div
        style={{ ...knob, left:`${pctStart}%` }}
        onMouseDown={() => { dragging.current = "start"; }}
        onTouchStart={() => { dragging.current = "start"; }}
      />
      <div
        style={{ ...knob, left:`${pctEnd}%` }}
        onMouseDown={() => { dragging.current = "end"; }}
        onTouchStart={() => { dragging.current = "end"; }}
      />
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [url, setUrl]           = useState("");
  const [info, setInfo]         = useState<VideoInfo | null>(null);
  const [fetching, setFetching] = useState(false);
  const [format, setFormat]     = useState<FormatType>("video");
  const [quality, setQuality]   = useState<QualityType>("best");
  const [trimOn, setTrimOn]     = useState(false);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec]     = useState(0);
  const [startText, setStartText] = useState("00:00");
  const [endText, setEndText]     = useState("00:00");
  const [page, setPage]         = useState("download");
  const [progress, setProgress] = useState({
    active:false, pct:0, speed:"", eta:"", done:false, err:"",
  });
  const evtRef = useRef<EventSource | null>(null);

  const duration   = info?.duration ?? 0;
  const showTrim   = !!info?.valid && (format === "video" || format === "audio");
  const showQuality = !!info?.valid && (format === "video" || format === "audio");

  function handleStartText(val: string) {
    setStartText(val);
    const s = timeToSec(val);
    if (!isNaN(s) && s >= 0 && s < endSec) setStartSec(s);
  }
  function handleEndText(val: string) {
    setEndText(val);
    const s = timeToSec(val);
    if (!isNaN(s) && s > startSec) setEndSec(s);
  }
  function handleSlider(s: number, e: number) {
    setStartSec(s); setEndSec(e);
    setStartText(secToTime(s)); setEndText(secToTime(e));
  }

  async function handleFetch() {
    if (!url.trim()) return;
    setFetching(true);
    setInfo(null);
    setProgress({ active:false, pct:0, speed:"", eta:"", done:false, err:"" });
    try {
      const res  = await fetch(`http://127.0.0.1:8000/info?url=${encodeURIComponent(url)}`);
      const data: VideoInfo = await res.json();
      setInfo(data);
      if (data.valid && data.duration) {
        setStartSec(0); setStartText("00:00");
        setEndSec(data.duration); setEndText(secToTime(data.duration));
      }
    } catch {
      setInfo({ valid:false, error:"Cannot connect to backend. Make sure it is running (uvicorn main:app --reload)." });
    } finally {
      setFetching(false);
    }
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text);
    } catch { /* user can paste manually */ }
  }

  function handleDownload() {
    if (!info?.valid || progress.active) return;
    evtRef.current?.close();
    setProgress({ active:true, pct:0, speed:"", eta:"", done:false, err:"" });

    const params = new URLSearchParams({
      url, format, quality,
      trim: trimOn ? "1" : "0",
      start: startText, end: endText,
    });

    const es = new EventSource(`http://127.0.0.1:8000/download?${params}`);
    evtRef.current = es;

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.status === "progress") {
          setProgress(p => ({ ...p, pct: msg.percent ?? p.pct, speed: msg.speed ?? p.speed, eta: msg.eta ?? p.eta }));
        } else if (msg.status === "done") {
          setProgress(p => ({ ...p, active:false, pct:100, done:true, speed:"", eta:"" }));
          es.close();
        } else if (msg.status === "error") {
          setProgress(p => ({ ...p, active:false, err: msg.message ?? "Download failed." }));
          es.close();
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => {
      setProgress(p => ({ ...p, active:false, err:"Lost connection to backend." }));
      es.close();
    };
  }

  // ── Sub-components ──────────────────────────────────────────────────────
  function NavIcon({ icon, label, id }: { icon:string; label:string; id:string }) {
    const active = page === id;
    return (
      <div title={label} onClick={() => setPage(id)} style={{
        width:36, height:36, borderRadius:9,
        display:"flex", alignItems:"center", justifyContent:"center",
        cursor:"pointer", fontSize:15,
        background: active ? "rgba(79,142,247,.14)" : "transparent",
        border: `1px solid ${active ? "rgba(79,142,247,.3)" : "transparent"}`,
        color: active ? "#4f8ef7" : "#5a6377",
      }}>{icon}</div>
    );
  }

  function Tag({ children, color }: { children:React.ReactNode; color?:"g"|"b" }) {
    const c = color === "g"
      ? { color:"#10b981", borderColor:"rgba(16,185,129,.3)", bg:"rgba(16,185,129,.07)" }
      : color === "b"
      ? { color:"#22d3ee", borderColor:"rgba(34,211,238,.3)", bg:"rgba(34,211,238,.07)" }
      : { color:"#5a6377", borderColor:"#252b35", bg:"#1c2028" };
    return (
      <span style={{ padding:"2px 8px", borderRadius:20, fontSize:10, fontWeight:500,
        fontFamily:"monospace", border:`1px solid ${c.borderColor}`, color:c.color, background:c.bg }}>
        {children}
      </span>
    );
  }

  function QChip({ val, label }: { val:QualityType; label:string }) {
    const on = quality === val;
    const best = val === "best";
    return (
      <button onClick={() => setQuality(val)} style={{
        padding:"5px 12px", borderRadius:20, fontSize:11, fontWeight:700,
        cursor:"pointer", fontFamily:"monospace", transition:"all .15s",
        background: on ? (best ? "#10b981" : "#4f8ef7") : "#141720",
        border: `1px solid ${on ? (best ? "#10b981" : "#4f8ef7") : (best ? "rgba(16,185,129,.4)" : "#252b35")}`,
        color: on ? "#fff" : best ? "#10b981" : "#5a6377",
      }}>{label}</button>
    );
  }

  function FmtBtn({ id, icon, label }: { id:FormatType; icon:string; label:string }) {
    const on = format === id;
    return (
      <div onClick={() => setFormat(id)} style={{
        flex:1, background: on ? "rgba(79,142,247,.1)" : "#141720",
        border:`1px solid ${on ? "#4f8ef7" : "#252b35"}`,
        borderRadius:10, padding:"10px 8px",
        display:"flex", flexDirection:"column", alignItems:"center", gap:5,
        cursor:"pointer", transition:"all .15s",
      }}>
        <span style={{ fontSize:18 }}>{icon}</span>
        <span style={{ fontSize:10, fontWeight:600, color: on ? "#4f8ef7" : "#5a6377" }}>{label}</span>
      </div>
    );
  }

  const SL = { fontSize:9, fontWeight:700, letterSpacing:2.5, color:"#5a6377",
    textTransform:"uppercase" as const, marginBottom:8, display:"block" };

  return (
    <div style={{ display:"flex", height:"100vh", background:"#0c0e11",
      color:"#dde1ea", fontFamily:"'Segoe UI',system-ui,sans-serif", fontSize:13, overflow:"hidden" }}>

      {/* SIDEBAR */}
      <div style={{ width:52, background:"#141720", borderRight:"1px solid #252b35",
        display:"flex", flexDirection:"column", alignItems:"center", padding:"14px 0", gap:6, flexShrink:0 }}>
        <div style={{ fontFamily:"monospace", fontSize:8, fontWeight:500, color:"#4f8ef7",
          letterSpacing:3, writingMode:"vertical-lr", transform:"rotate(180deg)",
          marginBottom:14, textTransform:"uppercase" }}>grabix</div>
        <NavIcon icon="⬇" label="Download" id="download" />
        <NavIcon icon="📁" label="Library"  id="library" />
        <NavIcon icon="⛩"  label="Anime"    id="anime" />
        <NavIcon icon="🎬" label="Movies"   id="movies" />
        <div style={{ flex:1 }} />
        <NavIcon icon="⚙" label="Settings" id="settings" />
      </div>

      {/* MAIN */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>

        {/* TOPBAR */}
        <div style={{ height:40, borderBottom:"1px solid #252b35", display:"flex",
          alignItems:"center", padding:"0 18px", gap:8, flexShrink:0 }}>
          <span style={{ fontSize:10, fontWeight:700, color:"#5a6377", letterSpacing:1.5, textTransform:"uppercase" }}>GRABIX</span>
          <span style={{ color:"#252b35" }}>›</span>
          <span style={{ fontSize:10, fontWeight:700, color:"#dde1ea", letterSpacing:1.5, textTransform:"uppercase" }}>Downloader</span>
        </div>

        {/* SCROLL AREA — single column */}
        <div style={{ flex:1, overflowY:"auto", padding:"20px 24px",
          display:"flex", flexDirection:"column", gap:16, maxWidth:660 }}>

          {/* ── URL INPUT ── */}
          <div>
            <span style={SL}>Video Link</span>
            <div style={{ background:"#141720", border:"1px solid #252b35", borderRadius:12, overflow:"hidden" }}>
              <div style={{ display:"flex", alignItems:"center", padding:"12px 14px", gap:10 }}>
                <span style={{ fontSize:14, opacity:.5 }}>🔗</span>
                <input
                  style={{ flex:1, background:"transparent", border:"none", outline:"none",
                    color:"#dde1ea", fontFamily:"monospace", fontSize:12 }}
                  placeholder="Paste a YouTube, Vimeo, or any video link…"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleFetch()}
                />
              </div>
              <div style={{ display:"flex", gap:1, borderTop:"1px solid #252b35" }}>
                <button onClick={handlePaste} style={{ flex:1, padding:9, fontFamily:"inherit",
                  fontSize:11, fontWeight:600, border:"none", cursor:"pointer",
                  color:"#5a6377", background:"#141720" }}>
                  📋 Paste
                </button>
                <button onClick={handleFetch} disabled={fetching} style={{ flex:1, padding:9,
                  fontFamily:"inherit", fontSize:11, fontWeight:600, border:"none", cursor:"pointer",
                  color:"#4f8ef7", background:"rgba(79,142,247,.07)" }}>
                  {fetching ? "⏳ Fetching…" : "🔍 Fetch Info"}
                </button>
              </div>
            </div>
          </div>

          {/* ── ERROR ── */}
          {info && !info.valid && (
            <div style={{ background:"rgba(239,68,68,.07)", border:"1px solid rgba(239,68,68,.3)",
              borderRadius:10, padding:"12px 14px", color:"#ef4444", fontSize:12 }}>
              ⚠ {info.error || "Invalid link or unsupported site."}
            </div>
          )}

          {/* ── PREVIEW ── */}
          {info?.valid && (
            <div>
              <span style={SL}>Preview</span>
              <div style={{ background:"#141720", border:"1px solid #252b35", borderRadius:12,
                display:"flex", gap:12, padding:12, alignItems:"flex-start" }}>
                {info.thumbnail && (
                  <img src={info.thumbnail} alt="" style={{ width:120, height:68,
                    borderRadius:8, objectFit:"cover", flexShrink:0 }} />
                )}
                <div style={{ flex:1, display:"flex", flexDirection:"column", gap:6, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, lineHeight:1.35, color:"#dde1ea",
                    overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2,
                    WebkitBoxOrient:"vertical" as const }}>
                    {info.title}
                  </div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    {!!info.duration   && <Tag color="g">{secToTime(info.duration)}</Tag>}
                    {info.uploader     && <Tag color="b">{info.uploader}</Tag>}
                    {!!info.view_count && <Tag>{formatViews(info.view_count!)}</Tag>}
                    {info.upload_date  && <Tag>{info.upload_date.slice(0,4)}</Tag>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── QUALITY ── */}
          {showQuality && (
            <div>
              <span style={SL}>Quality</span>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                <QChip val="best" label="BEST" />
                <QChip val="2160" label="4K" />
                <QChip val="1080" label="1080p" />
                <QChip val="720"  label="720p" />
                <QChip val="480"  label="480p" />
                <QChip val="360"  label="360p" />
              </div>
            </div>
          )}

          {/* ── FORMAT ── */}
          {info?.valid && (
            <div>
              <span style={SL}>Download Type</span>
              <div style={{ display:"flex", gap:8 }}>
                <FmtBtn id="video"     icon="🎬" label="Video" />
                <FmtBtn id="audio"     icon="🎵" label="Audio" />
                <FmtBtn id="thumbnail" icon="🖼"  label="Thumbnail" />
                <FmtBtn id="subtitles" icon="💬" label="Subtitles" />
              </div>
            </div>
          )}

          {/* ── TRIM ── */}
          {showTrim && (
            <div style={{ background:"#141720", border:"1px solid #252b35", borderRadius:12, overflow:"hidden" }}>
              <div
                onClick={() => setTrimOn(t => !t)}
                style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                  padding:"11px 14px", cursor:"pointer", userSelect:"none" }}>
                <span style={{ display:"flex", alignItems:"center", gap:8, fontSize:12, fontWeight:600 }}>
                  ✂ Trim Before Download
                </span>
                {/* Toggle */}
                <div style={{ width:30, height:17, borderRadius:9, position:"relative",
                  background: trimOn ? "#4f8ef7" : "#252b35", transition:"background .2s", flexShrink:0 }}>
                  <div style={{ position:"absolute", width:13, height:13, background:"#fff",
                    borderRadius:"50%", top:2, left: trimOn ? 15 : 2,
                    transition:"left .18s", boxShadow:"0 1px 3px rgba(0,0,0,.4)" }} />
                </div>
              </div>
              {trimOn && (
                <div style={{ borderTop:"1px solid #252b35", padding:14,
                  display:"flex", flexDirection:"column", gap:12 }}>
                  {/* Dual-handle slider */}
                  <TrimSlider
                    duration={duration} startSec={startSec}
                    endSec={endSec} onChange={handleSlider}
                  />
                  {/* Min/max labels */}
                  <div style={{ display:"flex", justifyContent:"space-between", marginTop:-8 }}>
                    <span style={{ fontSize:10, color:"#5a6377", fontFamily:"monospace" }}>00:00</span>
                    <span style={{ fontSize:10, color:"#5a6377", fontFamily:"monospace" }}>{secToTime(duration)}</span>
                  </div>
                  {/* Text inputs */}
                  <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                    <div style={{ flex:1, display:"flex", flexDirection:"column", gap:4 }}>
                      <span style={SL}>Start</span>
                      <input value={startText} onChange={e => handleStartText(e.target.value)}
                        style={{ background:"#1c2028", border:"1px solid #252b35", borderRadius:8,
                          padding:"8px 12px", color:"#dde1ea", fontFamily:"monospace",
                          fontSize:13, fontWeight:500, textAlign:"center", outline:"none", width:"100%" }} />
                    </div>
                    <span style={{ color:"#5a6377", fontSize:14, marginTop:14 }}>→</span>
                    <div style={{ flex:1, display:"flex", flexDirection:"column", gap:4 }}>
                      <span style={SL}>End</span>
                      <input value={endText} onChange={e => handleEndText(e.target.value)}
                        style={{ background:"#1c2028", border:"1px solid #252b35", borderRadius:8,
                          padding:"8px 12px", color:"#dde1ea", fontFamily:"monospace",
                          fontSize:13, fontWeight:500, textAlign:"center", outline:"none", width:"100%" }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── DOWNLOAD BUTTON ── */}
          {info?.valid && (
            <button
              onClick={handleDownload}
              disabled={progress.active}
              style={{ background:"linear-gradient(135deg,#4f8ef7,#22d3ee)", border:"none",
                borderRadius:12, padding:14, color:"#fff", fontSize:14, fontWeight:700,
                cursor:"pointer", width:"100%", fontFamily:"inherit",
                opacity: progress.active ? 0.6 : 1, transition:"opacity .2s" }}>
              ⬇ Download Now
            </button>
          )}

          {/* ── PROGRESS ── */}
          {(progress.active || progress.done || !!progress.err) && (
            <div style={{ background:"#141720", border:"1px solid #252b35",
              borderRadius:12, padding:14, display:"flex", flexDirection:"column", gap:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:12, fontWeight:600 }}>
                  {progress.err ? "⚠ Error" : progress.done ? "✅ Download Complete!" : "⬇ Downloading…"}
                </span>
                <span style={{ fontFamily:"monospace", fontSize:12, color:"#4f8ef7" }}>
                  {Math.round(progress.pct)}%
                </span>
              </div>
              <div style={{ height:4, background:"#1c2028", borderRadius:2, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${progress.pct}%`,
                  background:"linear-gradient(90deg,#4f8ef7,#22d3ee)",
                  borderRadius:2, transition:"width .3s ease" }} />
              </div>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontSize:10, color:"#5a6377", fontFamily:"monospace" }}>
                  {progress.err || (progress.done ? "Saved to Downloads/GRABIX" : progress.speed)}
                </span>
                {!progress.done && !progress.err && (
                  <span style={{ fontSize:10, color:"#5a6377", fontFamily:"monospace" }}>{progress.eta}</span>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
