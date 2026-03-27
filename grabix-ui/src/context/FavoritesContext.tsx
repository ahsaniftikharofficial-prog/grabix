// grabix-ui/src/context/FavoritesContext.tsx
// Stores favorites in localStorage — no backend needed

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface FavItem {
  id: string;           // unique e.g. "movie-123", "anime-456", "manga-789"
  title: string;
  poster: string;
  type: "movie" | "anime" | "manga" | "series";
  tmdbId?: number;
  malId?: number;
  mangaId?: string;
}

interface FavCtx {
  favorites: FavItem[];
  isFav: (id: string) => boolean;
  toggle: (item: FavItem) => void;
  remove: (id: string) => void;
}

const Ctx = createContext<FavCtx>({
  favorites: [], isFav: () => false, toggle: () => {}, remove: () => {},
});

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<FavItem[]>(() => {
    try {
      const raw = localStorage.getItem("grabix_favorites");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem("grabix_favorites", JSON.stringify(favorites));
  }, [favorites]);

  const isFav = (id: string) => favorites.some(f => f.id === id);

  const toggle = (item: FavItem) => {
    setFavorites(prev =>
      prev.some(f => f.id === item.id)
        ? prev.filter(f => f.id !== item.id)
        : [...prev, item]
    );
  };

  const remove = (id: string) => setFavorites(prev => prev.filter(f => f.id !== id));

  return <Ctx.Provider value={{ favorites, isFav, toggle, remove }}>{children}</Ctx.Provider>;
}

export const useFavorites = () => useContext(Ctx);
