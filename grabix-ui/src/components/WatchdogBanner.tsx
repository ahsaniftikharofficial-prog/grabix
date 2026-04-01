/**
 * Phase 7 — Watchdog Banner
 * Displays a slim top banner when the Rust watchdog supervisor detects that
 * the Python backend has crashed and is being (or has been) restarted.
 *
 * Three states:
 *  reconnecting → amber pulsing bar   "Backend crashed — reconnecting…"
 *  reconnected  → green bar (3 s)     "Backend restarted — you're back!"
 *  failed       → red bar (12 s)      "Backend restart failed — please restart GRABIX"
 */
import { useEffect, useState } from "react";
import type { WatchdogStatus } from "../lib/useWatchdog";

interface WatchdogBannerProps {
  status: WatchdogStatus;
  isBannerVisible: boolean;
}

const CONFIG: Record<
  Exclude<WatchdogStatus, "idle">,
  { bg: string; label: string; icon: string; pulse: boolean }
> = {
  reconnecting: {
    bg: "rgba(200, 140, 20, 0.93)",
    label: "Backend crashed — reconnecting\u2026",
    icon: "⚙️",
    pulse: true,
  },
  reconnected: {
    bg: "rgba(34, 160, 80, 0.93)",
    label: "Backend restarted — you're back!",
    icon: "✅",
    pulse: false,
  },
  failed: {
    bg: "rgba(200, 40, 40, 0.93)",
    label: "Backend restart failed — please restart GRABIX",
    icon: "❌",
    pulse: false,
  },
};

export function WatchdogBanner({ status, isBannerVisible }: WatchdogBannerProps) {
  const [opacity, setOpacity] = useState(0);

  // Fade in/out
  useEffect(() => {
    if (isBannerVisible && status !== "idle") {
      const raf = requestAnimationFrame(() => setOpacity(1));
      return () => cancelAnimationFrame(raf);
    } else {
      setOpacity(0);
    }
  }, [isBannerVisible, status]);

  if (!isBannerVisible || status === "idle") return null;

  const cfg = CONFIG[status];

  return (
    <>
      {cfg.pulse && (
        <style>{`
          @keyframes grabix-watchdog-pulse {
            0%, 100% { opacity: 1; }
            50%       { opacity: 0.65; }
          }
        `}</style>
      )}
      <div
        role="status"
        aria-live="assertive"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10000, // one layer above OfflineBanner (9999)
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          background: cfg.bg,
          color: "#fff",
          fontSize: "0.78rem",
          fontWeight: 500,
          letterSpacing: "0.01em",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.28)",
          userSelect: "none",
          pointerEvents: "none",
          opacity,
          transition: "opacity 0.25s ease",
          animation: cfg.pulse ? "grabix-watchdog-pulse 1.5s ease-in-out infinite" : undefined,
        }}
      >
        <span style={{ fontSize: "0.85rem" }}>{cfg.icon}</span>
        {cfg.label}
      </div>
    </>
  );
}
