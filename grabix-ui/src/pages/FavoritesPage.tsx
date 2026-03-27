import { useState } from "react";
import { IconPlay, IconX } from "../components/Icons";
import { IconHeart } from "../components/Icons";
import VidSrcPlayer from "../components/VidSrcPlayer";
import { FavItem, useFavorites } from "../context/FavoritesContext";
import { fetchMovieBoxSources, getAnimeSources, getMovieSources, getTvSources, type StreamSource } from "../lib/streamProviders";

export default function FavoritesPage() {
  const { favorites, remove } = useFavorites();
  const [filter, setFilter] = useState<"all" | "movie" | "anime" | "manga" | "series">("all");
  const [player, setPlayer] = useState<{ title: string; poster?: string; sources: StreamSource[] } | null>(null);

  const filtered = filter === "all" ? favorites : favorites.filter(favorite => favorite.type === filter);

  const playItem = async (item: FavItem) => {
    let sources: StreamSource[] = [];

    if (item.source === "moviebox" && item.movieBoxSubjectId && item.movieBoxMediaType) {
      try {
        sources = await fetchMovieBoxSources({
          subjectId: item.movieBoxSubjectId,
          title: item.title,
          mediaType: item.movieBoxMediaType,
          year: item.year,
          season: 1,
          episode: 1,
        });
      } catch {
        sources = [];
      }
    } else if (item.type === "movie" && item.tmdbId) {
      sources = getMovieSources({ tmdbId: item.tmdbId, imdbId: item.imdbId });
    } else if (item.type === "anime" && item.tmdbId) {
      sources = getAnimeSources(item.tmdbId);
    } else if (item.type === "series" && item.tmdbId) {
      sources = getTvSources({ tmdbId: item.tmdbId, imdbId: item.imdbId });
    }

    if (sources.length === 0) {
      alert("Stream not available for this item.");
      return;
    }

    setPlayer({
      title: item.title,
      poster: item.poster || undefined,
      sources,
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <IconHeart size={16} color="var(--text-danger)" filled /> Favorites
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>{favorites.length} saved item{favorites.length !== 1 ? "s" : ""}</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
          {(["all", "movie", "anime", "manga", "series"] as const).map(value => (
            <button key={value} className={`quality-chip${filter === value ? " active" : ""}`} onClick={() => setFilter(value)}>
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">
            <IconHeart size={40} color="var(--text-muted)" />
            <p>No favorites yet</p>
            <span>Click the heart button on any movie, anime, manga, or TV series to save it here</span>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
            {filtered.map(item => (
              <FavCard key={item.id} item={item} onPlay={playItem} onRemove={remove} />
            ))}
          </div>
        )}
      </div>

      {player && <VidSrcPlayer title={player.title} poster={player.poster} sources={player.sources} onClose={() => setPlayer(null)} />}
    </div>
  );
}

function FavCard({ item, onPlay, onRemove }: { item: FavItem; onPlay: (item: FavItem) => void | Promise<void>; onRemove: (id: string) => void }) {
  const canPlay = item.source === "moviebox"
    ? !!item.movieBoxSubjectId
    : (item.type === "movie" || item.type === "anime" || item.type === "series") && !!item.tmdbId;
  const typeBadge: Record<FavItem["type"], string> = {
    movie: "var(--accent)",
    anime: "var(--text-success)",
    manga: "var(--text-warning)",
    series: "#5b8cff",
  };

  return (
    <div className="card" style={{ overflow: "hidden", position: "relative" }}>
      <div style={{ position: "relative" }}>
        {item.poster ? (
          <img src={item.poster} alt={item.title} style={{ width: "100%", height: 210, objectFit: "cover" }} onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/150x210?text=No+Image"; }} />
        ) : (
          <div style={{ width: "100%", height: 210, background: "var(--bg-surface2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IconHeart size={32} color="var(--text-muted)" />
          </div>
        )}

        <div style={{ position: "absolute", top: 6, left: 6, background: typeBadge[item.type], color: "white", fontSize: 9, padding: "2px 6px", borderRadius: 5, fontWeight: 700, textTransform: "capitalize" }}>
          {item.type}
        </div>

        <button
          style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: 6, background: "rgba(0,0,0,0.65)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-danger)" }}
          onClick={() => onRemove(item.id)}
          title="Remove from favorites"
        >
          <IconX size={12} color="var(--text-danger)" />
        </button>

        {canPlay && (
          <div
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "background 0.2s" }}
            onClick={() => onPlay(item)}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.45)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,0,0,0)")}
          >
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,0.92)", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.92 }}>
              <IconPlay size={18} color="#111" />
            </div>
          </div>
        )}
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
      </div>
    </div>
  );
}
