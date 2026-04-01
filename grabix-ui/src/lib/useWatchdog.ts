/**
 * useWatchdog — polls the backend /ping endpoint to detect crashes and restarts.
 * Drives the WatchdogBanner: amber while reconnecting, green on recovery, red on timeout.
 *
 * States:
 *  idle         → backend is up, nothing to show
 *  reconnecting → /ping is failing, banner pulses amber
 *  reconnected  → backend came back after being down, banner shows green for 3 s then hides
 *  failed       → backend stayed down for >30 s, banner shows red permanently
 */
import { useEffect, useRef, useState } from "react";
import { BACKEND_API } from "./api";

export type WatchdogStatus = "idle" | "reconnecting" | "reconnected" | "failed";

export interface WatchdogState {
  status: WatchdogStatus;
  isBannerVisible: boolean;
}

const POLL_MS = 3_000;
const RECONNECT_TIMEOUT_MS = 30_000;
const BANNER_LINGER_MS = 3_000;

export function useWatchdog(): WatchdogState {
  const [status, setStatus] = useState<WatchdogStatus>("idle");
  const [isBannerVisible, setIsBannerVisible] = useState(false);

  const wasDown = useRef(false);
  const reconnectStart = useRef<number | null>(null);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const probe = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`${BACKEND_API}/ping`, {
          method: "GET",
          signal: AbortSignal.timeout(2500),
          cache: "no-store",
        });

        if (!res.ok) throw new Error("non-ok");

        // Backend is up
        if (wasDown.current) {
          // Just recovered from a crash
          wasDown.current = false;
          reconnectStart.current = null;
          if (!cancelled) {
            setStatus("reconnected");
            setIsBannerVisible(true);
            if (lingerTimer.current) clearTimeout(lingerTimer.current);
            lingerTimer.current = setTimeout(() => {
              if (!cancelled) {
                setStatus("idle");
                setIsBannerVisible(false);
              }
            }, BANNER_LINGER_MS);
          }
        }
        // else: all good, stay idle — no state change needed
      } catch {
        if (cancelled) return;

        if (!wasDown.current) {
          // First failure — start reconnecting
          wasDown.current = true;
          reconnectStart.current = Date.now();
          setStatus("reconnecting");
          setIsBannerVisible(true);
        } else if (
          reconnectStart.current !== null &&
          Date.now() - reconnectStart.current > RECONNECT_TIMEOUT_MS
        ) {
          // Timed out — backend restart failed
          setStatus("failed");
          setIsBannerVisible(true);
        }
        // else: still reconnecting, keep banner as-is
      }
    };

    // Start polling after a short delay (let the app fully mount first)
    const startTimer = setTimeout(() => {
      void probe();
      const interval = setInterval(() => void probe(), POLL_MS);
      // Store interval id so cleanup can clear it
      (startTimer as unknown as { _interval: ReturnType<typeof setInterval> })._interval = interval;
    }, 2000);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      const interval = (startTimer as unknown as { _interval?: ReturnType<typeof setInterval> })._interval;
      if (interval !== undefined) clearInterval(interval);
      if (lingerTimer.current) clearTimeout(lingerTimer.current);
    };
  }, []);

  return { status, isBannerVisible };
}
