import { useState } from "react";

// ── Inline SVG icons ──────────────────────────────────────────────────────────
const IC = {
  download: (s=18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  library:  (s=18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  queue:    (s=18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><circle cx="3" cy="18" r="1" fill="currentColor"/></svg>,
  anime:    (s=18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  movies:   (s=18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="2" y1="17" x2="7" y2="17"/></svg>,
  manga:    (s=18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>,
  settings: (s=18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M19.07 19.07l-1.41-1.41M4.93 19.07l1.41-1.41M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>,
  search:   (s=15) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  bell:     (s=15) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>,
  paste:    (s=13) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>,
  file:     (s=14) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  check:    (s=12) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
};

// ── Design tokens ─────────────────────────────────────────────────────────────
const BLUE     = "#3b82f6";
const BLUE_DIM = "#0f1a2e";
const BORDER   = "#1e1e1e";
const CARD     = "#141414";
const SURFACE  = "#0e0e0e";
const DIM      = "#555";

type Page = "downloader"|"library"|"queue"|"anime"|"movies"|"manga"|"settings";
interface Rec { title:string; format:string; time:string; }

const NAV_MAIN   = [{id:"downloader",label:"Downloader",ic:IC.download},{id:"library",label:"Library",ic:IC.library},{id:"queue",label:"Queue",ic:IC.queue}];
const NAV_BROWSE = [{id:"anime",label:"Anime",ic:IC.anime},{id:"movies",label:"Movies",ic:IC.movies},{id:"manga",label:"Manga",ic:IC.manga}];
const NAV_APP    = [{id:"settings",label:"Settings",ic:IC.settings}];

// ── Small components ──────────────────────────────────────────────────────────
function NavItem({item,active,onClick}:{item:typeof NAV_MAIN[0];active:boolean;onClick:()=>void}) {
  return (
    <button onClick={onClick} style={{display:"flex",alignItems:"center",gap:"10px",width:"100%",padding:"9px 12px",borderRadius:"9px",border:"none",cursor:"pointer",marginBottom:"1px",fontSize:"13.5px",fontFamily:"inherit",fontWeight:active?500:400,background:active?BLUE_DIM:"transparent",color:active?BLUE:DIM,transition:"all 0.15s",textAlign:"left"}}>
      {item.ic(17)}{item.label}
    </button>
  );
}

function SLabel({text}:{text:string}) {
  return <div style={{fontSize:"10px",letterSpacing:"1.5px",textTransform:"uppercase",color:"#2e2e2e",padding:"0 8px",marginBottom:"6px",marginTop:"18px"}}>{text}</div>;
}

function StatCard({value,label}:{value:string;label:string}) {
  return (
    <div style={{flex:1,background:CARD,border:`1px solid ${BORDER}`,borderRadius:"12px",padding:"14px 16px"}}>
      <div style={{fontSize:"22px",fontWeight:700,color:"#fff",fontFamily:"'Syne',sans-serif"}}>{value}</div>
      <div style={{fontSize:"11px",color:DIM,marginTop:"3px"}}>{label}</div>
    </div>
  );
}

function RecentItem({rec}:{rec:Rec|null}) {
  return (
    <div style={{flex:1,display:"flex",alignItems:"center",gap:"10px",background:CARD,border:`1px solid ${BORDER}`,borderRadius:"9px",padding:"9px 12px",minWidth:0}}>
      <div style={{width:"30px",height:"30px",borderRadius:"6px",background:rec?"#0f1a2e":"#161616",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:rec?BLUE:"#2a2a2a"}}>
        {IC.file(14)}
      </div>
      <div style={{minWidth:0}}>
        <div style={{fontSize:"12px",color:rec?"#bbb":"#2a2a2a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{rec?rec.title:"No downloads yet"}</div>
        <div style={{fontSize:"10px",marginTop:"2px",color:rec?"#22c55e":DIM}}>{rec?`${rec.format} · ${rec.time}`:"—"}</div>
      </div>
    </div>
  );
}

// ── Downloader page ───────────────────────────────────────────────────────────
function DownloaderPage() {
  const [url,setUrl]         = useState("");
  const [format,setFormat]   = useState("video");
  const [quality,setQuality] = useState("best");
  const [status,setStatus]   = useState<any>(null);
  const [loading,setLoading] = useState(false);
  const [msg,setMsg]         = useState("");
  const [history,setHistory] = useState<Rec[]>([]);
  const [count,setCount]     = useState(0);

  const go = async () => {
    if (!url.trim()) return;
    setLoading(true); setStatus(null); setMsg("");
    try {
      const cd = await fetch(`http://127.0.0.1:8000/check-link?url=${encodeURIComponent(url)}`).then(r=>r.json());
      if (!cd.valid) { setStatus(cd); setLoading(false); return; }
      setStatus(cd);
      const dd = await fetch(`http://127.0.0.1:8000/download?url=${encodeURIComponent(url)}&format=${format}`).then(r=>r.json());
      setMsg(`Saving to: ${dd.folder}`);
      setCount(n=>n+1);
      setHistory(h=>[{title:cd.title||"Unknown",format:format==="video"?"MP4":"MP3",time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})},...h].slice(0,3));
    } catch {
      setStatus({valid:false,error:"Cannot connect to backend. Run: uvicorn main:app --reload"});
    }
    setLoading(false);
  };

  const pill = (on:boolean):React.CSSProperties => ({
    padding:"6px 16px",borderRadius:"50px",fontSize:"12px",fontWeight:500,cursor:"pointer",
    fontFamily:"inherit",transition:"all 0.15s",
    border:`1px solid ${on?BLUE:"#242424"}`,color:on?BLUE:DIM,background:on?BLUE_DIM:"transparent",
  });

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* ── Hero ── */}
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"28px 48px 20px"}}>

        <div style={{fontSize:"11px",letterSpacing:"2px",textTransform:"uppercase",color:BLUE,marginBottom:"10px",fontWeight:500}}>
          ● Downloader Active
        </div>

        <h1 style={{fontFamily:"'Syne',sans-serif",fontSize:"32px",fontWeight:800,color:"#fff",textAlign:"center",lineHeight:1.15,margin:"0 0 8px 0"}}>
          Grab anything.<br/>Keep everything.
        </h1>

        <p style={{fontSize:"13px",color:DIM,textAlign:"center",margin:"0 0 28px 0"}}>
          YouTube · Twitter · Instagram · TikTok · and more
        </p>

        {/* Input */}
        <div style={{width:"100%",maxWidth:"540px",position:"relative",marginBottom:"12px"}}>
          <input
            value={url} onChange={e=>setUrl(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&go()}
            placeholder="Paste your video link here..."
            style={{width:"100%",background:CARD,border:`1.5px solid ${BORDER}`,borderRadius:"13px",padding:"15px 120px 15px 18px",color:"#fff",fontSize:"14px",fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor=BLUE}
            onBlur={e=>e.target.style.borderColor=BORDER}
          />
          <button
            onClick={async()=>{try{const t=await navigator.clipboard.readText();setUrl(t);}catch{}}}
            style={{position:"absolute",right:"8px",top:"50%",transform:"translateY(-50%)",background:"#1e2a3a",color:BLUE,border:"1px solid #2a3a54",borderRadius:"9px",padding:"8px 14px",fontSize:"13px",fontFamily:"inherit",cursor:"pointer",display:"flex",alignItems:"center",gap:"5px",fontWeight:500}}
          >
            {IC.paste(13)} Paste
          </button>
        </div>

        {/* Format + quality pills */}
        <div style={{display:"flex",gap:"6px",marginBottom:"16px",flexWrap:"wrap",justifyContent:"center"}}>
          {[{id:"video",l:"MP4 Video"},{id:"audio",l:"MP3 Audio"}].map(f=>(
            <button key={f.id} style={pill(format===f.id)} onClick={()=>setFormat(f.id)}>{f.l}</button>
          ))}
          {[{id:"best",l:"Best Quality"},{id:"1080p",l:"1080p"},{id:"720p",l:"720p"}].map(q=>(
            <button key={q.id} style={pill(quality===q.id)} onClick={()=>setQuality(q.id)}>{q.l}</button>
          ))}
        </div>

        {/* Download button */}
        <button
          onClick={go} disabled={loading||!url.trim()}
          style={{width:"100%",maxWidth:"540px",background:loading||!url.trim()?"#161616":BLUE,color:loading||!url.trim()?"#333":"#fff",border:"none",borderRadius:"13px",padding:"15px",fontSize:"15px",fontFamily:"inherit",fontWeight:600,cursor:loading||!url.trim()?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",transition:"all 0.2s"}}
        >
          {IC.download(17)}{loading?"Working...":"Download"}
        </button>

        {/* Success */}
        {status?.valid&&(
          <div style={{width:"100%",maxWidth:"540px",marginTop:"14px",background:"#0d1a0d",border:"1px solid #1a3a1a",borderRadius:"12px",padding:"14px",display:"flex",alignItems:"center",gap:"12px"}}>
            {status.thumbnail&&<img src={status.thumbnail} alt="" style={{width:"76px",height:"50px",objectFit:"cover",borderRadius:"7px",flexShrink:0}}/>}
            <div style={{minWidth:0}}>
              <div style={{fontSize:"11px",color:"#22c55e",marginBottom:"4px",fontWeight:500,display:"flex",alignItems:"center",gap:"4px"}}>{IC.check(11)} Verified & downloading</div>
              <div style={{fontSize:"13px",color:"#ccc",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{status.title}</div>
              {msg&&<div style={{fontSize:"11px",color:"#facc15",marginTop:"4px"}}>{msg}</div>}
            </div>
          </div>
        )}

        {/* Error */}
        {status&&!status.valid&&(
          <div style={{width:"100%",maxWidth:"540px",marginTop:"14px",background:"#1a0a0a",border:"1px solid #3a1515",borderRadius:"12px",padding:"12px 16px",fontSize:"13px",color:"#f87171"}}>
            {status.error||"Invalid link."}
          </div>
        )}
      </div>

      {/* ── Stats row ── */}
      <div style={{padding:"0 28px 14px",display:"flex",gap:"10px",flexShrink:0}}>
        <StatCard value={String(count)} label="Downloads today"/>
        <StatCard value={String(count)} label="Total downloads"/>
        <StatCard value="0 MB"          label="Storage used"/>
      </div>

      {/* ── Recent bar ── */}
      <div style={{padding:"14px 28px 20px",borderTop:`1px solid ${BORDER}`,background:SURFACE,flexShrink:0}}>
        <div style={{fontSize:"10px",color:"#2e2e2e",letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:"10px"}}>Recent Downloads</div>
        <div style={{display:"flex",gap:"8px"}}>
          {[0,1,2].map(i=><RecentItem key={i} rec={history[i]??null}/>)}
        </div>
      </div>

    </div>
  );
}

// ── Placeholder ───────────────────────────────────────────────────────────────
function Placeholder({title}:{title:string}) {
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"10px"}}>
      <div style={{fontSize:"14px",color:"#2e2e2e",fontWeight:500}}>{title}</div>
      <div style={{fontSize:"12px",color:"#1e1e1e"}}>Coming in a future phase</div>
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [page,setPage] = useState<Page>("downloader");
  const title = page.charAt(0).toUpperCase()+page.slice(1);

  return (
    <div style={{minHeight:"100vh",background:"#0a0a0a",display:"flex",fontFamily:"'DM Sans',-apple-system,sans-serif",color:"#fff"}}>

      {/* Sidebar */}
      <div style={{width:"200px",minWidth:"200px",background:SURFACE,borderRight:`1px solid ${BORDER}`,display:"flex",flexDirection:"column",padding:"24px 0"}}>

        <div style={{padding:"0 20px 22px 20px",borderBottom:`1px solid ${BORDER}`}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:"23px",fontWeight:800,letterSpacing:"-0.5px",color:"#fff"}}>
            GRAB<span style={{color:BLUE}}>IX</span>
          </div>
          <div style={{fontSize:"10px",color:"#2a2a2a",letterSpacing:"2px",textTransform:"uppercase",marginTop:"2px"}}>Media Suite</div>
        </div>

        <div style={{padding:"12px 12px 0 12px",flex:1}}>
          <SLabel text="Main"/>
          {NAV_MAIN.map(item=><NavItem key={item.id} item={item} active={page===item.id} onClick={()=>setPage(item.id as Page)}/>)}
          <SLabel text="Browse"/>
          {NAV_BROWSE.map(item=><NavItem key={item.id} item={item} active={page===item.id} onClick={()=>setPage(item.id as Page)}/>)}
          <SLabel text="App"/>
          {NAV_APP.map(item=><NavItem key={item.id} item={item} active={page===item.id} onClick={()=>setPage(item.id as Page)}/>)}
        </div>

        <div style={{padding:"14px 20px",borderTop:`1px solid ${BORDER}`,display:"flex",alignItems:"center",gap:"10px"}}>
          <div style={{width:"30px",height:"30px",borderRadius:"50%",background:"linear-gradient(135deg,#1d4ed8,#3b82f6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"12px",fontWeight:600,flexShrink:0}}>A</div>
          <div>
            <div style={{fontSize:"13px",color:"#ccc",fontWeight:500}}>Ahsan</div>
            <div style={{fontSize:"10px",color:"#333"}}>Free Plan</div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>

        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"15px 28px",borderBottom:`1px solid ${BORDER}`,flexShrink:0}}>
          <div style={{fontSize:"15px",fontWeight:600,color:"#fff"}}>{title}</div>
          <div style={{display:"flex",gap:"8px"}}>
            {[IC.search,IC.bell].map((ic,i)=>(
              <div key={i} style={{width:"32px",height:"32px",borderRadius:"8px",background:CARD,border:`1px solid ${BORDER}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:DIM}}>
                {ic(15)}
              </div>
            ))}
          </div>
        </div>

        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"auto"}}>
          {page==="downloader"?<DownloaderPage/>:<Placeholder title={title}/>}
        </div>
      </div>
    </div>
  );
}
