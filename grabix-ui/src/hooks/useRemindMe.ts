// hooks/useRemindMe.ts — Phase 3
// localStorage-backed "Remind Me" bell button state for Coming Soon items.

import { useState, useCallback } from "react";

const STORAGE_KEY = "grabix:remind_me";

function load(): Set<number> {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return new Set<number>(arr);
  } catch {
    return new Set();
  }
}

function save(set: Set<number>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

export function useRemindMe() {
  const [ids, setIds] = useState<Set<number>>(load);

  const isReminded = useCallback((id: number) => ids.has(id), [ids]);

  const toggle = useCallback((id: number) => {
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      save(next);
      return next;
    });
  }, []);

  return { isReminded, toggle, remindedIds: ids };
}
