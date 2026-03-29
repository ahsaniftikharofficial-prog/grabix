// grabix-ui/src/pages/LibraryPage.tsx
// Phase 3 — Library & Organization
// Replaces the Phase 2 stub completely.

import { useState, useEffect, useCallback } from "react";
import {
  IconSearch, IconFilter, IconGrid, IconList,
  IconFolder, IconTrash, IconVideo, IconAudio, IconImage,
  IconClock, IconCheck, IconRefresh, IconChevronDown, IconX,
} from "../components/Icons";
import { BACKEND_API } from "../lib/api";
const API = BACKEND_API;

// ─── Types ────────────────────────────────────────────────────────────────────
interface LibItem {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  channel: string;
  type: "video" | "audio" | "thumbnail" | "subtitle";
  file_path: string;
  file_size: number;
  file_size_label: string;
  duration: string;
  date: string;
  tags: string;
  category: string;
  status: string;
}

type SortKey = "date" | "title" | "size" | "type";
type SortDir = "desc" | "asc";
type FilterType = "all" | "video" | "audio" | "thumbnail" | "subtitle";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function toLibItem(row: Record<string, any>): LibItem {
  const type = (["video","audio","thumbnail","subtitle"].includes(row.dl_type)
    ? row.dl_type : "video") as LibItem["type"];
  return {
    id:             row.id,
    url:            row.url ?? "",
    title:          row.title ?? "Unknown",
    thumbnail:      row.thumbnail ?? "",
    channel:        row.channel ?? "",
    type,
    file_path:      row.file_path ?? "",
    file_size:      row.file_size ?? 0,
    file_size_label:row.file_size_label ?? "",
    duration:       row.duration ? fmtDuration(Number(row.duration)) : "—",
    date:           row.created_at ? new Date(row.created_at).toLocaleDateString() : "",
    tags:           row.tags ?? "",
    category:       row.category ?? "",
    status:         row.status ?? "",
  };
}

