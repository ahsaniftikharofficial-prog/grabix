// hooks/useContinueWatching.ts — Phase 3
// localStorage-backed continue watching read/write/remove logic.
// Shared by the inline ContinueWatching row and the full ContinueWatchingPage.

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "grabix:continue_watching";

export interface WatchEntry {
  id: number;
  kind: "movie" | "tv";
  title: string;
  poster_path: string | null;
  backdrop_path?: string | null;
  /** 0–100 */
  progress: number;
  /** TV only */
  season?: number;
  episode?: number;
  /** ISO timestamp of last watch */
  updatedAt: string;
}

function load(): WatchEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function save(entries: WatchEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function useContinueWatching() {
  const [entries, setEntries] = useState<WatchEntry[]>(() =>
    load().sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
  );

  // keep in sync across tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setEntries(load().sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1)));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const upsert = useCallback((entry: Omit<WatchEntry, "updatedAt">) => {
    setEntries((prev) => {
      const next = prev.filter(
        (e) => !(e.id === entry.id && e.kind === entry.kind)
      );
      const updated: WatchEntry = { ...entry, updatedAt: new Date().toISOString() };
      const sorted = [updated, ...next].sort((a, b) =>
        b.updatedAt > a.updatedAt ? 1 : -1
      );
      save(sorted);
      return sorted;
    });
  }, []);

  const remove = useCallback((id: number, kind: "movie" | "tv") => {
    setEntries((prev) => {
      const next = prev.filter((e) => !(e.id === id && e.kind === kind));
      save(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    save([]);
    setEntries([]);
  }, []);

  return { entries, upsert, remove, clear };
}
