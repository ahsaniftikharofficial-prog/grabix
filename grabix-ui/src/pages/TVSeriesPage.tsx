import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { IconDownload, IconPlay, IconSearch, IconStar, IconX } from "../components/Icons";
import { IconHeart } from "../components/Icons";
import DownloadOptionsModal from "../components/DownloadOptionsModal";
import VidSrcPlayer from "../components/VidSrcPlayer";
import { PageEmptyState, PageErrorState } from "../components/PageStates";
import { useFavorites } from "../context/FavoritesContext";
import { useContentFilter } from "../context/ContentFilterContext";
import { fetchConsumetMetaSearch } from "../lib/consumetProviders";
import { filterAdultContent } from "../lib/contentFilter";
import { queueVideoDownload, resolveSourceDownloadOptions, type DownloadQualityOption } from "../lib/downloads";
import { TMDB_BACKDROP_BASE as IMG_LG, TMDB_IMAGE_BASE as IMG_BASE, discoverTmdbMedia, fetchTmdbDetails, fetchTmdbTvSeason, searchTmdbMedia } from "../lib/tmdb";
import { fetchMovieBoxDiscover, fetchMovieBoxSources, getTvSources, resolveTvPlaybackSources, searchMovieBox, type MovieBoxItem, type StreamSource } from "../lib/streamProviders";
import { fetchSharedTopRatedTv } from "../lib/topRatedMedia";

