/**
 * FavoritesContext.tsx — OPTIMISED (Performance Pass)
 *
 * Problems in the original:
 *   1. isFav was a plain arrow function inside the component body — recreated on
 *      every render, causing every consumer of useFavorites() to re-render even
 *      when favorites hadn't changed.
 *   2. toggle and remove were the same: plain closures recreated each render.
 *   3. isFav used Array.some() (O(N)) — fine for small lists but a Set lookup
 *      is O(1) and costs nothing extra to maintain.
 *   4. The useMemo wrapping the context value was correctly applied, but because
 *      isFav / toggle / remove were new function references every render, the
 *      memoized value was invalidated on every render anyway (the dependency
 *      array included `favorites`, but the embedded function refs changed too).
 *
 * OPTIMISED:
 *   • isFav derived from a useMemo<Set<string>> of favorite ids — O(1) lookup.
 *   • isFav, toggle, remove all wrapped in useCallback so their references are
 *     stable across renders unless `favorites` actually changes.
 *   • useMemo value now only re-creates when favorites changes, not on every
 *     render of FavoritesProvider.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { readJsonStorage, versionedStorageKey, writeJsonStorage } from "../lib/persistentState";
import { useProfile } from "./ProfileContext";

export interface FavItem {
  id:                  string;
  title:               string;
  poster:              string;
  type:                "movie" | "anime" | "manga" | "series";
  source?:             "native" | "moviebox";
  tmdbId?:             number;
  imdbId?:             string;
  malId?:              number;
  mangaId?:            string;
  year?:               number;
  movieBoxSubjectId?:  string;
  movieBoxMediaType?:  "movie" | "series" | "anime";
  isHindi?:            boolean;
}

interface FavCtx {
  favorites: FavItem[];
  isFav:     (id: string) => boolean;
  toggle:    (item: FavItem) => void;
  remove:    (id: string) => void;
}

const BASE_KEY         = versionedStorageKey("grabix-favorites", "v2");
const FavoritesContext = createContext<FavCtx | null>(null);

function loadFavorites(storageKey: string): FavItem[] {
  const value = readJsonStorage<unknown>("local", storageKey, []);
  return Array.isArray(value) ? (value as FavItem[]) : [];
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { storageKey } = useProfile();
  const key = storageKey(BASE_KEY);

  const [favorites, setFavorites] = useState<FavItem[]>(() => loadFavorites(key));

  // Reload when profile switches (key changes)
  useEffect(() => {
    setFavorites(loadFavorites(key));
  }, [key]);

  // Persist to localStorage whenever the list changes.
  useEffect(() => {
    writeJsonStorage("local", key, favorites);
  }, [key, favorites]);

  // ── OPTIMISED: O(1) id lookup via Set ────────────────────────────────────
  const favoriteIdSet = useMemo(
    () => new Set(favorites.map((f) => f.id)),
    [favorites],
  );

  // ── OPTIMISED: stable callbacks — references only change when favorites changes
  const isFav = useCallback(
    (id: string) => favoriteIdSet.has(id),
    [favoriteIdSet],
  );

  const toggle = useCallback(
    (item: FavItem) => {
      setFavorites((prev) =>
        prev.some((f) => f.id === item.id)
          ? prev.filter((f) => f.id !== item.id)
          : [...prev, item],
      );
    },
    [], // setFavorites is stable; no other deps needed
  );

  const remove = useCallback(
    (id: string) => {
      setFavorites((prev) => prev.filter((f) => f.id !== id));
    },
    [],
  );

  // ── OPTIMISED: value is stable — only recreated when callbacks change ─────
  const value = useMemo(
    () => ({ favorites, isFav, toggle, remove }),
    [favorites, isFav, toggle, remove],
  );

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites(): FavCtx {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error("useFavorites must be used within FavoritesProvider");
  }
  return context;
}
