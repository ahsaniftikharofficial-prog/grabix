/**
 * useRatings.ts — Phase 6
 * Per-profile thumbs up / thumbs down / super like rating.
 * Stored in localStorage under a profile-namespaced key.
 */

import { useState, useCallback, useMemo } from "react";
import { useProfile } from "../context/ProfileContext";
import { readJsonStorage, writeJsonStorage } from "../lib/persistentState";

export type UserRating = "thumbs_up" | "thumbs_down" | "super_like" | null;

interface RatingEntry {
  id: string;
  kind: "movie" | "tv" | "anime";
  title: string;
  poster?: string | null;
  rating: UserRating;
  ratedAt: string;
}

const BASE_KEY = "grabix:ratings:v1";

function load(key: string): RatingEntry[] {
  return readJsonStorage<RatingEntry[]>("local", key, []);
}

function save(key: string, entries: RatingEntry[]) {
  writeJsonStorage("local", key, entries);
}

export function useRatings() {
  const { storageKey } = useProfile();
  const key = storageKey(BASE_KEY);

  const [entries, setEntries] = useState<RatingEntry[]>(() => load(key));

  // Sync when profile switches (key changes)
  useMemo(() => {
    setEntries(load(key));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const getRating = useCallback(
    (id: string): UserRating => entries.find(e => e.id === id)?.rating ?? null,
    [entries],
  );

  const rate = useCallback((
    id: string,
    kind: "movie" | "tv" | "anime",
    title: string,
    newRating: UserRating,
    poster?: string | null,
  ) => {
    setEntries(prev => {
      const without = prev.filter(e => e.id !== id);
      const next = newRating === null
        ? without
        : [
            { id, kind, title, poster, rating: newRating, ratedAt: new Date().toISOString() },
            ...without,
          ];
      save(key, next);
      return next;
    });
  }, [key]);

  const clearRating = useCallback((id: string) => {
    setEntries(prev => {
      const next = prev.filter(e => e.id !== id);
      save(key, next);
      return next;
    });
  }, [key]);

  /** Toggle: clicking the same rating clears it */
  const toggle = useCallback((
    id: string,
    kind: "movie" | "tv" | "anime",
    title: string,
    newRating: NonNullable<UserRating>,
    poster?: string | null,
  ) => {
    const current = entries.find(e => e.id === id)?.rating;
    rate(id, kind, title, current === newRating ? null : newRating, poster);
  }, [entries, rate]);

  const ratedItems = useMemo(
    () => [...entries].sort((a, b) => (b.ratedAt > a.ratedAt ? 1 : -1)),
    [entries],
  );

  return { getRating, rate, clearRating, toggle, ratedItems };
}
