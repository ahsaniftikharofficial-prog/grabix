import { useState, useRef, useEffect, useCallback } from "react";
import { TMDB_IMAGE_BASE as IMG_BASE, discoverTmdbMedia } from "../lib/tmdb";
import { fetchMovieBoxDiscover, type MovieBoxItem } from "../lib/streamProviders";
import { getImdbTop250MovieChart, getImdbTop250TvChart } from "../lib/imdbCharts";

const API        = "https://api.imdbapi.dev";
const JIKAN      = "https://api.jikan.moe/v4";

interface SearchResult {
  id: string; primaryTitle: string; startYear: number; endYear?: number;
  type: string; primaryImage?: { url: string };
  rating?: { aggregateRating: number; voteCount: number }; genres?: string[];
}
interface TitleDetail extends SearchResult {
  plot?: string; directors?: { displayName: string }[]; writers?: { displayName: string }[];
  stars?: { displayName: string }[]; runtimeSeconds?: number;
  metacritic?: { score: number }; originCountries?: { name: string }[];
}
interface EpisodeData {
  id: string; title: string; episodeNumber: number; season: string;
  rating?: { aggregateRating: number; voteCount: number }; plot?: string;
}
interface SeasonData { season: string; episodeCount: number; }
interface TmdbMovie { id: number; title: string; poster_path: string|null; release_date: string; vote_average: number; vote_count: number; }
interface TmdbShow  { id: number; name:  string; poster_path: string|null; first_air_date: string; vote_average: number; }
interface AnimeEntry {
  mal_id: number; title: string; score: number; rank: number;
  images: { jpg: { large_image_url: string } }; year: number; episodes: number|null;
}
interface FallbackAnimeEntry {
  id: string; title: string; score: number; rank: number; poster?: string; year?: number;
}
interface CanonicalTitle {
  title: string;
  year?: number;
  kind: "movie" | "tv";
}
type RatedMovieItem = TmdbMovie | MovieBoxItem;
type RatedTvItem = TmdbShow | MovieBoxItem;

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
  { title: "It's a Wonderful Life", year: 1946, kind: "movie" },
  { title: "The Silence of the Lambs", year: 1991, kind: "movie" },
  { title: "Saving Private Ryan", year: 1998, kind: "movie" },
  { title: "City of God", year: 2002, kind: "movie" },
  { title: "Life Is Beautiful", year: 1997, kind: "movie" },
  { title: "The Green Mile", year: 1999, kind: "movie" },
  { title: "Star Wars: Episode IV - A New Hope", year: 1977, kind: "movie" },
  { title: "Terminator 2: Judgment Day", year: 1991, kind: "movie" },
  { title: "Back to the Future", year: 1985, kind: "movie" },
  { title: "Spirited Away", year: 2001, kind: "movie" },
  { title: "The Pianist", year: 2002, kind: "movie" },
  { title: "Psycho", year: 1960, kind: "movie" },
  { title: "Parasite", year: 2019, kind: "movie" },
  { title: "Leon: The Professional", year: 1994, kind: "movie" },
  { title: "The Lion King", year: 1994, kind: "movie" },
  { title: "American History X", year: 1998, kind: "movie" },
  { title: "Gladiator", year: 2000, kind: "movie" },
  { title: "The Departed", year: 2006, kind: "movie" },
  { title: "Whiplash", year: 2014, kind: "movie" },
  { title: "The Prestige", year: 2006, kind: "movie" },
  { title: "The Usual Suspects", year: 1995, kind: "movie" },
  { title: "Casablanca", year: 1942, kind: "movie" },
  { title: "Grave of the Fireflies", year: 1988, kind: "movie" },
  { title: "Rear Window", year: 1954, kind: "movie" },
  { title: "Cinema Paradiso", year: 1988, kind: "movie" },
  { title: "Alien", year: 1979, kind: "movie" },
  { title: "Apocalypse Now", year: 1979, kind: "movie" },
  { title: "Memento", year: 2000, kind: "movie" },
  { title: "Raiders of the Lost Ark", year: 1981, kind: "movie" },
  { title: "The Shining", year: 1980, kind: "movie" },
  { title: "WALL·E", year: 2008, kind: "movie" },
  { title: "Django Unchained", year: 2012, kind: "movie" },
  { title: "Paths of Glory", year: 1957, kind: "movie" },
  { title: "The Dark Knight Rises", year: 2012, kind: "movie" },
  { title: "Princess Mononoke", year: 1997, kind: "movie" },
  { title: "Oldboy", year: 2003, kind: "movie" },
  { title: "Once Upon a Time in the West", year: 1968, kind: "movie" },
  { title: "Avengers: Endgame", year: 2019, kind: "movie" },
  { title: "The Wolf of Wall Street", year: 2013, kind: "movie" },
  { title: "Das Boot", year: 1981, kind: "movie" },
  { title: "Coco", year: 2017, kind: "movie" },
  { title: "American Beauty", year: 1999, kind: "movie" },
  { title: "Braveheart", year: 1995, kind: "movie" },
  { title: "3 Idiots", year: 2009, kind: "movie" },
  { title: "Toy Story", year: 1995, kind: "movie" },
  { title: "Inglourious Basterds", year: 2009, kind: "movie" },
  { title: "Your Name", year: 2016, kind: "movie" },
  { title: "Good Will Hunting", year: 1997, kind: "movie" },
  { title: "Requiem for a Dream", year: 2000, kind: "movie" },
  { title: "2001: A Space Odyssey", year: 1968, kind: "movie" },
  { title: "Toy Story 3", year: 2010, kind: "movie" },
  { title: "Full Metal Jacket", year: 1987, kind: "movie" },
  { title: "Eternal Sunshine of the Spotless Mind", year: 2004, kind: "movie" },
  { title: "A Beautiful Mind", year: 2001, kind: "movie" },
  { title: "Amelie", year: 2001, kind: "movie" },
  { title: "The Sting", year: 1973, kind: "movie" },
  { title: "Lawrence of Arabia", year: 1962, kind: "movie" },
  { title: "Come and See", year: 1985, kind: "movie" },
  { title: "Scarface", year: 1983, kind: "movie" },
  { title: "Reservoir Dogs", year: 1992, kind: "movie" },
  { title: "Heat", year: 1995, kind: "movie" },
  { title: "Up", year: 2009, kind: "movie" },
  { title: "Monty Python and the Holy Grail", year: 1975, kind: "movie" },
  { title: "A Clockwork Orange", year: 1971, kind: "movie" },
  { title: "Die Hard", year: 1988, kind: "movie" },
  { title: "The Truman Show", year: 1998, kind: "movie" },
  { title: "No Country for Old Men", year: 2007, kind: "movie" },
  { title: "Catch Me If You Can", year: 2002, kind: "movie" },
  { title: "The Intouchables", year: 2011, kind: "movie" },
  { title: "Pan's Labyrinth", year: 2006, kind: "movie" },
  { title: "How to Train Your Dragon", year: 2010, kind: "movie" },
  { title: "Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb", year: 1964, kind: "movie" },
  { title: "Sunset Blvd.", year: 1950, kind: "movie" },
  { title: "Witness for the Prosecution", year: 1957, kind: "movie" },
  { title: "Avengers: Infinity War", year: 2018, kind: "movie" },
  { title: "The Grand Budapest Hotel", year: 2014, kind: "movie" },
  { title: "Inside Out", year: 2015, kind: "movie" },
  { title: "Mad Max: Fury Road", year: 2015, kind: "movie" },
  { title: "Gone with the Wind", year: 1939, kind: "movie" },
  { title: "The Bridge on the River Kwai", year: 1957, kind: "movie" },
  { title: "Jojo Rabbit", year: 2019, kind: "movie" },
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
  { title: "Game of Thrones", year: 2011, kind: "tv" },
  { title: "Our Planet", year: 2019, kind: "tv" },
  { title: "Sherlock", year: 2010, kind: "tv" },
  { title: "The Office", year: 2005, kind: "tv" },
  { title: "True Detective", year: 2014, kind: "tv" },
  { title: "Arcane", year: 2021, kind: "tv" },
  { title: "The Twilight Zone", year: 1959, kind: "tv" },
  { title: "Attack on Titan", year: 2013, kind: "tv" },
  { title: "Rick and Morty", year: 2013, kind: "tv" },
  { title: "Succession", year: 2018, kind: "tv" },
  { title: "Fleabag", year: 2016, kind: "tv" },
  { title: "The Boys", year: 2019, kind: "tv" },
  { title: "Ozark", year: 2017, kind: "tv" },
  { title: "Dark", year: 2017, kind: "tv" },
  { title: "Better Call Saul", year: 2015, kind: "tv" },
  { title: "Mindhunter", year: 2017, kind: "tv" },
  { title: "Black Mirror", year: 2011, kind: "tv" },
  { title: "Peaky Blinders", year: 2013, kind: "tv" },
  { title: "Fargo", year: 2014, kind: "tv" },
  { title: "The Crown", year: 2016, kind: "tv" },
  { title: "The Mandalorian", year: 2019, kind: "tv" },
  { title: "Narcos", year: 2015, kind: "tv" },
  { title: "Stranger Things", year: 2016, kind: "tv" },
  { title: "The Bear", year: 2022, kind: "tv" },
  { title: "Seinfeld", year: 1989, kind: "tv" },
  { title: "Mr. Robot", year: 2015, kind: "tv" },
  { title: "House", year: 2004, kind: "tv" },
  { title: "Lost", year: 2004, kind: "tv" },
  { title: "Prison Break", year: 2005, kind: "tv" },
  { title: "Dexter", year: 2006, kind: "tv" },
  { title: "Mad Men", year: 2007, kind: "tv" },
  { title: "Hannibal", year: 2013, kind: "tv" },
  { title: "Silicon Valley", year: 2014, kind: "tv" },
  { title: "Vikings", year: 2013, kind: "tv" },
  { title: "Firefly", year: 2002, kind: "tv" },
  { title: "Arrested Development", year: 2003, kind: "tv" },
  { title: "Parks and Recreation", year: 2009, kind: "tv" },
  { title: "Brooklyn Nine-Nine", year: 2013, kind: "tv" },
  { title: "The Americans", year: 2013, kind: "tv" },
  { title: "Gravity Falls", year: 2012, kind: "tv" },
  { title: "Fullmetal Alchemist: Brotherhood", year: 2009, kind: "tv" },
  { title: "Death Note", year: 2006, kind: "tv" },
  { title: "Hunter x Hunter", year: 2011, kind: "tv" },
  { title: "Demon Slayer: Kimetsu no Yaiba", year: 2019, kind: "tv" },
  { title: "Mob Psycho 100", year: 2016, kind: "tv" },
  { title: "Jujutsu Kaisen", year: 2020, kind: "tv" },
  { title: "Steins;Gate", year: 2011, kind: "tv" },
  { title: "Code Geass: Lelouch of the Rebellion", year: 2006, kind: "tv" },
  { title: "Cowboy Bebop", year: 1998, kind: "tv" },
  { title: "Neon Genesis Evangelion", year: 1995, kind: "tv" },
  { title: "Invincible", year: 2021, kind: "tv" },
  { title: "Squid Game", year: 2021, kind: "tv" },
  { title: "Money Heist", year: 2017, kind: "tv" },
  { title: "The Last of Us", year: 2023, kind: "tv" },
  { title: "Severance", year: 2022, kind: "tv" },
  { title: "The White Lotus", year: 2021, kind: "tv" },
  { title: "House of the Dragon", year: 2022, kind: "tv" },
  { title: "Andor", year: 2022, kind: "tv" },
  { title: "Shogun", year: 2024, kind: "tv" },
  { title: "Ted Lasso", year: 2020, kind: "tv" },
  { title: "Euphoria", year: 2019, kind: "tv" },
  { title: "Yellowstone", year: 2018, kind: "tv" },
  { title: "The Witcher", year: 2019, kind: "tv" },
  { title: "Lupin", year: 2021, kind: "tv" },
  { title: "Elite", year: 2018, kind: "tv" },
  { title: "Twin Peaks", year: 1990, kind: "tv" },
  { title: "Friends", year: 1994, kind: "tv" },
  { title: "Cosmos", year: 1980, kind: "tv" },
  { title: "BoJack Horseman", year: 2014, kind: "tv" },
  { title: "The Simpsons", year: 1989, kind: "tv" },
  { title: "Westworld", year: 2016, kind: "tv" },
  { title: "Vinland Saga", year: 2019, kind: "tv" },
  { title: "One Piece", year: 1999, kind: "tv" },
  { title: "Naruto", year: 2002, kind: "tv" },
  { title: "Dragon Ball Z", year: 1989, kind: "tv" },
  { title: "Battlestar Galactica", year: 2004, kind: "tv" },
  { title: "Homeland", year: 2011, kind: "tv" },
  { title: "Downton Abbey", year: 2010, kind: "tv" },
  { title: "Justified", year: 2010, kind: "tv" },
  { title: "The Walking Dead", year: 2010, kind: "tv" },
  { title: "Hacks", year: 2021, kind: "tv" },
  { title: "Spy x Family", year: 2022, kind: "tv" },
  { title: "My Hero Academia", year: 2016, kind: "tv" },
  { title: "The Penguin", year: 2024, kind: "tv" },
  { title: "Rings of Power", year: 2022, kind: "tv" },
  { title: "Abbott Elementary", year: 2021, kind: "tv" },
  { title: "The Bear", year: 2022, kind: "tv" },
  { title: "Bluey", year: 2018, kind: "tv" },
  { title: "It's Always Sunny in Philadelphia", year: 2005, kind: "tv" },
  { title: "Narcos: Mexico", year: 2018, kind: "tv" },
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

