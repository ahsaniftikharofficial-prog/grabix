// components/tv/TVCard.tsx — poster card for TV shows
// Phase 2: wrapped with HoverCard + TVBadgeOverlay (New/New Season/New Ep/Airing) + ProgressBar

import { TMDB_IMAGE_BASE as IMG_BASE } from "../../lib/tmdb";
import { HoverCard } from "../shared/HoverCard";
import { TVBadgeOverlay } from "../shared/BadgeOverlay";
import { ProgressBar } from "../shared/ProgressBar";

export interface Show {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path?: string | null;
  vote_average: number;
  first_air_date: string;
  last_air_date?: string;
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

interface TVCardProps {
  show: Show;
  onClick: () => void;
  /** 0–100 watch progress — shows ProgressBar when > 0 */
  watchProgress?: number;
  /** Called when Play is clicked in the HoverCard — defaults to onClick */
  onPlay?: () => void;
}

export function TVCard({ show: s, onClick, watchProgress = 0, onPlay }: TVCardProps) {
  const poster = IMG(s.poster_path);
  const year = s.first_air_date ? s.first_air_date.slice(0, 4) : undefined;

  return (
    <HoverCard
      title={s.name}
      overview={s.overview}
      rating={s.vote_average}
      year={year}
      poster={poster}
      onPlay={onPlay ?? onClick}
      onInfo={onClick}
    >
      <div
        onClick={onClick}
        style={{
          flexShrink: 0,
          width: 130,
          cursor: "pointer",
          borderRadius: 10,
          overflow: "hidden",
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          transition: "transform 0.15s, box-shadow 0.15s",
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
          {poster ? (
            <img
              src={poster}
              alt={s.name}
              style={{ width: "100%", height: 195, objectFit: "cover", display: "block" }}
            />
          ) : (
            <div
              style={{
                width: "100%", height: 195,
                background: "var(--bg-surface2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, color: "var(--text-muted)",
              }}
            >
              No Image
            </div>
          )}

          {s.vote_average > 0 && (
            <div
              style={{
                position: "absolute", top: 5, right: 5,
                background: "rgba(0,0,0,0.75)", color: "#fdd663",
                fontSize: 10, padding: "2px 6px", borderRadius: 6, fontWeight: 700,
                pointerEvents: "none",
              }}
            >
              ★ {s.vote_average.toFixed(1)}
            </div>
          )}

          {/* Smart TV badges: New / New Season / New Ep / Airing + S3·28eps */}
          <TVBadgeOverlay
            firstAirDate={s.first_air_date}
            lastAirDate={s.last_air_date}
            status={s.status}
            numberOfSeasons={s.number_of_seasons}
            numberOfEpisodes={s.number_of_episodes}
          />

          <ProgressBar progress={watchProgress} />
        </div>

        <div style={{ padding: "7px 9px 9px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {s.name}
          </div>
          {year && (
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
              {year}
            </div>
          )}
        </div>
      </div>
    </HoverCard>
  );
}
