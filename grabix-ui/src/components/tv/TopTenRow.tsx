// components/tv/TopTenRow.tsx — Top 10 row for TV shows with bold rank numbers
// Netflix-style: large rank number peeks behind the left edge of the poster.

import { useRef } from "react";
import { IconChevronLeft, IconChevronRight } from "../Icons";
import { TMDB_IMAGE_BASE as IMG_BASE } from "../../lib/tmdb";
import type { Show } from "./TVCard";

const IMG = (p: string | null | undefined) => (p ? `${IMG_BASE}${p}` : "");

interface TopTenRowProps {
  title?: string;
  shows: Show[];
  onSelect: (s: Show) => void;
}

function RankedCard({ show: s, rank, onClick }: { show: Show; rank: number; onClick: () => void }) {
  const poster = IMG(s.poster_path);

  return (
    <div
      style={{ flexShrink: 0, display: "flex", alignItems: "flex-end", cursor: "pointer", marginLeft: rank === 1 ? 0 : -14 }}
      onClick={onClick}
    >
      {/* Big rank number */}
      <div
        style={{
          fontSize: 96,
          fontWeight: 900,
          lineHeight: 1,
          color: "transparent",
          WebkitTextStroke: "2px var(--text-muted)",
          userSelect: "none",
          flexShrink: 0,
          width: 64,
          textAlign: "right",
          paddingBottom: 4,
          zIndex: 1,
          filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.6))",
        }}
      >
        {rank}
      </div>

      {/* Poster card */}
      <div
        style={{
          flexShrink: 0,
          width: 110,
          borderRadius: 10,
          overflow: "hidden",
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          zIndex: 2,
          transition: "transform 0.15s, box-shadow 0.15s",
          position: "relative",
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLDivElement).style.transform = "scale(1.06)";
          (e.currentTarget as HTMLDivElement).style.boxShadow = "var(--shadow-lg)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLDivElement).style.transform = "scale(1)";
          (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
        }}
      >
        {poster ? (
          <img src={poster} alt={s.name} style={{ width: "100%", height: 165, objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ width: "100%", height: 165, background: "var(--bg-surface2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--text-muted)" }}>
            No Image
          </div>
        )}
        {s.vote_average > 0 && (
          <div style={{ position: "absolute", top: 5, right: 5, background: "rgba(0,0,0,0.75)", color: "#fdd663", fontSize: 9, padding: "2px 5px", borderRadius: 5, fontWeight: 700 }}>
            ★ {s.vote_average.toFixed(1)}
          </div>
        )}
        {s.status === "Returning Series" && (
          <div style={{ position: "absolute", top: 5, left: 5, background: "var(--text-success, #16a34a)", color: "white", fontSize: 9, padding: "2px 5px", borderRadius: 5, fontWeight: 700 }}>
            LIVE
          </div>
        )}
        <div style={{ padding: "6px 8px 8px" }}>
          <div style={{ fontSize: 10, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {s.name}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TopTenRow({ title = "🏆 Top 10 This Week", shows, onSelect }: TopTenRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => rowRef.current?.scrollBy({ left: dir * 560, behavior: "smooth" });

  const top10 = shows.slice(0, 10);
  if (top10.length === 0) return null;

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
        {title}
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button
            onClick={() => scroll(-1)}
            style={{ background: "var(--bg-surface2)", border: "none", borderRadius: "50%", width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-secondary)" }}
          >
            <IconChevronLeft size={14} />
          </button>
          <button
            onClick={() => scroll(1)}
            style={{ background: "var(--bg-surface2)", border: "none", borderRadius: "50%", width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-secondary)" }}
          >
            <IconChevronRight size={14} />
          </button>
        </div>
      </div>

      <div
        ref={rowRef}
        style={{ display: "flex", gap: 0, overflowX: "auto", paddingBottom: 8, scrollbarWidth: "none", alignItems: "flex-end" }}
      >
        {top10.map((s, i) => (
          <RankedCard key={s.id} show={s} rank={i + 1} onClick={() => onSelect(s)} />
        ))}
      </div>
    </div>
  );
}
