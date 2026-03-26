import { useState } from "react";
import {
  IconSearch, IconFilter, IconGrid, IconList,
  IconFolder, IconTrash, IconVideo, IconAudio, IconImage,
  IconClock, IconCheck,
} from "../components/Icons";

interface LibItem {
  id: string; title: string; thumbnail: string;
  type: "video" | "audio" | "thumbnail";
  size: string; date: string; duration: string;
}

const DEMO: LibItem[] = [
  { id: "1", title: "One Piece Episode 1074 – Luffy Gear 5", thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg", type: "video", size: "1.2 GB", date: "Today", duration: "23:40" },
  { id: "2", title: "Oda Rare Interview 2022", thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg", type: "video", size: "340 MB", date: "Yesterday", duration: "14:32" },
  { id: "3", title: "Binks Sake – Full OST", thumbnail: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg", type: "audio", size: "8 MB", date: "2 days ago", duration: "3:20" },
];

export default function LibraryPage() {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("list");
  const [filter, setFilter] = useState<"all" | "video" | "audio" | "thumbnail">("all");

  const filtered = DEMO.filter(i =>
    (filter === "all" || i.type === filter) &&
    i.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Topbar */}
      <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Library</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>{DEMO.length} downloaded files</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-icon" title="Open downloads folder"><IconFolder size={16} /></button>
          <button className={`btn-icon${view === "grid" ? " active" : ""}`} onClick={() => setView("grid")} title="Grid view"><IconGrid size={16} /></button>
          <button className={`btn-icon${view === "list" ? " active" : ""}`} onClick={() => setView("list")} title="List view"><IconList size={16} /></button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {/* Search + filter */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>
              <IconSearch size={14} color="var(--text-muted)" />
            </div>
            <input className="input-base" style={{ paddingLeft: 38 }} placeholder="Search your library..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-ghost" style={{ gap: 6 }}><IconFilter size={14} /> Filter</button>
        </div>

        {/* Type filter chips */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {(["all","video","audio","thumbnail"] as const).map(f => (
            <button key={f} className={`quality-chip${filter === f ? " active" : ""}`} onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state"><IconFolder size={40} /><p>No files found</p><span>Your downloads will appear here</span></div>
        ) : view === "list" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filtered.map(item => <LibListItem key={item.id} item={item} />)}
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

function LibListItem({ item }: { item: LibItem }) {
  return (
    <div className="card" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
      <img src={item.thumbnail} alt="" style={{ width: 64, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
        <div style={{ display: "flex", gap: 10, marginTop: 3, fontSize: 11, color: "var(--text-muted)", alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}><TypeIcon type={item.type} />{item.type}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}><IconClock size={11} />{item.duration}</span>
          <span>{item.size}</span>
          <span>{item.date}</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <div className="tooltip-wrap">
          <button className="btn-icon" style={{ width: 28, height: 28 }} title="Open file"><IconFolder size={13} /></button>
          <span className="tooltip-box">Open file</span>
        </div>
        <div className="tooltip-wrap">
          <button className="btn-icon" style={{ width: 28, height: 28, color: "var(--text-danger)" }} title="Delete"><IconTrash size={13} /></button>
          <span className="tooltip-box">Delete</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-success)", fontSize: 12 }}>
        <IconCheck size={13} />
      </div>
    </div>
  );
}

function LibGridItem({ item }: { item: LibItem }) {
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ position: "relative" }}>
        <img src={item.thumbnail} alt="" style={{ width: "100%", height: 100, objectFit: "cover" }} />
        <div style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.7)", color: "white", fontSize: 10, padding: "2px 6px", borderRadius: 4, fontFamily: "var(--font-mono)" }}>{item.duration}</div>
        <div style={{ position: "absolute", top: 6, left: 6 }}><TypeIcon type={item.type} /></div>
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{item.size} · {item.date}</div>
      </div>
    </div>
  );
}
