import { useState } from "react";
import { IconPlay, IconDownload, IconX } from "../components/Icons";

// ─── Types ────────────────────────────────────────────────────────────────────

type MediaType = "movie" | "tv";
type Tab = "movies" | "anime" | "manga";

interface ContentItem {
  id: number;
  title: string;
  genre: string;
  rating: number;
  year: number;
  thumb: string;
  imdbId?: string;
  tmdbId?: number;
  type: MediaType;
  description?: string;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const MOVIES: ContentItem[] = [
  { id:1,  title:"Dune: Part Two",            genre:"Sci-Fi, Adventure",  rating:8.6, year:2024, thumb:"https://image.tmdb.org/t/p/w300/czembW0Rk1Ke7lCJGahbOhdCuhV.jpg",  imdbId:"tt15239678", tmdbId:693134,  type:"movie", description:"Paul Atreides unites with Chani and the Fremen while seeking revenge against those who destroyed his family." },
  { id:2,  title:"Oppenheimer",                genre:"Drama, History",     rating:8.9, year:2023, thumb:"https://image.tmdb.org/t/p/w300/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",  imdbId:"tt15398776", tmdbId:872585,  type:"movie", description:"The story of J. Robert Oppenheimer's role in the development of the atomic bomb during World War II." },
  { id:3,  title:"The Batman",                 genre:"Action, Crime",      rating:7.9, year:2022, thumb:"https://image.tmdb.org/t/p/w300/74xTEgt7R36Fpooo50r9T25onhq.jpg",  imdbId:"tt1877830",  tmdbId:414906,  type:"movie", description:"Batman ventures into Gotham City's underworld to unmask a serial killer known as the Riddler." },
  { id:4,  title:"Everything Everywhere",      genre:"Sci-Fi, Comedy",     rating:8.0, year:2022, thumb:"https://image.tmdb.org/t/p/w300/w3LxiVYdWWRvEVdn5RYq6jIqkb1.jpg",  imdbId:"tt6710474",  tmdbId:545611,  type:"movie", description:"A middle-aged Chinese immigrant is swept up in an insane adventure where she alone can save existence." },
  { id:5,  title:"Past Lives",                 genre:"Romance, Drama",     rating:7.9, year:2023, thumb:"https://image.tmdb.org/t/p/w300/k3waqVXSnOiJjCTNxCTLzHRTd5.jpg",   imdbId:"tt13238346", tmdbId:932420,  type:"movie", description:"Two childhood sweethearts are reunited in New York City after 20 years apart." },
  { id:6,  title:"Killers of the Flower Moon", genre:"Crime, Drama",       rating:7.7, year:2023, thumb:"https://image.tmdb.org/t/p/w300/dB6aFNuCFjrrPBHYVxpKY2BQWCv.jpg",  imdbId:"tt5537002",  tmdbId:466420,  type:"movie", description:"Members of the Osage Nation are murdered under mysterious circumstances in 1920s Oklahoma." },
  { id:7,  title:"Poor Things",                genre:"Comedy, Sci-Fi",     rating:8.1, year:2023, thumb:"https://image.tmdb.org/t/p/w300/kCGlIMHnOm8JPXIf2iqJDQ4B8jR.jpg",  imdbId:"tt14230458", tmdbId:792307,  type:"movie", description:"The incredible tale about the fantastical evolution of Bella Baxter." },
  { id:8,  title:"Interstellar",               genre:"Sci-Fi, Drama",      rating:8.7, year:2014, thumb:"https://image.tmdb.org/t/p/w300/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",  imdbId:"tt0816692",  tmdbId:157336,  type:"movie", description:"A team of explorers travel through a wormhole in space in an attempt to ensure humanity's survival." },
];

const ANIME: ContentItem[] = [
  { id:101, title:"Jujutsu Kaisen",  genre:"Action, Fantasy",  rating:8.7, year:2020, thumb:"https://image.tmdb.org/t/p/w300/lHu1wtNaczFPGFDTrjCSzeLPTKN.jpg", tmdbId:95479,  type:"tv", description:"A boy swallows a cursed talisman and becomes the host to a powerful curse, entering a school for jujutsu sorcerers." },
  { id:102, title:"Demon Slayer",    genre:"Action, Drama",    rating:8.7, year:2019, thumb:"https://image.tmdb.org/t/p/w300/xUfRZu2mi8jH6SzQEJGP6tjBuYj.jpg", tmdbId:85937,  type:"tv", description:"Tanjiro becomes a demon hunter to save his sister turned demon and avenge his slaughtered family." },
  { id:103, title:"Attack on Titan", genre:"Action, Drama",    rating:9.0, year:2013, thumb:"https://image.tmdb.org/t/p/w300/hTP1DtLGFamjfu8WqjnuQdP1n4i.jpg", tmdbId:1429,   type:"tv", description:"Humanity fights for survival against giant man-eating creatures that have driven them behind massive walls." },
  { id:104, title:"Chainsaw Man",    genre:"Action, Horror",   rating:8.5, year:2022, thumb:"https://image.tmdb.org/t/p/w300/npdB6eFzizki0WaZ1OvKcJRWCEl.jpg", tmdbId:114410, type:"tv", description:"Denji, a young devil hunter, merges with his chainsaw devil dog to become the Chainsaw Man." },
  { id:105, title:"Spy x Family",    genre:"Action, Comedy",   rating:8.4, year:2022, thumb:"https://image.tmdb.org/t/p/w300/oa8IPOEW3bGIkCkKpvEXAGpBFWl.jpg", tmdbId:120089, type:"tv", description:"A spy, an assassin, and a telepath form a fake family — none knowing each other's true identities." },
  { id:106, title:"One Piece",       genre:"Adventure",        rating:8.9, year:1999, thumb:"https://image.tmdb.org/t/p/w300/e3NBGiAifW9Xt8xD5tpARskjccO.jpg", tmdbId:37854,  type:"tv", description:"Monkey D. Luffy sets sail to find the world's greatest treasure and become King of the Pirates." },
];

const MANGA: ContentItem[] = [
  { id:201, title:"Berserk",       genre:"Dark Fantasy", rating:9.4, year:1989, thumb:"https://picsum.photos/seed/berserk9/280/400", type:"movie", description:"Guts, the Black Swordsman, seeks revenge against his former friend Griffith who sacrificed their comrades." },
  { id:202, title:"Vinland Saga",  genre:"Historical",   rating:8.8, year:2005, thumb:"https://picsum.photos/seed/vinland9/280/400", type:"movie", description:"Young Thorfinn seeks revenge against the man who killed his father in a Viking age story of war and redemption." },
  { id:203, title:"Vagabond",      genre:"Samurai",      rating:9.2, year:1998, thumb:"https://picsum.photos/seed/vagabond9/280/400", type:"movie", description:"Based on the legendary swordsman Miyamoto Musashi — a journey for martial mastery and spiritual truth." },
  { id:204, title:"Blue Period",   genre:"Drama",        rating:8.5, year:2017, thumb:"https://picsum.photos/seed/blueperiod9/280/400", type:"movie", description:"A popular delinquent student discovers his passion for art and battles to enter Tokyo's elite art university." },
];

const HEROES: Record<Tab, ContentItem> = {
  movies: MOVIES[1],
  anime:  ANIME[5],
  manga:  MANGA[0],
};

// ─── Player Modal ─────────────────────────────────────────────────────────────

function PlayerModal({ item, onClose }: { item: ContentItem; onClose: () => void }) {
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);

