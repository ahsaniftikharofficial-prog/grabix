// grabix-ui/src/pages/MoviesPage.tsx
// Updated: Play (VidSrc), Download, Favorite buttons

import { useState, useEffect } from "react";
import { IconSearch, IconStar, IconPlay, IconDownload, IconX, IconRefresh } from "../components/Icons";
import { IconHeart } from "../components/Icons";
import DownloadOptionsModal from "../components/DownloadOptionsModal";
import { useFavorites } from "../context/FavoritesContext";
import { fetchConsumetMetaSearch } from "../lib/consumetProviders";
import { queueVideoDownload, resolveSourceDownloadOptions, type DownloadQualityOption } from "../lib/downloads";
import VidSrcPlayer from "../components/VidSrcPlayer";
import { fetchMovieBoxSources, getArchiveMovieSources, getMovieSources, searchMovieBox, type MovieBoxItem, type StreamSource } from "../lib/streamProviders";

const TMDB_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI5OTk3Y2E5ZjY2NGZhZmI5ZWJkZmNhNDMyNGY0YTBmOCIsIm5iZiI6MTc3NDU2NDcyMC44NDYwMDAyLCJzdWIiOiI2OWM1YjU3MGE4NTBkNjcxOTE4OWJjN2MiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.uv8_l7Ub7WRhSfWtd07Sx_Yg13jubgyU7953kJZy7mw";
const TMDB     = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const IMG_LG   = "https://image.tmdb.org/t/p/w780";
const GRABIX   = "http://127.0.0.1:8000";
const HEADERS  = { "Authorization": `Bearer ${TMDB_TOKEN}`, "Content-Type": "application/json" };

interface Movie {
  id: number; title: string; overview: string;
  poster_path: string; backdrop_path?: string;
  vote_average: number; release_date: string;
  imdb_id?: string;
  genres?: { id: number; name: string }[];
}
interface ArchiveItem {
  identifier: string; title: string; year?: string;
  description?: string; thumb?: string;
}
type Tab = "trending" | "popular" | "toprated" | "free";

