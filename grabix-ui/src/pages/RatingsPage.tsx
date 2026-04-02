import { useState, useRef, useEffect, useCallback } from "react";

const API    = "https://api.imdbapi.dev";
const JIKAN  = "https://api.jikan.moe/v4";

// Top IMDB IDs – fetched directly from imdbapi.dev (same API used everywhere else)
const TOP_MOVIE_IDS = [
  "tt0111161","tt0068646","tt0071562","tt0468569","tt0050083",
  "tt0108052","tt0167260","tt0110912","tt0120737","tt0060196",
  "tt0137523","tt1375666","tt0109830","tt0167261","tt0080684",
  "tt0133093","tt0099685","tt0073486","tt0047478","tt0114369",
  "tt6751668","tt0317248","tt0102926","tt0038650","tt0245429",
];
const TOP_TV_IDS = [
  "tt0944947","tt0903747","tt0795176","tt0773262","tt1475582",
  "tt2861424","tt0306414","tt4574334","tt2442560","tt0141842",
  "tt7366338","tt2802850","tt0096697","tt1190634","tt3032476",
  "tt1844624","tt0386676","tt1520211","tt1831164","tt0460649",
  "tt4158110","tt5071412","tt0185906","tt0417373","tt0367279",
];

// ── Types ──────────────────────────────────────────────────────────────────
interface SearchResult {
  id: string;
  primaryTitle: string;
  startYear: number;
  endYear?: number;
  type: string;
  primaryImage?: { url: string };
  rating?: { aggregateRating: number; voteCount: number };
  genres?: string[];
}
interface TitleDetail extends SearchResult {
  plot?: string;
  directors?: { displayName: string }[];
  writers?: { displayName: string }[];
  stars?: { displayName: string }[];
  runtimeSeconds?: number;
  metacritic?: { score: number };
  originCountries?: { name: string }[];
}
interface EpisodeData {
  id: string;
  title: string;
  episodeNumber: number;
  season: string;
  rating?: { aggregateRating: number; voteCount: number };
  plot?: string;
}
interface SeasonData { season: string; episodeCount: number; }
interface AnimeEntry {
  mal_id: number;
  title: string;
  score: number;
  scored_by: number;
  rank: number;
  images: { jpg: { large_image_url: string } };
  year: number;
  episodes: number | null;
  genres: { name: string }[];
}

