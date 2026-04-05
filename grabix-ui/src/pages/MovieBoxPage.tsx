import { useEffect, useState } from "react";
import {
  fetchMovieBoxDetails,
  fetchMovieBoxDiscover,
  fetchMovieBoxSources,
  prewarmPlaybackSources,
  searchMovieBox,
  type MovieBoxItem,
  type MovieBoxSection,
  type StreamSource,
} from "../lib/streamProviders";
import VidSrcPlayer from "../components/VidSrcPlayer";
import DownloadOptionsModal from "../components/DownloadOptionsModal";
import AppToast from "../components/AppToast";
import { PageEmptyState, PageErrorState } from "../components/PageStates";
import { useFavorites } from "../context/FavoritesContext";
import { useContentFilter } from "../context/ContentFilterContext";
import { queueVideoDownload, resolveSourceDownloadOptions, type DownloadQualityOption } from "../lib/downloads";
import { filterAdultContent } from "../lib/contentFilter";
import {
  IconCheck,
  IconDownload,
  IconHeart,
  IconPlay,
  IconRefresh,
  IconSearch,
  IconStar,
  IconX,
} from "../components/Icons";

type Filter = "all" | "movie" | "series" | "anime" | "hindi";

interface PlayerState {
  title: string;
  subtitle?: string;
  subtitleSearchTitle?: string;
  poster?: string;
  sources: StreamSource[];
  mediaType: "movie" | "tv";
}

function buildMovieBoxSubtitleSearchTitle(item: MovieBoxItem, season?: number, episode?: number): string {
  if (item.moviebox_media_type === "movie") {
    return `${item.title} subtitle English`.trim();
  }
  return `${item.title} season ${season ?? 1} episode ${episode ?? 1} subtitle English`.trim();
}

function toServerOption(option: DownloadQualityOption) {
  const label = option.serverLabel || "MovieBox";
  return {
    id: option.serverId || label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    label,
    help: "Download server",
  };
}

