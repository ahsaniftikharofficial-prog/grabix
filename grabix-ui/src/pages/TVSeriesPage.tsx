// grabix-ui/src/pages/TVSeriesPage.tsx — Phase 1 rebuild
import { useState, useEffect, useRef, useCallback } from "react";
import { IconPlay, IconDownload, IconX, IconChevronLeft, IconChevronRight } from "../components/Icons";
import { IconHeart } from "../components/Icons";
import { LiveSearch } from "../components/search/LiveSearch";
import { MoodPills } from "../components/search/MoodPills";
import { TV_MOODS, type MoodConfig } from "../lib/moodKeywords";
import DownloadOptionsModal from "../components/DownloadOptionsModal";
import { PageEmptyState, PageErrorState } from "../components/PageStates";
import { useFavorites } from "../context/FavoritesContext";
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
  fetchTmdbTvSeason,
  searchTmdbMedia,
  fetchTmdbGenres,
  discoverTmdbByGenre,
  fetchTmdbRecommendations,
  fetchTmdbCredits,
  fetchTmdbVideos,
  fetchTmdbAiringToday,
  fetchTmdbWatchProviders,
} from "../lib/tmdb";
import VidSrcPlayer from "../components/VidSrcPlayer";
import {
  fetchMovieBoxSources,
  getTvSources,
  resolveTvPlaybackSources,
  type StreamSource,
} from "../lib/streamProviders";
import { TVCard, type Show } from "../components/tv/TVCard";
import { TVRow } from "../components/tv/TVRow";
import { TVGrid } from "../components/tv/TVGrid";
import { useSeenIds } from "../hooks/useSeenIds";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Episode {
  id: number;
  episode_number: number;
  name: string;
  overview: string;
  still_path: string | null;
  air_date: string;
  vote_average: number;
  runtime?: number;
}
interface Genre { id: number; name: string; }
type SortOption = "popularity.desc" | "vote_average.desc" | "first_air_date.desc";
type Tab = "home" | "search";

// ── Helpers ───────────────────────────────────────────────────────────────────
const IMG = (path: string | null | undefined, base = IMG_BASE) =>
  path ? `${base}${path}` : "";

const SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: "popularity.desc",      label: "Most Popular"  },
  { id: "vote_average.desc",    label: "Highest Rated" },
  { id: "first_air_date.desc",  label: "Newest First"  },
];

const YEAR_OPTIONS = [
  { id: 0, label: "Any Year" },
  ...Array.from({ length: 35 }, (_, i) => {
    const y = new Date().getFullYear() - i;
    return { id: y, label: String(y) };
  }),
];

const RATING_OPTIONS = [
  { id: 0,  label: "Any Rating" },
  { id: 9,  label: "9+ \u2605" },
  { id: 8,  label: "8+ \u2605" },
  { id: 7,  label: "7+ \u2605" },
  { id: 6,  label: "6+ \u2605" },
];

