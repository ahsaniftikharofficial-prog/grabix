// components/player/NextEpisodeCountdown.tsx
// Shows a 5-second countdown bar near the end of an episode.
// When it reaches zero it fires onNext(); the user can cancel it.
import { useEffect, useRef, useState } from "react";

interface Props {
  /** Current playback time in seconds */
  currentTime: number;
  /** Total duration in seconds */
  duration: number;
  /** How many seconds before the end to start showing the countdown */
  triggerBeforeEnd?: number;
  /** The title of the next episode */
  nextEpisodeLabel?: string;
  /** Called when the countdown completes or the user clicks Play Next */
  onNext: () => void;
}

const COUNTDOWN_SECS = 5;

export function NextEpisodeCountdown({
  currentTime,
  duration,
  triggerBeforeEnd = 30,
  nextEpisodeLabel = "Next Episode",
  onNext,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [remaining, setRemaining] = useState(COUNTDOWN_SECS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firedRef = useRef(false);

  const timeLeft = duration > 0 ? duration - currentTime : Infinity;
  const shouldShow = duration > 0 && timeLeft <= triggerBeforeEnd && timeLeft > 0 && !cancelled;

  // Show/hide
  useEffect(() => {
    if (shouldShow && !visible) {
      setVisible(true);
      setRemaining(COUNTDOWN_SECS);
      firedRef.current = false;
    } else if (!shouldShow && visible) {
      setVisible(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [shouldShow, visible]);

  // Countdown tick
  useEffect(() => {
    if (!visible || cancelled) return;

    timerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (!firedRef.current) {
            firedRef.current = true;
            onNext();
          }
          return 0;
        }
        return r - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [visible, cancelled, onNext]);

  if (!visible) return null;

  const progress = ((COUNTDOWN_SECS - remaining) / COUNTDOWN_SECS) * 100;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 90,
        right: 24,
        zIndex: 40,
        background: "rgba(0,0,0,0.8)",
        border: "1px solid rgba(255,255,255,0.2)",
        borderRadius: 8,
        padding: "14px 18px",
        width: 240,
        backdropFilter: "blur(8px)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        animation: "gx-skip-fadein 0.3s ease",
      }}
    >
      {/* Label */}
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        Up Next
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {nextEpisodeLabel}
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: "rgba(255,255,255,0.18)", borderRadius: 2, marginBottom: 12, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: "var(--accent, #e11d48)",
            borderRadius: 2,
            transition: "width 0.9s linear",
          }}
        />
      </div>

      {/* Buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onNext}
          style={{
            flex: 1,
            background: "#fff",
            color: "#000",
            border: "none",
            borderRadius: 4,
            padding: "7px 0",
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Play ({remaining}s)
        </button>
        <button
          onClick={() => { setCancelled(true); setVisible(false); }}
          style={{
            flex: 1,
            background: "rgba(255,255,255,0.12)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 4,
            padding: "7px 0",
            fontWeight: 600,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
