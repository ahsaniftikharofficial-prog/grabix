/**
 * useNotifications.ts — Phase 6
 * Checks TMDB for new episodes on shows the user has favorited.
 * Runs once on mount and stores the last-seen episode per show.
 */

import { useState, useEffect, useCallback } from "react";
import { useFavorites } from "../context/FavoritesContext";
import { useProfile } from "../context/ProfileContext";
import { readJsonStorage, writeJsonStorage } from "../lib/persistentState";

export interface Notification {
  id: string;
  showId: number;
  showTitle: string;
  poster?: string | null;
  message: string;
  href?: string;
  seenAt?: string;
  createdAt: string;
}

const BASE_KEY       = "grabix:notifications:v1";
const LAST_EP_KEY    = "grabix:last_ep:v1";
const TMDB_API_KEY   = "5a4f47781c8ab7c9f52d69a24d6f7f0b";
const TMDB_BASE      = "https://api.themoviedb.org/3";

async function fetchLatestEpisode(tmdbId: number): Promise<{ season: number; episode: number; name: string; air_date: string } | null> {
  try {
    const r = await fetch(`${TMDB_BASE}/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`);
    if (!r.ok) return null;
    const d = await r.json();
    const ep = d.last_episode_to_air;
    if (!ep) return null;
    return { season: ep.season_number, episode: ep.episode_number, name: ep.name, air_date: ep.air_date };
  } catch {
    return null;
  }
}

export function useNotifications() {
  const { favorites } = useFavorites();
  const { storageKey } = useProfile();

  const notifKey  = storageKey(BASE_KEY);
  const lastEpKey = storageKey(LAST_EP_KEY);

  const [notifications, setNotifications] = useState<Notification[]>(() =>
    readJsonStorage<Notification[]>("local", notifKey, [])
  );
  const [checking, setChecking] = useState(false);

  const unreadCount = notifications.filter(n => !n.seenAt).length;

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    setNotifications(prev => {
      const next = prev.map(n => n.seenAt ? n : { ...n, seenAt: now });
      writeJsonStorage("local", notifKey, next);
      return next;
    });
  }, [notifKey]);

  const clearAll = useCallback(() => {
    setNotifications([]);
    writeJsonStorage("local", notifKey, []);
  }, [notifKey]);

  const checkForNewEpisodes = useCallback(async () => {
    if (checking) return;
    const tvShows = favorites.filter(f => f.type === "series" && f.tmdbId);
    if (tvShows.length === 0) return;

    setChecking(true);
    const lastEps = readJsonStorage<Record<string, { season: number; episode: number }>>("local", lastEpKey, {});
    const newNotifs: Notification[] = [];

    for (const show of tvShows.slice(0, 20)) {
      // Rate limit: don't hammer TMDB
      await new Promise(r => setTimeout(r, 120));
      const latest = await fetchLatestEpisode(show.tmdbId!);
      if (!latest) continue;

      const key = String(show.tmdbId!);
      const seen = lastEps[key];

      if (!seen) {
        // First time we see this show — just record, no notif
        lastEps[key] = { season: latest.season, episode: latest.episode };
      } else if (latest.season > seen.season || (latest.season === seen.season && latest.episode > seen.episode)) {
        // New episode(s) since last check
        newNotifs.push({
          id: `${show.tmdbId}-s${latest.season}e${latest.episode}`,
          showId: show.tmdbId!,
          showTitle: show.title,
          poster: show.poster || null,
          message: `S${latest.season}E${latest.episode} — "${latest.name}" is now available`,
          createdAt: new Date().toISOString(),
        });
        lastEps[key] = { season: latest.season, episode: latest.episode };
      }
    }

    writeJsonStorage("local", lastEpKey, lastEps);

    if (newNotifs.length > 0) {
      setNotifications(prev => {
        // Deduplicate by id
        const existingIds = new Set(prev.map(n => n.id));
        const fresh = newNotifs.filter(n => !existingIds.has(n.id));
        const next = [...fresh, ...prev].slice(0, 50);
        writeJsonStorage("local", notifKey, next);
        return next;
      });
    }

    setChecking(false);
  }, [checking, favorites, notifKey, lastEpKey]);

  // Check on mount (after a small delay so app settles)
  useEffect(() => {
    const t = window.setTimeout(() => void checkForNewEpisodes(), 3000);
    return () => window.clearTimeout(t);
  // Only run on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { notifications, unreadCount, markAllRead, clearAll, checking, checkForNewEpisodes };
}
