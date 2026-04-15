import { BACKEND_API } from "./api";
import { getCachedJson } from "./cache";

export interface ImdbChartItem {
  id: string;
  primaryTitle: string;
  startYear?: number;
  primaryImage?: { url: string };
  rating?: { aggregateRating: number; voteCount: number };
  genres?: string[];
}

interface CanonicalTitle {
  title: string;
  year?: number;
  kind: "movie" | "tv";
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

async function fetchImdbChart(path: string): Promise<ImdbChartItem[]> {
  try {
    const chart = path.split("/").pop() || "";
    const data = await getCachedJson<{ items?: ImdbChartItem[] }>({
      key: `metadata:imdb:chart:${chart}`,
      url: `${BACKEND_API}/metadata/imdb/chart?chart=${encodeURIComponent(chart)}`,
      ttlMs: 300_000,
      scope: "session",
      mapError: async () => "IMDb metadata unavailable",
    });
    return (data.items ?? []) as ImdbChartItem[];
  } catch {
    return [];
  }
}

async function searchCanonicalTitle(_entry: CanonicalTitle): Promise<ImdbChartItem | null> {
  return null;
}

export function imdbIdToNumericId(imdbId: string): number {
  const digits = imdbId.replace(/\D/g, "");
  return digits ? parseInt(digits, 10) : Math.abs(imdbId.split("").reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)) || 1;
}

export async function getCanonicalTopMovieChart(): Promise<ImdbChartItem[]> {
  const settled = await Promise.allSettled(CANONICAL_TOP_MOVIES.map(searchCanonicalTitle));
  return settled
    .filter((item): item is PromiseFulfilledResult<ImdbChartItem | null> => item.status === "fulfilled")
    .map((item) => item.value)
    .filter((item): item is ImdbChartItem => Boolean(item));
}

export async function getCanonicalTopTvChart(): Promise<ImdbChartItem[]> {
  const settled = await Promise.allSettled(CANONICAL_TOP_TV.map(searchCanonicalTitle));
  return settled
    .filter((item): item is PromiseFulfilledResult<ImdbChartItem | null> => item.status === "fulfilled")
    .map((item) => item.value)
    .filter((item): item is ImdbChartItem => Boolean(item));
}

export async function getImdbTop250MovieChart(): Promise<ImdbChartItem[]> {
  return fetchImdbChart("/chart/top250movies");
}

export async function getImdbTop250TvChart(): Promise<ImdbChartItem[]> {
  return fetchImdbChart("/chart/top250tvshows");
}

export async function getImdbMovieChart(
  category: "trending" | "popular" | "top_rated"
): Promise<ImdbChartItem[]> {
  switch (category) {
    case "top_rated":
      return getCanonicalTopMovieChart();
    case "popular":
      return fetchImdbChart("/chart/mostpopularmovies");
    case "trending":
      return fetchImdbChart("/chart/boxoffice");
  }
}

export async function getImdbTvChart(
  category: "trending" | "popular" | "top_rated" | "on_the_air"
): Promise<ImdbChartItem[]> {
  switch (category) {
    case "top_rated":
      return getCanonicalTopTvChart();
    case "popular":
      return fetchImdbChart("/chart/mostpopulartv");
    case "trending":
    case "on_the_air":
      return fetchImdbChart("/chart/mostpopulartv");
  }
}
