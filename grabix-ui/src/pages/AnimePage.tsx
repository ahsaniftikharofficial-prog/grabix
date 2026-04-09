import { useEffect, useMemo, useRef, useState } from "react";
import { IconDownload, IconPlay, IconSearch, IconStar, IconX } from "../components/Icons";
import { IconHeart } from "../components/Icons";
import VidSrcPlayer from "../components/VidSrcPlayer";
import DownloadOptionsModal from "../components/DownloadOptionsModal";
import AppToast from "../components/AppToast";
import { PageEmptyState, PageErrorState } from "../components/PageStates";
import { useFavorites } from "../context/FavoritesContext";
import { useContentFilter } from "../context/ContentFilterContext";
import { queueSubtitleDownload, queueVideoDownload, resolveSourceDownloadOptions } from "../lib/downloads";
import { filterAdultContent } from "../lib/contentFilter";
import {
  fetchConsumetAnimeEpisodes,
  fetchConsumetDomainInfo,
  fetchConsumetHealth,
  normalizeAudioPreference,
  searchConsumetAnime,
  type AudioPreference,
  type ConsumetEpisode,
  type ConsumetHealth,
  type ConsumetMediaSummary,
} from "../lib/consumetProviders";
import {
  fetchAniwatchDiscover,
  fetchAniwatchGenreAnime,
  fetchAniwatchGenres,
  fetchAniwatchSchedule,
  searchAniwatch,
  warmAniwatchSections,
  type AniwatchGenre,
  type AniwatchScheduledAnime,
  type AniwatchSection,
} from "../lib/aniwatchProviders";
import { BACKEND_API } from "../lib/api";
import { fetchTmdbSeasonMap as fetchTmdbSeasonMapFromBackend, searchTmdbMedia } from "../lib/tmdb";
import { fetchMovieBoxSources, resolveAnimePlaybackSources, searchMovieBox, type StreamSource } from "../lib/streamProviders";
import CachedImage from "../components/CachedImage";

const JIKAN = "https://api.jikan.moe/v4";

type Tab = "trending" | "popular" | "toprated" | "seasonal" | "movie" | "schedule" | "genre";
type TmdbEpisodeRef = { season: number; episode: number };
type AnimeAudioOption = "en" | "original" | "hi";
type AnimeServerOption = "auto" | "hd-1" | "hd-2";
type TrendingPeriod = "daily" | "weekly" | "monthly";

const tmdbSeasonCache = new Map<number, Array<{ season: number; count: number }>>();
const AUDIO_BUTTONS: Array<{ id: AnimeAudioOption; label: string; help: string }> = [
  { id: "en", label: "Dub", help: "English audio first" },
  { id: "original", label: "Sub", help: "Original audio first" },
  { id: "hi", label: "Hindi", help: "Movie Box only when available" },
];
const SERVER_BUTTONS: Array<{ id: AnimeServerOption; label: string; help: string }> = [
  { id: "auto", label: "Auto", help: "Fastest available source" },
  { id: "hd-1", label: "HD-1", help: "AniWatch primary" },
  { id: "hd-2", label: "HD-2", help: "AniWatch backup" },
];

interface LegacyAnime {
  mal_id: number;
  title: string;
  title_english?: string;
  images: { jpg: { image_url: string; large_image_url?: string } };
  synopsis?: string;
  score?: number;
  episodes?: number;
  status?: string;
  genres?: { name: string }[];
  year?: number;
  trailer?: { embed_url?: string };
  url?: string;
}

interface AnimeCardItem extends ConsumetMediaSummary {
  mal_id?: number;
  episodes_count?: number;
  trailer_url?: string;
}

function normalizeAnimeImageUrl(value?: string | null): string {
  const url = (value || "").trim();
  if (!url) return "";
  if (url.startsWith("/")) {
    return `${BACKEND_API}${url}`;
  }
  const normalized = url.startsWith("//") ? `https:${url}` : url;
  if (normalized.startsWith(BACKEND_API) || normalized.includes("/consumet/proxy?url=")) {
    return normalized;
  }
  if (/^https?:\/\//i.test(normalized)) {
    return `${BACKEND_API}/consumet/proxy?url=${encodeURIComponent(normalized)}`;
  }
  return normalized;
}

function toCardItem(item: ConsumetMediaSummary): AnimeCardItem {
  return {
    ...item,
    image: normalizeAnimeImageUrl(item.image),
    episodes_count: item.episodes_count,
  };
}

function mapLegacyAnime(item: LegacyAnime): AnimeCardItem {
  return {
    id: String(item.mal_id),
    provider: "jikan",
    type: "anime",
    title: item.title_english ?? item.title,
    alt_title: item.title,
    image: normalizeAnimeImageUrl(item.images.jpg.large_image_url ?? item.images.jpg.image_url),
    description: item.synopsis,
    year: item.year,
    rating: item.score ?? null,
    status: item.status,
    genres: (item.genres ?? []).map((genre) => genre.name),
    languages: ["original"],
    url: item.url,
    mal_id: item.mal_id,
    episodes_count: item.episodes,
    trailer_url: item.trailer?.embed_url,
  };
}

