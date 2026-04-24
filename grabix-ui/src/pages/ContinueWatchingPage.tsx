// pages/ContinueWatchingPage.tsx — Phase 3
// Full-page Continue Watching hub. Shows every started item with % progress,
// resume button, and remove-from-history option. Reads from localStorage.

import { useState } from "react";
import { TMDB_IMAGE_BASE as IMG_BASE, TMDB_BACKDROP_BASE as IMG_LG } from "../lib/tmdb";
import { useContinueWatching, type WatchEntry } from "../hooks/useContinueWatching";

const IMG = (p: string | null | undefined, base = IMG_BASE) =>
  p ? `${base}${p}` : "";

// ── progress ring ─────────────────────────────────────────────────────────────
function Ring({ pct }: { pct: number }) {
  const r = 18, circ = 2 * Math.PI * r;
  const filled = (pct / 100) * circ;
  return (
    <svg width={44} height={44} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={22} cy={22} r={r} fill="none" stroke="var(--bg-surface2)" strokeWidth={4} />
      <circle cx={22} cy={22} r={r} fill="none" stroke="var(--accent)"
        strokeWidth={4} strokeDasharray={`${filled} ${circ}`}
        strokeLinecap="round" />
    </svg>
  );
}

// ── entry card ────────────────────────────────────────────────────────────────
function EntryCard({
  entry,
  onResume,
  onRemove,
}: {
  entry: WatchEntry;
  onResume: () => void;
  onRemove: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const backdrop = IMG(entry.backdrop_path, IMG_LG) || IMG(entry.poster_path);
  const tvLabel = entry.kind === "tv" && entry.season != null
    ? `S${entry.season} E${entry.episode ?? 1}`
    : null;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative", borderRadius: 12, overflow: "hidden",
        background: "var(--bg-surface)", border: "1px solid var(--border)",
        transition: "transform 0.15s, box-shadow 0.15s",
        transform: hovered ? "scale(1.02)" : "scale(1)",
        boxShadow: hovered ? "var(--shadow-lg)" : "none",
      }}
    >
      {/* backdrop */}
      <div style={{ position: "relative", height: 160 }}>
        {backdrop ? (
          <img src={backdrop} alt={entry.title}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", background: "var(--bg-surface2)" }} />
        )}
        {/* gradient */}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 60%)",
        }} />
        {/* remove button */}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{
            position: "absolute", top: 8, right: 8,
            background: "rgba(0,0,0,0.6)", border: "none",
            borderRadius: "50%", width: 28, height: 28,
            color: "#fff", cursor: "pointer", fontSize: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: hovered ? 1 : 0, transition: "opacity 0.2s",
          }}
          title="Remove from history"
        >✕</button>
      </div>

      {/* bottom section */}
      <div style={{ padding: "10px 12px 12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {entry.title}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {tvLabel ?? (entry.kind === "movie" ? "Movie" : "TV")}
              {" · "}
              {entry.progress}% watched
            </div>
          </div>
          <Ring pct={entry.progress} />
        </div>

        {/* thin progress bar */}
        <div style={{ height: 3, borderRadius: 3, background: "var(--bg-surface2)", marginTop: 8 }}>
          <div style={{ height: "100%", width: `${entry.progress}%`,
            background: "var(--accent)", borderRadius: 3, transition: "width 0.3s" }} />
        </div>

        <button onClick={onResume}
          style={{
            marginTop: 10, width: "100%", padding: "7px 0",
            background: "var(--accent)", color: "#fff",
            border: "none", borderRadius: 8, cursor: "pointer",
            fontSize: 12, fontWeight: 700, display: "flex",
            alignItems: "center", justifyContent: "center", gap: 6,
          }}>
          ▶ Resume
        </button>
      </div>
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────
interface Props {
  /** Optional: called when user wants to resume playback */
  onResume?: (entry: WatchEntry) => void;
}

export default function ContinueWatchingPage({ onResume }: Props) {
  const { entries, remove, clear } = useContinueWatching();
  const [filter, setFilter] = useState<"all" | "movie" | "tv">("all");
  const [confirmClear, setConfirmClear] = useState(false);

  const visible = entries.filter(e => filter === "all" || e.kind === filter);

  const handleResume = (entry: WatchEntry) => {
    if (onResume) onResume(entry);
    else alert(`Resume "${entry.title}" — wire onResume prop to open the player.`);
  };

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "24px 28px" }}>
      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", margin: 0 }}>
            ▶ Continue Watching
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            Pick up where you left off — {entries.length} title{entries.length !== 1 ? "s" : ""} in progress
          </p>
        </div>
        {entries.length > 0 && (
          confirmClear ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Clear all history?</span>
              <button onClick={() => { clear(); setConfirmClear(false); }}
                style={{ padding: "5px 12px", borderRadius: 6, border: "none",
                  background: "var(--text-danger)", color: "#fff", cursor: "pointer", fontSize: 12 }}>
                Yes, clear
              </button>
              <button onClick={() => setConfirmClear(false)}
                style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid var(--border)",
                  background: "var(--bg-surface)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 12 }}>
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmClear(true)}
              style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid var(--border)",
                background: "var(--bg-surface)", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
              🗑 Clear all
            </button>
          )
        )}
      </div>

      {/* filter pills */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {(["all", "movie", "tv"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              padding: "6px 16px", borderRadius: 20,
              border: "1px solid var(--border)",
              background: filter === f ? "var(--accent)" : "var(--bg-surface)",
              color: filter === f ? "#fff" : "var(--text-secondary)",
              cursor: "pointer", fontSize: 12, fontWeight: 600,
            }}>
            {f === "all" ? "All" : f === "movie" ? "🎬 Movies" : "📺 TV"}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 0", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🎬</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Nothing here yet</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            Start watching something in Movies or TV Series and it'll appear here.
          </div>
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 16,
        }}>
          {visible.map(entry => (
            <EntryCard
              key={`${entry.kind}-${entry.id}`}
              entry={entry}
              onResume={() => handleResume(entry)}
              onRemove={() => remove(entry.id, entry.kind)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
