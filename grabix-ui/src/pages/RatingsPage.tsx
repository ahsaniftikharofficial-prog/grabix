import { useState, useRef, useEffect } from "react";

const API = "https://api.imdbapi.dev";

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

// ── Helpers ────────────────────────────────────────────────────────────────
function getRatingColor(r: number | null): { bg: string; text: string } {
  if (!r) return { bg: "#1a1f2a", text: "#555" };
  if (r >= 9.5) return { bg: "#2563eb", text: "#fff" };
  if (r >= 8.5) return { bg: "#16a34a", text: "#fff" };
  if (r >= 8.0) return { bg: "#22c55e", text: "#fff" };
  if (r >= 7.0) return { bg: "#ca8a04", text: "#fff" };
  if (r >= 6.0) return { bg: "#ea580c", text: "#fff" };
  if (r >= 5.0) return { bg: "#dc2626", text: "#fff" };
  return { bg: "#7c3aed", text: "#fff" };
}
const LEGEND = [
  { label: "Absolute Cinema", color: "#2563eb" },
  { label: "Awesome",         color: "#16a34a" },
  { label: "Great",           color: "#22c55e" },
  { label: "Good",            color: "#ca8a04" },
  { label: "Regular",         color: "#ea580c" },
  { label: "Bad",             color: "#dc2626" },
  { label: "Garbage",         color: "#7c3aed" },
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

// ── Component ──────────────────────────────────────────────────────────────
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
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) { setSuggestions([]); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/search/titles?query=${encodeURIComponent(query)}&limit=8`);
        const j = await r.json();
        setSuggestions(j.titles ?? []);
        setShowSug(true);
      } catch { /* silent */ }
    }, 350);
  }, [query]);

  const selectTitle = async (id: string) => {
    setShowSug(false); setLoading(true);
    setDetail(null); setSeasons([]); setEpisodes({}); setError("");
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

  const maxEps = seasons.length ? Math.max(...seasons.map(s => (episodes[s.season] ?? []).length)) : 0;
  const seasonAvg = seasons.map(s => {
    const eps = (episodes[s.season] ?? []).filter(e => e.rating?.aggregateRating);
    if (!eps.length) return null;
    return +(eps.reduce((a, e) => a + (e.rating?.aggregateRating ?? 0), 0) / eps.length).toFixed(1);
  });
  const CELL = 60, ROW_LABEL = 48;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-app)", color: "var(--text-primary)" }}>

      {/* ── Search bar ── */}
      <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: "nowrap" }}>📊 IMDb Ratings</div>

        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text-primary)", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
          <option value="ALL">All Types</option>
          <option value="MOVIE">Movies</option>
          <option value="TV_SERIES">TV Series</option>
          <option value="TV_MINI_SERIES">Mini-Series</option>
          <option value="TV_MOVIE">TV Movie</option>
        </select>

        <div style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 500 }}>
          <input value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && doSearch()}
            onFocus={() => suggestions.length && setShowSug(true)}
            onBlur={() => setTimeout(() => setShowSug(false), 150)}
            placeholder="Search movies, series, anime…"
            style={{ width: "100%", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 14px", color: "var(--text-primary)", fontSize: 14, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
          {showSug && suggestions.length > 0 && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, zIndex: 200, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", overflow: "hidden" }}>
              {suggestions.map(s => (
                <div key={s.id} onMouseDown={() => { setQuery(s.primaryTitle); selectTitle(s.id); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}>
                  {s.primaryImage?.url
                    ? <img src={s.primaryImage.url} alt="" style={{ width: 26, height: 38, objectFit: "cover", borderRadius: 3, flexShrink: 0 }} />
                    : <div style={{ width: 26, height: 38, background: "#222", borderRadius: 3, flexShrink: 0 }} />}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{s.primaryTitle}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.startYear}{s.endYear ? `–${s.endYear}` : ""} · {s.type.replace(/_/g, " ")}{s.rating ? ` · ⭐ ${s.rating.aggregateRating}` : ""}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={doSearch} disabled={browsing}
          style={{ background: "var(--accent)", border: "none", borderRadius: 8, padding: "8px 22px", color: "#fff", cursor: "pointer", fontWeight: 600, fontFamily: "inherit", fontSize: 13, opacity: browsing ? 0.7 : 1 }}>
          {browsing ? "Searching…" : "Search"}
        </button>

        {detail && (
          <button onClick={() => { setDetail(null); setSeasons([]); setEpisodes({}); }}
            style={{ background: "none", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 14px", color: "var(--text-muted)", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>
            ← Back
          </button>
        )}
      </div>

      {error && <div style={{ padding: "8px 24px", color: "var(--text-danger)", fontSize: 13, flexShrink: 0 }}>⚠ {error}</div>}
      {loading && <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>}

      {/* ── Browse grid ── */}
      {!detail && !loading && browseResults.length > 0 && (
        <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>{browseResults.length} results</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
            {browseResults.map(r => (
              <div key={r.id} onClick={() => { setQuery(r.primaryTitle); selectTitle(r.id); }}
                style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", cursor: "pointer", transition: "transform 0.15s, border-color 0.15s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(-3px)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ""; (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}>
                {r.primaryImage?.url
                  ? <img src={r.primaryImage.url} alt={r.primaryTitle} style={{ width: "100%", aspectRatio: "2/3", objectFit: "cover", display: "block" }} />
                  : <div style={{ width: "100%", aspectRatio: "2/3", background: "#1a1f2a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>🎬</div>}
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2, lineHeight: 1.3 }}>{r.primaryTitle}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.startYear}{r.endYear ? `–${r.endYear}` : ""}</div>
                  {r.rating && <div style={{ fontSize: 11, color: "#facc15", marginTop: 3 }}>⭐ {r.rating.aggregateRating} <span style={{ color: "var(--text-muted)" }}>({fmt(r.rating.voteCount)})</span></div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Detail: two-column desktop layout ── */}
      {detail && !loading && (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

          {/* LEFT — poster + info */}
          <div style={{ width: 255, flexShrink: 0, borderRight: "1px solid var(--border)", overflow: "auto", padding: "22px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
            {detail.primaryImage?.url && (
              <img src={detail.primaryImage.url} alt={detail.primaryTitle}
                style={{ width: "100%", borderRadius: 10, objectFit: "cover", display: "block", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }} />
            )}
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.3, marginBottom: 5 }}>{detail.primaryTitle}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
                {detail.startYear}{detail.endYear ? `–${detail.endYear}` : ""}
                {runtime(detail.runtimeSeconds) ? ` · ${runtime(detail.runtimeSeconds)}` : ""}
                {detail.originCountries?.[0] ? ` · ${detail.originCountries[0].name}` : ""}
                {" · "}{detail.type.replace(/_/g, " ")}
              </div>
            </div>

            {detail.rating && (
              <div style={{ background: getRatingColor(detail.rating.aggregateRating).bg, color: getRatingColor(detail.rating.aggregateRating).text, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 22, fontWeight: 800 }}>⭐ {detail.rating.aggregateRating}</span>
                <span style={{ fontSize: 11, opacity: 0.85, lineHeight: 1.4 }}>/ 10<br />{fmt(detail.rating.voteCount)} votes</span>
              </div>
            )}
            {detail.metacritic?.score != null && (
              <div style={{ background: detail.metacritic.score >= 60 ? "#16a34a" : "#dc2626", color: "#fff", borderRadius: 8, padding: "7px 12px", fontWeight: 700, fontSize: 13 }}>
                🎯 Metacritic: {detail.metacritic.score}
              </div>
            )}

            {detail.genres && detail.genres.length > 0 && (
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {detail.genres.map(g => (
                  <span key={g} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 20, padding: "3px 9px", fontSize: 11, color: "var(--text-muted)" }}>{g}</span>
                ))}
              </div>
            )}

            {detail.plot && (
              <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7, margin: 0 }}>{detail.plot}</p>
            )}

            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.9 }}>
              {detail.directors?.length ? <div><span style={{ color: "var(--text-primary)", fontWeight: 600 }}>Director</span><br />{detail.directors.map(d => d.displayName).join(", ")}</div> : null}
              {detail.writers?.length ? <div style={{ marginTop: 8 }}><span style={{ color: "var(--text-primary)", fontWeight: 600 }}>Writers</span><br />{detail.writers.slice(0, 3).map(w => w.displayName).join(", ")}</div> : null}
              {detail.stars?.length ? <div style={{ marginTop: 8 }}><span style={{ color: "var(--text-primary)", fontWeight: 600 }}>Stars</span><br />{detail.stars.slice(0, 5).map(s => s.displayName).join(", ")}</div> : null}
            </div>
          </div>

          {/* RIGHT — episode grid */}
          <div style={{ flex: 1, overflow: "auto", padding: "22px 28px" }}>
            {!IS_SERIES(detail.type) && (
              <div style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 60, textAlign: "center" }}>
                Episode grid is only available for TV series.
              </div>
            )}

            {IS_SERIES(detail.type) && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Episode Ratings</div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {LEGEND.map(l => (
                      <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
                        <div style={{ width: 9, height: 9, borderRadius: 2, background: l.color, flexShrink: 0 }} />
                        {l.label}
                      </div>
                    ))}
                  </div>
                </div>

                {loadingGrid && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading episodes…</div>}

                {seasons.length > 0 && !loadingGrid && (
                  <div style={{ overflowX: "auto" }}>
                    <div style={{ display: "inline-block", minWidth: "max-content" }}>

                      {/* Season headers */}
                      <div style={{ display: "flex", marginBottom: 6, paddingLeft: ROW_LABEL }}>
                        {seasons.map(s => (
                          <div key={s.season} style={{ width: CELL, textAlign: "center", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", flexShrink: 0 }}>
                            S{s.season}
                          </div>
                        ))}
                      </div>

                      {/* Episode rows */}
                      {Array.from({ length: maxEps }, (_, epIdx) => (
                        <div key={epIdx} style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
                          <div style={{ width: ROW_LABEL, fontSize: 11, color: "var(--text-muted)", fontWeight: 600, flexShrink: 0 }}>E{epIdx + 1}</div>
                          {seasons.map(s => {
                            const ep = (episodes[s.season] ?? [])[epIdx];
                            const rating = ep?.rating?.aggregateRating ?? null;
                            const { bg, text } = getRatingColor(rating);
                            return (
                              <div key={s.season} style={{ width: CELL, flexShrink: 0, display: "flex", justifyContent: "center" }}>
                                {ep ? (
                                  <div
                                    style={{ width: CELL - 6, height: 42, borderRadius: 8, background: bg, color: text, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "transform 0.1s, box-shadow 0.1s" }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1.12)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.5)"; setTooltip({ ep, x: e.clientX, y: e.clientY }); }}
                                    onMouseMove={e => setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1)"; (e.currentTarget as HTMLElement).style.boxShadow = "none"; setTooltip(null); }}
                                    onClick={() => window.open(`https://www.imdb.com/title/${ep.id}`, "_blank")}
                                  >
                                    {rating ?? "—"}
                                  </div>
                                ) : <div style={{ width: CELL - 6, height: 42 }} />}
                              </div>
                            );
                          })}
                        </div>
                      ))}

                      {/* AVG row */}
                      <div style={{ display: "flex", alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                        <div style={{ width: ROW_LABEL, fontSize: 11, color: "var(--text-muted)", fontWeight: 700, flexShrink: 0 }}>AVG.</div>
                        {seasonAvg.map((avg, i) => {
                          const { bg, text } = getRatingColor(avg);
                          return (
                            <div key={i} style={{ width: CELL, flexShrink: 0, display: "flex", justifyContent: "center" }}>
                              <div style={{ width: CELL - 6, height: 42, borderRadius: 8, background: bg, color: text, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>
                                {avg ?? "—"}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Tooltip ── */}
      {tooltip && (
        <div style={{ position: "fixed", top: tooltip.y - 95, left: tooltip.x + 16, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 14px", fontSize: 12, color: "var(--text-primary)", pointerEvents: "none", zIndex: 999, maxWidth: 280, boxShadow: "0 6px 24px rgba(0,0,0,0.5)" }}>
          <div style={{ fontWeight: 700, marginBottom: 3 }}>S{tooltip.ep.season} E{tooltip.ep.episodeNumber} — {tooltip.ep.title}</div>
          <div style={{ color: "#facc15" }}>⭐ {tooltip.ep.rating?.aggregateRating ?? "No rating"}{tooltip.ep.rating?.voteCount ? ` · ${fmt(tooltip.ep.rating.voteCount)} votes` : ""}</div>
          {tooltip.ep.plot && <div style={{ marginTop: 5, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5 }}>{tooltip.ep.plot.slice(0, 130)}{tooltip.ep.plot.length > 130 ? "…" : ""}</div>}
          <div style={{ marginTop: 5, fontSize: 10, color: "var(--accent)", opacity: 0.7 }}>Click to open on IMDb ↗</div>
        </div>
      )}

      {/* ── Empty state ── */}
      {!detail && !loading && browseResults.length === 0 && !browsing && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, color: "var(--text-muted)" }}>
          <div style={{ fontSize: 48 }}>🎬</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Search for any movie or TV series</div>
          <div style={{ fontSize: 12 }}>Powered by imdbapi.dev · Real IMDb data</div>
        </div>
      )}
    </div>
  );
}
