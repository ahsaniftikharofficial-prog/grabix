import { useState, useEffect, useRef } from "react";
type Page="downloader"|"library"|"settings";
type DLType="video"|"audio"|"thumbnail"|"subtitle";
interface VideoInfo{valid:boolean;title?:string;thumbnail?:string;duration?:number;channel?:string;error?:string;formats?:{height:number;label:string}[];}
interface DLStatus{status:string;percent:number;speed:string;eta:string;error?:string;}
const B="http://127.0.0.1:8000";
const Ico={
  down:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  lib:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>,
  gear:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  sun:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  moon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  clip:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>,
  eye:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  cut:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>,
  folder:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
};
function Logo(){return(<div style={{display:"flex",alignItems:"center",gap:"9px",userSelect:"none"}}><svg width="26" height="26" viewBox="0 0 26 26" fill="none"><rect width="26" height="26" rx="7" fill="#2563EB"/><path d="M6.5 13.5L11 18L19.5 8" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg><span style={{fontSize:"14px",fontWeight:700,letterSpacing:"0.16em",color:"white"}}>GRABIX</span></div>);}
function Toggle({value,onChange}:{value:boolean;onChange:(v:boolean)=>void}){return(<button onClick={()=>onChange(!value)} style={{width:"38px",height:"21px",borderRadius:"11px",background:value?"#2563EB":"#374151",border:"none",cursor:"pointer",position:"relative",transition:"background 0.2s",flexShrink:0}}><span style={{position:"absolute",top:"2.5px",left:value?"19px":"2.5px",width:"16px",height:"16px",borderRadius:"50%",background:"white",transition:"left 0.18s"}}/></button>);}
export default function App(){
  const[page,setPage]=useState<Page>("downloader");
  const[dark,setDark]=useState(true);
  const[url,setUrl]=useState("");
  const[info,setInfo]=useState<VideoInfo|null>(null);
  const[loading,setLoading]=useState(false);
  const[dlType,setDlType]=useState<DLType>("video");
  const[quality,setQuality]=useState("best");
  const[audioFmt,setAudioFmt]=useState("mp3");
  const[audioQ,setAudioQ]=useState("192");
  const[subLang,setSubLang]=useState("en");
  const[thumbFmt,setThumbFmt]=useState("jpg");
  const[trim,setTrim]=useState(false);
  const[trimS,setTrimS]=useState(0);
  const[trimE,setTrimE]=useState(300);
  const[dlId,setDlId]=useState<string|null>(null);
  const[dlStatus,setDlStatus]=useState<DLStatus|null>(null);
  const pollRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const[history,setHistory]=useState<any[]>([]);
  const[s,setS]=useState({folder:"~/Downloads/GRABIX",maxConcurrent:3,naming:"%(title)s.%(ext)s",defaultQ:"best",defaultAudio:"mp3",autoPaste:true,notify:true,embedThumb:true,embedSubs:false,proxy:false});
  useEffect(()=>{
    if(!dlId)return;
    pollRef.current=setInterval(async()=>{
      try{const r=await fetch(`${B}/download-status/${dlId}`);const d:DLStatus=await r.json();setDlStatus(d);if(d.status==="done"||d.status==="failed")clearInterval(pollRef.current!);}catch{clearInterval(pollRef.current!);}
    },1500);
    return()=>clearInterval(pollRef.current!);
  },[dlId]);
  const fetchHistory=async()=>{try{const r=await fetch(`${B}/history`);setHistory(await r.json());}catch{}};
  useEffect(()=>{if(page==="library")fetchHistory();},[page]);
  const handlePaste=async()=>{try{const t=await navigator.clipboard.readText();setUrl(t);setInfo(null);setDlStatus(null);}catch{}};
  const handlePreview=async()=>{
    if(!url.trim())return;
    setLoading(true);setInfo(null);setDlStatus(null);setDlId(null);
    try{const r=await fetch(`${B}/check-link?url=${encodeURIComponent(url)}`);const d=await r.json();setInfo(d);if(d.valid&&d.duration){setTrimS(0);setTrimE(d.duration);}}
    catch{setInfo({valid:false,error:"Cannot connect to backend. Run: uvicorn main:app --reload"});}
    setLoading(false);
  };
  const handleDownload=async()=>{
    if(!info?.valid)return;
    const p=new URLSearchParams({url,dl_type:dlType,quality,audio_format:audioFmt,audio_quality:audioQ,subtitle_lang:subLang,thumbnail_format:thumbFmt,trim_enabled:String(trim),trim_start:String(trimS),trim_end:String(trimE)});
    try{const r=await fetch(`${B}/download?${p}`,{method:"POST"});const d=await r.json();setDlId(d.id);setDlStatus({status:"queued",percent:0,speed:"",eta:""});}
    catch{setDlStatus({status:"failed",percent:0,speed:"",eta:"",error:"Backend unreachable"});}
  };
  const ft=(sec:number)=>`${Math.floor(sec/60)}:${String(Math.round(sec%60)).padStart(2,"0")}`;
  const c={
    bg:dark?"#070710":"#f0f0f7",side:dark?"#0a0a16":"#ffffff",sideBrd:dark?"#14142a":"#e2e2ec",
    surf:dark?"#0e0e1e":"#ffffff",surfBrd:dark?"#181830":"#e2e2ec",
    inp:dark?"#0a0a16":"#f7f7fc",inpBrd:dark?"#1a1a34":"#d0d0e0",
    tx:dark?"#e8e8f4":"#111120",muted:dark?"#525270":"#7070a0",divider:dark?"#141428":"#e2e2ec",
    nav:dark?"#606080":"#8080a0",btnBg:dark?"#111124":"#f0f0f7",btnBrd:dark?"#222244":"#d0d0e0",btnTx:dark?"#9090b8":"#404060",
    blue:"#2563EB",orange:"#f97316",
    oDim:dark?"#1a0e05":"#fff7ed",oBrd:dark?"#4d2500":"#fdba74",oTx:dark?"#fb923c":"#c2410c",
    green:"#22c55e",red:dark?"#f87171":"#dc2626",
    errBg:dark?"rgba(239,68,68,0.07)":"#fef2f2",errBrd:dark?"rgba(239,68,68,0.2)":"#fecaca",
  };
  const inp:React.CSSProperties={background:c.inp,border:`1px solid ${c.inpBrd}`,color:c.tx,borderRadius:"9px",padding:"8px 11px",fontSize:"13px",outline:"none"};
  const navItems=[{id:"downloader" as Page,label:"Downloader",icon:Ico.down},{id:"library" as Page,label:"Library",icon:Ico.lib},{id:"settings" as Page,label:"Settings",icon:Ico.gear}];
  const types=[{id:"video" as DLType,label:"Video"},{id:"audio" as DLType,label:"Audio"},{id:"thumbnail" as DLType,label:"Thumbnail"},{id:"subtitle" as DLType,label:"Subtitle"}];
  const sColor=dlStatus?.status==="done"?c.green:dlStatus?.status==="failed"?c.red:c.blue;
  return(
    <div style={{display:"flex",height:"100vh",overflow:"hidden",background:c.bg,color:c.tx,fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif"}}>
      <aside style={{width:"190px",flexShrink:0,display:"flex",flexDirection:"column",background:c.side,borderRight:`1px solid ${c.sideBrd}`}}>
        <div style={{padding:"18px 14px 12px"}}><Logo/></div>
        <nav style={{flex:1,padding:"4px 8px",display:"flex",flexDirection:"column",gap:"2px"}}>
          {navItems.map(n=>{const a=page===n.id;return(<button key={n.id} onClick={()=>setPage(n.id)} style={{display:"flex",alignItems:"center",gap:"9px",padding:"9px 11px",borderRadius:"9px",border:"none",cursor:"pointer",width:"100%",textAlign:"left",fontSize:"13px",fontWeight:a?600:400,background:a?"#2563EB":"transparent",color:a?"#fff":c.nav,transition:"all 0.15s"}}>{n.icon}{n.label}</button>);})}
        </nav>
        <div style={{padding:"8px",borderTop:`1px solid ${c.sideBrd}`}}>
          <button onClick={()=>setDark(!dark)} style={{display:"flex",alignItems:"center",gap:"9px",padding:"9px 11px",borderRadius:"9px",border:"none",cursor:"pointer",width:"100%",fontSize:"13px",background:"transparent",color:c.nav}}>{dark?Ico.sun:Ico.moon}{dark?"Light Mode":"Dark Mode"}</button>
          <p style={{textAlign:"center",fontSize:"10px",color:c.muted,margin:"6px 0 2px"}}>v0.1.0 · Phase 1</p>
        </div>
      </aside>
      <main style={{flex:1,overflowY:"auto"}}>
        {page==="downloader"&&(
          <div style={{maxWidth:"660px",margin:"0 auto",padding:"34px 24px"}}>
            <h1 style={{margin:"0 0 2px",fontSize:"20px",fontWeight:700}}>Downloader</h1>
            <p style={{margin:"0 0 24px",fontSize:"13px",color:c.muted}}>Paste any video link to preview and download</p>
            <div style={{background:c.surf,border:`1px solid ${c.surfBrd}`,borderRadius:"15px",padding:"12px"}}>
              <div style={{display:"flex",gap:"7px",alignItems:"center"}}>
                <input type="text" value={url} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handlePreview()} placeholder="https://youtube.com/watch?v=..." style={{flex:1,...inp,fontSize:"14px",padding:"11px 14px",borderRadius:"10px"}}/>
                <button onClick={handlePaste} style={{display:"flex",alignItems:"center",gap:"5px",padding:"11px 13px",borderRadius:"10px",background:c.btnBg,border:`1px solid ${c.btnBrd}`,color:c.btnTx,fontSize:"13px",fontWeight:500,cursor:"pointer",whiteSpace:"nowrap"}}>{Ico.clip} Paste</button>
                <button onClick={handlePreview} disabled={loading||!url.trim()} style={{display:"flex",alignItems:"center",gap:"5px",padding:"11px 15px",borderRadius:"10px",background:!url.trim()||loading?"#1a2f6b":c.blue,border:"none",color:"white",fontSize:"13px",fontWeight:600,cursor:!url.trim()?"not-allowed":"pointer",whiteSpace:"nowrap",opacity:!url.trim()?0.5:1}}>{Ico.eye}{loading?"Loading…":"Preview"}</button>
              </div>
            </div>
            {info?.valid&&(
              <div style={{marginTop:"10px",background:c.surf,border:`1px solid ${c.surfBrd}`,borderRadius:"15px",overflow:"hidden"}}>
                <div style={{display:"flex",gap:"12px",padding:"14px"}}>
                  {info.thumbnail&&<img src={info.thumbnail} alt="" style={{width:"130px",height:"76px",objectFit:"cover",borderRadius:"9px",flexShrink:0}}/>}
                  <div style={{flex:1,minWidth:0}}>
                    <p style={{margin:"0 0 3px",fontSize:"14px",fontWeight:600,lineHeight:1.4,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{info.title}</p>
                    <p style={{margin:0,fontSize:"12px",color:c.muted}}>{info.channel}</p>
                    {info.duration&&<p style={{margin:"2px 0 0",fontSize:"12px",color:c.muted}}>{ft(info.duration)}</p>}
                    <div style={{display:"flex",alignItems:"center",gap:"5px",marginTop:"7px"}}><span style={{width:"6px",height:"6px",borderRadius:"50%",background:c.green}}/><span style={{fontSize:"11px",color:c.green,fontWeight:500}}>Ready</span></div>
                  </div>
                </div>
                <div style={{borderTop:`1px solid ${c.divider}`}}/>
                <div style={{padding:"14px"}}>
                  <p style={{margin:"0 0 9px",fontSize:"11px",fontWeight:600,color:c.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Download As</p>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:"7px"}}>
                    {types.map(t=>{const a=dlType===t.id;return(<button key={t.id} onClick={()=>{setDlType(t.id);setTrim(false);}} style={{padding:"9px 6px",borderRadius:"9px",border:`1px solid ${a?c.blue:c.btnBrd}`,background:a?c.blue:c.btnBg,color:a?"#fff":c.btnTx,fontSize:"12px",fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>{t.label}</button>);})}
                  </div>
                </div>
                <div style={{borderTop:`1px solid ${c.divider}`}}/>
                <div style={{padding:"14px",display:"flex",flexDirection:"column",gap:"11px"}}>
                  {dlType==="video"&&<>
                    <div style={{display:"flex",gap:"9px",alignItems:"flex-end"}}>
                      <div style={{flex:1}}>
                        <label style={{display:"block",fontSize:"11px",color:c.muted,marginBottom:"5px"}}>Quality</label>
                        <select value={quality} onChange={e=>setQuality(e.target.value)} style={{...inp,width:"100%"}}>
                          <option value="best">Best Available</option>
                          {(info.formats||[]).map(f=><option key={f.height} value={`${f.height}p`}>{f.label}</option>)}
                          <option value="1080p">1080p</option><option value="720p">720p</option><option value="480p">480p</option><option value="360p">360p</option>
                        </select>
                      </div>
                      <button onClick={()=>setTrim(!trim)} style={{display:"flex",alignItems:"center",gap:"5px",padding:"8px 13px",borderRadius:"9px",border:`1px solid ${trim?c.oBrd:c.btnBrd}`,background:trim?c.oDim:c.btnBg,color:trim?c.oTx:c.btnTx,fontSize:"12px",fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>{Ico.cut}{trim?"Trim On":"Trim"}</button>
                    </div>
                    {trim&&(
                      <div style={{background:c.oDim,border:`1px solid ${c.oBrd}`,borderRadius:"11px",padding:"13px",display:"flex",flexDirection:"column",gap:"10px"}}>
                        <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:"12px",fontWeight:600,color:c.oTx}}>Trim Clip</span><span style={{fontSize:"12px",color:c.oTx,fontFamily:"monospace"}}>{ft(trimS)} → {ft(trimE)}</span></div>
                        {([["Start",trimS,setTrimS,0,trimE-1],["End",trimE,setTrimE,trimS+1,info.duration||7200]] as any[]).map(([label,val,setter,min,max])=>(
                          <div key={label}><div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}><span style={{fontSize:"11px",color:c.muted}}>{label}</span><span style={{fontSize:"11px",color:c.oTx,fontFamily:"monospace"}}>{ft(val)}</span></div><input type="range" min={min} max={max} value={val} onChange={e=>setter(Number(e.target.value))} style={{width:"100%",accentColor:c.orange}}/></div>
                        ))}
                        <p style={{margin:0,fontSize:"11px",color:c.muted}}>Trimmed locally with FFmpeg — no upload.</p>
                      </div>
                    )}
                  </>}
                  {dlType==="audio"&&<div style={{display:"flex",gap:"9px"}}>
                    <div style={{flex:1}}><label style={{display:"block",fontSize:"11px",color:c.muted,marginBottom:"5px"}}>Format</label><select value={audioFmt} onChange={e=>setAudioFmt(e.target.value)} style={{...inp,width:"100%"}}><option value="mp3">MP3</option><option value="m4a">M4A</option><option value="flac">FLAC</option><option value="wav">WAV</option><option value="opus">Opus</option></select></div>
                    <div style={{flex:1}}><label style={{display:"block",fontSize:"11px",color:c.muted,marginBottom:"5px"}}>Bitrate</label><select value={audioQ} onChange={e=>setAudioQ(e.target.value)} style={{...inp,width:"100%"}}><option value="320">320 kbps</option><option value="192">192 kbps</option><option value="128">128 kbps</option><option value="96">96 kbps</option></select></div>
                  </div>}
                  {dlType==="thumbnail"&&<div><label style={{display:"block",fontSize:"11px",color:c.muted,marginBottom:"5px"}}>Format</label><select value={thumbFmt} onChange={e=>setThumbFmt(e.target.value)} style={{...inp,width:"150px"}}><option value="jpg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option></select></div>}
                  {dlType==="subtitle"&&<div style={{display:"flex",gap:"9px"}}>
                    <div style={{flex:1}}><label style={{display:"block",fontSize:"11px",color:c.muted,marginBottom:"5px"}}>Language</label><select value={subLang} onChange={e=>setSubLang(e.target.value)} style={{...inp,width:"100%"}}><option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="ja">Japanese</option><option value="ar">Arabic</option><option value="ur">Urdu</option><option value="zh">Chinese</option><option value="ko">Korean</option></select></div>
                    <div style={{flex:1}}><label style={{display:"block",fontSize:"11px",color:c.muted,marginBottom:"5px"}}>Format</label><select style={{...inp,width:"100%"}}><option>SRT</option><option>VTT</option><option>ASS</option></select></div>
                  </div>}
                  <button onClick={handleDownload} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"7px",padding:"12px",borderRadius:"11px",border:"none",background:c.blue,color:"white",fontSize:"14px",fontWeight:600,cursor:"pointer",width:"100%"}}>{Ico.down} Download {dlType}</button>
                  {dlStatus&&(
                    <div style={{background:c.surf,border:`1px solid ${c.surfBrd}`,borderRadius:"10px",padding:"12px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"7px"}}>
                        <span style={{fontSize:"12px",fontWeight:600,color:sColor,textTransform:"capitalize"}}>{dlStatus.status}</span>
                        <span style={{fontSize:"12px",color:c.muted,fontFamily:"monospace"}}>{dlStatus.percent>0?`${dlStatus.percent}%`:""}{dlStatus.speed?` · ${dlStatus.speed}`:""}{dlStatus.eta?` · ETA ${dlStatus.eta}`:""}</span>
                      </div>
                      <div style={{height:"5px",borderRadius:"3px",background:c.btnBg,overflow:"hidden"}}><div style={{height:"100%",width:`${dlStatus.percent}%`,background:dlStatus.status==="done"?c.green:dlStatus.status==="failed"?c.red:c.blue,borderRadius:"3px",transition:"width 0.4s"}}/></div>
                      {dlStatus.error&&<p style={{margin:"6px 0 0",fontSize:"11px",color:c.red}}>{dlStatus.error}</p>}
                    </div>
                  )}
                </div>
              </div>
            )}
            {info&&!info.valid&&<div style={{marginTop:"10px",padding:"13px 15px",background:c.errBg,border:`1px solid ${c.errBrd}`,borderRadius:"11px"}}><p style={{margin:0,fontSize:"13px",color:c.red}}>{info.error}</p></div>}
          </div>
        )}
        {page==="library"&&(
          <div style={{maxWidth:"660px",margin:"0 auto",padding:"34px 24px"}}>
            <h1 style={{margin:"0 0 2px",fontSize:"20px",fontWeight:700}}>Library</h1>
            <p style={{margin:"0 0 20px",fontSize:"13px",color:c.muted}}>Your download history</p>
            {history.length===0?<p style={{color:c.muted,fontSize:"13px"}}>No downloads yet. Go grab something!</p>:history.map(h=>(
              <div key={h.id} style={{display:"flex",gap:"11px",alignItems:"center",padding:"11px",background:c.surf,border:`1px solid ${c.surfBrd}`,borderRadius:"12px",marginBottom:"8px"}}>
                {h.thumbnail&&<img src={h.thumbnail} alt="" style={{width:"72px",height:"42px",objectFit:"cover",borderRadius:"6px",flexShrink:0}}/>}
                <div style={{flex:1,minWidth:0}}>
                  <p style={{margin:"0 0 2px",fontSize:"13px",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.title}</p>
                  <div style={{display:"flex",gap:"8px"}}><span style={{fontSize:"11px",color:c.muted,textTransform:"uppercase"}}>{h.dl_type}</span><span style={{fontSize:"11px",color:h.status==="done"?c.green:h.status==="failed"?c.red:c.blue,fontWeight:500}}>{h.status}</span><span style={{fontSize:"11px",color:c.muted}}>{h.created_at?.slice(0,10)}</span></div>
                </div>
              </div>
            ))}
          </div>
        )}
        {page==="settings"&&(
          <div style={{maxWidth:"640px",margin:"0 auto",padding:"34px 24px"}}>
            <h1 style={{margin:"0 0 2px",fontSize:"20px",fontWeight:700}}>Settings</h1>
            <p style={{margin:"0 0 22px",fontSize:"13px",color:c.muted}}>Configure GRABIX</p>
            {([
              {title:"Downloads",rows:[
                {label:"Download Folder",desc:"Where files are saved",ctrl:<div style={{display:"flex",alignItems:"center",gap:"5px"}}>{Ico.folder}<input type="text" value={s.folder} onChange={e=>setS(p=>({...p,folder:e.target.value}))} style={{...inp,width:"180px"}}/></div>},
                {label:"Max Concurrent",desc:"Downloads at same time",ctrl:<select value={s.maxConcurrent} onChange={e=>setS(p=>({...p,maxConcurrent:Number(e.target.value)}))} style={inp}>{[1,2,3,4,5].map(n=><option key={n}>{n}</option>)}</select>},
                {label:"File Naming Template",desc:"yt-dlp output template",ctrl:<input type="text" value={s.naming} onChange={e=>setS(p=>({...p,naming:e.target.value}))} style={{...inp,width:"200px",fontFamily:"monospace"}}/>},
              ]},
              {title:"Defaults",rows:[
                {label:"Default Video Quality",desc:"Pre-selected quality",ctrl:<select value={s.defaultQ} onChange={e=>setS(p=>({...p,defaultQ:e.target.value}))} style={inp}><option value="best">Best</option><option>1080p</option><option>720p</option><option>480p</option></select>},
                {label:"Default Audio Format",desc:"Format for extractions",ctrl:<select value={s.defaultAudio} onChange={e=>setS(p=>({...p,defaultAudio:e.target.value}))} style={inp}><option>MP3</option><option>M4A</option><option>FLAC</option><option>WAV</option></select>},
              ]},
              {title:"Behavior",rows:[
                {label:"Auto-paste from Clipboard",desc:"Fill URL when app opens",ctrl:<Toggle value={s.autoPaste} onChange={v=>setS(p=>({...p,autoPaste:v}))}/>},
                {label:"Notify on Complete",desc:"System notification",ctrl:<Toggle value={s.notify} onChange={v=>setS(p=>({...p,notify:v}))}/>},
                {label:"Embed Thumbnail in Audio",desc:"Cover art in MP3/M4A",ctrl:<Toggle value={s.embedThumb} onChange={v=>setS(p=>({...p,embedThumb:v}))}/>},
                {label:"Embed Subtitles in Video",desc:"Burn subs into video",ctrl:<Toggle value={s.embedSubs} onChange={v=>setS(p=>({...p,embedSubs:v}))}/>},
                {label:"Use Proxy",desc:"Route via proxy",ctrl:<Toggle value={s.proxy} onChange={v=>setS(p=>({...p,proxy:v}))}/>},
              ]},
              {title:"Appearance",rows:[
                {label:"Theme",desc:"Dark or light interface",ctrl:<div style={{display:"flex",gap:"6px"}}>{["Dark","Light"].map(t=><button key={t} onClick={()=>setDark(t==="Dark")} style={{padding:"6px 13px",borderRadius:"8px",border:`1px solid ${(t==="Dark")===dark?c.blue:c.btnBrd}`,background:(t==="Dark")===dark?c.blue:c.btnBg,color:(t==="Dark")===dark?"#fff":c.btnTx,fontSize:"12px",fontWeight:600,cursor:"pointer"}}>{t}</button>)}</div>},
              ]},
            ] as any[]).map((sec:any)=>(
              <div key={sec.title} style={{marginBottom:"14px",background:c.surf,border:`1px solid ${c.surfBrd}`,borderRadius:"14px",overflow:"hidden"}}>
                <div style={{padding:"12px 18px",borderBottom:`1px solid ${c.divider}`}}><p style={{margin:0,fontSize:"13px",fontWeight:600}}>{sec.title}</p></div>
                {sec.rows.map((row:any,i:number)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 18px",gap:"14px",borderTop:i===0?"none":`1px solid ${c.divider}`}}>
                    <div><p style={{margin:0,fontSize:"13px",fontWeight:500}}>{row.label}</p><p style={{margin:"1px 0 0",fontSize:"12px",color:c.muted}}>{row.desc}</p></div>
                    <div style={{flexShrink:0}}>{row.ctrl}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
