import { useState, useEffect, useCallback } from "react";
import {
  IconSearch, IconFilter, IconGrid, IconList,
  IconFolder, IconTrash, IconVideo, IconAudio, IconImage, IconSubtitle,
  IconClock, IconRefresh,
} from "../components/Icons";

const API = "http://127.0.0.1:8000";

// Matches the backend history table
interface HistoryItem {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  channel: string;
  duration: number;    // seconds
  dl_type: string;     // "video" | "audio" | "thumbnail" | "subtitle"
  file_path: string;
  status: string;      // "done" | "failed" | "canceled" | ...
  created_at: string;  // ISO string
}

type FilterType = "all" | "video" | "audio" | "thumbnail" | "subtitle";

function secs(s: number) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function relativeDate(iso: string) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString();
  } catch {
    return iso.slice(0, 10);
  }
}

export default function LibraryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("list");
  const [filter, setFilter] = useState<FilterType>("all");

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/history`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data: HistoryItem[] = await res.json();
      setItems(data);
    } catch (e: any) {
      setError(e.message || "Could not load history. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const openFolder = async (filePath: string) => {
    if (!filePath) return;
    try {
      await fetch(`${API}/open-download-folder?path=${encodeURIComponent(filePath)}`, { method: "POST" });
    } catch { /* ignore */ }
  };

  const filtered = items.filter(i =>
    (filter === "all" || i.dl_type === filter) &&
    i.title?.toLowerCase().includes(search.toLowerCase()) &&
    i.status === "done"   // only show completed downloads
  );

  const doneCount = items.filter(i => i.status === "done").length;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* Topbar */}
      <div style={{
        padding: "14px 24px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Library</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>
            {loading ? "Loading…" : `${doneCount} downloaded file${doneCount !== 1 ? "s" : ""}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div className="tooltip-wrap">
            <button className="btn-icon" onClick={fetchHistory} title="Refresh">
              <IconRefresh size={15} className={loading ? "spin" : ""} />
            </button>
            <span className="tooltip-box">Refresh</span>
          </div>
          <div className="tooltip-wrap">
            <button className="btn-icon" onClick={() => openFolder("")} title="Open downloads folder">
              <IconFolder size={16} />
            </button>
            <span className="tooltip-box">Open GRABIX folder</span>
          </div>
          <button
            className={`btn-icon${view === "grid" ? " active" : ""}`}
            onClick={() => setView("grid")}
            title="Grid view"
          >
            <IconGrid size={16} />
          </button>
          <button
            className={`btn-icon${view === "list" ? " active" : ""}`}
            onClick={() => setView("list")}
            title="List view"
          >
            <IconList size={16} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

        {/* Search + filter */}
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>
              <IconSearch size={14} color="var(--text-muted)" />
            </div>
            <input
              className="input-base"
              style={{ paddingLeft: 38 }}
              placeholder="Search your library..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Type filter chips */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {(["all", "video", "audio", "thumbnail", "subtitle"] as FilterType[]).map(f => (
            <button
              key={f}
              className={`quality-chip${filter === f ? " active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Error state */}
        {error && (
          <div style={{
            padding: "12px 16px", borderRadius: "var(--radius-sm)",
            background: "var(--bg-surface2)", border: "1px solid var(--danger)",
            fontSize: 13, color: "var(--text-danger)", marginBottom: 16,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span>⚠ {error}</span>
            <button className="btn btn-ghost" style={{ marginLeft: "auto", fontSize: 12 }} onClick={fetchHistory}>
              Retry
            </button>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !error && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[1, 2, 3].map(i => (
              <div
                key={i}
                className="card"
                style={{
                  padding: "12px 14px", display: "flex", alignItems: "center", gap: 12,
                  opacity: 0.5,
                }}
              >
                <div style={{ width: 64, height: 40, borderRadius: 6, background: "var(--bg-surface2)" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ height: 13, borderRadius: 4, background: "var(--bg-surface2)", marginBottom: 6, width: "60%" }} />
                  <div style={{ height: 11, borderRadius: 4, background: "var(--bg-surface2)", width: "30%" }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && filtered.length === 0 && (
          <div className="empty-state">
            <IconFolder size={40} />
            <p>{search || filter !== "all" ? "No files match your search" : "No downloads yet"}</p>
            <span>
              {search || filter !== "all"
                ? "Try a different search or filter"
                : "Downloads you complete will appear here"}
            </span>
          </div>
        )}

        {/* List view */}
        {!loading && !error && filtered.length > 0 && view === "list" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filtered.map(item => (
              <LibListItem key={item.id} item={item} onOpenFolder={openFolder} />
            ))}
          </div>
        )}

        {/* Grid view */}
        {!loading && !error && filtered.length > 0 && view === "grid" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
            {filtered.map(item => (
              <LibGridItem key={item.id} item={item} onOpenFolder={openFolder} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Type icon helper ─────────────────────────────────────────────────────────
function TypeIcon({ type }: { type: string }) {
  if (type === "audio")     return <IconAudio    size={13} color="var(--text-accent)" />;
  if (type === "thumbnail") return <IconImage    size={13} color="var(--text-accent)" />;
  if (type === "subtitle")  return <IconSubtitle size={13} color="var(--text-accent)" />;
  return                           <IconVideo    size={13} color="var(--text-accent)" />;
}

// ── List item ────────────────────────────────────────────────────────────────
function LibListItem({ item, onOpenFolder }: { item: HistoryItem; onOpenFolder: (p: string) => void }) {
  return (
    <div className="card fade-in" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
      {item.thumbnail ? (
        <img
          src={item.thumbnail}
          alt=""
          style={{ width: 64, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", flexShrink: 0 }}
          onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div style={{ width: 64, height: 40, borderRadius: 6, background: "var(--bg-surface2)", border: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <TypeIcon type={item.dl_type} />
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.title || item.url}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 3, fontSize: 11, color: "var(--text-muted)", alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <TypeIcon type={item.dl_type} />
            {item.dl_type}
          </span>
          {item.duration > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <IconClock size={11} />
              {secs(item.duration)}
            </span>
          )}
          {item.channel && <span>{item.channel}</span>}
          <span>{relativeDate(item.created_at)}</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        {item.file_path && (
          <div className="tooltip-wrap">
            <button
              className="btn-icon"
              style={{ width: 28, height: 28 }}
              onClick={() => onOpenFolder(item.file_path)}
              title="Open file location"
            >
              <IconFolder size={13} />
            </button>
            <span className="tooltip-box">Open in folder</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Grid item ────────────────────────────────────────────────────────────────
function LibGridItem({ item, onOpenFolder }: { item: HistoryItem; onOpenFolder: (p: string) => void }) {
  return (
    <div
      className="card fade-in"
      style={{ overflow: "hidden", cursor: item.file_path ? "pointer" : "default" }}
      onClick={() => item.file_path && onOpenFolder(item.file_path)}
      title={item.title}
    >
      <div style={{ position: "relative" }}>
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt=""
            style={{ width: "100%", height: 100, objectFit: "cover", display: "block" }}
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div style={{ width: "100%", height: 100, background: "var(--bg-surface2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <TypeIcon type={item.dl_type} />
          </div>
        )}
        {item.duration > 0 && (
          <div style={{
            position: "absolute", bottom: 5, right: 5,
            background: "rgba(0,0,0,0.7)", color: "white",
            fontSize: 10, padding: "2px 6px", borderRadius: 4,
            fontFamily: "var(--font-mono)",
          }}>
            {secs(item.duration)}
          </div>
        )}
        <div style={{ position: "absolute", top: 6, left: 6 }}>
          <TypeIcon type={item.dl_type} />
        </div>
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.title || item.url}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          {relativeDate(item.created_at)}
        </div>
      </div>
    </div>
  );
}
