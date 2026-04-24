// components/shared/HoverCard.tsx — hover-expand overlay for movie/TV cards
// Renders children normally; on hover shows a fixed-position portal card with
// title, rating, year, 2-line overview, and Play / Info action buttons.
// Uses a short leave-delay so the user can move the cursor from card → portal
// without it collapsing (important for the action buttons to be clickable).

import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

export interface HoverCardProps {
  title: string;
  overview?: string;
  rating?: number;
  year?: string;
  poster?: string;
  onPlay?: () => void;
  onInfo?: () => void;
  children: React.ReactNode;
}

interface Coords {
  top: number;
  left: number;
  width: number;
}

const LEAVE_DELAY_MS = 120; // ms to wait before closing — gives cursor time to reach portal

export function HoverCard({
  title,
  overview,
  rating,
  year,
  poster,
  onPlay,
  onInfo,
  children,
}: HoverCardProps) {
  const [open, setOpen]       = useState(false);
  const [coords, setCoords]   = useState<Coords>({ top: 0, left: 0, width: 0 });
  const wrapRef               = useRef<HTMLDivElement>(null);
  const leaveTimer            = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLeave = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  };

  const scheduleClose = useCallback(() => {
    clearLeave();
    leaveTimer.current = setTimeout(() => setOpen(false), LEAVE_DELAY_MS);
  }, []);

  const handleWrapEnter = () => {
    clearLeave();
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setCoords({ top: r.top, left: r.left, width: r.width });
    }
    setOpen(true);
  };

  // Compute where to show the portal so it stays inside the viewport.
  // Default: to the right of card. If too close to right edge, flip left.
  function getPortalStyle(): React.CSSProperties {
    const CARD_W      = 220;
    const GAP         = 4;
    const vpW         = window.innerWidth;
    const vpH         = window.innerHeight;

    let left = coords.left + coords.width + GAP;
    if (left + CARD_W > vpW - 16) left = coords.left - CARD_W - GAP;

    let top = coords.top - 12;
    const estimatedH = 320;
    if (top + estimatedH > vpH - 16) top = vpH - estimatedH - 16;
    if (top < 8) top = 8;

    return {
      position: "fixed",
      top,
      left,
      width: CARD_W,
      zIndex: 9_999,
      background: "var(--bg-surface)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      boxShadow: "0 24px 72px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06)",
      overflow: "hidden",
      pointerEvents: "auto",
      animation: "hoverCardIn 0.14s ease-out both",
    };
  }

  const portal = open
    ? createPortal(
        <>
          {/* Inject keyframe once — safe if injected multiple times */}
          <style>{`
            @keyframes hoverCardIn {
              from { opacity: 0; transform: scale(0.93) translateY(6px); }
              to   { opacity: 1; transform: scale(1)    translateY(0);    }
            }
          `}</style>
          <div
            style={getPortalStyle()}
            onMouseEnter={clearLeave}
            onMouseLeave={scheduleClose}
          >
            {/* Poster */}
            {poster ? (
              <img
                src={poster}
                alt={title}
                style={{ width: "100%", height: 140, objectFit: "cover", display: "block" }}
              />
            ) : (
              <div
                style={{
                  width: "100%", height: 140,
                  background: "var(--bg-surface2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, color: "var(--text-muted)",
                }}
              >
                No Image
              </div>
            )}

            {/* Info block */}
            <div style={{ padding: "10px 12px 12px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 5, lineHeight: 1.3 }}>
                {title}
              </div>

              {/* Meta row */}
              <div style={{ display: "flex", gap: 10, marginBottom: 8, fontSize: 11, color: "var(--text-muted)", flexWrap: "wrap" }}>
                {year && <span>{year}</span>}
                {rating != null && rating > 0 && (
                  <span style={{ color: "#fdd663", fontWeight: 700 }}>
                    ★ {rating.toFixed(1)}
                  </span>
                )}
              </div>

              {/* 2-line overview */}
              {overview && (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-secondary)",
                    lineHeight: 1.55,
                    marginBottom: 10,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {overview}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 6 }}>
                {onPlay && (
                  <button
                    onClick={e => { e.stopPropagation(); setOpen(false); onPlay(); }}
                    style={{
                      flex: 1, padding: "7px 0",
                      background: "var(--accent, #e50914)",
                      color: "white", border: "none",
                      borderRadius: 7, fontSize: 11, fontWeight: 700,
                      cursor: "pointer", letterSpacing: "0.02em",
                    }}
                  >
                    ▶ Play
                  </button>
                )}
                {onInfo && (
                  <button
                    onClick={e => { e.stopPropagation(); setOpen(false); onInfo(); }}
                    style={{
                      flex: 1, padding: "7px 0",
                      background: "var(--bg-surface2)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border)",
                      borderRadius: 7, fontSize: 11, fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    ⓘ Info
                  </button>
                )}
              </div>
            </div>
          </div>
        </>,
        document.body
      )
    : null;

  return (
    <>
      <div ref={wrapRef} onMouseEnter={handleWrapEnter} onMouseLeave={scheduleClose}>
        {children}
      </div>
      {portal}
    </>
  );
}
