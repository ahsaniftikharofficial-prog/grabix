/**
 * AnimePageV2.tsx
 *
 * Streaming logic mirrors anime.py — hits Consumet directly via
 * /consumet/watch/anime instead of the broken /providers/resolve/anime chain.
 *
 * Browse/discover: same aniwatch + Jikan stack (already works)
 * Episode fetch:   /consumet/episodes/anime?id={id}&provider=hianime
 * Stream:          /consumet/watch/anime?episode_id={epId}&provider=hianime&audio={sub|en}
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconDownload,
  IconPlay,
  IconSearch,
  IconStar,
  IconX,
} from "../components/Icons";
import { IconHeart } from "../components/Icons";
import VidSrcPlayer from "../components/VidSrcPlayer";
import AppToast from "../components/AppToast";
import { PageEmptyState, PageErrorState } from "../components/PageStates";
import { useFavorites } from "../context/FavoritesContext";
import { useContentFilter } from "../context/ContentFilterContext";
import { filterAdultContent } from "../lib/contentFilter";
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
import type { ConsumetMediaSummary } from "../lib/consumetProviders";
import { BACKEND_API } from "../lib/api";
import type { StreamSource } from "../lib/streamProviders";
import CachedImage from "../components/CachedImage";
import { queueVideoDownload } from "../lib/downloads";

// ─── Types ──────────────────────────────────────────────────────────────────

type Tab =
  | "trending"
  | "popular"
  | "toprated"
  | "seasonal"
  | "movie"
  | "schedule"
  | "genre";

type TrendingPeriod = "daily" | "weekly" | "monthly";
type AudioMode = "sub" | "dub";

interface AnimeItem extends ConsumetMediaSummary {
  episodes_count?: number;
}

interface RawEpisode {
  id: string;
  number: number;
  title?: string;
  isFiller?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const BACKEND = BACKEND_API;

function toItem(m: ConsumetMediaSummary): AnimeItem {
  return {
    ...m,
    image: normalizeImage(m.image),
    episodes_count: m.episodes_count,
  };
}

function normalizeImage(value?: string | null): string {
  const url = (value || "").trim();
  if (!url) return "";
  if (url.startsWith("/")) return `${BACKEND}${url}`;
  const full = url.startsWith("//") ? `https:${url}` : url;
  if (full.startsWith(BACKEND) || full.includes("/consumet/proxy?url="))
    return full;
  if (/^https?:\/\//i.test(full))
    return `${BACKEND}/consumet/proxy?url=${encodeURIComponent(full)}`;
  return full;
}

function dedupeItems(items: AnimeItem[]): AnimeItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.provider}-${item.id}`;
    if (!item.id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchJikanFallback(query: string, page = 1): Promise<AnimeItem[]> {
  const r = await fetch(
    `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&page=${page}&limit=20&sfw=true`
  );
  const data = (await r.json()) as {
    data?: Array<{
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
    }>;
  };
  return (data.data ?? []).map((item) => ({
    id: String(item.mal_id),
    provider: "jikan" as const,
    type: "anime" as const,
    title: item.title_english ?? item.title,
    alt_title: item.title,
    image: normalizeImage(item.images.jpg.large_image_url ?? item.images.jpg.image_url),
    description: item.synopsis,
    year: item.year,
    rating: item.score ?? null,
    status: item.status,
    genres: (item.genres ?? []).map((g) => g.name),
    languages: ["original"],
    episodes_count: item.episodes,
    raw: item,
  }));
}

async function jikanDiscover(tab: Tab, page = 1): Promise<AnimeItem[]> {
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
  const r = await fetch(`https://api.jikan.moe/v4${path}`);
  const data = (await r.json()) as { data?: Parameters<typeof toJikan>[0][] };
  return (data.data ?? []).map(toJikan);
}

function toJikan(item: {
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
}): AnimeItem {
  return {
    id: String(item.mal_id),
    provider: "jikan" as const,
    type: "anime" as const,
    title: item.title_english ?? item.title,
    alt_title: item.title,
    image: normalizeImage(item.images.jpg.large_image_url ?? item.images.jpg.image_url),
    description: item.synopsis,
    year: item.year,
    rating: item.score ?? null,
    status: item.status,
    genres: (item.genres ?? []).map((g) => g.name),
    languages: ["original"],
    episodes_count: item.episodes,
    raw: item,
  };
}

// ─── Core streaming — mirrors anime.py exactly via a raw backend pass-through ─
//
// anime.py works because Python bypasses browser CORS.
// The browser CAN'T call port 3000 directly (CORS blocks it).
// Solution: /consumet/watch/anime/raw — a Python route that does the exact
// same thing anime.py does (raw httpx call, no normalization, no filtering)
// and returns whatever Consumet gives back.

const CONSUMET_RAW_SERVERS = ["vidcloud", "vidstreaming"] as const;

async function fetchDirectStream(
  episodeId: string,
  audio: AudioMode
): Promise<{ sources: StreamSource[]; subtitles: Array<{ url: string; lang: string }> }> {
  const category = audio === "dub" ? "dub" : "sub";

  // Try both servers, both audio tracks — same logic as anime.py
  const attempts = [
    { server: "vidcloud", category },
    { server: "vidstreaming", category },
    { server: "vidcloud", category: category === "sub" ? "dub" : "sub" },
    { server: "vidstreaming", category: category === "sub" ? "dub" : "sub" },
  ];

  for (const attempt of attempts) {
    try {
      const params = new URLSearchParams({
        episode_id: episodeId,
        server: attempt.server,
        category: attempt.category,
      });
      const r = await fetch(`${BACKEND}/consumet/watch/anime/raw?${params}`, {
        signal: AbortSignal.timeout(32000),
      });

      if (!r.ok) continue;

      const data = (await r.json()) as {
        sources?: Array<{ url?: string; quality?: string; isM3U8?: boolean; type?: string; isEmbed?: boolean }>;
        subtitles?: Array<{ url?: string; lang?: string }>;
        headers?: Record<string, string>;
        error?: string;
      };

      if (data.error || !data.sources?.length) continue;

      // Take ALL sources — including embed — unlike the old chain which discarded embeds
      const sources: StreamSource[] = data.sources
        .filter((s) => s.url)
        .map((s, i) => {
          const url = s.url!;
          const isM3U8 = s.isM3U8 || url.includes(".m3u8");
          const isEmbed = s.isEmbed || s.type === "embed";
          return {
            id: `hianime-${attempt.server}-${attempt.category}-${i}`,
            label: s.quality || "Auto",
            provider: "HiAnime",
            kind: (isEmbed ? "embed" : isM3U8 ? "hls" : "direct") as StreamSource["kind"],
            url,
            quality: s.quality || "Auto",
            description: `HiAnime ${attempt.category.toUpperCase()} via ${attempt.server}`,
            requestHeaders: data.headers ?? {},
          };
        });

      if (sources.length === 0) continue;

      const subtitles = (data.subtitles ?? [])
        .filter((s) => s.url && s.lang)
        .map((s) => ({ url: s.url!, lang: s.lang! }));

      return { sources, subtitles };
    } catch {
      continue;
    }
  }

  throw new Error(
    "No stream found.\n\n" +
    "Tried: vidcloud + vidstreaming (SUB + DUB) via /consumet/watch/anime/raw.\n\n" +
    "Run anime.py in your terminal to confirm the Consumet sidecar (port 3000) is alive. " +
    "If anime.py also fails, restart the Consumet sidecar."
  );
}

async function fetchEpisodes(animeId: string): Promise<RawEpisode[]> {
  const params = new URLSearchParams({ id: animeId, provider: "hianime" });
  const r = await fetch(`${BACKEND}/consumet/episodes/anime?${params}`);
  if (!r.ok) return [];
  const data = (await r.json()) as { items?: RawEpisode[] };
  return data.items ?? [];
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AnimePageV2() {
  const { adultContentBlocked } = useContentFilter();
  const [tab, setTab] = useState<Tab>("trending");
  const [trendingPeriod, setTrendingPeriod] = useState<TrendingPeriod>("daily");
  const [items, setItems] = useState<AnimeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [browseError, setBrowseError] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<AnimeItem | null>(null);
  const [player, setPlayer] = useState<{
    title: string;
    subtitle?: string;
    poster?: string;
    sources: StreamSource[];
    mediaType?: "movie" | "tv";
    currentEpisode?: number;
    episodeOptions?: number[];
    episodeLabel?: string;
    onSelectEpisode?: (ep: number) => Promise<{ sources: StreamSource[]; subtitle?: string }>;
  } | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [genres, setGenres] = useState<AniwatchGenre[]>([]);
  const [selectedGenre, setSelectedGenre] = useState("");
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().slice(0, 10));
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

  const filteredItems = useMemo(
    () => filterAdultContent(items, adultContentBlocked),
    [items, adultContentBlocked]
  );

  // ── Data loaders ────────────────────────────────────────────────────────

  const loadDiscover = async (nextTab: Tab, nextPage = 1, period: TrendingPeriod = trendingPeriod) => {
    if (nextTab === "schedule" || nextTab === "genre") return;
    setLoading(true);
    setBrowseError("");
    try {
      const result = await fetchAniwatchDiscover(nextTab as AniwatchSection, nextPage, period);
      const next = (result.items ?? []).map(toItem);
      setHasMore(result.has_next || next.length > 0);
      setItems((prev) => (nextPage === 1 ? next : dedupeItems([...prev, ...next])));
    } catch {
      try {
        const fallback = await jikanDiscover(nextTab, nextPage);
        setHasMore(fallback.length > 0);
        setItems((prev) => (nextPage === 1 ? fallback : dedupeItems([...prev, ...fallback])));
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
      const result = await searchAniwatch(nextQuery, nextPage);
      const next = (result.items ?? []).map(toItem);
      setHasMore(result.has_next || next.length > 0);
      setItems((prev) => (nextPage === 1 ? next : dedupeItems([...prev, ...next])));
    } catch {
      try {
        const fallback = await searchJikanFallback(nextQuery, nextPage);
        setHasMore(fallback.length > 0);
        setItems((prev) => (nextPage === 1 ? fallback : dedupeItems([...prev, ...fallback])));
      } catch {
        setItems([]);
        setHasMore(false);
        setBrowseError("Anime search could not be completed right now.");
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
      const next = (result.items ?? []).map(toItem);
      setHasMore(result.has_next || next.length > 0);
      setItems((prev) => (nextPage === 1 ? next : dedupeItems([...prev, ...next])));
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
    if (tab === "schedule" || (tab === "genre" && !selectedGenre)) return;
    const nextPage = page + 1;
    setPage(nextPage);
    if (query) void loadSearch(query, nextPage);
    else if (tab === "genre") void loadGenreAnime(selectedGenre, nextPage);
    else void loadDiscover(tab, nextPage, trendingPeriod);
  };

  // ── Effects ─────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchAniwatchGenres().then(setGenres).catch(() => setGenres([]));
  }, []);

  useEffect(() => {
    if (tab === "schedule") void loadSchedule(scheduleDate);
  }, [tab, scheduleDate]);

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
    if (query || tab === "schedule" || tab === "genre") return;
    const warmSections = (["trending", "popular", "toprated", "seasonal", "movie"] as const).filter(
      (v) => v !== tab
    );
    const timer = window.setTimeout(() => {
      warmAniwatchSections([...warmSections], trendingPeriod);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [query, tab, trendingPeriod]);

  useEffect(() => {
    const node = bottomRef.current;
    const root = scrollRef.current;
    if (!node || !root) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); },
      { root, rootMargin: "260px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [items.length, loading, page, query, tab, trendingPeriod]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      {/* Header */}
      <div
        style={{
          padding: "14px 24px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-surface)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Anime <span style={{ fontSize: 12, background: "var(--accent)", color: "white", padding: "1px 7px", borderRadius: 8, marginLeft: 6 }}>V2</span></div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>
            Direct HiAnime streaming — bypasses provider chain
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 13, gap: 6 }}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("grabix:navigate", { detail: { page: "favorites" } })
              )
            }
          >
            <IconHeart size={13} color="var(--text-danger)" filled /> Favorites
          </button>
          <div style={{ position: "relative" }}>
            <div
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}
            >
              <IconSearch size={13} color="var(--text-muted)" />
            </div>
            <input
              className="input-base"
              style={{ paddingLeft: 32, width: 240, fontSize: 13 }}
              placeholder="Search anime..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" &&
                (search.trim() ? setQuery(search.trim()) : setQuery(""))
              }
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ fontSize: 13 }}
            onClick={() => (search.trim() ? setQuery(search.trim()) : setQuery(""))}
          >
            Search
          </button>
          {query && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 13 }}
              onClick={() => { setQuery(""); setSearch(""); }}
            >
              <IconX size={13} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      {!query && (
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "10px 24px 0",
            background: "var(--bg-surface)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "7px 16px",
                fontSize: 13,
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
                background: "transparent",
                borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                color: tab === t.id ? "var(--accent)" : "var(--text-muted)",
                transition: "var(--transition)",
                borderRadius: 0,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Trending period */}
      {!query && tab === "trending" && (
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "12px 24px",
            background: "var(--bg-surface)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {(["daily", "weekly", "monthly"] as const).map((p) => (
            <button
              key={p}
              className={`quality-chip${trendingPeriod === p ? " active" : ""}`}
              onClick={() => setTrendingPeriod(p)}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Genre picker */}
      {!query && tab === "genre" && (
        <div
          style={{
            padding: "12px 24px",
            background: "var(--bg-surface)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Pick a genre</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {genres.length === 0 && (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading genres...</span>
            )}
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

      {/* Schedule date picker */}
      {!query && tab === "schedule" && (
        <div
          style={{
            padding: "12px 24px",
            background: "var(--bg-surface)",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Date:</span>
          <input
            type="date"
            className="input-base"
            style={{ fontSize: 13, padding: "5px 10px" }}
            value={scheduleDate}
            onChange={(e) => setScheduleDate(e.target.value)}
          />
          {scheduleLoading && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading...</span>
          )}
        </div>
      )}

      {/* Content area */}
      <div
        ref={scrollRef}
        style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}
        onScroll={() => {
          const node = scrollRef.current;
          if (!node || loading) return;
          if (node.scrollHeight - node.scrollTop - node.clientHeight < 320) loadMore();
        }}
      >
        {/* Schedule view */}
        {!query && tab === "schedule" ? (
          scheduleError ? (
            <PageErrorState
              title="Schedule unavailable"
              subtitle={scheduleError}
              onRetry={() => loadSchedule(scheduleDate)}
            />
          ) : scheduleLoading ? (
            <LoadingGrid count={6} />
          ) : scheduleItems.length === 0 ? (
            <PageEmptyState title="No anime scheduled" subtitle="Try a different date." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {scheduleItems.map((item) => (
                <div
                  key={item.id}
                  className="card"
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px" }}
                >
                  <div style={{ minWidth: 64, fontSize: 15, fontWeight: 700, color: "var(--accent)" }}>
                    {item.time || "—"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{item.title}</div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : !query && tab === "genre" && !selectedGenre ? (
          <PageEmptyState title="Choose a genre" subtitle="Select a genre above to browse anime." />
        ) : loading && filteredItems.length === 0 ? (
          <LoadingGrid />
        ) : browseError ? (
          <PageErrorState
            title="Anime is unavailable right now"
            subtitle={browseError}
            onRetry={retryCurrentView}
          />
        ) : filteredItems.length === 0 ? (
          <PageEmptyState
            title={query ? "No anime matched that search" : "No anime is available here yet"}
            subtitle={
              query
                ? "Try another title, season, or spelling."
                : "Try a different tab or refresh this page."
            }
          />
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  tab === "trending"
                    ? "repeat(auto-fit, minmax(190px, 1fr))"
                    : "repeat(auto-fill, minmax(150px, 1fr))",
                gap: tab === "trending" ? 16 : 14,
              }}
            >
              {filteredItems.map((anime, index) => (
                <AnimeCard
                  key={`${anime.provider}-${anime.id}`}
                  anime={anime}
                  activeTab={tab}
                  featured={tab === "trending"}
                  rank={index + 1}
                  onClick={() => setDetail(anime)}
                />
              ))}
            </div>
            <div ref={bottomRef} style={{ height: 24 }} />
          </>
        )}
      </div>

      {/* Detail modal */}
      {detail && !player && (
        <AnimeDetailV2
          anime={detail}
          onClose={() => setDetail(null)}
          onPlay={(nextPlayer) => {
            setDetail(null);
            setPlayer(nextPlayer);
          }}
          activeTab={tab}
        />
      )}

      {/* Player */}
      {player && (
        <VidSrcPlayer
          title={player.title}
          subtitle={player.subtitle}
          poster={player.poster}
          sources={player.sources}
          mediaType={player.mediaType ?? "tv"}
          currentEpisode={player.currentEpisode}
          episodeOptions={player.episodeOptions}
          episodeLabel={player.episodeLabel}
          onSelectEpisode={player.onSelectEpisode}
          onClose={() => setPlayer(null)}
          onDownload={async (url) => { await queueVideoDownload({ url }); }}
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

// ─── AnimeCard ───────────────────────────────────────────────────────────────

function AnimeCard({
  anime,
  activeTab,
  featured,
  rank,
  onClick,
}: {
  anime: AnimeItem;
  activeTab: Tab;
  featured?: boolean;
  rank?: number;
  onClick: () => void;
}) {
  const { isFav, toggle } = useFavorites();
  const favoriteId = `anime-v2-${anime.provider}-${anime.id}`;
  const favorite = isFav(favoriteId);
  const rawType = String((anime.raw as { type?: string } | undefined)?.type || "").toLowerCase();
  const isMovie = activeTab === "movie" || rawType === "movie";
  const countLabel = isMovie
    ? "Movie"
    : anime.episodes_count
      ? `${anime.episodes_count} eps`
      : anime.status || "-";

  return (
    <div
      className="card"
      style={{
        overflow: "hidden",
        cursor: "pointer",
        transition: "transform 0.15s",
        minHeight: featured ? 360 : undefined,
      }}
      onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-3px)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
    >
      <div style={{ position: "relative" }}>
        <CachedImage
          src={anime.image || ""}
          fallbackSrc="https://via.placeholder.com/150x210?text=No+Image"
          alt={anime.title}
          referrerPolicy="no-referrer"
          style={{ width: "100%", height: featured ? 265 : 210, objectFit: "cover" }}
        />
        {featured && rank ? (
          <div
            style={{
              position: "absolute",
              bottom: 8,
              left: 8,
              background: "rgba(0,0,0,0.78)",
              color: "white",
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: 999,
              fontWeight: 700,
            }}
          >
            #{rank}
          </div>
        ) : null}
        {anime.rating ? (
          <div
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              background: "rgba(0,0,0,0.75)",
              color: "#fdd663",
              fontSize: 11,
              padding: "2px 7px",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              gap: 3,
              fontWeight: 600,
            }}
          >
            <IconStar size={10} color="#fdd663" /> {anime.rating.toFixed(1)}
          </div>
        ) : null}
        <button
          className="btn-icon"
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            width: 28,
            height: 28,
            borderRadius: 999,
            background: "rgba(0,0,0,0.62)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
          onClick={(e) => {
            e.stopPropagation();
            toggle({
              id: favoriteId,
              title: anime.title,
              poster: anime.image || "",
              type: "anime",
            });
          }}
        >
          <IconHeart size={14} color={favorite ? "var(--text-danger)" : "white"} filled={favorite} />
        </button>
      </div>
      <div style={{ padding: featured ? "12px 12px 14px" : "8px 10px" }}>
        <div
          style={{
            fontSize: featured ? 14 : 12,
            fontWeight: 700,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: featured ? "normal" : "nowrap",
            lineHeight: 1.35,
          }}
        >
          {anime.title}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{countLabel}</div>
      </div>
    </div>
  );
}

// ─── AnimeDetailV2 — simplified detail modal with direct streaming ────────────

function AnimeDetailV2({
  anime,
  onClose,
  onPlay,
  activeTab,
}: {
  anime: AnimeItem;
  onClose: () => void;
  onPlay: (player: {
    title: string;
    subtitle?: string;
    poster?: string;
    sources: StreamSource[];
    mediaType?: "movie" | "tv";
    currentEpisode?: number;
    episodeOptions?: number[];
    episodeLabel?: string;
    onSelectEpisode?: (ep: number) => Promise<{ sources: StreamSource[]; subtitle?: string }>;
  }) => void;
  activeTab: Tab;
}) {
  const { isFav, toggle } = useFavorites();
  const [episodes, setEpisodes] = useState<RawEpisode[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(true);
  const [episode, setEpisode] = useState(1);
  const [audio, setAudio] = useState<AudioMode>("sub");
  const [playing, setPlaying] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: "success" | "error" | "info" } | null>(null);

  const rawType = String((anime.raw as { type?: string } | undefined)?.type || "").toLowerCase();
  const isMovie = activeTab === "movie" || rawType === "movie";
  const selectionLabel = isMovie ? "Part" : "Episode";
  const title = anime.title;
  const fav = isFav(`anime-v2-${anime.provider}-${anime.id}`);

  const totalEpisodes = episodes.length || anime.episodes_count || 1;
  const episodeGroups = Math.ceil(totalEpisodes / 50);
  const selectedGroup = Math.floor((episode - 1) / 50);
  const episodeStart = selectedGroup * 50 + 1;
  const episodeEnd = Math.min(totalEpisodes, episodeStart + 49);
  const visibleEpisodes = useMemo(
    () =>
      Array.from(
        { length: Math.max(0, episodeEnd - episodeStart + 1) },
        (_, i) => episodeStart + i
      ),
    [episodeStart, episodeEnd]
  );

  // Load episodes when modal opens
  useEffect(() => {
    if (anime.provider === "jikan") {
      // Jikan items don't have Consumet episode IDs — use number sequence
      const count = anime.episodes_count || 12;
      setEpisodes(
        Array.from({ length: count }, (_, i) => ({
          id: `jikan-${anime.id}-ep-${i + 1}`,
          number: i + 1,
          title: `Episode ${i + 1}`,
        }))
      );
      setEpisodesLoading(false);
      return;
    }

    setEpisodesLoading(true);
    fetchEpisodes(anime.id)
      .then((eps) => {
        setEpisodes(eps.length > 0 ? eps : []);
      })
      .catch(() => setEpisodes([]))
      .finally(() => setEpisodesLoading(false));
  }, [anime.id, anime.provider]);

  const getEpisodeId = (epNumber: number): string | null => {
    const found = episodes.find((e) => e.number === epNumber);
    return found?.id ?? null;
  };

  /**
   * Core play function — mirrors anime.py step 7.
   * Gets episode ID → calls /consumet/watch/anime directly.
   */
  const resolveStream = async (
    epNumber: number,
    audioMode: AudioMode
  ): Promise<{ sources: StreamSource[]; subtitle: string }> => {
    const episodeId = getEpisodeId(epNumber);
    if (!episodeId) {
      throw new Error(
        `No episode ID found for ${selectionLabel} ${epNumber}. The anime may not be available on HiAnime.`
      );
    }

    const { sources } = await fetchDirectStream(episodeId, audioMode);

    if (sources.length === 0) {
      // Try flipping audio if nothing found
      const flipped: AudioMode = audioMode === "dub" ? "sub" : "dub";
      const fallback = await fetchDirectStream(episodeId, flipped);
      if (fallback.sources.length === 0) {
        throw new Error(
          `No playable stream found for ${selectionLabel} ${epNumber} (tried SUB + DUB). ` +
            `HiAnime may not have this episode yet.`
        );
      }
      return {
        sources: fallback.sources,
        subtitle: `HiAnime ${flipped.toUpperCase()} — ${selectionLabel} ${epNumber}`,
      };
    }

    return {
      sources,
      subtitle: `HiAnime ${audioMode.toUpperCase()} — ${selectionLabel} ${epNumber}`,
    };
  };

  const handlePlay = async () => {
    if (playing) return;
    setPlaying(true);
    try {
      const { sources, subtitle } = await resolveStream(episode, audio);
      const episodeNumbers =
        totalEpisodes > 1
          ? Array.from({ length: totalEpisodes }, (_, i) => i + 1)
          : undefined;

      onPlay({
        title,
        subtitle,
        poster: anime.image,
        sources,
        mediaType: isMovie ? "movie" : "tv",
        currentEpisode: episode,
        episodeOptions: episodeNumbers,
        episodeLabel: selectionLabel,
        onSelectEpisode: async (nextEp) => {
          const result = await resolveStream(nextEp, audio);
          return result;
        },
      });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Stream could not be loaded.",
        variant: "error",
      });
    } finally {
      setPlaying(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg-surface)",
          borderRadius: 16,
          width: "100%",
          maxWidth: 680,
          maxHeight: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header row */}
        <div style={{ display: "flex", gap: 16, padding: "20px 20px 0" }}>
          <img
            src={anime.image || "https://via.placeholder.com/100x145"}
            alt={title}
            referrerPolicy="no-referrer"
            style={{
              width: 100,
              height: 145,
              objectFit: "cover",
              borderRadius: 10,
              flexShrink: 0,
              border: "1px solid var(--border)",
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).src = "https://via.placeholder.com/100x145";
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, lineHeight: 1.3 }}>
              {title}
            </div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 8 }}>
              {anime.rating ? (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    background: "var(--bg-surface2)",
                    padding: "3px 9px",
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#fdd663",
                  }}
                >
                  <IconStar size={11} color="#fdd663" /> {anime.rating.toFixed(1)}
                </span>
              ) : null}
              {totalEpisodes > 0 ? (
                <span
                  style={{
                    background: "var(--bg-surface2)",
                    padding: "3px 9px",
                    borderRadius: 20,
                    fontSize: 12,
                    color: "var(--text-secondary)",
                  }}
                >
                  {isMovie ? "Movie" : `${totalEpisodes} eps`}
                </span>
              ) : null}
              {anime.status ? (
                <span
                  style={{
                    background: "var(--bg-surface2)",
                    padding: "3px 9px",
                    borderRadius: 20,
                    fontSize: 12,
                    color: "var(--text-secondary)",
                  }}
                >
                  {anime.status}
                </span>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {(anime.genres ?? []).slice(0, 4).map((genre) => (
                <span
                  key={genre}
                  style={{
                    background: "var(--bg-active)",
                    color: "var(--text-accent)",
                    padding: "2px 7px",
                    borderRadius: 10,
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                >
                  {genre}
                </span>
              ))}
            </div>
          </div>
          <button className="btn-icon" style={{ alignSelf: "flex-start", flexShrink: 0 }} onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px 24px" }}>
          {/* Description */}
          {anime.description && (
            <div
              style={{
                fontSize: 13,
                color: "var(--text-secondary)",
                lineHeight: 1.7,
                marginBottom: 14,
              }}
            >
              {anime.description.length > 340
                ? `${anime.description.slice(0, 340)}...`
                : anime.description}
            </div>
          )}

          {/* Status line */}
          <div
            style={{
              fontSize: 12,
              color: episodesLoading ? "var(--text-muted)" : "var(--text-success)",
              marginBottom: 14,
            }}
          >
            {episodesLoading
              ? "Loading episode list..."
              : episodes.length > 0
                ? `${episodes.length} episodes loaded from HiAnime — direct stream ready`
                : "Episodes not found on HiAnime — playback may fail"}
          </div>

          {/* Episode picker */}
          {(!isMovie || totalEpisodes > 1) && (
            <div
              style={{
                marginBottom: 18,
                padding: "14px 14px 12px",
                borderRadius: 14,
                background: "var(--bg-surface2)",
                border: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 700 }}>
                  {isMovie ? "Parts" : "Episodes"}
                </div>
                {episodeGroups > 1 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {Array.from({ length: episodeGroups }, (_, i) => {
                      const start = i * 50 + 1;
                      const end = Math.min(totalEpisodes, start + 49);
                      return (
                        <button
                          key={`${start}-${end}`}
                          className={`quality-chip${selectedGroup === i ? " active" : ""}`}
                          onClick={() => setEpisode(start)}
                          style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600 }}
                        >
                          {start}–{end}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  maxHeight: 176,
                  overflowY: "auto",
                  paddingRight: 4,
                }}
              >
                {visibleEpisodes.map((v) => (
                  <button
                    key={v}
                    className={`quality-chip${episode === v ? " active" : ""}`}
                    onClick={() => setEpisode(v)}
                    style={{ padding: "9px 14px", fontSize: 13, fontWeight: 700, minWidth: 52 }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Audio toggle */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Audio</div>
            <div style={{ display: "flex", gap: 8 }}>
              {(["sub", "dub"] as const).map((a) => (
                <button
                  key={a}
                  className={`quality-chip${audio === a ? " active" : ""}`}
                  onClick={() => setAudio(a)}
                  style={{ padding: "9px 20px", fontSize: 13, fontWeight: 600 }}
                >
                  {a === "sub" ? "SUB" : "DUB"}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
              {audio === "dub"
                ? "English dub — if unavailable, SUB will be used as fallback"
                : "Japanese audio with subtitles"}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="btn btn-primary"
              style={{ gap: 7, flex: 1, justifyContent: "center" }}
              onClick={() => void handlePlay()}
              disabled={playing}
            >
              <IconPlay size={15} />
              {playing ? "Loading stream..." : `Play ${selectionLabel} ${episode}`}
            </button>
            <button
              className="btn btn-ghost"
              style={{
                gap: 7,
                justifyContent: "center",
                color: fav ? "var(--text-danger)" : "var(--text-primary)",
              }}
              onClick={() =>
                toggle({
                  id: `anime-v2-${anime.provider}-${anime.id}`,
                  title,
                  poster: anime.image || "",
                  type: "anime",
                })
              }
            >
              <IconHeart
                size={15}
                color={fav ? "var(--text-danger)" : "currentColor"}
                filled={fav}
              />
              {fav ? "Saved" : "Favorite"}
            </button>
          </div>

          {/* Download hint */}
          <div
            style={{
              marginTop: 14,
              padding: "10px 14px",
              borderRadius: 10,
              background: "var(--bg-surface2)",
              border: "1px solid var(--border)",
              fontSize: 12,
              color: "var(--text-muted)",
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: "var(--text-primary)" }}>How V2 streams:</strong> Calls{" "}
            <code style={{ fontSize: 11 }}>/consumet/watch/anime</code> directly with the HiAnime
            episode ID. The backend tries vidstreaming + vidcloud in parallel and returns the first
            working M3U8. No provider resolution chain involved.
          </div>
        </div>
      </div>

      {toast && (
        <AppToast message={toast.message} variant={toast.variant} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

// ─── Loading skeleton ────────────────────────────────────────────────────────

function LoadingGrid({ count = 16 }: { count?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        gap: 14,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card" style={{ overflow: "hidden" }}>
          <div style={{ width: "100%", height: 210, background: "var(--bg-surface2)" }} />
          <div style={{ padding: "8px 10px" }}>
            <div
              style={{
                height: 12,
                background: "var(--bg-surface2)",
                borderRadius: 4,
                marginBottom: 6,
              }}
            />
            <div
              style={{ height: 10, background: "var(--bg-surface2)", borderRadius: 4, width: "60%" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
