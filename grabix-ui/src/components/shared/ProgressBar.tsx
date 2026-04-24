// components/shared/ProgressBar.tsx — thin watch-progress bar on poster thumbnails
// Usage: <ProgressBar progress={65} /> — renders at the absolute bottom of a relative-positioned parent

interface ProgressBarProps {
  /** 0–100 percentage watched */
  progress: number;
  /** Height in px — defaults to 3 */
  height?: number;
  /** Filled colour — defaults to accent red */
  color?: string;
}

export function ProgressBar({ progress, height = 3, color = "var(--accent, #e50914)" }: ProgressBarProps) {
  if (!progress || progress <= 0) return null;
  const pct = Math.min(100, Math.max(0, progress));

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height,
        background: "rgba(255,255,255,0.18)",
        borderRadius: `0 0 ${height}px ${height}px`,
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${pct}%`,
          background: color,
          borderRadius: `0 0 0 ${height}px`,
          transition: "width 0.3s ease",
        }}
      />
    </div>
  );
}
