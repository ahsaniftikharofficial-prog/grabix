/**
 * OfflineBanner — Modern floating status pill.
 * Replaces the 2011-era full-width top bar with a subtle animated
 * pill that slides up from the bottom-right. Only visible after the
 * app has finished bootstrapping (suppressed via offlineState.isOffline = false).
 */
import { useEffect, useState } from "react";
import type { OfflineState } from "../lib/useOfflineDetection";

interface Props {
  offlineState: OfflineState;
}

export function OfflineBanner({ offlineState }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (offlineState.isOffline) {
      const t = window.setTimeout(() => setVisible(true), 400);
      return () => window.clearTimeout(t);
    } else {
      setVisible(false);
    }
  }, [offlineState.isOffline]);

  if (!offlineState.isOffline && !visible) return null;

  const isNetwork = offlineState.reason === "network";
  const label = isNetwork ? "No internet connection" : "Backend starting\u2026";
  const icon = isNetwork ? "📶" : "⏳";
  const accent = isNetwork ? "#e87c3e" : "#8b5cf6";

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
