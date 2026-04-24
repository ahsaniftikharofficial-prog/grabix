// components/shared/BadgeOverlay.tsx — smart badge system for movie and TV cards
// Renders zero or more overlay pills based on content metadata.
// All badges are absolutely positioned inside the card's poster area.

const BADGE_BASE: React.CSSProperties = {
  position: "absolute",
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: "0.04em",
  padding: "2px 6px",
  borderRadius: 5,
  lineHeight: 1.5,
  pointerEvents: "none",
  textTransform: "uppercase",
};

/** Returns true if a date string is within the last `days` days */
function isRecent(dateStr: string | undefined | null, days: number): boolean {
  if (!dateStr) return false;
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  const diff = now - then;
  return diff >= 0 && diff <= days * 86_400_000;
}

// ─── Movie badges ──────────────────────────────────────────────────────────────

export interface MovieBadgeProps {
  releaseDate?: string | null;
  /** Stack position for top-left badges (0 = first) */
}

export function MovieBadgeOverlay({ releaseDate }: MovieBadgeProps) {
  const isNew = isRecent(releaseDate, 60);
  if (!isNew) return null;

  return (
    <div
      style={{
        ...BADGE_BASE,
        top: 6,
        left: 6,
        background: "linear-gradient(135deg, #ff6b35, #e50914)",
        color: "white",
        boxShadow: "0 2px 8px rgba(229,9,20,0.5)",
      }}
    >
      New
    </div>
  );
}

// ─── TV badges ─────────────────────────────────────────────────────────────────

export interface TVBadgeProps {
  firstAirDate?: string | null;
  lastAirDate?: string | null;
  status?: string;
  numberOfSeasons?: number;
  numberOfEpisodes?: number;
  /** If the show just started a new season (inferred from status + lastAirDate) */
}

export function TVBadgeOverlay({
  firstAirDate,
  lastAirDate,
  status,
  numberOfSeasons,
  numberOfEpisodes,
}: TVBadgeProps) {
  const isNewSeries   = isRecent(firstAirDate, 60);
  const hasNewEp      = isRecent(lastAirDate, 14);
  const hasNewSeason  = isRecent(lastAirDate, 30) && (numberOfSeasons ?? 0) > 1;
  const isAiringNow   = status === "Returning Series";

  // Pick one top-left badge — priority: new series > new season > new episode > airing now
  let topLeft: { label: string; bg: string } | null = null;
  if (isNewSeries)       topLeft = { label: "New", bg: "linear-gradient(135deg,#ff6b35,#e50914)" };
  else if (hasNewSeason) topLeft = { label: "New Season", bg: "linear-gradient(135deg,#7c3aed,#4f46e5)" };
  else if (hasNewEp)     topLeft = { label: "New Ep", bg: "linear-gradient(135deg,#0ea5e9,#2563eb)" };
  else if (isAiringNow)  topLeft = { label: "Airing", bg: "linear-gradient(135deg,#16a34a,#15803d)" };

  // Season + episode count — bottom-left
  const hasMeta = (numberOfSeasons ?? 0) > 0 && (numberOfEpisodes ?? 0) > 0;

  return (
    <>
      {topLeft && (
        <div
          style={{
            ...BADGE_BASE,
            top: 6,
            left: 6,
            background: topLeft.bg,
            color: "white",
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          }}
        >
          {topLeft.label}
        </div>
      )}

      {hasMeta && (
        <div
          style={{
            ...BADGE_BASE,
            bottom: 6,
            left: 6,
            background: "rgba(0,0,0,0.72)",
            color: "rgba(255,255,255,0.85)",
            backdropFilter: "blur(4px)",
          }}
        >
          S{numberOfSeasons} · {numberOfEpisodes} eps
        </div>
      )}
    </>
  );
}
