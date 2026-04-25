/**
 * RatingButtons.tsx — Phase 6
 * Thumbs up / Thumbs down / Super like buttons for movie & TV detail modals.
 * Reads/writes from useRatings (per-profile localStorage).
 */

import { useRatings, type UserRating } from "../../hooks/useRatings";

interface Props {
  id: string;
  kind: "movie" | "tv" | "anime";
  title: string;
  poster?: string | null;
  /** Optional: compact layout for tight spaces */
  compact?: boolean;
}

const BUTTONS: { value: NonNullable<UserRating>; emoji: string; label: string; activeColor: string }[] = [
  { value: "super_like",   emoji: "❤️", label: "Love it",      activeColor: "#e11d48" },
  { value: "thumbs_up",   emoji: "👍", label: "Good",          activeColor: "#16a34a" },
  { value: "thumbs_down", emoji: "👎", label: "Not for me",   activeColor: "#6b7280" },
];

export function RatingButtons({ id, kind, title, poster, compact = false }: Props) {
  const { getRating, toggle } = useRatings();
  const current = getRating(id);

  return (
    <div style={{ display: "flex", gap: compact ? 4 : 6, alignItems: "center" }}>
      {!compact && (
        <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 2, whiteSpace: "nowrap" }}>
          Rate it:
        </span>
      )}
      {BUTTONS.map(btn => {
        const active = current === btn.value;
        return (
          <button
            key={btn.value}
            onClick={e => {
              e.stopPropagation();
              toggle(id, kind, title, btn.value, poster);
            }}
            title={btn.label}
            style={{
              background: active ? btn.activeColor : "var(--bg-surface2)",
              border: `1px solid ${active ? btn.activeColor : "var(--border)"}`,
              borderRadius: compact ? 6 : 8,
              padding: compact ? "4px 7px" : "5px 10px",
              cursor: "pointer",
              fontSize: compact ? 14 : 16,
              lineHeight: 1,
              transition: "all 0.15s ease",
              transform: active ? "scale(1.12)" : "scale(1)",
              boxShadow: active ? "0 0 8px rgba(0,0,0,0.25)" : "none",
            }}
          >
            {btn.emoji}
          </button>
        );
      })}
    </div>
  );
}

/** Inline display of what the user rated — shows one emoji + label */
export function RatingBadge({ id }: { id: string }) {
  const { getRating } = useRatings();
  const r = getRating(id);
  if (!r) return null;

  const btn = BUTTONS.find(b => b.value === r);
  if (!btn) return null;

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11,
      color: btn.activeColor, fontWeight: 600,
    }}>
      {btn.emoji} {btn.label}
    </span>
  );
}