export default function MovieBoxPage() {
  const { adultContentBlocked } = useContentFilter();
  const [discover, setDiscover] = useState<MovieBoxSection[]>([]);
  const [popularSearches, setPopularSearches] = useState<string[]>([]);
  const [results, setResults] = useState<MovieBoxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<MovieBoxItem | null>(null);
  const [player, setPlayer] = useState<PlayerState | null>(null);

  const isSearchMode = query.trim().length > 0;
  const filteredResults = filterAdultContent(results, adultContentBlocked);

  const loadDiscover = async () => {
    setLoading(true);
    setPageError("");
    try {
      const data = await fetchMovieBoxDiscover();
      setDiscover(data.sections);
      setPopularSearches(data.popular_searches);
    } catch {
      setDiscover([]);
      setPopularSearches([]);
      setPageError("Movie Box discover data could not be loaded right now.");
    } finally {
      setLoading(false);
    }
  };

  const runSearch = async (nextQuery: string, nextPage = 1) => {
    setLoading(true);
    setPageError("");
    try {
      const data = await searchMovieBox({
        query: nextQuery,
        page: nextPage,
        perPage: 24,
        mediaType:
          filter === "movie" || filter === "series" || filter === "anime"
            ? filter
            : "all",
        hindiOnly: filter === "hindi",
        animeOnly: filter === "anime",
        preferHindi: true,
        sortBy: filter === "all" ? "search" : filter === "hindi" ? "recent" : "search",
      });

      setResults((prev) => (nextPage === 1 ? data.items : [...prev, ...data.items]));
    } catch {
      setResults([]);
      setPageError("Movie Box search could not be completed right now.");
    } finally {
      setLoading(false);
    }
  };

  const retryCurrentView = () => {
    setPage(1);
    if (isSearchMode) {
      void runSearch(query, 1);
      return;
    }
    void loadDiscover();
  };

  useEffect(() => {
    setPage(1);
    if (isSearchMode) {
      void runSearch(query, 1);
      return;
    }
    void loadDiscover();
  }, [query, filter]);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    if (isSearchMode) {
      void runSearch(query, nextPage);
    }
  };

  const searchFromInput = (value: string) => {
    const next = value.trim();
    setPage(1);
    setQuery(next);
  };

  const sectionsToRender = (filter === "all"
    ? discover
    : discover.filter((section) => {
        if (filter === "hindi") return section.id === "hindi";
        if (filter === "anime") return section.id === "anime";
        if (filter === "movie") return section.id === "movies" || section.id === "top-rated" || section.id === "recent";
        if (filter === "series") return section.id === "series" || section.id === "most-popular";
        return true;
      }))
    .map((section) => ({ ...section, items: filterAdultContent(section.items, adultContentBlocked) }))
    .filter((section) => section.items.length > 0);

  useEffect(() => {
    const sourceItems = isSearchMode
      ? filteredResults
      : sectionsToRender.flatMap((section) => section.items.slice(0, 8));
    const urls = sourceItems
      .map((item) => item.poster || item.poster_proxy || "")
      .filter(Boolean)
      .slice(0, 24);
    if (urls.length === 0) return;
    const timer = window.setTimeout(() => {
      void warmMediaCache(urls, 8);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [filteredResults, isSearchMode, sectionsToRender]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Movie Box</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>Discover · Hindi · Anime · Stream · Download</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}>
              <IconSearch size={13} color="var(--text-muted)" />
            </div>
            <input
              className="input-base"
              style={{ paddingLeft: 32, width: 280, fontSize: 13 }}
              placeholder="Search Movie Box titles..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") searchFromInput(search);
              }}
            />
          </div>
          <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={() => searchFromInput(search)}>
            Search
          </button>
          {(query || search) && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 13 }}
              onClick={() => {
                setSearch("");
                setQuery("");
              }}
            >
              <IconX size={13} /> Clear
            </button>
          )}
        </div>
      </div>

      <div style={{ padding: "10px 24px 0", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingBottom: 10 }}>
          {(["all", "movie", "series", "anime", "hindi"] as const).map((value) => (
            <button
              key={value}
              className={`quality-chip${filter === value ? " active" : ""}`}
              onClick={() => setFilter(value)}
            >
              {value === "movie" ? "Movies" : value === "series" ? "TV Shows" : value === "hindi" ? "Hindi" : value.charAt(0).toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        {!isSearchMode && popularSearches.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingBottom: 10 }}>
            {popularSearches.map((term) => (
              <button
                key={term}
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: "6px 10px" }}
                onClick={() => {
                  setSearch(term);
                  searchFromInput(term);
                }}
              >
                {term}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {loading && ((isSearchMode && filteredResults.length === 0) || (!isSearchMode && sectionsToRender.length === 0)) ? (
          <LoadingGrid />
        ) : pageError ? (
          <PageErrorState
            title="Movie Box is unavailable right now"
            subtitle={pageError}
            onRetry={retryCurrentView}
          />
        ) : isSearchMode ? (
          filteredResults.length === 0 ? (
            <PageEmptyState
              title="No Movie Box titles matched that search"
              subtitle="Try another title, or keep Hindi mode on for dubbed results."
            />
          ) : (
            <>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
                Searching Movie Box with Hindi priority and direct-source playback.
              </div>
              <MediaGrid items={filteredResults} onOpen={setDetail} />
              <div style={{ textAlign: "center", marginTop: 24 }}>
                <button className="btn btn-ghost" style={{ gap: 6 }} onClick={loadMore} disabled={loading || filteredResults.length < 24}>
                  <IconRefresh size={14} /> Load more
                </button>
              </div>
            </>
          )
        ) : sectionsToRender.length === 0 ? (
          <PageEmptyState
            title="No discover data is available right now"
            subtitle="Movie Box may be rate-limiting or temporarily unavailable."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {sectionsToRender.map((section) => (
              <section key={section.id}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{section.title}</div>
                    {section.subtitle && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{section.subtitle}</div>}
                  </div>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12 }}
                    onClick={() => {
                      setFilter(section.id === "anime" ? "anime" : section.id === "hindi" ? "hindi" : section.id === "series" ? "series" : "movie");
                    }}
                  >
                    Focus
                  </button>
                </div>
                <MediaGrid items={section.items.slice(0, 8)} onOpen={setDetail} />
              </section>
            ))}
          </div>
        )}
      </div>

      {detail && !player && <MovieBoxDetail item={detail} onClose={() => setDetail(null)} onPlay={setPlayer} />}
      {player && <VidSrcPlayer title={player.title} subtitle={player.subtitle} subtitleSearchTitle={player.subtitleSearchTitle} poster={player.poster} sources={player.sources} mediaType={player.mediaType} onClose={() => setPlayer(null)} />}
    </div>
  );
}

