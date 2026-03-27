// grabix-ui/src/pages/MoviesPage.tsx
// Phase 4 — Movies: Browse (TMDB), Search, Stream (Archive.org), Download

import { useState, useEffect } from "react";
import {
  IconSearch, IconStar, IconPlay, IconDownload,
  IconX, IconRefresh, IconCheck,
} from "../components/Icons";

const TMDB_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI5OTk3Y2E5ZjY2NGZhZmI5ZWJkZmNhNDMyNGY0YTBmOCIsIm5iZiI6MTc3NDU2NDcyMC44NDYwMDAyLCJzdWIiOiI2OWM1YjU3MGE4NTBkNjcxOTE4OWJjN2MiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.uv8_l7Ub7WRhSfWtd07Sx_Yg13jubgyU7953kJZy7mw";
const TMDB      = "https://api.themoviedb.org/3";
const IMG_BASE  = "https://image.tmdb.org/t/p/w500";
const IMG_LG    = "https://image.tmdb.org/t/p/w780";
const GRABIX    = "http://127.0.0.1:8000";

const TMDB_HEADERS = {
  "Authorization": `Bearer ${TMDB_TOKEN}`,
  "Content-Type": "application/json",
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface Movie {
  id: number;
  title: string;
  overview: string;
  poster_path: string;
  backdrop_path?: string;
  vote_average: number;
  release_date: string;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
}

interface ArchiveItem {
  identifier: string;
  title: string;
  year?: string;
  description?: string;
  thumb?: string;
}

type Tab = "trending" | "popular" | "toprated" | "free";

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MoviesPage() {
  const [tab, setTab]         = useState<Tab>("trending");
  const [movies, setMovies]   = useState<Movie[]>([]);
  const [freeMovies, setFree] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [query, setQuery]     = useState("");
  const [detail, setDetail]   = useState<Movie | null>(null);
  const [freeDetail, setFD]   = useState<ArchiveItem | null>(null);
  const [page, setPage]       = useState(1);

  const tmdbFetch = async (endpoint: string) => {
    const r = await fetch(`${TMDB}${endpoint}`, { headers: TMDB_HEADERS });
    return r.json();
  };

  const fetchTMDB = async (t: Tab, p = 1) => {
    setLoading(true);
    try {
      let endpoint = "";
      if (t === "trending") endpoint = `/trending/movie/week?page=${p}`;
      if (t === "popular")  endpoint = `/movie/popular?page=${p}`;
      if (t === "toprated") endpoint = `/movie/top_rated?page=${p}`;
      const d = await tmdbFetch(endpoint);
      setMovies(p === 1 ? (d.results ?? []) : prev => [...prev, ...(d.results ?? [])]);
    } catch { setMovies([]); }
    finally { setLoading(false); }
  };

  const fetchFree = async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `https://archive.org/advancedsearch.php?q=mediatype:movies+AND+subject:feature+film&fl[]=identifier,title,year,description&rows=24&output=json&sort[]=downloads+desc`
      );
      const d = await r.json();
      const docs = d.response?.docs ?? [];
      setFree(docs.map((doc: any) => ({
        identifier:  doc.identifier,
        title:       doc.title ?? "Unknown",
        year:        doc.year,
        description: doc.description,
        thumb:       `https://archive.org/services/img/${doc.identifier}`,
      })));
    } catch { setFree([]); }
    finally { setLoading(false); }
  };

  const searchTMDB = async (q: string, p = 1) => {
    setLoading(true);
    try {
      const d = await tmdbFetch(`/search/movie?query=${encodeURIComponent(q)}&page=${p}`);
      setMovies(p === 1 ? (d.results ?? []) : prev => [...prev, ...(d.results ?? [])]);
    } catch { setMovies([]); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    setPage(1);
    if (query) { searchTMDB(query, 1); return; }
    if (tab === "free") fetchFree();
    else fetchTMDB(tab, 1);
  }, [tab, query]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    if (query) searchTMDB(query, next);
    else if (tab !== "free") fetchTMDB(tab, next);
  };

  const handleSearch = () => {
    if (search.trim()) setQuery(search.trim());
    else setQuery("");
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: "trending", label: "Trending" },
    { id: "popular",  label: "Popular" },
    { id: "toprated", label: "Top Rated" },
    { id: "free",     label: "Free Movies" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>

      {/* Topbar */}
      <div style={{
        padding: "14px 24px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)", display: "flex",
        alignItems: "center", justifyContent: "space-between", gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Movies</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>Browse movies · Stream and download public domain films</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}>
              <IconSearch size={13} color="var(--text-muted)" />
            </div>
            <input
              className="input-base"
              style={{ paddingLeft: 32, width: 220, fontSize: 13 }}
              placeholder="Search movies…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
            />
          </div>
          <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={handleSearch}>Search</button>
          {query && (
            <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => { setQuery(""); setSearch(""); }}>
              <IconX size={13} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      {!query && (
        <div style={{ display: "flex", gap: 4, padding: "10px 24px 0", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "7px 16px", fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer",
                background: "transparent", borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                color: tab === t.id ? "var(--accent)" : "var(--text-muted)",
                transition: "var(--transition)", borderRadius: 0,
              }}
            >
              {t.label}
              {t.id === "free" && (
                <span style={{ marginLeft: 5, background: "var(--text-success)", color: "white", fontSize: 9, padding: "1px 5px", borderRadius: 6, fontWeight: 600 }}>FREE</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {loading && (tab === "free" ? freeMovies.length === 0 : movies.length === 0) ? (
          <LoadingGrid />
        ) : tab === "free" ? (
          <>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              Public domain films from Archive.org — free to stream and download legally.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
              {freeMovies.map(m => (
                <FreeMovieCard key={m.identifier} movie={m} onClick={() => setFD(m)} />
              ))}
            </div>
          </>
        ) : movies.length === 0 ? (
          <div className="empty-state"><IconSearch size={36} /><p>No results</p><span>Try a different search</span></div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
              {movies.map(m => (
                <MovieCard key={m.id} movie={m} onClick={() => setDetail(m)} />
              ))}
            </div>
            {tab !== "free" && (
              <div style={{ textAlign: "center", marginTop: 24 }}>
                <button className="btn btn-ghost" style={{ gap: 6 }} onClick={loadMore} disabled={loading}>
                  <IconRefresh size={14} /> Load more
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* TMDB detail modal */}
      {detail && <MovieDetail movie={detail} onClose={() => setDetail(null)} tmdbFetch={tmdbFetch} />}

      {/* Archive.org detail modal */}
      {freeDetail && <FreeMovieDetail movie={freeDetail} onClose={() => setFD(null)} />}
    </div>
  );
}

// ─── TMDB Movie Card ──────────────────────────────────────────────────────────
function MovieCard({ movie, onClick }: { movie: Movie; onClick: () => void }) {
  const year = movie.release_date ? movie.release_date.slice(0, 4) : "";
  return (
    <div
      className="card"
      style={{ overflow: "hidden", cursor: "pointer", transition: "transform 0.15s" }}
      onClick={onClick}
      onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-3px)")}
      onMouseLeave={e => (e.currentTarget.style.transform = "translateY(0)")}
    >
      <div style={{ position: "relative" }}>
        {movie.poster_path ? (
          <img
            src={`${IMG_BASE}${movie.poster_path}`}
            alt={movie.title}
            style={{ width: "100%", height: 210, objectFit: "cover" }}
          />
        ) : (
          <div style={{ width: "100%", height: 210, background: "var(--bg-surface2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--text-muted)" }}>No Poster</div>
        )}
        {movie.vote_average > 0 && (
          <div style={{
            position: "absolute", top: 6, right: 6,
            background: "rgba(0,0,0,0.75)", color: "#fdd663",
            fontSize: 11, padding: "2px 7px", borderRadius: 6,
            display: "flex", alignItems: "center", gap: 3, fontWeight: 600,
          }}>
            <IconStar size={10} color="#fdd663" /> {movie.vote_average.toFixed(1)}
          </div>
        )}
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{movie.title}</div>
        {year && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{year}</div>}
      </div>
    </div>
  );
}

// ─── Free Movie Card ──────────────────────────────────────────────────────────
function FreeMovieCard({ movie, onClick }: { movie: ArchiveItem; onClick: () => void }) {
  return (
    <div
      className="card"
      style={{ overflow: "hidden", cursor: "pointer", transition: "transform 0.15s" }}
      onClick={onClick}
      onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-3px)")}
      onMouseLeave={e => (e.currentTarget.style.transform = "translateY(0)")}
    >
      <div style={{ position: "relative" }}>
        <img
          src={movie.thumb}
          alt={movie.title}
          style={{ width: "100%", height: 210, objectFit: "cover" }}
          onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/150x210?text=No+Poster"; }}
        />
        <div style={{
          position: "absolute", top: 6, left: 6,
          background: "var(--text-success)", color: "white",
          fontSize: 9, padding: "2px 6px", borderRadius: 5, fontWeight: 700,
        }}>FREE</div>
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{movie.title}</div>
        {movie.year && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{movie.year}</div>}
      </div>
    </div>
  );
}

// ─── TMDB Movie Detail Modal ──────────────────────────────────────────────────
function MovieDetail({
  movie, onClose, tmdbFetch,
}: {
  movie: Movie;
  onClose: () => void;
  tmdbFetch: (e: string) => Promise<any>;
}) {
  const [full, setFull]       = useState<Movie | null>(null);
  const [dlUrl, setDlUrl]     = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);
  const year = movie.release_date ? movie.release_date.slice(0, 4) : "";

  useEffect(() => {
    tmdbFetch(`/movie/${movie.id}`)
      .then(d => setFull(d))
      .catch(() => {});
  }, [movie.id]);

  const displayMovie = full ?? movie;
  const genres = full?.genres ?? [];

  const sendToDownloader = async () => {
    if (!dlUrl.trim()) return;
    setSending(true);
    try {
      await fetch(`${GRABIX}/download?url=${encodeURIComponent(dlUrl.trim())}&dl_type=video`);
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } catch { /* ignore */ }
    finally { setSending(false); }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg-surface)", borderRadius: 16, width: "100%", maxWidth: 700,
          maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column",
          boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Backdrop */}
        {displayMovie.backdrop_path && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <img
              src={`${IMG_LG}${displayMovie.backdrop_path}`}
              alt=""
              style={{ width: "100%", height: 180, objectFit: "cover" }}
            />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(transparent 40%, var(--bg-surface))" }} />
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
          <div style={{ display: "flex", gap: 16, marginTop: displayMovie.backdrop_path ? -50 : 20 }}>
            {displayMovie.poster_path && (
              <img
                src={`${IMG_BASE}${displayMovie.poster_path}`}
                alt={displayMovie.title}
                style={{ width: 90, height: 135, objectFit: "cover", borderRadius: 10, flexShrink: 0, border: "2px solid var(--border)", position: "relative", zIndex: 1 }}
              />
            )}
            <div style={{ flex: 1, paddingTop: displayMovie.backdrop_path ? 60 : 0, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{displayMovie.title}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {displayMovie.vote_average > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 600, color: "#fdd663" }}>
                    <IconStar size={11} color="#fdd663" /> {displayMovie.vote_average.toFixed(1)}
                  </span>
                )}
                {year && <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>{year}</span>}
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {genres.slice(0, 4).map((g: any) => (
                  <span key={g.id} style={{ background: "var(--bg-active)", color: "var(--text-accent)", padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 500 }}>
                    {g.name}
                  </span>
                ))}
              </div>
            </div>
            <button className="btn-icon" style={{ alignSelf: "flex-start", flexShrink: 0, marginTop: displayMovie.backdrop_path ? 60 : 0 }} onClick={onClose}>
              <IconX size={16} />
            </button>
          </div>

          {displayMovie.overview && (
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, margin: "14px 0" }}>
              {displayMovie.overview}
            </div>
          )}

          {/* Download section */}
          <div style={{ background: "var(--bg-surface2)", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
              <IconDownload size={14} color="var(--accent)" /> Download
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
              Paste a legal URL to send it to your GRABIX downloader. For free public domain films, use the "Free Movies" tab.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input-base"
                style={{ flex: 1, fontSize: 13 }}
                placeholder="Paste video URL…"
                value={dlUrl}
                onChange={e => setDlUrl(e.target.value)}
              />
              <button
                className="btn btn-primary"
                style={{ gap: 6, flexShrink: 0 }}
                onClick={sendToDownloader}
                disabled={sending || !dlUrl.trim()}
              >
                {sent ? <><IconCheck size={13} /> Sent!</> : sending ? "Sending…" : <><IconDownload size={13} /> Download</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Archive.org Free Movie Detail Modal ─────────────────────────────────────
function FreeMovieDetail({ movie, onClose }: { movie: ArchiveItem; onClose: () => void }) {
  const [streaming, setStreaming] = useState(false);
  const [sending, setSending]     = useState(false);
  const [sent, setSent]           = useState(false);

  const archiveUrl  = `https://archive.org/details/${movie.identifier}`;
  const downloadUrl = `https://archive.org/download/${movie.identifier}`;
  const embedUrl    = `https://archive.org/embed/${movie.identifier}`;

  const sendToDownloader = async () => {
    setSending(true);
    try {
      await fetch(`${GRABIX}/download?url=${encodeURIComponent(archiveUrl)}&dl_type=video`);
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } catch { /* ignore */ }
    finally { setSending(false); }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg-surface)", borderRadius: 16, width: "100%", maxWidth: 720,
          maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column",
          boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "20px 20px 0" }}>
          <img
            src={movie.thumb}
            alt={movie.title}
            style={{ width: 90, height: 130, objectFit: "cover", borderRadius: 8, flexShrink: 0, border: "1px solid var(--border)" }}
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{movie.title}</div>
              <span style={{ background: "var(--text-success)", color: "white", fontSize: 9, padding: "2px 6px", borderRadius: 5, fontWeight: 700, flexShrink: 0 }}>FREE</span>
            </div>
            {movie.year && <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>{movie.year}</div>}
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Public domain · Archive.org</div>
          </div>
          <button className="btn-icon" style={{ flexShrink: 0 }} onClick={onClose}><IconX size={16} /></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 20px" }}>
          {movie.description && (
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 16 }}>
              {typeof movie.description === "string"
                ? movie.description.replace(/<[^>]+>/g, "").slice(0, 400) + "…"
                : ""}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <button
              className="btn btn-primary"
              style={{ gap: 6 }}
              onClick={() => setStreaming(v => !v)}
            >
              <IconPlay size={14} /> {streaming ? "Hide Player" : "Stream Free"}
            </button>
            <a
              href={archiveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost"
              style={{ gap: 6, textDecoration: "none", fontSize: 13 }}
            >
              View on Archive.org
            </a>
            <button
              className="btn btn-ghost"
              style={{ gap: 6 }}
              onClick={sendToDownloader}
              disabled={sending}
            >
              {sent ? <><IconCheck size={13} /> Sent to downloader!</> : sending ? "Sending…" : <><IconDownload size={14} /> Download Free</>}
            </button>
          </div>

          {/* Embed player */}
          {streaming && (
            <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}>
              <iframe
                src={embedUrl}
                width="100%"
                height="380"
                frameBorder="0"
                allowFullScreen
                title={movie.title}
                style={{ display: "block" }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
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
