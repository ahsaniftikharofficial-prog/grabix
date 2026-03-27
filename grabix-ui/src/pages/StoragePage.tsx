// grabix-ui/src/pages/StoragePage.tsx
// Phase 3 — Storage Manager
// A dedicated page showing disk usage, breakdown by type, and cleanup tools.

import { useState, useEffect } from "react";
import { IconFolder, IconTrash, IconRefresh, IconVideo, IconAudio, IconImage } from "../components/Icons";

const API = "http://127.0.0.1:8000";

interface StorageStats {
  total_bytes: number;
  total_label: string;
  folder_total_bytes: number;
  folder_total_label: string;
  by_type: Record<string, { bytes: number; label: string }>;
  untracked_bytes: number;
  untracked_count: number;
  download_dir: string;
}

const TYPE_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  video:     { label: "Videos",     color: "var(--accent)",         icon: <IconVideo size={16} /> },
  audio:     { label: "Audio",      color: "var(--text-success)",   icon: <IconAudio size={16} /> },
  thumbnail: { label: "Thumbnails", color: "var(--text-warning)",   icon: <IconImage size={16} /> },
  subtitle:  { label: "Subtitles",  color: "var(--text-secondary)", icon: <IconFolder size={16} /> },
  other:     { label: "Other",      color: "var(--text-muted)",     icon: <IconFolder size={16} /> },
};

export default function StoragePage() {
  const [stats, setStats]       = useState<StorageStats | null>(null);
  const [loading, setLoading]   = useState(true);
  const [clearing, setClearing] = useState(false);
  const [toast, setToast]       = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  const load = () => {
    setLoading(true);
    fetch(`${API}/storage/stats`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openDownloadFolder = async () => {
    try {
      await fetch(`${API}/open-download-folder`, { method: "POST" });
    } catch { /* desktop only */ }
  };

  const clearHistory = async (deleteFiles: boolean) => {
    const msg = deleteFiles
      ? "This will delete ALL files from disk AND clear history. This cannot be undone. Continue?"
      : "This will clear all history entries but keep the files on disk. Continue?";
    if (!confirm(msg)) return;
    setClearing(true);
    try {
      await fetch(`${API}/history?delete_files=${deleteFiles}`, { method: "DELETE" });
      showToast(deleteFiles ? "All files and history cleared." : "History cleared.");
      load();
    } catch {
      showToast("Failed to clear history.");
    } finally {
      setClearing(false);
    }
  };

  const totalBytes    = stats?.folder_total_bytes ?? 0;
  const trackedBytes  = stats?.total_bytes ?? 0;
  const typeEntries   = Object.entries(stats?.by_type ?? {}).filter(([, v]) => v.bytes > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "var(--accent)", color: "var(--text-on-accent)",
          padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 500,
          zIndex: 999, boxShadow: "var(--shadow-md)", pointerEvents: "none",
        }}>{toast}</div>
      )}

      {/* Topbar */}
      <div style={{
        padding: "14px 24px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)", display: "flex",
        alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Storage</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>
            {loading ? "Loading…" : `${stats?.folder_total_label ?? "0 B"} used in GRABIX folder`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" style={{ gap: 6, fontSize: 13 }} onClick={openDownloadFolder}>
            <IconFolder size={14} /> Open Folder
          </button>
          <button className="btn-icon" title="Refresh stats" onClick={load}><IconRefresh size={15} /></button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)", fontSize: 14 }}>
            Loading storage stats…
          </div>
        ) : !stats ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)", fontSize: 14 }}>
            Could not load storage stats. Is the backend running?
          </div>
        ) : (
          <>
            {/* ── Big usage card ─────────────────────────────────────────── */}
            <div className="card" style={{ padding: "20px 24px", marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)" }}>
                    {stats.folder_total_label}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
                    Total in <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{stats.download_dir}</span>
                  </div>
                </div>
                {stats.untracked_count > 0 && (
                  <div style={{ fontSize: 12, color: "var(--text-warning)", background: "var(--bg-overlay)", padding: "5px 10px", borderRadius: 8 }}>
                    {stats.untracked_count} untracked file{stats.untracked_count > 1 ? "s" : ""}
                  </div>
                )}
              </div>

              {/* Bar */}
              {totalBytes > 0 && (
                <div style={{ height: 8, borderRadius: 6, background: "var(--border)", overflow: "hidden", display: "flex", marginBottom: 12 }}>
                  {typeEntries.map(([type, val]) => (
                    <div
                      key={type}
                      title={`${TYPE_META[type]?.label ?? type}: ${val.label}`}
                      style={{
                        width: `${(val.bytes / totalBytes) * 100}%`,
                        background: TYPE_META[type]?.color ?? "var(--text-muted)",
                        transition: "width 0.4s ease",
                      }}
                    />
                  ))}
                  {stats.untracked_bytes > 0 && (
                    <div style={{
                      width: `${(stats.untracked_bytes / totalBytes) * 100}%`,
                      background: "var(--border)",
                    }} />
                  )}
                </div>
              )}

              {/* Legend */}
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                {typeEntries.map(([type, val]) => (
                  <div key={type} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)" }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: TYPE_META[type]?.color ?? "var(--text-muted)", flexShrink: 0 }} />
                    <span>{TYPE_META[type]?.label ?? type}</span>
                    <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{val.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Per-type cards ─────────────────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, marginBottom: 20 }}>
              {typeEntries.map(([type, val]) => {
                const meta = TYPE_META[type] ?? { label: type, color: "var(--text-muted)", icon: <IconFolder size={16} /> };
                const pct = totalBytes > 0 ? Math.round((val.bytes / totalBytes) * 100) : 0;
                return (
                  <div key={type} className="card" style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, color: meta.color }}>
                      {meta.icon}
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{meta.label}</span>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>{val.label}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{pct}% of total</div>
                    <div style={{ height: 3, borderRadius: 2, background: "var(--border)", marginTop: 8 }}>
                      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 2, background: meta.color, transition: "width 0.4s" }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Danger zone ────────────────────────────────────────────── */}
            <div className="card" style={{ padding: "18px 20px", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Cleanup</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
                These actions cannot be undone. Be careful.
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 13, gap: 6 }}
                  onClick={() => clearHistory(false)}
                  disabled={clearing}
                >
                  <IconTrash size={14} />
                  Clear history only
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 13, gap: 6, color: "var(--text-danger)" }}
                  onClick={() => clearHistory(true)}
                  disabled={clearing}
                >
                  <IconTrash size={14} />
                  Delete all files + history
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
