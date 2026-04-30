// grabix-ui/src/pages/MoviesPage.tsx — Phase 1 rebuild
import { useState, useEffect, useRef, useCallback } from "react";
import { IconPlay, IconDownload, IconX, IconChevronLeft, IconChevronRight } from "../components/Icons";
import { IconHeart } from "../components/Icons";
import { LiveSearch } from "../components/search/LiveSearch";
import { MoodPills } from "../components/search/MoodPills";
import { MOVIE_MOODS, type MoodConfig } from "../lib/moodKeywords";
import DownloadOptionsModal from "../components/DownloadOptionsModal";
import { PageEmptyState, PageErrorState } from "../components/PageStates";
import { useFavorites } from "../context/FavoritesContext";
import { RatingButtons } from "../components/shared/RatingButtons";
import { useContentFilter } from "../context/ContentFilterContext";
import { filterAdultContent } from "../lib/contentFilter";
import { queueVideoDownload, resolveSourceDownloadOptions, type DownloadQualityOption } from "../lib/downloads";
import { TrailerBackground } from "../components/hero/TrailerBackground";
import {
  TMDB_BACKDROP_BASE as IMG_LG,
  TMDB_IMAGE_BASE as IMG_BASE,
  TMDB_PROFILE_BASE as IMG_PROF,
  discoverTmdbMedia,
  fetchTmdbDetails,
  searchTmdbMedia,
  fetchTmdbGenres,
  discoverTmdbByGenre,
  fetchTmdbRecommendations,
  fetchTmdbCredits,
  fetchTmdbVideos,
  fetchTmdbNowPlaying,
  fetchTmdbUpcoming,
  fetchTmdbWatchProviders,
  fetchTmdbCustomDiscover,
} from "../lib/tmdb";
import VidSrcPlayer from "../components/VidSrcPlayer";
import {
  fetchMovieBoxSources,
  getMovieSources,
  resolveMoviePlaybackSources,
  type StreamSource,
} from "../lib/streamProviders";
import { MovieCard, type Movie } from "../components/movies/MovieCard";
import { MovieRow } from "../components/movies/MovieRow";
import { MovieGrid } from "../components/movies/MovieGrid";
import { useSeenIds } from "../hooks/useSeenIds";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Genre { id: number; name: string; }
type SortOption = "popularity.desc" | "vote_average.desc" | "release_date.desc" | "revenue.desc";
type Tab = "home" | "search";

// ── Helpers ───────────────────────────────────────────────────────────────────
const IMG = (path: string | null | undefined, base = IMG_BASE) =>
  path ? `${base}${path}` : "";

const SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: "popularity.desc",    label: "Most Popular"       },
  { id: "vote_average.desc",  label: "Highest Rated"      },
  { id: "release_date.desc",  label: "Newest First"       },
  { id: "revenue.desc",       label: "Biggest Box Office" },
];

const YEAR_OPTIONS = [
  { id: 0, label: "Any Year" },
  ...Array.from({ length: 35 }, (_, i) => {
    const y = new Date().getFullYear() - i;
    return { id: y, label: String(y) };
  }),
];

const RATING_OPTIONS = [
  { id: 0, label: "Any Rating" },
  { id: 9, label: "9+ \u2605" },
  { id: 8, label: "8+ \u2605" },
  { id: 7, label: "7+ \u2605" },
  { id: 6, label: "6+ \u2605" },
];

