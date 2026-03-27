import { useEffect, useState } from "react";
import { IconCheck, IconDownload, IconPlay, IconRefresh, IconSearch, IconStar, IconX } from "../components/Icons";
import { IconHeart } from "../components/Icons";
import VidSrcPlayer from "../components/VidSrcPlayer";
import { useFavorites } from "../context/FavoritesContext";
import { fetchMovieBoxSources, getTvSources, type StreamSource } from "../lib/streamProviders";

const TMDB_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI5OTk3Y2E5ZjY2NGZhZmI5ZWJkZmNhNDMyNGY0YTBmOCIsIm5iZiI6MTc3NDU2NDcyMC44NDYwMDAyLCJzdWIiOiI2OWM1YjU3MGE4NTBkNjcxOTE4OWJjN2MiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.uv8_l7Ub7WRhSfWtd07Sx_Yg13jubgyU7953kJZy7mw";
const TMDB = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const IMG_LG = "https://image.tmdb.org/t/p/w780";
const GRABIX = "http://127.0.0.1:8000";
const HEADERS = { Authorization: `Bearer ${TMDB_TOKEN}`, "Content-Type": "application/json" };

interface Show {
  id: number;
  name: string;
  overview: string;
  poster_path: string;
  backdrop_path?: string;
  vote_average: number;
  first_air_date: string;
  genres?: { id: number; name: string }[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  status?: string;
  external_ids?: { imdb_id?: string };
}

type Tab = "trending" | "popular" | "toprated" | "onair";

export default function TVSeriesPage() {
  const [tab, setTab] = useState<Tab>("trending");
  const [shows, setShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<Show | null>(null);
  const [player, setPlayer] = useState<{ title: string; subtitle?: string; poster?: string; sources: StreamSource[] } | null>(null);
  const [page, setPage] = useState(1);

  const tf = async (endpoint: string) => (await fetch(`${TMDB}${endpoint}`, { headers: HEADERS })).json();

  const fetchTMDB = async (nextTab: Tab, nextPage = 1) => {
    setLoading(true);
    try {
      const endpoints: Record<Tab, string> = {
        trending: `/trending/tv/week?page=${nextPage}`,
        popular: `/tv/popular?page=${nextPage}`,
        toprated: `/tv/top_rated?page=${nextPage}`,
        onair: `/tv/on_the_air?page=${nextPage}`,
      };
      const data = await tf(endpoints[nextTab]);
      const nextShows = (data.results ?? []) as Show[];
      setShows((prev) => (nextPage === 1 ? nextShows : [...prev, ...nextShows]));
    } catch {
      setShows([]);
    } finally {
      setLoading(false);
    }
  };

  const searchShows = async (nextQuery: string, nextPage = 1) => {
    setLoading(true);
    try {
      const data = await tf(`/search/tv?query=${encodeURIComponent(nextQuery)}&page=${nextPage}`);
      const nextShows = (data.results ?? []) as Show[];
      setShows((prev) => (nextPage === 1 ? nextShows : [...prev, ...nextShows]));
    } catch {
      setShows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
    if (query) {
      searchShows(query, 1);
      return;
    }
    fetchTMDB(tab, 1);
  }, [tab, query]);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    if (query) searchShows(query, nextPage);
    else fetchTMDB(tab, nextPage);
  };

  const tabs = [
    { id: "trending" as Tab, label: "Trending" },
    { id: "popular" as Tab, label: "Popular" },
    { id: "toprated" as Tab, label: "Top Rated" },
    { id: "onair" as Tab, label: "On Air" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>TV Series</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>Browse · Stream · Download</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}><IconSearch size={13} color="var(--text-muted)" /></div>
            <input className="input-base" style={{ paddingLeft: 32, width: 220, fontSize: 13 }} placeholder="Search series..." value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (search.trim() ? setQuery(search.trim()) : setQuery(""))} />
          </div>
          <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={() => (search.trim() ? setQuery(search.trim()) : setQuery(""))}>Search</button>
          {query && <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => { setQuery(""); setSearch(""); }}><IconX size={13} /> Clear</button>}
        </div>
      </div>

