// components/search/MoodPills.tsx
// A scrollable row of mood/theme preset pills.
// Clicking one triggers a genre-based discovery with that mood's config.
import type { MoodConfig } from "../../lib/moodKeywords";

interface Props {
  moods: MoodConfig[];
  activeMood: string | null;
  onSelect: (mood: MoodConfig | null) => void;
}

export function MoodPills({ moods, activeMood, onSelect }: Props) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: "10px 20px",
        overflowX: "auto",
        flexShrink: 0,
        scrollbarWidth: "none",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--text-muted)",
          whiteSpace: "nowrap",
          alignSelf: "center",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          flexShrink: 0,
          marginRight: 4,
        }}
      >
        Mood
      </span>

      {moods.map((mood) => {
        const active = activeMood === mood.label;
        return (
          <button
            key={mood.label}
            title={mood.description}
            onClick={() => onSelect(active ? null : mood)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 14px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              border: active ? "none" : "1px solid var(--border)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
              background: active ? "var(--accent)" : "var(--bg-surface2)",
              color: active ? "#fff" : "var(--text-secondary)",
              transition: "all 0.15s",
              boxShadow: active ? "0 2px 8px rgba(0,0,0,0.25)" : "none",
            }}
            onMouseEnter={(e) => {
              if (!active)
                (e.currentTarget as HTMLButtonElement).style.borderColor =
                  "var(--accent)";
            }}
            onMouseLeave={(e) => {
              if (!active)
                (e.currentTarget as HTMLButtonElement).style.borderColor =
                  "var(--border)";
            }}
          >
            <span style={{ fontSize: 14 }}>{mood.emoji}</span>
            {mood.label}
          </button>
        );
      })}

      <style>{`
        .gx-mood-row::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
