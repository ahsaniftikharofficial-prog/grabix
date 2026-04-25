// components/player/SkipButton.tsx
// Netflix-style Skip Intro / Skip Recap button.
// Shown at a configurable timestamp; offset stored per show in localStorage.
import { useEffect, useState } from "react";

export type SkipKind = "intro" | "recap";

interface Props {
  kind: SkipKind;
  /** Current playback time in seconds */
  currentTime: number;
  /** Total duration in seconds */
  duration: number;
  /** The timestamp (seconds) at which the button appears */
  showAt: number;
  /** The timestamp (seconds) to seek to when clicked */
  skipTo: number;
  /** Called when the user clicks Skip */
  onSkip: (to: number) => void;
  /** Storage key prefix — use show ID or movie ID so settings persist per title */
  storageKey?: string;
}

const VISIBLE_WINDOW = 90; // seconds the button remains on screen after showAt

export function SkipButton({ kind, currentTime, duration, showAt, skipTo, onSkip, storageKey }: Props) {
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissed state when the kind/key changes
  useEffect(() => { setDismissed(false); }, [kind, storageKey]);

  const isVisible =
    !dismissed &&
    duration > 0 &&
    currentTime >= showAt &&
    currentTime <= showAt + VISIBLE_WINDOW &&
    currentTime < skipTo;

  if (!isVisible) return null;

  const label = kind === "intro" ? "Skip Intro" : "Skip Recap";

  const handleClick = () => {
    onSkip(skipTo);
    setDismissed(true);
  };

  return (
    <button
      onClick={handleClick}
      style={{
        position: "absolute",
        bottom: 90,
        right: 24,
        zIndex: 40,
        background: "rgba(0,0,0,0.75)",
        border: "2px solid rgba(255,255,255,0.85)",
        borderRadius: 4,
        color: "#fff",
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: "0.04em",
        padding: "9px 22px",
        cursor: "pointer",
        backdropFilter: "blur(6px)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        transition: "background 0.15s, transform 0.1s",
        animation: "gx-skip-fadein 0.25s ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.18)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,0,0,0.75)";
      }}
    >
      {label}
    </button>
  );
}

/**
 * Persists skip timestamps for a title to localStorage.
 * Returns { introEnd, recapEnd } in seconds.
 */
export function loadSkipPoints(storageKey: string): { introEnd: number; recapEnd: number } {
  try {
    const raw = localStorage.getItem(`gx:skip:${storageKey}`);
    if (!raw) return { introEnd: 0, recapEnd: 0 };
    return JSON.parse(raw) as { introEnd: number; recapEnd: number };
  } catch {
    return { introEnd: 0, recapEnd: 0 };
  }
}

export function saveSkipPoints(
  storageKey: string,
  points: Partial<{ introEnd: number; recapEnd: number }>
) {
  try {
    const existing = loadSkipPoints(storageKey);
    localStorage.setItem(`gx:skip:${storageKey}`, JSON.stringify({ ...existing, ...points }));
  } catch {}
}