function getRatingColor(r: number|null): string {
  if (!r) return "var(--bg-surface2)";
  if (r >= 9.0) return "#1d4ed8"; if (r >= 8.5) return "#15803d";
  if (r >= 8.0) return "#16a34a"; if (r >= 7.0) return "#ca8a04";
  if (r >= 6.0) return "#c2410c"; if (r >= 5.0) return "#b91c1c";
  return "#6d28d9";
}
const LEGEND = [
  { label:"Absolute Cinema", color:"#1d4ed8" }, { label:"Awesome", color:"#15803d" },
  { label:"Great", color:"#16a34a" }, { label:"Good", color:"#ca8a04" },
  { label:"Regular", color:"#c2410c" }, { label:"Bad", color:"#b91c1c" }, { label:"Garbage", color:"#6d28d9" },
];
function fmt(n: number) {
  if (n >= 1_000_000) return (n/1_000_000).toFixed(1)+"M";
  if (n >= 1_000) return (n/1_000).toFixed(0)+"K";
  return String(n);
}
function runtime(secs?: number) {
  if (!secs) return null;
  const h = Math.floor(secs/3600), m = Math.floor((secs%3600)/60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
const IS_SERIES = (t: string) =>
  ["TV_SERIES","TV_MINI_SERIES","tvSeries","tvMiniSeries","TV_SHOW","tvShow"].includes(t) || t.toLowerCase().includes("series");

type TopTab = "movies"|"tv"|"anime";
const INITIAL_VISIBLE_COUNT = 40;
const VISIBLE_INCREMENT = 40;
const MIN_TOP_ITEMS = 100;

function hasPoster(item: { poster_path?: string | null; poster_proxy?: string; poster?: string }): boolean {
  return Boolean(item.poster_path || item.poster_proxy || item.poster);
}

function mergePosterBackedItems<T extends { id?: string | number; title?: string; name?: string }>(
  primary: T[],
  fallback: T[],
): T[] {
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

const CSS = `
@keyframes rat-fadeUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
@keyframes rat-fadeIn { from{opacity:0} to{opacity:1} }
@keyframes rat-shimmer { 0%{background-position:-600px 0} 100%{background-position:600px 0} }
@keyframes rat-spin { to{transform:rotate(360deg)} }
.rat-card { animation:rat-fadeUp 0.35s ease both; transition:transform 0.18s ease,box-shadow 0.18s ease,border-color 0.18s ease; cursor:pointer; }
.rat-card:hover { transform:translateY(-5px) scale(1.015); box-shadow:var(--shadow-lg); border-color:var(--accent) !important; }
.rat-search-wrap input:focus { border-color:var(--border-focus) !important; box-shadow:0 0 0 3px rgba(138,180,248,0.15) !important; outline:none; }
.rat-tab { transition:color 0.15s,border-color 0.15s; cursor:pointer; border-bottom:2px solid transparent; }
.rat-tab:hover { color:var(--text-primary) !important; }
.rat-tab.active { color:var(--accent) !important; border-bottom-color:var(--accent) !important; }
.rat-skeleton { background:linear-gradient(90deg,var(--bg-surface) 25%,var(--bg-surface2) 50%,var(--bg-surface) 75%); background-size:600px 100%; animation:rat-shimmer 1.4s infinite linear; }
.rat-ep { transition:transform 0.1s,box-shadow 0.1s; cursor:pointer; }
.rat-ep:hover { transform:scale(1.16); box-shadow:0 4px 14px rgba(0,0,0,0.5); }
.rat-sug-row { transition:background 0.1s; cursor:pointer; }
.rat-sug-row:hover { background:var(--bg-hover) !important; }
.rat-detail { animation:rat-fadeIn 0.3s ease; }
.rat-grid { animation:rat-fadeUp 0.25s ease; }
`;

export default function RatingsPage() {
  const [query, setQuery]             = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSug, setShowSug]         = useState(false);
  const [loading, setLoading]         = useState(false);
  const [detail, setDetail]           = useState<TitleDetail|null>(null);
  const [seasons, setSeasons]         = useState<SeasonData[]>([]);
  const [episodes, setEpisodes]       = useState<Record<string,EpisodeData[]>>({});
  const [loadingGrid, setLoadingGrid] = useState(false);
  const [tooltip, setTooltip]         = useState<{ep:EpisodeData;x:number;y:number}|null>(null);
  const [error, setError]             = useState("");
  const [filterType, setFilterType]   = useState("ALL");
  const [browseResults, setBrowseResults] = useState<SearchResult[]>([]);
  const [browsing, setBrowsing]       = useState(false);
  const [activeTab, setActiveTab]     = useState<TopTab>("movies");
  const [topMovies, setTopMovies]     = useState<TmdbMovie[]>([]);
  const [topTv, setTopTv]             = useState<TmdbShow[]>([]);
  const [topAnime, setTopAnime]       = useState<AnimeEntry[]>([]);
  const [fallbackMovies, setFallbackMovies] = useState<MovieBoxItem[]>([]);
  const [fallbackTv, setFallbackTv]         = useState<MovieBoxItem[]>([]);
  const [fallbackAnime, setFallbackAnime]   = useState<FallbackAnimeEntry[]>([]);
  const [movieSourceLabel, setMovieSourceLabel] = useState("IMDb");
  const [tvSourceLabel, setTvSourceLabel]       = useState("IMDb");
  const [topLoading, setTopLoading]   = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>|null>(null);

  const fetchCanonicalTopList = useCallback(async (entries: CanonicalTitle[]): Promise<MovieBoxItem[]> => {
    const settled = await Promise.allSettled(entries.map(async (entry) => {
      const response = await fetch(`${API}/search/titles?query=${encodeURIComponent(entry.title)}&limit=10`);
      const payload = await response.json();
      const titles: SearchResult[] = payload.titles ?? [];
      const picked =
        titles.find((item) =>
          item.primaryTitle?.toLowerCase() === entry.title.toLowerCase() &&
          (!entry.year || item.startYear === entry.year) &&
          (entry.kind === "movie" ? !IS_SERIES(item.type) : IS_SERIES(item.type))
        ) ||
        titles.find((item) => entry.kind === "movie" ? !IS_SERIES(item.type) : IS_SERIES(item.type)) ||
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
  }, []);

  // ── Load top lists: TMDB for movies/TV, Jikan for anime ──────────────────
  const loadTopLists = useCallback(async () => {
    setTopLoading(true);
    setTopMovies([]); setTopTv([]); setTopAnime([]);
    setFallbackMovies([]); setFallbackTv([]); setFallbackAnime([]);
    let canonicalMovies: MovieBoxItem[] = canonicalTitlesToFallback(CANONICAL_TOP_MOVIES);
    let canonicalTv: MovieBoxItem[] = canonicalTitlesToFallback(CANONICAL_TOP_TV);
    // Movies
    setMovieSourceLabel("IMDb Top 100");
    setFallbackMovies(canonicalMovies);
    try {
      const enrichedMovies = await fetchCanonicalTopList(CANONICAL_TOP_MOVIES);
      if (enrichedMovies.length > 0) {
        // Patch poster/rating data into full canonical list (preserves order & all 100 items)
        const posterMap = new Map(enrichedMovies.map(m => [m.title?.toLowerCase().trim(), m]));
        canonicalMovies = canonicalMovies.map(m => {
          const enriched = posterMap.get(m.title?.toLowerCase().trim());
          return enriched ? { ...m, poster: enriched.poster, poster_proxy: enriched.poster_proxy, imdb_rating: enriched.imdb_rating, imdb_rating_count: enriched.imdb_rating_count } : m;
        });
        setMovieSourceLabel("IMDb");
        setFallbackMovies([...canonicalMovies]);
      }
    } catch { /* silent */ }
    try {
      const imdbTopMovies = await getImdbTop250MovieChart();
      if (imdbTopMovies.length > 0) {
        canonicalMovies = imdbTopMovies.map((item) => ({
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
        setMovieSourceLabel("IMDb Top 250");
        setFallbackMovies(canonicalMovies);
      }
    } catch { /* silent */ }
    // TV
    setTvSourceLabel("IMDb Top 100");
    setFallbackTv(canonicalTv);
    try {
      const enrichedTv = await fetchCanonicalTopList(CANONICAL_TOP_TV);
      if (enrichedTv.length > 0) {
        // Patch poster/rating data into full canonical list (preserves order & all 100 items)
        const posterMap = new Map(enrichedTv.map(m => [m.title?.toLowerCase().trim(), m]));
        canonicalTv = canonicalTv.map(m => {
          const enriched = posterMap.get(m.title?.toLowerCase().trim());
          return enriched ? { ...m, poster: enriched.poster, poster_proxy: enriched.poster_proxy, imdb_rating: enriched.imdb_rating, imdb_rating_count: enriched.imdb_rating_count } : m;
        });
        setTvSourceLabel("IMDb");
        setFallbackTv([...canonicalTv]);
      }
    } catch { /* silent */ }
    try {
      const imdbTopTv = await getImdbTop250TvChart();
      if (imdbTopTv.length > 0) {
        canonicalTv = imdbTopTv.map((item) => ({
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
        setTvSourceLabel("IMDb Top 250");
        setFallbackTv(canonicalTv);
      }
    } catch { /* silent */ }
    try {
      const discover = await fetchMovieBoxDiscover();
      const allItems = discover.sections.flatMap((section) => section.items);
      const dedupe = (items: MovieBoxItem[]) =>
        items.filter((item, index, arr) => index === arr.findIndex((candidate) => candidate.id === item.id));
      const sortByRating = (items: MovieBoxItem[]) =>
        dedupe(items)
          .filter((item) => Number(item.imdb_rating || 0) > 0 && hasPoster(item))
          .sort((a, b) => {
            const ratingDiff = Number(b.imdb_rating || 0) - Number(a.imdb_rating || 0);
            if (ratingDiff !== 0) return ratingDiff;
            return Number(b.imdb_rating_count || 0) - Number(a.imdb_rating_count || 0);
          });

      if (canonicalMovies.length === 0) {
        setMovieSourceLabel("MovieBox");
        setFallbackMovies(sortByRating(allItems.filter((item) => item.moviebox_media_type === "movie")).slice(0, 150));
      }
      if (canonicalTv.length === 0) {
        setTvSourceLabel("MovieBox");
        setFallbackTv(sortByRating(allItems.filter((item) => item.moviebox_media_type === "series" && item.media_type !== "anime")).slice(0, 150));
      }
      setFallbackAnime(
        sortByRating(allItems.filter((item) => item.media_type === "anime" || item.is_anime))
          .slice(0, 150)
          .map((item, index) => ({
            id: item.id,
            title: item.title,
            score: Number(item.imdb_rating || 0),
            rank: index + 1,
            poster: item.poster_proxy || item.poster,
            year: item.year,
          }))
      );
    } catch { /* silent */ }
    // Anime — 3 pages from Jikan
    try {
      const collected: AnimeEntry[] = [];
      for (const page of [1, 2, 3]) {
        const response = await fetch(`${JIKAN}/top/anime?limit=25&page=${page}`);
        const payload = await response.json();
        collected.push(...(payload.data ?? []));
        if (page < 3) await new Promise((res) => setTimeout(res, 450));
      }
      setTopAnime(collected.filter((item, index, arr) => index === arr.findIndex((candidate) => candidate.mal_id === item.mal_id)));
    } catch { /* silent */ }
    // TMDB top-rated posters for Movies and TV
    try {
      const moviePages = await Promise.allSettled(
        Array.from({ length: 15 }, (_, index) => discoverTmdbMedia("movie", "top_rated", index + 1))
      );
      const tvPages = await Promise.allSettled(
        Array.from({ length: 15 }, (_, index) => discoverTmdbMedia("tv", "top_rated", index + 1))
      );
      const tmdbMovies = moviePages.flatMap((result) => result.status === "fulfilled" ? (result.value?.results ?? []) : []);
      const tmdbTv = tvPages.flatMap((result) => result.status === "fulfilled" ? (result.value?.results ?? []) : []);
      const posterBackedTmdbMovies = tmdbMovies.filter((item) => Boolean(item?.poster_path));
      const posterBackedTmdbTv = tmdbTv.filter((item) => Boolean(item?.poster_path));
      if (posterBackedTmdbMovies.length > 0) setTopMovies(posterBackedTmdbMovies as TmdbMovie[]);
      if (posterBackedTmdbTv.length > 0) setTopTv(posterBackedTmdbTv as TmdbShow[]);
    } catch { /* silent */ }
    setTopLoading(false);
  }, [fetchCanonicalTopList]);

  useEffect(() => { loadTopLists(); }, [loadTopLists]);

  // Suggestions
  useEffect(() => {
    if (detail) { setSuggestions([]); setShowSug(false); return; }
    if (query.trim().length < 2) { setSuggestions([]); setShowSug(false); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/search/titles?query=${encodeURIComponent(query)}&limit=8`);
        const j = await r.json();
        const list: SearchResult[] = j.titles ?? [];
        setSuggestions(list); setShowSug(list.length > 0);
      } catch { /* silent */ }
    }, 350);
  }, [query, detail]);

  const selectTitle = async (id: string, title?: string) => {
    setShowSug(false); setSuggestions([]);
    if (title) setQuery(title);
    setLoading(true);
    setDetail(null); setSeasons([]); setEpisodes({}); setError(""); setBrowseResults([]);
    try {
      const r = await fetch(`${API}/titles/${id}`);
      if (!r.ok) throw new Error("Not found");
      const d: TitleDetail = await r.json();
      setDetail(d);
      if (IS_SERIES(d.type)) {
        const sr = await fetch(`${API}/titles/${id}/seasons`);
        const sj = await sr.json();
        const seas: SeasonData[] = sj.seasons ?? [];
        setSeasons(seas); setLoadingGrid(true);
        const epMap: Record<string,EpisodeData[]> = {};
        await Promise.all(seas.map(async (s) => {
          let all: EpisodeData[] = [], token = "";
          do {
            const url = `${API}/titles/${id}/episodes?season=${s.season}&pageSize=50${token?`&pageToken=${token}`:""}`;
            const ej = await (await fetch(url)).json();
            all = all.concat(ej.episodes ?? []); token = ej.nextPageToken ?? "";
          } while (token);
          epMap[s.season] = all.sort((a,b) => a.episodeNumber - b.episodeNumber);
        }));
        setEpisodes(epMap); setLoadingGrid(false);
      }
    } catch(e: unknown) { setError(e instanceof Error ? e.message : "Failed to load."); }
    setLoading(false);
  };

  const openByTitle = async (title: string) => {
    setLoading(true); setDetail(null); setError(""); setBrowseResults([]);
    try {
      const r = await fetch(`${API}/search/titles?query=${encodeURIComponent(title)}&limit=5`);
      const j = await r.json();
      const first: SearchResult|undefined = j.titles?.[0];
      if (first) { await selectTitle(first.id, first.primaryTitle); }
      else { setError("Not found on IMDb."); setLoading(false); }
    } catch { setError("Search failed."); setLoading(false); }
  };

  const doSearch = async () => {
    if (!query.trim()) return;
    setShowSug(false); setBrowsing(true); setDetail(null); setError("");
    try {
      const r = await fetch(`${API}/search/titles?query=${encodeURIComponent(query.trim())}&limit=20`);
      const j = await r.json();
      let results: SearchResult[] = j.titles ?? [];
      if (filterType !== "ALL") results = results.filter(t => t.type === filterType);
      setBrowseResults(results);
    } catch { setError("Search failed."); }
    setBrowsing(false);
  };

  const goBack = () => {
    setDetail(null); setSeasons([]); setEpisodes({});
    setSuggestions([]); setShowSug(false); setBrowseResults([]);
  };

  const maxEps = seasons.length ? Math.max(...seasons.map(s => (episodes[s.season]??[]).length)) : 0;
  const seasonAvg = seasons.map(s => {
    const eps = (episodes[s.season]??[]).filter(e => e.rating?.aggregateRating);
    if (!eps.length) return null;
    return +(eps.reduce((a,e) => a+(e.rating?.aggregateRating??0), 0)/eps.length).toFixed(1);
  });
  const CELL = 60, ROW_LABEL = 48;
  const isEmptyState = !detail && !loading && browseResults.length === 0 && !browsing;
  const visibleMovies: RatedMovieItem[] = (() => {
    const posterBackedTmdb = topMovies.filter((item) => hasPoster(item));
    if (posterBackedTmdb.length >= MIN_TOP_ITEMS) return posterBackedTmdb;
    // Show ALL fallback items (emoji placeholder shown for those without poster)
    return mergePosterBackedItems<RatedMovieItem>(posterBackedTmdb, fallbackMovies);
  })();
  const visibleTv: RatedTvItem[] = (() => {
    const posterBackedTmdb = topTv.filter((item) => hasPoster(item));
    if (posterBackedTmdb.length >= MIN_TOP_ITEMS) return posterBackedTmdb;
    // Show ALL fallback items (emoji placeholder shown for those without poster)
    return mergePosterBackedItems<RatedTvItem>(posterBackedTmdb, fallbackTv);
  })();
  const visibleAnime = topAnime.length > 0 ? topAnime : fallbackAnime;
  const [movieVisibleCount, setMovieVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [tvVisibleCount, setTvVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const ratingsScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMovieVisibleCount(INITIAL_VISIBLE_COUNT);
    setTvVisibleCount(INITIAL_VISIBLE_COUNT);
  }, [activeTab]);

  useEffect(() => {
    const node = ratingsScrollRef.current;
    if (!node) return;
    const onScroll = () => {
      if (node.scrollTop + node.clientHeight < node.scrollHeight - 240) return;
      if (activeTab === "movies") {
        setMovieVisibleCount((current) => Math.min(current + VISIBLE_INCREMENT, visibleMovies.length));
      } else if (activeTab === "tv") {
        setTvVisibleCount((current) => Math.min(current + VISIBLE_INCREMENT, visibleTv.length));
      }
    };
    node.addEventListener("scroll", onScroll);
    return () => node.removeEventListener("scroll", onScroll);
  }, [activeTab, visibleMovies.length, visibleTv.length]);

  const RatingBadge = ({ r, source="TMDB" }: { r: number; source?: string }) => (
    <div style={{ position:"absolute", bottom:6, right:6, background:getRatingColor(r), color:"#fff", fontSize:10, fontWeight:700, borderRadius:4, padding:"2px 6px", display:"flex", flexDirection:"column", alignItems:"center", lineHeight:1.2 }}>
      <span>⭐ {r.toFixed(1)}</span>
      <span style={{ fontSize:8, opacity:0.8, fontWeight:400 }}>{source}</span>
    </div>
  );

  const SkeletonGrid = () => (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(144px,1fr))", gap:12 }}>
      {Array.from({length:12},(_,i) => (
        <div key={i} style={{ borderRadius:"var(--radius-md)", overflow:"hidden", background:"var(--bg-surface)" }}>
          <div className="rat-skeleton" style={{ width:"100%", aspectRatio:"2/3" }} />
          <div style={{ padding:"8px 10px" }}>
            <div className="rat-skeleton" style={{ height:13, borderRadius:4, marginBottom:5 }} />
            <div className="rat-skeleton" style={{ height:10, borderRadius:4, width:"55%" }} />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", background:"var(--bg-app)", color:"var(--text-primary)", fontFamily:"var(--font)" }}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={{ padding:"12px 20px", borderBottom:"1px solid var(--border)", flexShrink:0, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <div style={{ fontSize:15, fontWeight:700, whiteSpace:"nowrap" }}>📊 Ratings</div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ background:"var(--bg-input)", border:"1px solid var(--border)", borderRadius:"var(--radius-sm)", padding:"7px 10px", color:"var(--text-primary)", fontSize:13, cursor:"pointer", fontFamily:"var(--font)" }}>
          <option value="ALL">All Types</option>
          <option value="MOVIE">Movies</option>
          <option value="TV_SERIES">TV Series</option>
          <option value="TV_MINI_SERIES">Mini-Series</option>
          <option value="TV_MOVIE">TV Movie</option>
        </select>
        <div className="rat-search-wrap" style={{ position:"relative", flex:1, minWidth:200, maxWidth:500 }}>
          <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", fontSize:13, color:"var(--text-muted)", pointerEvents:"none" }}>🔍</span>
          <input value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key==="Enter" && doSearch()}
            onFocus={() => !detail && suggestions.length>0 && setShowSug(true)}
            onBlur={() => setTimeout(() => setShowSug(false), 180)}
            placeholder="Search movies, series, anime…"
            style={{ width:"100%", background:"var(--bg-input)", border:"1px solid var(--border)", borderRadius:"var(--radius-sm)", padding:"7px 12px 7px 30px", color:"var(--text-primary)", fontSize:14, fontFamily:"var(--font)", boxSizing:"border-box" }} />
          {!detail && showSug && suggestions.length>0 && (
            <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", zIndex:300, boxShadow:"var(--shadow-lg)", overflow:"hidden", animation:"rat-fadeIn 0.12s ease" }}>
              {suggestions.map((s,i) => (
                <div key={s.id} className="rat-sug-row"
                  onMouseDown={() => selectTitle(s.id, s.primaryTitle)}
                  style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", background:"var(--bg-surface)", borderBottom:i<suggestions.length-1?"1px solid var(--border)":"none" }}>
                  {s.primaryImage?.url
                    ? <img src={s.primaryImage.url} alt="" style={{ width:26, height:38, objectFit:"cover", borderRadius:4, flexShrink:0 }} />
                    : <div style={{ width:26, height:38, background:"var(--bg-surface2)", borderRadius:4, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11 }}>🎬</div>}
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{s.primaryTitle}</div>
                    <div style={{ fontSize:11, color:"var(--text-muted)", marginTop:1 }}>
                      {s.startYear}{s.endYear?`–${s.endYear}`:""} · {s.type.replace(/_/g," ")}
                      {s.rating?<span style={{ color:"var(--text-accent)" }}> · ⭐ {s.rating.aggregateRating}</span>:""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={doSearch} disabled={browsing}
          style={{ background:"var(--accent)", border:"none", borderRadius:"var(--radius-sm)", padding:"7px 20px", color:"var(--text-on-accent)", cursor:"pointer", fontWeight:600, fontFamily:"var(--font)", fontSize:13, opacity:browsing?0.7:1 }}>
          {browsing?"Searching…":"Search"}
        </button>
        {detail && (
          <button onClick={goBack}
            style={{ background:"none", border:"1px solid var(--border)", borderRadius:"var(--radius-sm)", padding:"7px 14px", color:"var(--text-secondary)", cursor:"pointer", fontSize:12, fontFamily:"var(--font)" }}>
            ← Back
          </button>
        )}
      </div>

      {error && <div style={{ padding:"6px 20px", color:"var(--text-danger)", fontSize:12, flexShrink:0 }}>⚠ {error}</div>}

      {loading && (
        <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12 }}>
          <div style={{ width:34, height:34, border:"3px solid var(--border)", borderTopColor:"var(--accent)", borderRadius:"50%", animation:"rat-spin 0.75s linear infinite" }} />
          <div style={{ fontSize:13, color:"var(--text-muted)" }}>Loading…</div>
        </div>
      )}

      {/* Browse results */}
      {!detail && !loading && browseResults.length>0 && (
        <div className="rat-grid" style={{ flex:1, overflow:"auto", padding:"18px 20px" }}>
          <div style={{ fontSize:12, color:"var(--text-muted)", marginBottom:14 }}>
            {browseResults.length} results for "<span style={{ color:"var(--text-accent)" }}>{query}</span>"
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(144px,1fr))", gap:12 }}>
            {browseResults.map((r,i) => (
              <div key={r.id} className="rat-card"
                style={{ animationDelay:`${i*0.025}s`, background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", overflow:"hidden" }}
                onClick={() => selectTitle(r.id, r.primaryTitle)}>
                {r.primaryImage?.url
                  ? <img src={r.primaryImage.url} alt={r.primaryTitle} style={{ width:"100%", aspectRatio:"2/3", objectFit:"cover", display:"block" }} />
                  : <div style={{ width:"100%", aspectRatio:"2/3", background:"var(--bg-surface2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:32 }}>🎬</div>}
                <div style={{ padding:"8px 10px" }}>
                  <div style={{ fontSize:12, fontWeight:700, marginBottom:2, lineHeight:1.3 }}>{r.primaryTitle}</div>
                  <div style={{ fontSize:11, color:"var(--text-muted)" }}>{r.startYear}{r.endYear?`–${r.endYear}`:""}</div>
                  {r.rating && <div style={{ fontSize:11, color:"var(--text-accent)", marginTop:3, fontWeight:600 }}>⭐ {r.rating.aggregateRating} <span style={{ color:"var(--text-muted)", fontWeight:400 }}>({fmt(r.rating.voteCount)})</span></div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail view */}
      {detail && !loading && (
        <div className="rat-detail" style={{ flex:1, overflow:"hidden" }}>

          {/* ── MOVIE / ANIME-MOVIE: cinematic full-width layout ── */}
          {!IS_SERIES(detail.type) && (
            <div style={{ display:"flex", height:"100%", overflow:"auto" }}>
              {/* Poster column */}
              <div style={{ width:300, flexShrink:0, padding:"28px 24px", display:"flex", flexDirection:"column", gap:14, borderRight:"1px solid var(--border)", background:"var(--bg-surface)" }}>
                {detail.primaryImage?.url ? (
                  <div style={{ position:"relative", borderRadius:"var(--radius-md)", overflow:"hidden", boxShadow:"0 8px 32px rgba(0,0,0,0.5)" }}>
                    <img src={detail.primaryImage.url} alt={detail.primaryTitle}
                      style={{ width:"100%", display:"block", objectFit:"cover" }} />
                    {detail.rating && (
                      <div style={{ position:"absolute", top:10, right:10, background:getRatingColor(detail.rating.aggregateRating), color:"#fff", borderRadius:8, padding:"5px 10px", fontSize:16, fontWeight:900, boxShadow:"0 2px 8px rgba(0,0,0,0.4)" }}>
                        ⭐ {detail.rating.aggregateRating}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ width:"100%", aspectRatio:"2/3", background:"var(--bg-surface2)", borderRadius:"var(--radius-md)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:48 }}>🎬</div>
                )}
                {detail.rating && (
                  <div style={{ background:"var(--accent-subtle)", border:"1px solid var(--accent-light)", borderRadius:"var(--radius-sm)", padding:"10px 14px", display:"flex", alignItems:"center", gap:10 }}>
                    <span style={{ fontSize:28, fontWeight:900, color:"var(--text-accent)" }}>{detail.rating.aggregateRating}</span>
                    <div>
                      <div style={{ fontSize:11, color:"var(--text-secondary)" }}>/ 10 on IMDb</div>
                      <div style={{ fontSize:11, color:"var(--text-muted)" }}>{fmt(detail.rating.voteCount)} votes</div>
                    </div>
                  </div>
                )}
                {detail.metacritic?.score != null && (
                  <div style={{ background:detail.metacritic.score>=60?"var(--accent-subtle)":"rgba(185,28,28,0.1)", border:`1px solid ${detail.metacritic.score>=60?"var(--success)":"var(--danger)"}`, color:detail.metacritic.score>=60?"var(--text-success)":"var(--text-danger)", borderRadius:"var(--radius-sm)", padding:"8px 12px", fontWeight:700, fontSize:13, textAlign:"center" }}>
                    🎯 Metacritic: {detail.metacritic.score}/100
                  </div>
                )}
              </div>

              {/* Info column */}
              <div style={{ flex:1, padding:"36px 40px", overflow:"auto", display:"flex", flexDirection:"column", gap:20 }}>
                {/* Title & meta */}
                <div>
                  <div style={{ fontSize:32, fontWeight:900, lineHeight:1.2, marginBottom:8, color:"var(--text-primary)" }}>{detail.primaryTitle}</div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                    {detail.startYear && <span style={{ background:"var(--bg-surface2)", borderRadius:4, padding:"3px 8px", fontSize:12, color:"var(--text-muted)", fontWeight:600 }}>{detail.startYear}{detail.endYear?`–${detail.endYear}`:""}</span>}
                    {runtime(detail.runtimeSeconds) && <span style={{ background:"var(--bg-surface2)", borderRadius:4, padding:"3px 8px", fontSize:12, color:"var(--text-muted)", fontWeight:600 }}>⏱ {runtime(detail.runtimeSeconds)}</span>}
                    {detail.originCountries?.[0] && <span style={{ background:"var(--bg-surface2)", borderRadius:4, padding:"3px 8px", fontSize:12, color:"var(--text-muted)", fontWeight:600 }}>🌍 {detail.originCountries[0].name}</span>}
                    <span style={{ background:"var(--bg-surface2)", borderRadius:4, padding:"3px 8px", fontSize:12, color:"var(--text-muted)", fontWeight:600 }}>{detail.type.replace(/_/g," ")}</span>
                  </div>
                </div>

                {/* Genres */}
                {detail.genres && detail.genres.length>0 && (
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    {detail.genres.map(g => <span key={g} style={{ background:"var(--accent-subtle)", border:"1px solid var(--accent-light)", borderRadius:20, padding:"4px 12px", fontSize:12, color:"var(--text-accent)", fontWeight:500 }}>{g}</span>)}
                  </div>
                )}

                {/* Plot */}
                {detail.plot && (
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Plot</div>
                    <p style={{ fontSize:14, color:"var(--text-secondary)", lineHeight:1.8, margin:0 }}>{detail.plot}</p>
                  </div>
                )}

                {/* Cast & crew */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:16 }}>
                  {detail.directors?.length ? (
                    <div style={{ background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", padding:"12px 16px" }}>
                      <div style={{ fontSize:11, fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Director</div>
                      {detail.directors.map(d => <div key={d.displayName} style={{ fontSize:13, color:"var(--text-primary)", fontWeight:500 }}>{d.displayName}</div>)}
                    </div>
                  ) : null}
                  {detail.writers?.length ? (
                    <div style={{ background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", padding:"12px 16px" }}>
                      <div style={{ fontSize:11, fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Writers</div>
                      {detail.writers.slice(0,3).map(w => <div key={w.displayName} style={{ fontSize:13, color:"var(--text-primary)", fontWeight:500 }}>{w.displayName}</div>)}
                    </div>
                  ) : null}
                  {detail.stars?.length ? (
                    <div style={{ background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", padding:"12px 16px", gridColumn:"span 2" }}>
                      <div style={{ fontSize:11, fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Stars</div>
                      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                        {detail.stars.slice(0,6).map(s => (
                          <span key={s.displayName} style={{ background:"var(--bg-surface2)", borderRadius:20, padding:"4px 12px", fontSize:12, color:"var(--text-secondary)" }}>{s.displayName}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* IMDb link */}
                <div>
                  <button onClick={() => window.open(`https://www.imdb.com/title/${detail.id}`,"_blank")}
                    style={{ background:"var(--accent)", border:"none", borderRadius:"var(--radius-sm)", padding:"9px 20px", color:"var(--text-on-accent)", cursor:"pointer", fontWeight:600, fontSize:13, fontFamily:"var(--font)" }}>
                    Open on IMDb ↗
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── TV SERIES / ANIME SERIES: sidebar + episode grid ── */}
          {IS_SERIES(detail.type) && (
            <div style={{ display:"flex", height:"100%", overflow:"hidden" }}>
              <div style={{ width:250, flexShrink:0, borderRight:"1px solid var(--border)", overflow:"auto", padding:"18px 16px", display:"flex", flexDirection:"column", gap:12 }}>
                {detail.primaryImage?.url && (
                  <div style={{ position:"relative" }}>
                    <img src={detail.primaryImage.url} alt={detail.primaryTitle}
                      style={{ width:"100%", borderRadius:"var(--radius-md)", objectFit:"cover", display:"block", boxShadow:"var(--shadow-md)" }} />
                    {detail.rating && (
                      <div style={{ position:"absolute", top:8, right:8, background:getRatingColor(detail.rating.aggregateRating), color:"#fff", borderRadius:6, padding:"3px 8px", fontSize:14, fontWeight:800 }}>
                        ⭐ {detail.rating.aggregateRating}
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <div style={{ fontSize:16, fontWeight:700, lineHeight:1.3, marginBottom:4 }}>{detail.primaryTitle}</div>
                  <div style={{ fontSize:11, color:"var(--text-muted)", lineHeight:1.9 }}>
                    {detail.startYear}{detail.endYear?`–${detail.endYear}`:""}
                    {runtime(detail.runtimeSeconds)?` · ${runtime(detail.runtimeSeconds)}`:""}
                    {detail.originCountries?.[0]?` · ${detail.originCountries[0].name}`:""}
                    {" · "}{detail.type.replace(/_/g," ")}
                  </div>
                </div>
                {detail.rating && (
                  <div style={{ background:"var(--accent-subtle)", border:"1px solid var(--accent-light)", borderRadius:"var(--radius-sm)", padding:"10px 14px", display:"flex", alignItems:"center", gap:10 }}>
                    <span style={{ fontSize:24, fontWeight:800, color:"var(--text-accent)" }}>{detail.rating.aggregateRating}</span>
                    <span style={{ fontSize:11, color:"var(--text-secondary)", lineHeight:1.6 }}>/ 10<br />{fmt(detail.rating.voteCount)} votes</span>
                  </div>
                )}
                {detail.metacritic?.score != null && (
                  <div style={{ background:detail.metacritic.score>=60?"var(--accent-subtle)":"rgba(185,28,28,0.1)", border:`1px solid ${detail.metacritic.score>=60?"var(--success)":"var(--danger)"}`, color:detail.metacritic.score>=60?"var(--text-success)":"var(--text-danger)", borderRadius:"var(--radius-sm)", padding:"6px 12px", fontWeight:700, fontSize:13 }}>
                    🎯 Metacritic: {detail.metacritic.score}
                  </div>
                )}
                {detail.genres && detail.genres.length>0 && (
                  <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                    {detail.genres.map(g => <span key={g} style={{ background:"var(--bg-surface2)", border:"1px solid var(--border)", borderRadius:20, padding:"2px 8px", fontSize:11, color:"var(--text-secondary)" }}>{g}</span>)}
                  </div>
                )}
                {detail.plot && <p style={{ fontSize:12, color:"var(--text-secondary)", lineHeight:1.7, margin:0 }}>{detail.plot}</p>}
                <div style={{ fontSize:12, color:"var(--text-muted)", lineHeight:2 }}>
                  {detail.directors?.length?<div><span style={{ color:"var(--text-primary)", fontWeight:600 }}>Director</span><br />{detail.directors.map(d=>d.displayName).join(", ")}</div>:null}
                  {detail.writers?.length?<div style={{ marginTop:6 }}><span style={{ color:"var(--text-primary)", fontWeight:600 }}>Writers</span><br />{detail.writers.slice(0,3).map(w=>w.displayName).join(", ")}</div>:null}
                  {detail.stars?.length?<div style={{ marginTop:6 }}><span style={{ color:"var(--text-primary)", fontWeight:600 }}>Stars</span><br />{detail.stars.slice(0,5).map(s=>s.displayName).join(", ")}</div>:null}
                </div>
              </div>
              <div style={{ flex:1, overflow:"auto", padding:"18px 24px" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:10 }}>
                  <div style={{ fontSize:14, fontWeight:700 }}>Episode Ratings</div>
                  <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                    {LEGEND.map(l => (
                      <div key={l.label} style={{ display:"flex", alignItems:"center", gap:4, fontSize:11, color:"var(--text-muted)" }}>
                        <div style={{ width:8, height:8, borderRadius:2, background:l.color, flexShrink:0 }} />{l.label}
                      </div>
                    ))}
                  </div>
                </div>
                {loadingGrid && <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>{Array.from({length:20},(_,i)=><div key={i} className="rat-skeleton" style={{ width:54, height:40, borderRadius:8 }} />)}</div>}
                {seasons.length>0 && !loadingGrid && (
                  <div className="rat-grid" style={{ overflowX:"auto" }}>
                    <div style={{ display:"inline-block", minWidth:"max-content" }}>
                      <div style={{ display:"flex", marginBottom:6, paddingLeft:ROW_LABEL }}>
                        {seasons.map(s => <div key={s.season} style={{ width:CELL, textAlign:"center", fontSize:11, fontWeight:700, color:"var(--text-accent)", flexShrink:0 }}>S{s.season}</div>)}
                      </div>
                      {Array.from({length:maxEps},(_,epIdx) => (
                        <div key={epIdx} style={{ display:"flex", alignItems:"center", marginBottom:3 }}>
                          <div style={{ width:ROW_LABEL, fontSize:11, color:"var(--text-muted)", fontWeight:600, flexShrink:0 }}>E{epIdx+1}</div>
                          {seasons.map(s => {
                            const ep = (episodes[s.season]??[])[epIdx];
                            const rating = ep?.rating?.aggregateRating??null;
                            return (
                              <div key={s.season} style={{ width:CELL, flexShrink:0, display:"flex", justifyContent:"center" }}>
                                {ep?(
                                  <div className="rat-ep"
                                    style={{ width:CELL-6, height:40, borderRadius:8, background:getRatingColor(rating), color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700 }}
                                    onMouseEnter={e => setTooltip({ep, x:e.clientX, y:e.clientY})}
                                    onMouseMove={e => setTooltip(t => t?{...t,x:e.clientX,y:e.clientY}:null)}
                                    onMouseLeave={() => setTooltip(null)}
                                    onClick={() => window.open(`https://www.imdb.com/title/${ep.id}`,"_blank")}
                                  >{rating??"—"}</div>
                                ):<div style={{ width:CELL-6, height:40 }} />}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                      <div style={{ display:"flex", alignItems:"center", marginTop:12, paddingTop:12, borderTop:"1px solid var(--border)" }}>
                        <div style={{ width:ROW_LABEL, fontSize:10, color:"var(--text-muted)", fontWeight:700, flexShrink:0 }}>AVG.</div>
                        {seasonAvg.map((avg,i) => (
                          <div key={i} style={{ width:CELL, flexShrink:0, display:"flex", justifyContent:"center" }}>
                            <div style={{ width:CELL-6, height:40, borderRadius:8, background:getRatingColor(avg), color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800 }}>{avg??"—"}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      )}

      {/* Top Lists */}
      {isEmptyState && (
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ display:"flex", borderBottom:"1px solid var(--border)", flexShrink:0, paddingLeft:20, alignItems:"center" }}>
            {([ {key:"movies",label:"🎬 Top Rated Movies"}, {key:"tv",label:"📺 Top Rated Series"}, {key:"anime",label:"✨ Top Rated Animes"} ] as {key:TopTab;label:string}[]).map(tab => (
              <button key={tab.key}
                className={`rat-tab${activeTab===tab.key?" active":""}`}
                onClick={() => setActiveTab(tab.key)}
                style={{ background:"none", border:"none", borderBottom:"2px solid transparent", padding:"11px 18px", color:"var(--text-muted)", fontFamily:"var(--font)", fontSize:13, fontWeight:600, cursor:"pointer" }}>
                {tab.label}
              </button>
            ))}
            {topLoading && (
              <div style={{ marginLeft:"auto", marginRight:20, display:"flex", alignItems:"center", gap:6, fontSize:11, color:"var(--text-muted)" }}>
                <div style={{ width:12, height:12, border:"2px solid var(--border)", borderTopColor:"var(--accent)", borderRadius:"50%", animation:"rat-spin 0.75s linear infinite" }} />
                Loading…
              </div>
            )}
          </div>
          <div ref={ratingsScrollRef} style={{ flex:1, overflow:"auto", padding:"18px 20px" }}>

            {/* Movies */}
            {activeTab==="movies" && (visibleMovies.length===0 && topLoading ? <SkeletonGrid /> : (
              <>
                <div style={{ fontSize:12, color:"var(--text-muted)", marginBottom:12 }}>{visibleMovies.length} Top Rated Movies · {movieSourceLabel}</div>
                <div className="rat-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(144px,1fr))", gap:12 }}>
                  {visibleMovies.slice(0, movieVisibleCount).map((m,i) => (
                    <div key={"id" in m ? m.id : i} className="rat-card"
                      style={{ animationDelay:`${(i%20)*0.03}s`, background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", overflow:"hidden" }}
                      onClick={() => openByTitle(m.title)}>
                      <div style={{ position:"relative" }}>
                        {"poster_path" in m && m.poster_path
                          ? <img src={`${IMG_BASE}${m.poster_path}`} alt={m.title} style={{ width:"100%", aspectRatio:"2/3", objectFit:"cover", display:"block" }} />
                          : "poster_proxy" in m && (m.poster_proxy || m.poster)
                            ? <img src={m.poster_proxy || m.poster || ""} alt={m.title} style={{ width:"100%", aspectRatio:"2/3", objectFit:"cover", display:"block" }} />
                          : <div style={{ width:"100%", aspectRatio:"2/3", background:"var(--bg-surface2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:32 }}>🎬</div>}
                        <div style={{ position:"absolute", top:6, left:6, background:"rgba(0,0,0,0.75)", color:"#fff", fontSize:10, fontWeight:700, borderRadius:4, padding:"2px 6px" }}>#{i+1}</div>
                        {"vote_average" in m
                          ? m.vote_average > 0 && <RatingBadge r={m.vote_average} />
                          : Number(m.imdb_rating || 0) > 0 && <RatingBadge r={Number(m.imdb_rating || 0)} source="IMDb" />}
                      </div>
                      <div style={{ padding:"8px 10px" }}>
                        <div style={{ fontSize:12, fontWeight:700, marginBottom:2, lineHeight:1.3 }}>{m.title}</div>
                        <div style={{ fontSize:11, color:"var(--text-muted)" }}>{"release_date" in m ? m.release_date?.slice(0,4) : m.year ?? ""}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ))}

            {/* TV */}
            {activeTab==="tv" && (visibleTv.length===0 && topLoading ? <SkeletonGrid /> : (
              <>
                <div style={{ fontSize:12, color:"var(--text-muted)", marginBottom:12 }}>{visibleTv.length} Top Rated TV Series · {tvSourceLabel}</div>
                <div className="rat-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(144px,1fr))", gap:12 }}>
                  {visibleTv.slice(0, tvVisibleCount).map((s,i) => (
                    <div key={"id" in s ? s.id : i} className="rat-card"
                      style={{ animationDelay:`${(i%20)*0.03}s`, background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", overflow:"hidden" }}
                      onClick={() => openByTitle("name" in s ? s.name : s.title)}>
                      <div style={{ position:"relative" }}>
                        {"poster_path" in s && s.poster_path
                          ? <img src={`${IMG_BASE}${s.poster_path}`} alt={s.name} style={{ width:"100%", aspectRatio:"2/3", objectFit:"cover", display:"block" }} />
                          : "poster_proxy" in s && (s.poster_proxy || s.poster)
                            ? <img src={s.poster_proxy || s.poster || ""} alt={s.title} style={{ width:"100%", aspectRatio:"2/3", objectFit:"cover", display:"block" }} />
                          : <div style={{ width:"100%", aspectRatio:"2/3", background:"var(--bg-surface2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:32 }}>📺</div>}
                        <div style={{ position:"absolute", top:6, left:6, background:"rgba(0,0,0,0.75)", color:"#fff", fontSize:10, fontWeight:700, borderRadius:4, padding:"2px 6px" }}>#{i+1}</div>
                        {"vote_average" in s
                          ? s.vote_average > 0 && <RatingBadge r={s.vote_average} />
                          : Number(s.imdb_rating || 0) > 0 && <RatingBadge r={Number(s.imdb_rating || 0)} source="IMDb" />}
                      </div>
                      <div style={{ padding:"8px 10px" }}>
                        <div style={{ fontSize:12, fontWeight:700, marginBottom:2, lineHeight:1.3 }}>{"name" in s ? s.name : s.title}</div>
                        <div style={{ fontSize:11, color:"var(--text-muted)" }}>{"first_air_date" in s ? s.first_air_date?.slice(0,4) : s.year ?? ""}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ))}

            {/* Anime */}
            {activeTab==="anime" && (visibleAnime.length===0 && topLoading ? <SkeletonGrid /> : (
              <>
                <div style={{ fontSize:12, color:"var(--text-muted)", marginBottom:12 }}>{visibleAnime.length} Top Ranked Anime · {topAnime.length > 0 ? "MyAnimeList" : "MovieBox"}</div>
                <div className="rat-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(144px,1fr))", gap:12 }}>
                  {visibleAnime.map((a,i) => (
                    <div key={"mal_id" in a ? a.mal_id : a.id} className="rat-card"
                      style={{ animationDelay:`${(i%25)*0.02}s`, background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", overflow:"hidden" }}
                      onClick={() => openByTitle(a.title)}>
                      <div style={{ position:"relative" }}>
                        {"images" in a
                          ? <img src={a.images.jpg.large_image_url} alt={a.title} style={{ width:"100%", aspectRatio:"2/3", objectFit:"cover", display:"block" }} />
                          : a.poster
                            ? <img src={a.poster} alt={a.title} style={{ width:"100%", aspectRatio:"2/3", objectFit:"cover", display:"block" }} />
                            : <div style={{ width:"100%", aspectRatio:"2/3", background:"var(--bg-surface2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:32 }}>âœ¨</div>}
                        <div style={{ position:"absolute", top:6, left:6, background:"rgba(0,0,0,0.75)", color:"#fff", fontSize:10, fontWeight:700, borderRadius:4, padding:"2px 6px" }}>#{i+1}</div>
                        {a.score>0 && <RatingBadge r={a.score} />}
                      </div>
                      <div style={{ padding:"8px 10px" }}>
                        <div style={{ fontSize:12, fontWeight:700, marginBottom:2, lineHeight:1.3 }}>{a.title}</div>
                        <div style={{ fontSize:11, color:"var(--text-muted)" }}>{a.year||""}{"episodes" in a && a.episodes ? ` · ${a.episodes} ep` : ""}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ))}

          </div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div style={{ position:"fixed", top:tooltip.y-100, left:tooltip.x+14, background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", padding:"9px 13px", fontSize:12, color:"var(--text-primary)", pointerEvents:"none", zIndex:999, maxWidth:270, boxShadow:"var(--shadow-lg)", animation:"rat-fadeIn 0.1s ease" }}>
          <div style={{ fontWeight:700, marginBottom:2 }}>S{tooltip.ep.season} E{tooltip.ep.episodeNumber} — {tooltip.ep.title}</div>
          <div style={{ color:"var(--text-accent)", fontWeight:600 }}>⭐ {tooltip.ep.rating?.aggregateRating??"No rating"}{tooltip.ep.rating?.voteCount?` · ${fmt(tooltip.ep.rating.voteCount)} votes`:""}</div>
          {tooltip.ep.plot && <div style={{ marginTop:4, color:"var(--text-muted)", fontSize:11, lineHeight:1.55 }}>{tooltip.ep.plot.slice(0,120)}{tooltip.ep.plot.length>120?"…":""}</div>}
          <div style={{ marginTop:4, fontSize:10, color:"var(--text-accent)", opacity:0.65 }}>Click to open on IMDb ↗</div>
        </div>
      )}
    </div>
  );
}
