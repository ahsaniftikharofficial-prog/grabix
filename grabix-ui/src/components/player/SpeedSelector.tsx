// components/player/SpeedSelector.tsx
// Standalone playback speed selector pill — drop this anywhere in the player
// chrome. The player's settings panel already shows speed via the settings
// screen; this component gives you a compact always-visible alternative.
import { useState } from "react";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
type Speed = (typeof SPEEDS)[number];

interface Props {
  value: Speed | number;
  onChange: (speed: number) => void;
  /** If false (embed/iframe engine) the control is hidden — nothing to control */
  enabled?: boolean;
}

export function SpeedSelector({ value, onChange, enabled = true }: Props) {
  const [open, setOpen] = useState(false);

  if (!enabled) return null;

  const label = value === 1 ? "1×" : `${value}×`;

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      {/* Trigger pill */}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Playback speed"
        style={{
          background: open ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: 4,
          color: "#fff",
          fontSize: 11,
          fontWeight: 700,
          padding: "4px 9px",
          cursor: "pointer",
          letterSpacing: "0.04em",
          transition: "background 0.15s",
          minWidth: 36,
        }}
      >
        {label}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(18,18,18,0.97)",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 8,
            padding: "6px 0",
            minWidth: 110,
            boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
            backdropFilter: "blur(8px)",
            zIndex: 50,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.4)",
              padding: "2px 14px 6px",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            Speed
          </div>
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => { onChange(s); setOpen(false); }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                background: "none",
                border: "none",
                padding: "7px 14px",
                cursor: "pointer",
                fontSize: 13,
                color: value === s ? "var(--accent, #e11d48)" : "#fff",
                fontWeight: value === s ? 700 : 400,
              }}
            >
              <span>{s === 1 ? "Normal" : `${s}×`}</span>
              {value === s && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <polyline points="20 6 9 17 4 12" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Click-away backdrop */}
      {open && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 49 }}
          onClick={() => setOpen(false)}
        />
      )}
    </div>
  );
}
