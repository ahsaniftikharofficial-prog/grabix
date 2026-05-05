/**
 * OfflineBanner — Modern floating status pill.
 * Shows "Backend starting… (Xs)" with a live elapsed counter so users
 * know something is happening and roughly how long to expect.
 */
import { useEffect, useState } from "react";
import type { OfflineState } from "../lib/useOfflineDetection";

interface Props {
  offlineState: OfflineState;
}

export function OfflineBanner({ offlineState }: Props) {
  const [visible, setVisible] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Show/hide the pill with a small delay to avoid flashing on fast reconnects.
  useEffect(() => {
    if (offlineState.isOffline) {
      const t = window.setTimeout(() => setVisible(true), 400);
      return () => window.clearTimeout(t);
    } else {
      setVisible(false);
      setElapsedSeconds(0);
    }
  }, [offlineState.isOffline]);

  // Tick up a seconds counter while the banner is visible.
  // Only active when the banner is showing — stops as soon as backend is ready.
  useEffect(() => {
    if (!visible) return;
    setElapsedSeconds(0);
    const t = window.setInterval(() => {
      setElapsedSeconds(s => s + 1);
    }, 1000);
    return () => window.clearInterval(t);
  }, [visible]);

  if (!offlineState.isOffline && !visible) return null;

  const isNetwork = offlineState.reason === "network";
  const accent = isNetwork ? "#e87c3e" : "#8b5cf6";

  // For backend starting: show elapsed time + a hint after 10 seconds.
  const backendLabel = elapsedSeconds < 10
    ? `Backend starting… (${elapsedSeconds}s)`
    : `Backend starting… (${elapsedSeconds}s — first launch takes ~20s)`;

  const label = isNetwork ? "No internet connection" : backendLabel;
  const icon = isNetwork ? "📶" : "⏳";

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        style={{
          position: "fixed",
          bottom: 18,
          right: 18,
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          gap: 7,
          background: "rgba(18, 18, 24, 0.88)",
          border: `1px solid ${accent}44`,
          borderRadius: 999,
          padding: "7px 14px 7px 10px",
          color: "#fff",
          fontSize: "0.75rem",
          fontWeight: 500,
          letterSpacing: "0.01em",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          boxShadow: `0 4px 24px rgba(0,0,0,0.35), 0 0 0 1px ${accent}22`,
          userSelect: "none",
          pointerEvents: "none",
          animation: `${offlineState.isOffline ? "grabix-pill-in" : "grabix-pill-out"} 0.22s ease forwards`,
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: accent, flexShrink: 0,
          boxShadow: `0 0 6px ${accent}`,
        }} />
        <span style={{ fontSize: "0.85rem", lineHeight: 1 }}>{icon}</span>
        <span style={{ color: "rgba(255,255,255,0.85)" }}>{label}</span>
      </div>
    </>
  );
}
