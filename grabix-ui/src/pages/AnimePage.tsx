import { useEffect, useMemo, useRef, useState } from "react";
import { IconDownload, IconPlay, IconSearch, IconStar, IconX } from "../components/Icons";
import { IconHeart } from "../components/Icons";
import VidSrcPlayer from "../components/VidSrcPlayer";
import { useFavorites } from "../context/FavoritesContext";
import {
  fetchConsumetAnimeDiscover,
  fetchConsumetAnimeEpisodes,
  fetchConsumetAnimeWatch,
  fetchConsumetDomainInfo,
  fetchConsumetHealth,
  normalizeAudioPreference,
  searchConsumetAnime,
  type AudioPreference,
  type ConsumetEpisode,
  type ConsumetHealth,
  type ConsumetMediaSummary,
} from "../lib/consumetProviders";
import { fetchMovieBoxSources, getAnimeEpisodeSources, getAnimeSources, searchMovieBox, type StreamSource } from "../lib/streamProviders";

const JIKAN = "https://api.jikan.moe/v4";
const TMDB = "https://api.themoviedb.org/3";
const TMDB_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI5OTk3Y2E5ZjY2NGZhZmI5ZWJkZmNhNDMyNGY0YTBmOCIsIm5iZiI6MTc3NDU2NDcyMC44NDYwMDAyLCJzYWIiOiI2OWM1YjU3MGE4NTBkNjcxOTE4OWJjN2MiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.uv8_l7Ub7WRhSfWtd07Sx_Yg13jubgyU7953kJZy7mw";

type Tab = "trending" | "toprated" | "seasonal";
type TmdbEpisodeRef = { season: number; episode: number };

const tmdbSeasonCache = new Map<number, Array<{ season: number; count: number }>>();

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

