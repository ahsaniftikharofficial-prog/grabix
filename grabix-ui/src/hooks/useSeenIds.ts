// hooks/useSeenIds.ts — tracks seen IDs per page session to prevent duplicates
import { useRef, useCallback } from "react";

export function useSeenIds() {
  const seenIds = useRef<Set<number>>(new Set());

  /** Clear the set (call when genre/search changes to start fresh) */
  const reset = useCallback(() => {
    seenIds.current = new Set();
  }, []);

  /** Add an array of IDs to the seen set */
  const markSeen = useCallback((ids: number[]) => {
    ids.forEach(id => seenIds.current.add(id));
  }, []);

  /**
   * Return only items whose IDs haven't been seen yet.
   * Also marks the returned items as seen automatically.
   */
  const filterUnseen = useCallback(<T extends { id: number }>(items: T[]): T[] => {
    const fresh = items.filter(item => !seenIds.current.has(item.id));
    fresh.forEach(item => seenIds.current.add(item.id));
    return fresh;
  }, []);

  return { reset, markSeen, filterUnseen };
}