// ── Loading skeleton ──────────────────────────────────────────────────────────
function LoadingRow() {
  return (
    <div style={{ display: "flex", gap: 10, overflow: "hidden" }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={{ flexShrink: 0, width: 130, borderRadius: 10, overflow: "hidden", background: "var(--bg-surface)" }}>
          <div style={{ height: 195, background: "var(--bg-surface2)" }} />
          <div style={{ padding: "7px 9px 9px" }}>
            <div style={{ height: 10, background: "var(--bg-surface2)", borderRadius: 4, marginBottom: 5 }} />
            <div style={{ height: 8, background: "var(--bg-surface2)", borderRadius: 4, width: "50%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Hero Banner ───────────────────────────────────────────────────────────────
function HeroBanner({ movies, idx, onSelect, onPlay, onPrev, onNext }: {
  movies: Movie[];
  idx: number;
  onSelect: (m: Movie) => void;
  onPlay: (src: any) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const m = movies[idx];
  if (!m) return null;
  const backdrop = IMG(m.backdrop_path, IMG_LG);

  const handleQuickPlay = async () => {
    const sources = getMovieSources({ tmdbId: m.id });
    onPlay({ title: m.title, poster: IMG(m.poster_path), sources });
  };

  return (
    <div style={{ position: "relative", height: 400, overflow: "hidden", flexShrink: 0 }}>
      {/* Static backdrop — always rendered as fallback */}
      {backdrop && (
        <img src={backdrop} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      )}
      {/* Muted YouTube trailer — fades in over backdrop when ready */}
      <TrailerBackground mediaType="movie" tmdbId={m.id} active={true} />
      <div style={{ position: "absolute", inset: 0, zIndex: 1, background: "linear-gradient(to right, rgba(0,0,0,0.82) 30%, rgba(0,0,0,0.2) 80%), linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 60%)" }} />
      <div style={{ position: "absolute", bottom: 40, left: 28, maxWidth: 480, zIndex: 2 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: "#fff", marginBottom: 8, lineHeight: 1.2, textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>{m.title}</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          {m.vote_average > 0 && (
            <span style={{ background: "rgba(253,214,99,0.2)", border: "1px solid #fdd663", color: "#fdd663", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>
              ★ {m.vote_average.toFixed(1)}
            </span>
          )}
          {m.release_date && (
            <span style={{ background: "rgba(255,255,255,0.12)", color: "#ddd", fontSize: 11, padding: "2px 8px", borderRadius: 20 }}>
              {m.release_date.slice(0, 4)}
            </span>
          )}
        </div>
        {m.overview && (
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", lineHeight: 1.6, marginBottom: 16, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {m.overview}
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-primary" style={{ gap: 7, fontSize: 13, padding: "8px 20px" }} onClick={handleQuickPlay}>
            <IconPlay size={14} /> Play
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 13, padding: "8px 20px", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff" }} onClick={() => onSelect(m)}>
            More Info
          </button>
        </div>
      </div>
      <button onClick={onPrev} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", border: "none", borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", zIndex: 3 }}>
        <IconChevronLeft size={18} />
      </button>
      <button onClick={onNext} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", border: "none", borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", zIndex: 3 }}>
        <IconChevronRight size={18} />
      </button>
      <div style={{ position: "absolute", bottom: 12, right: 20, display: "flex", gap: 6, zIndex: 3 }}>
        {movies.map((_, i) => (
          <div key={i} style={{ width: i === idx ? 20 : 6, height: 6, borderRadius: 3, background: i === idx ? "var(--accent)" : "rgba(255,255,255,0.4)", transition: "width 0.3s" }} />
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MoviesPage() {
  const { adultContentBlocked } = useContentFilter();
  const { reset: resetSeen, filterUnseen, markSeen } = useSeenIds();

  const [tab, setTab] = useState<Tab>("home");
  const [genres, setGenres] = useState<Genre[]>([]);
  const [activeGenre, setActiveGenre] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("popularity.desc");
  const [filterYear, setFilterYear] = useState<number>(0);
  const [filterRating, setFilterRating] = useState<number>(0);
  const [showFilters, setShowFilters] = useState(false);
  const [heroItems, setHeroItems] = useState<Movie[]>([]);
  const [heroIdx, setHeroIdx] = useState(0);
  const [trending, setTrending] = useState<Movie[]>([]);
  const [recentlyAdded, setRecentlyAdded] = useState<Movie[]>([]);
  const [topRated, setTopRated] = useState<Movie[]>([]);
  const [nowPlaying, setNowPlaying] = useState<Movie[]>([]);
  const [upcoming, setUpcoming] = useState<Movie[]>([]);
  const [hiddenGems, setHiddenGems] = useState<Movie[]>([]);
  const [genreResults, setGenreResults] = useState<Movie[]>([]);
  const [genrePage, setGenrePage] = useState(1);
  const [genreLoading, setGenreLoading] = useState(false);
  const [genreHasMore, setGenreHasMore] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMood, setActiveMood] = useState<MoodConfig | null>(null);
  const [searchResults, setSearchResults] = useState<Movie[]>([]);
  const [searchPage, setSearchPage] = useState(1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHasMore, setSearchHasMore] = useState(true);
  const [detail, setDetail] = useState<Movie | null>(null);
  const [player, setPlayer] = useState<{ title: string; subtitle?: string; poster?: string; sources: StreamSource[] } | null>(null);
  const [homeLoading, setHomeLoading] = useState(true);
  const [homeError, setHomeError] = useState("");

  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (heroItems.length === 0) return;
    const t = setInterval(() => setHeroIdx(i => (i + 1) % heroItems.length), 7000);
    return () => clearInterval(t);
  }, [heroItems]);

  useEffect(() => {
    fetchTmdbGenres("movie").then(d => {
      if (d?.genres) setGenres(d.genres);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab !== "home" || activeGenre !== null) return;
    setHomeLoading(true);
    setHomeError("");
    Promise.all([
      discoverTmdbMedia("movie", "trending", 1),
      fetchTmdbCustomDiscover("movie", { sort_by: "release_date.desc", "vote_count.gte": 50 }, "recently-added"),
      discoverTmdbMedia("movie", "top_rated", 1),
      fetchTmdbNowPlaying(1),
      fetchTmdbUpcoming(1),
      fetchTmdbCustomDiscover("movie", { sort_by: "vote_average.desc", "vote_count.gte": 1000, "popularity.lte": 20 }, "hidden-gems"),
    ]).then(([tr, ra, tp, np, up, hg]) => {
      const trR = tr?.results ?? [];
      setHeroItems(trR.filter((m: Movie) => m.backdrop_path).slice(0, 6));
      setTrending(trR);
      setRecentlyAdded(ra?.results ?? []);
      setTopRated(tp?.results ?? []);
      setNowPlaying(np?.results ?? []);
      setUpcoming(up?.results ?? []);
      setHiddenGems(hg?.results ?? []);
    }).catch(() => {
      setHomeError("Could not load movies. Check your internet connection.");
    }).finally(() => setHomeLoading(false));
  }, [tab, activeGenre]);

  const loadGenrePage = useCallback(async (gid: number, page: number, isReset: boolean) => {
    setGenreLoading(true);
    try {
      const d = await discoverTmdbByGenre(
        "movie", gid, page, sortBy,
        filterYear || undefined,
        filterRating || undefined
      );
      const raw: Movie[] = d?.results ?? [];
      if (isReset) {
        resetSeen();
        markSeen(raw.map(r => r.id));
        setGenreResults(raw);
      } else {
        const fresh = filterUnseen(raw);
        setGenreResults(prev => [...prev, ...fresh]);
      }
      setGenreHasMore(raw.length >= 20);
    } catch {
      setGenreHasMore(false);
    } finally {
      setGenreLoading(false);
    }
  }, [sortBy, filterYear, filterRating, resetSeen, markSeen, filterUnseen]);

  useEffect(() => {
    if (activeGenre === null) return;
    setGenrePage(1);
    setGenreResults([]);
    loadGenrePage(activeGenre, 1, true);
  }, [activeGenre, sortBy, filterYear, filterRating]);

  const doSearch = useCallback(async (q: string, page: number, isReset: boolean) => {
    if (!q.trim()) return;
    setSearchLoading(true);
    try {
      const d = await searchTmdbMedia("movie", q, page);
      const raw: Movie[] = d?.results ?? [];
      if (isReset) {
        resetSeen();
        markSeen(raw.map(r => r.id));
        setSearchResults(raw);
      } else {
        const fresh = filterUnseen(raw);
        setSearchResults(prev => [...prev, ...fresh]);
      }
      setSearchHasMore(raw.length >= 20);
    } catch {
      setSearchHasMore(false);
    } finally {
      setSearchLoading(false);
    }
  }, [resetSeen, markSeen, filterUnseen]);

  useEffect(() => {
    if (tab !== "search" || !searchQuery) return;
    setSearchPage(1);
    setSearchResults([]);
    doSearch(searchQuery, 1, true);
  }, [searchQuery, tab]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      if (tab === "search" && searchQuery && !searchLoading && searchHasMore) {
        const next = searchPage + 1;
        setSearchPage(next);
        doSearch(searchQuery, next, false);
      } else if (activeGenre !== null && !genreLoading && genreHasMore) {
        const next = genrePage + 1;
        setGenrePage(next);
        loadGenrePage(activeGenre, next, false);
      }
    }, { rootMargin: "300px" });
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [tab, searchQuery, searchPage, searchLoading, searchHasMore,
      activeGenre, genrePage, genreLoading, genreHasMore]);

  const clearSearch = () => {
    setSearchInput("");
    setSearchQuery("");
    setTab("home");
  };

  const handleMoodSelect = (mood: MoodConfig | null) => {
    setActiveMood(mood);
    if (mood) {
      setActiveGenre(mood.genreIds[0]);
      setTab("home");
      setSearchInput("");
      setSearchQuery("");
    } else {
      setActiveGenre(null);
    }
  };

  const handleLiveSearch = (query: string) => {
    if (!query) { clearSearch(); return; }
    setSearchQuery(query);
    setTab("search");
  };

  const filtered = (arr: Movie[]) => filterAdultContent(arr, adultContentBlocked);

  // Dedup: each movie appears in at most one row (first row wins)
  const dedupeRows = <T extends { id: number }>(rows: T[][]): T[][] => {
    const seen = new Set<number>();
    return rows.map(row =>
      row.filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
    );
  };

  const [
    dedupedNowPlaying,
    dedupedRecentlyAdded,
    dedupedTrending,
    dedupedUpcoming,
    dedupedTopRated,
    dedupedHiddenGems,
  ] = dedupeRows([
    filtered(nowPlaying),
    filtered(recentlyAdded),
    filtered(trending),
    filtered(upcoming),
    filtered(topRated),
    filtered(hiddenGems),
  ]);
  const displayGenre = activeGenre !== null
    ? (genres.find(g => g.id === activeGenre)?.name ?? "Genre")
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative", background: "var(--bg-base)" }}>

      <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, flexWrap: "wrap" }}>
        <div style={{ marginRight: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Movies</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>Browse · Stream · Download</div>
        </div>
        <LiveSearch
            value={searchInput}
            onChange={setSearchInput}
            onSearch={handleLiveSearch}
            placeholder="Search movies…"
          />
          {searchQuery && (
            <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={clearSearch}>
              <IconX size={13} /> Clear
            </button>
          )}
        {tab === "home" && activeGenre !== null && (
          <button
            className={`btn ${showFilters ? "btn-primary" : "btn-ghost"}`}
            style={{ fontSize: 12, gap: 5 }}
            onClick={() => setShowFilters(f => !f)}
          >
            ⚙ Filters {showFilters ? "▲" : "▼"}
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, padding: "10px 20px", overflowX: "auto", flexShrink: 0, borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", scrollbarWidth: "none" }}>
        <button
          onClick={() => { setActiveGenre(null); setTab("home"); }}
          style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", whiteSpace: "nowrap", background: activeGenre === null && tab === "home" ? "var(--accent)" : "var(--bg-surface2)", color: activeGenre === null && tab === "home" ? "white" : "var(--text-secondary)", transition: "var(--transition)" }}
        >
          🏠 Home
        </button>
        {genres.map(g => (
          <button
            key={g.id}
            onClick={() => { setActiveGenre(g.id); setTab("home"); setShowFilters(false); }}
            style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer", whiteSpace: "nowrap", background: activeGenre === g.id ? "var(--accent)" : "var(--bg-surface2)", color: activeGenre === g.id ? "white" : "var(--text-secondary)", transition: "var(--transition)" }}
          >
            {g.name}
          </button>
        ))}
      </div>

      <MoodPills
        moods={MOVIE_MOODS}
        activeMood={activeMood?.label ?? null}
        onSelect={handleMoodSelect}
      />

      {showFilters && activeGenre !== null && (
        <div style={{ display: "flex", gap: 10, padding: "10px 20px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", flexWrap: "wrap", flexShrink: 0 }}>
          <select className="input-base" style={{ fontSize: 12, minWidth: 150 }} value={sortBy} onChange={e => setSortBy(e.target.value as SortOption)}>
            {SORT_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select className="input-base" style={{ fontSize: 12, minWidth: 110 }} value={filterYear} onChange={e => setFilterYear(Number(e.target.value))}>
            {YEAR_OPTIONS.map(y => <option key={y.id} value={y.id}>{y.label}</option>)}
          </select>
          <select className="input-base" style={{ fontSize: 12, minWidth: 110 }} value={filterRating} onChange={e => setFilterRating(Number(e.target.value))}>
            {RATING_OPTIONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => { setSortBy("popularity.desc"); setFilterYear(0); setFilterRating(0); }}>Reset</button>
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>

        {tab === "search" && (
          <div style={{ padding: "20px 20px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: "var(--text-secondary)" }}>
              {searchResults.length > 0 ? `Results for "${searchQuery}"` : searchLoading ? "Searching…" : `No results for "${searchQuery}"`}
            </div>
            {searchResults.length === 0 && !searchLoading ? (
              <PageEmptyState title="No movies matched that search" subtitle="Try a different title or spelling." />
            ) : (
              <MovieGrid movies={filtered(searchResults)} onSelect={setDetail} />
            )}
            {searchLoading && <LoadingRow />}
          </div>
        )}

        {tab === "home" && activeGenre !== null && (
          <div style={{ padding: "20px 20px" }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>{displayGenre}</div>
            {genreResults.length === 0 && genreLoading ? (
              <LoadingRow />
            ) : genreResults.length === 0 ? (
              <PageEmptyState title="No movies found" subtitle="Try adjusting the filters." />
            ) : (
              <MovieGrid movies={filtered(genreResults)} onSelect={setDetail} />
            )}
            {genreLoading && genreResults.length > 0 && <LoadingRow />}
          </div>
        )}

        {tab === "home" && activeGenre === null && (
          <>
            {homeLoading ? (
              <div style={{ padding: 40, display: "flex", flexDirection: "column", gap: 32 }}>
                <div style={{ height: 380, borderRadius: 16, background: "var(--bg-surface2)" }} />
                {[0, 1, 2].map(i => <div key={i} style={{ height: 220, borderRadius: 12, background: "var(--bg-surface2)" }} />)}
              </div>
            ) : homeError ? (
              <div style={{ padding: 40 }}>
                <PageErrorState title="Movies unavailable" subtitle={homeError} onRetry={() => setHomeLoading(true)} />
              </div>
            ) : (
              <>
                {heroItems.length > 0 && (
                  <HeroBanner
                    movies={heroItems}
                    idx={heroIdx}
                    onSelect={setDetail}
                    onPlay={src => setPlayer(src)}
                    onPrev={() => setHeroIdx(i => (i - 1 + heroItems.length) % heroItems.length)}
                    onNext={() => setHeroIdx(i => (i + 1) % heroItems.length)}
                  />
                )}
                <div style={{ padding: "20px 20px", display: "flex", flexDirection: "column", gap: 28 }}>
                  <MovieRow title="🎬 In Theatres Now"     movies={dedupedNowPlaying}    onSelect={setDetail} />
                  <MovieRow title="🆕 Recently Added"       movies={dedupedRecentlyAdded} onSelect={setDetail} />
                  <MovieRow title="🔥 Trending This Week"   movies={dedupedTrending}      onSelect={setDetail} />
                  <MovieRow title="📅 Coming Soon"          movies={dedupedUpcoming}      onSelect={setDetail} />
                  <MovieRow title="⭐ All-Time Top Rated"   movies={dedupedTopRated}      onSelect={setDetail} />
                  <MovieRow title="💎 Hidden Gems"          movies={dedupedHiddenGems}    onSelect={setDetail} />
                </div>
              </>
            )}
          </>
        )}

        <div ref={sentinelRef} style={{ height: 32 }} />
      </div>

      {detail && !player && (
        <MovieDetailModal
          movie={detail}
          onClose={() => setDetail(null)}
          onPlay={src => { setDetail(null); setPlayer(src); }}
        />
      )}

      {player && (
        <VidSrcPlayer
          title={player.title}
          subtitle={player.subtitle}
          poster={player.poster}
          sources={player.sources}
          mediaType="movie"
          onClose={() => setPlayer(null)}
        />
      )}
    </div>
  );
}

// ── Movie Detail Modal ────────────────────────────────────────────────────────
function MovieDetailModal({ movie, onClose, onPlay }: {
  movie: Movie;
  onClose: () => void;
  onPlay: (src: any) => void;
}) {
  const { isFav, toggle } = useFavorites();
  const [full, setFull]               = useState<Movie | null>(null);
  const [credits, setCredits]         = useState<any>(null);
  const [recs, setRecs]               = useState<Movie[]>([]);
  const [providers, setProviders]     = useState<any>(null);
  const [trailerKey, setTrailerKey]   = useState<string | null>(null);
  const [showTrailer, setShowTrailer] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadOpts, setDownloadOpts] = useState<DownloadQualityOption[]>([]);
  const [downloadQuality, setDownloadQuality] = useState("");
  const [downloadLang, setDownloadLang] = useState<"english" | "hindi">("english");
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [loadingPlay, setLoadingPlay] = useState(false);

  const d = full ?? movie;
  const poster   = IMG(d.poster_path);
  const backdrop = IMG(d.backdrop_path, IMG_LG);
  const fav      = isFav(`movie-${movie.id}`);

  useEffect(() => {
    fetchTmdbDetails("movie", movie.id, "").then(setFull).catch(() => {});
    fetchTmdbCredits("movie", movie.id).then(setCredits).catch(() => {});
    fetchTmdbRecommendations("movie", movie.id).then(r => setRecs(r?.results?.slice(0, 12) ?? [])).catch(() => {});
    fetchTmdbWatchProviders("movie", movie.id).then(setProviders).catch(() => {});
    fetchTmdbVideos("movie", movie.id).then(v => {
      const trailer = (v?.results ?? []).find((r: any) => r.type === "Trailer" && r.site === "YouTube") ?? (v?.results?.[0] ?? null);
      if (trailer?.key) setTrailerKey(trailer.key);
    }).catch(() => {});
  }, [movie.id]);

  const cast = (credits?.cast ?? []).slice(0, 12);
  const streamProviders: any[] = providers?.providers?.flatrate ?? [];

  const handlePlay = async () => {
    setLoadingPlay(true);
    try {
      const movieYear = d.release_date ? Number(d.release_date.slice(0, 4)) : undefined;
      const sources = await resolveMoviePlaybackSources({
        tmdbId: movie.id, imdbId: d.imdb_id, title: d.title, year: movieYear,
      });
      onPlay({
        title: d.title, poster: poster || undefined,
        sources: sources.length > 0 ? sources : getMovieSources({ tmdbId: movie.id, imdbId: d.imdb_id }),
      });
    } catch {
      onPlay({ title: d.title, poster: poster || undefined, sources: getMovieSources({ tmdbId: movie.id, imdbId: d.imdb_id }) });
    } finally {
      setLoadingPlay(false);
    }
  };

  const openDownload = async () => {
    setDownloadLang("english"); setDownloadOpts([]); setDownloadQuality(""); setDownloadError("");
    setDownloadOpen(true); setDownloadLoading(true);
    try {
      const movieYear = d.release_date ? Number(d.release_date.slice(0, 4)) : undefined;
      const sources = await fetchMovieBoxSources({ title: d.title, mediaType: "movie", year: movieYear });
      const opts = await resolveSourceDownloadOptions(sources);
      setDownloadOpts(opts); setDownloadQuality(opts[0]?.id ?? "");
    } catch { setDownloadError("No download source found."); }
    finally { setDownloadLoading(false); }
  };

  const confirmDownload = async () => {
    const opt = downloadOpts.find(o => o.id === downloadQuality);
    if (!opt) { setDownloadError("Select a quality first."); return; }
    setDownloadLoading(true);
    try {
      await queueVideoDownload({
        url: opt.url, title: `${d.title} — ${downloadLang === "hindi" ? "Hindi" : "English"} — ${opt.label}`,
        thumbnail: poster, headers: opt.headers, forceHls: opt.forceHls, category: "Movies",
      });
      setDownloadOpen(false);
    } catch (e) { setDownloadError(e instanceof Error ? e.message : "Download failed."); }
    finally { setDownloadLoading(false); }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 300, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px", overflowY: "auto" }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--bg-surface)", borderRadius: 16, width: "100%", maxWidth: 780, boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)", overflow: "hidden", position: "relative" }}
        onClick={e => e.stopPropagation()}
      >
        {backdrop && (
          <div style={{ position: "relative", height: 200, flexShrink: 0 }}>
            <img src={backdrop} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(transparent 30%, var(--bg-surface))" }} />
          </div>
        )}
        <div style={{ padding: "0 22px 26px" }}>
          <div style={{ display: "flex", gap: 16, marginTop: backdrop ? -60 : 20, position: "relative", zIndex: 1 }}>
            {poster && <img src={poster} alt={d.title} style={{ width: 95, height: 142, objectFit: "cover", borderRadius: 10, flexShrink: 0, border: "2px solid var(--border)", boxShadow: "var(--shadow-md)" }} />}
            <div style={{ flex: 1, paddingTop: backdrop ? 65 : 0, minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.2, marginBottom: 6 }}>{d.title}</div>
              {(d as any).tagline && <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", marginBottom: 8 }}>{(d as any).tagline}</div>}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {d.vote_average > 0 && <span style={{ background: "rgba(253,214,99,0.15)", border: "1px solid #fdd663", color: "#fdd663", fontSize: 11, padding: "2px 9px", borderRadius: 20, fontWeight: 700 }}>★ {d.vote_average.toFixed(1)}</span>}
                {d.release_date && <span style={{ background: "var(--bg-surface2)", padding: "2px 9px", borderRadius: 20, fontSize: 11, color: "var(--text-secondary)" }}>{d.release_date.slice(0, 4)}</span>}
                {(d as any).runtime > 0 && <span style={{ background: "var(--bg-surface2)", padding: "2px 9px", borderRadius: 20, fontSize: 11, color: "var(--text-secondary)" }}>{Math.floor((d as any).runtime / 60)}h {(d as any).runtime % 60}m</span>}
                {(d as any).status && <span style={{ background: "var(--bg-active)", color: "var(--text-accent)", padding: "2px 9px", borderRadius: 20, fontSize: 11 }}>{(d as any).status}</span>}
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {(d.genres ?? []).slice(0, 5).map((g: any) => (
                  <span key={g.id} style={{ background: "var(--bg-surface2)", border: "1px solid var(--border)", color: "var(--text-secondary)", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>{g.name}</span>
                ))}
              </div>
            </div>
            <button className="btn-icon" style={{ alignSelf: "flex-start", marginTop: backdrop ? 65 : 0, flexShrink: 0 }} onClick={onClose}><IconX size={15} /></button>
          </div>
          {d.overview && <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.75, margin: "16px 0" }}>{d.overview}</div>}
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <button className="btn btn-primary" style={{ gap: 7, flex: "1 1 120px", justifyContent: "center", minWidth: 0 }} onClick={handlePlay} disabled={loadingPlay}>
              <IconPlay size={14} /> {loadingPlay ? "Loading…" : "Play"}
            </button>
            {trailerKey && <button className="btn btn-ghost" style={{ gap: 7, flex: "1 1 100px", justifyContent: "center" }} onClick={() => setShowTrailer(true)}>▶ Trailer</button>}
            <button className="btn btn-ghost" style={{ gap: 7, flex: "1 1 100px", justifyContent: "center" }} onClick={openDownload}><IconDownload size={14} /> Download</button>
            <button className="btn btn-ghost" style={{ gap: 7, flex: "1 1 80px", justifyContent: "center", color: fav ? "var(--text-danger)" : undefined }}
              onClick={() => toggle({ id: `movie-${movie.id}`, title: d.title, poster, type: "movie", tmdbId: movie.id })}>
              <IconHeart size={14} color={fav ? "var(--text-danger)" : "currentColor"} filled={fav} />
              {fav ? "Saved" : "Save"}
            </button>
          </div>
          <div style={{ marginBottom: 18 }}>
            <RatingButtons id={`movie-${movie.id}`} kind="movie" title={d.title} poster={poster} />
          </div>
          {streamProviders.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Where to Watch</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {streamProviders.slice(0, 6).map((p: any) => (
                  <div key={p.provider_id} style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg-surface2)", padding: "4px 10px", borderRadius: 8, fontSize: 11 }}>
                    {p.logo_path && <img src={`https://image.tmdb.org/t/p/w45${p.logo_path}`} alt="" style={{ width: 16, height: 16, borderRadius: 3 }} />}
                    {p.provider_name}
                  </div>
                ))}
              </div>
            </div>
          )}
          {cast.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Cast</div>
              <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6, scrollbarWidth: "none" }}>
                {cast.map((c: any) => (
                  <div key={c.id} style={{ flexShrink: 0, width: 70, textAlign: "center" }}>
                    {c.profile_path
                      ? <img src={`${IMG_PROF}${c.profile_path}`} alt={c.name} style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", margin: "0 auto 5px", display: "block", border: "2px solid var(--border)" }} />
                      : <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--bg-surface2)", margin: "0 auto 5px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>👤</div>
                    }
                    <div style={{ fontSize: 10, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.character}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {recs.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>More Like This</div>
              <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6, scrollbarWidth: "none" }}>
                {recs.map(r => <MovieCard key={r.id} movie={r} onClick={() => { onClose(); }} />)}
              </div>
            </div>
          )}
        </div>
      </div>
      {showTrailer && trailerKey && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowTrailer(false)}>
          <div style={{ position: "relative", width: "min(900px,90vw)", aspectRatio: "16/9" }} onClick={e => e.stopPropagation()}>
            <iframe src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1`} style={{ width: "100%", height: "100%", border: "none", borderRadius: 12 }} allow="autoplay; fullscreen" title="Trailer" />
            <button onClick={() => setShowTrailer(false)} style={{ position: "absolute", top: -36, right: 0, background: "none", border: "none", color: "#fff", fontSize: 18, cursor: "pointer" }}>✕ Close</button>
          </div>
        </div>
      )}
      <DownloadOptionsModal
        visible={downloadOpen} title={d.title} poster={poster || undefined}
        languageOptions={[{ id: "english", label: "English" }, { id: "hindi", label: "Hindi" }]}
        selectedLanguage={downloadLang} onSelectLanguage={v => setDownloadLang(v as "english" | "hindi")}
        qualityOptions={downloadOpts.map(o => ({ id: o.id, label: o.label }))}
        selectedQuality={downloadQuality} onSelectQuality={setDownloadQuality}
        loading={downloadLoading} error={downloadError}
        onClose={() => setDownloadOpen(false)} onConfirm={() => void confirmDownload()}
      />
    </div>
  );
}
