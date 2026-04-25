/**
 * WatchHistoryPage.tsx — Phase 6
 * Full watch history page. Shows everything in useContinueWatching,
 * with timestamps, progress, and filter by movie vs TV.
 */

import { useState } from "react";
import { useContinueWatching, type WatchEntry } from "../hooks/useContinueWatching";
import { useProfile } from "../context/ProfileContext";

const TMDB_IMAGE = "https://image.tmdb.org/t/p/w185";

type Filter = "all" | "movie" | "tv";

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div style={{ height: 3, background: "var(--bg-surface2)", borderRadius: 2, overflow: "hidden", marginTop: 6 }}>
      <div style={{ height: "100%", width: `${Math.min(100, value)}%`, background: "var(--accent)", borderRadius: 2, transition: "width 0.3s" }} />
    </div>
  );
}

function HistoryCard({ entry, onRemove }: { entry: WatchEntry; onRemove: () => void }) {
  const poster = entry.poster_path ? `${TMDB_IMAGE}${entry.poster_path}` : null;

  return (
    <div style={{
      display: "flex", gap: 14, padding: "14px 0",
      borderBottom: "1px solid var(--border)",
      animation: "fadeUp 0.3s ease both",
    }}>
      {/* Poster */}
      <div style={{ flexShrink: 0, width: 64, height: 96, borderRadius: 8, overflow: "hidden", background: "var(--bg-surface2)", position: "relative" }}>
        {poster
          ? <img src={poster} alt={entry.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
              {entry.kind === "movie" ? "🎬" : "📺"}
            </div>
        }
        {/* Kind badge */}
        <div style={{ position: "absolute", bottom: 4, left: 4, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 9, fontWeight: 700, borderRadius: 4, padding: "1px 5px", textTransform: "uppercase" }}>
          {entry.kind}
        </div>
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.title}
        </div>
        {entry.kind === "tv" && entry.season != null && entry.episode != null && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
            Season {entry.season} · Episode {entry.episode}
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
          Watched {formatDate(entry.updatedAt)}
        </div>

        {/* Progress */}
        <div style={{ maxWidth: 240 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>
            <span>{entry.progress < 100 ? `${Math.round(entry.progress)}% watched` : "Completed"}</span>
          </div>
          <ProgressBar value={entry.progress} />
        </div>
      </div>

      {/* Remove button */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "flex-start", paddingTop: 2 }}>
        <button
          onClick={onRemove}
          title="Remove from history"
          style={{
            background: "none", border: "1px solid var(--border)", borderRadius: 6,
            padding: "4px 8px", cursor: "pointer", fontSize: 12,
            color: "var(--text-muted)", fontFamily: "var(--font)", transition: "all 0.12s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--text-danger)"; e.currentTarget.style.color = "var(--text-danger)"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function WatchHistoryPage() {
  const { entries, remove, clear } = useContinueWatching();
  const { activeProfile } = useProfile();
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = entries.filter(e => filter === "all" ? true : e.kind === filter);

  const movieCount = entries.filter(e => e.kind === "movie").length;
  const tvCount    = entries.filter(e => e.kind === "tv").length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-app)", color: "var(--text-primary)" }}>
      <style>{`@keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }`}</style>

      {/* Header */}
      <div style={{ padding: "16px 24px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              📜 Watch History
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {activeProfile.name} · {entries.length} items
            </div>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {entries.length > 0 && (
              confirmClear ? (
                <>
                  <button
                    onClick={() => { clear(); setConfirmClear(false); }}
                    style={{ background: "#ef4444", border: "none", borderRadius: 7, padding: "6px 14px", color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 600, fontFamily: "var(--font)" }}
                  >
                    Yes, clear all
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 14px", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font)" }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  style={{ background: "none", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 14px", color: "var(--text-muted)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font)" }}
                >
                  Clear history
                </button>
              )
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: 6 }}>
          {([
            { id: "all",   label: `All (${entries.length})` },
            { id: "movie", label: `Movies (${movieCount})` },
            { id: "tv",    label: `TV Shows (${tvCount})` },
          ] as { id: Filter; label: string }[]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              style={{
                background: filter === tab.id ? "var(--accent)" : "var(--bg-surface2)",
                border: "1px solid",
                borderColor: filter === tab.id ? "var(--accent)" : "var(--border)",
                borderRadius: 20, padding: "4px 14px",
                color: filter === tab.id ? "var(--text-on-accent)" : "var(--text-secondary)",
                fontSize: 12, fontWeight: filter === tab.id ? 700 : 400, cursor: "pointer",
                fontFamily: "var(--font)", transition: "all 0.15s",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 24px" }}>
        {filtered.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, color: "var(--text-muted)" }}>
            <div style={{ fontSize: 48 }}>📭</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Nothing here yet</div>
            <div style={{ fontSize: 12 }}>Start watching something and it'll show up here.</div>
          </div>
        ) : (
          filtered.map(entry => (
            <HistoryCard
              key={`${entry.kind}-${entry.id}`}
              entry={entry}
              onRemove={() => remove(entry.id, entry.kind)}
            />
          ))
        )}
      </div>
    </div>
  );
}
