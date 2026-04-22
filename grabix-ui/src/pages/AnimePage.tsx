import { useEffect, useMemo, useRef, useState } from "react";
import { IconHeart, IconSearch, IconX } from "../components/Icons";
import VidSrcPlayer from "../components/VidSrcPlayer";
import { PageEmptyState, PageErrorState } from "../components/PageStates";
import { useContentFilter } from "../context/ContentFilterContext";
import { queueVideoDownload } from "../lib/downloads";
import {
  fetchConsumetHealth,
  normalizeAudioPreference,
  searchConsumetAnime,
  type ConsumetHealth,
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
import { fetchBackendPing } from "../lib/api";
import type { StreamSource } from "../lib/streamProviders";

import {
  type AnimeCardItem,
  type Tab,
  type TrendingPeriod,
  dedupeItems,
  fetchJikanDiscover,
  searchJikanAnime,
  toCardItem,
} from "./anime/animeUtils";
import { filterAdultContent } from "../lib/contentFilter";
import { AnimeCard, LoadingGrid } from "./anime/AnimeCard";
import { AnimeDetail, type PlayerPayload } from "./anime/AnimeDetail";

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
  const [player, setPlayer] = useState<PlayerPayload | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [health, setHealth] = useState<ConsumetHealth | null>(null);
  const [consumetBaseUrlOverride, setConsumetBaseUrlOverride] = useState<string | null>(null);
  const [genres, setGenres] = useState<AniwatchGenre[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string>("");
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

  // ── Data loaders ────────────────────────────────────────────────────────────

  const loadDiscover = async (nextTab: Tab, nextPage = 1, nextPeriod: TrendingPeriod = trendingPeriod) => {
    if (nextTab === "schedule" || nextTab === "genre") return;
    setLoading(true);
    setBrowseError("");
    try {
      const result = await fetchAniwatchDiscover(nextTab as AniwatchSection, nextPage, nextPeriod);
      const nextItems = (result.items ?? []).map(toCardItem);
      setHasMore(result.has_next || nextItems.length > 0);
      setItems((prev) => (nextPage === 1 ? nextItems : dedupeItems([...prev, ...nextItems])));
    } catch {
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
      const result = await searchAniwatch(nextQuery, nextPage);
      const nextItems = (result.items ?? []).map(toCardItem);
      setHasMore(result.has_next || nextItems.length > 0);
      setItems((prev) => (nextPage === 1 ? nextItems : dedupeItems([...prev, ...nextItems])));
    } catch {
      try {
        const nextItems = (await searchConsumetAnime(nextQuery, nextPage)).map(toCardItem);
        setHasMore(nextItems.length > 0);
        setItems((prev) => (nextPage === 1 ? nextItems : dedupeItems([...prev, ...nextItems])));
      } catch {
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

  // ── Effects ─────────────────────────────────────────────────────────────────

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
    fetchBackendPing().then((ping) => {
      if (!cancelled && ping?.consumet_url) {
        setConsumetBaseUrlOverride(ping.consumet_url.replace(/\/$/, ""));
      }
    }).catch(() => {});
    loadHealth();
    const interval = window.setInterval(loadHealth, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

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

  // ── Derived values ───────────────────────────────────────────────────────────

  const helperText = health?.healthy
    ? "HiAnime-first anime with dub/sub playback and anime-provider fallbacks"
    : health && !health.configured
      ? "Anime browsing ready with HiAnime as the primary source"
      : "HiAnime primary with Jikan fallback for browsing";

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node || loading) return;
    const remaining = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (remaining < 320) loadMore();
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      {/* Header */}
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
          {query && <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => { setQuery(""); setSearch(""); }}><IconX size={13} /> Clear</button>}
        </div>
      </div>

      {/* Tab bar */}
      {!query && (
        <div style={{ display: "flex", gap: 4, padding: "10px 24px 0", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
          {tabs.map((nextTab) => (
            <button key={nextTab.id} onClick={() => setTab(nextTab.id)} style={{ padding: "7px 16px", fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer", background: "transparent", borderBottom: tab === nextTab.id ? "2px solid var(--accent)" : "2px solid transparent", color: tab === nextTab.id ? "var(--accent)" : "var(--text-muted)", transition: "var(--transition)", borderRadius: 0 }}>
              {nextTab.label}
            </button>
          ))}
        </div>
      )}

      {/* Trending period filter */}
      {!query && tab === "trending" && (
        <div style={{ display: "flex", gap: 8, padding: "12px 24px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
          {([{ id: "daily", label: "Daily" }, { id: "weekly", label: "Weekly" }, { id: "monthly", label: "Monthly" }] as const).map((period) => (
            <button key={period.id} className={`quality-chip${trendingPeriod === period.id ? " active" : ""}`} onClick={() => setTrendingPeriod(period.id)}>
              {period.label}
            </button>
          ))}
        </div>
      )}

      {/* Genre filter */}
      {!query && tab === "genre" && (
        <div style={{ padding: "12px 24px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Pick a genre</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {genres.length === 0 && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading genres...</span>}
            {genres.map((g) => (
              <button key={g.id} className={`quality-chip${selectedGenre === g.name ? " active" : ""}`} onClick={() => { setSelectedGenre(g.name); setPage(1); }}>
                {g.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Schedule date filter */}
      {!query && tab === "schedule" && (
        <div style={{ padding: "12px 24px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Date:</span>
          <input type="date" className="input-base" style={{ fontSize: 13, padding: "5px 10px" }} value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
          {scheduleLoading && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading...</span>}
        </div>
      )}

      {/* Main content */}
      <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
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
          <PageErrorState title="Anime is unavailable right now" subtitle={browseError} onRetry={retryCurrentView} />
        ) : filteredItems.length === 0 ? (
          <PageEmptyState
            title={query ? "No anime matched that search" : "No anime is available here yet"}
            subtitle={query ? "Try another title, season, or spelling." : "Try a different tab or refresh this page."}
          />
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: tab === "trending" ? "repeat(auto-fit, minmax(190px, 1fr))" : "repeat(auto-fill, minmax(150px, 1fr))", gap: tab === "trending" ? 16 : 14 }}>
              {filteredItems.map((anime, index) => (
                <AnimeCard key={`${anime.provider}-${anime.id}`} anime={anime} activeTab={tab} featured={tab === "trending"} rank={index + 1} onClick={() => setDetail(anime)} />
              ))}
            </div>
            <div ref={bottomRef} style={{ height: 24 }} />
          </>
        )}
      </div>

      {/* Detail modal */}
      {detail && !player && (
        <AnimeDetail
          anime={detail}
          onClose={() => setDetail(null)}
          onPlay={(nextPlayer) => {
            setDetail(null);
            setPlayer(nextPlayer);
          }}
          consumetHealthy={Boolean(health?.healthy)}
          consumetBaseUrl={consumetBaseUrlOverride || health?.api_base || "http://127.0.0.1:3000"}
          activeTab={tab}
        />
      )}

      {/* Player */}
      {player && (
        <VidSrcPlayer
          title={player.title}
          subtitle={player.subtitle}
          subtitleSearchTitle={player.subtitleSearchTitle}
          poster={player.poster}
          sources={player.sources}
          mediaType={player.mediaType ?? "tv"}
          disableSubtitleSearch={true}
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
