import { useEffect, useRef, useState } from "react";
import { IconClock, IconScissors } from "./Icons";

interface Props {
  duration: number;
  onTrimChange: (start: number, end: number) => void;
}

type HandleType = "start" | "end";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatTimecode(totalSeconds: number) {
  const rounded = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function parseTimecode(raw: string, fallback: number) {
  const value = String(raw || "").trim();
  if (!value) return fallback;
  const parts = value.split(":").map((part) => part.trim());
  if (parts.some((part) => !/^\d+$/.test(part))) return fallback;
  if (parts.length === 1) return Number(parts[0]);
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  return fallback;
}

export default function TrimSlider({ duration, onTrimChange }: Props) {
  const safeDuration = Math.max(1, Math.round(duration || 0));
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(safeDuration);
  const [startText, setStartText] = useState(formatTimecode(0));
  const [endText, setEndText] = useState(formatTimecode(safeDuration));
  const [dragging, setDragging] = useState<HandleType | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const initializedDurationRef = useRef<number | null>(null);

  const syncRange = (nextStart: number, nextEnd: number) => {
    const normalizedStart = clamp(Math.round(nextStart), 0, Math.max(0, safeDuration - 1));
    const normalizedEnd = clamp(Math.round(nextEnd), normalizedStart + 1, safeDuration);
    setStart(normalizedStart);
    setEnd(normalizedEnd);
    setStartText(formatTimecode(normalizedStart));
    setEndText(formatTimecode(normalizedEnd));
    onTrimChange(normalizedStart, normalizedEnd);
  };

  useEffect(() => {
    if (initializedDurationRef.current === safeDuration) return;
    initializedDurationRef.current = safeDuration;
    setStart(0);
    setEnd(safeDuration);
    setStartText(formatTimecode(0));
    setEndText(formatTimecode(safeDuration));
    onTrimChange(0, safeDuration);
  }, [safeDuration, onTrimChange]);

  useEffect(() => {
    if (!dragging) return;

    const updateFromClientX = (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const ratio = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
      const value = Math.round(ratio * safeDuration);

      if (dragging === "start") {
        syncRange(value, end);
        return;
      }
      syncRange(start, value);
    };

    const handlePointerMove = (event: PointerEvent) => {
      updateFromClientX(event.clientX);
    };

    const handlePointerUp = () => {
      setDragging(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragging, end, safeDuration, start]);

  const beginTrackDrag = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    const value = Math.round(ratio * safeDuration);
    const nearest: HandleType = Math.abs(value - start) <= Math.abs(value - end) ? "start" : "end";
    setDragging(nearest);
    if (nearest === "start") {
      syncRange(value, end);
      return;
    }
    syncRange(start, value);
  };

  const leftPct = (start / safeDuration) * 100;
  const rightPct = (end / safeDuration) * 100;

  return (
    <div className="card card-padded fade-in" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <IconScissors size={15} color="var(--text-accent)" />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-accent)" }}>Trim video</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
          <IconClock size={12} />
          {formatTimecode(end - start)} selected
        </span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <label style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>START</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              className="input-base"
              type="text"
              inputMode="numeric"
              placeholder="0:00"
              value={startText}
              onChange={(event) => setStartText(event.target.value)}
              onBlur={() => syncRange(parseTimecode(startText, start), end)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  syncRange(parseTimecode(startText, start), end);
                }
              }}
              style={{ width: "100%" }}
            />
            <div style={{ minWidth: 64, fontSize: 13, fontWeight: 600, color: "var(--text-accent)", fontFamily: "var(--font-mono)" }}>
              {formatTimecode(start)}
            </div>
          </div>
        </label>
        <label style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>END</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              className="input-base"
              type="text"
              inputMode="numeric"
              placeholder={formatTimecode(safeDuration)}
              value={endText}
              onChange={(event) => setEndText(event.target.value)}
              onBlur={() => syncRange(start, parseTimecode(endText, end))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  syncRange(start, parseTimecode(endText, end));
                }
              }}
              style={{ width: "100%" }}
            />
            <div style={{ minWidth: 64, fontSize: 13, fontWeight: 600, color: "var(--text-accent)", fontFamily: "var(--font-mono)" }}>
              {formatTimecode(end)}
            </div>
          </div>
        </label>
      </div>

      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
        Enter trim times as `m:ss` or `h:mm:ss`, for example `1:22` or `0:07`.
      </div>

      <div
        ref={trackRef}
        className="trim-range-track"
        style={{ margin: "8px 0 4px", touchAction: "none", cursor: dragging ? "grabbing" : "pointer" }}
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (target.tagName.toLowerCase() === "input") return;
          beginTrackDrag(event.clientX);
        }}
      >
        <div className="trim-track-bg" />
        <div
          className="trim-track-fill"
          style={{
            left: `${leftPct}%`,
            width: `${rightPct - leftPct}%`,
          }}
        />
        <input
          type="range"
          min={0}
          max={safeDuration}
          step={1}
          value={start}
          onChange={(event) => syncRange(Number(event.target.value), end)}
          onPointerDown={() => setDragging("start")}
          style={{ zIndex: start > safeDuration / 2 ? 4 : 3 }}
        />
        <input
          type="range"
          min={0}
          max={safeDuration}
          step={1}
          value={end}
          onChange={(event) => syncRange(start, Number(event.target.value))}
          onPointerDown={() => setDragging("end")}
          style={{ zIndex: 4 }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <span key={t} style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {formatTimecode(Math.round(t * safeDuration))}
          </span>
        ))}
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12 }}
          onClick={() => syncRange(0, safeDuration)}
        >
          Reset trim
        </button>
        <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", marginLeft: "auto" }}>
          Full duration: {formatTimecode(safeDuration)}
        </div>
      </div>
    </div>
  );
}