const STATUS_OPTIONS = [
  { id: "",              label: "Any Status"    },
  { id: "Returning Series", label: "Ongoing"   },
  { id: "Ended",         label: "Ended"         },
  { id: "In Production", label: "In Production" },
  { id: "Canceled",      label: "Canceled"      },
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
function HeroBanner({ shows, idx, onSelect, onPlay, onPrev, onNext }: {
  shows: Show[];
  idx: number;
  onSelect: (s: Show) => void;
  onPlay: (src: any) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const s = shows[idx];
  if (!s) return null;
  const backdrop = IMG(s.backdrop_path, IMG_LG);

  const handleQuickPlay = () => {
    const sources = getTvSources(s.id, { season: 1, episode: 1 });
    onPlay({ title: s.name, subtitle: "S01 E01", poster: IMG(s.poster_path), sources });
  };

  return (
    <div style={{ position: "relative", height: 400, overflow: "hidden", flexShrink: 0 }}>
      {/* Static backdrop — always rendered as fallback */}
      {backdrop && <img src={backdrop} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
      {/* Muted YouTube trailer — fades in over backdrop when ready */}
      <TrailerBackground mediaType="tv" tmdbId={s.id} active={true} />
      <div style={{ position: "absolute", inset: 0, zIndex: 1, background: "linear-gradient(to right, rgba(0,0,0,0.82) 30%, rgba(0,0,0,0.2) 80%), linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 60%)" }} />
      <div style={{ position: "absolute", bottom: 40, left: 28, maxWidth: 480, zIndex: 2 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: "#fff", marginBottom: 8, lineHeight: 1.2, textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>{s.name}</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          {s.vote_average > 0 && <span style={{ background: "rgba(253,214,99,0.2)", border: "1px solid #fdd663", color: "#fdd663", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>★ {s.vote_average.toFixed(1)}</span>}
          {s.first_air_date && <span style={{ background: "rgba(255,255,255,0.12)", color: "#ddd", fontSize: 11, padding: "2px 8px", borderRadius: 20 }}>{s.first_air_date.slice(0, 4)}</span>}
        </div>
        {s.overview && <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", lineHeight: 1.6, marginBottom: 16, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{s.overview}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-primary" style={{ gap: 7, fontSize: 13, padding: "8px 20px" }} onClick={handleQuickPlay}><IconPlay size={14} /> Play S1E1</button>
          <button className="btn btn-ghost" style={{ fontSize: 13, padding: "8px 20px", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff" }} onClick={() => onSelect(s)}>More Info</button>
        </div>
      </div>
      <button onClick={onPrev} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", border: "none", borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", zIndex: 3 }}><IconChevronLeft size={18} /></button>
      <button onClick={onNext} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.5)", border: "none", borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", zIndex: 3 }}><IconChevronRight size={18} /></button>
      <div style={{ position: "absolute", bottom: 12, right: 20, display: "flex", gap: 6, zIndex: 3 }}>
        {shows.map((_, i) => (
          <div key={i} style={{ width: i === idx ? 20 : 6, height: 6, borderRadius: 3, background: i === idx ? "var(--accent)" : "rgba(255,255,255,0.4)", transition: "width 0.3s" }} />
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function TVSeriesPage() {
  const { adultContentBlocked } = useContentFilter();
  const { reset: resetSeen, filterUnseen, markSeen } = useSeenIds();

  const [tab, setTab] = useState<Tab>("home");
  const [genres, setGenres] = useState<Genre[]>([]);
  const [activeGenre, setActiveGenre] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("popularity.desc");
  const [filterYear, setFilterYear] = useState<number>(0);
  const [filterRating, setFilterRating] = useState<number>(0);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [heroItems, setHeroItems] = useState<Show[]>([]);
  const [heroIdx, setHeroIdx] = useState(0);
  const [trending, setTrending] = useState<Show[]>([]);
  const [popular, setPopular] = useState<Show[]>([]);
  const [topRated, setTopRated] = useState<Show[]>([]);
  const [onTheAir, setOnTheAir] = useState<Show[]>([]);
  const [airingToday, setAiringToday] = useState<Show[]>([]);
  const [genreResults, setGenreResults] = useState<Show[]>([]);
  const [genrePage, setGenrePage] = useState(1);
  const [genreLoading, setGenreLoading] = useState(false);
  const [genreHasMore, setGenreHasMore] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMood, setActiveMood] = useState<MoodConfig | null>(null);
  const [searchResults, setSearchResults] = useState<Show[]>([]);
  const [searchPage, setSearchPage] = useState(1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHasMore, setSearchHasMore] = useState(true);
  const [detail, setDetail] = useState<Show | null>(null);
  const [player, setPlayer] = useState<{ title: string; subtitle?: string; poster?: string; sources: StreamSource[] } | null>(null);
  const [homeLoading, setHomeLoading] = useState(true);
  const [homeError, setHomeError] = useState("");

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (heroItems.length === 0) return;
    const t = setInterval(() => setHeroIdx(i => (i + 1) % heroItems.length), 7000);
    return () => clearInterval(t);
  }, [heroItems]);

  useEffect(() => {
    fetchTmdbGenres("tv").then(d => {
      if (d?.genres) setGenres(d.genres);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab !== "home" || activeGenre !== null) return;
    setHomeLoading(true); setHomeError("");
    Promise.all([
      discoverTmdbMedia("tv", "trending",   1),
      discoverTmdbMedia("tv", "popular",    1),
      discoverTmdbMedia("tv", "top_rated",  1),
      discoverTmdbMedia("tv", "on_the_air", 1),
      fetchTmdbAiringToday(1),
    ]).then(([tr, po, tp, oa, at]) => {
      const trR = tr?.results ?? [];
      setHeroItems(trR.filter((s: Show) => s.backdrop_path).slice(0, 6));
      setTrending(trR);
      setPopular(po?.results ?? []);
      setTopRated(tp?.results ?? []);
      setOnTheAir(oa?.results ?? []);
      setAiringToday(at?.results ?? []);
    }).catch(() => {
      setHomeError("Could not load TV shows. Check your internet connection.");
    }).finally(() => setHomeLoading(false));
  }, [tab, activeGenre]);

  const loadGenrePage = useCallback(async (gid: number, page: number, isReset: boolean) => {
    setGenreLoading(true);
    try {
      const d = await discoverTmdbByGenre(
        "tv", gid, page, sortBy,
        filterYear || undefined,
        filterRating || undefined
      );
      const raw: Show[] = (d?.results ?? []).filter((s: Show) =>
        !filterStatus || s.status === filterStatus
      );
      if (isReset) {
        resetSeen();
        markSeen(raw.map(r => r.id));
        setGenreResults(raw);
      } else {
        const fresh = filterUnseen(raw);
        setGenreResults(prev => [...prev, ...fresh]);
      }
      setGenreHasMore((d?.results ?? []).length >= 20);
    } catch {
      setGenreHasMore(false);
    } finally {
      setGenreLoading(false);
    }
  }, [sortBy, filterYear, filterRating, filterStatus, resetSeen, markSeen, filterUnseen]);

  useEffect(() => {
    if (activeGenre === null) return;
    setGenrePage(1); setGenreResults([]);
    loadGenrePage(activeGenre, 1, true);
  }, [activeGenre, sortBy, filterYear, filterRating, filterStatus]);

  const doSearch = useCallback(async (q: string, page: number, isReset: boolean) => {
    if (!q.trim()) return;
    setSearchLoading(true);
    try {
      const d = await searchTmdbMedia("tv", q, page);
      const raw: Show[] = d?.results ?? [];
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
    setSearchPage(1); setSearchResults([]);
    doSearch(searchQuery, 1, true);
  }, [searchQuery, tab]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      if (tab === "search" && searchQuery && !searchLoading && searchHasMore) {
        const next = searchPage + 1; setSearchPage(next);
        doSearch(searchQuery, next, false);
      } else if (activeGenre !== null && !genreLoading && genreHasMore) {
        const next = genrePage + 1; setGenrePage(next);
        loadGenrePage(activeGenre, next, false);
      }
    }, { rootMargin: "300px" });
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [tab, searchQuery, searchPage, searchLoading, searchHasMore,
      activeGenre, genrePage, genreLoading, genreHasMore]);

  const submitSearch = () => {
    const q = searchInput.trim();
    if (!q) return;
    setSearchQuery(q); setTab("search");
  };
  const clearSearch = () => { setSearchInput(""); setSearchQuery(""); setTab("home"); };

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

  const filtered = (arr: Show[]) => filterAdultContent(arr, adultContentBlocked);
  const displayGenre = activeGenre !== null ? (genres.find(g => g.id === activeGenre)?.name ?? "Genre") : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative", background: "var(--bg-base)" }}>

      <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, flexWrap: "wrap" }}>
        <div style={{ marginRight: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>TV Series</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>Browse · Stream · Download</div>
        </div>
        <LiveSearch
          value={searchInput}
          onChange={setSearchInput}
          onSearch={handleLiveSearch}
          placeholder="Search TV shows…"
        />
        {searchQuery && <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={clearSearch}><IconX size={13} /> Clear</button>}
        {tab === "home" && activeGenre !== null && (
          <button className={`btn ${showFilters ? "btn-primary" : "btn-ghost"}`} style={{ fontSize: 12, gap: 5 }} onClick={() => setShowFilters(f => !f)}>
            ⚙ Filters {showFilters ? "▲" : "▼"}
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, padding: "10px 20px", overflowX: "auto", flexShrink: 0, borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", scrollbarWidth: "none" }}>
        <button onClick={() => { setActiveGenre(null); setTab("home"); }}
          style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", whiteSpace: "nowrap", background: activeGenre === null && tab === "home" ? "var(--accent)" : "var(--bg-surface2)", color: activeGenre === null && tab === "home" ? "white" : "var(--text-secondary)", transition: "var(--transition)" }}>
          🏠 Home
        </button>
        {genres.map(g => (
          <button key={g.id} onClick={() => { setActiveGenre(g.id); setTab("home"); setShowFilters(false); }}
            style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer", whiteSpace: "nowrap", background: activeGenre === g.id ? "var(--accent)" : "var(--bg-surface2)", color: activeGenre === g.id ? "white" : "var(--text-secondary)", transition: "var(--transition)" }}>
            {g.name}
          </button>
        ))}
      </div>

      <MoodPills
        moods={TV_MOODS}
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
          <select className="input-base" style={{ fontSize: 12, minWidth: 130 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            {STATUS_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => { setSortBy("popularity.desc"); setFilterYear(0); setFilterRating(0); setFilterStatus(""); }}>Reset</button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>

        {tab === "search" && (
          <div style={{ padding: "20px 20px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: "var(--text-secondary)" }}>
              {searchResults.length > 0 ? `Results for "${searchQuery}"` : searchLoading ? "Searching…" : `No results for "${searchQuery}"`}
            </div>
            {searchResults.length === 0 && !searchLoading
              ? <PageEmptyState title="No shows matched that search" subtitle="Try a different title or spelling." />
              : <TVGrid shows={filtered(searchResults)} onSelect={setDetail} />
            }
            {searchLoading && <LoadingRow />}
          </div>
        )}

        {tab === "home" && activeGenre !== null && (
          <div style={{ padding: "20px 20px" }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>{displayGenre}</div>
            {genreResults.length === 0 && genreLoading
              ? <LoadingRow />
              : genreResults.length === 0
                ? <PageEmptyState title="No shows found" subtitle="Try adjusting the filters." />
                : <TVGrid shows={filtered(genreResults)} onSelect={setDetail} />
            }
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
                <PageErrorState title="TV Shows unavailable" subtitle={homeError} onRetry={() => setHomeLoading(true)} />
              </div>
            ) : (
              <>
                {heroItems.length > 0 && (
                  <HeroBanner
                    shows={heroItems} idx={heroIdx} onSelect={setDetail}
                    onPlay={src => setPlayer(src)}
                    onPrev={() => setHeroIdx(i => (i - 1 + heroItems.length) % heroItems.length)}
                    onNext={() => setHeroIdx(i => (i + 1) % heroItems.length)}
                  />
                )}
                <div style={{ padding: "20px 20px", display: "flex", flexDirection: "column", gap: 28 }}>
                  <TVRow title="🔥 Trending This Week"  shows={filtered(trending)}    onSelect={setDetail} />
                  <TVRow title="📺 Airing Today"        shows={filtered(airingToday)} onSelect={setDetail} />
                  <TVRow title="▶ Currently On Air"     shows={filtered(onTheAir)}   onSelect={setDetail} />
                  <TVRow title="⭐ Popular Right Now"    shows={filtered(popular)}    onSelect={setDetail} />
                  <TVRow title="🏆 All-Time Top Rated"  shows={filtered(topRated)}   onSelect={setDetail} />
                </div>
              </>
            )}
          </>
        )}

        <div ref={sentinelRef} style={{ height: 32 }} />
      </div>

      {detail && !player && (
        <ShowDetailModal show={detail} onClose={() => setDetail(null)} onPlay={src => { setDetail(null); setPlayer(src); }} />
      )}

      {player && (
        <VidSrcPlayer title={player.title} subtitle={player.subtitle} poster={player.poster} sources={player.sources} mediaType="tv" onClose={() => setPlayer(null)} />
      )}
    </div>
  );
}

// ── Show Detail Modal ─────────────────────────────────────────────────────────
function ShowDetailModal({ show, onClose, onPlay }: {
  show: Show;
  onClose: () => void;
  onPlay: (src: any) => void;
}) {
  const { isFav, toggle } = useFavorites();
  const [full, setFull]             = useState<Show | null>(null);
  const [credits, setCredits]       = useState<any>(null);
  const [recs, setRecs]             = useState<Show[]>([]);
  const [providers, setProviders]   = useState<any>(null);
  const [trailerKey, setTrailerKey] = useState<string | null>(null);
  const [showTrailer, setShowTrailer] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [episodes, setEpisodes]     = useState<Episode[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [activeTab, setActiveTab]   = useState<"overview" | "episodes" | "cast">("overview");
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadSeason, setDownloadSeason] = useState(1);
  const [downloadEpisode, setDownloadEpisode] = useState(1);
  const [downloadOpts, setDownloadOpts]   = useState<DownloadQualityOption[]>([]);
  const [downloadQuality, setDownloadQuality] = useState("");
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError]     = useState("");
  // Bulk season download state
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });

  const d = full ?? show;
  const poster   = IMG(d.poster_path);
  const backdrop = IMG(d.backdrop_path, IMG_LG);
  const fav      = isFav(`tv-${show.id}`);
  const seasons  = (full?.seasons ?? []).filter(s => s.season_number > 0);
  const imdbId   = full?.external_ids?.imdb_id;

  useEffect(() => {
    fetchTmdbDetails("tv", show.id, "external_ids").then(setFull).catch(() => {});
    fetchTmdbCredits("tv", show.id).then(setCredits).catch(() => {});
    fetchTmdbRecommendations("tv", show.id).then(r => setRecs(r?.results?.slice(0, 12) ?? [])).catch(() => {});
    fetchTmdbWatchProviders("tv", show.id).then(setProviders).catch(() => {});
    fetchTmdbVideos("tv", show.id).then(v => {
      const t = (v?.results ?? []).find((r: any) => r.type === "Trailer" && r.site === "YouTube") ?? (v?.results?.[0] ?? null);
      if (t?.key) setTrailerKey(t.key);
    }).catch(() => {});
  }, [show.id]);

  useEffect(() => {
    if (activeTab !== "episodes") return;
    setEpisodesLoading(true);
    fetchTmdbTvSeason(show.id, selectedSeason)
      .then(d => setEpisodes(d?.episodes ?? []))
      .catch(() => setEpisodes([]))
      .finally(() => setEpisodesLoading(false));
  }, [show.id, selectedSeason, activeTab]);

  const cast = (credits?.cast ?? []).slice(0, 14);
  const streamProviders: any[] = providers?.providers?.flatrate ?? [];

  const handlePlayEpisode = async (season: number, episode: number) => {
    try {
      const sources = await resolveTvPlaybackSources({ tmdbId: show.id, imdbId, title: d.name, season, episode });
      onPlay({
        title: d.name, subtitle: `Season ${season} · Episode ${episode}`, poster: poster || undefined,
        sources: sources.length > 0 ? sources : getTvSources(show.id, { season, episode }),
      });
    } catch {
      onPlay({ title: d.name, subtitle: `Season ${season} · Episode ${episode}`, poster: poster || undefined, sources: getTvSources(show.id, { season, episode }) });
    }
  };

  const openDownload = () => {
    setDownloadSeason(1); setDownloadEpisode(1); setDownloadOpts([]);
    setDownloadQuality(""); setDownloadError(""); setDownloadOpen(true);
  };

  const loadDownloadOpts = async (s: number, e: number) => {
    setDownloadLoading(true); setDownloadError("");
    try {
      const sources = await fetchMovieBoxSources({ title: d.name, mediaType: "tv", season: s, episode: e });
      const opts = await resolveSourceDownloadOptions(sources);
      setDownloadOpts(opts); setDownloadQuality(opts[0]?.id ?? "");
      if (opts.length === 0) setDownloadError("No download source found for this episode.");
    } catch { setDownloadError("Could not load download options."); }
    finally { setDownloadLoading(false); }
  };

  useEffect(() => {
    if (!downloadOpen) return;
    void loadDownloadOpts(downloadSeason, downloadEpisode);
  }, [downloadOpen, downloadSeason, downloadEpisode]);

  const confirmDownload = async () => {
    const opt = downloadOpts.find(o => o.id === downloadQuality);
    if (!opt) { setDownloadError("Select a quality first."); return; }
    setDownloadLoading(true);
    try {
      await queueVideoDownload({
        url: opt.url,
        title: `${d.name} — S${String(downloadSeason).padStart(2,"0")}E${String(downloadEpisode).padStart(2,"0")} — ${opt.label}`,
        thumbnail: poster, headers: opt.headers, forceHls: opt.forceHls, category: "TV",
      });
      setDownloadOpen(false);
    } catch (e) { setDownloadError(e instanceof Error ? e.message : "Download failed."); }
    finally { setDownloadLoading(false); }
  };

  // Queues every episode in the current season one by one via the existing download system
  const handleBulkSeasonDownload = async (seasonNumber: number) => {
    const seasonMeta = seasons.find(s => s.season_number === seasonNumber);
    const episodeCount = seasonMeta?.episode_count ?? 0;
    if (episodeCount === 0) return;
    setBulkDownloading(true);
    setBulkProgress({ done: 0, total: episodeCount });
    for (let ep = 1; ep <= episodeCount; ep++) {
      try {
        const sources = await fetchMovieBoxSources({ title: d.name, mediaType: "tv", season: seasonNumber, episode: ep }).catch(() => []);
        const opts = await resolveSourceDownloadOptions(sources).catch(() => []);
        const best = opts[0];
        if (best) {
          await queueVideoDownload({
            url: best.url,
            title: `${d.name} — S${String(seasonNumber).padStart(2, "0")}E${String(ep).padStart(2, "0")} — ${best.label}`,
          });
        }
      } catch { /* skip failed episodes silently */ }
      setBulkProgress({ done: ep, total: episodeCount });
    }
    setBulkDownloading(false);
  };

  const DETAIL_TABS = [
    { id: "overview", label: "Overview" },
    { id: "episodes", label: `Episodes${seasons.length > 0 ? ` (${seasons.length}S)` : ""}` },
    { id: "cast",     label: `Cast${cast.length > 0 ? ` (${cast.length})` : ""}` },
  ] as const;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 300, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px", overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 16, width: "100%", maxWidth: 820, boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
        {backdrop && (
          <div style={{ position: "relative", height: 200 }}>
            <img src={backdrop} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(transparent 30%, var(--bg-surface))" }} />
          </div>
        )}
        <div style={{ padding: "0 22px 26px" }}>
          <div style={{ display: "flex", gap: 16, marginTop: backdrop ? -60 : 20, position: "relative", zIndex: 1 }}>
            {poster && <img src={poster} alt={d.name} style={{ width: 95, height: 142, objectFit: "cover", borderRadius: 10, flexShrink: 0, border: "2px solid var(--border)", boxShadow: "var(--shadow-md)" }} />}
            <div style={{ flex: 1, paddingTop: backdrop ? 65 : 0, minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.2, marginBottom: 5 }}>{d.name}</div>
              {(d as any).tagline && <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", marginBottom: 7 }}>{(d as any).tagline}</div>}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 7 }}>
                {d.vote_average > 0 && <span style={{ background: "rgba(253,214,99,0.15)", border: "1px solid #fdd663", color: "#fdd663", fontSize: 11, padding: "2px 9px", borderRadius: 20, fontWeight: 700 }}>★ {d.vote_average.toFixed(1)}</span>}
                {d.first_air_date && <span style={{ background: "var(--bg-surface2)", padding: "2px 9px", borderRadius: 20, fontSize: 11, color: "var(--text-secondary)" }}>{d.first_air_date.slice(0, 4)}</span>}
                {d.number_of_seasons && <span style={{ background: "var(--bg-surface2)", padding: "2px 9px", borderRadius: 20, fontSize: 11, color: "var(--text-secondary)" }}>{d.number_of_seasons}S</span>}
                {d.number_of_episodes && <span style={{ background: "var(--bg-surface2)", padding: "2px 9px", borderRadius: 20, fontSize: 11, color: "var(--text-secondary)" }}>{d.number_of_episodes} Eps</span>}
                {d.status && <span style={{ background: d.status === "Returning Series" ? "rgba(34,197,94,0.15)" : "var(--bg-surface2)", border: d.status === "Returning Series" ? "1px solid rgba(34,197,94,0.5)" : "none", color: d.status === "Returning Series" ? "#22c55e" : "var(--text-secondary)", padding: "2px 9px", borderRadius: 20, fontSize: 11 }}>{d.status}</span>}
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {(d.genres ?? []).slice(0, 5).map((g: any) => (
                  <span key={g.id} style={{ background: "var(--bg-surface2)", border: "1px solid var(--border)", color: "var(--text-secondary)", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>{g.name}</span>
                ))}
              </div>
            </div>
            <button className="btn-icon" style={{ alignSelf: "flex-start", marginTop: backdrop ? 65 : 0, flexShrink: 0 }} onClick={onClose}><IconX size={15} /></button>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16, marginBottom: 16, flexWrap: "wrap" }}>
            <button className="btn btn-primary" style={{ gap: 7, flex: "1 1 120px", justifyContent: "center" }} onClick={() => handlePlayEpisode(1, 1)}><IconPlay size={14} /> Play S1E1</button>
            {trailerKey && <button className="btn btn-ghost" style={{ gap: 7, flex: "1 1 90px", justifyContent: "center" }} onClick={() => setShowTrailer(true)}>▶ Trailer</button>}
            <button className="btn btn-ghost" style={{ gap: 7, flex: "1 1 90px", justifyContent: "center" }} onClick={openDownload}><IconDownload size={14} /> Download</button>
            <button
              className="btn btn-ghost"
              style={{ gap: 7, flex: "1 1 120px", justifyContent: "center", opacity: bulkDownloading ? 0.6 : 1 }}
              disabled={bulkDownloading}
              onClick={() => void handleBulkSeasonDownload(selectedSeason || 1)}
              title={`Queue all episodes of Season ${selectedSeason || 1} for download`}
            >
              <IconDownload size={14} />
              {bulkDownloading
                ? `${bulkProgress.done}/${bulkProgress.total} queued…`
                : `Season ${selectedSeason || 1} ↓`}
            </button>
            <button className="btn btn-ghost" style={{ gap: 7, flex: "1 1 70px", justifyContent: "center", color: fav ? "var(--text-danger)" : undefined }}
              onClick={() => toggle({ id: `tv-${show.id}`, title: d.name, poster, type: "tv", tmdbId: show.id })}>
              <IconHeart size={14} color={fav ? "var(--text-danger)" : "currentColor"} filled={fav} />
              {fav ? "Saved" : "Save"}
            </button>
          </div>

          {streamProviders.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.05em" }}>Where to Watch</div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {streamProviders.slice(0, 6).map((p: any) => (
                  <div key={p.provider_id} style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg-surface2)", padding: "4px 10px", borderRadius: 8, fontSize: 11 }}>
                    {p.logo_path && <img src={`https://image.tmdb.org/t/p/w45${p.logo_path}`} alt="" style={{ width: 16, height: 16, borderRadius: 3 }} />}
                    {p.provider_name}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
            {DETAIL_TABS.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{ padding: "8px 16px", fontSize: 12, fontWeight: 600, border: "none", background: "transparent", cursor: "pointer", borderBottom: activeTab === t.id ? "2px solid var(--accent)" : "2px solid transparent", color: activeTab === t.id ? "var(--accent)" : "var(--text-muted)", transition: "var(--transition)", borderRadius: 0 }}>
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === "overview" && (
            <div>
              {d.overview && <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.75, marginBottom: 16 }}>{d.overview}</div>}
              {recs.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>More Like This</div>
                  <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6, scrollbarWidth: "none" }}>
                    {recs.map(r => <TVCard key={r.id} show={r} onClick={() => {}} />)}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "episodes" && (
            <div>
              {seasons.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                  {seasons.map(s => (
                    <button key={s.season_number} onClick={() => setSelectedSeason(s.season_number)}
                      style={{ padding: "5px 12px", borderRadius: 16, fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer", background: selectedSeason === s.season_number ? "var(--accent)" : "var(--bg-surface2)", color: selectedSeason === s.season_number ? "white" : "var(--text-secondary)" }}>
                      S{s.season_number}
                    </button>
                  ))}
                </div>
              )}
              {episodesLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {Array.from({ length: 5 }).map((_, i) => <div key={i} style={{ height: 64, borderRadius: 10, background: "var(--bg-surface2)" }} />)}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 380, overflowY: "auto" }}>
                  {episodes.map(ep => <EpisodeRow key={ep.id} episode={ep} onPlay={() => handlePlayEpisode(selectedSeason, ep.episode_number)} />)}
                  {episodes.length === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "20px 0" }}>No episode data available for this season.</div>}
                </div>
              )}
            </div>
          )}

          {activeTab === "cast" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 12 }}>
              {cast.map((c: any) => (
                <div key={c.id} style={{ textAlign: "center" }}>
                  {c.profile_path
                    ? <img src={`${IMG_PROF}${c.profile_path}`} alt={c.name} style={{ width: 60, height: 60, borderRadius: "50%", objectFit: "cover", margin: "0 auto 6px", display: "block", border: "2px solid var(--border)" }} />
                    : <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--bg-surface2)", margin: "0 auto 6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>👤</div>
                  }
                  <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.roles?.[0]?.character ?? c.character ?? ""}</div>
                </div>
              ))}
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
        visible={downloadOpen} title={d.name} poster={poster || undefined}
        languageOptions={[{ id: "english", label: "English" }]}
        selectedLanguage="english" onSelectLanguage={() => {}}
        qualityOptions={downloadOpts.map(o => ({ id: o.id, label: o.label }))}
        selectedQuality={downloadQuality} onSelectQuality={setDownloadQuality}
        loading={downloadLoading} error={downloadError}
        onClose={() => setDownloadOpen(false)} onConfirm={() => void confirmDownload()}
        extraContent={
          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Season</div>
              <select className="input-base" style={{ width: "100%", fontSize: 12 }} value={downloadSeason}
                onChange={e => { setDownloadSeason(Number(e.target.value)); setDownloadEpisode(1); }}>
                {seasons.length > 0
                  ? seasons.map(s => <option key={s.season_number} value={s.season_number}>Season {s.season_number}</option>)
                  : Array.from({ length: d.number_of_seasons ?? 1 }, (_, i) => <option key={i+1} value={i+1}>Season {i+1}</option>)
                }
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Episode</div>
              <select className="input-base" style={{ width: "100%", fontSize: 12 }} value={downloadEpisode} onChange={e => setDownloadEpisode(Number(e.target.value))}>
                {Array.from({ length: (seasons.find(s => s.season_number === downloadSeason)?.episode_count ?? 20) }, (_, i) => (
                  <option key={i+1} value={i+1}>Episode {i+1}</option>
                ))}
              </select>
            </div>
          </div>
        }
      />
    </div>
  );
}

