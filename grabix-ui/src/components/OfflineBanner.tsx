/**
 * Phase 5 — Offline Banner
 * Shows a slim banner at the top of main when the device/backend is offline.
 * Displays cached content note so the user knows what they're seeing.
 */
import type { OfflineState } from "../lib/useOfflineDetection";

export function OfflineBanner({ offlineState }: { offlineState: OfflineState }) {
  if (!offlineState.isOffline) return null;

  const isNetwork = offlineState.reason === "network";
  const label = isNetwork
    ? "You're offline — showing saved content"
    : "Backend unreachable — showing cached content";

  const icon = isNetwork ? "📶" : "🔌";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: isNetwork
          ? "rgba(220, 100, 40, 0.92)"
          : "rgba(160, 60, 200, 0.92)",
        color: "#fff",
        fontSize: "0.78rem",
        fontWeight: 500,
        letterSpacing: "0.01em",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        userSelect: "none",
        pointerEvents: "none",
      }}
    >
      <span style={{ fontSize: "0.85rem" }}>{icon}</span>
      {label}
    </div>
  );
}
