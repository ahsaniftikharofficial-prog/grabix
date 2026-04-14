/**
 * useWatchdog — monitors backend health AFTER it has successfully started.
 *
 * KEY FIX: The watchdog will NEVER show an error during initial startup.
 * It only activates once the backend has responded successfully at least once.
 * This prevents the "Backend restart failed" false alarm during PyO3 startup
 * (which can take 15-60 seconds on first launch).
 *
 * States:
 *  idle         → backend healthy (or never connected yet — silent)
 *  reconnecting → was working, now failing 4× in a row → amber banner
 *  reconnected  → came back after being down → green 4s then hides
 *  failed       → stayed down >90s after being confirmed working → red banner
 */
import { useEffect, useRef, useState } from "react";
import { BACKEND_API } from "./api";

export type WatchdogStatus = "idle" | "reconnecting" | "reconnected" | "failed";

export interface WatchdogState {
  status: WatchdogStatus;
  isBannerVisible: boolean;
  /** Call this when a new download is starting — suppresses false crash banners for 20s */
  notifyDownloadStarting: () => void;
}

const POLL_MS               = 5_000;
const PING_TIMEOUT_MS       = 6_000;
const CONSECUTIVE_FAILS     = 4;
const RECONNECT_TIMEOUT_MS  = 90_000;
const BANNER_LINGER_MS      = 4_000;
const INITIAL_POLL_DELAY_MS = 5_000;
/** How long after a download starts to suppress watchdog false positives (aria2 spawn spike) */
const DOWNLOAD_START_GRACE_MS = 20_000;

export function useWatchdog(): WatchdogState {
  const [status, setStatus]           = useState<WatchdogStatus>("idle");
  const [isBannerVisible, setVisible] = useState(false);

  const hasEverConnected  = useRef(false);
  const wasDown           = useRef(false);
  const consecutiveFails  = useRef(0);
  const reconnectStart    = useRef<number | null>(null);
  const lingerTimer       = useRef<number | null>(null);
  const downloadGraceEnd  = useRef<number>(0);

  const notifyDownloadStarting = () => {
    downloadGraceEnd.current = Date.now() + DOWNLOAD_START_GRACE_MS;
  };

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;

    const probe = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`${BACKEND_API}/health/ping`, {
          method: "GET",
          signal: AbortSignal.timeout(PING_TIMEOUT_MS),
          cache:  "no-store",
        });

        if (!res.ok) throw new Error("non-ok");

        consecutiveFails.current = 0;
        hasEverConnected.current = true;

        if (wasDown.current) {
          wasDown.current        = false;
          reconnectStart.current = null;
          if (!cancelled) {
            setStatus("reconnected");
            setVisible(true);
            if (lingerTimer.current !== null) window.clearTimeout(lingerTimer.current);
            lingerTimer.current = window.setTimeout(() => {
              if (!cancelled) { setStatus("idle"); setVisible(false); }
            }, BANNER_LINGER_MS);
          }
        }
      } catch {
        if (cancelled) return;
        consecutiveFails.current += 1;

        if (!hasEverConnected.current) return;
        if (consecutiveFails.current < CONSECUTIVE_FAILS) return;

        // Suppress false positives while aria2 is starting up (causes brief CPU spike)
        if (Date.now() < downloadGraceEnd.current) {
          consecutiveFails.current = 0;
          return;
        }

        if (!wasDown.current) {
          wasDown.current        = true;
          reconnectStart.current = Date.now();
          setStatus("reconnecting");
          setVisible(true);
        } else if (
          reconnectStart.current !== null &&
          Date.now() - reconnectStart.current > RECONNECT_TIMEOUT_MS
        ) {
          setStatus("failed");
          setVisible(true);
        }
      }
    };

    const startTimer = window.setTimeout(() => {
      void probe();
      intervalId = window.setInterval(() => void probe(), POLL_MS);
    }, INITIAL_POLL_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      if (intervalId !== null) window.clearInterval(intervalId);
      if (lingerTimer.current !== null) window.clearTimeout(lingerTimer.current);
    };
  }, []);

  return { status, isBannerVisible, notifyDownloadStarting };
}
