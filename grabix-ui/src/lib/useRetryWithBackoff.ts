/**
 * Phase 5 — Exponential backoff retry hook
 * Delays: 2s → 4s → 8s (then stays at 8s for further retries)
 * Stops hammering rate-limited APIs.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface RetryState {
  /** How many retries have been attempted so far */
  attempt: number;
  /** Seconds until the next retry fires (null = not in countdown) */
  countdown: number | null;
  /** True while a scheduled retry is pending */
  isPending: boolean;
}

export interface UseRetryWithBackoffOptions {
  /** Called on each attempt (including immediate manual retries) */
  onRetry: () => void | Promise<void>;
  /** Maximum number of automatic retries before giving up (default 3) */
  maxAttempts?: number;
  /** Base delay in ms — doubles each attempt: base, base*2, base*4, … (default 2000) */
  baseDelayMs?: number;
}

export interface UseRetryWithBackoffReturn {
  retryState: RetryState;
  /** Fire a manual retry immediately (resets countdown if one was pending) */
  triggerRetry: () => void;
  /** Cancel any pending countdown */
  cancel: () => void;
  /** Schedule the next automatic retry (call this on error) */
  scheduleRetry: () => void;
  /** Reset all state back to initial */
  reset: () => void;
}

export function useRetryWithBackoff({
  onRetry,
  maxAttempts = 3,
  baseDelayMs = 2000,
}: UseRetryWithBackoffOptions): UseRetryWithBackoffReturn {
  const [retryState, setRetryState] = useState<RetryState>({
    attempt: 0,
    countdown: null,
    isPending: false,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptRef = useRef(0);
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

  const clearTimers = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearTimers();
    setRetryState((prev) => ({ ...prev, countdown: null, isPending: false }));
  }, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    attemptRef.current = 0;
    setRetryState({ attempt: 0, countdown: null, isPending: false });
  }, [clearTimers]);

  const triggerRetry = useCallback(() => {
    clearTimers();
    setRetryState((prev) => ({
      attempt: prev.attempt + 1,
      countdown: null,
      isPending: false,
    }));
    attemptRef.current += 1;
    void onRetryRef.current();
  }, [clearTimers]);

  const scheduleRetry = useCallback(() => {
    if (attemptRef.current >= maxAttempts) return;

    clearTimers();
    const delayMs = baseDelayMs * Math.pow(2, attemptRef.current); // 2s, 4s, 8s
    const delaySec = Math.round(delayMs / 1000);

    setRetryState((prev) => ({
      ...prev,
      countdown: delaySec,
      isPending: true,
    }));

    // Tick countdown every second
    let remaining = delaySec;
    tickRef.current = setInterval(() => {
      remaining -= 1;
      setRetryState((prev) => ({ ...prev, countdown: remaining > 0 ? remaining : null }));
      if (remaining <= 0) {
        clearInterval(tickRef.current!);
        tickRef.current = null;
      }
    }, 1000);

    // Fire the retry after delay
    timerRef.current = setTimeout(() => {
      clearTimers();
      attemptRef.current += 1;
      setRetryState((prev) => ({
        attempt: prev.attempt + 1,
        countdown: null,
        isPending: false,
      }));
      void onRetryRef.current();
    }, delayMs);
  }, [clearTimers, maxAttempts, baseDelayMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  return { retryState, triggerRetry, cancel, scheduleRetry, reset };
}
