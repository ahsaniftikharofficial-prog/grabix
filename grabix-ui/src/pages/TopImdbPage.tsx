// pages/TopImdbPage.tsx — Phase 3
// Top rated movies + TV sorted by vote_average. Filter by decade and genre.
// Movies tab / TV tab. Uses TMDB top_rated.

import { useState, useEffect, useMemo } from "react";
import {
  TMDB_IMAGE_BASE as IMG_BASE,
  discoverTmdbMedia,
  fetchTmdbGenres,
} from "../lib/tmdb";

const IMG = (p: string | null | undefined) => (p ? `${IMG_BASE}${p}` : "");

type MediaTab = "movie" | "tv";

interface Item {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  vote_average: number;
  vote_count: number;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
  overview: string;
}

interface Genre { id: number; name: string }

const DECADES = [
  { id: 0,    label: "All Decades" },
  { id: 2020, label: "2020s"       },
  { id: 2010, label: "2010s"       },
  { id: 2000, label: "2000s"       },
  { id: 1990, label: "1990s"       },
  { id: 1980, label: "1980s"       },
  { id: 1970, label: "1970s"       },
  { id: 0,    label: "Classic (pre-1970)" }, // handled by id 1
];
// avoid duplicate id=0 — override
DECADES[7] = { id: 1, label: "Classic (pre-1970)" };

function RankCard({ item, rank }: { item: Item; rank: number }) {
  const title = item.title ?? item.name ?? "";
  const year = (item.release_date ?? item.first_air_date ?? "").slice(0, 4);
  return (
    <div style={{
      display: "flex", gap: 12, alignItems: "flex-start",
      padding: "12px 14px", borderRadius: 10,
      background: "var(--bg-surface)", border: "1px solid var(--border)",
      transition: "box-shadow 0.15s",
    }}
      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.boxShadow = "var(--shadow-lg)"}
      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.boxShadow = "none"}
    >
      {/* rank number */}
      <div style={{
        flexShrink: 0, width: 36, fontSize: rank <= 10 ? 26 : 18,
        fontWeight: 900, color: rank <= 3 ? "var(--accent)" : "var(--text-muted)",
        lineHeight: 1, paddingTop: 4,
      }}>
        {rank}
      </div>
      {/* poster */}
      <div style={{ flexShrink: 0, width: 60, borderRadius: 7, overflow: "hidden" }}>
        {item.poster_path ? (
          <img src={IMG(item.poster_path)} alt={title}
            style={{ width: "100%", height: 90, objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ width: "100%", height: 90, background: "var(--bg-surface2)" }} />
        )}
      </div>
      {/* info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          {year} · {item.vote_count.toLocaleString()} votes
        </div>
        <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            background: "#fdd663", color: "#111",
            fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 6,
          }}>
            ★ {item.vote_average.toFixed(1)}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 5,
          overflow: "hidden", display: "-webkit-box",
          WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          {item.overview}
        </div>
      </div>
    </div>
  );
}

function FilterBar({ label, options, value, onChange }: {
  label: string;
  options: { id: number; name: string }[];
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{label}</span>
      <select value={value} onChange={e => onChange(Number(e.target.value))}
        style={{ fontSize: 12, padding: "5px 10px", borderRadius: 8,
          border: "1px solid var(--border)", background: "var(--bg-surface)",
          color: "var(--text-primary)", cursor: "pointer" }}>
        {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
}

export default function TopImdbPage() {
  const [tab, setTab] = useState<MediaTab>("movie");
  const [items, setItems] = useState<Item[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [loading, setLoading] = useState(true);
  const [decade, setDecade] = useState(0);
  const [genre, setGenre] = useState(0);

  useEffect(() => {
    setLoading(true);
    setItems([]);

    // fetch 5 pages → up to 100 items
    const pages = [1, 2, 3, 4, 5];
    Promise.all([
      fetchTmdbGenres(tab),
      ...pages.map(p => discoverTmdbMedia(tab, "top_rated", p)),
    ]).then(([genreRes, ...pageResults]) => {
      setGenres(genreRes?.genres ?? []);
      const all: Item[] = pageResults.flatMap((r: any) => r?.results ?? []);
      // deduplicate
      const seen = new Set<number>();
      const unique = all.filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true; });
      setItems(unique);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [tab]);

  const filtered = useMemo(() => {
    return items.filter(item => {
      const year = parseInt((item.release_date ?? item.first_air_date ?? "0").slice(0, 4));
      const passDecade =
        decade === 0 ? true :
        decade === 1 ? year < 1970 :
        year >= decade && year < decade + 10;
      const passGenre = genre === 0 || (item.genre_ids ?? []).includes(genre);
      return passDecade && passGenre;
    });
  }, [items, decade, genre]);

  const genreOptions = [{ id: 0, name: "All Genres" }, ...genres];
  const decadeOptions = DECADES.map(d => ({ id: d.id, name: d.label }));

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "24px 28px" }}>
      {/* header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", margin: 0 }}>
          ⭐ Top IMDb Rated
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
          Highest rated titles sorted by IMDb score — no algorithm, pure quality
        </p>
      </div>

      {/* tab switcher */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["movie", "tv"] as MediaTab[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setDecade(0); setGenre(0); }}
            style={{
              padding: "7px 20px", borderRadius: 20,
              border: "1px solid var(--border)",
              background: tab === t ? "var(--accent)" : "var(--bg-surface)",
              color: tab === t ? "#fff" : "var(--text-secondary)",
              cursor: "pointer", fontSize: 13, fontWeight: 600,
            }}>
            {t === "movie" ? "🎬 Movies" : "📺 TV Shows"}
          </button>
        ))}
      </div>

      {/* filters */}
      <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <FilterBar label="Decade" options={decadeOptions} value={decade} onChange={setDecade} />
        <FilterBar label="Genre"  options={genreOptions}  value={genre}  onChange={setGenre}  />
        <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
          {filtered.length} titles
        </span>
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ height: 90, borderRadius: 10,
              background: "var(--bg-surface)", border: "1px solid var(--border)" }} />
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.slice(0, 250).map((item, idx) => (
            <RankCard key={item.id} item={item} rank={idx + 1} />
          ))}
          {filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>
              No titles match these filters
            </div>
          )}
        </div>
      )}
    </div>
  );
}
