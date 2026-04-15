import { discoverTmdbMedia } from "./tmdb";
import { getImdbTop250MovieChart, getImdbTop250TvChart } from "./imdbCharts";
import { fetchMovieBoxDiscover, type MovieBoxItem } from "./streamProviders";

const API = "https://api.imdbapi.dev";
const MIN_TOP_ITEMS = 100;
const TMDB_PAGE_COUNT = 15;

interface SearchResult {
  id: string;
  primaryTitle: string;
  startYear: number;
  type: string;
  primaryImage?: { url: string };
  rating?: { aggregateRating: number; voteCount: number };
}

interface CanonicalTitle {
  title: string;
  year?: number;
  kind: "movie" | "tv";
}

export interface TmdbMovieListItem {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  vote_average: number;
}

export interface TmdbTvListItem {
  id: number;
  name: string;
  poster_path: string | null;
  first_air_date: string;
  vote_average: number;
}

export interface TopRatedListResult<TTmdb> {
  items: Array<TTmdb | MovieBoxItem>;
  sourceLabel: string;
}

const CANONICAL_TOP_MOVIES: CanonicalTitle[] = [
  { title: "The Shawshank Redemption", year: 1994, kind: "movie" },
  { title: "The Godfather", year: 1972, kind: "movie" },
  { title: "The Dark Knight", year: 2008, kind: "movie" },
  { title: "The Godfather Part II", year: 1974, kind: "movie" },
  { title: "12 Angry Men", year: 1957, kind: "movie" },
  { title: "Schindler's List", year: 1993, kind: "movie" },
  { title: "The Lord of the Rings: The Return of the King", year: 2003, kind: "movie" },
  { title: "Pulp Fiction", year: 1994, kind: "movie" },
  { title: "The Lord of the Rings: The Fellowship of the Ring", year: 2001, kind: "movie" },
  { title: "The Good, the Bad and the Ugly", year: 1966, kind: "movie" },
  { title: "Forrest Gump", year: 1994, kind: "movie" },
  { title: "Fight Club", year: 1999, kind: "movie" },
  { title: "The Lord of the Rings: The Two Towers", year: 2002, kind: "movie" },
  { title: "Inception", year: 2010, kind: "movie" },
  { title: "Star Wars: Episode V - The Empire Strikes Back", year: 1980, kind: "movie" },
  { title: "The Matrix", year: 1999, kind: "movie" },
  { title: "Goodfellas", year: 1990, kind: "movie" },
  { title: "One Flew Over the Cuckoo's Nest", year: 1975, kind: "movie" },
  { title: "Se7en", year: 1995, kind: "movie" },
  { title: "Interstellar", year: 2014, kind: "movie" },
];

const CANONICAL_TOP_TV: CanonicalTitle[] = [
  { title: "Breaking Bad", year: 2008, kind: "tv" },
  { title: "Planet Earth II", year: 2016, kind: "tv" },
  { title: "Planet Earth", year: 2006, kind: "tv" },
  { title: "Band of Brothers", year: 2001, kind: "tv" },
  { title: "Chernobyl", year: 2019, kind: "tv" },
  { title: "The Wire", year: 2002, kind: "tv" },
  { title: "Avatar: The Last Airbender", year: 2005, kind: "tv" },
  { title: "Blue Planet II", year: 2017, kind: "tv" },
  { title: "The Sopranos", year: 1999, kind: "tv" },
  { title: "Cosmos: A Spacetime Odyssey", year: 2014, kind: "tv" },
  { title: "Cosmos", year: 1980, kind: "tv" },
  { title: "Game of Thrones", year: 2011, kind: "tv" },
  { title: "Our Planet", year: 2019, kind: "tv" },
  { title: "Sherlock", year: 2010, kind: "tv" },
  { title: "The Office", year: 2005, kind: "tv" },
  { title: "Friends", year: 1994, kind: "tv" },
  { title: "True Detective", year: 2014, kind: "tv" },
  { title: "Arcane", year: 2021, kind: "tv" },
  { title: "The Twilight Zone", year: 1959, kind: "tv" },
  { title: "Attack on Titan", year: 2013, kind: "tv" },
];

