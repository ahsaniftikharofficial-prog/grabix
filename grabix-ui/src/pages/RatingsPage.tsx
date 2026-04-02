import { useState } from "react";

interface Episode {
  episode: number;
  title: string;
  rating: number | null;
}

interface Season {
  season: number;
  episodes: Episode[];
}

interface RatingsData {
  title: string;
  seasons: Season[];
  error?: string;
}

function getRatingColor(r: number | null): { bg: string; text: string } {
  if (!r) return { bg: "#1a1f2a", text: "#444" };
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

export default function RatingsPage() {
  const [query, setQuery]     = useState("");
  const [data, setData]       = useState<RatingsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [tooltip, setTooltip] = useState<{ ep: Episode; season: number; x: number; y: number } | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setData(null);
    setTooltip(null);
    try {
      const res  = await fetch(`http://127.0.0.1:8000/ratings?title=${encodeURIComponent(query)}`);
      const json = await res.json() as RatingsData;
      setData(json);
    } catch {
      setData({ title: "", seasons: [], error: "Cannot connect to backend." });
    }
    setLoading(false);
  };

  const seasons  = data?.seasons ?? [];
  const maxEps   = seasons.length ? Math.max(...seasons.map((s) => s.episodes.length)) : 0;
  const seasonAvg = seasons.map((s) => {
    const rated = s.episodes.filter((e) => e.rating);
    if (!rated.length) return null;
    return +(rated.reduce((a, e) => a + (e.rating ?? 0), 0) / rated.length).toFixed(1);
  });

  const CELL = 56;
  const ROW_LABEL = 44;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-app)", color: "var(--text-primary)" }}>

      {/* Search */}
      <div style={{ padding: "20px 24px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>📊 Series Ratings</div>
        <div style={{ display: "flex", gap: 8, maxWidth: 560 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="e.g. Breaking Bad, Game of Thrones…"
            style={{
              flex: 1, background: "var(--bg-card)", border: "1px solid var(--border)",
              borderRadius: 8, padding: "9px 14px", color: "var(--text-primary)",
              fontSize: 14, outline: "none", fontFamily: "inherit",
            }}
          />
          <button
            onClick={search}
            disabled={loading}
            style={{
              background: "var(--accent)", border: "none", borderRadius: 8,
              padding: "9px 22px", color: "#fff", cursor: "pointer",
              fontWeight: 600, fontFamily: "inherit", fontSize: 13,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>

        {seasons.length > 0 && (
          <div style={{ display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
            {LEGEND.map((l) => (
              <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />
                {l.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {data?.error && (
        <div style={{ padding: "14px 24px", color: "var(--text-danger)", fontSize: 13 }}>⚠ {data.error}</div>
      )}

      {/* Grid */}
      {seasons.length > 0 && (
        <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>{data?.title}</div>

          <div style={{ display: "inline-block" }}>

            {/* Season headers */}
            <div style={{ display: "flex", marginBottom: 4, marginLeft: ROW_LABEL }}>
              {seasons.map((s) => (
                <div key={s.season} style={{ width: CELL, textAlign: "center", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", flexShrink: 0 }}>
                  S{s.season}
                </div>
              ))}
            </div>

            {/* Episode rows */}
            {Array.from({ length: maxEps }, (_, epIdx) => (
              <div key={epIdx} style={{ display: "flex", alignItems: "center", marginBottom: 3 }}>
                <div style={{ width: ROW_LABEL, fontSize: 11, color: "var(--text-muted)", fontWeight: 600, flexShrink: 0 }}>
                  E{epIdx + 1}
                </div>
                {seasons.map((s) => {
                  const ep = s.episodes[epIdx];
                  const { bg, text } = getRatingColor(ep?.rating ?? null);
                  return (
                    <div key={s.season} style={{ width: CELL, flexShrink: 0, display: "flex", justifyContent: "center" }}>
                      {ep ? (
                        <div
                          style={{
                            width: CELL - 8, height: 38, borderRadius: 8,
                            background: bg, color: text,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 13, fontWeight: 700, cursor: "pointer",
                            transition: "transform 0.1s",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLDivElement).style.transform = "scale(1.1)";
                            setTooltip({ ep, season: s.season, x: e.clientX, y: e.clientY });
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLDivElement).style.transform = "scale(1)";
                            setTooltip(null);
                          }}
                        >
                          {ep.rating ?? "—"}
                        </div>
                      ) : (
                        <div style={{ width: CELL - 8, height: 38 }} />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {/* AVG row */}
            <div style={{ display: "flex", alignItems: "center", marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div style={{ width: ROW_LABEL, fontSize: 11, color: "var(--text-muted)", fontWeight: 700, flexShrink: 0 }}>AVG.</div>
              {seasonAvg.map((avg, i) => {
                const { bg, text } = getRatingColor(avg);
                return (
                  <div key={i} style={{ width: CELL, flexShrink: 0, display: "flex", justifyContent: "center" }}>
                    <div style={{
                      width: CELL - 8, height: 38, borderRadius: 8,
                      background: bg, color: text,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 700,
                    }}>
                      {avg ?? "—"}
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: "fixed", top: tooltip.y - 72, left: tooltip.x + 14,
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: 8, padding: "8px 14px", fontSize: 12,
          color: "var(--text-primary)", pointerEvents: "none", zIndex: 999,
          maxWidth: 260, boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
        }}>
          <div style={{ fontWeight: 700, marginBottom: 3 }}>
            S{tooltip.season} E{tooltip.ep.episode} — {tooltip.ep.title}
          </div>
          <div style={{ color: "#facc15" }}>⭐ {tooltip.ep.rating ?? "No rating yet"}</div>
        </div>
      )}

      {data && !data.error && seasons.length === 0 && (
        <div style={{ padding: "24px", color: "var(--text-muted)", fontSize: 13 }}>No episode data found.</div>
      )}
    </div>
  );
}
