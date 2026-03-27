// grabix-ui/src/pages/AnimePage.tsx
// Updated: Play (VidSrc via TMDB ID), Download, Favorite

import { useState, useEffect } from "react";
import { IconSearch, IconStar, IconPlay, IconDownload, IconX, IconRefresh, IconCheck } from "../components/Icons";
import { IconHeart } from "../components/Icons";
import { useFavorites } from "../context/FavoritesContext";
import VidSrcPlayer from "../components/VidSrcPlayer";
import { getAnimeSources, type StreamSource } from "../lib/streamProviders";

const JIKAN  = "https://api.jikan.moe/v4";
const GRABIX = "http://127.0.0.1:8000";
const TMDB   = "https://api.themoviedb.org/3";
const TMDB_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI5OTk3Y2E5ZjY2NGZhZmI5ZWJkZmNhNDMyNGY0YTBmOCIsIm5iZiI6MTc3NDU2NDcyMC44NDYwMDAyLCJzdWIiOiI2OWM1YjU3MGE4NTBkNjcxOTE4OWJjN2MiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.uv8_l7Ub7WRhSfWtd07Sx_Yg13jubgyU7953kJZy7mw";
interface Anime {
  mal_id: number; title: string; title_english?: string;
  images: { jpg: { image_url: string; large_image_url?: string } };
  synopsis?: string; score?: number; episodes?: number;
  status?: string; genres?: { name: string }[];
  year?: number; trailer?: { embed_url?: string }; url?: string;
}

type Tab = "trending" | "toprated" | "seasonal";

// Search TMDB for the anime show to get a TMDB ID for VidSrc
async function findTmdbId(title: string): Promise<number | null> {
  try {
    const r = await fetch(`${TMDB}/search/tv?query=${encodeURIComponent(title)}`, {
      headers: { "Authorization": `Bearer ${TMDB_TOKEN}` }
    });
    const d = await r.json();
    return d.results?.[0]?.id ?? null;
  } catch { return null; }
}

