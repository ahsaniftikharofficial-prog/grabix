/**
 * useWatchdog — polls the backend /health/ping endpoint to detect crashes and restarts.
 * Drives the WatchdogBanner: amber while reconnecting, green on recovery, red on timeout.
 *
 * States:
 *  idle         → backend is up, nothing to show
 *  reconnecting → /health/ping failing 3× in a row, banner pulses amber
 *  reconnected  → backend came back after being down, banner shows green for 3 s then hides
 *  failed       → backend stayed down for >30 s, banner shows red permanently
 *
 * FIX: Requires 3 consecutive failures (not 1) before showing the banner,
 *      and uses a 5s timeout instead of 2.5s to avoid false alerts during
 *      brief SQLite lock or heavy API calls.
 */
import { useEffect, useRef, useState } from "react";
import { BACKEND_API } from "./api";

export type WatchdogStatus = "idle" | "reconnecting" | "reconnected" | "failed";

export interface WatchdogState {
  status: WatchdogStatus;
  isBannerVisible: boolean;
}

const POLL_MS = 4_000;               // poll every 4s (was 3s)
const PING_TIMEOUT_MS = 5_000;       // wait up to 5s per ping (was 2.5s)
const CONSECUTIVE_FAILS_NEEDED = 3;  // require 3 failures in a row before alerting
const RECONNECT_TIMEOUT_MS = 30_000;
const BANNER_LINGER_MS = 3_000;

export function useWatchdog(): WatchdogState {
  const [status, setStatus] = useState<WatchdogStatus>("idle");
  const [isBannerVisible, setIsBannerVisible] = useState(false);

  const wasDown = useRef(false);
  const consecutiveFails = useRef(0);
  const reconnectStart = useRef<number | null>(null);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const probe = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`${BACKEND_API}/health/ping`, {
          method: "GET",
          signal: AbortSignal.timeout(PING_TIMEOUT_MS),
          cache: "no-store",
        });

        if (!res.ok) throw new Error("non-ok");

        // Success — reset failure counter
        consecutiveFails.current = 0;

        if (wasDown.current) {
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
      } catch {
        if (cancelled) return;

        consecutiveFails.current += 1;

        // Only react after CONSECUTIVE_FAILS_NEEDED failures in a row
        if (consecutiveFails.current < CONSECUTIVE_FAILS_NEEDED) {
          return; // transient hiccup — ignore
        }

        if (!wasDown.current) {
          wasDown.current = true;
          reconnectStart.current = Date.now();
          setStatus("reconnecting");
          setIsBannerVisible(true);
        } else if (
          reconnectStart.current !== null &&
          Date.now() - reconnectStart.current > RECONNECT_TIMEOUT_MS
        ) {
          setStatus("failed");
          setIsBannerVisible(true);
        }
      }
    };

    const startTimer = setTimeout(() => {
      void probe();
      const interval = setInterval(() => void probe(), POLL_MS);
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
