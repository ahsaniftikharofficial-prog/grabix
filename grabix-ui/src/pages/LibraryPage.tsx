import { useState, useEffect, useCallback } from "react";
import {
  IconSearch, IconFilter, IconGrid, IconList,
  IconFolder, IconTrash, IconVideo, IconAudio, IconImage,
  IconClock, IconCheck, IconHardDrive, IconAlert,
} from "../components/Icons";

const API = "http://127.0.0.1:8000";

async function openFolder(path: string = "") {
  try {
    await fetch(`${API}/open-download-folder?path=${encodeURIComponent(path)}`, { method: "POST" });
  } catch { /* backend offline */ }
}

interface LibItem {
  id: string;
  title: string;
  thumbnail: string;
  type: "video" | "audio" | "thumbnail";
  size: string;
  date: string;
  duration: string;
  filePath: string;
  status: string;
}

interface StorageStats {
  total_size: string;
  total_bytes: number;
  file_count: number;
  folder: string;
}

function toLibItem(row: Record<string, any>): LibItem {
  const type = (row.dl_type === "audio" ? "audio" : row.dl_type === "thumbnail" ? "thumbnail" : "video") as LibItem["type"];
  const secs = row.duration ?? 0;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  const duration = m + ":" + s.toString().padStart(2, "0");
  const date = row.created_at ? new Date(row.created_at).toLocaleDateString() : "";
  return {
    id: row.id,
    title: row.title ?? "Unknown",
    thumbnail: row.thumbnail ?? "",
    type,
    size: row.file_size ?? "",
    date,
    duration,
    filePath: row.file_path ?? "",
    status: row.status ?? "",
  };
}