export default function MoviesPage() {
  const [tab, setTab]       = useState<Tab>("trending");
  const [movies, setMovies] = useState<Movie[]>([]);
  const [free, setFree]     = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [query, setQuery]   = useState("");
  const [detail, setDetail] = useState<Movie | null>(null);
  const [freeDetail, setFD] = useState<ArchiveItem | null>(null);
  const [player, setPlayer] = useState<{ title: string; subtitle?: string; poster?: string; sources: StreamSource[] } | null>(null);
  const [page, setPage]     = useState(1);

  const tf = async (ep: string) => (await fetch(`${TMDB}${ep}`, { headers: HEADERS })).json();

  const fetchTMDB = async (t: Tab, p = 1) => {
    setLoading(true);
    try {
      const eps: Record<string, string> = { trending: `/trending/movie/week?page=${p}`, popular: `/movie/popular?page=${p}`, toprated: `/movie/top_rated?page=${p}` };
      const d = await tf(eps[t]);
      setMovies(p === 1 ? (d.results ?? []) : prev => [...prev, ...(d.results ?? [])]);
    } catch { setMovies([]); } finally { setLoading(false); }
  };

  const fetchFree = async () => {
    setLoading(true);
    try {
      const r = await fetch(`https://archive.org/advancedsearch.php?q=mediatype:movies+AND+subject:feature+film&fl[]=identifier,title,year,description&rows=24&output=json&sort[]=downloads+desc`);
      const d = await r.json();
      setFree((d.response?.docs ?? []).map((doc: any) => ({ identifier: doc.identifier, title: doc.title ?? "Unknown", year: doc.year, description: doc.description, thumb: `https://archive.org/services/img/${doc.identifier}` })));
    } catch { setFree([]); } finally { setLoading(false); }
  };

  const searchMovies = async (q: string, p = 1) => {
    setLoading(true);
    try {
      const d = await tf(`/search/movie?query=${encodeURIComponent(q)}&page=${p}`);
      setMovies(p === 1 ? (d.results ?? []) : prev => [...prev, ...(d.results ?? [])]);
    } catch { setMovies([]); } finally { setLoading(false); }
  };

  useEffect(() => {
    setPage(1);
    if (query) { searchMovies(query, 1); return; }
    if (tab === "free") fetchFree(); else fetchTMDB(tab, 1);
  }, [tab, query]);

  const loadMore = () => { const n = page + 1; setPage(n); if (query) searchMovies(query, n); else if (tab !== "free") fetchTMDB(tab, n); };

  const TABS = [
    { id: "trending" as Tab, label: "Trending" },
    { id: "popular"  as Tab, label: "Popular"  },
    { id: "toprated" as Tab, label: "Top Rated"},
    { id: "free"     as Tab, label: "Free Movies"},
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Movies</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>Browse · Stream · Download</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}><IconSearch size={13} color="var(--text-muted)" /></div>
            <input className="input-base" style={{ paddingLeft: 32, width: 220, fontSize: 13 }} placeholder="Search movies…" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && (search.trim() ? setQuery(search.trim()) : setQuery(""))} />
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
              {t.id === "free" && <span style={{ marginLeft: 5, background: "var(--text-success)", color: "white", fontSize: 9, padding: "1px 5px", borderRadius: 6, fontWeight: 700 }}>FREE</span>}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {loading && (tab === "free" ? free.length === 0 : movies.length === 0) ? <LoadingGrid /> :
         tab === "free" ? (
          <>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>Public domain films from Archive.org — free to stream and download legally.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
              {free.map(m => <FreeCard key={m.identifier} movie={m} onClick={() => setFD(m)} />)}
            </div>
          </>
         ) : movies.length === 0 ? <div className="empty-state"><IconSearch size={36} /><p>No results</p></div> : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
              {movies.map(m => <MovieCard key={m.id} movie={m} onClick={() => setDetail(m)} />)}
            </div>
            <div style={{ textAlign: "center", marginTop: 24 }}>
              <button className="btn btn-ghost" style={{ gap: 6 }} onClick={loadMore} disabled={loading}><IconRefresh size={14} /> Load more</button>
            </div>
          </>
         )}
      </div>

      {detail && !player && <MovieDetail movie={detail} onClose={() => setDetail(null)} tf={tf} onPlay={(nextPlayer) => { setDetail(null); setPlayer(nextPlayer); }} />}
      {freeDetail && !player && <FreeDetail movie={freeDetail} onClose={() => setFD(null)} onPlay={(nextPlayer) => { setFD(null); setPlayer(nextPlayer); }} />}
      {player && <VidSrcPlayer title={player.title} subtitle={player.subtitle} poster={player.poster} sources={player.sources} mediaType="movie" onClose={() => setPlayer(null)} />}
    </div>
  );
}

