// components/tv/TVRow.tsx — horizontal scrollable row for TV shows
import { useRef } from "react";
import { IconChevronLeft, IconChevronRight } from "../Icons";
import { TVCard, type Show } from "./TVCard";

interface TVRowProps {
  title: string;
  shows: Show[];
  onSelect: (s: Show) => void;
}

export function TVRow({ title, shows, onSelect }: TVRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => rowRef.current?.scrollBy({ left: dir * 600, behavior: "smooth" });

  if (shows.length === 0) return null;

  return (
    <div>
      <div style={{
        fontSize: 14, fontWeight: 700, marginBottom: 10,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        {title}
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button
            onClick={() => scroll(-1)}
            style={{
              background: "var(--bg-surface2)", border: "none", borderRadius: "50%",
              width: 28, height: 28, display: "flex", alignItems: "center",
              justifyContent: "center", cursor: "pointer", color: "var(--text-secondary)",
            }}
          >
            <IconChevronLeft size={14} />
          </button>
          <button
            onClick={() => scroll(1)}
            style={{
              background: "var(--bg-surface2)", border: "none", borderRadius: "50%",
              width: 28, height: 28, display: "flex", alignItems: "center",
              justifyContent: "center", cursor: "pointer", color: "var(--text-secondary)",
            }}
          >
            <IconChevronRight size={14} />
          </button>
        </div>
      </div>
      <div
        ref={rowRef}
        style={{
          display: "flex", gap: 10, overflowX: "auto",
          paddingBottom: 8, scrollbarWidth: "none",
        }}
      >
        {shows.slice(0, 30).map(s => (
          <TVCard key={s.id} show={s} onClick={() => onSelect(s)} />
        ))}
      </div>
    </div>
  );
}
