// pages/GenrePage.tsx — standalone first-class genre / mood page
// Navigated to when the user clicks a genre pill or mood pill.
// Supports language, decade & rating filters with infinite scroll.
import { useCallback, useEffect, useRef, useState } from "react";
import { IconSearch, IconStar, IconX } from "../components/Icons";
import { PageEmptyState, PageErrorState } from "../components/PageStates";
import { useContentFilter } from "../context/ContentFilterContext";
import { filterAdultContent } from "../lib/contentFilter";
import { discoverTmdbByGenre, TMDB_IMAGE_BASE as IMG_BASE } from "../lib/tmdb";
import { SearchFilters, DEFAULT_FILTERS, type FilterState } from "../components/search/SearchFilters";
import type { MoodConfig } from "../lib/moodKeywords";

interface MediaItem {
  id: number;
  title?: string;
  name?: string;
  poster_path: string;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
  original_language?: string;
}

interface Props {
  mediaType: "movie" | "tv";
  genreId: number;
  genreName: string;
  /** If this genre was triggered by a mood pill, the config is passed in */
  mood?: MoodConfig | null;
  onBack: () => void;
}

function LoadingGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
      {Array.from({ length: 20 }).map((_, i) => (
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

function ItemCard({ item, onClick }: { item: MediaItem; onClick: () => void }) {
  const title = item.title ?? item.name ?? "Untitled";
  const year = (item.release_date ?? item.first_air_date ?? "").slice(0, 4);
  const poster = item.poster_path ? `${IMG_BASE}${item.poster_path}` : "";

  return (
    <div
      className="card"
      style={{ overflow: "hidden", cursor: "pointer", transition: "transform 0.15s" }}
      onClick={onClick}
      onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.transform = "translateY(0)")}
    >
      <div style={{ position: "relative" }}>
        {poster
          ? <img src={poster} alt={title} style={{ width: "100%", height: 210, objectFit: "cover" }} />
          : <div style={{ width: "100%", height: 210, background: "var(--bg-surface2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>No Poster</div>
        }
        {item.vote_average > 0 && (
          <div style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.75)", color: "#fdd663", fontSize: 11, padding: "2px 7px", borderRadius: 6, display: "flex", alignItems: "center", gap: 3, fontWeight: 600 }}>
            <IconStar size={10} color="#fdd663" /> {item.vote_average.toFixed(1)}
          </div>
        )}
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        {year && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{year}</div>}
      </div>
    </div>
  );
}

export default function GenrePage({ mediaType, genreId, genreName, mood, onBack }: Props) {
  const { adultContentBlocked } = useContentFilter();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef(new Set<number>());

  const loadPage = useCallback(async (pg: number, isReset: boolean, f: FilterState) => {
    setLoading(true);
    try {
      const d = await discoverTmdbByGenre(
        mediaType,
        genreId,
        pg,
        f.sortBy,
        f.year || undefined,
        f.minRating || undefined,
      );
      let results: MediaItem[] = d?.results ?? [];

      // Frontend language filter (backend doesn't support it yet)
      if (f.language) {
        results = results.filter((r) => r.original_language === f.language);
      }

      // Dedup
      const fresh = results.filter((r) => !seenIds.current.has(r.id));
      fresh.forEach((r) => seenIds.current.add(r.id));

      setItems((prev) => (isReset ? fresh : [...prev, ...fresh]));
      setHasMore(results.length >= 18);
      setError("");
    } catch {
      setError("Content could not be loaded right now.");
    } finally {
      setLoading(false);
    }
  }, [mediaType, genreId]);

  // Reset on filter change
  useEffect(() => {
    seenIds.current = new Set();
    setPage(1);
    setItems([]);
    setHasMore(true);
    void loadPage(1, true, filters);
  }, [filters, loadPage]);

  // Infinite scroll
  useEffect(() => {
    const root = scrollRef.current;
    const node = bottomRef.current;
    if (!root || !node) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !loading && hasMore) {
          const next = page + 1;
          setPage(next);
          void loadPage(next, false, filters);
        }
      },
      { root, rootMargin: "300px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [loading, hasMore, page, filters, loadPage]);

  const filtered = filterAdultContent(items, adultContentBlocked);
  const heading = mood ? `${mood.emoji} ${mood.label}` : genreName;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-base)" }}>
      {/* Header */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button className="btn btn-ghost" style={{ fontSize: 13, gap: 5 }} onClick={onBack}>
          ← Back
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{heading}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
            {mediaType === "movie" ? "Movies" : "TV Series"} · {mood?.description ?? genreName}
          </div>
        </div>
        <button
          className={`btn ${showFilters ? "btn-primary" : "btn-ghost"}`}
          style={{ fontSize: 12, gap: 5 }}
          onClick={() => setShowFilters((f) => !f)}
        >
          <IconSearch size={12} /> Filters {showFilters ? "▲" : "▼"}
        </button>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12 }}
          onClick={() => {
            seenIds.current = new Set();
            setFilters(DEFAULT_FILTERS);
          }}
          title="Refresh"
        >
          <IconX size={12} />
        </button>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <SearchFilters
          filters={filters}
          onChange={(next) => setFilters(next)}
          sortOptions={
            mediaType === "movie"
              ? [
                  { id: "popularity.desc", label: "Most Popular" },
                  { id: "vote_average.desc", label: "Highest Rated" },
                  { id: "primary_release_date.desc", label: "Newest First" },
                  { id: "primary_release_date.asc", label: "Oldest First" },
                ]
              : [
                  { id: "popularity.desc", label: "Most Popular" },
                  { id: "vote_average.desc", label: "Highest Rated" },
                  { id: "first_air_date.desc", label: "Newest First" },
                  { id: "first_air_date.asc", label: "Oldest First" },
                ]
          }
        />
      )}

      {/* Grid */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
        {loading && filtered.length === 0 ? (
          <LoadingGrid />
        ) : error ? (
          <PageErrorState
            title="Content unavailable"
            subtitle={error}
            onRetry={() => void loadPage(page, false, filters)}
          />
        ) : filtered.length === 0 ? (
          <PageEmptyState
            title={`No ${mediaType === "movie" ? "movies" : "series"} found`}
            subtitle="Try adjusting your filters."
          />
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
              {filtered.map((item) => (
                <ItemCard key={item.id} item={item} onClick={() => {}} />
              ))}
            </div>
            {loading && (
              <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)", fontSize: 13 }}>
                Loading more…
              </div>
            )}
            <div ref={bottomRef} style={{ height: 24 }} />
          </>
        )}
      </div>
    </div>
  );
}
