// components/tv/TVGrid.tsx — grid layout for TV search & genre results
import { TVCard, type Show } from "./TVCard";

interface TVGridProps {
  shows: Show[];
  onSelect: (s: Show) => void;
}

export function TVGrid({ shows, onSelect }: TVGridProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
      gap: 12,
    }}>
      {shows.map(s => (
        <TVCard key={s.id} show={s} onClick={() => onSelect(s)} />
      ))}
    </div>
  );
}
