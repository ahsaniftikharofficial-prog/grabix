// pages/RecentlyAddedPage.tsx — Phase 3
// Purely chronological listing of recently added movies + TV shows.
// Uses TMDB now_playing (movies) and on_the_air (TV). No algorithm, just recency.

import { useState, useEffect, useCallback } from "react";
import {
  TMDB_IMAGE_BASE as IMG_BASE,
  discoverTmdbMedia,
  fetchTmdbNowPlaying,
} from "../lib/tmdb";

const IMG = (p: string | null | undefined) => (p ? `${IMG_BASE}${p}` : "");

type MediaTab = "both" | "movie" | "tv";

interface Item {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
  overview: string;
  media_type: "movie" | "tv";
}

function RecentCard({ item }: { item: Item }) {
  const [hovered, setHovered] = useState(false);
  const title = item.title ?? item.name ?? "";
  const date = (item.release_date ?? item.first_air_date ?? "").slice(0, 10);
  const isNew =
    date &&
    (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24) < 14;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", gap: 12, alignItems: "flex-start",
        padding: "10px 12px", borderRadius: 10,
        background: "var(--bg-surface)", border: "1px solid var(--border)",
        transition: "box-shadow 0.15s, transform 0.15s",
        boxShadow: hovered ? "var(--shadow-lg)" : "none",
        transform: hovered ? "translateX(3px)" : "none",
        cursor: "pointer",
      }}
    >
      {/* poster */}
      <div style={{ flexShrink: 0, width: 56, borderRadius: 7, overflow: "hidden" }}>
        {item.poster_path ? (
          <img src={IMG(item.poster_path)} alt={title}
            style={{ width: "100%", height: 84, objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ width: "100%", height: 84, background: "var(--bg-surface2)" }} />
        )}
      </div>

      {/* info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </span>
          {isNew && (
            <span style={{
              fontSize: 9, fontWeight: 800, padding: "1px 6px",
              borderRadius: 4, background: "var(--accent)", color: "#fff",
              letterSpacing: 0.5, flexShrink: 0,
            }}>NEW</span>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 3, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{date}</span>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>·</span>
          <span style={{
            fontSize: 10, fontWeight: 600,
            color: item.media_type === "movie" ? "#7c9ef7" : "#7de0b5",
          }}>
            {item.media_type === "movie" ? "🎬 Movie" : "📺 TV"}
          </span>
          {item.vote_average > 0 && (
            <>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>·</span>
              <span style={{ fontSize: 10, color: "#fdd663", fontWeight: 700 }}>
                ★ {item.vote_average.toFixed(1)}
              </span>
            </>
          )}
        </div>

        <div style={{
          fontSize: 11, color: "var(--text-secondary)", marginTop: 5,
          overflow: "hidden", display: "-webkit-box",
          WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        }}>
          {item.overview}
        </div>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div style={{
      display: "flex", gap: 12, padding: "10px 12px",
      borderRadius: 10, background: "var(--bg-surface)",
      border: "1px solid var(--border)",
    }}>
      <div style={{ flexShrink: 0, width: 56, height: 84, borderRadius: 7,
        background: "var(--bg-surface2)" }} />
      <div style={{ flex: 1 }}>
        <div style={{ height: 13, width: "55%", borderRadius: 4,
          background: "var(--bg-surface2)", marginBottom: 8 }} />
        <div style={{ height: 10, width: "30%", borderRadius: 4,
          background: "var(--bg-surface2)", marginBottom: 8 }} />
        <div style={{ height: 10, width: "80%", borderRadius: 4,
          background: "var(--bg-surface2)" }} />
      </div>
    </div>
  );
}

export default function RecentlyAddedPage() {
  const [tab, setTab] = useState<MediaTab>("both");
  const [movies, setMovies] = useState<Item[]>([]);
  const [shows, setShows] = useState<Item[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    setLoading(true);
    setMovies([]);
    setShows([]);
    setPage(1);
    setHasMore(true);

    Promise.all([
      fetchTmdbNowPlaying(1),
      discoverTmdbMedia("tv", "on_the_air", 1),
    ]).then(([mRes, tvRes]) => {
      const m: Item[] = (mRes?.results ?? []).map((i: any) => ({ ...i, media_type: "movie" as const }));
      const t: Item[] = (tvRes?.results ?? []).map((i: any) => ({ ...i, media_type: "tv" as const }));
      setMovies(m);
      setShows(t);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    try {
      const [mRes, tvRes] = await Promise.all([
        fetchTmdbNowPlaying(nextPage),
        discoverTmdbMedia("tv", "on_the_air", nextPage),
      ]);
      const m: Item[] = (mRes?.results ?? []).map((i: any) => ({ ...i, media_type: "movie" as const }));
      const t: Item[] = (tvRes?.results ?? []).map((i: any) => ({ ...i, media_type: "tv" as const }));
      if (!m.length && !t.length) setHasMore(false);
      setMovies(prev => [...prev, ...m]);
      setShows(prev => [...prev, ...t]);
      setPage(nextPage);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [page, loadingMore, hasMore]);

  // merge + sort by date descending
  const merged: Item[] = [
    ...(tab !== "tv" ? movies : []),
    ...(tab !== "movie" ? shows : []),
  ].sort((a, b) => {
    const da = a.release_date ?? a.first_air_date ?? "";
    const db = b.release_date ?? b.first_air_date ?? "";
    return db > da ? 1 : -1;
  });

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "24px 28px" }}
      onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
          void loadMore();
        }
      }}
    >
      {/* header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", margin: 0 }}>
          🆕 Recently Added
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
          Pure chronological order — no algorithm, just what's newest
        </p>
      </div>

      {/* filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {([
          { id: "both",  label: "All" },
          { id: "movie", label: "🎬 Movies" },
          { id: "tv",    label: "📺 TV Shows" },
        ] as { id: MediaTab; label: string }[]).map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)}
            style={{
              padding: "7px 18px", borderRadius: 20,
              border: "1px solid var(--border)",
              background: tab === id ? "var(--accent)" : "var(--bg-surface)",
              color: tab === id ? "#fff" : "var(--text-secondary)",
              cursor: "pointer", fontSize: 12, fontWeight: 600,
            }}>
            {label}
          </button>
        ))}
        <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center", marginLeft: 4 }}>
          {merged.length} titles
        </span>
      </div>

      {/* list */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {Array.from({ length: 10 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : merged.length === 0 ? (
        <div style={{ textAlign: "center", padding: 80, color: "var(--text-muted)" }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🎬</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Nothing loaded yet</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {merged.map(item => (
            <RecentCard key={`${item.media_type}-${item.id}`} item={item} />
          ))}
          {loadingMore && (
            <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)", fontSize: 12 }}>
              Loading more...
            </div>
          )}
          {!hasMore && !loadingMore && (
            <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)", fontSize: 12 }}>
              That's everything
            </div>
          )}
        </div>
      )}
    </div>
  );
}
