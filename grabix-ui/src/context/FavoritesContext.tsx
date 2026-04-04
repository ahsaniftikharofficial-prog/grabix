import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readJsonStorage, versionedStorageKey, writeJsonStorage } from "../lib/persistentState";

export interface FavItem {
  id: string;
  title: string;
  poster: string;
  type: "movie" | "anime" | "manga" | "series";
  source?: "native" | "moviebox";
  tmdbId?: number;
  imdbId?: string;
  malId?: number;
  mangaId?: string;
  year?: number;
  movieBoxSubjectId?: string;
  movieBoxMediaType?: "movie" | "series" | "anime";
  isHindi?: boolean;
}

interface FavCtx {
  favorites: FavItem[];
  isFav: (id: string) => boolean;
  toggle: (item: FavItem) => void;
  remove: (id: string) => void;
}

const STORAGE_KEY = versionedStorageKey("grabix-favorites", "v2");
const FavoritesContext = createContext<FavCtx | null>(null);

function loadFavorites(): FavItem[] {
  const value = readJsonStorage<unknown>("local", STORAGE_KEY, []);
  return Array.isArray(value) ? (value as FavItem[]) : [];
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<FavItem[]>(loadFavorites);

  useEffect(() => {
    writeJsonStorage("local", STORAGE_KEY, favorites);
  }, [favorites]);

  const isFav = (id: string) => favorites.some((favorite) => favorite.id === id);

  const toggle = (item: FavItem) => {
    setFavorites((prev) =>
      prev.some((favorite) => favorite.id === item.id)
        ? prev.filter((favorite) => favorite.id !== item.id)
        : [...prev, item]
    );
  };

  const remove = (id: string) => {
    setFavorites((prev) => prev.filter((favorite) => favorite.id !== id));
  };

  const value = useMemo(
    () => ({ favorites, isFav, toggle, remove }),
    [favorites]
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavCtx {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error("useFavorites must be used within FavoritesProvider");
  }
  return context;
}