      {!query && (
        <div style={{ display: "flex", gap: 4, padding: "10px 24px 0", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
          {tabs.map((nextTab) => (
            <button key={nextTab.id} onClick={() => setTab(nextTab.id)} style={{ padding: "7px 16px", fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer", background: "transparent", borderBottom: tab === nextTab.id ? "2px solid var(--accent)" : "2px solid transparent", color: tab === nextTab.id ? "var(--accent)" : "var(--text-muted)", transition: "var(--transition)", borderRadius: 0 }}>
              {nextTab.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {loading && shows.length === 0 ? <LoadingGrid /> : shows.length === 0 ? (
          <div className="empty-state"><IconSearch size={36} /><p>No results</p></div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
              {shows.map((show) => <SeriesCard key={show.id} show={show} onClick={() => setDetail(show)} />)}
            </div>
            <div style={{ textAlign: "center", marginTop: 24 }}>
              <button className="btn btn-ghost" style={{ gap: 6 }} onClick={loadMore} disabled={loading}><IconRefresh size={14} /> Load more</button>
            </div>
          </>
        )}
      </div>

      {detail && !player && <SeriesDetail show={detail} tf={tf} onClose={() => setDetail(null)} onPlay={(nextPlayer) => { setDetail(null); setPlayer(nextPlayer); }} />}
      {player && <VidSrcPlayer title={player.title} subtitle={player.subtitle} poster={player.poster} sources={player.sources} onClose={() => setPlayer(null)} />}
    </div>
  );
}

function SeriesCard({ show, onClick }: { show: Show; onClick: () => void }) {
  return (
    <div className="card" style={{ overflow: "hidden", cursor: "pointer", transition: "transform 0.15s" }} onClick={onClick} onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-3px)")} onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}>
      <div style={{ position: "relative" }}>
        {show.poster_path ? <img src={`${IMG_BASE}${show.poster_path}`} alt={show.name} style={{ width: "100%", height: 210, objectFit: "cover" }} /> : <div style={{ width: "100%", height: 210, background: "var(--bg-surface2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>No Poster</div>}
        {show.vote_average > 0 && <div style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.75)", color: "#fdd663", fontSize: 11, padding: "2px 7px", borderRadius: 6, display: "flex", alignItems: "center", gap: 3, fontWeight: 600 }}><IconStar size={10} color="#fdd663" /> {show.vote_average.toFixed(1)}</div>}
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{show.name}</div>
        {show.first_air_date && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{show.first_air_date.slice(0, 4)}</div>}
      </div>
    </div>
  );
}

function SeriesActions({ onPlay, onDownload, favId, favItem }: { onPlay: () => void; onDownload: () => void; favId: string; favItem: { id: string; title: string; poster: string; type: "series"; tmdbId: number; imdbId?: string } }) {
  const { isFav, toggle } = useFavorites();
  const fav = isFav(favId);

  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
      <button className="btn btn-primary" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={onPlay}>
        <IconPlay size={15} /> Play
      </button>
      <button className="btn btn-ghost" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={onDownload}>
        <IconDownload size={15} /> Download
      </button>
      <button className="btn btn-ghost" style={{ gap: 7, flex: 1, justifyContent: "center", color: fav ? "var(--text-danger)" : "var(--text-primary)" }} onClick={() => toggle(favItem)}>
        <IconHeart size={15} color={fav ? "var(--text-danger)" : "currentColor"} filled={fav} />
        {fav ? "Saved" : "Favorite"}
      </button>
    </div>
  );
}

function SeriesDetail({ show, tf, onClose, onPlay }: { show: Show; tf: (endpoint: string) => Promise<any>; onClose: () => void; onPlay: (player: { title: string; subtitle?: string; poster?: string; sources: StreamSource[] }) => void }) {
  const [full, setFull] = useState<Show | null>(null);
  const [dlUrl, setDlUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);

  useEffect(() => {
    tf(`/tv/${show.id}?append_to_response=external_ids`).then(setFull).catch(() => {});
  }, [show.id, tf]);

  const data = full ?? show;
  const seriesYear = data.first_air_date ? Number(data.first_air_date.slice(0, 4)) : undefined;

  const loadMovieBoxSources = async () => {
    try {
      return await fetchMovieBoxSources({
        title: data.name,
        mediaType: "series",
        year: Number.isFinite(seriesYear) ? seriesYear : undefined,
        season,
        episode,
      });
    } catch {
      return [];
    }
  };

  const handlePlay = async () => {
    const movieBoxSources = await loadMovieBoxSources();
    onPlay({
      title: data.name,
      subtitle: `TV playback for S${season}E${episode} powered by Movie Box direct sources plus GRABIX fallback providers`,
      poster: data.poster_path ? `${IMG_BASE}${data.poster_path}` : undefined,
      sources: [
        ...movieBoxSources,
        ...getTvSources({ tmdbId: show.id, imdbId: data.external_ids?.imdb_id }, { season, episode }),
      ],
    });
  };

  const handleDownload = async () => {
    const movieBoxSources = await loadMovieBoxSources();
    const directSource = movieBoxSources[0];

    if (directSource) {
      await fetch(`${GRABIX}/download?url=${encodeURIComponent(directSource.externalUrl ?? directSource.url)}&dl_type=video`);
      return;
    }

    window.open(`https://vidsrc.to/embed/tv/${show.id}`, "_blank");
  };

  const sendDl = async () => {
    if (!dlUrl.trim()) return;
    setSending(true);
    try {
      await fetch(`${GRABIX}/download?url=${encodeURIComponent(dlUrl.trim())}&dl_type=video`);
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } catch {
      // Ignore download send failures in the modal.
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 16, width: "100%", maxWidth: 700, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
        {data.backdrop_path && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <img src={`${IMG_LG}${data.backdrop_path}`} alt="" style={{ width: "100%", height: 180, objectFit: "cover" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(transparent 40%, var(--bg-surface))" }} />
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 24px" }}>
          <div style={{ display: "flex", gap: 16, marginTop: data.backdrop_path ? -50 : 20 }}>
            {data.poster_path && <img src={`${IMG_BASE}${data.poster_path}`} alt={data.name} style={{ width: 90, height: 135, objectFit: "cover", borderRadius: 10, flexShrink: 0, border: "2px solid var(--border)", position: "relative", zIndex: 1 }} />}
            <div style={{ flex: 1, paddingTop: data.backdrop_path ? 55 : 0, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{data.name}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {data.vote_average > 0 && <span style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 600, color: "#fdd663" }}><IconStar size={11} color="#fdd663" /> {data.vote_average.toFixed(1)}</span>}
                {data.first_air_date && <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>{data.first_air_date.slice(0, 4)}</span>}
                {typeof data.number_of_seasons === "number" && <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>{data.number_of_seasons} season{data.number_of_seasons === 1 ? "" : "s"}</span>}
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {(data.genres ?? []).slice(0, 4).map((genre) => <span key={genre.id} style={{ background: "var(--bg-active)", color: "var(--text-accent)", padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 500 }}>{genre.name}</span>)}
              </div>
            </div>
            <button className="btn-icon" style={{ alignSelf: "flex-start", flexShrink: 0, marginTop: data.backdrop_path ? 55 : 0 }} onClick={onClose}><IconX size={16} /></button>
          </div>

          {data.overview && <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, margin: "14px 0" }}>{data.overview}</div>}

          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Season</div>
              <input className="input-base" type="number" min={1} value={season} onChange={(e) => setSeason(Math.max(1, Number(e.target.value) || 1))} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Episode</div>
              <input className="input-base" type="number" min={1} value={episode} onChange={(e) => setEpisode(Math.max(1, Number(e.target.value) || 1))} />
            </div>
          </div>

          <SeriesActions
            onPlay={handlePlay}
            onDownload={handleDownload}
            favId={`series-${show.id}`}
            favItem={{ id: `series-${show.id}`, title: data.name, poster: data.poster_path ? `${IMG_BASE}${data.poster_path}` : "", type: "series", tmdbId: show.id, imdbId: data.external_ids?.imdb_id }}
          />

          <div style={{ background: "var(--bg-surface2)", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--text-secondary)" }}>Download from custom URL</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input-base" style={{ flex: 1, fontSize: 13 }} placeholder="Paste video URL..." value={dlUrl} onChange={(e) => setDlUrl(e.target.value)} />
              <button className="btn btn-primary" style={{ gap: 6, flexShrink: 0 }} onClick={sendDl} disabled={sending || !dlUrl.trim()}>
                {sent ? <><IconCheck size={13} /> Sent!</> : sending ? "Sending..." : <><IconDownload size={13} /> Send</>}
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
      {Array.from({ length: 16 }).map((_, index) => (
        <div key={index} className="card" style={{ overflow: "hidden" }}>
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
