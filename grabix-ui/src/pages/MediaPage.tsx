// grabix-ui/src/pages/MediaPage.tsx
// Merged Movies + TV Series page. Pass mediaType="movie" or mediaType="tv".

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
import {
  TMDB_BACKDROP_BASE as IMG_LG,
  TMDB_IMAGE_BASE as IMG_BASE,
  discoverTmdbMedia,
  fetchTmdbDetails,
  fetchTmdbTvSeason,
  searchTmdbMedia,
} from "../lib/tmdb";
import {
  fetchMovieBoxDiscover,
  fetchMovieBoxSources,
  getArchiveMovieSources,
  getMovieSources,
  getTvSources,
  resolveMoviePlaybackSources,
  resolveTvPlaybackSources,
  searchMovieBox,
  type MovieBoxItem,
  type StreamSource,
} from "../lib/streamProviders";
import { fetchSharedTopRatedMovies } from "../lib/topRatedMedia";
import { fetchSharedTopRatedTv } from "../lib/topRatedMedia";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MediaPageType = "movie" | "tv";

interface Movie {
  id: number; title: string; overview: string;
  poster_path: string; backdrop_path?: string;
  poster_url?: string; moviebox_subject_id?: string;
  vote_average: number; release_date: string;
  imdb_id?: string;
  genres?: { id: number; name: string }[];
}

interface Show {
  id: number; name: string; overview: string;
  poster_path: string; backdrop_path?: string;
  poster_url?: string; moviebox_subject_id?: string;
  vote_average: number; first_air_date: string;
  genres?: { id: number; name: string }[];
  number_of_seasons?: number; number_of_episodes?: number;
  status?: string;
  external_ids?: { imdb_id?: string };
  seasons?: { season_number: number; episode_count?: number; name?: string }[];
}

interface ArchiveItem {
  identifier: string; title: string; year?: string;
  description?: string; thumb?: string;
}

type MovieTab = "popular" | "toprated";
type TvTab = "trending" | "popular" | "toprated";

interface PlayerState { title: string; subtitle?: string; poster?: string; sources: StreamSource[] }

// ─── Static fallback data ─────────────────────────────────────────────────────

const STATIC_TOP_MOVIES: Array<{ id: number; title: string; year: number }> = [
  { id: -101, title: "The Shawshank Redemption", year: 1994 },
  { id: -102, title: "The Godfather", year: 1972 },
  { id: -103, title: "The Dark Knight", year: 2008 },
  { id: -104, title: "The Godfather Part II", year: 1974 },
  { id: -105, title: "12 Angry Men", year: 1957 },
  { id: -106, title: "Schindler's List", year: 1993 },
  { id: -107, title: "The Lord of the Rings: The Return of the King", year: 2003 },
  { id: -108, title: "Pulp Fiction", year: 1994 },
  { id: -109, title: "The Good, the Bad and the Ugly", year: 1966 },
  { id: -110, title: "Fight Club", year: 1999 },
];

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

// ─── Mapper helpers ───────────────────────────────────────────────────────────

function makeFallbackId(subjectId: string): number {
  let hash = 0;
  for (const char of subjectId) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return -(Math.abs(hash) || 1);
}

function mapMovieBoxMovie(item: MovieBoxItem): Movie {
  return {
    id: makeFallbackId(item.id),
    title: item.title,
    overview: item.description || "",
    poster_path: "",
    poster_url: item.poster_proxy || item.poster || "",
    moviebox_subject_id: item.id,
    backdrop_path: "",
    vote_average: item.imdb_rating ?? 0,
    release_date: item.year ? `${item.year}-01-01` : "",
    genres: (item.genres ?? []).map((g, i) => ({ id: i + 1, name: g })),
  };
}

function mapStaticMovie(item: { id: number; title: string; year: number }): Movie {
  return { id: item.id, title: item.title, overview: "", poster_path: "", backdrop_path: "", vote_average: 0, release_date: `${item.year}-01-01`, genres: [] };
}

function mapMovieBoxShow(item: MovieBoxItem): Show {
  const seasons = (item.available_seasons ?? []).map((n) => ({
    season_number: n,
    episode_count: item.season_episode_counts?.[n] ?? 0,
    name: `Season ${n}`,
  }));
  const totalEpisodes = seasons.reduce((sum, s) => sum + Math.max(s.episode_count ?? 0, 0), 0);
  return {
    id: makeFallbackId(item.id),
    name: item.title,
    overview: item.description || "",
    poster_path: "",
    poster_url: item.poster_proxy || item.poster || "",
    moviebox_subject_id: item.id,
    vote_average: item.imdb_rating ?? 0,
    first_air_date: item.year ? `${item.year}-01-01` : "",
    genres: (item.genres ?? []).map((g, i) => ({ id: i + 1, name: g })),
    number_of_seasons: seasons.length || undefined,
    number_of_episodes: totalEpisodes || undefined,
    seasons,
  };
}

function mapStaticShow(item: { id: number; name: string; year: number }): Show {
  return { id: item.id, name: item.name, overview: "", poster_path: "", backdrop_path: "", vote_average: 0, first_air_date: `${item.year}-01-01`, genres: [] };
}

function isTvSeriesItem(item: MovieBoxItem): boolean {
  return item.moviebox_media_type === "series" && item.media_type !== "anime";
}

