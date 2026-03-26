import { useState, useRef, useCallback } from "react";
import { IconScissors, IconClock } from "./Icons";

interface Props {
  duration: number; // seconds
  onTrimChange: (start: number, end: number) => void;
}

function secs(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function TrimSlider({ duration, onTrimChange }: Props) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(duration);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  const handleStart = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Math.min(Number(e.target.value), end - 1);
    setStart(val);
    onTrimChange(val, end);
  }, [end, onTrimChange]);

  const handleEnd = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Math.max(Number(e.target.value), start + 1);
    setEnd(val);
    onTrimChange(start, val);
  }, [start, onTrimChange]);

  const leftPct = (start / duration) * 100;
  const rightPct = (end / duration) * 100;

  return (
    <div className="card card-padded fade-in" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <IconScissors size={15} color="var(--text-accent)" />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-accent)" }}>Trim video</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
          <IconClock size={12} />
          {secs(end - start)} selected
        </span>
      </div>

      {/* Timestamps */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>START</div>
          <div style={{
            fontSize: 15, fontWeight: 600, color: "var(--text-accent)",
            fontFamily: "var(--font-mono)",
            background: "var(--accent-light)", padding: "4px 10px",
            borderRadius: "var(--radius-sm)",
          }}>{secs(start)}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", color: "var(--text-muted)", fontSize: 12 }}>→</div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>END</div>
          <div style={{
            fontSize: 15, fontWeight: 600, color: "var(--text-accent)",
            fontFamily: "var(--font-mono)",
            background: "var(--accent-light)", padding: "4px 10px",
            borderRadius: "var(--radius-sm)",
          }}>{secs(end)}</div>
        </div>
      </div>

      {/* Slider track */}
      <div className="trim-range-track" style={{ margin: "8px 0 4px" }}>
        <div className="trim-track-bg" />
        {/* Filled range */}
        <div className="trim-track-fill" style={{
          left: `${leftPct}%`,
          width: `${rightPct - leftPct}%`,
        }} />
        {/* Start handle */}
        <input
          ref={startRef}
          type="range"
          min={0}
          max={duration}
          step={1}
          value={start}
          onChange={handleStart}
          style={{ zIndex: start > duration / 2 ? 4 : 3 }}
        />
        {/* End handle */}
        <input
          ref={endRef}
          type="range"
          min={0}
          max={duration}
          step={1}
          value={end}
          onChange={handleEnd}
          style={{ zIndex: 4 }}
        />
      </div>

      {/* Tick marks */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <span key={t} style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {secs(Math.round(t * duration))}
          </span>
        ))}
      </div>

      {/* Reset */}
      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => {
          setStart(0); setEnd(duration); onTrimChange(0, duration);
        }}>
          Reset trim
        </button>
        <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", marginLeft: "auto" }}>
          Full duration: {secs(duration)}
        </div>
      </div>
    </div>
  );
}
