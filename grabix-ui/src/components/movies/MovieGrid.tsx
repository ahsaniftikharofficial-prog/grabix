// components/movies/MovieGrid.tsx — grid layout for search & genre results
import { MovieCard, type Movie } from "./MovieCard";

interface MovieGridProps {
  movies: Movie[];
  onSelect: (m: Movie) => void;
}

export function MovieGrid({ movies, onSelect }: MovieGridProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
      gap: 12,
    }}>
      {movies.map(m => (
        <MovieCard key={m.id} movie={m} onClick={() => onSelect(m)} />
      ))}
    </div>
  );
}