function canonicalTitlesToFallback(entries: CanonicalTitle[]): MovieBoxItem[] {
  return entries.map((entry, index) => ({
    id: `canonical-${entry.kind}-${index}-${entry.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    title: entry.title,
    year: entry.year,
    media_type: entry.kind === "movie" ? "movie" : "series",
    moviebox_media_type: entry.kind === "movie" ? "movie" : "series",
  }));
}

function hasPoster(item: { poster_path?: string | null; poster_proxy?: string; poster?: string }): boolean {
  return Boolean(item.poster_path || item.poster_proxy || item.poster);
}

function mergePosterBackedItems<T extends { id?: string | number; title?: string; name?: string }>(primary: T[], fallback: T[]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  const append = (items: T[]) => {
    for (const item of items) {
      const rawKey = item.id ?? item.title ?? item.name;
      const key = String(rawKey ?? "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  };
  append(primary);
  append(fallback);
  return merged;
}

function isSeries(type: string): boolean {
  return ["TV_SERIES", "TV_MINI_SERIES", "tvSeries", "tvMiniSeries", "TV_SHOW", "tvShow"].includes(type) || type.toLowerCase().includes("series");
}

async function fetchCanonicalTopList(entries: CanonicalTitle[]): Promise<MovieBoxItem[]> {
  const settled = await Promise.allSettled(entries.map(async (entry) => {
    const response = await fetch(`${API}/search/titles?query=${encodeURIComponent(entry.title)}&limit=10`);
    const payload = await response.json();
    const titles: SearchResult[] = payload.titles ?? [];
    const picked =
      titles.find((item) =>
        item.primaryTitle?.toLowerCase() === entry.title.toLowerCase() &&
        (!entry.year || item.startYear === entry.year) &&
        (entry.kind === "movie" ? !isSeries(item.type) : isSeries(item.type))
      ) ||
      titles.find((item) => entry.kind === "movie" ? !isSeries(item.type) : isSeries(item.type)) ||
      titles[0];
    if (!picked) return null;
    return {
      id: picked.id,
      title: picked.primaryTitle,
      year: picked.startYear,
      poster: picked.primaryImage?.url,
      poster_proxy: picked.primaryImage?.url,
      media_type: entry.kind === "movie" ? "movie" : "series",
      moviebox_media_type: entry.kind === "movie" ? "movie" : "series",
      imdb_rating: picked.rating?.aggregateRating,
      imdb_rating_count: picked.rating?.voteCount,
    } as MovieBoxItem;
  }));

  return settled
    .filter((item): item is PromiseFulfilledResult<MovieBoxItem | null> => item.status === "fulfilled")
    .map((item) => item.value)
    .filter((item): item is MovieBoxItem => Boolean(item));
}

function dedupeMovieBoxItems(items: MovieBoxItem[]): MovieBoxItem[] {
  return items.filter((item, index, all) => index === all.findIndex((candidate) => candidate.id === item.id));
}

function sortMovieBoxByRating(items: MovieBoxItem[]): MovieBoxItem[] {
  return dedupeMovieBoxItems(items)
    .filter((item) => Number(item.imdb_rating || 0) > 0 && hasPoster(item))
    .sort((a, b) => {
      const ratingDiff = Number(b.imdb_rating || 0) - Number(a.imdb_rating || 0);
      if (ratingDiff !== 0) return ratingDiff;
      return Number(b.imdb_rating_count || 0) - Number(a.imdb_rating_count || 0);
    });
}

async function fetchPosterBackedTmdbMovies(): Promise<TmdbMovieListItem[]> {
  const pages = await Promise.allSettled(
    Array.from({ length: TMDB_PAGE_COUNT }, (_, index) => discoverTmdbMedia("movie", "top_rated", index + 1))
  );
  return pages
    .flatMap((result) => result.status === "fulfilled" ? (result.value?.results ?? []) : [])
    .filter((item) => Boolean(item?.poster_path)) as TmdbMovieListItem[];
}

async function fetchPosterBackedTmdbTv(): Promise<TmdbTvListItem[]> {
  const pages = await Promise.allSettled(
    Array.from({ length: TMDB_PAGE_COUNT }, (_, index) => discoverTmdbMedia("tv", "top_rated", index + 1))
  );
  return pages
    .flatMap((result) => result.status === "fulfilled" ? (result.value?.results ?? []) : [])
    .filter((item) => Boolean(item?.poster_path)) as TmdbTvListItem[];
}

export async function fetchSharedTopRatedMovies(): Promise<TopRatedListResult<TmdbMovieListItem>> {
  let sourceLabel = "IMDb Top 100";
  let fallbackMovies = canonicalTitlesToFallback(CANONICAL_TOP_MOVIES);

  try {
    const enrichedMovies = await fetchCanonicalTopList(CANONICAL_TOP_MOVIES);
    if (enrichedMovies.length > 0) {
      const posterMap = new Map(enrichedMovies.map((item) => [item.title?.toLowerCase().trim(), item]));
      fallbackMovies = fallbackMovies.map((item) => {
        const enriched = posterMap.get(item.title?.toLowerCase().trim());
        return enriched ? { ...item, poster: enriched.poster, poster_proxy: enriched.poster_proxy, imdb_rating: enriched.imdb_rating, imdb_rating_count: enriched.imdb_rating_count } : item;
      });
      sourceLabel = "IMDb";
    }
  } catch {
  }

  try {
    const imdbTopMovies = await getImdbTop250MovieChart();
    if (imdbTopMovies.length > 0) {
      fallbackMovies = imdbTopMovies.map((item) => ({
        id: item.id,
        title: item.primaryTitle,
        year: item.startYear,
        poster: item.primaryImage?.url,
        poster_proxy: item.primaryImage?.url,
        media_type: "movie",
        moviebox_media_type: "movie",
        imdb_rating: item.rating?.aggregateRating,
        imdb_rating_count: item.rating?.voteCount,
      }));
      sourceLabel = "IMDb Top 250";
    }
  } catch {
  }

  try {
    const tmdbMovies = await fetchPosterBackedTmdbMovies();
    if (tmdbMovies.length >= MIN_TOP_ITEMS) {
      return { items: tmdbMovies, sourceLabel };
    }
    // Only merge fallback items that actually have a poster — prevents "No Poster" cards
    const posterBackedFallback = fallbackMovies.filter((item) => hasPoster(item));
    return {
      items: mergePosterBackedItems<Array<TmdbMovieListItem | MovieBoxItem>[number]>(tmdbMovies, posterBackedFallback),
      sourceLabel,
    };
  } catch {
  }

  try {
    const discover = await fetchMovieBoxDiscover();
    const movieBoxMovies = sortMovieBoxByRating(discover.sections.flatMap((section) => section.items).filter((item) => item.moviebox_media_type === "movie")).slice(0, 150);
    if (fallbackMovies.length === 0) {
      return { items: movieBoxMovies, sourceLabel: "MovieBox" };
    }
  } catch {
  }

  return { items: fallbackMovies, sourceLabel };
}

export async function fetchSharedTopRatedTv(): Promise<TopRatedListResult<TmdbTvListItem>> {
  let sourceLabel = "IMDb Top 100";
  let fallbackTv = canonicalTitlesToFallback(CANONICAL_TOP_TV);

  try {
    const enrichedTv = await fetchCanonicalTopList(CANONICAL_TOP_TV);
    if (enrichedTv.length > 0) {
      const posterMap = new Map(enrichedTv.map((item) => [item.title?.toLowerCase().trim(), item]));
      fallbackTv = fallbackTv.map((item) => {
        const enriched = posterMap.get(item.title?.toLowerCase().trim());
        return enriched ? { ...item, poster: enriched.poster, poster_proxy: enriched.poster_proxy, imdb_rating: enriched.imdb_rating, imdb_rating_count: enriched.imdb_rating_count } : item;
      });
      sourceLabel = "IMDb";
    }
  } catch {
  }

  try {
    const imdbTopTv = await getImdbTop250TvChart();
    if (imdbTopTv.length > 0) {
      fallbackTv = imdbTopTv.map((item) => ({
        id: item.id,
        title: item.primaryTitle,
        year: item.startYear,
        poster: item.primaryImage?.url,
        poster_proxy: item.primaryImage?.url,
        media_type: "series",
        moviebox_media_type: "series",
        imdb_rating: item.rating?.aggregateRating,
        imdb_rating_count: item.rating?.voteCount,
      }));
      sourceLabel = "IMDb Top 250";
    }
  } catch {
  }

  try {
    const tmdbTv = await fetchPosterBackedTmdbTv();
    if (tmdbTv.length >= MIN_TOP_ITEMS) {
      return { items: tmdbTv, sourceLabel };
    }
    // Only merge fallback items that actually have a poster — prevents "No Poster" cards
    const posterBackedFallback = fallbackTv.filter((item) => hasPoster(item));
    return {
      items: mergePosterBackedItems<Array<TmdbTvListItem | MovieBoxItem>[number]>(tmdbTv, posterBackedFallback),
      sourceLabel,
    };
  } catch {
  }

  try {
    const discover = await fetchMovieBoxDiscover();
    const movieBoxTv = sortMovieBoxByRating(
      discover.sections.flatMap((section) => section.items).filter((item) => item.moviebox_media_type === "series" && item.media_type !== "anime")
    ).slice(0, 150);
    if (fallbackTv.length === 0) {
      return { items: movieBoxTv, sourceLabel: "MovieBox" };
    }
  } catch {
  }

  return { items: fallbackTv, sourceLabel };
}
