// pages/NewAndHotPage.tsx — Phase 3
// Tabbed page: Trending This Week | New Releases | Coming Soon (with Remind Me bell)

import { useState, useEffect } from "react";
import {
  TMDB_IMAGE_BASE as IMG_BASE,
  TMDB_BACKDROP_BASE as IMG_LG,
  discoverTmdbMedia,
  fetchTmdbUpcoming,
  fetchTmdbAiringToday,
} from "../lib/tmdb";
import { useRemindMe } from "../hooks/useRemindMe";

// ── helpers ──────────────────────────────────────────────────────────────────
const IMG = (p: string | null | undefined, base = IMG_BASE) =>
  p ? `${base}${p}` : "";

const DAYS_AGO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

type Tab = "trending" | "new" | "coming";

interface Item {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  backdrop_path?: string | null;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
  overview: string;
  media_type?: string;
}

// ── sub-components ────────────────────────────────────────────────────────────
function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string; emoji: string }[] = [
    { id: "trending", label: "Trending", emoji: "🔥" },
    { id: "new",      label: "New Releases", emoji: "✨" },
    { id: "coming",   label: "Coming Soon",  emoji: "🔔" },
  ];
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            padding: "8px 20px", borderRadius: 20,
            border: "1px solid var(--border)",
            background: active === t.id ? "var(--accent)" : "var(--bg-surface)",
            color: active === t.id ? "#fff" : "var(--text-secondary)",
            cursor: "pointer", fontSize: 13, fontWeight: 600,
            transition: "all 0.15s",
          }}
        >
          {t.emoji} {t.label}
        </button>
      ))}
    </div>
  );
}

function PosterCard({ item, badge }: { item: Item; badge?: React.ReactNode }) {
  const title = item.title ?? item.name ?? "";
  const date = item.release_date ?? item.first_air_date ?? "";
  return (
    <div style={{
      flexShrink: 0, width: 140, cursor: "pointer",
      borderRadius: 10, overflow: "hidden",
      background: "var(--bg-surface)", border: "1px solid var(--border)",
      transition: "transform 0.15s, box-shadow 0.15s",
    }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.transform = "scale(1.05)";
        (e.currentTarget as HTMLDivElement).style.boxShadow = "var(--shadow-lg)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.transform = "scale(1)";
        (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
      }}
    >
      <div style={{ position: "relative" }}>
        {item.poster_path ? (
          <img src={IMG(item.poster_path)} alt={title}
            style={{ width: "100%", height: 210, objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ width: "100%", height: 210, background: "var(--bg-surface2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, color: "var(--text-muted)" }}>No Image</div>
        )}
        {item.vote_average > 0 && (
          <div style={{ position: "absolute", top: 5, right: 5,
            background: "rgba(0,0,0,0.75)", color: "#fdd663",
            fontSize: 10, padding: "2px 6px", borderRadius: 6, fontWeight: 700 }}>
            ★ {item.vote_average.toFixed(1)}
          </div>
        )}
        {badge && (
          <div style={{ position: "absolute", bottom: 6, left: 6 }}>{badge}</div>
        )}
      </div>
      <div style={{ padding: "7px 9px 10px" }}>
        <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        {date && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
          {date.slice(0, 10)}</div>}
      </div>
    </div>
  );
}

function HorizontalRow({ title, items, badge }: {
  title: string;
  items: Item[];
  badge?: (item: Item) => React.ReactNode;
}) {
  if (!items.length) return null;
  return (
    <section style={{ marginBottom: 32 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: "var(--text-primary)" }}>
        {title}
      </h3>
      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
        {items.map((item) => (
          <PosterCard key={item.id} item={item} badge={badge?.(item)} />
        ))}
      </div>
    </section>
  );
}

function RemindBell({ id, isOn, onToggle }: { id: number; isOn: boolean; onToggle: (id: number) => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(id); }}
      title={isOn ? "Remove reminder" : "Remind me"}
      style={{
        background: isOn ? "var(--accent)" : "rgba(0,0,0,0.65)",
        border: "none", borderRadius: "50%",
        width: 28, height: 28, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, color: "#fff", transition: "background 0.2s",
      }}
    >
      {isOn ? "🔔" : "🔕"}
    </button>
  );
}

function LoadingGrid() {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={{ flexShrink: 0, width: 140, borderRadius: 10,
          overflow: "hidden", background: "var(--bg-surface)" }}>
          <div style={{ height: 210, background: "var(--bg-surface2)" }} />
          <div style={{ padding: "7px 9px" }}>
            <div style={{ height: 10, background: "var(--bg-surface2)", borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────
export default function NewAndHotPage() {
  const [tab, setTab] = useState<Tab>("trending");
  const [trending, setTrending] = useState<Item[]>([]);
  const [newMovies, setNewMovies] = useState<Item[]>([]);
  const [newShows, setNewShows] = useState<Item[]>([]);
  const [upcoming, setUpcoming] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const { isReminded, toggle } = useRemindMe();

  useEffect(() => {
    setLoading(true);
    const cutoff = DAYS_AGO(60);

    Promise.all([
      discoverTmdbMedia("movie", "trending", 1),
      discoverTmdbMedia("tv", "trending", 1),
      discoverTmdbMedia("movie", "popular", 1),
      discoverTmdbMedia("tv", "on_the_air", 1),
      fetchTmdbUpcoming(1),
    ]).then(([trendM, trendTv, recM, recTv, upcomingRes]) => {
      const trendMovies: Item[] = (trendM?.results ?? [])
        .map((m: any) => ({ ...m, media_type: "movie" }));
      const trendShows: Item[] = (trendTv?.results ?? [])
        .map((s: any) => ({ ...s, media_type: "tv" }));
      setTrending([...trendMovies, ...trendShows].slice(0, 30));

      setNewMovies(
        (recM?.results ?? []).filter((m: any) =>
          m.release_date && m.release_date >= cutoff
        ).slice(0, 20)
      );
      setNewShows((recTv?.results ?? []).slice(0, 20));
      setUpcoming((upcomingRes?.results ?? []).slice(0, 30));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "24px 28px" }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", margin: 0 }}>
          🔥 New &amp; Hot
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
          What's trending, freshly released, and landing soon
        </p>
      </div>

      <TabBar active={tab} onChange={setTab} />

      {loading ? (
        <LoadingGrid />
      ) : (
        <>
          {tab === "trending" && (
            <>
              <HorizontalRow title="🎬 Trending Movies" items={trending.filter(i => i.media_type === "movie" || i.title)} />
              <HorizontalRow title="📺 Trending TV Shows" items={trending.filter(i => i.media_type === "tv" || i.name)} />
            </>
          )}

          {tab === "new" && (
            <>
              <HorizontalRow title="✨ New Movie Releases (last 60 days)" items={newMovies} />
              <HorizontalRow title="📺 Currently Airing Shows" items={newShows} />
            </>
          )}

          {tab === "coming" && (
            <HorizontalRow
              title="🔔 Coming Soon — Set a Reminder"
              items={upcoming}
              badge={(item) => (
                <RemindBell id={item.id} isOn={isReminded(item.id)} onToggle={toggle} />
              )}
            />
          )}
        </>
      )}
    </div>
  );
}