// ── Helpers ────────────────────────────────────────────────────────────────
function getRatingColor(r: number | null): string {
  if (!r) return "var(--bg-surface2)";
  if (r >= 9.5) return "#1d4ed8";
  if (r >= 8.5) return "#15803d";
  if (r >= 8.0) return "#16a34a";
  if (r >= 7.0) return "#b45309";
  if (r >= 6.0) return "#c2410c";
  if (r >= 5.0) return "#b91c1c";
  return "#6d28d9";
}
const LEGEND = [
  { label: "Absolute Cinema", color: "#1d4ed8" },
  { label: "Awesome",         color: "#15803d" },
  { label: "Great",           color: "#16a34a" },
  { label: "Good",            color: "#b45309" },
  { label: "Regular",         color: "#c2410c" },
  { label: "Bad",             color: "#b91c1c" },
  { label: "Garbage",         color: "#6d28d9" },
];
function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + "K";
  return String(n);
}
function runtime(secs?: number) {
  if (!secs) return null;
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
const IS_SERIES = (t: string) =>
  ["TV_SERIES","TV_MINI_SERIES","tvSeries","tvMiniSeries","TV_SHOW","tvShow"].includes(t)
  || t.toLowerCase().includes("series");

type TopTab = "movies" | "tv" | "anime";

const CSS = `
@keyframes rat-fadeUp {
  from { opacity:0; transform:translateY(14px); }
  to   { opacity:1; transform:translateY(0); }
}
@keyframes rat-fadeIn {
  from { opacity:0; }
  to   { opacity:1; }
}
@keyframes rat-shimmer {
  0%   { background-position:-600px 0; }
  100% { background-position: 600px 0; }
}
@keyframes rat-spin { to { transform:rotate(360deg); } }

.rat-card {
  animation: rat-fadeUp 0.35s ease both;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  cursor: pointer;
}
.rat-card:hover {
  transform: translateY(-5px) scale(1.015);
  box-shadow: var(--shadow-lg);
  border-color: var(--accent) !important;
}
.rat-search-wrap input:focus {
  border-color: var(--border-focus) !important;
  box-shadow: 0 0 0 3px rgba(138,180,248,0.15) !important;
  outline: none;
}
.rat-tab {
  transition: color 0.15s, border-color 0.15s;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.rat-tab:hover  { color: var(--text-primary) !important; }
.rat-tab.active { color: var(--accent) !important; border-bottom-color: var(--accent) !important; }
.rat-skeleton {
  background: linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-surface2) 50%, var(--bg-surface) 75%);
  background-size: 600px 100%;
  animation: rat-shimmer 1.4s infinite linear;
}
.rat-ep {
  transition: transform 0.1s, box-shadow 0.1s;
  cursor: pointer;
}
.rat-ep:hover { transform: scale(1.16); box-shadow: 0 4px 14px rgba(0,0,0,0.5); }
.rat-sug-row { transition: background 0.1s; cursor: pointer; }
.rat-sug-row:hover { background: var(--bg-hover) !important; }
.rat-detail { animation: rat-fadeIn 0.3s ease; }
.rat-grid   { animation: rat-fadeUp 0.25s ease; }
`;

export default function RatingsPage() {
  const [query, setQuery]             = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSug, setShowSug]         = useState(false);
  const [loading, setLoading]         = useState(false);
  const [detail, setDetail]           = useState<TitleDetail | null>(null);
  const [seasons, setSeasons]         = useState<SeasonData[]>([]);
  const [episodes, setEpisodes]       = useState<Record<string, EpisodeData[]>>({});
  const [loadingGrid, setLoadingGrid] = useState(false);
  const [tooltip, setTooltip]         = useState<{ ep: EpisodeData; x: number; y: number } | null>(null);
  const [error, setError]             = useState("");
  const [filterType, setFilterType]   = useState("ALL");
  const [browseResults, setBrowseResults] = useState<SearchResult[]>([]);
  const [browsing, setBrowsing]       = useState(false);

  const [activeTab, setActiveTab] = useState<TopTab>("movies");
  const [topMovies, setTopMovies] = useState<TitleDetail[]>([]);
  const [topTv, setTopTv]         = useState<TitleDetail[]>([]);
  const [topAnime, setTopAnime]   = useState<AnimeEntry[]>([]);
  const [topLoading, setTopLoading] = useState(false);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Batch-fetch IMDB title details
  const fetchImdbBatch = async (ids: string[]): Promise<TitleDetail[]> => {
    const results = await Promise.allSettled(
      ids.map(id => fetch(`${API}/titles/${id}`).then(r => r.ok ? r.json() : null))
    );
    return results
      .filter(r => r.status === "fulfilled" && r.value)
      .map(r => (r as PromiseFulfilledResult<TitleDetail>).value)
      .sort((a, b) => (b.rating?.aggregateRating ?? 0) - (a.rating?.aggregateRating ?? 0));
  };

  const loadTopLists = useCallback(async () => {
    setTopLoading(true);
    const [movRes, tvRes, animeRes] = await Promise.allSettled([
      fetchImdbBatch(TOP_MOVIE_IDS),
      fetchImdbBatch(TOP_TV_IDS),
      fetch(`${JIKAN}/top/anime?limit=25`).then(r => r.json()),
    ]);
    if (movRes.status === "fulfilled")   setTopMovies(movRes.value);
    if (tvRes.status === "fulfilled")    setTopTv(tvRes.value);
    if (animeRes.status === "fulfilled") setTopAnime(animeRes.value.data ?? []);
    setTopLoading(false);
  }, []);

  useEffect(() => { loadTopLists(); }, [loadTopLists]);

  // Suggestions — disabled when detail is open
  useEffect(() => {
    if (detail) { setSuggestions([]); setShowSug(false); return; }
    if (query.trim().length < 2) { setSuggestions([]); setShowSug(false); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/search/titles?query=${encodeURIComponent(query)}&limit=8`);
        const j = await r.json();
        const list: SearchResult[] = j.titles ?? [];
        setSuggestions(list);
        setShowSug(list.length > 0);
      } catch { /* silent */ }
    }, 350);
  }, [query, detail]);

  // Open title by IMDB ID
  const selectTitle = async (id: string, title?: string) => {
    setShowSug(false); setSuggestions([]);
    if (title) setQuery(title);
    setLoading(true);
    setDetail(null); setSeasons([]); setEpisodes({}); setError(""); setBrowseResults([]);
    try {
      const r = await fetch(`${API}/titles/${id}`);
      if (!r.ok) throw new Error("Not found");
      const d: TitleDetail = await r.json();
      setDetail(d);
      if (IS_SERIES(d.type)) {
        const sr = await fetch(`${API}/titles/${id}/seasons`);
        const sj = await sr.json();
        const seas: SeasonData[] = sj.seasons ?? [];
        setSeasons(seas);
        setLoadingGrid(true);
        const epMap: Record<string, EpisodeData[]> = {};
        await Promise.all(seas.map(async (s) => {
          let all: EpisodeData[] = [], token = "";
          do {
            const url = `${API}/titles/${id}/episodes?season=${s.season}&pageSize=50${token ? `&pageToken=${token}` : ""}`;
            const ej = await (await fetch(url)).json();
            all = all.concat(ej.episodes ?? []);
            token = ej.nextPageToken ?? "";
          } while (token);
          epMap[s.season] = all.sort((a, b) => a.episodeNumber - b.episodeNumber);
        }));
        setEpisodes(epMap);
        setLoadingGrid(false);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
    setLoading(false);
  };

  // Open anime/unknown: search IMDB and auto-open first result
  const openByTitle = async (title: string) => {
    setLoading(true); setDetail(null); setError(""); setBrowseResults([]);
    try {
      const r = await fetch(`${API}/search/titles?query=${encodeURIComponent(title)}&limit=5`);
      const j = await r.json();
      const first: SearchResult | undefined = j.titles?.[0];
      if (first) {
        await selectTitle(first.id, first.primaryTitle);
      } else {
        setError("Not found on IMDb."); setLoading(false);
      }
    } catch { setError("Search failed."); setLoading(false); }
  };

  const doSearch = async () => {
    if (!query.trim()) return;
    setShowSug(false); setBrowsing(true); setDetail(null); setError("");
    try {
      const r = await fetch(`${API}/search/titles?query=${encodeURIComponent(query.trim())}&limit=20`);
      const j = await r.json();
      let results: SearchResult[] = j.titles ?? [];
      if (filterType !== "ALL") results = results.filter(t => t.type === filterType);
      setBrowseResults(results);
    } catch { setError("Search failed."); }
    setBrowsing(false);
  };

  const goBack = () => {
    setDetail(null); setSeasons([]); setEpisodes({});
    setSuggestions([]); setShowSug(false); setBrowseResults([]);
  };

  const maxEps = seasons.length ? Math.max(...seasons.map(s => (episodes[s.season] ?? []).length)) : 0;
  const seasonAvg = seasons.map(s => {
    const eps = (episodes[s.season] ?? []).filter(e => e.rating?.aggregateRating);
    if (!eps.length) return null;
    return +(eps.reduce((a, e) => a + (e.rating?.aggregateRating ?? 0), 0) / eps.length).toFixed(1);
  });
  const CELL = 60, ROW_LABEL = 48;
  const isEmptyState = !detail && !loading && browseResults.length === 0 && !browsing;

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", background:"var(--bg-app)", color:"var(--text-primary)", fontFamily:"var(--font)" }}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={{ padding:"12px 20px", borderBottom:"1px solid var(--border)", flexShrink:0, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <div style={{ fontSize:15, fontWeight:700, whiteSpace:"nowrap" }}>📊 IMDb Ratings</div>

        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ background:"var(--bg-input)", border:"1px solid var(--border)", borderRadius:"var(--radius-sm)", padding:"7px 10px", color:"var(--text-primary)", fontSize:13, cursor:"pointer", fontFamily:"var(--font)" }}>
          <option value="ALL">All Types</option>
          <option value="MOVIE">Movies</option>
          <option value="TV_SERIES">TV Series</option>
          <option value="TV_MINI_SERIES">Mini-Series</option>
          <option value="TV_MOVIE">TV Movie</option>
        </select>

        {/* Search input */}
        <div className="rat-search-wrap" style={{ position:"relative", flex:1, minWidth:200, maxWidth:500 }}>
          <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", fontSize:13, color:"var(--text-muted)", pointerEvents:"none" }}>🔍</span>
          <input value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && doSearch()}
            onFocus={() => !detail && suggestions.length > 0 && setShowSug(true)}
            onBlur={() => setTimeout(() => setShowSug(false), 180)}
            placeholder="Search movies, series, anime…"
            style={{ width:"100%", background:"var(--bg-input)", border:"1px solid var(--border)", borderRadius:"var(--radius-sm)", padding:"7px 12px 7px 30px", color:"var(--text-primary)", fontSize:14, fontFamily:"var(--font)", boxSizing:"border-box" }} />

          {/* Suggestions — solid background, no transparency */}
          {!detail && showSug && suggestions.length > 0 && (
            <div style={{
              position:"absolute", top:"calc(100% + 4px)", left:0, right:0,
              background:"var(--bg-surface)",
              border:"1px solid var(--border)",
              borderRadius:"var(--radius-md)",
              zIndex:300,
              boxShadow:"var(--shadow-lg)",
              overflow:"hidden",
              animation:"rat-fadeIn 0.12s ease",
            }}>
              {suggestions.map((s, i) => (
                <div key={s.id} className="rat-sug-row"
                  onMouseDown={() => selectTitle(s.id, s.primaryTitle)}
                  style={{
                    display:"flex", alignItems:"center", gap:10, padding:"8px 12px",
                    background:"var(--bg-surface)",
                    borderBottom: i < suggestions.length - 1 ? "1px solid var(--border)" : "none",
                  }}>
                  {s.primaryImage?.url
                    ? <img src={s.primaryImage.url} alt="" style={{ width:26, height:38, objectFit:"cover", borderRadius:4, flexShrink:0 }} />
                    : <div style={{ width:26, height:38, background:"var(--bg-surface2)", borderRadius:4, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11 }}>🎬</div>}
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{s.primaryTitle}</div>
                    <div style={{ fontSize:11, color:"var(--text-muted)", marginTop:1 }}>
                      {s.startYear}{s.endYear?`–${s.endYear}`:""} · {s.type.replace(/_/g," ")}
                      {s.rating ? <span style={{ color:"var(--text-accent)" }}> · ⭐ {s.rating.aggregateRating}</span> : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={doSearch} disabled={browsing}
          style={{ background:"var(--accent)", border:"none", borderRadius:"var(--radius-sm)", padding:"7px 20px", color:"var(--text-on-accent)", cursor:"pointer", fontWeight:600, fontFamily:"var(--font)", fontSize:13, opacity:browsing?0.7:1 }}>
          {browsing ? "Searching…" : "Search"}
        </button>

        {detail && (
          <button onClick={goBack}
            style={{ background:"none", border:"1px solid var(--border)", borderRadius:"var(--radius-sm)", padding:"7px 14px", color:"var(--text-secondary)", cursor:"pointer", fontSize:12, fontFamily:"var(--font)" }}>
            ← Back
          </button>
        )}
      </div>

      {error && <div style={{ padding:"6px 20px", color:"var(--text-danger)", fontSize:12, flexShrink:0 }}>⚠ {error}</div>}

      {loading && (
        <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12 }}>
          <div style={{ width:34, height:34, border:"3px solid var(--border)", borderTopColor:"var(--accent)", borderRadius:"50%", animation:"rat-spin 0.75s linear infinite" }} />
          <div style={{ fontSize:13, color:"var(--text-muted)" }}>Loading…</div>
        </div>
      )}

      {/* Browse results */}
      {!detail && !loading && browseResults.length > 0 && (
        <div className="rat-grid" style={{ flex:1, overflow:"auto", padding:"18px 20px" }}>
          <div style={{ fontSize:12, color:"var(--text-muted)", marginBottom:14 }}>
            {browseResults.length} results for "<span style={{ color:"var(--text-accent)" }}>{query}</span>"
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(144px,1fr))", gap:12 }}>
            {browseResults.map((r, i) => (
              <div key={r.id} className="rat-card"
                style={{ animationDelay:`${i*0.025}s`, background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", overflow:"hidden" }}
                onClick={() => selectTitle(r.id, r.primaryTitle)}>
                {r.primaryImage?.url
                  ? <img src={r.primaryImage.url} alt={r.primaryTitle} style={{ width:"100%", aspectRatio:"2/3", objectFit:"cover", display:"block" }} />
                  : <div style={{ width:"100%", aspectRatio:"2/3", background:"var(--bg-surface2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:32 }}>🎬</div>}
                <div style={{ padding:"8px 10px" }}>
                  <div style={{ fontSize:12, fontWeight:700, marginBottom:2, lineHeight:1.3 }}>{r.primaryTitle}</div>
                  <div style={{ fontSize:11, color:"var(--text-muted)" }}>{r.startYear}{r.endYear?`–${r.endYear}`:""}</div>
                  {r.rating && <div style={{ fontSize:11, color:"var(--text-accent)", marginTop:3, fontWeight:600 }}>⭐ {r.rating.aggregateRating} <span style={{ color:"var(--text-muted)", fontWeight:400 }}>({fmt(r.rating.voteCount)})</span></div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail */}
      {detail && !loading && (
        <div className="rat-detail" style={{ flex:1, display:"flex", overflow:"hidden" }}>
          {/* LEFT */}
          <div style={{ width:250, flexShrink:0, borderRight:"1px solid var(--border)", overflow:"auto", padding:"18px 16px", display:"flex", flexDirection:"column", gap:12 }}>
            {detail.primaryImage?.url && (
              <div style={{ position:"relative" }}>
                <img src={detail.primaryImage.url} alt={detail.primaryTitle}
                  style={{ width:"100%", borderRadius:"var(--radius-md)", objectFit:"cover", display:"block", boxShadow:"var(--shadow-md)" }} />
                {detail.rating && (
                  <div style={{ position:"absolute", top:8, right:8, background:getRatingColor(detail.rating.aggregateRating), color:"#fff", borderRadius:6, padding:"3px 8px", fontSize:14, fontWeight:800 }}>
                    ⭐ {detail.rating.aggregateRating}
                  </div>
                )}
              </div>
            )}
            <div>
              <div style={{ fontSize:16, fontWeight:700, lineHeight:1.3, marginBottom:4 }}>{detail.primaryTitle}</div>
              <div style={{ fontSize:11, color:"var(--text-muted)", lineHeight:1.9 }}>
                {detail.startYear}{detail.endYear?`–${detail.endYear}`:""}
                {runtime(detail.runtimeSeconds) ? ` · ${runtime(detail.runtimeSeconds)}` : ""}
                {detail.originCountries?.[0] ? ` · ${detail.originCountries[0].name}` : ""}
                {" · "}{detail.type.replace(/_/g," ")}
              </div>
            </div>
            {detail.rating && (
              <div style={{ background:"var(--accent-subtle)", border:"1px solid var(--accent-light)", borderRadius:"var(--radius-sm)", padding:"10px 14px", display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:24, fontWeight:800, color:"var(--text-accent)" }}>{detail.rating.aggregateRating}</span>
                <span style={{ fontSize:11, color:"var(--text-secondary)", lineHeight:1.6 }}>/ 10<br />{fmt(detail.rating.voteCount)} votes</span>
              </div>
            )}
            {detail.metacritic?.score != null && (
              <div style={{ background: detail.metacritic.score >= 60 ? "var(--accent-subtle)" : "rgba(185,28,28,0.1)", border:`1px solid ${detail.metacritic.score >= 60 ? "var(--success)" : "var(--danger)"}`, color: detail.metacritic.score >= 60 ? "var(--text-success)" : "var(--text-danger)", borderRadius:"var(--radius-sm)", padding:"6px 12px", fontWeight:700, fontSize:13 }}>
                🎯 Metacritic: {detail.metacritic.score}
              </div>
            )}
            {detail.genres && detail.genres.length > 0 && (
              <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                {detail.genres.map(g => <span key={g} style={{ background:"var(--bg-surface2)", border:"1px solid var(--border)", borderRadius:20, padding:"2px 8px", fontSize:11, color:"var(--text-secondary)" }}>{g}</span>)}
              </div>
            )}
            {detail.plot && <p style={{ fontSize:12, color:"var(--text-secondary)", lineHeight:1.7, margin:0 }}>{detail.plot}</p>}
            <div style={{ fontSize:12, color:"var(--text-muted)", lineHeight:2 }}>
              {detail.directors?.length ? <div><span style={{ color:"var(--text-primary)", fontWeight:600 }}>Director</span><br />{detail.directors.map(d=>d.displayName).join(", ")}</div> : null}
              {detail.writers?.length   ? <div style={{ marginTop:6 }}><span style={{ color:"var(--text-primary)", fontWeight:600 }}>Writers</span><br />{detail.writers.slice(0,3).map(w=>w.displayName).join(", ")}</div> : null}
              {detail.stars?.length     ? <div style={{ marginTop:6 }}><span style={{ color:"var(--text-primary)", fontWeight:600 }}>Stars</span><br />{detail.stars.slice(0,5).map(s=>s.displayName).join(", ")}</div> : null}
            </div>
          </div>

          {/* RIGHT — episode grid */}
          <div style={{ flex:1, overflow:"auto", padding:"18px 24px" }}>
            {!IS_SERIES(detail.type) && (
              <div style={{ color:"var(--text-muted)", fontSize:14, marginTop:60, textAlign:"center" }}>Episode grid is only available for TV series.</div>
            )}
            {IS_SERIES(detail.type) && (
              <>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:10 }}>
                  <div style={{ fontSize:14, fontWeight:700 }}>Episode Ratings</div>
                  <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                    {LEGEND.map(l => (
                      <div key={l.label} style={{ display:"flex", alignItems:"center", gap:4, fontSize:11, color:"var(--text-muted)" }}>
                        <div style={{ width:8, height:8, borderRadius:2, background:l.color, flexShrink:0 }} />{l.label}
                      </div>
                    ))}
                  </div>
                </div>
                {loadingGrid && <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>{Array.from({length:20},(_,i)=><div key={i} className="rat-skeleton" style={{ width:54, height:40, borderRadius:8 }} />)}</div>}
                {seasons.length > 0 && !loadingGrid && (
                  <div className="rat-grid" style={{ overflowX:"auto" }}>
                    <div style={{ display:"inline-block", minWidth:"max-content" }}>
                      <div style={{ display:"flex", marginBottom:6, paddingLeft:ROW_LABEL }}>
                        {seasons.map(s => <div key={s.season} style={{ width:CELL, textAlign:"center", fontSize:11, fontWeight:700, color:"var(--text-accent)", flexShrink:0 }}>S{s.season}</div>)}
                      </div>
                      {Array.from({length:maxEps},(_,epIdx) => (
                        <div key={epIdx} style={{ display:"flex", alignItems:"center", marginBottom:3 }}>
                          <div style={{ width:ROW_LABEL, fontSize:11, color:"var(--text-muted)", fontWeight:600, flexShrink:0 }}>E{epIdx+1}</div>
                          {seasons.map(s => {
                            const ep = (episodes[s.season]??[])[epIdx];
                            const rating = ep?.rating?.aggregateRating ?? null;
                            return (
                              <div key={s.season} style={{ width:CELL, flexShrink:0, display:"flex", justifyContent:"center" }}>
                                {ep ? (
                                  <div className="rat-ep"
                                    style={{ width:CELL-6, height:40, borderRadius:8, background:getRatingColor(rating), color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, position:"relative" }}
                                    onMouseEnter={e => setTooltip({ep, x:e.clientX, y:e.clientY})}
                                    onMouseMove={e  => setTooltip(t => t?{...t,x:e.clientX,y:e.clientY}:null)}
                                    onMouseLeave={() => setTooltip(null)}
                                    onClick={() => window.open(`https://www.imdb.com/title/${ep.id}`,"_blank")}
                                  >{rating ?? "—"}</div>
                                ) : <div style={{ width:CELL-6, height:40 }} />}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                      <div style={{ display:"flex", alignItems:"center", marginTop:12, paddingTop:12, borderTop:"1px solid var(--border)" }}>
                        <div style={{ width:ROW_LABEL, fontSize:10, color:"var(--text-muted)", fontWeight:700, flexShrink:0 }}>AVG.</div>
                        {seasonAvg.map((avg,i) => (
                          <div key={i} style={{ width:CELL, flexShrink:0, display:"flex", justifyContent:"center" }}>
                            <div style={{ width:CELL-6, height:40, borderRadius:8, background:getRatingColor(avg), color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800 }}>{avg ?? "—"}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Empty state — Top Lists */}
      {isEmptyState && (
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ display:"flex", borderBottom:"1px solid var(--border)", flexShrink:0, paddingLeft:20 }}>
            {([
              { key:"movies", label:"🎬 Top Movies" },
              { key:"tv",     label:"📺 Top TV Series" },
              { key:"anime",  label:"✨ Top Anime" },
            ] as {key:TopTab;label:string}[]).map(tab => (
              <button key={tab.key}
                className={`rat-tab${activeTab===tab.key?" active":""}`}
                onClick={() => setActiveTab(tab.key)}
                style={{ background:"none", border:"none", borderBottom:"2px solid transparent", padding:"11px 18px", color:"var(--text-muted)", fontFamily:"var(--font)", fontSize:13, fontWeight:600, cursor:"pointer" }}>
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ flex:1, overflow:"auto", padding:"18px 20px" }}>
            {topLoading && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(144px,1fr))", gap:12 }}>
                {Array.from({length:12},(_,i) => (
                  <div key={i} style={{ borderRadius:"var(--radius-md)", overflow:"hidden", background:"var(--bg-surface)" }}>
                    <div className="rat-skeleton" style={{ width:"100%", aspectRatio:"2/3" }} />
                    <div style={{ padding:"8px 10px" }}>
                      <div className="rat-skeleton" style={{ height:13, borderRadius:4, marginBottom:5 }} />
                      <div className="rat-skeleton" style={{ height:10, borderRadius:4, width:"55%" }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Movies tab */}
            {!topLoading && activeTab === "movies" && (
              <div className="rat-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(144px,1fr))", gap:12 }}>
                {topMovies.map((r,i) => (
                  <div key={r.id} className="rat-card"
                    style={{ animationDelay:`${i*0.02}s`, background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", overflow:"hidden" }}
                    onClick={() => selectTitle(r.id, r.primaryTitle)}>
                    <div style={{ position:"relative" }}>
                      {r.primaryImage?.url
                        ? <img src={r.primaryImage.url} alt={r.primaryTitle} style={{ width:"100%", aspectRatio:"2/3", objectFit:"cover", display:"block" }} />
                        : <div style={{ width:"100%", aspectRatio:"2/3", background:"var(--bg-surface2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:32 }}>🎬</div>}
                      <div style={{ position:"absolute", top:6, left:6, background:"rgba(0,0,0,0.72)", color:"#fff", fontSize:10, fontWeight:700, borderRadius:4, padding:"2px 5px" }}>#{i+1}</div>
                    </div>
                    <div style={{ padding:"8px 10px" }}>
                      <div style={{ fontSize:12, fontWeight:700, marginBottom:2, lineHeight:1.3 }}>{r.primaryTitle}</div>
                      <div style={{ fontSize:11, color:"var(--text-muted)" }}>{r.startYear}</div>
                      {r.rating && <div style={{ fontSize:11, color:"var(--text-accent)", marginTop:3, fontWeight:600 }}>⭐ {r.rating.aggregateRating}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* TV tab */}
            {!topLoading && activeTab === "tv" && (
              <div className="rat-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(144px,1fr))", gap:12 }}>
                {topTv.map((r,i) => (
                  <div key={r.id} className="rat-card"
                    style={{ animationDelay:`${i*0.02}s`, background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", overflow:"hidden" }}
                    onClick={() => selectTitle(r.id, r.primaryTitle)}>
                    <div style={{ position:"relative" }}>
                      {r.primaryImage?.url
                        ? <img src={r.primaryImage.url} alt={r.primaryTitle} style={{ width:"100%", aspectRatio:"2/3", objectFit:"cover", display:"block" }} />
                        : <div style={{ width:"100%", aspectRatio:"2/3", background:"var(--bg-surface2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:32 }}>📺</div>}
                      <div style={{ position:"absolute", top:6, left:6, background:"rgba(0,0,0,0.72)", color:"#fff", fontSize:10, fontWeight:700, borderRadius:4, padding:"2px 5px" }}>#{i+1}</div>
                    </div>
                    <div style={{ padding:"8px 10px" }}>
                      <div style={{ fontSize:12, fontWeight:700, marginBottom:2, lineHeight:1.3 }}>{r.primaryTitle}</div>
                      <div style={{ fontSize:11, color:"var(--text-muted)" }}>{r.startYear}{r.endYear?`–${r.endYear}`:""}</div>
                      {r.rating && <div style={{ fontSize:11, color:"var(--text-accent)", marginTop:3, fontWeight:600 }}>⭐ {r.rating.aggregateRating}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Anime tab */}
            {!topLoading && activeTab === "anime" && (
              <div className="rat-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(144px,1fr))", gap:12 }}>
                {topAnime.map((a,i) => (
                  <div key={a.mal_id} className="rat-card"
                    style={{ animationDelay:`${i*0.02}s`, background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", overflow:"hidden" }}
                    onClick={() => openByTitle(a.title)}>
                    <div style={{ position:"relative" }}>
                      <img src={a.images.jpg.large_image_url} alt={a.title} style={{ width:"100%", aspectRatio:"2/3", objectFit:"cover", display:"block" }} />
                      <div style={{ position:"absolute", top:6, left:6, background:"rgba(0,0,0,0.72)", color:"#fff", fontSize:10, fontWeight:700, borderRadius:4, padding:"2px 5px" }}>#{i+1}</div>
                    </div>
                    <div style={{ padding:"8px 10px" }}>
                      <div style={{ fontSize:12, fontWeight:700, marginBottom:2, lineHeight:1.3 }}>{a.title}</div>
                      <div style={{ fontSize:11, color:"var(--text-muted)" }}>{a.year||""}{a.episodes?` · ${a.episodes} ep`:""}</div>
                      {a.score && <div style={{ fontSize:11, color:"var(--text-accent)", marginTop:3, fontWeight:600 }}>⭐ {a.score}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div style={{ position:"fixed", top:tooltip.y-100, left:tooltip.x+14, background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", padding:"9px 13px", fontSize:12, color:"var(--text-primary)", pointerEvents:"none", zIndex:999, maxWidth:270, boxShadow:"var(--shadow-lg)", animation:"rat-fadeIn 0.1s ease" }}>
          <div style={{ fontWeight:700, marginBottom:2 }}>S{tooltip.ep.season} E{tooltip.ep.episodeNumber} — {tooltip.ep.title}</div>
          <div style={{ color:"var(--text-accent)", fontWeight:600 }}>⭐ {tooltip.ep.rating?.aggregateRating ?? "No rating"}{tooltip.ep.rating?.voteCount ? ` · ${fmt(tooltip.ep.rating.voteCount)} votes` : ""}</div>
          {tooltip.ep.plot && <div style={{ marginTop:4, color:"var(--text-muted)", fontSize:11, lineHeight:1.55 }}>{tooltip.ep.plot.slice(0,120)}{tooltip.ep.plot.length>120?"…":""}</div>}
          <div style={{ marginTop:4, fontSize:10, color:"var(--text-accent)", opacity:0.65 }}>Click to open on IMDb ↗</div>
        </div>
      )}
    </div>
  );
}
