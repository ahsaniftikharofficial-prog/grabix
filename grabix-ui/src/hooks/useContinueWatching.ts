// hooks/useContinueWatching.ts — Phase 6 (profile-aware)
// localStorage-backed continue watching read/write/remove logic.
// Shared by the inline ContinueWatching row and the full ContinueWatchingPage.

import { useState, useEffect, useCallback } from "react";
import { useProfile } from "../context/ProfileContext";

const BASE_KEY = "grabix:continue_watching";

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

function load(key: string): WatchEntry[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
}

function save(key: string, entries: WatchEntry[]) {
  localStorage.setItem(key, JSON.stringify(entries));
}

export function useContinueWatching() {
  const { storageKey } = useProfile();
  const key = storageKey(BASE_KEY);

  const [entries, setEntries] = useState<WatchEntry[]>(() =>
    load(key).sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
  );

  // Reload when profile (key) changes
  useEffect(() => {
    setEntries(load(key).sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1)));
  }, [key]);

  // keep in sync across tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) {
        setEntries(load(key).sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1)));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  const upsert = useCallback((entry: Omit<WatchEntry, "updatedAt">) => {
    setEntries((prev) => {
      const next = prev.filter(
        (e) => !(e.id === entry.id && e.kind === entry.kind)
      );
      const updated: WatchEntry = { ...entry, updatedAt: new Date().toISOString() };
      const sorted = [updated, ...next].sort((a, b) =>
        b.updatedAt > a.updatedAt ? 1 : -1
      );
      save(key, sorted);
      return sorted;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const remove = useCallback((id: number, kind: "movie" | "tv") => {
    setEntries((prev) => {
      const next = prev.filter((e) => !(e.id === id && e.kind === kind));
      save(key, next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const clear = useCallback(() => {
    save(key, []);
    setEntries([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { entries, upsert, remove, clear };
}