export default function AnimePage() {
  const [tab, setTab]         = useState<Tab>("trending");
  const [items, setItems]     = useState<Anime[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [query, setQuery]     = useState("");
  const [detail, setDetail]   = useState<Anime | null>(null);
  const [player, setPlayer]   = useState<{ title: string; subtitle?: string; poster?: string; sources: StreamSource[] } | null>(null);
  const [page, setPage]       = useState(1);

  const fetchList = async (t: Tab, p = 1) => {
    setLoading(true);
    try {
      const urls: Record<Tab, string> = {
        trending:  `${JIKAN}/top/anime?filter=airing&page=${p}&limit=20`,
        toprated:  `${JIKAN}/top/anime?page=${p}&limit=20`,
        seasonal:  `${JIKAN}/seasons/now?page=${p}&limit=20`,
      };
      const d = await (await fetch(urls[t])).json();
      setItems(p === 1 ? (d.data ?? []) : prev => [...prev, ...(d.data ?? [])]);
    } catch { setItems([]); } finally { setLoading(false); }
  };

  const fetchSearch = async (q: string, p = 1) => {
    setLoading(true);
    try {
      const d = await (await fetch(`${JIKAN}/anime?q=${encodeURIComponent(q)}&page=${p}&limit=20&sfw=true`)).json();
      setItems(p === 1 ? (d.data ?? []) : prev => [...prev, ...(d.data ?? [])]);
    } catch { setItems([]); } finally { setLoading(false); }
  };

  useEffect(() => {
    setPage(1);
    if (query) fetchSearch(query, 1); else fetchList(tab, 1);
  }, [tab, query]);

  const loadMore = () => { const n = page + 1; setPage(n); if (query) fetchSearch(query, n); else fetchList(tab, n); };

  const TABS: { id: Tab; label: string }[] = [
    { id: "trending", label: "Trending" },
    { id: "toprated", label: "Top Rated" },
    { id: "seasonal", label: "This Season" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Anime</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>Browse · Stream · Download</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}><IconSearch size={13} color="var(--text-muted)" /></div>
            <input className="input-base" style={{ paddingLeft: 32, width: 220, fontSize: 13 }} placeholder="Search anime…" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && (search.trim() ? setQuery(search.trim()) : setQuery(""))} />
          </div>
          <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={() => search.trim() ? setQuery(search.trim()) : setQuery("")}>Search</button>
          {query && <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => { setQuery(""); setSearch(""); }}><IconX size={13} /> Clear</button>}
        </div>
      </div>

      {!query && (
        <div style={{ display: "flex", gap: 4, padding: "10px 24px 0", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "7px 16px", fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer", background: "transparent", borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent", color: tab === t.id ? "var(--accent)" : "var(--text-muted)", transition: "var(--transition)", borderRadius: 0 }}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {loading && items.length === 0 ? <LoadingGrid /> : items.length === 0 ? (
          <div className="empty-state"><IconSearch size={36} /><p>No results</p></div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
              {items.map(a => <AnimeCard key={a.mal_id} anime={a} onClick={() => setDetail(a)} />)}
            </div>
            <div style={{ textAlign: "center", marginTop: 24 }}>
              <button className="btn btn-ghost" style={{ gap: 6 }} onClick={loadMore} disabled={loading}><IconRefresh size={14} /> Load more</button>
            </div>
          </>
        )}
      </div>

      {detail && !player && (
        <AnimeDetail
          anime={detail}
          onClose={() => setDetail(null)}
          onPlay={(nextPlayer) => { setDetail(null); setPlayer(nextPlayer); }}
        />
      )}
      {player && <VidSrcPlayer title={player.title} subtitle={player.subtitle} poster={player.poster} sources={player.sources} onClose={() => setPlayer(null)} />}
    </div>
  );
}

function AnimeCard({ anime, onClick }: { anime: Anime; onClick: () => void }) {
  return (
    <div className="card" style={{ overflow: "hidden", cursor: "pointer", transition: "transform 0.15s" }} onClick={onClick} onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-3px)")} onMouseLeave={e => (e.currentTarget.style.transform = "translateY(0)")}>
      <div style={{ position: "relative" }}>
        <img src={anime.images.jpg.large_image_url ?? anime.images.jpg.image_url} alt={anime.title} style={{ width: "100%", height: 210, objectFit: "cover" }} onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/150x210?text=No+Image"; }} />
        {anime.score && <div style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.75)", color: "#fdd663", fontSize: 11, padding: "2px 7px", borderRadius: 6, display: "flex", alignItems: "center", gap: 3, fontWeight: 600 }}><IconStar size={10} color="#fdd663" /> {anime.score}</div>}
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{anime.title_english ?? anime.title}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{anime.episodes ? `${anime.episodes} eps` : anime.status ?? "—"}</div>
      </div>
    </div>
  );
}

