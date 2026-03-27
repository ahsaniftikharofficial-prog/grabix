import { useEffect, useState } from "react";
import {
  BACKEND_API,
  fetchMovieBoxDetails,
  fetchMovieBoxDiscover,
  fetchMovieBoxSources,
  searchMovieBox,
  type MovieBoxItem,
  type MovieBoxSection,
  type StreamSource,
} from "../lib/streamProviders";
import VidSrcPlayer from "../components/VidSrcPlayer";
import { useFavorites } from "../context/FavoritesContext";
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

const GRABIX = BACKEND_API;

type Filter = "all" | "movie" | "series" | "anime" | "hindi";

interface PlayerState {
  title: string;
  subtitle?: string;
  poster?: string;
  sources: StreamSource[];
  mediaType: "movie" | "tv";
}

export default function MovieBoxPage() {
  const [discover, setDiscover] = useState<MovieBoxSection[]>([]);
  const [popularSearches, setPopularSearches] = useState<string[]>([]);
  const [results, setResults] = useState<MovieBoxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<MovieBoxItem | null>(null);
  const [player, setPlayer] = useState<PlayerState | null>(null);

  const isSearchMode = query.trim().length > 0;

  const loadDiscover = async () => {
    setLoading(true);
    try {
      const data = await fetchMovieBoxDiscover();
      setDiscover(data.sections);
      setPopularSearches(data.popular_searches);
    } catch {
      setDiscover([]);
      setPopularSearches([]);
    } finally {
      setLoading(false);
    }
  };

  const runSearch = async (nextQuery: string, nextPage = 1) => {
    setLoading(true);
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
    } finally {
      setLoading(false);
    }
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

  const sectionsToRender = filter === "all"
    ? discover
    : discover.filter((section) => {
        if (filter === "hindi") return section.id === "hindi";
        if (filter === "anime") return section.id === "anime";
        if (filter === "movie") return section.id === "movies" || section.id === "top-rated" || section.id === "recent";
        if (filter === "series") return section.id === "series" || section.id === "most-popular";
        return true;
      });

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
        {loading && ((isSearchMode && results.length === 0) || (!isSearchMode && sectionsToRender.length === 0)) ? (
          <LoadingGrid />
        ) : isSearchMode ? (
          results.length === 0 ? (
            <div className="empty-state">
              <IconSearch size={36} />
              <p>No Movie Box results</p>
              <span>Try another title, or keep Hindi mode on for dubbed results.</span>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
                Searching Movie Box with Hindi priority and direct-source playback.
              </div>
              <MediaGrid items={results} onOpen={setDetail} />
              <div style={{ textAlign: "center", marginTop: 24 }}>
                <button className="btn btn-ghost" style={{ gap: 6 }} onClick={loadMore} disabled={loading || results.length < 24}>
                  <IconRefresh size={14} /> Load more
                </button>
              </div>
            </>
          )
        ) : sectionsToRender.length === 0 ? (
          <div className="empty-state">
            <IconSearch size={36} />
            <p>No discover data right now</p>
            <span>Movie Box may be rate-limiting or temporarily unavailable.</span>
          </div>
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
      {player && <VidSrcPlayer title={player.title} subtitle={player.subtitle} poster={player.poster} sources={player.sources} mediaType={player.mediaType} onClose={() => setPlayer(null)} />}
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

  const loadSources = async () =>
    fetchMovieBoxSources({
      subjectId: details.id,
      title: details.title,
      mediaType: details.media_type,
      year: details.year,
      season,
      episode,
    });

  const handlePlay = async () => {
    try {
      const sources = await loadSources();
      if (sources.length === 0) {
        alert("Movie Box did not return any playable sources for this title.");
        return;
      }

      onPlay({
        title: details.title,
        subtitle: details.media_type === "movie"
          ? "Movie Box direct playback with subtitle-aware links"
          : `Movie Box direct playback · Season ${season} · Episode ${episode}`,
        poster: details.poster_proxy || details.poster,
        sources,
        mediaType: details.media_type === "movie" ? "movie" : "tv",
      });
      onClose();
    } catch {
      alert("Movie Box playback failed for this title. Try another title or try again in a moment.");
    }
  };

  const handleDownload = async () => {
    setSending(true);
    try {
      const sources = await loadSources();
      const source = sources[0];
      if (!source) {
        alert("Movie Box did not return a downloadable file.");
        return;
      }

      const response = await fetch(`${GRABIX}/download?url=${encodeURIComponent(source.url)}&dl_type=video`);
      if (!response.ok) {
        throw new Error(`Downloader returned ${response.status}`);
      }
      setSent(true);
      window.dispatchEvent(new CustomEvent("grabix:navigate", { detail: { page: "downloader" } }));
      window.setTimeout(() => setSent(false), 2500);
    } catch {
      alert("Could not queue this Movie Box download.");
    } finally {
      setSending(false);
    }
  };

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
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <div style={{ minWidth: 130 }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>Season</div>
                <select className="input-base" value={season} onChange={(event) => setSeason(Number(event.target.value))}>
                  {(details.available_seasons?.length ? details.available_seasons : [1]).map((value) => (
                    <option key={value} value={value}>
                      Season {value}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ minWidth: 130 }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>Episode</div>
                <input className="input-base" type="number" min={1} value={episode} onChange={(event) => setEpisode(Math.max(1, Number(event.target.value) || 1))} />
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
            <button className="btn btn-primary" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={() => void handlePlay()}>
              <IconPlay size={15} /> Play
            </button>
            <button className="btn btn-ghost" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={() => void handleDownload()} disabled={sending}>
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
