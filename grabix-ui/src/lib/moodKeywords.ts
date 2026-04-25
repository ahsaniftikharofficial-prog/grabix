// lib/moodKeywords.ts — maps mood labels to TMDB genre IDs
// Genre IDs are stable TMDB identifiers (same for movies & TV unless noted).

export interface MoodConfig {
  label: string;
  emoji: string;
  description: string;
  /** TMDB genre IDs — first one is used as primary for discovery */
  genreIds: number[];
  /** Optional: filter by original_language code (ISO 639-1) */
  language?: string;
}

// Movie genre IDs
// 28=Action, 12=Adventure, 16=Animation, 35=Comedy, 80=Crime,
// 99=Documentary, 18=Drama, 10751=Family, 14=Fantasy, 36=History,
// 27=Horror, 10402=Music, 9648=Mystery, 10749=Romance, 878=Sci-Fi,
// 10770=TV Movie, 53=Thriller, 10752=War, 37=Western

// TV genre IDs
// 10759=Action&Adventure, 16=Animation, 35=Comedy, 80=Crime,
// 99=Documentary, 18=Drama, 10751=Family, 10762=Kids,
// 9648=Mystery, 10763=News, 10764=Reality, 10765=Sci-Fi&Fantasy,
// 10766=Soap, 10767=Talk, 10768=War&Politics, 37=Western

export const MOVIE_MOODS: MoodConfig[] = [
  {
    label: "Feel Good",
    emoji: "😄",
    description: "Light-hearted comedies & romances",
    genreIds: [35, 10749, 10751],
  },
  {
    label: "Dark & Twisted",
    emoji: "🖤",
    description: "Thrillers, horror & psychological tension",
    genreIds: [53, 27, 9648],
  },
  {
    label: "Mind-Bending",
    emoji: "🌀",
    description: "Sci-fi, mysteries & reality-warping plots",
    genreIds: [878, 9648, 14],
  },
  {
    label: "Action-Packed",
    emoji: "💥",
    description: "High-octane action & adventure",
    genreIds: [28, 12],
  },
  {
    label: "Epic Drama",
    emoji: "🎭",
    description: "Sweeping historical & character dramas",
    genreIds: [18, 36, 10752],
  },
  {
    label: "Animated",
    emoji: "🎨",
    description: "Animation for all ages",
    genreIds: [16],
  },
  {
    label: "Crime & Heist",
    emoji: "🔍",
    description: "Crime, detective & heist films",
    genreIds: [80, 53],
  },
  {
    label: "Sci-Fi & Space",
    emoji: "🚀",
    description: "Futuristic worlds & space exploration",
    genreIds: [878, 14],
  },
];

export const TV_MOODS: MoodConfig[] = [
  {
    label: "Feel Good",
    emoji: "😄",
    description: "Light comedies & family favourites",
    genreIds: [35, 10751],
  },
  {
    label: "Dark & Twisted",
    emoji: "🖤",
    description: "Crime, thrillers & psychological drama",
    genreIds: [80, 9648, 18],
  },
  {
    label: "Mind-Bending",
    emoji: "🌀",
    description: "Sci-fi, fantasy & mystery series",
    genreIds: [10765, 9648],
  },
  {
    label: "Action-Packed",
    emoji: "💥",
    description: "Action, adventure & superhero series",
    genreIds: [10759],
  },
  {
    label: "Epic Drama",
    emoji: "🎭",
    description: "Prestige dramas & war epics",
    genreIds: [18, 10768],
  },
  {
    label: "Animated",
    emoji: "🎨",
    description: "Animation & anime-adjacent series",
    genreIds: [16],
  },
  {
    label: "Crime & Thriller",
    emoji: "🔍",
    description: "Crime procedurals & detective shows",
    genreIds: [80, 9648],
  },
  {
    label: "Reality & Talk",
    emoji: "🎤",
    description: "Reality competition & talk shows",
    genreIds: [10764, 10767],
  },
];
