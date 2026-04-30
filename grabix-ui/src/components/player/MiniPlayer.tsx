// components/player/MiniPlayer.tsx
// Floating picture-in-picture style mini player.
// Appears in the bottom-right corner when the user navigates away mid-playback.
// Clicking it restores the full player on the originating page.
import { useMiniPlayer } from "../../hooks/useMiniPlayer";

interface Props {
  /** Called when user clicks the mini player to restore full view */
  onRestore: () => void;
}

export function MiniPlayer({ onRestore }: Props) {
  const { mini, dismiss } = useMiniPlayer();

  if (!mini?.active) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 9999,
        width: 240,
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
        border: "1px solid rgba(255,255,255,0.12)",
        background: "#111",
        cursor: "pointer",
        animation: "gx-miniplayer-in 0.3s cubic-bezier(0.34,1.56,0.64,1)",
      }}
      onClick={onRestore}
      title="Click to return to player"
    >
      {/* Thumbnail */}
      <div style={{ position: "relative", height: 135, background: "#000" }}>
        {mini.poster ? (
          <img
            src={mini.poster}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
            }}
          >
            🎬
          </div>
        )}

        {/* Play icon overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.3)",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "rgba(0,0,0,0.7)",
              border: "2px solid rgba(255,255,255,0.8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={(e) => { e.stopPropagation(); dismiss(); }}
          title="Close mini player"
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            background: "rgba(0,0,0,0.65)",
            border: "none",
            borderRadius: "50%",
            width: 24,
            height: 24,
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Title bar */}
      <div
        style={{
          padding: "8px 10px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "#1a1a1a",
        }}
      >
        <div
          style={{
            flex: 1,
            fontSize: 12,
            fontWeight: 600,
            color: "#fff",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {mini.title}
        </div>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", flexShrink: 0 }}>
          Resume ›
        </span>
      </div>

    </div>
  );
}