function getMoviePoster(m: Movie): string { return m.poster_url || (m.poster_path ? `${IMG_BASE}${m.poster_path}` : ""); }
function getMovieBackdrop(m: Movie): string { return m.backdrop_path ? `${IMG_LG}${m.backdrop_path}` : ""; }
function getShowPoster(s: Show): string { return s.poster_url || (s.poster_path ? `${IMG_BASE}${s.poster_path}` : ""); }
function getShowBackdrop(s: Show): string { return s.backdrop_path ? `${IMG_LG}${s.backdrop_path}` : ""; }

// ─── Shared sub-components ────────────────────────────────────────────────────

function LoadingGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
      {Array.from({ length: 16 }).map((_, i) => (
        <div key={i} className="card" style={{ overflow: "hidden" }}>
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

function MediaCard({ poster, title, year, rating, onClick }: { poster: string; title: string; year: string; rating: number; onClick: () => void }) {
  return (
    <div className="card" style={{ overflow: "hidden", cursor: "pointer", transition: "transform 0.15s" }} onClick={onClick}
      onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-3px)")}
      onMouseLeave={e => (e.currentTarget.style.transform = "translateY(0)")}>
      <div style={{ position: "relative" }}>
        {poster
          ? <img src={poster} alt={title} style={{ width: "100%", height: 210, objectFit: "cover" }} />
          : <div style={{ width: "100%", height: 210, background: "var(--bg-surface2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>No Poster</div>}
        {rating > 0 && (
          <div style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.75)", color: "#fdd663", fontSize: 11, padding: "2px 7px", borderRadius: 6, display: "flex", alignItems: "center", gap: 3, fontWeight: 600 }}>
            <IconStar size={10} color="#fdd663" /> {rating.toFixed(1)}
          </div>
        )}
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        {year && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{year}</div>}
      </div>
    </div>
  );
}

function ActionButtons({ onPlay, onDownload, onHindi, favId, favItem }: {
  onPlay: () => void; onDownload: () => void; onHindi?: () => void;
  favId: string; favItem: any;
}) {
  const { isFav, toggle } = useFavorites();
  const fav = isFav(favId);
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
      <button className="btn btn-primary" style={{ gap: 7, flex: 1, justifyContent: "center" }} onClick={onPlay}>
        <IconPlay size={15} /> Play
      </button>
      {onHindi && (
        <button className="btn btn-ghost" style={{ gap: 7, justifyContent: "center", paddingInline: 14 }} onClick={onHindi}>Hindi</button>
      )}
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

// ─── Movie Detail Modal ───────────────────────────────────────────────────────

function MovieDetail({ movie, onClose, tf, onPlay }: {
  movie: Movie;
  onClose: () => void;
  tf: (id: number) => Promise<any>;
  onPlay: (p: PlayerState) => void;
}) {
  const [full, setFull] = useState<Movie | null>(null);
  const [altTitles, setAltTitles] = useState<string[]>([]);
  const [prefetchedSources, setPrefetchedSources] = useState<StreamSource[]>([]);
  const [hindiNotice, setHindiNotice] = useState("");
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [downloadLanguage, setDownloadLanguage] = useState<"english" | "hindi">("english");
  const [downloadQuality, setDownloadQuality] = useState("");
  const [downloadOptions, setDownloadOptions] = useState<DownloadQualityOption[]>([]);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const isMovieBox = Boolean(movie.moviebox_subject_id);

  useEffect(() => {
    if (isMovieBox) { setFull(null); return; }
    tf(movie.id).then(setFull).catch(() => {});
  }, [isMovieBox, movie.id, tf]);

  useEffect(() => {
    let cancelled = false;
    fetchConsumetMetaSearch(movie.title, "movie").then((items) => {
      if (cancelled) return;
      const titles = items.flatMap(i => [i.title, i.alt_title])
        .filter((v): v is string => Boolean(v))
        .filter((v, i, a) => a.indexOf(v) === i && v.toLowerCase() !== movie.title.toLowerCase())
        .slice(0, 3);
      setAltTitles(titles);
    }).catch(() => { if (!cancelled) setAltTitles([]); });
    return () => { cancelled = true; };
  }, [movie.title]);

  const d = full ?? movie;
  const movieYear = d.release_date ? Number(d.release_date.slice(0, 4)) : undefined;
  const poster = getMoviePoster(d);
  const backdrop = getMovieBackdrop(d);
  const fallbackSources = getMovieSources({ tmdbId: movie.id, imdbId: d.imdb_id });

  useEffect(() => {
    let cancelled = false;
    resolveMoviePlaybackSources({ tmdbId: movie.id, imdbId: d.imdb_id, title: d.title, altTitles, year: Number.isFinite(movieYear) ? movieYear : undefined })
      .then(sources => { if (!cancelled) setPrefetchedSources(sources); })
      .catch(() => { if (!cancelled) setPrefetchedSources([]); });
    return () => { cancelled = true; };
  }, [altTitles, d.imdb_id, d.title, movie.id, movieYear]);

  const loadMovieBoxSources = async (): Promise<StreamSource[]> => {
    for (const title of [d.title, ...altTitles]) {
      try {
        const srcs = await fetchMovieBoxSources({ title, mediaType: "movie", year: Number.isFinite(movieYear) ? movieYear : undefined });
        if (srcs.length > 0) return srcs;
      } catch { continue; }
    }
    return [];
  };

  const isHindiItem = (item: MovieBoxItem) => Boolean(item.is_hindi) || (item.title || "").toLowerCase().includes("hindi");

  const loadHindiSources = async (): Promise<StreamSource[]> => {
    for (const title of [d.title, ...altTitles]) {
      try {
        const result = await searchMovieBox({ query: title, mediaType: "movie", hindiOnly: true, preferHindi: true, sortBy: "search", perPage: 10 });
        const hindiItem = (result.items ?? []).find(item => {
          const sameYear = !movieYear || !item.year || item.year === movieYear;
          return sameYear && isHindiItem(item);
        });
        if (!hindiItem?.id) continue;
        const srcs = await fetchMovieBoxSources({ subjectId: hindiItem.id, mediaType: "movie", year: Number.isFinite(movieYear) ? movieYear : undefined });
        if (srcs.length > 0) return srcs;
      } catch { continue; }
    }
    return [];
  };

  const loadDownloadOptions = async (lang = downloadLanguage) => {
    setDownloadLoading(true); setDownloadError("");
    try {
      const srcs = lang === "hindi" ? await loadHindiSources() : await loadMovieBoxSources();
      if (srcs.length > 0) {
        const opts = await resolveSourceDownloadOptions(srcs);
        setDownloadOptions(opts); setDownloadQuality(opts[0]?.id || ""); return;
      }
      if (lang === "hindi") { setDownloadOptions([]); setDownloadQuality(""); setDownloadError("No Hindi source available. Try English."); return; }
      const fallback = await resolveSourceDownloadOptions(fallbackSources.slice(0, 1));
      setDownloadOptions(fallback); setDownloadQuality(fallback[0]?.id || "");
      if (fallback.length === 0) setDownloadError("No downloadable source was found.");
    } catch (err) {
      setDownloadOptions([]); setDownloadQuality("");
      setDownloadError(err instanceof Error ? err.message : "Download options could not be loaded.");
    } finally { setDownloadLoading(false); }
  };

  useEffect(() => {
    if (!downloadDialogOpen) return;
    void loadDownloadOptions(downloadLanguage);
  }, [downloadDialogOpen, downloadLanguage, d.title, movieYear]);

  const handlePlay = () => {
    setHindiNotice("");
    onPlay({ title: d.title, subtitle: "Movie playback", poster: poster || undefined, sources: prefetchedSources.length > 0 ? prefetchedSources : fallbackSources });
  };

  const handleHindi = async () => {
    const srcs = await loadHindiSources();
    if (!srcs.length) { setHindiNotice("No Hindi source found. Watch in original language."); return; }
    setHindiNotice("");
    onPlay({ title: d.title, subtitle: "Hindi playback from MovieBox", poster: poster || undefined, sources: srcs });
  };

  const confirmDownload = async () => {
    const opt = downloadOptions.find(o => o.id === downloadQuality);
    if (!opt) { setDownloadError("Choose a quality before downloading."); return; }
    setDownloadLoading(true);
    try {
      await queueVideoDownload({ url: opt.url, title: `${d.title} — ${downloadLanguage === "hindi" ? "Hindi" : "English"} — ${opt.label}`, thumbnail: poster, headers: opt.headers, forceHls: opt.forceHls, category: "Movies", tags: [downloadLanguage === "hindi" ? "Hindi" : "English"] });
      setDownloadDialogOpen(false);
    } catch (err) { setDownloadError(err instanceof Error ? err.message : "Could not queue download."); }
    finally { setDownloadLoading(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 16, width: "100%", maxWidth: 700, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
        {backdrop && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <img src={backdrop} alt="" style={{ width: "100%", height: 180, objectFit: "cover" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(transparent 40%, var(--bg-surface))" }} />
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 24px" }}>
          <div style={{ display: "flex", gap: 16, marginTop: backdrop ? -50 : 20 }}>
            {poster && <img src={poster} alt={d.title} style={{ width: 90, height: 135, objectFit: "cover", borderRadius: 10, flexShrink: 0, border: "2px solid var(--border)", position: "relative", zIndex: 1 }} />}
            <div style={{ flex: 1, paddingTop: backdrop ? 55 : 0, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{d.title}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {d.vote_average > 0 && <span style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 600, color: "#fdd663" }}><IconStar size={11} color="#fdd663" /> {d.vote_average.toFixed(1)}</span>}
                {d.release_date && <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>{d.release_date.slice(0, 4)}</span>}
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {(full?.genres ?? []).slice(0, 4).map((g: any) => <span key={g.id} style={{ background: "var(--bg-active)", color: "var(--text-accent)", padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 500 }}>{g.name}</span>)}
              </div>
            </div>
            <button className="btn-icon" style={{ alignSelf: "flex-start", flexShrink: 0, marginTop: backdrop ? 55 : 0 }} onClick={onClose}><IconX size={16} /></button>
          </div>
          {d.overview && <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, margin: "14px 0" }}>{d.overview}</div>}
          <ActionButtons onPlay={handlePlay} onDownload={() => { setDownloadLanguage("english"); setDownloadQuality(""); setDownloadOptions([]); setDownloadError(""); setDownloadDialogOpen(true); }} onHindi={handleHindi} favId={`movie-${movie.id}`} favItem={{ id: `movie-${movie.id}`, title: d.title, poster, type: "movie", tmdbId: movie.id, imdbId: d.imdb_id }} />
          {hindiNotice && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -4 }}>{hindiNotice}</div>}
        </div>
      </div>
      <DownloadOptionsModal visible={downloadDialogOpen} title={d.title} poster={poster || undefined} languageOptions={[{ id: "english", label: "English" }, { id: "hindi", label: "Hindi" }]} selectedLanguage={downloadLanguage} onSelectLanguage={v => setDownloadLanguage(v as "english" | "hindi")} qualityOptions={downloadOptions.map(o => ({ id: o.id, label: o.label }))} selectedQuality={downloadQuality} onSelectQuality={setDownloadQuality} loading={downloadLoading} error={downloadError} onClose={() => setDownloadDialogOpen(false)} onConfirm={() => void confirmDownload()} />
    </div>
  );
}

// ─── Archive Movie Detail Modal (free films) ──────────────────────────────────

function ArchiveDetail({ movie, onClose, onPlay }: { movie: ArchiveItem; onClose: () => void; onPlay: (p: PlayerState) => void }) {
  const archiveUrl = `https://archive.org/details/${movie.identifier}`;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 16, width: "100%", maxWidth: 680, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "20px 20px 0" }}>
          <img src={movie.thumb} alt={movie.title} style={{ width: 90, height: 130, objectFit: "cover", borderRadius: 8, flexShrink: 0, border: "1px solid var(--border)" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{movie.title}</div>
              <span style={{ background: "var(--text-success)", color: "white", fontSize: 9, padding: "2px 6px", borderRadius: 5, fontWeight: 700 }}>FREE</span>
            </div>
            {movie.year && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{movie.year} · Public domain · Archive.org</div>}
          </div>
          <button className="btn-icon" style={{ flexShrink: 0 }} onClick={onClose}><IconX size={16} /></button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px" }}>
          {movie.description && <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 16 }}>{typeof movie.description === "string" ? movie.description.replace(/<[^>]+>/g, "").slice(0, 400) + "…" : ""}</div>}
          <ActionButtons
            onPlay={() => onPlay({ title: movie.title, subtitle: "Archive.org public-domain stream", poster: movie.thumb ?? undefined, sources: getArchiveMovieSources(movie.identifier) })}
            onDownload={async () => { try { await queueVideoDownload({ url: archiveUrl, title: `${movie.title} — English — Source`, thumbnail: movie.thumb ?? "", category: "Movies" }); } catch { } }}
            favId={`archive-${movie.identifier}`}
            favItem={{ id: `archive-${movie.identifier}`, title: movie.title, poster: movie.thumb ?? "", type: "movie", tmdbId: 0 }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Series Detail Modal ──────────────────────────────────────────────────────

function SeriesDetail({ show, tf, onClose, onPlay }: {
  show: Show;
  tf: (kind: "details" | "season", id: number, seasonNumber?: number) => Promise<any>;
  onClose: () => void;
  onPlay: (p: PlayerState) => void;
}) {
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
  const isMovieBox = Boolean(show.moviebox_subject_id);

  useEffect(() => {
    if (isMovieBox) { setFull(null); return; }
    tf("details", show.id).then(setFull).catch(() => {});
  }, [isMovieBox, show.id, tf]);

  useEffect(() => {
    let cancelled = false;
    fetchConsumetMetaSearch(show.name, "tv").then(items => {
      if (cancelled) return;
      const titles = items.flatMap(i => [i.title, i.alt_title])
        .filter((v): v is string => Boolean(v))
        .filter((v, i, a) => a.indexOf(v) === i && v.toLowerCase() !== show.name.toLowerCase())
        .slice(0, 3);
      setAltTitles(titles);
    }).catch(() => { if (!cancelled) setAltTitles([]); });
    return () => { cancelled = true; };
  }, [show.name]);

  useEffect(() => {
    let cancelled = false;
    const owner = full ?? show;
    if (isMovieBox) {
      const fallback = owner.seasons?.find(s => s.season_number === season)?.episode_count ?? 12;
      setSeasonEpisodes(Math.max(fallback, 1));
      setEpisode(cur => Math.min(cur, Math.max(fallback, 1)));
      return () => { cancelled = true; };
    }
    tf("season", show.id, season)
      .then(seasonData => {
        if (cancelled) return;
        const count = Array.isArray(seasonData?.episodes) ? seasonData.episodes.length : 0;
        setSeasonEpisodes(Math.max(count, 1));
        setEpisode(cur => Math.min(cur, Math.max(count, 1)));
      })
      .catch(() => {
        if (!cancelled) {
          const fallback = (full ?? show).seasons?.find(s => s.season_number === season)?.episode_count ?? 12;
          setSeasonEpisodes(Math.max(fallback, 1));
        }
      });
    return () => { cancelled = true; };
  }, [isMovieBox, show, full, season, tf]);

  const data = full ?? show;
  const poster = getShowPoster(data);
  const backdrop = getShowBackdrop(data);
  const seriesYear = data.first_air_date ? Number(data.first_air_date.slice(0, 4)) : undefined;
  const fallbackSources = isMovieBox ? [] : getTvSources({ tmdbId: show.id, imdbId: data.external_ids?.imdb_id }, { season, episode });

  const availableSeasons = (data.seasons ?? []).map(s => s.season_number).filter(n => n > 0);
  const seasonCounts = (data.seasons ?? []).filter(s => s.season_number > 0).map(s => ({ season: s.season_number, count: Math.max(s.episode_count ?? 0, 0) }));
  const totalEpisodes = Math.max(data.number_of_episodes ?? seasonCounts.reduce((sum, s) => sum + s.count, 0), seasonEpisodes);

  const globalEpisodeMap = useMemo(() =>
    seasonCounts.flatMap(s =>
      Array.from({ length: s.count }, (_, i) => ({
        global: seasonCounts.filter(e => e.season < s.season).reduce((sum, e) => sum + e.count, 0) + i + 1,
        season: s.season,
        episode: i + 1,
      }))
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(seasonCounts)]
  );

  const episodeGroups = Math.ceil(seasonEpisodes / 50);
  const selectedGroup = Math.floor((episode - 1) / 50);
  const episodeStart = selectedGroup * 50 + 1;
  const episodeEnd = Math.min(seasonEpisodes, episodeStart + 49);
  const visibleEpisodes = Array.from({ length: Math.max(0, episodeEnd - episodeStart + 1) }, (_, i) => episodeStart + i);
  const globalEpisodeGroups = Math.ceil(Math.max(totalEpisodes, 1) / 100);
  const globalEpisode = globalEpisodeMap.find(e => e.season === season && e.episode === episode)?.global ?? episode;
  const selectedGlobalGroup = Math.floor((globalEpisode - 1) / 100);
  const globalStart = selectedGlobalGroup * 100 + 1;
  const globalEnd = Math.min(totalEpisodes, globalStart + 99);
  const visibleGlobalEpisodes = Array.from({ length: Math.max(0, globalEnd - globalStart + 1) }, (_, i) => globalStart + i);

  const loadMovieBoxSources = async (): Promise<StreamSource[]> => {
    if (show.moviebox_subject_id) {
      try {
        const srcs = await fetchMovieBoxSources({ subjectId: show.moviebox_subject_id, mediaType: "series", year: Number.isFinite(seriesYear) ? seriesYear : undefined, season, episode });
        if (srcs.length > 0) return srcs;
      } catch { }
    }
    for (const title of [data.name, ...altTitles]) {
      try {
        const srcs = await fetchMovieBoxSources({ title, mediaType: "series", year: Number.isFinite(seriesYear) ? seriesYear : undefined, season, episode });
        if (srcs.length > 0) return srcs;
      } catch { continue; }
    }
    return [];
  };

  const isHindiItem = (item: MovieBoxItem) => Boolean(item.is_hindi) || (item.title || "").toLowerCase().includes("hindi");

  const loadHindiSources = async (): Promise<StreamSource[]> => {
    for (const title of [data.name, ...altTitles]) {
      try {
        const result = await searchMovieBox({ query: title, mediaType: "series", hindiOnly: true, preferHindi: true, sortBy: "search", perPage: 10 });
        const hindiItem = (result.items ?? []).find(item => {
          const sameYear = !seriesYear || !item.year || item.year === seriesYear;
          return sameYear && isHindiItem(item);
        });
        if (!hindiItem?.id) continue;
        const srcs = await fetchMovieBoxSources({ subjectId: hindiItem.id, mediaType: "series", year: Number.isFinite(seriesYear) ? seriesYear : undefined, season, episode });
        if (srcs.length > 0) return srcs;
      } catch { continue; }
    }
    return [];
  };

  const loadDownloadOptions = async (lang = downloadLanguage) => {
    setDownloadLoading(true); setDownloadError("");
    try {
      const srcs = lang === "hindi" ? await loadHindiSources() : await loadMovieBoxSources();
      if (srcs.length > 0) {
        const opts = await resolveSourceDownloadOptions(srcs);
        setDownloadOptions(opts); setDownloadQuality(opts[0]?.id || ""); return;
      }
      if (lang === "hindi") { setDownloadOptions([]); setDownloadQuality(""); setDownloadError("No Hindi source available."); return; }
      const fallback = await resolveSourceDownloadOptions(fallbackSources.slice(0, 1));
      setDownloadOptions(fallback); setDownloadQuality(fallback[0]?.id || "");
      if (fallback.length === 0) setDownloadError("No downloadable source was found.");
    } catch (err) {
      setDownloadOptions([]); setDownloadQuality("");
      setDownloadError(err instanceof Error ? err.message : "Download options could not be loaded.");
    } finally { setDownloadLoading(false); }
  };

  useEffect(() => {
    if (!downloadDialogOpen) return;
    void loadDownloadOptions(downloadLanguage);
  }, [downloadDialogOpen, downloadLanguage, data.name, season, episode]);

  const handlePlay = async () => {
    const movieBoxSrcs = await loadMovieBoxSources();
    const sources = movieBoxSrcs.length > 0 ? movieBoxSrcs : (
      await resolveTvPlaybackSources({ tmdbId: show.id, imdbId: data.external_ids?.imdb_id, title: data.name, altTitles, year: Number.isFinite(seriesYear) ? seriesYear : undefined, season, episode }).catch(() => fallbackSources)
    );
    onPlay({ title: `${data.name} — S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`, subtitle: "TV series playback", poster: poster || undefined, sources: sources.length > 0 ? sources : fallbackSources });
  };

  const confirmDownload = async () => {
    const opt = downloadOptions.find(o => o.id === downloadQuality);
    if (!opt) { setDownloadError("Choose a quality before downloading."); return; }
    const episodeLabel = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
    setDownloadLoading(true);
    try {
      await queueVideoDownload({ url: opt.url, title: `${data.name} — ${episodeLabel} — ${downloadLanguage === "hindi" ? "Hindi" : "English"} — ${opt.label}`, thumbnail: poster, headers: opt.headers, forceHls: opt.forceHls, category: "TV Series", tags: [episodeLabel, downloadLanguage === "hindi" ? "Hindi" : "English"] });
      setDownloadDialogOpen(false);
    } catch (err) { setDownloadError(err instanceof Error ? err.message : "Could not queue download."); }
    finally { setDownloadLoading(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 16, width: "100%", maxWidth: 700, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
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
                {(data.genres ?? []).slice(0, 4).map(g => <span key={g.id} style={{ background: "var(--bg-active)", color: "var(--text-accent)", padding: "2px 7px", borderRadius: 10, fontSize: 11, fontWeight: 500 }}>{g.name}</span>)}
              </div>
            </div>
            <button className="btn-icon" style={{ alignSelf: "flex-start", flexShrink: 0, marginTop: backdrop ? 55 : 0 }} onClick={onClose}><IconX size={16} /></button>
          </div>

          {data.overview && <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, margin: "14px 0" }}>{data.overview}</div>}

          {/* Season / Episode pickers */}
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Season</div>
              {availableSeasons.length > 0 ? (
                <select className="input-base" value={season} onChange={e => setSeason(Number(e.target.value))}>
                  {availableSeasons.map(n => <option key={n} value={n}>Season {n}</option>)}
                </select>
              ) : (
                <input className="input-base" type="number" min={1} value={season} onChange={e => setSeason(Math.max(1, Number(e.target.value) || 1))} />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Episode</div>
              <input className="input-base" type="number" min={1} value={episode} onChange={e => setEpisode(Math.max(1, Number(e.target.value) || 1))} />
            </div>
          </div>

          {/* Episode grid */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Episodes</div>
              {episodeGroups > 1 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {Array.from({ length: episodeGroups }, (_, i) => {
                    const start = i * 50 + 1; const end = Math.min(seasonEpisodes, start + 49);
                    return <button key={`${start}-${end}`} className={`quality-chip${selectedGroup === i ? " active" : ""}`} onClick={() => setEpisode(start)}>{start}-{end}</button>;
                  })}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 144, overflowY: "auto", paddingRight: 4 }}>
              {visibleEpisodes.map(n => (
                <button key={n} className={`quality-chip${episode === n ? " active" : ""}`} onClick={() => setEpisode(n)}>{n}</button>
              ))}
            </div>
          </div>

          {/* Global episode map (multi-season view) */}
          {globalEpisodeMap.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Overall Episodes</div>
                {globalEpisodeGroups > 1 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {Array.from({ length: globalEpisodeGroups }, (_, i) => {
                      const start = i * 100 + 1; const end = Math.min(totalEpisodes, start + 99);
                      return <button key={`global-${start}-${end}`} className={`quality-chip${selectedGlobalGroup === i ? " active" : ""}`} onClick={() => { const m = globalEpisodeMap.find(e => e.global === start); if (m) { setSeason(m.season); setEpisode(m.episode); } }}>{start}-{end}</button>;
                    })}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 144, overflowY: "auto", paddingRight: 4 }}>
                {visibleGlobalEpisodes.map(n => {
                  const m = globalEpisodeMap.find(e => e.global === n);
                  if (!m) return null;
                  return <button key={`global-${n}`} className={`quality-chip${globalEpisode === n ? " active" : ""}`} onClick={() => { setSeason(m.season); setEpisode(m.episode); }}>{n}</button>;
                })}
              </div>
            </div>
          )}

          <ActionButtons onPlay={() => void handlePlay()} onDownload={() => { setDownloadLanguage("english"); setDownloadQuality(""); setDownloadOptions([]); setDownloadError(""); setDownloadDialogOpen(true); }} favId={`series-${show.id}`} favItem={{ id: `series-${show.id}`, title: data.name, poster: data.poster_path ? `${IMG_BASE}${data.poster_path}` : "", type: "series", tmdbId: show.id, imdbId: data.external_ids?.imdb_id }} />
        </div>
      </div>
      <DownloadOptionsModal visible={downloadDialogOpen} title={data.name} poster={poster || undefined} languageOptions={[{ id: "english", label: "English" }, { id: "hindi", label: "Hindi" }]} selectedLanguage={downloadLanguage} onSelectLanguage={v => setDownloadLanguage(v as "english" | "hindi")} qualityOptions={downloadOptions.map(o => ({ id: o.id, label: o.label }))} selectedQuality={downloadQuality} onSelectQuality={setDownloadQuality} loading={downloadLoading} error={downloadError} onClose={() => setDownloadDialogOpen(false)} onConfirm={() => void confirmDownload()} />
    </div>
  );
}

// ─── Main MediaPage Component ─────────────────────────────────────────────────

export default function MediaPage({ mediaType }: { mediaType: MediaPageType }) {
  const isMovie = mediaType === "movie";
  const { adultContentBlocked } = useContentFilter();

  // ── Movie state ──
  const [movies, setMovies] = useState<Movie[]>([]);
  const [movieTab, setMovieTab] = useState<MovieTab>("popular");
  const [movieDetail, setMovieDetail] = useState<Movie | null>(null);
  const [archiveDetail, setArchiveDetail] = useState<ArchiveItem | null>(null);

  // ── TV state ──
  const [shows, setShows] = useState<Show[]>([]);
  const [tvTab, setTvTab] = useState<TvTab>("trending");
  const [showDetail, setShowDetail] = useState<Show | null>(null);

  // ── Shared state ──
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Callbacks for TMDB details
  const movieTf = useCallback((id: number) => fetchTmdbDetails("movie", id), []);
  const tvTf = useCallback((kind: "details" | "season", id: number, seasonNumber?: number) => {
    if (kind === "season" && typeof seasonNumber === "number") return fetchTmdbTvSeason(id, seasonNumber);
    return fetchTmdbDetails("tv", id, "external_ids");
  }, []);

  // ── Movie data fetching ──
  const fetchMovies = async (tab: MovieTab, p = 1) => {
    setLoading(true); setPageError("");
    if (p === 1) setMovies([]);
    if (tab === "toprated") {
      try {
        const { items } = await fetchSharedTopRatedMovies();
        const mapped = items.map(item => "moviebox_media_type" in item ? mapMovieBoxMovie(item) : { id: item.id, title: item.title, overview: "", poster_path: item.poster_path ?? "", backdrop_path: "", vote_average: item.vote_average ?? 0, release_date: item.release_date ?? "", genres: [] } as Movie);
        const withPoster = mapped.filter(m => getMoviePoster(m) !== "");
        setMovies((withPoster.length > 0 ? withPoster.slice(0, 100) : mapped.slice(0, p * 24)).length > 0 ? (withPoster.length > 0 ? withPoster.slice(0, 100) : mapped.slice(0, p * 24)) : STATIC_TOP_MOVIES.map(mapStaticMovie));
      } catch { setMovies(STATIC_TOP_MOVIES.map(mapStaticMovie)); }
      finally { setLoading(false); }
      return;
    }
    try {
      const d = await discoverTmdbMedia("movie", tab === "popular" ? "popular" : "top_rated", p);
      if (!d?.results) throw new Error();
      setMovies(prev => p === 1 ? (d.results ?? []) : [...prev, ...(d.results ?? [])]);
      setLoading(false); return;
    } catch { }
    try {
      const discover = await fetchMovieBoxDiscover();
      const items = (discover.sections ?? []).filter(s => s.id === "movies" || s.id === "most-popular").flatMap(s => s.items ?? []);
      const next = items.filter(i => i.moviebox_media_type === "movie").map(mapMovieBoxMovie);
      setMovies(prev => p === 1 ? next : [...prev, ...next]);
      if (next.length === 0) setPageError("Movies could not be loaded right now.");
    } catch { setMovies([]); setPageError("Movies could not be loaded right now."); }
    finally { setLoading(false); }
  };

  const searchMovies = async (q: string, p = 1) => {
    setLoading(true); setPageError("");
    try {
      const d = await searchTmdbMedia("movie", q, p);
      if (!d?.results) throw new Error();
      setMovies(prev => p === 1 ? (d.results ?? []) : [...prev, ...(d.results ?? [])]);
    } catch { setMovies([]); setPageError("Movie search could not be completed right now."); }
    finally { setLoading(false); }
  };

  // ── TV data fetching ──
  const fetchShows = async (tab: TvTab, p = 1) => {
    setLoading(true); setPageError("");
    if (p === 1) setShows([]);
    if (tab === "toprated") {
      try {
        const { items } = await fetchSharedTopRatedTv();
        const mapped = items.map(item => "moviebox_media_type" in item ? mapMovieBoxShow(item) : { id: item.id, name: item.name, overview: "", poster_path: item.poster_path ?? "", backdrop_path: "", vote_average: item.vote_average ?? 0, first_air_date: item.first_air_date ?? "", genres: [] } as Show);
        const withPoster = mapped.filter(s => getShowPoster(s) !== "");
        const slice = withPoster.length > 0 ? withPoster.slice(0, 100) : mapped.slice(0, p * 24);
        setShows(slice.length > 0 ? slice : STATIC_TOP_TV.map(mapStaticShow));
      } catch { setShows(STATIC_TOP_TV.map(mapStaticShow)); }
      finally { setLoading(false); }
      return;
    }
    const tmdbCat: Record<TvTab, "trending" | "popular" | "top_rated"> = { trending: "trending", popular: "popular", toprated: "top_rated" };
    try {
      const d = await discoverTmdbMedia("tv", tmdbCat[tab], p);
      if (!d?.results) throw new Error();
      setShows(prev => p === 1 ? (d.results as Show[]) : [...prev, ...(d.results as Show[])]);
      setLoading(false); return;
    } catch { }
    try {
      const discover = await fetchMovieBoxDiscover();
      const sectionFilter = tab === "popular" ? ["series", "most-popular"] : ["recent"];
      const items = (discover.sections ?? []).filter(s => sectionFilter.includes(s.id)).flatMap(s => s.items ?? []);
      const next = items.filter(isTvSeriesItem).map(mapMovieBoxShow);
      setShows(prev => p === 1 ? next : [...prev, ...next]);
      if (next.length === 0) setPageError("TV series could not be loaded right now.");
    } catch { setShows([]); setPageError("TV series could not be loaded right now."); }
    finally { setLoading(false); }
  };

  const searchShows = async (q: string, p = 1) => {
    setLoading(true); setPageError("");
    try {
      const d = await searchTmdbMedia("tv", q, p);
      if (!d?.results) throw new Error();
      setShows(prev => p === 1 ? (d.results as Show[]) : [...prev, ...(d.results as Show[])]);
    } catch {
      try {
        const d = await searchMovieBox({ query: q, mediaType: "series", perPage: 24, sortBy: "search" });
        const next = (d.items ?? []).filter(isTvSeriesItem).map(mapMovieBoxShow);
        setShows(prev => p === 1 ? next : [...prev, ...next]);
        if (next.length === 0) setPageError("TV search could not be completed right now.");
      } catch { setShows([]); setPageError("TV search could not be completed right now."); }
    } finally { setLoading(false); }
  };

  // ── Effects ──
  useEffect(() => {
    setPage(1);
    if (query) {
      if (isMovie) searchMovies(query, 1);
      else searchShows(query, 1);
      return;
    }
    if (isMovie) fetchMovies(movieTab, 1);
    else fetchShows(tvTab, 1);
  }, [isMovie ? movieTab : tvTab, query, mediaType]);

  useEffect(() => {
    const root = scrollRef.current; const node = bottomRef.current;
    if (!root || !node) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting) && !loading) loadMore();
    }, { root, rootMargin: "240px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loading, page, query, isMovie ? movieTab : tvTab]);

  const loadMore = () => {
    const n = page + 1; setPage(n);
    if (query) { if (isMovie) searchMovies(query, n); else searchShows(query, n); }
    else { if (isMovie) fetchMovies(movieTab, n); else fetchShows(tvTab, n); }
  };

  const retry = () => {
    setPage(1);
    if (query) { if (isMovie) searchMovies(query, 1); else searchShows(query, 1); return; }
    if (isMovie) fetchMovies(movieTab, 1); else fetchShows(tvTab, 1);
  };

  // ── Render ──
  const title = isMovie ? "Movies" : "TV Series";
  const placeholder = isMovie ? "Search movies…" : "Search series…";

  const movieTabs = [{ id: "popular" as MovieTab, label: "Popular" }, { id: "toprated" as MovieTab, label: "Top Rated" }];
  const tvTabs = [{ id: "trending" as TvTab, label: "Trending" }, { id: "popular" as TvTab, label: "Popular" }, { id: "toprated" as TvTab, label: "Top Rated" }];

  const filteredMovies = useMemo(() => filterAdultContent(movies, adultContentBlocked), [movies, adultContentBlocked]);
  const filteredShows = useMemo(() => filterAdultContent(shows, adultContentBlocked), [shows, adultContentBlocked]);
  const items = isMovie ? filteredMovies : filteredShows;
  const isEmpty = items.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      {/* Header */}
      <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>Browse · Stream · Download</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}><IconSearch size={13} color="var(--text-muted)" /></div>
            <input className="input-base" style={{ paddingLeft: 32, width: 220, fontSize: 13 }} placeholder={placeholder} value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && (search.trim() ? setQuery(search.trim()) : setQuery(""))} />
          </div>
          <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={() => search.trim() ? setQuery(search.trim()) : setQuery("")}>Search</button>
          {query && <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => { setQuery(""); setSearch(""); }}><IconX size={13} /> Clear</button>}
        </div>
      </div>

      {/* Tab bar */}
      {!query && (
        <div style={{ display: "flex", gap: 4, padding: "10px 24px 0", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
          {isMovie
            ? movieTabs.map(t => <button key={t.id} onClick={() => setMovieTab(t.id)} style={{ padding: "7px 16px", fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer", background: "transparent", borderBottom: movieTab === t.id ? "2px solid var(--accent)" : "2px solid transparent", color: movieTab === t.id ? "var(--accent)" : "var(--text-muted)", transition: "var(--transition)", borderRadius: 0 }}>{t.label}</button>)
            : tvTabs.map(t => <button key={t.id} onClick={() => setTvTab(t.id)} style={{ padding: "7px 16px", fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer", background: "transparent", borderBottom: tvTab === t.id ? "2px solid var(--accent)" : "2px solid transparent", color: tvTab === t.id ? "var(--accent)" : "var(--text-muted)", transition: "var(--transition)", borderRadius: 0 }}>{t.label}</button>)
          }
        </div>
      )}

      {/* Grid */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {loading && isEmpty ? <LoadingGrid /> : pageError ? (
          <PageErrorState title={`${title} are unavailable right now`} subtitle={pageError} onRetry={retry} />
        ) : isEmpty ? (
          <PageEmptyState title={query ? `No ${isMovie ? "movies" : "series"} matched that search` : `No ${isMovie ? "movies" : "series"} are available here yet`} subtitle={query ? "Try a different title or spelling." : "Try another tab or refresh this page."} />
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
              {isMovie
                ? filteredMovies.map(m => <MediaCard key={m.id} poster={getMoviePoster(m)} title={m.title} year={m.release_date?.slice(0, 4) ?? ""} rating={m.vote_average} onClick={() => setMovieDetail(m)} />)
                : filteredShows.map(s => <MediaCard key={s.id} poster={getShowPoster(s)} title={s.name} year={s.first_air_date?.slice(0, 4) ?? ""} rating={s.vote_average} onClick={() => setShowDetail(s)} />)
              }
            </div>
            <div ref={bottomRef} style={{ height: 24 }} />
          </>
        )}
      </div>

      {/* Modals */}
      {isMovie && movieDetail && !player && <MovieDetail movie={movieDetail} tf={movieTf} onClose={() => setMovieDetail(null)} onPlay={p => { setMovieDetail(null); setPlayer(p); }} />}
      {isMovie && archiveDetail && !player && <ArchiveDetail movie={archiveDetail} onClose={() => setArchiveDetail(null)} onPlay={p => { setArchiveDetail(null); setPlayer(p); }} />}
      {!isMovie && showDetail && !player && <SeriesDetail show={showDetail} tf={tvTf} onClose={() => setShowDetail(null)} onPlay={p => { setShowDetail(null); setPlayer(p); }} />}
      {player && <VidSrcPlayer title={player.title} subtitle={player.subtitle} poster={player.poster} sources={player.sources} mediaType={isMovie ? "movie" : "tv"} onClose={() => setPlayer(null)} />}
    </div>
  );
}
