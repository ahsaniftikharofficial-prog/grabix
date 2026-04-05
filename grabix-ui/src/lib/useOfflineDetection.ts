/**
 * Phase 5 — Offline detection hook
 * Listens to browser online/offline events and also periodically probes
 * the backend to distinguish "device offline" from "backend down".
 */
import { useEffect, useRef, useState } from "react";

export type OfflineReason = "network" | "backend" | null;

export interface OfflineState {
  isOffline: boolean;
  reason: OfflineReason;
  /** ISO timestamp of when we went offline, or null if online */
  since: string | null;
}

const BACKEND_PING_TIMEOUT_MS = 3500;
const BACKEND_FAILURE_THRESHOLD = 4;
const BACKEND_PROBE_INTERVAL_MS = 15000;

/**
 * Returns real-time online/offline state for GRABIX.
 *
 * - `isOffline = false`  → all good
 * - `reason = "network"` → device has no internet
 * - `reason = "backend"` → device is online but Python backend is unreachable
 */
export function useOfflineDetection(backendPingUrl: string): OfflineState {
  const [state, setState] = useState<OfflineState>(() => ({
    isOffline: !navigator.onLine,
    reason: !navigator.onLine ? "network" : null,
    since: !navigator.onLine ? new Date().toISOString() : null,
  }));

  const sinceRef = useRef<string | null>(state.since);
  const backendFailureCountRef = useRef(0);
  const hasEverConnectedRef = useRef(false);

  const markOffline = (reason: OfflineReason) => {
    const since = sinceRef.current ?? new Date().toISOString();
    sinceRef.current = since;
    setState({ isOffline: true, reason, since });
  };

  const markOnline = () => {
    backendFailureCountRef.current = 0;
    hasEverConnectedRef.current = true;
    sinceRef.current = null;
    setState({ isOffline: false, reason: null, since: null });
  };

  useEffect(() => {
    // ── Browser network events ──────────────────────────────────────────
    const handleOnline = () => {
      // Browser says we're back — do a quick backend probe before clearing
      void probBackend();
    };
    const handleOffline = () => {
      backendFailureCountRef.current = 0;
      markOffline("network");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // ── Periodic backend probe ──────────────────────────────────────────
    const probBackend = async () => {
      if (!navigator.onLine) {
        markOffline("network");
        return;
      }
      try {
        const res = await fetch(`${backendPingUrl}/health/ping`, {
          method: "GET",
          signal: AbortSignal.timeout(BACKEND_PING_TIMEOUT_MS),
          cache: "no-store",
        });
        if (res.ok) {
          markOnline();
        } else {
          if (!hasEverConnectedRef.current) {
            return;
          }
          backendFailureCountRef.current += 1;
          if (backendFailureCountRef.current >= BACKEND_FAILURE_THRESHOLD) {
            markOffline("backend");
          }
        }
      } catch {
        // fetch threw — either network or backend down
        if (!navigator.onLine) {
          backendFailureCountRef.current = 0;
          markOffline("network");
        } else {
          if (!hasEverConnectedRef.current) {
            return;
          }
          backendFailureCountRef.current += 1;
          if (backendFailureCountRef.current >= BACKEND_FAILURE_THRESHOLD) {
            markOffline("backend");
          }
        }
      }
    };

    // Probe immediately, then every 15 seconds
    void probBackend();
    const probeInterval = window.setInterval(() => void probBackend(), BACKEND_PROBE_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(probeInterval);
    };
  }, [backendPingUrl]);

  return state;
}