interface Show {
  id: number;
  name: string;
  overview: string;
  poster_path: string;
  backdrop_path?: string;
  poster_url?: string;
  moviebox_subject_id?: string;
  vote_average: number;
  first_air_date: string;
  genres?: { id: number; name: string }[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  status?: string;
  external_ids?: { imdb_id?: string };
  seasons?: { season_number: number; episode_count?: number; name?: string }[];
}

type Tab = "trending" | "popular" | "toprated";

const STATIC_TOP_TV: Array<{ id: number; name: string; year: number }> = [
  { id: -201, name: "Breaking Bad", year: 2008 },
  { id: -202, name: "Planet Earth II", year: 2016 },
  { id: -203, name: "Planet Earth", year: 2006 },
  { id: -204, name: "Band of Brothers", year: 2001 },
  { id: -205, name: "Chernobyl", year: 2019 },
  { id: -206, name: "The Wire", year: 2002 },
  { id: -207, name: "Avatar: The Last Airbender", year: 2005 },
  { id: -208, name: "Blue Planet II", year: 2017 },
  { id: -209, name: "The Sopranos", year: 1999 },
  { id: -210, name: "Sherlock", year: 2010 },
];

function makeFallbackShowId(subjectId: string): number {
  let hash = 0;
  for (const char of subjectId) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return -(Math.abs(hash) || 1);
}

function mapMovieBoxSeriesToShow(item: MovieBoxItem): Show {
  const seasons = (item.available_seasons ?? []).map((seasonNumber) => ({
    season_number: seasonNumber,
    episode_count: item.season_episode_counts?.[seasonNumber] ?? 0,
    name: `Season ${seasonNumber}`,
  }));
  const totalEpisodes = seasons.reduce((sum, season) => sum + Math.max(season.episode_count ?? 0, 0), 0);
  return {
    id: makeFallbackShowId(item.id),
    name: item.title,
    overview: item.description || "",
    poster_path: "",
    poster_url: item.poster_proxy || item.poster || "",
    moviebox_subject_id: item.id,
    vote_average: item.imdb_rating ?? 0,
    first_air_date: item.year ? `${item.year}-01-01` : "",
    genres: (item.genres ?? []).map((genre, index) => ({ id: index + 1, name: genre })),
    number_of_seasons: seasons.length || undefined,
    number_of_episodes: totalEpisodes || undefined,
    seasons,
  };
}

function mapStaticShowToShow(item: { id: number; name: string; year: number }): Show {
  return {
    id: item.id,
    name: item.name,
    overview: "",
    poster_path: "",
    backdrop_path: "",
    vote_average: 0,
    first_air_date: `${item.year}-01-01`,
    genres: [],
  };
}

function isTvSeriesItem(item: MovieBoxItem): boolean {
  return item.moviebox_media_type === "series" && item.media_type !== "anime";
}

function getShowPoster(show: Show): string {
  if (show.poster_url) return show.poster_url;
  if (show.poster_path) return `${IMG_BASE}${show.poster_path}`;
  return "";
}

function getShowBackdrop(show: Show): string {
  return show.backdrop_path ? `${IMG_LG}${show.backdrop_path}` : "";
}

export default function TVSeriesPage() {
  const { adultContentBlocked } = useContentFilter();
  const [tab, setTab] = useState<Tab>("trending");
  const [shows, setShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<Show | null>(null);
  const [player, setPlayer] = useState<{ title: string; subtitle?: string; poster?: string; sources: StreamSource[] } | null>(null);
  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const tf = useCallback(async (kind: "details" | "season", id: number, seasonNumber?: number) => {
    if (kind === "season" && typeof seasonNumber === "number") {
      return await fetchTmdbTvSeason(id, seasonNumber);
    }
    return await fetchTmdbDetails("tv", id, "external_ids");
  }, []);

  const fetchTMDB = async (nextTab: Tab, nextPage = 1) => {
    setLoading(true);
    setPageError("");
    if (nextPage === 1) setShows([]);
    if (nextTab === "toprated") {
      try {
        const { items } = await fetchSharedTopRatedTv();
        const mappedItems = items.map((item) => {
          if ("moviebox_media_type" in item) {
            return mapMovieBoxSeriesToShow(item);
          }
          return {
            id: item.id,
            name: item.name,
            overview: "",
            poster_path: item.poster_path ?? "",
            backdrop_path: "",
            vote_average: item.vote_average ?? 0,
            first_air_date: item.first_air_date ?? "",
            genres: [],
          } as Show;
        });
        const pageSize = 24;
        const slice = mappedItems.slice(0, nextPage * pageSize);
        setShows(slice.length > 0 ? slice : STATIC_TOP_TV.map(mapStaticShowToShow));
        return;
      } catch {
        setShows(STATIC_TOP_TV.map(mapStaticShowToShow));
        return;
      } finally {
        setLoading(false);
      }
    }

    const categories: Record<Tab, "trending" | "popular" | "top_rated"> = {
      trending: "trending",
      popular: "popular",
      toprated: "top_rated",
    };
    try {
      const data = await discoverTmdbMedia("tv", categories[nextTab], nextPage);
      if (!data?.results) throw new Error("TMDB TV discover unavailable");
      const nextShows = (data.results ?? []) as Show[];
      setShows((prev) => (nextPage === 1 ? nextShows : [...prev, ...nextShows]));
      return;
    } catch {
    }

    try {
      const discover = await fetchMovieBoxDiscover();
      const sections = discover.sections ?? [];
      const selectedItems = (
        nextTab === "popular"
          ? sections.filter((section) => section.id === "series" || section.id === "most-popular")
          : sections.filter((section) => section.id === "recent")
      ).flatMap((section) => section.items ?? []);
      const nextShows = selectedItems
        .filter(isTvSeriesItem)
        .map(mapMovieBoxSeriesToShow);
      setShows((prev) => (nextPage === 1 ? nextShows : [...prev, ...nextShows]));
      if (nextShows.length === 0) {
        setPageError("TV series could not be loaded right now.");
      }
    } catch {
      setShows([]);
      setPageError("TV series could not be loaded right now.");
    } finally {
      setLoading(false);
    }
  };

  const searchShows = async (nextQuery: string, nextPage = 1) => {
    setLoading(true);
    setPageError("");
    try {
      const data = await searchTmdbMedia("tv", nextQuery, nextPage);
      if (!data?.results) throw new Error("TMDB TV search unavailable");
      const nextShows = (data.results ?? []) as Show[];
      setShows((prev) => (nextPage === 1 ? nextShows : [...prev, ...nextShows]));
    } catch {
      try {
        const data = await searchMovieBox({ query: nextQuery, mediaType: "series", perPage: 24, sortBy: "search" });
        const nextShows = (data.items ?? []).filter(isTvSeriesItem).map(mapMovieBoxSeriesToShow);
        setShows((prev) => (nextPage === 1 ? nextShows : [...prev, ...nextShows]));
        if (nextShows.length === 0) {
          setPageError("TV search could not be completed right now.");
        }
      } catch {
        setShows([]);
        setPageError("TV search could not be completed right now.");
      }
    } finally {
      setLoading(false);
    }
  };

  const retryCurrentView = () => {
    setPage(1);
    if (query) {
      void searchShows(query, 1);
      return;
    }
    void fetchTMDB(tab, 1);
  };

  useEffect(() => {
    setPage(1);
    if (query) {
      searchShows(query, 1);
      return;
    }
    fetchTMDB(tab, 1);
  }, [tab, query]);

  useEffect(() => {
    const root = scrollRef.current;
    const node = bottomRef.current;
    if (!root || !node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !loading) {
          loadMore();
        }
      },
      { root, rootMargin: "240px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loading, page, query, tab]);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    if (query) searchShows(query, nextPage);
    else fetchTMDB(tab, nextPage);
  };

  const tabs = [
    { id: "trending" as Tab, label: "Trending" },
    { id: "popular" as Tab, label: "Popular" },
    { id: "toprated" as Tab, label: "Top Rated" },
  ];
  const filteredShows = useMemo(() => filterAdultContent(shows, adultContentBlocked), [shows, adultContentBlocked]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>TV Series</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>Browse · Stream · Download</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}><IconSearch size={13} color="var(--text-muted)" /></div>
            <input className="input-base" style={{ paddingLeft: 32, width: 220, fontSize: 13 }} placeholder="Search series..." value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (search.trim() ? setQuery(search.trim()) : setQuery(""))} />
          </div>
          <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={() => (search.trim() ? setQuery(search.trim()) : setQuery(""))}>Search</button>
          {query && <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => { setQuery(""); setSearch(""); }}><IconX size={13} /> Clear</button>}
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

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {loading && filteredShows.length === 0 ? <LoadingGrid /> : pageError ? (
          <PageErrorState
            title="TV series are unavailable right now"
            subtitle={pageError}
            onRetry={retryCurrentView}
          />
        ) : filteredShows.length === 0 ? (
          <PageEmptyState
            title={query ? "No series matched that search" : "No series are available here yet"}
            subtitle={query ? "Try a different title or spelling." : "Try another tab or refresh this page."}
          />
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
              {filteredShows.map((show) => <SeriesCard key={show.id} show={show} onClick={() => setDetail(show)} />)}
            </div>
            <div ref={bottomRef} style={{ height: 24 }} />
          </>
        )}
      </div>

      {detail && !player && <SeriesDetail show={detail} tf={tf} onClose={() => setDetail(null)} onPlay={(nextPlayer) => { setDetail(null); setPlayer(nextPlayer); }} />}
      {player && <VidSrcPlayer title={player.title} subtitle={player.subtitle} poster={player.poster} sources={player.sources} mediaType="tv" onClose={() => setPlayer(null)} />}
    </div>
  );
}