export default function LibraryPage() {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("list");
  const [filter, setFilter] = useState<"all" | "video" | "audio" | "thumbnail">("all");
  const [items, setItems] = useState<LibItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);

  const loadHistory = useCallback(() => {
    setLoading(true);
    fetch(`${API}/history`)
      .then(r => r.json())
      .then((rows: any[]) => setItems(rows.map(toLibItem)))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const loadStorage = useCallback(() => {
    fetch(`${API}/storage-stats`)
      .then(r => r.json())
      .then(setStorage)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadHistory();
    loadStorage();
  }, [loadHistory, loadStorage]);

  const deleteItem = async (id: string, deleteFile: boolean) => {
    try {
      await fetch(`${API}/history/${id}?delete_file=${deleteFile}`, { method: "DELETE" });
      setItems(prev => prev.filter(i => i.id !== id));
      setDeleteConfirm(null);
      loadStorage();
    } catch { /* offline */ }
  };

  const clearAll = async (deleteFiles: boolean) => {
    try {
      await fetch(`${API}/history?delete_files=${deleteFiles}`, { method: "DELETE" });
      setItems([]);
      setClearConfirm(false);
      loadStorage();
    } catch { /* offline */ }
  };

  const filtered = items.filter(i =>
    (filter === "all" || i.type === filter) &&
    i.title.toLowerCase().includes(search.toLowerCase())
  );

  const MAX_DISPLAY_BYTES = 20 * 1024 * 1024 * 1024;
  const storagePct = storage
    ? Math.min(100, Math.round((storage.total_bytes / MAX_DISPLAY_BYTES) * 100))
    : 0;

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
            {loading ? "Loading…" : `${items.length} downloaded files`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {items.length > 0 && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, color: "var(--text-danger)", gap: 5 }}
              onClick={() => setClearConfirm(true)}
            >
              <IconTrash size={13} /> Clear history
            </button>
          )}
          <button className="btn-icon" title="Open downloads folder" onClick={() => openFolder()}>
            <IconFolder size={16} />
          </button>
          <button className={`btn-icon${view === "grid" ? " active" : ""}`} onClick={() => setView("grid")} title="Grid view">
            <IconGrid size={16} />
          </button>
          <button className={`btn-icon${view === "list" ? " active" : ""}`} onClick={() => setView("list")} title="List view">
            <IconList size={16} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

        {/* Storage stats bar */}
        {storage && (
          <div className="card card-padded fade-in" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <IconHardDrive size={15} color="var(--text-accent)" />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Storage used</span>
              <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                {storage.total_size}
              </span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                · {storage.file_count} file{storage.file_count !== 1 ? "s" : ""}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 99, background: "var(--bg-surface2)", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${storagePct}%`,
                borderRadius: 99,
                background: storagePct > 80 ? "var(--danger)" : storagePct > 50 ? "var(--warning)" : "var(--accent)",
                transition: "width 0.5s ease",
                minWidth: storagePct > 0 ? 6 : 0,
              }} />
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {storage.folder}
            </div>
          </div>
        )}

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
          <button className="btn btn-ghost" style={{ gap: 6 }}>
            <IconFilter size={14} /> Filter
          </button>
        </div>

        {/* Type chips */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {(["all", "video", "audio", "thumbnail"] as const).map(f => (
            <button key={f} className={`quality-chip${filter === f ? " active" : ""}`} onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Clear all confirm */}
        {clearConfirm && (
          <div className="card card-padded fade-in" style={{ marginBottom: 16, border: "1px solid var(--danger)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <IconAlert size={14} color="var(--text-danger)" />
              <span style={{ fontSize: 13 }}>Clear all {items.length} history records?</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => clearAll(false)}>
                Clear records only
              </button>
              <button
                className="btn"
                style={{ fontSize: 12, background: "var(--danger)", color: "white", border: "none" }}
                onClick={() => clearAll(true)}
              >
                <IconTrash size={12} /> Delete files too
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 12, marginLeft: "auto" }} onClick={() => setClearConfirm(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Items */}
        {filtered.length === 0 ? (
          <div className="empty-state">
            <IconFolder size={40} />
            <p>No files found</p>
            <span>Your downloads will appear here</span>
          </div>
        ) : view === "list" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filtered.map(item => (
              <LibListItem
                key={item.id}
                item={item}
                deleteConfirm={deleteConfirm === item.id}
                onRequestDelete={() => setDeleteConfirm(item.id)}
                onCancelDelete={() => setDeleteConfirm(null)}
                onDelete={deleteItem}
              />
            ))}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
            {filtered.map(item => <LibGridItem key={item.id} item={item} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function TypeIcon({ type }: { type: string }) {
  if (type === "audio") return <IconAudio size={14} color="var(--text-accent)" />;
  if (type === "thumbnail") return <IconImage size={14} color="var(--text-accent)" />;
  return <IconVideo size={14} color="var(--text-accent)" />;
}

interface ListItemProps {
  item: LibItem;
  deleteConfirm: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onDelete: (id: string, deleteFile: boolean) => void;
}

function LibListItem({ item, deleteConfirm, onRequestDelete, onCancelDelete, onDelete }: ListItemProps) {
  return (
    <div className="card" style={{ padding: "10px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img
          src={item.thumbnail} alt=""
          style={{ width: 64, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", flexShrink: 0 }}
          onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {item.title}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 3, fontSize: 11, color: "var(--text-muted)", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}><TypeIcon type={item.type} />{item.type}</span>
            {item.duration !== "0:00" && (
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}><IconClock size={11} />{item.duration}</span>
            )}
            {item.size && <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>{item.size}</span>}
            <span>{item.date}</span>
            {item.filePath && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260, color: "var(--text-muted)" }}>
                {item.filePath}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <div className="tooltip-wrap">
            <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => openFolder(item.filePath)}>
              <IconFolder size={13} />
            </button>
            <span className="tooltip-box">Open file location</span>
          </div>
          <div className="tooltip-wrap">
            <button className="btn-icon" style={{ width: 28, height: 28, color: "var(--text-danger)" }} onClick={onRequestDelete}>
              <IconTrash size={13} />
            </button>
            <span className="tooltip-box">Delete</span>
          </div>
        </div>
        {item.status === "done" && (
          <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--text-success)", fontSize: 11, flexShrink: 0 }}>
            <IconCheck size={11} />
          </span>
        )}
      </div>

      {/* Inline delete confirm */}
      {deleteConfirm && (
        <div className="fade-in" style={{
          marginTop: 10, padding: "10px 12px",
          background: "var(--bg-surface2)", borderRadius: "var(--radius-sm)",
          border: "1px solid var(--danger)",
        }}>
          <div style={{ fontSize: 12, marginBottom: 8, color: "var(--text-danger)", display: "flex", alignItems: "center", gap: 6 }}>
            <IconAlert size={12} /> Remove this item?
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => onDelete(item.id, false)}>
              History only
            </button>
            <button
              className="btn"
              style={{ fontSize: 11, background: "var(--danger)", color: "white", border: "none" }}
              onClick={() => onDelete(item.id, true)}
            >
              <IconTrash size={11} /> Delete file too
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 11, marginLeft: "auto" }} onClick={onCancelDelete}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LibGridItem({ item }: { item: LibItem }) {
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ position: "relative" }}>
        <img
          src={item.thumbnail} alt=""
          style={{ width: "100%", height: 100, objectFit: "cover" }}
          onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <div style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.7)", color: "white", fontSize: 10, padding: "2px 6px", borderRadius: 4, fontFamily: "var(--font-mono)" }}>
          {item.duration}
        </div>
        <div style={{ position: "absolute", top: 6, left: 6 }}><TypeIcon type={item.type} /></div>
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.title}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          {item.size && <strong style={{ color: "var(--text-secondary)" }}>{item.size} · </strong>}
          {item.date}
        </div>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 10, marginTop: 6, width: "100%", gap: 4 }}
          onClick={() => openFolder(item.filePath)}
        >
          <IconFolder size={11} /> Open
        </button>
      </div>
    </div>
  );
}