const TYPE_COLORS: Record<string, string> = {
  video:     "var(--accent)",
  audio:     "var(--text-success)",
  thumbnail: "var(--text-warning)",
  subtitle:  "var(--text-secondary)",
};

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function LibraryPage() {
  const [items, setItems]           = useState<LibItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [view, setView]             = useState<"grid" | "list">("list");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [sortKey, setSortKey]       = useState<SortKey>("date");
  const [sortDir, setSortDir]       = useState<SortDir>("desc");
  const [showSort, setShowSort]     = useState(false);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [editItem, setEditItem]     = useState<LibItem | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [toast, setToast]           = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const load = useCallback(() => {
    setLoading(true);
    fetch(`${API}/history/full`)
      .then(r => r.json())
      .then((rows: any[]) => setItems(rows.map(toLibItem)))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Filtering + Sorting ────────────────────────────────────────────────────
  const filtered = items
    .filter(i =>
      (filterType === "all" || i.type === filterType) &&
      (
        i.title.toLowerCase().includes(search.toLowerCase()) ||
        i.channel.toLowerCase().includes(search.toLowerCase()) ||
        i.tags.toLowerCase().includes(search.toLowerCase()) ||
        i.category.toLowerCase().includes(search.toLowerCase())
      )
    )
    .sort((a, b) => {
      let v = 0;
      if (sortKey === "date")  v = (a.date  < b.date  ? -1 : 1);
      if (sortKey === "title") v = a.title.localeCompare(b.title);
      if (sortKey === "size")  v = a.file_size - b.file_size;
      if (sortKey === "type")  v = a.type.localeCompare(b.type);
      return sortDir === "desc" ? -v : v;
    });

  // ── Selection helpers ──────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll  = () => setSelected(new Set(filtered.map(i => i.id)));
  const clearSel   = () => setSelected(new Set());

  // ── Actions ────────────────────────────────────────────────────────────────
  const openFolder = async (item: LibItem) => {
    try {
      await fetch(`${API}/open-download-folder?path=${encodeURIComponent(item.file_path)}`, { method: "POST" });
    } catch { /* ignore on web dev */ }
  };

  const deleteItem = async (id: string) => {
    if (!confirm("Delete this file from disk and history?")) return;
    await fetch(`${API}/history/${id}?delete_file=true`, { method: "DELETE" });
    setItems(prev => prev.filter(i => i.id !== id));
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    showToast("File deleted.");
  };

  const deleteSelected = async () => {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} file(s) from disk and history?`)) return;
    await Promise.all([...selected].map(id =>
      fetch(`${API}/history/${id}?delete_file=true`, { method: "DELETE" })
    ));
    setItems(prev => prev.filter(i => !selected.has(i.id)));
    setSelected(new Set());
    showToast(`${selected.size} file(s) deleted.`);
  };

  const organize = async () => {
    setOrganizing(true);
    try {
      const r = await fetch(`${API}/library/organize`, { method: "POST" });
      const data = await r.json();
      showToast(`Organized! ${data.moved} file(s) moved.`);
      load();
    } catch {
      showToast("Organize failed.");
    } finally {
      setOrganizing(false);
    }
  };

  const saveTags = async (item: LibItem, tags: string, category: string) => {
    await fetch(`${API}/history/${item.id}?tags=${encodeURIComponent(tags)}&category=${encodeURIComponent(category)}`, {
      method: "PATCH",
    });
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, tags, category } : i));
    setEditItem(null);
    showToast("Tags saved.");
  };

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalSize = items.reduce((s, i) => s + i.file_size, 0);
  const fmtTotal  = totalSize > 1073741824
    ? `${(totalSize / 1073741824).toFixed(1)} GB`
    : totalSize > 1048576
    ? `${(totalSize / 1048576).toFixed(1)} MB`
    : `${Math.round(totalSize / 1024)} KB`;

  const SORT_OPTIONS: { key: SortKey; label: string }[] = [
    { key: "date",  label: "Date added" },
    { key: "title", label: "Title (A–Z)" },
    { key: "size",  label: "File size" },
    { key: "type",  label: "Type" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "var(--accent)", color: "var(--text-on-accent)",
          padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 500,
          zIndex: 999, boxShadow: "var(--shadow-md)", pointerEvents: "none",
        }}>{toast}</div>
      )}

      {/* ── Topbar ────────────────────────────────────────────────────────── */}
      <div style={{
        padding: "14px 24px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)", display: "flex",
        alignItems: "center", justifyContent: "space-between", gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Library</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>
            {loading ? "Loading…" : `${items.length} files · ${fmtTotal}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {selected.size > 0 && (
            <>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{selected.size} selected</span>
              <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--text-danger)", gap: 5 }} onClick={deleteSelected}>
                <IconTrash size={13} /> Delete
              </button>
              <button className="btn btn-ghost" style={{ fontSize: 12, gap: 5 }} onClick={clearSel}>
                <IconX size={13} /> Clear
              </button>
            </>
          )}
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, gap: 6 }}
            onClick={organize}
            disabled={organizing}
            title="Move files into Videos / Audio / Thumbnails subfolders"
          >
            <IconFolder size={14} />
            {organizing ? "Organizing…" : "Organize"}
          </button>
          <button className="btn-icon" title="Refresh library" onClick={load}><IconRefresh size={15} /></button>
          <button className={`btn-icon${view === "grid" ? " active" : ""}`} onClick={() => setView("grid")} title="Grid view"><IconGrid size={15} /></button>
          <button className={`btn-icon${view === "list" ? " active" : ""}`} onClick={() => setView("list")} title="List view"><IconList size={15} /></button>
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

        {/* Search + Sort */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>
              <IconSearch size={14} color="var(--text-muted)" />
            </div>
            <input
              className="input-base"
              style={{ paddingLeft: 38 }}
              placeholder="Search title, channel, tags…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Sort dropdown */}
          <div style={{ position: "relative" }}>
            <button
              className="btn btn-ghost"
              style={{ gap: 6, fontSize: 13 }}
              onClick={() => setShowSort(v => !v)}
            >
              <IconFilter size={14} />
              {SORT_OPTIONS.find(s => s.key === sortKey)?.label}
              <IconChevronDown size={13} />
            </button>
            {showSort && (
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 100,
                background: "var(--bg-surface)", border: "1px solid var(--border)",
                borderRadius: 10, padding: "6px", minWidth: 160,
                boxShadow: "var(--shadow-md)",
              }}>
                {SORT_OPTIONS.map(opt => (
                  <div
                    key={opt.key}
                    onClick={() => {
                      if (sortKey === opt.key) setSortDir(d => d === "desc" ? "asc" : "desc");
                      else { setSortKey(opt.key); setSortDir("desc"); }
                      setShowSort(false);
                    }}
                    style={{
                      padding: "7px 12px", borderRadius: 7, cursor: "pointer",
                      fontSize: 13, display: "flex", justifyContent: "space-between",
                      background: sortKey === opt.key ? "var(--bg-active)" : "transparent",
                      color: sortKey === opt.key ? "var(--text-accent)" : "var(--text-primary)",
                    }}
                  >
                    {opt.label}
                    {sortKey === opt.key && <span style={{ fontSize: 11 }}>{sortDir === "desc" ? "↓" : "↑"}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Type filter chips + Select all */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16, alignItems: "center" }}>
          {(["all","video","audio","thumbnail","subtitle"] as FilterType[]).map(f => (
            <button key={f} className={`quality-chip${filterType === f ? " active" : ""}`} onClick={() => setFilterType(f)}>
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {filtered.length > 0 && (
            <button
              style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}
              onClick={selected.size === filtered.length ? clearSel : selectAll}
            >
              {selected.size === filtered.length ? "Deselect all" : "Select all"}
            </button>
          )}
        </div>

        {/* Storage mini-bar */}
        {items.length > 0 && <StorageBar items={items} />}

        {/* Empty state */}
        {filtered.length === 0 ? (
          <div className="empty-state">
            <IconFolder size={40} />
            <p>No files found</p>
            <span>{search ? "Try a different search term" : "Your downloads will appear here"}</span>
          </div>
        ) : view === "list" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {filtered.map(item => (
              <LibListItem
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                onSelect={() => toggleSelect(item.id)}
                onOpen={openFolder}
                onDelete={deleteItem}
                onEdit={setEditItem}
              />
            ))}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
            {filtered.map(item => (
              <LibGridItem
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                onSelect={() => toggleSelect(item.id)}
                onDelete={deleteItem}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Edit Tags Modal ────────────────────────────────────────────────── */}
      {editItem && (
        <TagsModal item={editItem} onSave={saveTags} onClose={() => setEditItem(null)} />
      )}
    </div>
  );
}

// ─── Storage mini-bar ────────────────────────────────────────────────────────
function StorageBar({ items }: { items: LibItem[] }) {
  const byType: Record<string, number> = { video: 0, audio: 0, thumbnail: 0, subtitle: 0 };
  let total = 0;
  for (const i of items) {
    byType[i.type] = (byType[i.type] ?? 0) + i.file_size;
    total += i.file_size;
  }
  if (!total) return null;

  const COLORS: Record<string, string> = {
    video: "var(--accent)", audio: "var(--text-success)",
    thumbnail: "var(--text-warning)", subtitle: "var(--text-muted)",
  };

  return (
    <div style={{ marginBottom: 18, background: "var(--bg-surface2)", borderRadius: 10, padding: "12px 16px" }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Storage used</div>
      <div style={{ height: 6, borderRadius: 4, background: "var(--border)", overflow: "hidden", display: "flex" }}>
        {Object.entries(byType).map(([type, bytes]) => (
          bytes > 0 && (
            <div key={type} style={{
              width: `${(bytes / total) * 100}%`,
              background: COLORS[type],
              transition: "width 0.4s ease",
            }} />
          )
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
        {Object.entries(byType).map(([type, bytes]) => bytes > 0 && (
          <div key={type} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-secondary)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS[type], flexShrink: 0 }} />
            {type.charAt(0).toUpperCase() + type.slice(1)}: {bytes > 1048576 ? `${(bytes/1048576).toFixed(1)} MB` : `${Math.round(bytes/1024)} KB`}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Type icon helper ─────────────────────────────────────────────────────────
function TypeIcon({ type }: { type: string }) {
  const col = TYPE_COLORS[type] ?? "var(--text-muted)";
  if (type === "audio")     return <IconAudio size={13} color={col} />;
  if (type === "thumbnail") return <IconImage size={13} color={col} />;
  return <IconVideo size={13} color={col} />;
}

// ─── List row ─────────────────────────────────────────────────────────────────
function LibListItem({
  item, selected, onSelect, onOpen, onDelete, onEdit,
}: {
  item: LibItem;
  selected: boolean;
  onSelect: () => void;
  onOpen: (i: LibItem) => void;
  onDelete: (id: string) => void;
  onEdit: (i: LibItem) => void;
}) {
  return (
    <div
      className="card"
      style={{
        padding: "9px 14px", display: "flex", alignItems: "center", gap: 11,
        outline: selected ? "2px solid var(--accent)" : "none",
        cursor: "pointer",
      }}
      onClick={onSelect}
    >
      {/* Checkbox */}
      <div
        style={{
          width: 16, height: 16, borderRadius: 4, border: `2px solid ${selected ? "var(--accent)" : "var(--border)"}`,
          background: selected ? "var(--accent)" : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          transition: "var(--transition)",
        }}
      >
        {selected && <IconCheck size={10} color="white" />}
      </div>

      {/* Thumbnail */}
      {item.thumbnail ? (
        <img
          src={item.thumbnail}
          alt=""
          style={{ width: 62, height: 38, objectFit: "cover", borderRadius: 5, border: "1px solid var(--border)", flexShrink: 0 }}
          onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div style={{ width: 62, height: 38, borderRadius: 5, background: "var(--bg-surface2)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <TypeIcon type={item.type} />
        </div>
      )}

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.title}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 3, fontSize: 11, color: "var(--text-muted)", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <TypeIcon type={item.type} />
            <span style={{ color: TYPE_COLORS[item.type] ?? "var(--text-muted)", fontWeight: 500 }}>
              {item.type}
            </span>
          </span>
          {item.duration !== "—" && (
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <IconClock size={11} />{item.duration}
            </span>
          )}
          {item.file_size_label && <span>{item.file_size_label}</span>}
          {item.channel && <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>{item.channel}</span>}
          <span>{item.date}</span>
          {item.category && (
            <span style={{ background: "var(--bg-active)", color: "var(--text-accent)", padding: "1px 7px", borderRadius: 10, fontSize: 10, fontWeight: 500 }}>
              {item.category}
            </span>
          )}
          {item.tags && item.tags.split(",").filter(Boolean).map(t => (
            <span key={t} style={{ background: "var(--bg-overlay)", color: "var(--text-secondary)", padding: "1px 6px", borderRadius: 10, fontSize: 10 }}>
              #{t.trim()}
            </span>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 5 }} onClick={e => e.stopPropagation()}>
        <button className="btn-icon" style={{ width: 28, height: 28 }} title="Edit tags" onClick={() => onEdit(item)}>
          <IconFilter size={12} />
        </button>
        <button className="btn-icon" style={{ width: 28, height: 28 }} title="Open file location" onClick={() => onOpen(item)}>
          <IconFolder size={13} />
        </button>
        <button className="btn-icon" style={{ width: 28, height: 28, color: "var(--text-danger)" }} title="Delete" onClick={() => onDelete(item.id)}>
          <IconTrash size={13} />
        </button>
      </div>

      {item.status === "done" && (
        <div style={{ color: "var(--text-success)", flexShrink: 0 }}>
          <IconCheck size={13} />
        </div>
      )}
    </div>
  );
}

// ─── Grid card ────────────────────────────────────────────────────────────────
function LibGridItem({
  item, selected, onSelect, onDelete,
}: {
  item: LibItem;
  selected: boolean;
  onSelect: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className="card"
      style={{ overflow: "hidden", cursor: "pointer", outline: selected ? "2px solid var(--accent)" : "none" }}
      onClick={onSelect}
    >
      <div style={{ position: "relative" }}>
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt=""
            style={{ width: "100%", height: 100, objectFit: "cover" }}
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div style={{ width: "100%", height: 100, background: "var(--bg-surface2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <TypeIcon type={item.type} />
          </div>
        )}
        <div style={{ position: "absolute", top: 5, right: 5, background: "rgba(0,0,0,0.72)", color: "white", fontSize: 10, padding: "2px 6px", borderRadius: 4, fontFamily: "var(--font-mono)" }}>
          {item.duration}
        </div>
        <div style={{ position: "absolute", top: 5, left: 5 }}><TypeIcon type={item.type} /></div>
        {selected && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(138,180,248,0.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IconCheck size={22} color="var(--accent)" />
          </div>
        )}
        <button
          className="btn-icon"
          style={{ position: "absolute", bottom: 5, right: 5, width: 24, height: 24, background: "rgba(0,0,0,0.65)", color: "var(--text-danger)", borderRadius: 5 }}
          title="Delete"
          onClick={e => { e.stopPropagation(); onDelete(item.id); }}
        >
          <IconTrash size={11} />
        </button>
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          {item.file_size_label || "—"} · {item.date}
        </div>
      </div>
    </div>
  );
}

// ─── Tags / Category modal ────────────────────────────────────────────────────
function TagsModal({
  item, onSave, onClose,
}: {
  item: LibItem;
  onSave: (item: LibItem, tags: string, category: string) => void;
  onClose: () => void;
}) {
  const [tags, setTags]         = useState(item.tags);
  const [category, setCategory] = useState(item.category);

  const CATEGORIES = ["", "Music", "Tutorials", "Gaming", "Movies", "Anime", "Podcasts", "Sports", "Other"];

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg-surface)", borderRadius: 14, padding: "24px 28px",
          width: 360, boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Edit Tags</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.title}
        </div>

        <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Category</label>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="input-base"
          style={{ marginBottom: 14, width: "100%" }}
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{c || "None"}</option>)}
        </select>

        <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>
          Tags <span style={{ color: "var(--text-muted)" }}>(comma-separated)</span>
        </label>
        <input
          className="input-base"
          style={{ width: "100%", marginBottom: 18 }}
          placeholder="e.g. lo-fi, study, chill"
          value={tags}
          onChange={e => setTags(e.target.value)}
        />

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(item, tags, category)}>Save</button>
        </div>
      </div>
    </div>
  );
}