function dedupeItems(items: AnimeCardItem[]): AnimeCardItem[] {
  const seen = new Set<string>();
  const result: AnimeCardItem[] = [];
  for (const item of items) {
    const key = `${item.provider}-${item.id}`;
    if (!item.id || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

async function searchJikanAnime(query: string, page = 1): Promise<AnimeCardItem[]> {
  const response = await fetch(`${JIKAN}/anime?q=${encodeURIComponent(query)}&page=${page}&limit=20&sfw=true`);
  const data = (await response.json()) as { data?: LegacyAnime[] };
  return (data.data ?? []).map(mapLegacyAnime);
}

async function fetchJikanDiscover(tab: Tab, page = 1): Promise<AnimeCardItem[]> {
  const path =
    tab === "popular"
      ? `/top/anime?filter=bypopularity&page=${page}&limit=20`
      : tab === "toprated"
        ? `/top/anime?filter=favorite&page=${page}&limit=20`
        : tab === "seasonal"
          ? `/seasons/now?page=${page}&limit=20`
          : tab === "movie"
            ? `/top/anime?type=movie&page=${page}&limit=20`
            : `/top/anime?page=${page}&limit=20`;
  const response = await fetch(`${JIKAN}${path}`);
  const data = (await response.json()) as { data?: LegacyAnime[] };
  return (data.data ?? []).map(mapLegacyAnime);
}

async function fetchJikanEpisodeCount(malId?: number): Promise<number | null> {
  if (!malId) return null;
  try {
    const response = await fetch(`${JIKAN}/anime/${malId}/full`);
    const data = (await response.json()) as { data?: { episodes?: number | null } };
    return data.data?.episodes ?? null;
  } catch {
    return null;
  }
}

async function fetchJikanTrailerUrl(malId?: number, fallbackTitle?: string): Promise<string | null> {
  const tryMal = async (id: number) => {
    const response = await fetch(`${JIKAN}/anime/${id}/full`);
    const data = (await response.json()) as { data?: { trailer?: { embed_url?: string | null } } };
    return data.data?.trailer?.embed_url ?? null;
  };

  try {
    if (malId) {
      const direct = await tryMal(malId);
      if (direct) return direct;
    }
    if (fallbackTitle?.trim()) {
      const results = await searchJikanAnime(fallbackTitle, 1);
      const match = results.find((item) => item.mal_id);
      if (match?.mal_id) {
        return await tryMal(match.mal_id);
      }
    }
  } catch {
    return null;
  }
  return null;
}

function expandAnimeTitles(...titles: Array<string | undefined>): string[] {
  const values = new Set<string>();
  for (const rawTitle of titles) {
    const title = rawTitle?.trim();
    if (!title) continue;
    values.add(title);
    values.add(title.replace(/[:\-|].*$/, "").trim());
    values.add(title.replace(/\(.*?\)/g, "").trim());
    values.add(title.replace(/season\s+\d+/i, "").trim());
  }
  return [...values].filter(Boolean);
}

async function searchTmdbTv(query: string): Promise<number | null> {
  const data = (await searchTmdbMedia("tv", query, 1)) as { results?: Array<{ id?: number; name?: string; original_name?: string }> };
  return data.results?.[0]?.id ?? null;
}

async function searchTmdbMulti(query: string): Promise<number | null> {
  const data = (await searchTmdbMedia("multi", query, 1)) as { results?: Array<{ id?: number; media_type?: string }> };
  const tvMatch = data.results?.find((item) => item.media_type === "tv");
  return tvMatch?.id ?? null;
}

async function findTmdbId(...titles: Array<string | undefined>): Promise<number | null> {
  const candidates = expandAnimeTitles(...titles);
  for (const title of candidates) {
    try {
      const tvId = await searchTmdbTv(title);
      if (tvId) return tvId;
      const multiId = await searchTmdbMulti(title);
      if (multiId) return multiId;
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchTmdbSeasonMap(tmdbId: number): Promise<Array<{ season: number; count: number }>> {
  const cached = tmdbSeasonCache.get(tmdbId);
  if (cached) return cached;

  const seasons = await fetchTmdbSeasonMapFromBackend(tmdbId);
  tmdbSeasonCache.set(tmdbId, seasons);
  return seasons;
}

async function resolveTmdbEpisodeNumber(tmdbId: number | null, episodeNumber: number): Promise<TmdbEpisodeRef | null> {
  if (!tmdbId || episodeNumber < 1) return null;
  try {
    const seasons = await fetchTmdbSeasonMap(tmdbId);
    if (seasons.length === 0) return { season: 1, episode: episodeNumber };

    let remaining = episodeNumber;
    for (const season of seasons) {
      if (remaining <= season.count) {
        return { season: season.season, episode: remaining };
      }
      remaining -= season.count;
    }
  } catch {
    return { season: 1, episode: episodeNumber };
  }
  return { season: 1, episode: episodeNumber };
}

export default function AnimePage() {
  const { adultContentBlocked } = useContentFilter();
  const [tab, setTab] = useState<Tab>("trending");
  const [trendingPeriod, setTrendingPeriod] = useState<TrendingPeriod>("daily");
  const [items, setItems] = useState<AnimeCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [browseError, setBrowseError] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<AnimeCardItem | null>(null);
  const [player, setPlayer] = useState<{
    title: string;
    subtitle?: string;
    subtitleSearchTitle?: string;
    poster?: string;
    sources: StreamSource[];
    mediaType?: "movie" | "tv";
    currentEpisode?: number;
    episodeOptions?: number[];
    episodeLabel?: string;
    sourceOptions?: Array<{ id: string; label: string }>;
    onSelectSourceOption?: (optionId: string, episode?: number) => Promise<{
      sources: StreamSource[];
      subtitle?: string;
      subtitleSearchTitle?: string;
    }>;
    onSelectEpisode?: (episode: number) => Promise<{
      sources: StreamSource[];
      subtitle?: string;
      subtitleSearchTitle?: string;
    }>;
  } | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [health, setHealth] = useState<ConsumetHealth | null>(null);
  // Genre tab state
  const [genres, setGenres] = useState<AniwatchGenre[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string>("");
  // Schedule tab state
  const [scheduleDate, setScheduleDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [scheduleItems, setScheduleItems] = useState<AniwatchScheduledAnime[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const tabs: { id: Tab; label: string }[] = [
    { id: "trending", label: "Trending" },
    { id: "popular", label: "Most Popular" },
    { id: "toprated", label: "Most Favorite" },
    { id: "seasonal", label: "Top Airing" },
    { id: "movie", label: "Movies" },
    { id: "genre", label: "🎭 Genre" },
    { id: "schedule", label: "📅 Schedule" },
  ];
  const filteredItems = useMemo(() => filterAdultContent(items, adultContentBlocked), [items, adultContentBlocked]);

  const loadDiscover = async (nextTab: Tab, nextPage = 1, nextPeriod: TrendingPeriod = trendingPeriod) => {
    if (nextTab === "schedule" || nextTab === "genre") return;
    setLoading(true);
    setBrowseError("");
    try {
      // AniWatch is PRIMARY — fast 8s timeout, aniwatchtv.to mirror
      const result = await fetchAniwatchDiscover(nextTab as AniwatchSection, nextPage, nextPeriod);
      const nextItems = (result.items ?? []).map(toCardItem);
      setHasMore(result.has_next || nextItems.length > 0);
      setItems((prev) => (nextPage === 1 ? nextItems : dedupeItems([...prev, ...nextItems])));
    } catch {
      // Fallback to Jikan if AniWatch is down
      try {
        const fallbackItems = await fetchJikanDiscover(nextTab, nextPage);
        setHasMore(fallbackItems.length > 0);
        setItems((prev) => (nextPage === 1 ? fallbackItems : dedupeItems([...prev, ...fallbackItems])));
      } catch {
        setItems([]);
        setHasMore(false);
        setBrowseError("Anime results could not be loaded right now.");
      }
    } finally {
      setLoading(false);
    }
  };

  const loadSearch = async (nextQuery: string, nextPage = 1) => {
    setLoading(true);
    setBrowseError("");
    try {
      // AniWatch PRIMARY search
      const result = await searchAniwatch(nextQuery, nextPage);
      const nextItems = (result.items ?? []).map(toCardItem);
      setHasMore(result.has_next || nextItems.length > 0);
      setItems((prev) => (nextPage === 1 ? nextItems : dedupeItems([...prev, ...nextItems])));
    } catch {
      // Consumet fallback
      try {
        const nextItems = (await searchConsumetAnime(nextQuery, nextPage)).map(toCardItem);
        setHasMore(nextItems.length > 0);
        setItems((prev) => (nextPage === 1 ? nextItems : dedupeItems([...prev, ...nextItems])));
      } catch {
        // Jikan last resort
        try {
          const legacy = await searchJikanAnime(nextQuery, nextPage);
          setHasMore(legacy.length > 0);
          setItems((prev) => (nextPage === 1 ? legacy : dedupeItems([...prev, ...legacy])));
        } catch {
          setItems([]);
          setHasMore(false);
          setBrowseError("Anime search could not be completed right now.");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const loadGenreAnime = async (genre: string, nextPage = 1) => {
    if (!genre) return;
    setLoading(true);
    setBrowseError("");
    try {
      const result = await fetchAniwatchGenreAnime(genre, nextPage);
      const nextItems = (result.items ?? []).map(toCardItem);
      setHasMore(result.has_next || nextItems.length > 0);
      setItems((prev) => (nextPage === 1 ? nextItems : dedupeItems([...prev, ...nextItems])));
    } catch {
      setItems([]);
      setHasMore(false);
      setBrowseError(`Could not load ${genre} anime right now.`);
    } finally {
      setLoading(false);
    }
  };

  const loadSchedule = async (date: string) => {
    setScheduleLoading(true);
    setScheduleError("");
    try {
      const result = await fetchAniwatchSchedule(date);
      setScheduleItems(result.scheduled ?? []);
    } catch {
      setScheduleError("Could not load today's schedule. Try again shortly.");
      setScheduleItems([]);
    } finally {
      setScheduleLoading(false);
    }
  };

  const retryCurrentView = () => {
    setPage(1);
    if (query) { void loadSearch(query, 1); return; }
    if (tab === "genre") { void loadGenreAnime(selectedGenre, 1); return; }
    if (tab === "schedule") { void loadSchedule(scheduleDate); return; }
    void loadDiscover(tab, 1, trendingPeriod);
  };

  const loadMore = () => {
    if (loading || !hasMore) return;
    if (tab === "schedule" || tab === "genre" && !selectedGenre) return;
    const nextPage = page + 1;
    setPage(nextPage);
    if (query) void loadSearch(query, nextPage);
    else if (tab === "genre") void loadGenreAnime(selectedGenre, nextPage);
    else void loadDiscover(tab, nextPage, trendingPeriod);
  };

  useEffect(() => {
    let cancelled = false;
    const loadHealth = () => {
      fetchConsumetHealth().then((result) => {
        if (!cancelled) setHealth(result);
      }).catch(() => {
        if (!cancelled) {
          setHealth({
            configured: false,
            healthy: false,
            message: "Anime fallback playback is ready.",
            default_audio_priority: ["en", "original", "hi"],
            default_subtitle_priority: ["en", "hi"],
          });
        }
      });
    };

    loadHealth();
    const interval = window.setInterval(loadHealth, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  // Load genre list once
  useEffect(() => {
    fetchAniwatchGenres().then(setGenres).catch(() => setGenres([]));
  }, []);

  // Load schedule when schedule tab active or date changes
  useEffect(() => {
    if (tab === "schedule") {
      void loadSchedule(scheduleDate);
    }
  }, [tab, scheduleDate]);

  // Load genre anime when genre selected
  useEffect(() => {
    if (tab === "genre" && selectedGenre) {
      setPage(1);
      setItems([]);
      void loadGenreAnime(selectedGenre, 1);
    }
  }, [tab, selectedGenre]);

  useEffect(() => {
    if (tab === "schedule" || tab === "genre") return;
    setPage(1);
    setItems([]);
    setHasMore(true);
    scrollRef.current?.scrollTo({ top: 0 });
    if (query) { void loadSearch(query, 1); return; }
    void loadDiscover(tab, 1, trendingPeriod);
  }, [tab, query, trendingPeriod]);

  useEffect(() => {
    if (query) return;
    if (query) return;
    if (tab === "schedule" || tab === "genre") return;
    const warmSections = (["trending", "popular", "toprated", "seasonal", "movie"] as const).filter((v) => v !== tab);
    const timer = window.setTimeout(() => {
      warmAniwatchSections([...warmSections], trendingPeriod);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [query, tab, trendingPeriod]);
  useEffect(() => {
    const node = bottomRef.current;
    const root = scrollRef.current;
    if (!node || !root) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { root, rootMargin: "260px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [items.length, loading, page, query, tab, trendingPeriod]);

  const helperText = health?.healthy
    ? "AniWatch-first anime with dub/sub/Hindi playback and Consumet/Jikan backups"
    : health && !health.configured
      ? "Anime browsing ready with AniWatch as primary source"
      : "AniWatch primary with Jikan fallback — fastest anime data available";

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node || loading) return;
    const remaining = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (remaining < 320) {
      loadMore();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Anime</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>{helperText}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" style={{ fontSize: 13, gap: 6 }} onClick={() => window.dispatchEvent(new CustomEvent("grabix:navigate", { detail: { page: "favorites" } }))}>
            <IconHeart size={13} color="var(--text-danger)" filled /> Favorites
          </button>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}><IconSearch size={13} color="var(--text-muted)" /></div>
            <input className="input-base" style={{ paddingLeft: 32, width: 240, fontSize: 13 }} placeholder="Search anime..." value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (search.trim() ? setQuery(search.trim()) : setQuery(""))} />
          </div>
          <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={() => (search.trim() ? setQuery(search.trim()) : setQuery(""))}>Search</button>
          {query && <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => { setQuery(""); setSearch(""); }}> <IconX size={13} /> Clear</button>}
        </div>
      </div>

      {!query && (
        <div style={{ display: "flex", gap: 4, padding: "10px 24px 0", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
          {tabs.map((nextTab) => (
            <button key={nextTab.id} onClick={() => setTab(nextTab.id)} style={{ padding: "7px 16px", fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer", background: "transparent", borderBottom: tab === nextTab.id ? "2px solid var(--accent)" : "2px solid transparent", color: tab === nextTab.id ? "var(--accent)" : "var(--text-muted)", transition: "var(--transition)", borderRadius: 0 }}>
              {nextTab.label}
            </button>
          ))}
        </div>
      )}

      {!query && tab === "trending" && (
        <div style={{ display: "flex", gap: 8, padding: "12px 24px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
          {([
            { id: "daily", label: "Daily" },
            { id: "weekly", label: "Weekly" },
            { id: "monthly", label: "Monthly" },
          ] as const).map((period) => (
            <button
              key={period.id}
              className={`quality-chip${trendingPeriod === period.id ? " active" : ""}`}
              onClick={() => setTrendingPeriod(period.id)}
            >
              {period.label}
            </button>
          ))}
        </div>
      )}

      {!query && tab === "genre" && (
        <div style={{ padding: "12px 24px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Pick a genre</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {genres.length === 0 && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading genres...</span>}
            {genres.map((g) => (
              <button
                key={g.id}
                className={`quality-chip${selectedGenre === g.name ? " active" : ""}`}
                onClick={() => { setSelectedGenre(g.name); setPage(1); }}
              >
                {g.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {!query && tab === "schedule" && (
        <div style={{ padding: "12px 24px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Date:</span>
          <input
            type="date"
            className="input-base"
            style={{ fontSize: 13, padding: "5px 10px" }}
            value={scheduleDate}
            onChange={(e) => setScheduleDate(e.target.value)}
          />
          {scheduleLoading && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading...</span>}
        </div>
      )}

      <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {/* Schedule tab — special render */}
        {!query && tab === "schedule" ? (
          scheduleError ? (
            <PageErrorState title="Schedule unavailable" subtitle={scheduleError} onRetry={() => loadSchedule(scheduleDate)} />
          ) : scheduleLoading ? (
            <LoadingGrid count={6} />
          ) : scheduleItems.length === 0 ? (
            <PageEmptyState title="No anime scheduled" subtitle="Try a different date." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {scheduleItems.map((item) => (
                <div key={item.id} className="card" style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px" }}>
                  <div style={{ minWidth: 64, fontSize: 15, fontWeight: 700, color: "var(--accent)" }}>{item.time || "—"}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{item.title}</div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : !query && tab === "genre" && !selectedGenre ? (
          <PageEmptyState title="Choose a genre" subtitle="Select a genre above to browse anime." />
        ) : loading && filteredItems.length === 0 ? <LoadingGrid /> : browseError ? (
          <PageErrorState
            title="Anime is unavailable right now"
            subtitle={browseError}
            onRetry={retryCurrentView}
          />
        ) : filteredItems.length === 0 ? (
          <PageEmptyState
            title={query ? "No anime matched that search" : "No anime is available here yet"}
            subtitle={query ? "Try another title, season, or spelling." : "Try a different tab or refresh this page."}
          />
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: tab === "trending" ? "repeat(auto-fit, minmax(190px, 1fr))" : "repeat(auto-fill, minmax(150px, 1fr))", gap: tab === "trending" ? 16 : 14 }}>
              {filteredItems.map((anime, index) => <AnimeCard key={`${anime.provider}-${anime.id}`} anime={anime} activeTab={tab} featured={tab === "trending"} rank={index + 1} onClick={() => setDetail(anime)} />)}
            </div>
            <div ref={bottomRef} style={{ height: 24 }} />
          </>
        )}
      </div>

      {detail && !player && (
        <AnimeDetail
          anime={detail}
          onClose={() => setDetail(null)}
          onPlay={(nextPlayer) => {
            setDetail(null);
            setPlayer(nextPlayer);
          }}
          consumetHealthy={Boolean(health?.healthy)}
          activeTab={tab}
        />
      )}
      {player && (
        <VidSrcPlayer
          title={player.title}
          subtitle={player.subtitle}
          subtitleSearchTitle={player.subtitleSearchTitle}
          poster={player.poster}
          sources={player.sources}
          mediaType={player.mediaType ?? "tv"}
          currentEpisode={player.currentEpisode}
          episodeOptions={player.episodeOptions}
          episodeLabel={player.episodeLabel}
          sourceOptions={player.sourceOptions}
          onSelectSourceOption={player.onSelectSourceOption}
          onSelectEpisode={player.onSelectEpisode}
          onClose={() => setPlayer(null)}
          onDownload={async (url) => {
            await queueVideoDownload({ url });
          }}
          onDownloadSource={async (source) => {
            await queueVideoDownload({
              url: source.url,
              title: player.title,
              headers: source.requestHeaders,
              forceHls: source.kind === "hls",
            });
          }}
        />
      )}
    </div>
  );
}

function AnimeCard({ anime, activeTab, featured, rank, onClick }: { anime: AnimeCardItem; activeTab: Tab; featured?: boolean; rank?: number; onClick: () => void }) {
  const { isFav, toggle } = useFavorites();
  const favoriteId = `anime-${anime.mal_id ?? `${anime.provider}-${anime.id}`}`;
  const favorite = isFav(favoriteId);
  const rawType = String((anime.raw as { type?: string } | undefined)?.type || "").toLowerCase();
  const isMovie = activeTab === "movie" || rawType === "movie";
  const countLabel = isMovie
    ? anime.episodes_count && anime.episodes_count > 1
      ? `${anime.episodes_count} parts`
      : "Movie"
    : anime.episodes_count
      ? `${anime.episodes_count} eps`
      : anime.status || "-";

  return (
    <div className="card" style={{ overflow: "hidden", cursor: "pointer", transition: "transform 0.15s", minHeight: featured ? 360 : undefined }} onClick={onClick} onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-3px)")} onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}>
      <div style={{ position: "relative" }}>
        <CachedImage src={anime.image || ""} fallbackSrc="https://via.placeholder.com/150x210?text=No+Image" alt={anime.title} referrerPolicy="no-referrer" style={{ width: "100%", height: featured ? 265 : 210, objectFit: "cover" }} />
        {featured && rank ? <div style={{ position: "absolute", bottom: 8, left: 8, background: "rgba(0,0,0,0.78)", color: "white", fontSize: 12, padding: "4px 10px", borderRadius: 999, fontWeight: 700 }}>#{rank}</div> : null}
        {anime.rating ? <div style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.75)", color: "#fdd663", fontSize: 11, padding: "2px 7px", borderRadius: 6, display: "flex", alignItems: "center", gap: 3, fontWeight: 600 }}><IconStar size={10} color="#fdd663" /> {anime.rating.toFixed(1)}</div> : null}
        <button
          className="btn-icon"
          style={{ position: "absolute", top: 6, left: 6, width: 28, height: 28, borderRadius: 999, background: "rgba(0,0,0,0.62)", border: "1px solid rgba(255,255,255,0.12)" }}
          onClick={(event) => {
            event.stopPropagation();
            toggle({ id: favoriteId, title: anime.title, poster: anime.image || "", type: "anime", malId: anime.mal_id });
          }}
        >
          <IconHeart size={14} color={favorite ? "var(--text-danger)" : "white"} filled={favorite} />
        </button>
      </div>
      <div style={{ padding: featured ? "12px 12px 14px" : "8px 10px" }}>
        <div style={{ fontSize: featured ? 14 : 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: featured ? "normal" : "nowrap", lineHeight: 1.35 }}>{anime.title}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{countLabel}</div>
      </div>
    </div>
  );
}

function AnimeDetail({
  anime,
  onClose,
  onPlay,
  consumetHealthy,
  activeTab,
}: {
  anime: AnimeCardItem;
  onClose: () => void;
  onPlay: (player: {
    title: string;
    subtitle?: string;
    subtitleSearchTitle?: string;
    poster?: string;
    sources: StreamSource[];
    mediaType?: "movie" | "tv";
    currentEpisode?: number;
    episodeOptions?: number[];
    episodeLabel?: string;
    sourceOptions?: Array<{ id: string; label: string }>;
    onSelectSourceOption?: (optionId: string, episode?: number) => Promise<{
      sources: StreamSource[];
      subtitle?: string;
      subtitleSearchTitle?: string;
    }>;
    onSelectEpisode?: (episode: number) => Promise<{
      sources: StreamSource[];
      subtitle?: string;
      subtitleSearchTitle?: string;
    }>;
  }) => void;
  consumetHealthy: boolean;
  activeTab: Tab;
}) {
  const [finding, setFinding] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [tmdbId, setTmdbId] = useState<number | null>(null);
  const [candidateAnimes, setCandidateAnimes] = useState<AnimeCardItem[]>([anime]);
  const [resolvedAnime, setResolvedAnime] = useState<AnimeCardItem | null>(anime);
  const [episodes, setEpisodes] = useState<ConsumetEpisode[]>([]);
  const [episode, setEpisode] = useState(1);
  const [dubEpisodeCount, setDubEpisodeCount] = useState<number | null>(null);
  const hasDub = dubEpisodeCount === null ? false : (dubEpisodeCount === 0 ? false : episode <= dubEpisodeCount);
  const [audio, setAudio] = useState<AudioPreference>("original");
  const [server, setServer] = useState<AnimeServerOption>("auto");
  useEffect(() => {
    if (!hasDub && audio === "en") setAudio("original");
  }, [hasDub]);
  const [detailHint, setDetailHint] = useState("");
  const [knownEpisodeCount, setKnownEpisodeCount] = useState<number | null>(anime.episodes_count ?? null);
  const [hasHindiFallback, setHasHindiFallback] = useState(false);
  const [trailerUrl, setTrailerUrl] = useState(anime.trailer_url || "");
  const [downloading, setDownloading] = useState(false);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: "success" | "error" | "info" } | null>(null);
  const [downloadLanguage, setDownloadLanguage] = useState<"sub" | "dub" | "hindi">("dub");
  const [downloadServer, setDownloadServer] = useState<AnimeServerOption>("hd-1");
  const [downloadQuality, setDownloadQuality] = useState("source");
  const [downloadQualityOptions, setDownloadQualityOptions] = useState<Array<{ id: string; label: string; url: string; headers?: Record<string, string>; forceHls?: boolean }>>([]);
  const [downloadSubtitleTracks, setDownloadSubtitleTracks] = useState<Array<{ label: string; url: string; headers?: Record<string, string> }>>([]);
  const [downloadIncludeSubtitle, setDownloadIncludeSubtitle] = useState(false);
  const [downloadDialogLoading, setDownloadDialogLoading] = useState(false);
  const [downloadDialogError, setDownloadDialogError] = useState("");
  const resolvedSourceCacheRef = useRef<Record<string, StreamSource>>({});
  const episodeCacheRef = useRef<Record<string, ConsumetEpisode[]>>({});
  const episodeRequestCacheRef = useRef<Record<string, Promise<ConsumetEpisode[]>>>({});
  const resolvedSourcePromiseCacheRef = useRef<Record<string, Promise<StreamSource | null>>>({});
  const { isFav, toggle } = useFavorites();
  const title = anime.title;
  const fav = isFav(`anime-${anime.mal_id ?? `${anime.provider}-${anime.id}`}`);
  const rawType = String((anime.raw as { type?: string } | undefined)?.type || "").toLowerCase();
  const isMovie = activeTab === "movie" || rawType === "movie";
  const selectionLabel = isMovie ? "Part" : "Episode";

  const fallbackEpisodeCount = Math.max(knownEpisodeCount ?? anime.episodes_count ?? 12, 1);
  const totalEpisodes = Math.max(episodes.length || fallbackEpisodeCount, 1);
  const episodeGroups = Math.ceil(totalEpisodes / 50);
  const selectedGroup = Math.floor((episode - 1) / 50);
  const episodeStart = selectedGroup * 50 + 1;
  const episodeEnd = Math.min(totalEpisodes, episodeStart + 49);
  const visibleEpisodes = useMemo(
    () => Array.from({ length: Math.max(0, episodeEnd - episodeStart + 1) }, (_, index) => episodeStart + index),
    [episodeStart, episodeEnd]
  );
  const hasTrailer = Boolean(trailerUrl);

  useEffect(() => {
    let cancelled = false;
    setFinding(true);
    setEpisodes([]);
    setEpisode(1);
    setDubEpisodeCount(null);
    setAudio("original");
    setServer("auto");
    setDetailHint("");
    setResolvedAnime(anime);
    setCandidateAnimes([anime]);
    setKnownEpisodeCount(anime.episodes_count ?? null);
    episodeCacheRef.current = {};
    setHasHindiFallback(false);
    setTrailerUrl(anime.trailer_url || "");
    resolvedSourceCacheRef.current = {};
    episodeRequestCacheRef.current = {};
    resolvedSourcePromiseCacheRef.current = {};

    Promise.allSettled([
      findTmdbId(anime.title, anime.alt_title),
      anime.provider !== "hianime" && consumetHealthy
        ? searchConsumetAnime(anime.title)
        : Promise.resolve([] as ConsumetMediaSummary[]),
      fetchJikanEpisodeCount(anime.mal_id),
    ]).then(async ([tmdbResult, searchResult, jikanResult]) => {
      if (cancelled) return;

      setTmdbId(tmdbResult.status === "fulfilled" ? tmdbResult.value : null);
      if (jikanResult.status === "fulfilled" && jikanResult.value) {
        setKnownEpisodeCount(jikanResult.value);
      }

      const nextCandidates = anime.provider !== "hianime"
        ? dedupeItems([anime, ...(searchResult.status === "fulfilled" ? searchResult.value.map(toCardItem) : [])])
        : dedupeItems([anime]);
      setCandidateAnimes(nextCandidates);

      // ── Fast dub detection for AniWatch items ────────────────────────────
      // AniWatch search/discover results already carry dub_episode_count;
      // use it immediately so the Dub button appears without the slow round-trip.
      if (anime.provider === "hianime" && typeof anime.dub_episode_count === "number") {
        setDubEpisodeCount(anime.dub_episode_count);
      }

      const titleCandidates = expandAnimeTitles(anime.title, anime.alt_title).slice(0, 4);
      void Promise.allSettled(
        titleCandidates.map((candidateTitle) =>
          searchMovieBox({
            query: candidateTitle,
            page: 1,
            perPage: 6,
            mediaType: "anime",
            animeOnly: true,
            preferHindi: true,
            sortBy: "search",
          })
        )
      ).then((movieBoxResults) => {
        if (cancelled) return;
        const available = movieBoxResults.some(
          (result) =>
            result.status === "fulfilled" &&
            result.value.items.some((item) => Boolean(item.is_hindi))
        );
        setHasHindiFallback(available);
      });

      setResolvedAnime(nextCandidates[0] ?? anime);
      setFinding(false);
      if (!consumetHealthy) {
        setDetailHint("Consumet is in fallback mode. GRABIX will use Jikan, Movie Box, and embed backups.");
      } else if (nextCandidates.length > 0) {
        setDetailHint(`Ready to play. Using ${nextCandidates[0].provider.toUpperCase()} first.`);
      } else {
        setDetailHint("Ready to play with GRABIX fallback providers.");
      }

      void (async () => {
        for (const candidate of nextCandidates) {
          try {
            const detail = await fetchConsumetDomainInfo("anime", candidate.id, candidate.provider);
            const nextEpisodes = detail.item.episodes ?? await fetchConsumetAnimeEpisodes(candidate.id, candidate.provider);
            if (cancelled) return;
            episodeCacheRef.current = {
              ...episodeCacheRef.current,
              [`${candidate.provider}-${candidate.id}`]: nextEpisodes,
            };
            if (nextEpisodes.length > 0) {
              setResolvedAnime({ ...candidate, ...detail.item, provider: candidate.provider, id: candidate.id });
              // Refine dub count from detail — prefer explicit number, fall back to language flags
              const detailDubCount = typeof detail.item.dub_episode_count === "number"
                ? detail.item.dub_episode_count
                : (detail.item.languages ?? []).some((l: string) => l === "en" || l === "dub") ? Infinity : 0;
              setDubEpisodeCount(detailDubCount);
              setEpisodes(nextEpisodes);
              setKnownEpisodeCount((current) => Math.max(current ?? 0, nextEpisodes.length));
              setDetailHint(`Episode sources available via ${candidate.provider.toUpperCase()}`);
              return;
            }
          } catch {
            continue;
          }
        }
        if (!cancelled) {
          setDetailHint(
            consumetHealthy
              ? "Episode metadata is limited right now. GRABIX will keep using fallback playback providers."
              : "Episode metadata is limited, but GRABIX fallback playback is still available."
          );
        }
      })();
    }).catch(() => {
      if (!cancelled) {
        setFinding(false);
        setDetailHint("Playback information could not be resolved right now.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [anime.id, anime.provider, anime.title, anime.alt_title, consumetHealthy]);

  useEffect(() => {
    let cancelled = false;
    if (anime.trailer_url) {
      setTrailerUrl(anime.trailer_url);
      return () => {
        cancelled = true;
      };
    }

    void fetchJikanTrailerUrl(anime.mal_id, anime.title).then((url) => {
      if (!cancelled && url) {
        setTrailerUrl(url);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [anime.mal_id, anime.title, anime.trailer_url]);

    const loadDownloadOptions = async (
      requestedLanguage = downloadLanguage,
      requestedServer = downloadServer
    ) => {
      setDownloadDialogLoading(true);
      setDownloadDialogError("");
      try {
        if (requestedLanguage === "hindi") {
          const sources = await resolveHindiMovieBoxSources(episode);
          if (sources.length === 0) {
            setDownloadQualityOptions([]);
            setDownloadSubtitleTracks([]);
            setDownloadIncludeSubtitle(false);
            setDownloadQuality("");
            setDownloadDialogError("No Hindi source available. Try downloading in English.");
            return;
          }
          const options = await resolveSourceDownloadOptions(sources);
          setDownloadQualityOptions(options);
          setDownloadSubtitleTracks((sources[0]?.subtitles ?? []).filter((track) => Boolean(track.url)).map((track) => ({
            label: track.label,
            url: track.url,
            headers: sources[0]?.requestHeaders,
          })));
          setDownloadIncludeSubtitle(false);
          setDownloadQuality(options[0]?.id || "");
          return;
        }

        const requestedAudio = requestedLanguage === "dub" ? "en" : "original";
        let source = await resolveAnimeSourceViaBackend(episode, "download", {
          audio: requestedAudio,
          server: requestedServer,
        });
        if (!source && requestedServer !== "auto") {
          source = await resolveAnimeSourceViaBackend(episode, "download", {
            audio: requestedAudio,
            server: "auto",
          });
        }
        if (!source) {
          source = await resolveAnimeSourceViaBackend(episode, "play", {
            audio: requestedAudio,
            server: requestedServer,
          });
        }
        if (!source && requestedServer !== "auto") {
          source = await resolveAnimeSourceViaBackend(episode, "play", {
            audio: requestedAudio,
            server: "auto",
          });
        }
        if (!source) {
          const movieBoxSources = await resolveMovieBoxAnimeSources(episode);
          source = movieBoxSources[0] ?? null;
        }
        if (!source) {
          setDownloadQualityOptions([]);
          setDownloadSubtitleTracks([]);
          setDownloadIncludeSubtitle(false);
          setDownloadQuality("");
          setDownloadDialogError("No downloadable source was found for that selection.");
          return;
        }
        const options = await resolveSourceDownloadOptions([source]);
        if (options.length === 0) {
          setDownloadQualityOptions([]);
          setDownloadSubtitleTracks([]);
          setDownloadIncludeSubtitle(false);
          setDownloadQuality("");
          setDownloadDialogError("No downloadable quality was found for that selection.");
          return;
        }
        setDownloadQualityOptions(options);
        const subtitles = (source.subtitles ?? [])
          .filter((track) => Boolean(track.url))
          .map((track) => ({
            label: track.label,
            url: track.url,
            headers: source?.requestHeaders,
          }));
        setDownloadSubtitleTracks(subtitles);
        setDownloadIncludeSubtitle(requestedLanguage === "sub" && subtitles.length > 0);
        setDownloadQuality(options[0]?.id || "");
      } catch (error) {
        setDownloadQualityOptions([]);
        setDownloadSubtitleTracks([]);
        setDownloadIncludeSubtitle(false);
        setDownloadQuality("");
        setDownloadDialogError(error instanceof Error ? error.message : "Download options could not be loaded.");
      } finally {
        setDownloadDialogLoading(false);
      }
  };

  useEffect(() => {
    if (!downloadDialogOpen) return;
    void loadDownloadOptions(downloadLanguage, downloadServer);
  }, [downloadDialogOpen, downloadLanguage, downloadServer, episode]);

  const getWatchCandidates = () => (
    resolvedAnime
      ? [resolvedAnime, ...candidateAnimes.filter((item) => `${item.provider}-${item.id}` !== `${resolvedAnime.provider}-${resolvedAnime.id}`)]
      : candidateAnimes
  );

  const resolveAnimeSourceViaBackend = async (
    targetEpisode = episode,
    purpose: "play" | "download" = "play",
    overrides?: { audio?: AudioPreference; server?: AnimeServerOption }
  ): Promise<StreamSource | null> => {
    const rawNormalizedAudio = normalizeAudioPreference(overrides?.audio ?? audio);
    // If user wants Hindi but this anime has no Hindi track, fall back to sub
    // so hianime is tried instead of jumping straight to MovieBox.
    const animeLanguages: string[] = anime.languages ?? [];
    const normalizedAudio = (rawNormalizedAudio === "hi" && !animeLanguages.includes("hi"))
      ? "sub"
      : rawNormalizedAudio;
    if (normalizedAudio === "hi") return null;
    const requestedServer = overrides?.server ?? server;
    const cacheKey = `${purpose}:${normalizedAudio}:${requestedServer}:${targetEpisode}`;
    const cached = resolvedSourceCacheRef.current[cacheKey];
    if (cached) return cached;
    const pending = resolvedSourcePromiseCacheRef.current[cacheKey];
    if (pending) return pending;

    const request = (async () => {
      let lastMessage = "";
      try {
        const sources = await resolveAnimePlaybackSources({
          title: anime.title,
          altTitle: anime.alt_title || "",
          altTitles: expandAnimeTitles(anime.title, anime.alt_title).slice(1),
          tmdbId,
          fallbackSeason: 1,
          fallbackEpisode: targetEpisode,
          episodeNumber: targetEpisode,
          audio: normalizedAudio,
          server: requestedServer,
          isMovie,
          purpose,
          candidates: getWatchCandidates().map((candidate) => ({
            provider: candidate.provider,
            animeId: candidate.id,
            episodeId: (candidate as any).episode_id || (candidate as any).episodeId || undefined,
            title: candidate.title,
            altTitle: candidate.alt_title || "",
          })),
        });
        const resolvedSource = sources[0] ?? null;
        if (resolvedSource) {
          resolvedSourceCacheRef.current[cacheKey] = resolvedSource;
        }
        return resolvedSource;
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : "";
      }

      if (lastMessage) {
        throw new Error(lastMessage);
      }
      return null;
    })();

    resolvedSourcePromiseCacheRef.current[cacheKey] = request;
    try {
      return await request;
    } finally {
      delete resolvedSourcePromiseCacheRef.current[cacheKey];
    }
  };

  const resolveMovieBoxAnimeSources = async (
    targetEpisode = episode,
    options?: { preferHindi?: boolean }
  ): Promise<StreamSource[]> => {
    const preferHindi = Boolean(options?.preferHindi);
    const titleCandidates = expandAnimeTitles(anime.title, anime.alt_title).slice(0, 6);
    const movieBoxMatches = new Map<string, { id: string; title?: string; year?: number; moviebox_media_type?: "movie" | "series"; is_hindi?: boolean }>();

    for (const candidateTitle of titleCandidates) {
      try {
        const result = await searchMovieBox({
          query: candidateTitle,
          page: 1,
          perPage: 8,
          mediaType: "anime",
          animeOnly: true,
          preferHindi,
          sortBy: "search",
        });
        for (const item of result.items) {
          movieBoxMatches.set(item.id, item);
        }
      } catch {
        continue;
      }
    }

    const rankedMovieBoxMatches = [...movieBoxMatches.values()].sort((left, right) => {
      if (preferHindi && Boolean(left.is_hindi) !== Boolean(right.is_hindi)) {
        return left.is_hindi ? -1 : 1;
      }
      return 0;
    });

    for (const item of rankedMovieBoxMatches.slice(0, 6)) {
      try {
        const movieBoxSources = await fetchMovieBoxSources({
          subjectId: item.id,
          title: item.title || title,
          mediaType: item.moviebox_media_type === "movie" ? "movie" : "series",
          year: item.year,
          season: 1,
          episode: targetEpisode,
        });
        if (movieBoxSources.length > 0) return movieBoxSources;
      } catch {
        continue;
      }
    }

    for (const candidateTitle of titleCandidates) {
      try {
        const movieBoxSources = await fetchMovieBoxSources({
          title: candidateTitle,
          mediaType: isMovie ? "movie" : "anime",
          season: 1,
          episode: targetEpisode,
        });
        if (movieBoxSources.length > 0) return movieBoxSources;
      } catch {
        if (isMovie) continue;
        try {
          const seriesSources = await fetchMovieBoxSources({
            title: candidateTitle,
            mediaType: "series",
            season: 1,
            episode: targetEpisode,
          });
          if (seriesSources.length > 0) return seriesSources;
        } catch {
          continue;
        }
      }
    }

    return [];
  };

  const resolveHindiMovieBoxSources = async (targetEpisode = episode): Promise<StreamSource[]> =>
    resolveMovieBoxAnimeSources(targetEpisode, { preferHindi: true });

  const isHiAnimePrimarySource = (source: StreamSource): boolean => {
    const provider = `${source.provider || ""} ${source.description || ""}`.toLowerCase();
    // hianime/aniwatch IS our primary source — MovieBox is the supplement
    return provider.includes("moviebox") || provider.includes("movie box");
  };

  const mergeAnimeFallbackSources = async (
    primarySources: StreamSource[],
    targetEpisode = episode
  ): Promise<StreamSource[]> => {
    const normalizedAudio = normalizeAudioPreference(audio);
    if (normalizedAudio === "hi") {
      return primarySources;
    }

    const movieBoxSources = await resolveMovieBoxAnimeSources(targetEpisode);
    if (movieBoxSources.length === 0) {
      return primarySources;
    }

    if (primarySources.length === 0) {
      return movieBoxSources;
    }

    const primaryLooksFragile = primarySources.every(isHiAnimePrimarySource);
    if (!primaryLooksFragile) {
      return primarySources;
    }

    const merged: StreamSource[] = [];
    const seen = new Set<string>();
    for (const source of [...movieBoxSources, ...primarySources]) {
      const key = `${source.provider}|${source.url}|${source.language || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(source);
    }
    return merged;
  };

  const resolvePlayableSources = async (targetEpisode = episode): Promise<StreamSource[]> => {
    const normalizedAudio = normalizeAudioPreference(audio);
    const tmdbEpisode = await resolveTmdbEpisodeNumber(tmdbId, targetEpisode);
    return await resolveAnimePlaybackSources({
      title: anime.title,
      altTitle: anime.alt_title || "",
      altTitles: expandAnimeTitles(anime.title, anime.alt_title).slice(1),
      tmdbId,
      fallbackSeason: tmdbEpisode?.season ?? 1,
      fallbackEpisode: tmdbEpisode?.episode ?? targetEpisode,
      episodeNumber: targetEpisode,
      audio: normalizedAudio,
      server,
      isMovie,
      purpose: "play",
      candidates: getWatchCandidates().map((candidate) => ({
        provider: candidate.provider,
        animeId: candidate.id,
        episodeId: (candidate as any).episode_id || (candidate as any).episodeId || undefined,
        title: candidate.title,
        altTitle: candidate.alt_title || "",
      })),
    });
  };

  const buildSubtitleText = (targetEpisode = episode) => {
    const normalizedAudio = normalizeAudioPreference(audio);
    return normalizedAudio === "hi"
      ? `Hindi playback from Movie Box - ${selectionLabel} ${targetEpisode}`
      : `Anime playback with ${normalizedAudio === "en" ? "English dub" : "sub"} preference - ${selectionLabel} ${targetEpisode}`;
  };

  const buildSubtitleSearchTitle = (targetEpisode = episode) =>
    `${title} ${selectionLabel} ${targetEpisode}`.trim();

  const playerServerOptions = (() => {
    const normalizedAudio = normalizeAudioPreference(audio);
    const subOptions = [
      { id: "hd-1:original", label: "AniWatch SUB" },
      { id: "hd-2:original", label: "AniWatch SUB-2" },
    ];
    const dubOptions = hasDub
      ? [{ id: "hd-1:en", label: "AniWatch DUB" }, { id: "hd-2:en", label: "AniWatch DUB-2" }]
      : [];
    return normalizedAudio === "en" ? [...dubOptions, ...subOptions] : [...subOptions, ...dubOptions];
  })();

  const resolvePlayerServerOption = async (optionId: string, targetEpisode = episode) => {
    const [requestedServer, requestedAudio] = optionId.split(":") as [AnimeServerOption, AudioPreference];
    const source = await resolveAnimeSourceViaBackend(targetEpisode, "play", {
      audio: requestedAudio,
      server: requestedServer,
    });
    if (!source) {
      throw new Error(`No playable source was found for ${optionId.replace(":", " ").toUpperCase()}.`);
    }
    return {
      sources: [source],
      subtitle: requestedAudio === "en"
        ? `Anime playback with English dub - ${selectionLabel} ${targetEpisode}`
        : `Anime playback with subtitles - ${selectionLabel} ${targetEpisode}`,
      subtitleSearchTitle: buildSubtitleSearchTitle(targetEpisode),
    };
  };

  const buildInstantPlayableSources = (targetEpisode = episode): StreamSource[] => {
    const normalizedAudio = normalizeAudioPreference(audio);
    const cachedResolved = resolvedSourceCacheRef.current[`play:${normalizedAudio}:${server}:${targetEpisode}`];
    if (cachedResolved) {
      return [cachedResolved];
    }
    return [];
  };

  useEffect(() => {
    const normalizedAudio = normalizeAudioPreference(audio);
    if (normalizedAudio === "hi") return;
    let cancelled = false;

    const warm = async () => {
      try {
        const preferredServers: AnimeServerOption[] = server === "auto" ? ["hd-1", "hd-2"] : [server];
        await Promise.allSettled([
          resolveAnimeSourceViaBackend(episode, "play"),
          ...preferredServers.map((preferredServer) =>
            resolveAnimeSourceViaBackend(episode, "play", {
              audio: normalizedAudio,
              server: preferredServer,
            })
          ),
        ]);
        if (!cancelled && totalEpisodes > episode) {
          await resolveAnimeSourceViaBackend(episode + 1, "play", {
            audio: normalizedAudio,
            server,
          });
        }
      } catch {
        // Warm the cache quietly; handle real errors on user action.
      }
    };

    void warm();
    return () => {
      cancelled = true;
    };
  }, [audio, server, episode, totalEpisodes, resolvedAnime, candidateAnimes]);

  const buildPlayerPayload = async (targetEpisode = episode) => {
    const sources = await mergeAnimeFallbackSources(await resolvePlayableSources(targetEpisode), targetEpisode);
    const normalizedAudio = normalizeAudioPreference(audio);
    if (sources.length === 0) {
      if (normalizedAudio !== "hi") {
        const fallbackSources = await resolveMovieBoxAnimeSources(targetEpisode);
        if (fallbackSources.length > 0) {
          return {
            sources: fallbackSources,
            subtitle: buildSubtitleText(targetEpisode),
            subtitleSearchTitle: buildSubtitleSearchTitle(targetEpisode),
          };
        }
      }
      throw new Error(
        normalizedAudio === "hi"
          ? "No Hindi sources were found for this title."
          : `No playable anime sources were found for ${selectionLabel.toLowerCase()} ${targetEpisode}.`
      );
    }

    return {
      sources,
      subtitle: buildSubtitleText(targetEpisode),
      subtitleSearchTitle: buildSubtitleSearchTitle(targetEpisode),
    };
  };

  const handlePlay = async () => {
    if (playing) return;
    const normalizedAudio = normalizeAudioPreference(audio);
    const instantSources = normalizedAudio === "hi" ? [] : buildInstantPlayableSources(episode);

    if (instantSources.length > 0) {
      onPlay({
        title,
        subtitle: buildSubtitleText(episode),
        subtitleSearchTitle: buildSubtitleSearchTitle(episode),
        poster: anime.image,
        sources: instantSources,
        mediaType: isMovie ? "movie" : "tv",
        currentEpisode: episode,
        episodeOptions: totalEpisodes > 1 ? Array.from({ length: totalEpisodes }, (_, index) => index + 1) : undefined,
        episodeLabel: selectionLabel,
        sourceOptions: normalizeAudioPreference(audio) === "hi" ? undefined : [...playerServerOptions],
        onSelectSourceOption: normalizeAudioPreference(audio) === "hi"
          ? undefined
          : async (optionId: string, nextEpisode?: number) => resolvePlayerServerOption(optionId, nextEpisode ?? episode),
        onSelectEpisode: async (nextEpisode: number) => {
          const nextInstantSources = buildInstantPlayableSources(nextEpisode);
          if (nextInstantSources.length > 0) {
            return {
              sources: nextInstantSources,
              subtitle: buildSubtitleText(nextEpisode),
              subtitleSearchTitle: buildSubtitleSearchTitle(nextEpisode),
            };
          }
          return buildPlayerPayload(nextEpisode);
        },
      });
      return;
    }

    setPlaying(true);

    try {
      const initialPayload = await buildPlayerPayload(episode);
      onPlay({
        title,
        subtitle: initialPayload.subtitle,
        subtitleSearchTitle: initialPayload.subtitleSearchTitle,
        poster: anime.image,
        sources: initialPayload.sources,
        mediaType: isMovie ? "movie" : "tv",
        currentEpisode: episode,
        episodeOptions: totalEpisodes > 1 ? Array.from({ length: totalEpisodes }, (_, index) => index + 1) : undefined,
        episodeLabel: selectionLabel,
        sourceOptions: normalizeAudioPreference(audio) === "hi" ? undefined : [...playerServerOptions],
        onSelectSourceOption: normalizeAudioPreference(audio) === "hi"
          ? undefined
          : async (optionId: string, nextEpisode?: number) => resolvePlayerServerOption(optionId, nextEpisode ?? episode),
        onSelectEpisode: async (nextEpisode: number) => buildPlayerPayload(nextEpisode),
      });
      return;
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "No playable anime sources were found for this episode.",
        variant: "error",
      });
    } finally {
      setPlaying(false);
    }
  };

  const confirmDownloadSelection = async () => {
    if (downloading) return;
    const selectedOption = downloadQualityOptions.find((option) => option.id === downloadQuality);
    if (!selectedOption) {
      setDownloadDialogError("Choose a quality before downloading.");
      return;
    }
    if (downloadLanguage === "sub" && downloadIncludeSubtitle && downloadSubtitleTracks.length === 0) {
      setDownloadDialogError("No subtitle file is available for this episode.");
      return;
    }

    const languageLabel = downloadLanguage === "hindi" ? "Hindi" : downloadLanguage === "dub" ? "Dub" : "Sub";
    const formattedTitle = isMovie
      ? `${title} — ${languageLabel} — ${selectedOption.label}`
      : `${title} — ${selectionLabel} ${String(episode).padStart(2, "0")} — ${languageLabel} — ${selectedOption.label}`;

    setDownloading(true);
    try {
      await queueVideoDownload({
        url: selectedOption.url,
        title: formattedTitle,
        thumbnail: anime.image,
        headers: selectedOption.headers,
        forceHls: selectedOption.forceHls,
        category: "Anime",
        tags: [languageLabel, isMovie ? "Movie" : selectionLabel],
      });
      if (downloadIncludeSubtitle && downloadSubtitleTracks[0]?.url) {
        const subtitleTitle = isMovie
          ? `${title} Subtitle`
          : `${title} EP ${episode} Subtitle`;
        await queueSubtitleDownload({
          url: downloadSubtitleTracks[0].url,
          title: subtitleTitle,
          headers: downloadSubtitleTracks[0].headers,
          category: "Anime",
          tags: ["Subtitle", isMovie ? "Movie" : selectionLabel],
        });
      }
      setDownloadDialogOpen(false);
    } catch (error) {
      setDownloadDialogError(error instanceof Error ? error.message : "Download could not be started.");
    } finally {
      setDownloading(false);
    }
  };

    const handleDownload = async () => {
      if (downloading) return;
      setDownloadLanguage(hasHindiFallback ? "dub" : "sub");
      setDownloadServer("auto");
      setDownloadQuality("");
      setDownloadQualityOptions([]);
      setDownloadSubtitleTracks([]);
      setDownloadIncludeSubtitle(!hasHindiFallback);
      setDownloadDialogError("");
      setDownloadDialogOpen(true);
    };

  const handleSubtitleOnlyDownload = async () => {
    if (downloading) return;
    const subtitleTrack = downloadSubtitleTracks[0];
    if (!subtitleTrack?.url) {
      setDownloadDialogError("No subtitle file is available for this episode.");
      return;
    }

    setDownloading(true);
    try {
      await queueSubtitleDownload({
        url: subtitleTrack.url,
        title: isMovie ? `${title} Subtitle` : `${title} EP ${episode} Subtitle`,
        headers: subtitleTrack.headers,
        category: "Anime",
        tags: ["Subtitle", isMovie ? "Movie" : selectionLabel],
      });
      setDownloadDialogOpen(false);
    } catch (error) {
      setDownloadDialogError(error instanceof Error ? error.message : "Subtitle download could not be started.");
    } finally {
      setDownloading(false);
    }
  };

  const handleTrailer = () => {
    if (!trailerUrl) {
      setToast({ message: "Trailer is not available for this title.", variant: "info" });
      return;
    }
    onPlay({
      title: `${title} Trailer`,
      subtitle: "Official trailer playback",
      subtitleSearchTitle: `${title} Trailer`,
      poster: anime.image,
      mediaType: "movie",
      sources: [{
        id: `trailer-${anime.id}`,
        label: "Trailer",
        provider: "Trailer",
        kind: "embed",
        url: trailerUrl,
        description: "Official trailer",
        quality: "Preview",
        externalUrl: trailerUrl,
        canExtract: false,
      }],
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 16, width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", gap: 16, padding: "20px 20px 0" }}>
          <img src={anime.image || "https://via.placeholder.com/100x145"} alt={title} referrerPolicy="no-referrer" style={{ width: 100, height: 145, objectFit: "cover", borderRadius: 10, flexShrink: 0, border: "1px solid var(--border)" }} onError={(e) => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/100x145"; }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, lineHeight: 1.3 }}>{title}</div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 8 }}>
              {anime.rating ? <span style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 600, color: "#fdd663" }}><IconStar size={11} color="#fdd663" /> {anime.rating.toFixed(1)}</span> : null}
              {isMovie ? (
                totalEpisodes > 1
                  ? <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>{totalEpisodes} parts</span>
                  : <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>Movie</span>
              ) : totalEpisodes ? <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>{totalEpisodes} eps</span> : null}
              {anime.status ? <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>{anime.status}</span> : null}
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {(anime.genres ?? []).slice(0, 4).map((genre) => <span key={genre} style={{ background: "var(--bg-active)", color: "var(--text-accent)", padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 500 }}>{genre}</span>)}
            </div>
          </div>
          <button className="btn-icon" style={{ alignSelf: "flex-start", flexShrink: 0 }} onClick={onClose}><IconX size={16} /></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px 24px" }}>
          {anime.description && <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 16 }}>{anime.description.length > 380 ? `${anime.description.slice(0, 380)}...` : anime.description}</div>}
          <div style={{ fontSize: 12, color: finding ? "var(--text-muted)" : resolvedAnime ? "var(--text-success)" : "var(--text-warning)", marginBottom: 14 }}>
            {finding ? "Resolving anime providers..." : detailHint || "Fallback playback only"}
          </div>

          {(!isMovie || totalEpisodes > 1) && (
          <div style={{ marginBottom: 18, padding: "14px 14px 12px", borderRadius: 14, background: "var(--bg-surface2)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 700 }}>{isMovie ? "Parts" : "Episodes"}</div>
              {episodeGroups > 1 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {Array.from({ length: episodeGroups }, (_, index) => {
                    const start = index * 50 + 1;
                    const end = Math.min(totalEpisodes, start + 49);
                    return (
                      <button key={`${start}-${end}`} className={`quality-chip${selectedGroup === index ? " active" : ""}`} onClick={() => setEpisode(start)} style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600 }}>
                        {start}-{end}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", maxHeight: 176, overflowY: "auto", paddingRight: 4 }}>
              {visibleEpisodes.map((value) => (
                <button key={value} className={`quality-chip${episode === value ? " active" : ""}`} onClick={() => setEpisode(value)} style={{ padding: "9px 14px", fontSize: 13, fontWeight: 700, minWidth: 52 }}>
                  {value}
                </button>
              ))}
            </div>
          </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: audio !== "hi" ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)", gap: 12, marginBottom: 18, padding: "10px 0 0" }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Audio</div>
              <div className="anime-option-grid compact">
                {AUDIO_BUTTONS.filter((option) => (option.id !== "hi" || hasHindiFallback) && (option.id !== "en" || hasDub || dubEpisodeCount === null)).map((option) => (
                  option.id === "en" && dubEpisodeCount === null ? (
                    // Skeleton shimmer — dub availability is still loading
                    <button
                      key={option.id}
                      className="anime-option-btn compact"
                      disabled
                      type="button"
                      style={{ cursor: "default", opacity: 0.7 }}
                    >
                      <strong className="pulse" style={{ display: "inline-block", background: "var(--border)", borderRadius: 4, color: "transparent", minWidth: 28, lineHeight: 1.6 }}>Dub</strong>
                      <span className="pulse" style={{ display: "inline-block", background: "var(--border)", borderRadius: 3, color: "transparent", minWidth: 72, lineHeight: 1.6 }}>Checking…</span>
                    </button>
                  ) : (
                  <button
                    key={option.id}
                    className={`anime-option-btn compact${audio === option.id ? " active" : ""}`}
                    onClick={() => setAudio(option.id)}
                    type="button"
                  >
                    <strong>{option.label}</strong>
                    <span>{option.help}</span>
                  </button>
                  )
                ))}
              </div>
            </div>
            {audio !== "hi" && (
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Server</div>
              <div className="anime-option-grid compact">
                {SERVER_BUTTONS.map((option) => (
                  <button
                    key={option.id}
                    className={`anime-option-btn compact${server === option.id ? " active" : ""}`}
                    onClick={() => setServer(option.id)}
                    type="button"
                  >
                    <strong>{option.label}</strong>
                    <span>{option.help}</span>
                  </button>
                ))}
              </div>
            </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
            <button className="btn btn-primary" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={() => void handlePlay()} disabled={playing}>
              <IconPlay size={15} /> {playing ? "Loading..." : "Play"}
            </button>
            <button className="btn btn-ghost" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={() => void handleDownload()} disabled={downloading}>
              <IconDownload size={15} /> {downloading ? "Queueing..." : "Download"}
            </button>
            <button className="btn btn-ghost" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={handleTrailer} disabled={!hasTrailer}>
              <IconPlay size={15} /> Trailer
            </button>
            <button className="btn btn-ghost" style={{ gap: 7, flex: 1, justifyContent: "center", color: fav ? "var(--text-danger)" : "var(--text-primary)" }} onClick={() => toggle({ id: `anime-${anime.mal_id ?? `${anime.provider}-${anime.id}`}`, title, poster: anime.image || "", type: "anime", malId: anime.mal_id, tmdbId: tmdbId ?? undefined })}>
              <IconHeart size={15} color={fav ? "var(--text-danger)" : "currentColor"} filled={fav} />
              {fav ? "Saved" : "Favorite"}
            </button>
          </div>
        </div>
      </div>
      <DownloadOptionsModal
        visible={downloadDialogOpen}
        title={title}
        poster={anime.image}
        languageOptions={[
          { id: "sub", label: "Sub" },
          { id: "dub", label: "Dub" },
          ...(hasHindiFallback ? [{ id: "hindi", label: "Hindi" }] : []),
        ]}
        selectedLanguage={downloadLanguage}
        onSelectLanguage={(value) => setDownloadLanguage(value as "sub" | "dub" | "hindi")}
        serverOptions={downloadLanguage === "hindi" ? [] : [
          { id: "auto", label: "Auto" },
          { id: "hd-1", label: "HD-1" },
          { id: "hd-2", label: "HD-2" },
        ]}
        selectedServer={downloadServer}
        onSelectServer={(value) => setDownloadServer(value as AnimeServerOption)}
        qualityOptions={downloadQualityOptions.map((option) => ({ id: option.id, label: option.label }))}
        selectedQuality={downloadQuality}
        onSelectQuality={setDownloadQuality}
        loading={downloadDialogLoading || downloading}
        error={downloadDialogError}
        extraContent={
          <div style={{ display: "grid", gap: 10 }}>
            {(downloadLanguage === "sub" || downloadSubtitleTracks.length > 0) && (
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-primary)" }}>
                <input
                  type="checkbox"
                  checked={downloadIncludeSubtitle}
                  disabled={downloadLanguage === "sub" || downloadSubtitleTracks.length === 0}
                  onChange={(event) => setDownloadIncludeSubtitle(event.target.checked)}
                />
                <span>
                  {downloadLanguage === "sub"
                    ? "Download subtitle too (required for Sub)"
                    : "Download subtitle too"}
                </span>
              </label>
            )}
            {downloadSubtitleTracks.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-surface2)" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>Subtitle file</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {downloadSubtitleTracks[0].label || "Episode subtitle"}
                  </div>
                </div>
                <button className="btn btn-ghost" type="button" onClick={() => void handleSubtitleOnlyDownload()} disabled={downloadDialogLoading || downloading}>
                  Subtitle Only
                </button>
              </div>
            )}
          </div>
        }
        onClose={() => setDownloadDialogOpen(false)}
        onConfirm={() => void confirmDownloadSelection()}
      />
      {toast ? <AppToast message={toast.message} variant={toast.variant} onClose={() => setToast(null)} /> : null}
    </div>
  );
}

function LoadingGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
      {Array.from({ length: 16 }).map((_, index) => (
        <div key={index} className="card" style={{ overflow: "hidden" }}>
          <div style={{ width: "100%", height: 210, background: "var(--bg-surface2)" }} />
          <div style={{ padding: "8px 10px" }}>
            <div style={{ height: 12, background: "var(--bg-surface2)", borderRadius: 4, marginBottom: 6 }} />
            <div style={{ height: 10, background: "var(--bg-surface2)", borderRadius: 4, width: "60%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
