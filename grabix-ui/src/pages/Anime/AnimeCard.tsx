// anime/AnimeCard.tsx — card display component and loading skeleton

import { IconHeart, IconStar } from "../../components/Icons";
import CachedImage from "../../components/CachedImage";
import { useFavorites } from "../../context/FavoritesContext";
import type { AnimeCardItem, Tab } from "./animeTypes";

export function AnimeCard({
  anime,
  activeTab,
  featured,
  rank,
  onClick,
}: {
  anime: AnimeCardItem;
  activeTab: Tab;
  featured?: boolean;
  rank?: number;
  onClick: () => void;
}) {
  const { isFav, toggle } = useFavorites();
  const favoriteId = `anime-${anime.mal_id ?? `${anime.provider}-${anime.id}`}`;
  const favorite = isFav(favoriteId);
  const rawType = String((anime.raw as { type?: string } | undefined)?.type || "").toLowerCase();
  const isMovie = activeTab === "movie" || rawType === "movie";
  const countLabel = isMovie
    ? anime.episodes_count && anime.episodes_count > 1
      ? `${anime.episodes_count} parts`
      : "Movie"
    : anime.episodes_count
      ? `${anime.episodes_count} eps`
      : anime.status || "-";

  return (
    <div
      className="card"
      style={{ overflow: "hidden", cursor: "pointer", transition: "transform 0.15s", minHeight: featured ? 360 : undefined }}
      onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-3px)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
    >
      <div style={{ position: "relative" }}>
        <CachedImage
          src={anime.image || ""}
          fallbackSrc="https://via.placeholder.com/150x210?text=No+Image"
          alt={anime.title}
          referrerPolicy="no-referrer"
          style={{ width: "100%", height: featured ? 265 : 210, objectFit: "cover" }}
        />
        {featured && rank ? (
          <div style={{ position: "absolute", bottom: 8, left: 8, background: "rgba(0,0,0,0.78)", color: "white", fontSize: 12, padding: "4px 10px", borderRadius: 999, fontWeight: 700 }}>
            #{rank}
          </div>
        ) : null}
        {anime.rating ? (
          <div style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.75)", color: "#fdd663", fontSize: 11, padding: "2px 7px", borderRadius: 6, display: "flex", alignItems: "center", gap: 3, fontWeight: 600 }}>
            <IconStar size={10} color="#fdd663" /> {anime.rating.toFixed(1)}
          </div>
        ) : null}
        <button
          className="btn-icon"
          style={{ position: "absolute", top: 6, left: 6, width: 28, height: 28, borderRadius: 999, background: "rgba(0,0,0,0.62)", border: "1px solid rgba(255,255,255,0.12)" }}
          onClick={(event) => {
            event.stopPropagation();
            toggle({ id: favoriteId, title: anime.title, poster: anime.image || "", type: "anime", malId: anime.mal_id });
          }}
        >
          <IconHeart size={14} color={favorite ? "var(--text-danger)" : "white"} filled={favorite} />
        </button>
      </div>
      <div style={{ padding: featured ? "12px 12px 14px" : "8px 10px" }}>
        <div style={{ fontSize: featured ? 14 : 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: featured ? "normal" : "nowrap", lineHeight: 1.35 }}>
          {anime.title}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{countLabel}</div>
      </div>
    </div>
  );
}

export function LoadingGrid({ count = 16 }: { count?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="card" style={{ overflow: "hidden" }}>
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