// ── Episode Row ───────────────────────────────────────────────────────────────
function EpisodeRow({ episode: ep, onPlay }: { episode: Episode; onPlay: () => void }) {
  const still = ep.still_path ? `${IMG_BASE}${ep.still_path}` : "";
  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 10, background: "var(--bg-surface2)", border: "1px solid var(--border)", alignItems: "flex-start", cursor: "pointer" }} onClick={onPlay}>
      <div style={{ position: "relative", flexShrink: 0 }}>
        {still
          ? <img src={still} alt="" style={{ width: 100, height: 60, objectFit: "cover", borderRadius: 7 }} />
          : <div style={{ width: 100, height: 60, borderRadius: 7, background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📺</div>
        }
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0, transition: "opacity 0.15s" }}
          onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.opacity = "1"}
          onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.opacity = "0"}>
          <div style={{ background: "rgba(0,0,0,0.7)", borderRadius: "50%", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IconPlay size={12} color="#fff" />
          </div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>E{ep.episode_number}</span>
          <span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ep.name}</span>
          {ep.vote_average > 0 && <span style={{ fontSize: 10, color: "#fdd663", marginLeft: "auto", flexShrink: 0 }}>★ {ep.vote_average.toFixed(1)}</span>}
        </div>
        {ep.overview && <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{ep.overview}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          {ep.air_date && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{ep.air_date}</span>}
          {ep.runtime && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{ep.runtime}m</span>}
        </div>
      </div>
    </div>
  );
}