function AnimeDetail({ anime, onClose, onPlay }: { anime: Anime; onClose: () => void; onPlay: (player: { title: string; subtitle?: string; poster?: string; sources: StreamSource[] }) => void }) {
  const [dlUrl, setDlUrl]       = useState("");
  const [sending, setSending]   = useState(false);
  const [sent, setSent]         = useState(false);
  const [finding, setFinding]   = useState(false);
  const [tmdbId, setTmdbId]     = useState<number | null>(null);
  const { isFav, toggle }       = useFavorites();
  const fav = isFav(`anime-${anime.mal_id}`);
  const title = anime.title_english ?? anime.title;

  // Try to find TMDB ID on open
  useEffect(() => {
    setFinding(true);
    findTmdbId(title).then(id => { setTmdbId(id); setFinding(false); });
  }, [anime.mal_id]);

  const handlePlay = () => {
    const sources = getAnimeSources(tmdbId, anime.trailer?.embed_url);

    if (sources.length > 0) {
      onPlay({
        title,
        subtitle: "Anime playback powered by your configured stream providers",
        poster: anime.images.jpg.large_image_url ?? anime.images.jpg.image_url,
        sources,
      });
    } else {
      alert("Stream not available for this title. Try the trailer or paste an episode URL below.");
    }
  };

  const sendDl = async () => {
    if (!dlUrl.trim()) return;
    setSending(true);
    try { await fetch(`${GRABIX}/download?url=${encodeURIComponent(dlUrl.trim())}&dl_type=video`); setSent(true); setTimeout(() => setSent(false), 3000); }
    catch { /* ignore */ } finally { setSending(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 16, width: "100%", maxWidth: 680, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", gap: 16, padding: "20px 20px 0" }}>
          <img src={anime.images.jpg.large_image_url ?? anime.images.jpg.image_url} alt={title} style={{ width: 100, height: 145, objectFit: "cover", borderRadius: 10, flexShrink: 0, border: "1px solid var(--border)" }} onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/100x145"; }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, lineHeight: 1.3 }}>{title}</div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 8 }}>
              {anime.score && <span style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 600, color: "#fdd663" }}><IconStar size={11} color="#fdd663" /> {anime.score}</span>}
              {anime.episodes && <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>{anime.episodes} eps</span>}
              {anime.status && <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>{anime.status}</span>}
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {anime.genres?.slice(0, 4).map(g => <span key={g.name} style={{ background: "var(--bg-active)", color: "var(--text-accent)", padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 500 }}>{g.name}</span>)}
            </div>
          </div>
          <button className="btn-icon" style={{ alignSelf: "flex-start", flexShrink: 0 }} onClick={onClose}><IconX size={16} /></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px 24px" }}>
          {anime.synopsis && <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 16 }}>{anime.synopsis.length > 380 ? anime.synopsis.slice(0, 380) + "…" : anime.synopsis}</div>}

          {/* Stream source info */}
          {finding ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>Finding stream source…</div>
          ) : tmdbId ? (
            <div style={{ fontSize: 12, color: "var(--text-success)", marginBottom: 14 }}>✓ Stream available via VidSrc</div>
          ) : anime.trailer?.embed_url ? (
            <div style={{ fontSize: 12, color: "var(--text-warning)", marginBottom: 14 }}>Stream not found — trailer available instead</div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>No stream found — paste an episode URL below to download</div>
          )}

          {/* ── 3 Action Buttons ── */}
          <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
            <button className="btn btn-primary" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={handlePlay} disabled={finding && !anime.trailer?.embed_url}>
              <IconPlay size={15} /> {finding ? "Finding…" : "Play"}
            </button>
            <button className="btn btn-ghost" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={() => window.open(anime.url ?? `https://myanimelist.net/anime/${anime.mal_id}`, "_blank")}>
              <IconDownload size={15} /> Info
            </button>
            <button
              className="btn btn-ghost"
              style={{ gap: 7, flex: 1, justifyContent: "center", color: fav ? "var(--text-danger)" : "var(--text-primary)" }}
              onClick={() => toggle({ id: `anime-${anime.mal_id}`, title, poster: anime.images.jpg.large_image_url ?? anime.images.jpg.image_url, type: "anime", malId: anime.mal_id, tmdbId: tmdbId ?? undefined })}
            >
              <IconHeart size={15} color={fav ? "var(--text-danger)" : "currentColor"} filled={fav} />
              {fav ? "Saved" : "Favorite"}
            </button>
          </div>

          {/* Episode URL download */}
          <div style={{ background: "var(--bg-surface2)", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--text-secondary)" }}>Download an episode</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>Paste a legal episode URL to send it to your GRABIX downloader.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input-base" style={{ flex: 1, fontSize: 13 }} placeholder="Paste episode URL…" value={dlUrl} onChange={e => setDlUrl(e.target.value)} />
              <button className="btn btn-primary" style={{ gap: 6, flexShrink: 0 }} onClick={sendDl} disabled={sending || !dlUrl.trim()}>
                {sent ? <><IconCheck size={13} /> Sent!</> : sending ? "Sending…" : <><IconDownload size={13} /> Send</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
      {Array.from({ length: 16 }).map((_, i) => (
        <div key={i} className="card" style={{ overflow: "hidden" }}>
          <div style={{ width: "100%", height: 210, background: "var(--bg-surface2)" }} />
          <div style={{ padding: "8px 10px" }}>
            <div style={{ height: 12, background: "var(--bg-surface2)", borderRadius: 4, marginBottom: 6 }} />
            <div style={{ height: 10, background: "var(--bg-surface2)", borderRadius: 4, width: "60%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