function MediaGrid({ items, onOpen }: { items: MovieBoxItem[]; onOpen: (item: MovieBoxItem) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 14 }}>
      {items.map((item) => (
        <div
          key={item.id}
          className="card"
          style={{ overflow: "hidden", cursor: "pointer", transition: "transform 0.15s" }}
          onClick={() => onOpen(item)}
          onMouseEnter={(event) => (event.currentTarget.style.transform = "translateY(-3px)")}
          onMouseLeave={(event) => (event.currentTarget.style.transform = "translateY(0)")}
        >
          <div style={{ position: "relative" }}>
            {item.poster ? (
              <MovieBoxPoster item={item} alt={item.title} height={220} />
            ) : (
              <div style={{ width: "100%", height: 220, background: "var(--bg-surface2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>
                No Poster
              </div>
            )}
            {item.imdb_rating ? (
              <div style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.75)", color: "#fdd663", fontSize: 11, padding: "2px 7px", borderRadius: 6, display: "flex", alignItems: "center", gap: 3, fontWeight: 600 }}>
                <IconStar size={10} color="#fdd663" /> {item.imdb_rating.toFixed(1)}
              </div>
            ) : null}
            {item.is_hindi && (
              <div style={{ position: "absolute", top: 6, left: 6, background: "var(--accent)", color: "white", fontSize: 9, padding: "2px 6px", borderRadius: 5, fontWeight: 700 }}>
                Hindi
              </div>
            )}
          </div>
          <div style={{ padding: "8px 10px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
              {item.year && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.year}</span>}
              <span style={{ fontSize: 11, color: item.media_type === "anime" ? "var(--text-success)" : "var(--text-muted)" }}>{item.media_type}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MovieBoxDetail({
  item,
  onClose,
  onPlay,
}: {
  item: MovieBoxItem;
  onClose: () => void;
  onPlay: (player: PlayerState) => void;
}) {
  const { isFav, toggle } = useFavorites();
  const [details, setDetails] = useState<MovieBoxItem>(item);
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState(item.available_seasons?.[0] ?? 1);
  const [episode, setEpisode] = useState(1);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: "success" | "error" | "info" } | null>(null);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [downloadLanguage, setDownloadLanguage] = useState<"english" | "hindi">(
    item.is_hindi ? "hindi" : "english"
  );
  const [downloadQuality, setDownloadQuality] = useState("");
  const [downloadOptions, setDownloadOptions] = useState<DownloadQualityOption[]>([]);
  const [downloadServer, setDownloadServer] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [playOptions, setPlayOptions] = useState<DownloadQualityOption[]>([]);
  const [playQuality, setPlayQuality] = useState("");
  const [playOptionsLoading, setPlayOptionsLoading] = useState(false);
  const [playOptionsError, setPlayOptionsError] = useState("");
  const [resolvedSources, setResolvedSources] = useState<StreamSource[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMovieBoxDetails({
      subjectId: item.id,
      title: item.title,
      mediaType: item.media_type,
      year: item.year,
    })
      .then((nextItem) => {
        if (cancelled) return;
        setDetails(nextItem);
        if (nextItem.available_seasons?.[0]) {
          setSeason(nextItem.available_seasons[0]);
        }
        setEpisode(1);
      })
      .catch(() => {
        if (!cancelled) setDetails(item);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item]);

  const favoriteId = `moviebox-${item.id}`;
  const favoriteType = details.media_type === "anime" ? "anime" : details.moviebox_media_type === "movie" ? "movie" : "series";
  const favorite = isFav(favoriteId);

  const fetchSourcesForItem = async (target: MovieBoxItem) =>
    fetchMovieBoxSources({
      subjectId: target.id,
      title: target.title,
      mediaType: target.media_type,
      year: target.year,
      season,
      episode,
    });

  const loadSources = async () => {
    let lastError: unknown = null;
    const targets: MovieBoxItem[] = [details];

    if (!targets.some((target) => target.id === item.id)) {
      targets.push(item);
    }

    for (const target of targets) {
      try {
        const sources = await fetchSourcesForItem(target);
        if (sources.length > 0) {
          if (target.id !== details.id) {
            setDetails(target);
          }
          return sources;
        }
      } catch (error) {
        lastError = error;
        console.error("[GRABIX] MovieBox source resolve failed", {
          title: target.title,
          subjectId: target.id,
          mediaType: target.media_type,
          season,
          episode,
          reason: error instanceof Error ? error.message : error,
        });
      }
    }

    try {
      const refreshed = await fetchMovieBoxDetails({
        subjectId: details.id || item.id,
        title: details.title || item.title,
        mediaType: details.media_type,
        year: details.year || item.year,
      });
      const sources = await fetchSourcesForItem(refreshed);
      if (sources.length > 0) {
        setDetails(refreshed);
        return sources;
      }
    } catch (error) {
      lastError = error;
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Movie Box did not return any playable sources for this title.");
  };

  const loadSourcesForLanguage = async (language: "english" | "hindi") => {
    const wantsHindi = language === "hindi";
    const currentSources = await loadSources().catch(() => [] as StreamSource[]);
    if (currentSources.length > 0) {
      return currentSources;
    }

    const result = await searchMovieBox({
      query: details.title,
      mediaType: details.media_type,
      hindiOnly: wantsHindi,
      animeOnly: details.media_type === "anime",
      preferHindi: wantsHindi,
      sortBy: "search",
      perPage: 12,
    });

    const matchedItem = (result.items ?? []).find((candidate) => {
      const sameYear = !details.year || !candidate.year || candidate.year === details.year;
      if (!sameYear) return false;
      if (!wantsHindi) return !candidate.is_hindi;
      const normalized = `${candidate.title} ${candidate.corner || ""} ${candidate.country || ""}`.toLowerCase();
      return Boolean(candidate.is_hindi) || normalized.includes("hindi") || normalized.includes("dub");
    }) ?? (result.items ?? []).find((candidate) => {
      const sameYear = !details.year || !candidate.year || candidate.year === details.year;
      return sameYear;
    });

    if (!matchedItem?.id) {
      return [] as StreamSource[];
    }

    return await fetchMovieBoxSources({
      subjectId: matchedItem.id,
      title: matchedItem.title || details.title,
      mediaType: details.media_type,
      year: matchedItem.year || details.year,
      season,
      episode,
    });
  };

  const loadDownloadOptions = async (language = downloadLanguage) => {
    setSending(true);
    setDownloadError("");
    try {
      const sources = language === "english" && resolvedSources.length > 0
        ? resolvedSources
        : await loadSourcesForLanguage(language);
      if (sources.length === 0) {
        setDownloadOptions([]);
        setDownloadQuality("");
        setDownloadError(
          language === "hindi"
            ? "No Hindi source available. Try downloading in English."
            : "Movie Box did not return a downloadable file."
        );
        return;
      }

      const options = await resolveSourceDownloadOptions(sources);
      setDownloadOptions(options);
      const defaultServer = options[0]?.serverId || "";
      setDownloadServer(defaultServer);
      setDownloadQuality(options.find((option) => option.serverId === defaultServer)?.id || options[0]?.id || "");
    } catch (error) {
      setDownloadOptions([]);
      setDownloadServer("");
      setDownloadQuality("");
      setDownloadError(error instanceof Error ? error.message : "Could not load Movie Box download options.");
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setResolvedSources([]);
    setPlayOptionsError("");
    loadSources()
      .then((sources) => {
        if (!cancelled) {
          setResolvedSources(sources);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setResolvedSources([]);
          setPlayOptionsError(error instanceof Error ? error.message : "Could not load playable sources.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [details.id, details.media_type, season, episode]);

  useEffect(() => {
    if (resolvedSources.length === 0) return;
    const timer = window.setTimeout(() => {
      void prewarmPlaybackSources(resolvedSources, 3);
    }, 40);
    return () => window.clearTimeout(timer);
  }, [resolvedSources]);

  useEffect(() => {
    if (!downloadDialogOpen) return;
    void loadDownloadOptions(downloadLanguage);
  }, [downloadDialogOpen, downloadLanguage, details.id, season, episode]);

  useEffect(() => {
    if (details.moviebox_media_type === "movie") {
      setPlayOptions([]);
      setPlayQuality("");
      setPlayOptionsError("");
      return;
    }
    let cancelled = false;
    const run = async () => {
      setPlayOptionsLoading(true);
      setPlayOptionsError("");
      try {
        const sources = resolvedSources.length > 0 ? resolvedSources : await loadSources();
        const options = await resolveSourceDownloadOptions(sources);
        if (cancelled) return;
        setPlayOptions(options);
        setPlayQuality((current) => current && options.some((option) => option.id === current) ? current : (options[0]?.id || ""));
        if (!options.length) {
          setPlayOptionsError("No playable qualities were returned for this episode.");
        }
      } catch (error) {
        if (cancelled) return;
        setPlayOptions([]);
        setPlayQuality("");
        setPlayOptionsError(error instanceof Error ? error.message : "Could not load episode qualities.");
      } finally {
        if (!cancelled) setPlayOptionsLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [details.id, details.moviebox_media_type, resolvedSources, season, episode]);

  const handlePlay = async () => {
    try {
      const sources = resolvedSources.length > 0 ? resolvedSources : await loadSources();
      if (sources.length === 0) {
        setToast({ message: "Movie Box did not return any playable sources for this title.", variant: "error" });
        return;
      }

      const selectedOption = playQuality ? playOptions.find((option) => option.id === playQuality) : null;
      const playableSources = selectedOption
        ? sources.filter((source) => source.url === selectedOption.url || source.quality === selectedOption.label)
        : sources;

      onPlay({
        title: details.title,
        subtitle: details.media_type === "movie"
          ? "Movie Box direct playback with subtitle-aware links"
          : `Movie Box direct playback · Season ${season} · Episode ${episode}`,
        subtitleSearchTitle: buildMovieBoxSubtitleSearchTitle(details, season, episode),
        poster: details.poster_proxy || details.poster,
        sources: playableSources.length > 0 ? playableSources : sources,
        mediaType: details.media_type === "movie" ? "movie" : "tv",
      });
      onClose();
    } catch (error) {
      console.error("[GRABIX] MovieBox playback failed", {
        title: details.title,
        subjectId: details.id,
        mediaType: details.media_type,
        season,
        episode,
        reason: error instanceof Error ? error.message : error,
      });
      setToast({ message: "Movie Box playback failed for this title. Try again in a moment.", variant: "error" });
    }
  };

  const handleDownload = async () => {
    setSending(true);
    try {
      const sources = await loadSources();
      const source = sources[0];
      if (!source) {
        setToast({ message: "Movie Box did not return a downloadable file.", variant: "error" });
        return;
      }

      const quality = source.quality || "Auto";
      const mediaLabel = details.moviebox_media_type === "movie"
        ? `${details.title} — ${details.is_hindi ? "Hindi" : "English"} — ${quality}`
        : `${details.title} — S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")} — ${details.is_hindi ? "Hindi" : "English"} — ${quality}`;
      await queueVideoDownload({
        url: source.url,
        title: mediaLabel,
        thumbnail: details.poster_proxy || details.poster || "",
        headers: source.requestHeaders,
        forceHls: source.kind === "hls",
        category: details.moviebox_media_type === "movie" ? "Movies" : "TV Series",
      });
      setSent(true);
      setToast({ message: "Movie Box download queued. Open Downloader to track progress.", variant: "success" });
      window.dispatchEvent(new CustomEvent("grabix:navigate", { detail: { page: "downloader" } }));
      window.setTimeout(() => setSent(false), 2500);
    } catch {
      setToast({ message: "Could not queue this Movie Box download.", variant: "error" });
    } finally {
      setSending(false);
    }
  };
  void handleDownload;

  const handleDownloadDialog = async () => {
    setDownloadLanguage(details.is_hindi ? "hindi" : "english");
    setDownloadServer("");
    setDownloadQuality("");
    setDownloadOptions([]);
    setDownloadError("");
    setDownloadDialogOpen(true);
  };

  const confirmDownload = async () => {
    const selectedOption = visibleDownloadOptions.find((option) => option.id === downloadQuality);
    if (!selectedOption) {
      setDownloadError("Choose a quality before downloading.");
      return;
    }

    setSending(true);
    try {
      const episodeLabel = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
      const mediaLabel = details.moviebox_media_type === "movie"
        ? `${details.title} — ${downloadLanguage === "hindi" ? "Hindi" : "English"} — ${selectedOption.label}`
        : `${details.title} — ${episodeLabel} — ${downloadLanguage === "hindi" ? "Hindi" : "English"} — ${selectedOption.label}`;
      await queueVideoDownload({
        url: selectedOption.url,
        title: mediaLabel,
        thumbnail: details.poster_proxy || details.poster || "",
        headers: selectedOption.headers,
        forceHls: selectedOption.forceHls,
        category: details.moviebox_media_type === "movie" ? "Movies" : details.is_anime ? "Anime" : "TV Series",
        tags: [downloadLanguage === "hindi" ? "Hindi" : "English"],
      });
      setSent(true);
      setToast({ message: "Movie Box download queued. Open Downloader to track progress.", variant: "success" });
      setDownloadDialogOpen(false);
      window.setTimeout(() => setSent(false), 2500);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Could not queue this Movie Box download.");
    } finally {
      setSending(false);
    }
  };

  const seasonNumbers = details.available_seasons?.length ? details.available_seasons : [1];
  const totalEpisodes = details.season_episode_counts?.[season] || Math.max(1, Math.min(100, episode));
  const episodeOptions = Array.from({ length: totalEpisodes }, (_, index) => index + 1);
  const serverOptions = Array.from(
    new Map(downloadOptions.map((option) => [option.serverId || option.serverLabel || "moviebox", toServerOption(option)])).values()
  );
  const visibleDownloadOptions = downloadServer
    ? downloadOptions.filter((option) => option.serverId === downloadServer)
    : downloadOptions;

  useEffect(() => {
    if (!downloadDialogOpen) return;
    if (!visibleDownloadOptions.some((option) => option.id === downloadQuality)) {
      setDownloadQuality(visibleDownloadOptions[0]?.id || "");
    }
  }, [downloadDialogOpen, downloadServer, downloadQuality, visibleDownloadOptions]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 16, width: "100%", maxWidth: 760, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)" }} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: "flex", gap: 18, padding: "20px 20px 0" }}>
          {details.poster ? (
            <MovieBoxPoster item={details} alt={details.title} width={108} height={156} rounded={10} border />
          ) : (
            <div style={{ width: 108, height: 156, borderRadius: 10, flexShrink: 0, background: "var(--bg-surface2)" }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{details.title}</div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
              {details.imdb_rating ? (
                <span style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 600, color: "#fdd663" }}>
                  <IconStar size={11} color="#fdd663" /> IMDb {details.imdb_rating.toFixed(1)}
                </span>
              ) : null}
              {details.year ? <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>{details.year}</span> : null}
              <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)", textTransform: "capitalize" }}>{details.media_type}</span>
              {details.is_hindi ? <span style={{ background: "var(--accent-soft)", color: "var(--text-accent)", padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>Hindi</span> : null}
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {(details.genres ?? []).slice(0, 6).map((genre) => (
                <span key={genre} style={{ background: "var(--bg-active)", color: "var(--text-accent)", padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 500 }}>
                  {genre}
                </span>
              ))}
            </div>
          </div>
          <button className="btn-icon" style={{ alignSelf: "flex-start", flexShrink: 0 }} onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px" }}>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 16 }}>
            {loading ? "Loading Movie Box details..." : details.description || "No description from Movie Box for this title yet."}
          </div>

          {details.moviebox_media_type !== "movie" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 16 }}>
              <div style={{ minWidth: 130 }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>Season</div>
                <select className="input-base" value={season} onChange={(event) => setSeason(Number(event.target.value))}>
                  {seasonNumbers.map((value) => (
                    <option key={value} value={value}>
                      Season {value}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>Episodes</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", maxHeight: 180, overflowY: "auto", paddingRight: 4 }}>
                  {episodeOptions.map((value) => (
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
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>Qualities</div>
                {playOptionsLoading ? (
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading available qualities...</div>
                ) : playOptionsError ? (
                  <div style={{ fontSize: 12, color: "var(--text-danger)" }}>{playOptionsError}</div>
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {playOptions.map((option) => (
                      <button
                        key={option.id}
                        className={`quality-chip${playQuality === option.id ? " active" : ""}`}
                        onClick={() => setPlayQuality(option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {(details.subtitle_languages?.length ?? 0) > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>Subtitle Languages</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {details.subtitle_languages?.map((language) => (
                  <span key={language} style={{ background: "var(--bg-surface2)", padding: "4px 8px", borderRadius: 999, fontSize: 11, color: "var(--text-secondary)" }}>
                    {language}
                  </span>
                ))}
              </div>
            </div>
          )}

            <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
              <button className="btn btn-primary" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={() => void handlePlay()} disabled={loading || sending}>
                <IconPlay size={15} /> Play
              </button>
            <button className="btn btn-ghost" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={() => void handleDownloadDialog()} disabled={sending}>
              {sent ? <><IconCheck size={15} /> Queued</> : <><IconDownload size={15} /> {sending ? "Queueing..." : "Download"}</>}
            </button>
            <button
              className="btn btn-ghost"
              style={{ gap: 7, flex: 1, justifyContent: "center", color: favorite ? "var(--text-danger)" : "var(--text-primary)" }}
              onClick={() =>
                toggle({
                  id: favoriteId,
                  title: details.title,
                  poster: details.poster ?? "",
                  type: favoriteType,
                  source: "moviebox",
                  year: details.year,
                  movieBoxSubjectId: details.id,
                  movieBoxMediaType: details.media_type,
                  isHindi: details.is_hindi,
                })
              }
            >
              <IconHeart size={15} color={favorite ? "var(--text-danger)" : "currentColor"} filled={favorite} />
              {favorite ? "Saved" : "Favorite"}
            </button>
          </div>
        </div>
      </div>
      <DownloadOptionsModal
        visible={downloadDialogOpen}
        title={details.title}
        poster={details.poster_proxy || details.poster || undefined}
        languageOptions={[
          { id: "english", label: "English" },
          { id: "hindi", label: "Hindi" },
        ]}
        selectedLanguage={downloadLanguage}
        onSelectLanguage={(value) => setDownloadLanguage(value as "english" | "hindi")}
        serverOptions={serverOptions}
        selectedServer={downloadServer}
        onSelectServer={setDownloadServer}
        qualityOptions={visibleDownloadOptions.map((option) => ({
          id: option.id,
          label: option.label,
          help: option.sizeLabel ? `Estimated size: ${option.sizeLabel}` : undefined,
        }))}
        selectedQuality={downloadQuality}
        onSelectQuality={setDownloadQuality}
        loading={sending}
        error={downloadError}
        onClose={() => setDownloadDialogOpen(false)}
        onConfirm={() => void confirmDownload()}
      />
      {toast ? <AppToast message={toast.message} variant={toast.variant} onClose={() => setToast(null)} /> : null}
    </div>
  );
}

function MovieBoxPoster({
  item,
  alt,
  width = "100%",
  height,
  rounded = 0,
  border = false,
}: {
  item: MovieBoxItem;
  alt: string;
  width?: number | string;
  height: number;
  rounded?: number;
  border?: boolean;
}) {
  const [src, setSrc] = useState(item.poster || item.poster_proxy || "");

  useEffect(() => {
    setSrc(item.poster || item.poster_proxy || "");
  }, [item.poster, item.poster_proxy]);

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => {
        if (item.poster_proxy && src !== item.poster_proxy) {
          setSrc(item.poster_proxy);
        }
      }}
      style={{
        width,
        height,
        objectFit: "cover",
        borderRadius: rounded,
        flexShrink: 0,
        border: border ? "1px solid var(--border)" : undefined,
      }}
    />
  );
}

function LoadingGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 14 }}>
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className="card" style={{ overflow: "hidden" }}>
          <div style={{ width: "100%", height: 220, background: "var(--bg-surface2)" }} />
          <div style={{ padding: "8px 10px" }}>
            <div style={{ height: 12, background: "var(--bg-surface2)", borderRadius: 4, marginBottom: 6 }} />
            <div style={{ height: 10, background: "var(--bg-surface2)", borderRadius: 4, width: "60%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
