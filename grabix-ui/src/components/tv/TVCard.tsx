// components/tv/TVCard.tsx — single poster card for TV shows
import { TMDB_IMAGE_BASE as IMG_BASE } from "../../lib/tmdb";

export interface Show {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path?: string | null;
  vote_average: number;
  first_air_date: string;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  status?: string;
  tagline?: string;
  external_ids?: { imdb_id?: string };
  seasons?: { season_number: number; episode_count?: number; name?: string }[];
}

const IMG = (path: string | null | undefined) =>
  path ? `${IMG_BASE}${path}` : "";

export function TVCard({ show: s, onClick }: { show: Show; onClick: () => void }) {
  const poster = IMG(s.poster_path);
  return (
    <div
      onClick={onClick}
      style={{
        flexShrink: 0, width: 130, cursor: "pointer", borderRadius: 10,
        overflow: "hidden", background: "var(--bg-surface)",
        border: "1px solid var(--border)", transition: "transform 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.transform = "scale(1.05)";
        (e.currentTarget as HTMLDivElement).style.boxShadow = "var(--shadow-lg)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.transform = "scale(1)";
        (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
      }}
    >
      <div style={{ position: "relative" }}>
        {poster
          ? <img src={poster} alt={s.name} style={{ width: "100%", height: 195, objectFit: "cover" }} />
          : (
            <div style={{
              width: "100%", height: 195, background: "var(--bg-surface2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, color: "var(--text-muted)",
            }}>
              No Image
            </div>
          )
        }
        {s.vote_average > 0 && (
          <div style={{
            position: "absolute", top: 5, right: 5, background: "rgba(0,0,0,0.75)",
            color: "#fdd663", fontSize: 10, padding: "2px 6px", borderRadius: 6, fontWeight: 700,
          }}>
            ★ {s.vote_average.toFixed(1)}
          </div>
        )}
        {s.status === "Returning Series" && (
          <div style={{
            position: "absolute", top: 5, left: 5, background: "var(--text-success)",
            color: "white", fontSize: 9, padding: "2px 5px", borderRadius: 5, fontWeight: 700,
          }}>
            LIVE
          </div>
        )}
      </div>
      <div style={{ padding: "7px 9px 9px" }}>
        <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {s.name}
        </div>
        {s.first_air_date && (
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
            {s.first_air_date.slice(0, 4)}
          </div>
        )}
      </div>
    </div>
  );
}