function SeriesCard({ show, onClick }: { show: Show; onClick: () => void }) {
  const poster = getShowPoster(show);
  return (
    <div className="card" style={{ overflow: "hidden", cursor: "pointer", transition: "transform 0.15s" }} onClick={onClick} onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-3px)")} onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}>
      <div style={{ position: "relative" }}>
        {poster ? <img src={poster} alt={show.name} style={{ width: "100%", height: 210, objectFit: "cover" }} /> : <div style={{ width: "100%", height: 210, background: "var(--bg-surface2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>No Poster</div>}
        {show.vote_average > 0 && <div style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.75)", color: "#fdd663", fontSize: 11, padding: "2px 7px", borderRadius: 6, display: "flex", alignItems: "center", gap: 3, fontWeight: 600 }}><IconStar size={10} color="#fdd663" /> {show.vote_average.toFixed(1)}</div>}
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{show.name}</div>
        {show.first_air_date && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{show.first_air_date.slice(0, 4)}</div>}
      </div>
    </div>
  );
}

function SeriesActions({ onPlay, onDownload, favId, favItem }: { onPlay: () => void; onDownload: () => void; favId: string; favItem: { id: string; title: string; poster: string; type: "series"; tmdbId: number; imdbId?: string } }) {
  const { isFav, toggle } = useFavorites();
  const fav = isFav(favId);

  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
      <button className="btn btn-primary" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={onPlay}>
        <IconPlay size={15} /> Play
      </button>
      <button className="btn btn-ghost" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={onDownload}>
        <IconDownload size={15} /> Download
      </button>
      <button className="btn btn-ghost" style={{ gap: 7, flex: 1, justifyContent: "center", color: fav ? "var(--text-danger)" : "var(--text-primary)" }} onClick={() => toggle(favItem)}>
        <IconHeart size={15} color={fav ? "var(--text-danger)" : "currentColor"} filled={fav} />
        {fav ? "Saved" : "Favorite"}
      </button>
    </div>
  );
}

function SeriesDetail({ show, tf, onClose, onPlay }: { show: Show; tf: (kind: "details" | "season", id: number, seasonNumber?: number) => Promise<any>; onClose: () => void; onPlay: (player: { title: string; subtitle?: string; poster?: string; sources: StreamSource[] }) => void }) {
  const [full, setFull] = useState<Show | null>(null);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [seasonEpisodes, setSeasonEpisodes] = useState<number>(12);
  const [altTitles, setAltTitles] = useState<string[]>([]);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [downloadLanguage, setDownloadLanguage] = useState<"english" | "hindi">("english");
  const [downloadQuality, setDownloadQuality] = useState("");
  const [downloadOptions, setDownloadOptions] = useState<DownloadQualityOption[]>([]);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const isMovieBoxFallback = Boolean(show.moviebox_subject_id);

  useEffect(() => {
    if (isMovieBoxFallback) {
      setFull(null);
      return;
    }
    tf("details", show.id).then(setFull).catch(() => {});
  }, [isMovieBoxFallback, show.id, tf]);
  useEffect(() => {
    let cancelled = false;
    fetchConsumetMetaSearch(show.name, "tv")
      .then((items) => {
        if (cancelled) return;
        const titles = items
          .flatMap((item) => [item.title, item.alt_title])
          .filter((value): value is string => Boolean(value))
          .filter((value, index, array) => array.indexOf(value) === index && value.toLowerCase() !== show.name.toLowerCase())
          .slice(0, 3);
        setAltTitles(titles);
      })
      .catch(() => {
        if (!cancelled) setAltTitles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [show.name]);

  useEffect(() => {
    let cancelled = false;
    const seasonOwner = full ?? show;
    if (isMovieBoxFallback) {
      const fallback = seasonOwner.seasons?.find((item) => item.season_number === season)?.episode_count ?? 12;
      setSeasonEpisodes(Math.max(fallback, 1));
      setEpisode((current) => Math.min(current, Math.max(fallback, 1)));
      return () => {
        cancelled = true;
      };
    }
    tf("season", show.id, season)
      .then((seasonData) => {
        if (cancelled) return;
        const episodes = Array.isArray(seasonData?.episodes) ? seasonData.episodes.length : 0;
        setSeasonEpisodes(Math.max(episodes, 1));
        setEpisode((current) => Math.min(current, Math.max(episodes, 1)));
      })
      .catch(() => {
        if (!cancelled) {
          const fallback = seasonOwner.seasons?.find((item) => item.season_number === season)?.episode_count ?? 12;
          setSeasonEpisodes(Math.max(fallback, 1));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isMovieBoxFallback, show, full, season, tf]);

  const data = full ?? show;
  const poster = getShowPoster(data);
  const backdrop = getShowBackdrop(data);
  const fallbackSources = isMovieBoxFallback ? [] : getTvSources({ tmdbId: show.id, imdbId: data.external_ids?.imdb_id }, { season, episode });
  const seriesYear = data.first_air_date ? Number(data.first_air_date.slice(0, 4)) : undefined;
  const availableSeasons = (data.seasons ?? [])
    .map((item) => item.season_number)
    .filter((value) => value > 0);
  const seasonCounts = (data.seasons ?? [])
    .filter((item) => item.season_number > 0)
    .map((item) => ({ season: item.season_number, count: Math.max(item.episode_count ?? 0, 0) }));
  const totalEpisodes = Math.max(
    data.number_of_episodes ?? seasonCounts.reduce((sum, item) => sum + item.count, 0),
    seasonEpisodes
  );
  const globalEpisodeMap = useMemo(
    () =>
      seasonCounts.flatMap((item) =>
        Array.from({ length: item.count }, (_, index) => ({
          global: seasonCounts
            .filter((entry) => entry.season < item.season)
            .reduce((sum, entry) => sum + entry.count, 0) + index + 1,
          season: item.season,
          episode: index + 1,
        }))
      ),
    [JSON.stringify(seasonCounts)]
  );
  const episodeGroups = Math.ceil(seasonEpisodes / 50);
  const selectedGroup = Math.floor((episode - 1) / 50);
  const episodeStart = selectedGroup * 50 + 1;
  const episodeEnd = Math.min(seasonEpisodes, episodeStart + 49);
  const visibleEpisodes = Array.from({ length: Math.max(0, episodeEnd - episodeStart + 1) }, (_, index) => episodeStart + index);
  const globalEpisodeGroups = Math.ceil(Math.max(totalEpisodes, 1) / 100);
  const globalEpisode = globalEpisodeMap.find((item) => item.season === season && item.episode === episode)?.global ?? episode;
  const selectedGlobalGroup = Math.floor((globalEpisode - 1) / 100);
  const globalStart = selectedGlobalGroup * 100 + 1;
  const globalEnd = Math.min(totalEpisodes, globalStart + 99);
  const visibleGlobalEpisodes = Array.from({ length: Math.max(0, globalEnd - globalStart + 1) }, (_, index) => globalStart + index);

  const loadMovieBoxSources = async () => {
    if (show.moviebox_subject_id) {
      try {
        const sources = await fetchMovieBoxSources({
          subjectId: show.moviebox_subject_id,
          mediaType: "series",
          year: Number.isFinite(seriesYear) ? seriesYear : undefined,
          season,
          episode,
        });
        if (sources.length > 0) return sources;
      } catch {
        // Fall back to title-based matching below.
      }
    }
    const titles = [data.name, ...altTitles];
    for (const title of titles) {
      try {
        const sources = await fetchMovieBoxSources({
          title,
          mediaType: "series",
          year: Number.isFinite(seriesYear) ? seriesYear : undefined,
          season,
          episode,
        });
        if (sources.length > 0) return sources;
      } catch {
        continue;
      }
    }
    return [];
  };

  const isHindiMovieBoxItem = (item: MovieBoxItem) => {
    const title = (item.title || "").toLowerCase();
    return Boolean(item.is_hindi) || title.includes("hindi");
  };

  const loadHindiMovieBoxSources = async () => {
    const titles = [data.name, ...altTitles];
    for (const title of titles) {
      try {
        const result = await searchMovieBox({
          query: title,
          mediaType: "series",
          hindiOnly: true,
          preferHindi: true,
          sortBy: "search",
          perPage: 10,
        });
        const hindiItem = (result.items ?? []).find((item) => {
          const sameYear = !seriesYear || !item.year || item.year === seriesYear;
          return sameYear && isHindiMovieBoxItem(item);
        });
        if (!hindiItem?.id) continue;
        const sources = await fetchMovieBoxSources({
          subjectId: hindiItem.id,
          mediaType: "series",
          year: Number.isFinite(seriesYear) ? seriesYear : undefined,
          season,
          episode,
        });
        if (sources.length > 0) {
          return sources;
        }
      } catch {
        continue;
      }
    }
    return [] as StreamSource[];
  };

  const loadDownloadOptions = async (language = downloadLanguage) => {
    setDownloadLoading(true);
    setDownloadError("");
    try {
      const sources = language === "hindi" ? await loadHindiMovieBoxSources() : await loadMovieBoxSources();
      if (sources.length > 0) {
        const options = await resolveSourceDownloadOptions(sources);
        setDownloadOptions(options);
        setDownloadQuality(options[0]?.id || "");
        return;
      }
      if (language === "hindi") {
        setDownloadOptions([]);
        setDownloadQuality("");
        setDownloadError("No Hindi source available. Try downloading in English.");
        return;
      }

      const fallbackOptions = await resolveSourceDownloadOptions(fallbackSources.slice(0, 1));
      setDownloadOptions(fallbackOptions);
      setDownloadQuality(fallbackOptions[0]?.id || "");
      if (fallbackOptions.length === 0) {
        setDownloadError("No downloadable source was found for this episode.");
      }
    } catch (error) {
      setDownloadOptions([]);
      setDownloadQuality("");
      setDownloadError(error instanceof Error ? error.message : "Download options could not be loaded.");
    } finally {
      setDownloadLoading(false);
    }
  };

  useEffect(() => {
    if (!downloadDialogOpen) return;
    void loadDownloadOptions(downloadLanguage);
  }, [downloadDialogOpen, downloadLanguage, data.name, season, episode, seriesYear]);

  const handlePlay = async () => {
    const sources = isMovieBoxFallback
      ? await loadMovieBoxSources()
      : await resolveTvPlaybackSources({
          tmdbId: show.id,
          imdbId: data.external_ids?.imdb_id,
          title: data.name,
          altTitles,
          year: Number.isFinite(seriesYear) ? seriesYear : undefined,
          season,
          episode,
        });
    onPlay({
      title: data.name,
      subtitle: isMovieBoxFallback
        ? `TV playback for S${season}E${episode} with Movie Box sources`
        : `TV playback for S${season}E${episode} with Movie Box primary and embed fallbacks`,
      poster: poster || undefined,
      sources: sources.length > 0 ? sources : fallbackSources,
    });
  };

  const handleDownload = async () => {
    const movieBoxSources = await loadMovieBoxSources();
    const movieBoxDirectSource = movieBoxSources[0];
    const thumbnail = poster;
    const labelBase = `${data.name} — S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")} — English`;
    if (movieBoxDirectSource) {
      await queueVideoDownload({
        url: movieBoxDirectSource.url,
        title: `${labelBase} — ${movieBoxDirectSource.quality || "Auto"}`,
        thumbnail,
        category: "TV Series",
        tags: [`S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`],
      });
      return;
    }

    const fallbackSource = fallbackSources[0];
    if (fallbackSource) {
      await queueVideoDownload({
        url: fallbackSource.url,
        title: `${labelBase} — ${fallbackSource.quality || "Auto"}`,
        thumbnail,
        headers: fallbackSource.requestHeaders,
        forceHls: fallbackSource.kind === "hls",
        category: "TV Series",
        tags: [`S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`],
      });
    }
  };
  void handleDownload;

  const handleDownloadDialog = async () => {
    setDownloadLanguage("english");
    setDownloadQuality("");
    setDownloadOptions([]);
    setDownloadError("");
    setDownloadDialogOpen(true);
  };

  const confirmDownload = async () => {
    const selectedOption = downloadOptions.find((option) => option.id === downloadQuality);
    if (!selectedOption) {
      setDownloadError("Choose a quality before downloading.");
      return;
    }

    const episodeLabel = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
    setDownloadLoading(true);
    try {
      await queueVideoDownload({
        url: selectedOption.url,
        title: `${data.name} — ${episodeLabel} — ${downloadLanguage === "hindi" ? "Hindi" : "English"} — ${selectedOption.label}`,
        thumbnail: poster,
        headers: selectedOption.headers,
        forceHls: selectedOption.forceHls,
        category: "TV Series",
        tags: [episodeLabel, downloadLanguage === "hindi" ? "Hindi" : "English"],
      });
      setDownloadDialogOpen(false);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Could not queue this episode download.");
    } finally {
      setDownloadLoading(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 16, width: "100%", maxWidth: 700, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
        {backdrop && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <img src={backdrop} alt="" style={{ width: "100%", height: 180, objectFit: "cover" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(transparent 40%, var(--bg-surface))" }} />
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 24px" }}>
          <div style={{ display: "flex", gap: 16, marginTop: backdrop ? -50 : 20 }}>
            {poster && <img src={poster} alt={data.name} style={{ width: 90, height: 135, objectFit: "cover", borderRadius: 10, flexShrink: 0, border: "2px solid var(--border)", position: "relative", zIndex: 1 }} />}
            <div style={{ flex: 1, paddingTop: backdrop ? 55 : 0, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{data.name}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {data.vote_average > 0 && <span style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 600, color: "#fdd663" }}><IconStar size={11} color="#fdd663" /> {data.vote_average.toFixed(1)}</span>}
                {data.first_air_date && <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>{data.first_air_date.slice(0, 4)}</span>}
                {typeof data.number_of_seasons === "number" && <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>{data.number_of_seasons} season{data.number_of_seasons === 1 ? "" : "s"}</span>}
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {(data.genres ?? []).slice(0, 4).map((genre) => <span key={genre.id} style={{ background: "var(--bg-active)", color: "var(--text-accent)", padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 500 }}>{genre.name}</span>)}
              </div>
            </div>
            <button className="btn-icon" style={{ alignSelf: "flex-start", flexShrink: 0, marginTop: backdrop ? 55 : 0 }} onClick={onClose}><IconX size={16} /></button>
          </div>

          {data.overview && <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, margin: "14px 0" }}>{data.overview}</div>}

          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Season</div>
              {availableSeasons.length > 0 ? (
                <select className="input-base" value={season} onChange={(e) => setSeason(Number(e.target.value))}>
                  {availableSeasons.map((value) => (
                    <option key={value} value={value}>
                      Season {value}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="input-base" type="number" min={1} value={season} onChange={(e) => setSeason(Math.max(1, Number(e.target.value) || 1))} />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Episode</div>
              <input className="input-base" type="number" min={1} value={episode} onChange={(e) => setEpisode(Math.max(1, Number(e.target.value) || 1))} />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Episodes</div>
              {episodeGroups > 1 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {Array.from({ length: episodeGroups }, (_, index) => {
                    const start = index * 50 + 1;
                    const end = Math.min(seasonEpisodes, start + 49);
                    return (
                      <button
                        key={`${start}-${end}`}
                        className={`quality-chip${selectedGroup === index ? " active" : ""}`}
                        onClick={() => setEpisode(start)}
                      >
                        {start}-{end}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 144, overflowY: "auto", paddingRight: 4 }}>
              {visibleEpisodes.map((value) => (
                <button
                  key={value}
                  className={`quality-chip${episode === value ? " active" : ""}`}
                  onClick={() => setEpisode(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          {globalEpisodeMap.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Overall Episodes</div>
                {globalEpisodeGroups > 1 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {Array.from({ length: globalEpisodeGroups }, (_, index) => {
                      const start = index * 100 + 1;
                      const end = Math.min(totalEpisodes, start + 99);
                      return (
                        <button
                          key={`global-${start}-${end}`}
                          className={`quality-chip${selectedGlobalGroup === index ? " active" : ""}`}
                          onClick={() => {
                            const mapping = globalEpisodeMap.find((item) => item.global === start);
                            if (mapping) {
                              setSeason(mapping.season);
                              setEpisode(mapping.episode);
                            }
                          }}
                        >
                          {start}-{end}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 144, overflowY: "auto", paddingRight: 4 }}>
                {visibleGlobalEpisodes.map((value) => {
                  const mapping = globalEpisodeMap.find((item) => item.global === value);
                  if (!mapping) return null;
                  return (
                    <button
                      key={`global-${value}`}
                      className={`quality-chip${globalEpisode === value ? " active" : ""}`}
                      onClick={() => {
                        setSeason(mapping.season);
                        setEpisode(mapping.episode);
                      }}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <SeriesActions
            onPlay={handlePlay}
            onDownload={handleDownloadDialog}
            favId={`series-${show.id}`}
            favItem={{ id: `series-${show.id}`, title: data.name, poster: data.poster_path ? `${IMG_BASE}${data.poster_path}` : "", type: "series", tmdbId: show.id, imdbId: data.external_ids?.imdb_id }}
          />
        </div>
      </div>
      <DownloadOptionsModal
        visible={downloadDialogOpen}
        title={data.name}
        poster={poster || undefined}
        languageOptions={[
          { id: "english", label: "English" },
          { id: "hindi", label: "Hindi" },
        ]}
        selectedLanguage={downloadLanguage}
        onSelectLanguage={(value) => setDownloadLanguage(value as "english" | "hindi")}
        qualityOptions={downloadOptions.map((option) => ({ id: option.id, label: option.label }))}
        selectedQuality={downloadQuality}
        onSelectQuality={setDownloadQuality}
        loading={downloadLoading}
        error={downloadError}
        onClose={() => setDownloadDialogOpen(false)}
        onConfirm={() => void confirmDownload()}
      />
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
