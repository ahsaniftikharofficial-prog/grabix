// grabix-ui/src/pages/HomePage.tsx
// Shows real stats and real recent downloads fetched from the backend.
// Navigation uses the global grabix:navigate event (no props needed).

import { useEffect, useState } from "react";
import { BACKEND_API, backendJson } from "../lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────
interface DownloadItem {
  id: string;
  title: string;
  status: string;
  dl_type?: string;
  thumbnail?: string;
  file_size?: number;
  quality?: string;
  created_at?: string;
}

interface HomeStats {
  totalDownloads: number;
  storageUsedBytes: number;
  recentItems: DownloadItem[];
  loaded: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function navigateTo(page: string) {
  window.dispatchEvent(new CustomEvent("grabix:navigate", { detail: { page } }));
}

// ── Skeleton card ─────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div style={{ flexShrink: 0, width: 140 }}>
      <div
        style={{
          width: 140, height: 96, borderRadius: 10,
          background: "var(--surface2)", marginBottom: 8,
          animation: "grabix-skeleton-pulse 1.5s ease-in-out infinite",
        }}
      />
      <div style={{ height: 10, background: "var(--surface2)", borderRadius: 4, marginBottom: 5, width: "80%", animation: "grabix-skeleton-pulse 1.5s ease-in-out infinite" }} />
      <div style={{ height: 8, background: "var(--surface2)", borderRadius: 4, width: "50%", animation: "grabix-skeleton-pulse 1.5s ease-in-out infinite" }} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function HomePage() {
  const [stats, setStats] = useState<HomeStats>({
    totalDownloads: 0,
    storageUsedBytes: 0,
    recentItems: [],
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const downloads = await backendJson<DownloadItem[]>(`${BACKEND_API}/downloads`);
        if (cancelled) return;

        const completed = downloads.filter((d) => d.status === "done");
        const storageBytes = completed.reduce((sum, d) => sum + (d.file_size ?? 0), 0);
        // Show most recent 8 completed downloads
        const recent = [...completed]
          .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
          .slice(0, 8);

        setStats({
          totalDownloads: completed.length,
          storageUsedBytes: storageBytes,
          recentItems: recent,
          loaded: true,
        });
      } catch {
        if (!cancelled) {
          setStats((s) => ({ ...s, loaded: true }));
        }
      }
    };

    void load();
    return () => { cancelled = true; };
  }, []);

  const statCards = [
    {
      icon: "↓",
      label: "Downloads",
      value: stats.loaded ? String(stats.totalDownloads) : "—",
      color: "var(--accent)",
    },
    {
      icon: "◉",
      label: "Storage Used",
      value: stats.loaded ? formatBytes(stats.storageUsedBytes) : "—",
      color: "#388E3C",
    },
    {
      icon: "▶",
      label: "Go to Movies",
      value: "Browse",
      color: "#F57C00",
      onClick: () => navigateTo("movies"),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>

        {/* Hero */}
        <div
          style={{
            borderRadius: 16, overflow: "hidden", marginBottom: 24,
            height: 220, position: "relative",
            background: "linear-gradient(135deg, var(--accent) 0%, #6c3fc5 100%)",
          }}
        >
          <div
            style={{
              position: "absolute", inset: 0, padding: 28,
              display: "flex", flexDirection: "column", justifyContent: "flex-end",
            }}
          >
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, marginBottom: 6 }}>
              Welcome to GRABIX
            </div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 28, marginBottom: 8 }}>
              Your media hub
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => navigateTo("downloader")}
                style={{
                  padding: "8px 18px", borderRadius: 8, border: "none",
                  background: "#fff", color: "var(--accent)",
                  fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                ↓ Download
              </button>
              <button
                onClick={() => navigateTo("movies")}
                style={{
                  padding: "8px 18px", borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.4)",
                  background: "rgba(255,255,255,0.15)", color: "#fff",
                  fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                ▶ Browse Movies
              </button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 28 }}>
          {statCards.map(({ icon, label, value, color, onClick }) => (
            <div
              key={label}
              onClick={onClick}
              style={{
                display: "flex", alignItems: "center", gap: 12, padding: 16,
                borderRadius: 12, background: "var(--surface)",
                border: "1px solid var(--border)",
                cursor: onClick ? "pointer" : "default",
              }}
            >
              <div
                style={{
                  width: 36, height: 36, borderRadius: 8,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: color + "22", color, fontSize: 16,
                }}
              >
                {icon}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text)" }}>
                  {value}
                </div>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>{label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Quick download */}
        <div
          style={{
            padding: 20, borderRadius: 12, marginBottom: 28,
            background: "var(--surface)", border: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text2)", marginBottom: 10 }}>
            Quick Download
          </div>
          <div
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 14px", borderRadius: 10, marginBottom: 10,
              background: "var(--surface2)", border: "1px solid var(--border)",
            }}
          >
            <span style={{ color: "var(--text3)" }}>↓</span>
            <input
              style={{
                flex: 1, background: "transparent", border: "none",
                outline: "none", fontSize: 13, color: "var(--text)",
              }}
              placeholder="Paste YouTube, TikTok, Twitter, or any video URL…"
              onKeyDown={(e) => e.key === "Enter" && navigateTo("downloader")}
            />
          </div>
          <button
            onClick={() => navigateTo("downloader")}
            style={{
              padding: "8px 18px", borderRadius: 8, border: "none",
              background: "var(--accent)", color: "#fff",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            Open Full Downloader →
          </button>
        </div>

        {/* Recent downloads */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={{ fontWeight: 600, fontSize: 15, color: "var(--text)" }}>
              Recent Downloads
            </span>
            <button
              onClick={() => navigateTo("library")}
              style={{
                fontSize: 12, color: "var(--text3)", background: "none",
                border: "none", cursor: "pointer",
              }}
            >
              View all →
            </button>
          </div>

          <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8, scrollbarWidth: "none" }}>
            {/* Skeleton while loading */}
            {!stats.loaded && Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}

            {/* Real items */}
            {stats.loaded && stats.recentItems.map((item) => (
              <div
                key={item.id}
                onClick={() => navigateTo("library")}
                style={{ flexShrink: 0, width: 140, cursor: "pointer" }}
              >
                <div
                  style={{
                    width: 140, height: 96, borderRadius: 10, overflow: "hidden",
                    marginBottom: 8, background: "var(--surface2)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  {item.thumbnail ? (
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <span style={{ fontSize: 28, opacity: 0.3 }}>
                      {item.dl_type === "audio" ? "♪" : "▶"}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 12, fontWeight: 500, color: "var(--text)",
                    overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
                  }}
                >
                  {item.title}
                </div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                  {item.quality ?? item.dl_type ?? "media"}
                </div>
              </div>
            ))}

            {/* Empty state */}
            {stats.loaded && stats.recentItems.length === 0 && (
              <div style={{ color: "var(--text3)", fontSize: 13, padding: "20px 0" }}>
                No downloads yet. Paste a link above to get started.
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