function MovieCard({ movie, onClick }: { movie: Movie; onClick: () => void }) {
  return (
    <div className="card" style={{ overflow: "hidden", cursor: "pointer", transition: "transform 0.15s" }} onClick={onClick} onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-3px)")} onMouseLeave={e => (e.currentTarget.style.transform = "translateY(0)")}>
      <div style={{ position: "relative" }}>
        {movie.poster_path ? <img src={`${IMG_BASE}${movie.poster_path}`} alt={movie.title} style={{ width: "100%", height: 210, objectFit: "cover" }} /> : <div style={{ width: "100%", height: 210, background: "var(--bg-surface2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>No Poster</div>}
        {movie.vote_average > 0 && <div style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.75)", color: "#fdd663", fontSize: 11, padding: "2px 7px", borderRadius: 6, display: "flex", alignItems: "center", gap: 3, fontWeight: 600 }}><IconStar size={10} color="#fdd663" /> {movie.vote_average.toFixed(1)}</div>}
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{movie.title}</div>
        {movie.release_date && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{movie.release_date.slice(0, 4)}</div>}
      </div>
    </div>
  );
}

function FreeCard({ movie, onClick }: { movie: ArchiveItem; onClick: () => void }) {
  return (
    <div className="card" style={{ overflow: "hidden", cursor: "pointer", transition: "transform 0.15s" }} onClick={onClick} onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-3px)")} onMouseLeave={e => (e.currentTarget.style.transform = "translateY(0)")}>
      <div style={{ position: "relative" }}>
        <img src={movie.thumb} alt={movie.title} style={{ width: "100%", height: 210, objectFit: "cover" }} onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/150x210?text=No+Poster"; }} />
        <div style={{ position: "absolute", top: 6, left: 6, background: "var(--text-success)", color: "white", fontSize: 9, padding: "2px 6px", borderRadius: 5, fontWeight: 700 }}>FREE</div>
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{movie.title}</div>
        {movie.year && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{movie.year}</div>}
      </div>
    </div>
  );
}

function ActionButtons({ onPlay, onDownload, onHindi, favId, favItem }: { onPlay: () => void; onDownload: () => void; onHindi?: () => void; favId: string; favItem: any }) {
  const { isFav, toggle } = useFavorites();
  const fav = isFav(favId);
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
      <button className="btn btn-primary" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={onPlay}>
        <IconPlay size={15} /> Play
      </button>
      {onHindi && (
        <button className="btn btn-ghost" style={{ gap: 7, justifyContent: "center", paddingInline: 14 }} onClick={onHindi}>
          Hindi
        </button>
      )}
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

function MovieDetail({ movie, onClose, tf, onPlay }: { movie: Movie; onClose: () => void; tf: (e: string) => Promise<any>; onPlay: (player: { title: string; subtitle?: string; poster?: string; sources: StreamSource[] }) => void }) {
  const [full, setFull]       = useState<Movie | null>(null);
  const [altTitles, setAltTitles] = useState<string[]>([]);
  const [hindiNotice, setHindiNotice] = useState("");
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [downloadLanguage, setDownloadLanguage] = useState<"english" | "hindi">("english");
  const [downloadQuality, setDownloadQuality] = useState("");
  const [downloadOptions, setDownloadOptions] = useState<DownloadQualityOption[]>([]);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  useEffect(() => { tf(`/movie/${movie.id}`).then(setFull).catch(() => {}); }, [movie.id]);
  useEffect(() => {
    let cancelled = false;
    fetchConsumetMetaSearch(movie.title, "movie")
      .then((items) => {
        if (cancelled) return;
        const titles = items
          .flatMap((item) => [item.title, item.alt_title])
          .filter((value): value is string => Boolean(value))
          .filter((value, index, array) => array.indexOf(value) === index && value.toLowerCase() !== movie.title.toLowerCase())
          .slice(0, 3);
        setAltTitles(titles);
      })
      .catch(() => {
        if (!cancelled) setAltTitles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [movie.title]);

  const d = full ?? movie;
  const movieYear = d.release_date ? Number(d.release_date.slice(0, 4)) : undefined;
  const poster = d.poster_path ? `${IMG_BASE}${d.poster_path}` : "";
  const fallbackSources = getMovieSources({ tmdbId: movie.id, imdbId: d.imdb_id });

  const loadMovieBoxSources = async () => {
    const titles = [d.title, ...altTitles];
    for (const title of titles) {
      try {
        const sources = await fetchMovieBoxSources({
          title,
          mediaType: "movie",
          year: Number.isFinite(movieYear) ? movieYear : undefined,
        });
        if (sources.length > 0) return sources;
      } catch {
        continue;
      }
    }
    return [];
  };

  const isHindiMovieBoxItem = (item: MovieBoxItem) => {
    const title = (item.title || "").toLowerCase();
    return Boolean(item.is_hindi) || title.includes("hindi");
  };

  const loadHindiMovieBoxSources = async () => {
    const titles = [d.title, ...altTitles];
    for (const title of titles) {
      try {
        const result = await searchMovieBox({
          query: title,
          mediaType: "movie",
          hindiOnly: true,
          preferHindi: true,
          sortBy: "search",
          perPage: 10,
        });
        const hindiItem = (result.items ?? []).find((item) => {
          const sameYear = !movieYear || !item.year || item.year === movieYear;
          return sameYear && isHindiMovieBoxItem(item);
        });
        if (!hindiItem?.id) continue;
        const sources = await fetchMovieBoxSources({
          subjectId: hindiItem.id,
          mediaType: "movie",
          year: Number.isFinite(movieYear) ? movieYear : undefined,
        });
        if (sources.length > 0) {
          return sources;
        }
      } catch {
        continue;
      }
    }
    return [] as StreamSource[];
  };

  const loadDownloadOptions = async (language = downloadLanguage) => {
    setDownloadLoading(true);
    setDownloadError("");
    try {
      const sources = language === "hindi" ? await loadHindiMovieBoxSources() : await loadMovieBoxSources();
      if (sources.length > 0) {
        const options = await resolveSourceDownloadOptions(sources);
        setDownloadOptions(options);
        setDownloadQuality(options[0]?.id || "");
        return;
      }
      if (language === "hindi") {
        setDownloadOptions([]);
        setDownloadQuality("");
        setDownloadError("No Hindi source available. Try downloading in English.");
        return;
      }

      const fallbackOptions = await resolveSourceDownloadOptions(fallbackSources.slice(0, 1));
      setDownloadOptions(fallbackOptions);
      setDownloadQuality(fallbackOptions[0]?.id || "");
      if (fallbackOptions.length === 0) {
        setDownloadError("No downloadable source was found for this movie.");
      }
    } catch (error) {
      setDownloadOptions([]);
      setDownloadQuality("");
      setDownloadError(error instanceof Error ? error.message : "Download options could not be loaded.");
    } finally {
      setDownloadLoading(false);
    }
  };

  useEffect(() => {
    if (!downloadDialogOpen) return;
    void loadDownloadOptions(downloadLanguage);
  }, [downloadDialogOpen, downloadLanguage, d.title, movieYear]);

  const handlePlay = async () => {
    setHindiNotice("");
    onPlay({
      title: d.title,
      subtitle: "Movie playback with GRABIX servers",
      poster: poster || undefined,
      sources: fallbackSources,
    });
  };

  const handleHindi = async () => {
    const hindi = await loadHindiMovieBoxSources();
    if (!hindi.length) {
      setHindiNotice("No Hindi source found. Watch it in OG language.");
      return;
    }
    setHindiNotice("");
    onPlay({
      title: d.title,
      subtitle: "Hindi playback from MovieBox",
      poster: poster || undefined,
      sources: hindi,
    });
  };

  const handleDownload = async () => {
    const movieBoxSources = await loadMovieBoxSources();
    const movieBoxDirectSource = movieBoxSources[0];
    const thumbnail = d.poster_path ? `${IMG_BASE}${d.poster_path}` : "";
    const englishTitle = `${d.title} — English — ${movieBoxDirectSource?.quality || "Auto"}`;
    if (movieBoxDirectSource) {
      await fetch(`${GRABIX}/download?url=${encodeURIComponent(movieBoxDirectSource.url)}&dl_type=video&title=${encodeURIComponent(englishTitle)}&thumbnail=${encodeURIComponent(thumbnail)}`);
      window.dispatchEvent(new CustomEvent("grabix:navigate", { detail: { page: "downloader" } }));
      return;
    }

    const fallbackSource = getMovieSources({ tmdbId: movie.id, imdbId: d.imdb_id })[0];
    if (fallbackSource) {
      await fetch(`${GRABIX}/download?url=${encodeURIComponent(fallbackSource.url)}&dl_type=video&title=${encodeURIComponent(`${d.title} — English — ${fallbackSource.quality || "Auto"}`)}&thumbnail=${encodeURIComponent(thumbnail)}`);
      window.dispatchEvent(new CustomEvent("grabix:navigate", { detail: { page: "downloader" } }));
    }
  };
  void handleDownload;

  const handleDownloadDialog = async () => {
    setDownloadLanguage("english");
    setDownloadQuality("");
    setDownloadOptions([]);
    setDownloadError("");
    setDownloadDialogOpen(true);
  };

  const confirmDownload = async () => {
    const selectedOption = downloadOptions.find((option) => option.id === downloadQuality);
    if (!selectedOption) {
      setDownloadError("Choose a quality before downloading.");
      return;
    }

    setDownloadLoading(true);
    try {
      await queueVideoDownload({
        url: selectedOption.url,
        title: `${d.title} — ${downloadLanguage === "hindi" ? "Hindi" : "English"} — ${selectedOption.label}`,
        thumbnail: poster,
        headers: selectedOption.headers,
        forceHls: selectedOption.forceHls,
      });
      setDownloadDialogOpen(false);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Could not queue this movie download.");
    } finally {
      setDownloadLoading(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 16, width: "100%", maxWidth: 700, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
        {d.backdrop_path && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <img src={`${IMG_LG}${d.backdrop_path}`} alt="" style={{ width: "100%", height: 180, objectFit: "cover" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(transparent 40%, var(--bg-surface))" }} />
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 24px" }}>
          <div style={{ display: "flex", gap: 16, marginTop: d.backdrop_path ? -50 : 20 }}>
            {d.poster_path && <img src={`${IMG_BASE}${d.poster_path}`} alt={d.title} style={{ width: 90, height: 135, objectFit: "cover", borderRadius: 10, flexShrink: 0, border: "2px solid var(--border)", position: "relative", zIndex: 1 }} />}
            <div style={{ flex: 1, paddingTop: d.backdrop_path ? 55 : 0, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{d.title}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {d.vote_average > 0 && <span style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 600, color: "#fdd663" }}><IconStar size={11} color="#fdd663" /> {d.vote_average.toFixed(1)}</span>}
                {d.release_date && <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>{d.release_date.slice(0, 4)}</span>}
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {(full?.genres ?? []).slice(0, 4).map((g: any) => <span key={g.id} style={{ background: "var(--bg-active)", color: "var(--text-accent)", padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 500 }}>{g.name}</span>)}
              </div>
            </div>
            <button className="btn-icon" style={{ alignSelf: "flex-start", flexShrink: 0, marginTop: d.backdrop_path ? 55 : 0 }} onClick={onClose}><IconX size={16} /></button>
          </div>
          {d.overview && <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, margin: "14px 0" }}>{d.overview}</div>}
          <ActionButtons
            onPlay={handlePlay}
            onDownload={handleDownloadDialog}
            onHindi={handleHindi}
            favId={`movie-${movie.id}`}
            favItem={{ id: `movie-${movie.id}`, title: d.title, poster: d.poster_path ? `${IMG_BASE}${d.poster_path}` : "", type: "movie", tmdbId: movie.id, imdbId: d.imdb_id }}
          />
          {hindiNotice && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -4 }}>{hindiNotice}</div>}
        </div>
      </div>
      <DownloadOptionsModal
        visible={downloadDialogOpen}
        title={d.title}
        poster={poster || undefined}
        languageOptions={[
          { id: "english", label: "English" },
          { id: "hindi", label: "Hindi" },
        ]}
        selectedLanguage={downloadLanguage}
        onSelectLanguage={(value) => setDownloadLanguage(value as "english" | "hindi")}
        qualityOptions={downloadOptions.map((option) => ({ id: option.id, label: option.label }))}
        selectedQuality={downloadQuality}
        onSelectQuality={setDownloadQuality}
        loading={downloadLoading}
        error={downloadError}
        onClose={() => setDownloadDialogOpen(false)}
        onConfirm={() => void confirmDownload()}
      />
    </div>
  );
}

function FreeDetail({ movie, onClose, onPlay }: { movie: ArchiveItem; onClose: () => void; onPlay: (player: { title: string; subtitle?: string; poster?: string; sources: StreamSource[] }) => void }) {
  const archiveUrl = `https://archive.org/details/${movie.identifier}`;

  const sendDl = async () => {
    try { await fetch(`${GRABIX}/download?url=${encodeURIComponent(archiveUrl)}&dl_type=video&title=${encodeURIComponent(`${movie.title} — English — Source`)}&thumbnail=${encodeURIComponent(movie.thumb ?? "")}`); }
    catch { /* ignore */ }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 16, width: "100%", maxWidth: 680, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "20px 20px 0" }}>
          <img src={movie.thumb} alt={movie.title} style={{ width: 90, height: 130, objectFit: "cover", borderRadius: 8, flexShrink: 0, border: "1px solid var(--border)" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{movie.title}</div>
              <span style={{ background: "var(--text-success)", color: "white", fontSize: 9, padding: "2px 6px", borderRadius: 5, fontWeight: 700 }}>FREE</span>
            </div>
            {movie.year && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{movie.year} · Public domain · Archive.org</div>}
          </div>
          <button className="btn-icon" style={{ flexShrink: 0 }} onClick={onClose}><IconX size={16} /></button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px" }}>
          {movie.description && <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 16 }}>{typeof movie.description === "string" ? movie.description.replace(/<[^>]+>/g, "").slice(0, 400) + "…" : ""}</div>}
          <ActionButtons
            onPlay={() => onPlay({
              title: movie.title,
              subtitle: "Archive.org public-domain stream",
              poster: movie.thumb ?? undefined,
              sources: getArchiveMovieSources(movie.identifier),
            })}
            onDownload={sendDl}
            favId={`archive-${movie.identifier}`}
            favItem={{ id: `archive-${movie.identifier}`, title: movie.title, poster: movie.thumb ?? "", type: "movie", tmdbId: 0 }}
          />
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