  const getSrc = () => {
    if (item.type === "movie") {
      if (item.imdbId)  return `https://vidsrc.mov/embed/movie/${item.imdbId}`;
      if (item.tmdbId)  return `https://vidsrc.mov/embed/movie/${item.tmdbId}`;
      return null;
    }
    if (item.tmdbId) return `https://vidsrc.mov/embed/tv/${item.tmdbId}/${season}/${episode}`;
    return null;
  };

  const src = getSrc();

  return (
    <div
      style={{ position:"fixed", inset:0, zIndex:1000, background:"rgba(0,0,0,0.94)", display:"flex", flexDirection:"column", animation:"fadeSlideIn 0.2s ease" }}
      onClick={onClose}
    >
      {/* Header bar */}
      <div
        style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 24px", flexShrink:0, borderBottom:"1px solid rgba(255,255,255,0.08)" }}
        onClick={e => e.stopPropagation()}
      >
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:"#fff" }}>{item.title}</div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.45)", marginTop:2 }}>
            {item.type === "tv"
              ? `S${String(season).padStart(2,"0")} E${String(episode).padStart(2,"0")} · via VidSrc`
              : `${item.year} · ${item.genre} · via VidSrc`
            }
          </div>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {/* TV season / episode selectors */}
          {item.type === "tv" && (
            <>
              <select
                value={season}
                onChange={e => setSeason(Number(e.target.value))}
                style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.18)", color:"#fff", borderRadius:8, padding:"7px 12px", fontSize:13, cursor:"pointer", outline:"none" }}
              >
                {Array.from({length:15},(_,i)=>i+1).map(s=>(
                  <option key={s} value={s} style={{background:"#1a1b1e"}}>Season {s}</option>
                ))}
              </select>
              <select
                value={episode}
                onChange={e => setEpisode(Number(e.target.value))}
                style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.18)", color:"#fff", borderRadius:8, padding:"7px 12px", fontSize:13, cursor:"pointer", outline:"none" }}
              >
                {Array.from({length:26},(_,i)=>i+1).map(ep=>(
                  <option key={ep} value={ep} style={{background:"#1a1b1e"}}>Episode {ep}</option>
                ))}
              </select>
            </>
          )}

          {/* Close */}
          <button
            onClick={onClose}
            style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.18)", borderRadius:8, color:"#fff", width:38, height:38, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}
          >
            <IconX size={16} />
          </button>
        </div>
      </div>

      {/* Player area */}
      <div style={{ flex:1, padding:"20px 24px 24px", display:"flex", flexDirection:"column" }} onClick={e=>e.stopPropagation()}>
        {src ? (
          <iframe
            key={`${item.id}-s${season}-e${episode}`}
            src={src}
            style={{ width:"100%", height:"100%", border:"none", borderRadius:12, background:"#000" }}
            allowFullScreen
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16, color:"rgba(255,255,255,0.35)" }}>
            <IconPlay size={52} />
            <div style={{ fontSize:16, fontWeight:500 }}>No stream available</div>
            <div style={{ fontSize:13 }}>This title does not have an IMDB/TMDB ID configured</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Media Card ───────────────────────────────────────────────────────────────