function toCardItem(item: ConsumetMediaSummary): AnimeCardItem {
  return {
    ...item,
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
    image: item.images.jpg.large_image_url ?? item.images.jpg.image_url,
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
  const response = await fetch(`${TMDB}/search/tv?query=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
  });
  const data = (await response.json()) as { results?: Array<{ id?: number; name?: string; original_name?: string }> };
  return data.results?.[0]?.id ?? null;
}

async function searchTmdbMulti(query: string): Promise<number | null> {
  const response = await fetch(`${TMDB}/search/multi?query=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
  });
  const data = (await response.json()) as { results?: Array<{ id?: number; media_type?: string }> };
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

  const response = await fetch(`${TMDB}/tv/${tmdbId}`, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
  });
  const data = (await response.json()) as { seasons?: Array<{ season_number?: number; episode_count?: number }> };
  const seasons = (data.seasons ?? [])
    .map((season) => ({
      season: season.season_number ?? 0,
      count: season.episode_count ?? 0,
    }))
    .filter((season) => season.season > 0 && season.count > 0)
    .sort((left, right) => left.season - right.season);
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
  const [tab, setTab] = useState<Tab>("trending");
  const [items, setItems] = useState<AnimeCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<AnimeCardItem | null>(null);
  const [player, setPlayer] = useState<{ title: string; subtitle?: string; poster?: string; sources: StreamSource[] } | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [health, setHealth] = useState<ConsumetHealth | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const tabs: { id: Tab; label: string }[] = [
    { id: "trending", label: "Most Popular" },
    { id: "toprated", label: "Most Favorite" },
    { id: "seasonal", label: "Top Airing" },
  ];

  const loadDiscover = async (nextTab: Tab, nextPage = 1) => {
    setLoading(true);
    try {
      const nextItems = (await fetchConsumetAnimeDiscover(nextTab, nextPage)).map(toCardItem);
      setHasMore(nextItems.length > 0);
      setItems((prev) => (nextPage === 1 ? nextItems : dedupeItems([...prev, ...nextItems])));
    } catch {
      setItems([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const loadSearch = async (nextQuery: string, nextPage = 1) => {
    setLoading(true);
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
      }
    } finally {
      setLoading(false);
    }
  };

  const loadMore = () => {
    if (loading || !hasMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    if (query) void loadSearch(query, nextPage);
    else void loadDiscover(tab, nextPage);
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
            message: "Consumet is unavailable, so anime playback will use the fallback providers.",
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

  useEffect(() => {
    setPage(1);
    setItems([]);
    setHasMore(true);
    scrollRef.current?.scrollTo({ top: 0 });
    if (query) {
      void loadSearch(query, 1);
      return;
    }
    void loadDiscover(tab, 1);
  }, [tab, query]);

  useEffect(() => {
    const node = bottomRef.current;
    const root = scrollRef.current;
    if (!node || !root) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { root, rootMargin: "260px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [items.length, loading, page, query, tab]);

  const helperText = health?.healthy
    ? "Hianime-first anime with dub-first playback, anime-provider backups, and Hindi via Movie Box when available"
    : health && !health.configured
      ? "Anime browsing is ready with fallback servers, Favorites, and trailer playback"
      : "Fallback-safe anime browsing with Hianime episodes when available";

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

      {health?.configured && !health.healthy && (
        <div style={{ padding: "10px 24px", borderBottom: "1px solid var(--border)", background: "rgba(245, 158, 11, 0.08)", fontSize: 12, color: "var(--text-warning)" }}>
          {health.message}
        </div>
      )}

      {!query && (
        <div style={{ display: "flex", gap: 4, padding: "10px 24px 0", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
          {tabs.map((nextTab) => (
            <button key={nextTab.id} onClick={() => setTab(nextTab.id)} style={{ padding: "7px 16px", fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer", background: "transparent", borderBottom: tab === nextTab.id ? "2px solid var(--accent)" : "2px solid transparent", color: tab === nextTab.id ? "var(--accent)" : "var(--text-muted)", transition: "var(--transition)", borderRadius: 0 }}>
              {nextTab.label}
            </button>
          ))}
        </div>
      )}

      <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {loading && items.length === 0 ? <LoadingGrid /> : items.length === 0 ? (
          <div className="empty-state"><IconSearch size={36} /><p>No results</p></div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
              {items.map((anime) => <AnimeCard key={`${anime.provider}-${anime.id}`} anime={anime} onClick={() => setDetail(anime)} />)}
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
        />
      )}
      {player && <VidSrcPlayer title={player.title} subtitle={player.subtitle} poster={player.poster} sources={player.sources} mediaType="tv" onClose={() => setPlayer(null)} />}
    </div>
  );
}

function AnimeCard({ anime, onClick }: { anime: AnimeCardItem; onClick: () => void }) {
  const { isFav, toggle } = useFavorites();
  const favoriteId = `anime-${anime.mal_id ?? `${anime.provider}-${anime.id}`}`;
  const favorite = isFav(favoriteId);

  return (
    <div className="card" style={{ overflow: "hidden", cursor: "pointer", transition: "transform 0.15s" }} onClick={onClick} onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-3px)")} onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}>
      <div style={{ position: "relative" }}>
        <img src={anime.image || "https://via.placeholder.com/150x210?text=No+Image"} alt={anime.title} style={{ width: "100%", height: 210, objectFit: "cover" }} onError={(e) => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/150x210?text=No+Image"; }} />
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
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{anime.title}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{anime.episodes_count ? `${anime.episodes_count} eps` : anime.status || "-"}</div>
      </div>
    </div>
  );
}

function AnimeDetail({
  anime,
  onClose,
  onPlay,
  consumetHealthy,
}: {
  anime: AnimeCardItem;
  onClose: () => void;
  onPlay: (player: { title: string; subtitle?: string; poster?: string; sources: StreamSource[] }) => void;
  consumetHealthy: boolean;
}) {
  const [finding, setFinding] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [tmdbId, setTmdbId] = useState<number | null>(null);
  const [candidateAnimes, setCandidateAnimes] = useState<AnimeCardItem[]>(anime.provider === "jikan" ? [] : [anime]);
  const [resolvedAnime, setResolvedAnime] = useState<AnimeCardItem | null>(anime.provider === "jikan" ? null : anime);
  const [episodes, setEpisodes] = useState<ConsumetEpisode[]>([]);
  const [episode, setEpisode] = useState(1);
  const [audio, setAudio] = useState<AudioPreference>("en");
  const [server, setServer] = useState("auto");
  const [detailHint, setDetailHint] = useState("");
  const [knownEpisodeCount, setKnownEpisodeCount] = useState<number | null>(anime.episodes_count ?? null);
  const { isFav, toggle } = useFavorites();
  const title = anime.title;
  const fav = isFav(`anime-${anime.mal_id ?? `${anime.provider}-${anime.id}`}`);

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
  const hasTrailer = Boolean(anime.trailer_url);

  useEffect(() => {
    let cancelled = false;
    setFinding(true);
    setEpisodes([]);
    setResolvedAnime(anime.provider === "jikan" ? null : anime);
    setKnownEpisodeCount(anime.episodes_count ?? null);

    Promise.allSettled([
      findTmdbId(anime.title, anime.alt_title),
      anime.provider === "jikan" ? searchConsumetAnime(anime.title) : Promise.resolve([] as ConsumetMediaSummary[]),
      fetchJikanEpisodeCount(anime.mal_id),
    ]).then(async ([tmdbResult, searchResult, jikanResult]) => {
      if (cancelled) return;

      setTmdbId(tmdbResult.status === "fulfilled" ? tmdbResult.value : null);
      if (jikanResult.status === "fulfilled" && jikanResult.value) {
        setKnownEpisodeCount(jikanResult.value);
      }

      const nextCandidates = anime.provider === "jikan"
        ? (searchResult.status === "fulfilled" ? searchResult.value.map(toCardItem) : [])
        : [anime];
      setCandidateAnimes(nextCandidates);

      if (!consumetHealthy) {
        setResolvedAnime(null);
        setEpisodes([]);
        setDetailHint("Using the built-in fallback playback providers for this title because Hianime is not returning usable anime data right now.");
        setFinding(false);
        return;
      }

      let chosenAnime: AnimeCardItem | null = null;
      let chosenEpisodes: ConsumetEpisode[] = [];

      for (const candidate of nextCandidates) {
        try {
          const detail = await fetchConsumetDomainInfo("anime", candidate.id, candidate.provider);
          const nextEpisodes = detail.item.episodes ?? await fetchConsumetAnimeEpisodes(candidate.id, candidate.provider);
          if (nextEpisodes.length > 0) {
            chosenAnime = candidate;
            chosenEpisodes = nextEpisodes;
            break;
          }
        } catch {
          continue;
        }
      }

      if (cancelled) return;

      setResolvedAnime(chosenAnime);
      setEpisodes(chosenEpisodes);
      if (chosenAnime && chosenEpisodes.length > 0) {
        setKnownEpisodeCount((current) => Math.max(current ?? 0, chosenEpisodes.length));
        setDetailHint(`Episode sources available via ${chosenAnime.provider.toUpperCase()}`);
      } else if (nextCandidates.length > 0) {
        setDetailHint("Hianime found title matches, but no playable episode list was returned. Fallback providers are ready.");
      } else {
        setDetailHint("Hianime could not match this title, so playback will use the fallback providers.");
      }
      setFinding(false);
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

  const handlePlay = async () => {
    if (playing) return;
    setPlaying(true);

    try {
      const normalizedAudio = normalizeAudioPreference(audio);
      const tmdbEpisode = await resolveTmdbEpisodeNumber(tmdbId, episode);
      let fallbackSources = tmdbEpisode
        ? getAnimeEpisodeSources(tmdbId, tmdbEpisode.season, tmdbEpisode.episode)
        : episode > 1
          ? getAnimeEpisodeSources(tmdbId, 1, episode)
          : getAnimeSources(tmdbId);
      const watchCandidates = resolvedAnime
        ? [resolvedAnime, ...candidateAnimes.filter((item) => `${item.provider}-${item.id}` !== `${resolvedAnime.provider}-${resolvedAnime.id}`)]
        : candidateAnimes;

      for (const candidate of watchCandidates) {
        try {
          const detail = await fetchConsumetDomainInfo("anime", candidate.id, candidate.provider);
          const episodeList = detail.item.episodes ?? await fetchConsumetAnimeEpisodes(candidate.id, candidate.provider);
          const match = episodeList.find((item) => item.number === episode) || episodeList[0];
          if (!match) continue;

          const playback = await fetchConsumetAnimeWatch(
            match.id,
            candidate.provider,
            normalizedAudio,
            server === "auto" ? undefined : server
          );

          const sources = [...playback.sources, ...fallbackSources];
          if (sources.length > 0) {
            onPlay({
              title,
              subtitle: `Anime playback with ${normalizedAudio === "hi" ? "Hindi" : normalizedAudio === "en" ? "English dub" : "sub"} preference - Episode ${episode}`,
              poster: anime.image,
              sources,
            });
            return;
          }
        } catch {
          continue;
        }
      }

      const titleCandidates = expandAnimeTitles(anime.title, anime.alt_title).slice(0, 6);
      if (normalizedAudio === "hi") {
        const movieBoxMatches = new Map<string, { id: string; title?: string; year?: number; moviebox_media_type?: "movie" | "series"; is_hindi?: boolean }>();

        for (const candidateTitle of titleCandidates) {
          try {
            const result = await searchMovieBox({
              query: candidateTitle,
              page: 1,
              perPage: 8,
              mediaType: "anime",
              animeOnly: true,
              preferHindi: true,
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
          if (Boolean(left.is_hindi) !== Boolean(right.is_hindi)) {
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
              episode,
            });
            if (movieBoxSources.length > 0) {
              fallbackSources = movieBoxSources;
              break;
            }
          } catch {
            continue;
          }
        }

        if (!fallbackSources.length) {
          for (const candidateTitle of titleCandidates) {
            try {
              const movieBoxSources = await fetchMovieBoxSources({
                title: candidateTitle,
                mediaType: "anime",
                season: 1,
                episode,
              });
              if (movieBoxSources.length > 0) {
                fallbackSources = movieBoxSources;
                break;
              }
            } catch {
              try {
                const seriesSources = await fetchMovieBoxSources({
                  title: candidateTitle,
                  mediaType: "series",
                  season: 1,
                  episode,
                });
                if (seriesSources.length > 0) {
                  fallbackSources = seriesSources;
                  break;
                }
              } catch {
                continue;
              }
            }
          }
        }
      }

      if (fallbackSources.length > 0) {
        onPlay({
          title,
          subtitle: `Fallback anime playback - Episode ${episode}`,
          poster: anime.image,
          sources: fallbackSources,
        });
        return;
      }

      alert("No playable anime sources were found for this episode.");
    } finally {
      setPlaying(false);
    }
  };

  const handleTrailer = () => {
    if (!anime.trailer_url) {
      alert("Trailer is not available for this title.");
      return;
    }
    onPlay({
      title: `${title} Trailer`,
      subtitle: "Official trailer playback",
      poster: anime.image,
      sources: [{
        id: `trailer-${anime.id}`,
        label: "Trailer",
        provider: "Trailer",
        kind: "embed",
        url: anime.trailer_url,
        description: "Official trailer",
        quality: "Preview",
        externalUrl: anime.trailer_url,
        canExtract: false,
      }],
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 16, width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", gap: 16, padding: "20px 20px 0" }}>
          <img src={anime.image || "https://via.placeholder.com/100x145"} alt={title} style={{ width: 100, height: 145, objectFit: "cover", borderRadius: 10, flexShrink: 0, border: "1px solid var(--border)" }} onError={(e) => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/100x145"; }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, lineHeight: 1.3 }}>{title}</div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 8 }}>
              {anime.rating ? <span style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 600, color: "#fdd663" }}><IconStar size={11} color="#fdd663" /> {anime.rating.toFixed(1)}</span> : null}
              {totalEpisodes ? <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>{totalEpisodes} eps</span> : null}
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

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Preferred Audio</div>
              <select className="input-base" value={audio} onChange={(event) => setAudio(normalizeAudioPreference(event.target.value))}>
                <option value="en">Dub first</option>
                <option value="original">Sub first</option>
                <option value="hi">Hindi first</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Server</div>
              <select className="input-base" value={server} onChange={(event) => setServer(event.target.value)}>
                <option value="auto">Auto</option>
                <option value="vidstreaming">VidStreaming</option>
                <option value="vidcloud">VidCloud</option>
                <option value="hd-1">HD-1</option>
                <option value="hd-2">HD-2</option>
                <option value="streamsb">StreamSB</option>
                <option value="streamtape">Streamtape</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
            <button className="btn btn-primary" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={() => void handlePlay()} disabled={finding || playing}>
              <IconPlay size={15} /> {finding ? "Finding..." : playing ? "Loading..." : "Play"}
            </button>
            <button className="btn btn-ghost" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={() => window.open(anime.url || `https://myanimelist.net/anime/${anime.mal_id ?? anime.id}`, "_blank")}>
              <IconDownload size={15} /> Info
            </button>
            <button className="btn btn-ghost" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={handleTrailer} disabled={!hasTrailer}>
              <IconPlay size={15} /> Trailer
            </button>
            <button className="btn btn-ghost" style={{ gap: 7, flex: 1, justifyContent: "center", color: fav ? "var(--text-danger)" : "var(--text-primary)" }} onClick={() => toggle({ id: `anime-${anime.mal_id ?? `${anime.provider}-${anime.id}`}`, title, poster: anime.image || "", type: "anime", malId: anime.mal_id, tmdbId: tmdbId ?? undefined })}>
              <IconHeart size={15} color={fav ? "var(--text-danger)" : "currentColor"} filled={fav} />
              {fav ? "Saved" : "Favorite"}
            </button>
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Episodes</div>
              {episodeGroups > 1 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {Array.from({ length: episodeGroups }, (_, index) => {
                    const start = index * 50 + 1;
                    const end = Math.min(totalEpisodes, start + 49);
                    return (
                      <button key={`${start}-${end}`} className={`quality-chip${selectedGroup === index ? " active" : ""}`} onClick={() => setEpisode(start)}>
                        {start}-{end}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 144, overflowY: "auto", paddingRight: 4 }}>
              {visibleEpisodes.map((value) => (
                <button key={value} className={`quality-chip${episode === value ? " active" : ""}`} onClick={() => setEpisode(value)}>
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
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
