// components/hero/TrailerBackground.tsx
// Plays a muted YouTube trailer in the hero banner when available.
// Falls back gracefully to the backdrop image — no layout change needed.
import { useState, useEffect, useRef } from "react";
import { resolveTrailer } from "../../lib/trailerResolver";

interface Props {
  mediaType: "movie" | "tv";
  tmdbId: number;
  /** If true the trailer won't load (e.g. card is not the active hero slide) */
  active: boolean;
}

export function TrailerBackground({ mediaType, tmdbId, active }: Props) {
  const [trailerKey, setTrailerKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Resolve trailer key once per id
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setReady(false);
    resolveTrailer(mediaType, tmdbId).then((result) => {
      if (!cancelled) setTrailerKey(result?.key ?? null);
    });
    return () => { cancelled = true; };
  }, [mediaType, tmdbId, active]);

  if (!trailerKey || !active) return null;

  const params = new URLSearchParams({
    autoplay: "1",
    mute: muted ? "1" : "0",
    controls: "0",
    loop: "1",
    playlist: trailerKey,
    modestbranding: "1",
    rel: "0",
    showinfo: "0",
    iv_load_policy: "3",
    enablejsapi: "1",
  });
  const src = `https://www.youtube-nocookie.com/embed/${trailerKey}?${params.toString()}`;

  return (
    <>
      {/* 16:9 iframe scaled to fill the 400px tall hero container */}
      <iframe
        ref={iframeRef}
        src={src}
        allow="autoplay; encrypted-media"
        allowFullScreen={false}
        title="trailer"
        onLoad={() => setReady(true)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          border: "none",
          objectFit: "cover",
          pointerEvents: "none",
          opacity: ready ? 1 : 0,
          transition: "opacity 0.8s ease",
          zIndex: 0,
        }}
      />

      {/* Mute/unmute pill — visible over the gradient */}
      <button
        onClick={() => setMuted((m) => !m)}
        title={muted ? "Unmute trailer" : "Mute trailer"}
        style={{
          position: "absolute",
          bottom: 56,
          right: 58,
          zIndex: 4,
          background: "rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.25)",
          borderRadius: 20,
          color: "#fff",
          fontSize: 11,
          fontWeight: 600,
          padding: "4px 12px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 5,
          backdropFilter: "blur(4px)",
        }}
      >
        {muted ? (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/>
              <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
            </svg>
            Unmute
          </>
        ) : (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
            Mute
          </>
        )}
      </button>
    </>
  );
}