function MediaCard({
  item, onPlay, onDownload, favorites, onToggleFav,
}: {
  item: ContentItem;
  onPlay: (item: ContentItem) => void;
  onDownload: (item: ContentItem) => void;
  favorites: Set<number>;
  onToggleFav: (id: number) => void;
}) {
  const isFav = favorites.has(item.id);
  const [hover, setHover] = useState(false);

  return (
    <div style={{ flexShrink:0, width:140, cursor:"pointer" }}>
      <div
        style={{ position:"relative", width:140, height:200, borderRadius:12, overflow:"hidden", background:"var(--bg-surface2)", marginBottom:8 }}
        onMouseEnter={()=>setHover(true)}
        onMouseLeave={()=>setHover(false)}
      >
        <img
          src={item.thumb}
          alt={item.title}
          style={{ width:"100%", height:"100%", objectFit:"cover", transition:"transform 0.25s", transform:hover?"scale(1.07)":"scale(1)", display:"block" }}
          onError={e=>{ e.currentTarget.src=`https://picsum.photos/seed/${item.id}x7/280/400`; }}
        />

        {/* Rating */}
        <div style={{ position:"absolute", top:8, left:8, fontSize:11, fontWeight:600, padding:"3px 7px", borderRadius:99, background:"rgba(0,0,0,0.75)", color:"#FFD700" }}>
          ★ {item.rating}
        </div>

        {/* Fav indicator */}
        {isFav && (
          <div style={{ position:"absolute", top:8, right:8, fontSize:14 }}>❤️</div>
        )}

        {/* Hover overlay */}
        <div style={{
          position:"absolute", inset:0,
          background:"linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.4) 55%, transparent 100%)",
          display:"flex", flexDirection:"column", justifyContent:"flex-end",
          padding:10, gap:6,
          opacity:hover?1:0, transition:"opacity 0.18s ease",
          pointerEvents:hover?"auto":"none",
        }}>
          {/* Watch */}
          <button
            onClick={e=>{ e.stopPropagation(); onPlay(item); }}
            style={{ width:"100%", padding:"7px 0", background:"var(--accent)", border:"none", borderRadius:8, color:"white", fontSize:12, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}
          >
            <IconPlay size={12} color="white"/> Watch
          </button>

          {/* Download + Fav */}
          <div style={{ display:"flex", gap:6 }}>
            <button
              onClick={e=>{ e.stopPropagation(); onDownload(item); }}
              style={{ flex:1, padding:"6px 0", background:"rgba(255,255,255,0.12)", border:"1px solid rgba(255,255,255,0.2)", borderRadius:8, color:"white", fontSize:11, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}
            >
              <IconDownload size={11} color="white"/> DL
            </button>
            <button
              onClick={e=>{ e.stopPropagation(); onToggleFav(item.id); }}
              style={{ flex:1, padding:"6px 0", background:isFav?"rgba(255,80,80,0.25)":"rgba(255,255,255,0.12)", border:isFav?"1px solid rgba(255,80,80,0.5)":"1px solid rgba(255,255,255,0.2)", borderRadius:8, color:isFav?"#ff6b6b":"white", fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}
            >
              {isFav ? "♥" : "♡"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ fontSize:12, fontWeight:500, color:"var(--text-primary)", width:140, overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>
        {item.title}
      </div>
      <div style={{ fontSize:11, color:"var(--text-muted)", marginTop:2 }}>
        {item.year} · {item.genre.split(",")[0].trim()}
      </div>
    </div>
  );
}

// ─── Hero Banner ──────────────────────────────────────────────────────────────

function HeroBanner({ item, onPlay, onDownload }: { item: ContentItem; onPlay:(i:ContentItem)=>void; onDownload:(i:ContentItem)=>void }) {
  return (
    <div style={{ position:"relative", height:290, borderRadius:16, overflow:"hidden", marginBottom:28 }}>
      <img
        src={item.thumb}
        style={{ width:"100%", height:"100%", objectFit:"cover", opacity:0.5 }}
        onError={e=>{ e.currentTarget.src=`https://picsum.photos/seed/hero${item.id}/1200/400`; }}
      />
      <div style={{ position:"absolute", inset:0, background:"linear-gradient(90deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.35) 60%, transparent 100%)" }}/>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", justifyContent:"flex-end", padding:28 }}>
        <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
          {item.genre.split(",").map(g=>(
            <span key={g} style={{ fontSize:11, padding:"3px 10px", borderRadius:99, border:"1px solid rgba(255,255,255,0.3)", color:"rgba(255,255,255,0.8)" }}>{g.trim()}</span>
          ))}
          <span style={{ fontSize:11, padding:"3px 10px", borderRadius:99, background:"var(--accent)", color:"white", fontWeight:600 }}>★ {item.rating}</span>
        </div>
        <div style={{ fontSize:32, fontWeight:900, color:"#fff", lineHeight:1.1, marginBottom:10, maxWidth:400 }}>{item.title}</div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.6)", marginBottom:18, maxWidth:440, lineHeight:1.65 }}>{item.description}</div>
        <div style={{ display:"flex", gap:10 }}>
          <button
            onClick={()=>onPlay(item)}
            style={{ padding:"9px 20px", borderRadius:10, background:"var(--accent)", border:"none", color:"white", fontSize:13, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:7 }}
          >
            <IconPlay size={14} color="white"/> Watch Now
          </button>
          <button
            onClick={()=>onDownload(item)}
            style={{ padding:"9px 20px", borderRadius:10, background:"rgba(255,255,255,0.12)", border:"1px solid rgba(255,255,255,0.22)", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:7 }}
          >
            <IconDownload size={14} color="white"/> Download
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Media Row ────────────────────────────────────────────────────────────────

function MediaRow({ title, items, onPlay, onDownload, favorites, onToggleFav }: {
  title: string; items: ContentItem[];
  onPlay:(i:ContentItem)=>void; onDownload:(i:ContentItem)=>void;
  favorites: Set<number>; onToggleFav:(id:number)=>void;
}) {
  return (
    <div style={{ marginBottom:28 }}>
      <div style={{ fontSize:14, fontWeight:600, color:"var(--text-primary)", marginBottom:12 }}>{title}</div>
      <div style={{ display:"flex", gap:14, overflowX:"auto", paddingBottom:8, scrollbarWidth:"none" }}>
        {items.map(item=>(
          <MediaCard key={item.id} item={item} onPlay={onPlay} onDownload={onDownload} favorites={favorites} onToggleFav={onToggleFav}/>
        ))}
      </div>
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onClose }: { message:string; onClose:()=>void }) {
  return (
    <div style={{ position:"fixed", bottom:24, right:24, zIndex:2000, background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:12, padding:"13px 18px", boxShadow:"var(--shadow-lg)", display:"flex", alignItems:"center", gap:12, fontSize:13, color:"var(--text-primary)", animation:"fadeSlideIn 0.2s ease", maxWidth:360 }}>
      <IconDownload size={16} color="var(--text-accent)"/>
      <span style={{ flex:1 }}>{message}</span>
      <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--text-muted)", cursor:"pointer", display:"flex" }}><IconX size={14}/></button>
    </div>
  );
}

// ─── BrowsePage ───────────────────────────────────────────────────────────────

export default function BrowsePage() {
  const [tab, setTab]         = useState<Tab>("movies");
  const [playing, setPlaying] = useState<ContentItem | null>(null);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [toast, setToast]     = useState<string | null>(null);

  const toggleFav = (id: number) => {
    setFavorites(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDownload = (item: ContentItem) => {
    setToast(`"${item.title}" queued — open Downloader to track progress.`);
    setTimeout(() => setToast(null), 4000);
  };

  const TABS = [
    { id:"movies" as Tab, label:"🎬 Movies" },
    { id:"anime"  as Tab, label:"🎌 Anime"  },
    { id:"manga"  as Tab, label:"📚 Manga"  },
  ];

  const hero = HEROES[tab];

  return (
    <>
      <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>

        {/* Top bar */}
        <div style={{ padding:"14px 24px", borderBottom:"1px solid var(--border)", background:"var(--bg-surface)", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <div style={{ fontSize:16, fontWeight:600 }}>Browse</div>
            <div style={{ fontSize:12, color:"var(--text-muted)", marginTop:1 }}>Stream or download movies, anime &amp; manga</div>
          </div>
          {favorites.size > 0 && (
            <div style={{ fontSize:12, color:"var(--text-muted)", display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ color:"#ff6b6b" }}>♥</span> {favorites.size} saved
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:8, padding:"12px 24px", borderBottom:"1px solid var(--border)", background:"var(--bg-surface)", flexShrink:0 }}>
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{ padding:"7px 18px", borderRadius:99, fontSize:13, fontWeight:500, cursor:"pointer", border:"none", background:tab===id?"var(--accent)":"var(--bg-surface2)", color:tab===id?"white":"var(--text-secondary)", transition:"all 0.15s ease" }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div style={{ flex:1, overflowY:"auto", padding:24, scrollbarWidth:"thin" }} className="fade-in" key={tab}>

          {tab === "movies" && (
            <>
              <HeroBanner item={hero} onPlay={setPlaying} onDownload={handleDownload}/>
              <MediaRow title="Now Popular" items={MOVIES}                                         onPlay={setPlaying} onDownload={handleDownload} favorites={favorites} onToggleFav={toggleFav}/>
              <MediaRow title="Top Rated"   items={[...MOVIES].sort((a,b)=>b.rating-a.rating)}    onPlay={setPlaying} onDownload={handleDownload} favorites={favorites} onToggleFav={toggleFav}/>
            </>
          )}

          {tab === "anime" && (
            <>
              <HeroBanner item={hero} onPlay={setPlaying} onDownload={handleDownload}/>
              <MediaRow title="Trending Now" items={ANIME}                                        onPlay={setPlaying} onDownload={handleDownload} favorites={favorites} onToggleFav={toggleFav}/>
              <MediaRow title="Top Rated"    items={[...ANIME].sort((a,b)=>b.rating-a.rating)}   onPlay={setPlaying} onDownload={handleDownload} favorites={favorites} onToggleFav={toggleFav}/>
            </>
          )}

          {tab === "manga" && (
            <>
              <HeroBanner item={hero} onPlay={()=>{}} onDownload={handleDownload}/>
              <div style={{ padding:"14px 18px", borderRadius:10, background:"var(--bg-surface)", border:"1px solid var(--border)", marginBottom:24, fontSize:13, color:"var(--text-secondary)", lineHeight:1.6 }}>
                📖 <strong>Manga reader</strong> (MangaDex) is coming in Phase 5. You can save titles to favorites for now.
              </div>
              <MediaRow title="Popular Manga" items={MANGA} onPlay={()=>{}} onDownload={handleDownload} favorites={favorites} onToggleFav={toggleFav}/>
            </>
          )}

        </div>
      </div>

      {playing && <PlayerModal item={playing} onClose={()=>setPlaying(null)}/>}
      {toast    && <Toast message={toast} onClose={()=>setToast(null)}/>}
    </>
  );
}
