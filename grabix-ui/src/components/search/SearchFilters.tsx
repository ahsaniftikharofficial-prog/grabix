// components/search/SearchFilters.tsx
// Compact filter row: original language, decade, min rating.
// Fits inside the existing genre-filter panel (shown when a genre is active).
export interface FilterState {
  language: string;   // ISO 639-1 code, "" = any
  year: number;       // exact year, 0 = any
  minRating: number;  // 0 = any
  sortBy: string;
}

interface Props {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  sortOptions?: { id: string; label: string }[];
}

const LANGUAGES = [
  { code: "", label: "Any Language" },
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "ko", label: "Korean" },
  { code: "ja", label: "Japanese" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "zh", label: "Chinese" },
  { code: "pt", label: "Portuguese" },
  { code: "tr", label: "Turkish" },
  { code: "it", label: "Italian" },
  { code: "ar", label: "Arabic" },
  { code: "ru", label: "Russian" },
];

const DECADES = [
  { id: 0, label: "Any Year" },
  { id: 2020, label: "2020s" },
  { id: 2010, label: "2010s" },
  { id: 2000, label: "2000s" },
  { id: 1990, label: "1990s" },
  { id: 1980, label: "1980s" },
  { id: 1970, label: "1970s" },
  { id: 1960, label: "1960s" },
];

const RATINGS = [
  { id: 0, label: "Any Rating" },
  { id: 9, label: "9+ ⭐" },
  { id: 8, label: "8+ ⭐" },
  { id: 7, label: "7+ ⭐" },
  { id: 6, label: "6+ ⭐" },
];

const DEFAULT_SORT = [
  { id: "popularity.desc", label: "Most Popular" },
  { id: "vote_average.desc", label: "Highest Rated" },
  { id: "primary_release_date.desc", label: "Newest First" },
  { id: "primary_release_date.asc", label: "Oldest First" },
];

export function SearchFilters({ filters, onChange, sortOptions = DEFAULT_SORT }: Props) {
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: "10px 20px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)",
        flexWrap: "wrap",
        flexShrink: 0,
        alignItems: "center",
      }}
    >
      {/* Sort */}
      <select
        className="input-base"
        style={{ fontSize: 12, minWidth: 150 }}
        value={filters.sortBy}
        onChange={(e) => set({ sortBy: e.target.value })}
      >
        {sortOptions.map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>

      {/* Decade */}
      <select
        className="input-base"
        style={{ fontSize: 12, minWidth: 100 }}
        value={filters.year}
        onChange={(e) => set({ year: Number(e.target.value) })}
      >
        {DECADES.map((d) => (
          <option key={d.id} value={d.id}>{d.label}</option>
        ))}
      </select>

      {/* Language */}
      <select
        className="input-base"
        style={{ fontSize: 12, minWidth: 140 }}
        value={filters.language}
        onChange={(e) => set({ language: e.target.value })}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>

      {/* Min rating */}
      <select
        className="input-base"
        style={{ fontSize: 12, minWidth: 110 }}
        value={filters.minRating}
        onChange={(e) => set({ minRating: Number(e.target.value) })}
      >
        {RATINGS.map((r) => (
          <option key={r.id} value={r.id}>{r.label}</option>
        ))}
      </select>

      {/* Reset */}
      <button
        className="btn btn-ghost"
        style={{ fontSize: 12 }}
        onClick={() =>
          onChange({ sortBy: "popularity.desc", year: 0, language: "", minRating: 0 })
        }
      >
        Reset
      </button>
    </div>
  );
}

export const DEFAULT_FILTERS: FilterState = {
  language: "",
  year: 0,
  minRating: 0,
  sortBy: "popularity.desc",
};
