import React, { useState } from "react";
import Topbar from "../components/Topbar";
import { libraryItems } from "../data/mock";

interface Props { theme: string; onToggleTheme: () => void; }

export default function LibraryPage({ theme, onToggleTheme }: Props) {
  const [view, setView]     = useState<"grid"|"list">("grid");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [sort, setSort]     = useState("Date");

  const filtered = libraryItems
    .filter((i) => filter === "All" || i.type === filter)
    .filter((i) => i.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Media Library" theme={theme} onToggleTheme={onToggleTheme} />
      <div className="flex-1 overflow-y-auto p-8">

        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg flex-1" style={{ background: "var(--surface)", border: "1px solid var(--border)", minWidth: "160px" }}>
            <span style={{ color: "var(--text3)" }}>⌕</span>
            <input
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: "var(--text)" }}
              placeholder="Search library..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {["All","Video","Audio"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className="px-3 py-1.5 rounded-full text-xs font-medium" style={{ background: filter === f ? "var(--accent)" : "var(--surface)", color: filter === f ? "#fff" : "var(--text2)", border: filter === f ? "none" : "1px solid var(--border)" }}>{f}</button>
          ))}
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="px-3 py-1.5 rounded-lg text-xs outline-none" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}>
            {["Date","Name","Size"].map((s) => <option key={s}>{s}</option>)}
          </select>
          <div className="flex gap-1 p-1 rounded-lg" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            {(["grid","list"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className="w-7 h-7 rounded-md flex items-center justify-center text-sm" style={{ background: view === v ? "var(--accent)" : "transparent", color: view === v ? "#fff" : "var(--text2)" }}>
                {v === "grid" ? "⊞" : "☰"}
              </button>
            ))}
          </div>
        </div>

        {/* Storage bar */}
        <div className="flex items-center gap-4 p-4 rounded-xl mb-6" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <span style={{ color: "var(--text3)" }}>◉</span>
          <div className="flex-1">
            <div className="flex justify-between text-xs mb-1.5">
              <span style={{ color: "var(--text2)" }}>Storage used</span>
              <span className="font-medium" style={{ color: "var(--text)" }}>38.4 GB / 500 GB</span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--surface2)" }}>
              <div className="h-full rounded-full" style={{ width: "7.6%", background: "var(--accent)" }} />
            </div>
          </div>
        </div>

        {/* Grid view */}
        {view === "grid" && (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))" }}>
            {filtered.map((item) => (
              <div key={item.id} className="rounded-xl overflow-hidden cursor-pointer group" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div className="h-28 overflow-hidden" style={{ background: "var(--surface2)" }}>
                  <img src={item.thumb} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                </div>
                <div className="p-3">
                  <div className="text-xs font-medium truncate" style={{ color: "var(--text)" }}>{item.title}</div>
                  <div className="text-xs mt-1" style={{ color: "var(--text3)" }}>{item.type} · {item.size}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* List view */}
        {view === "list" && (
          <div>
            {filtered.map((item) => (
              <div key={item.id} className="flex items-center gap-4 px-4 py-3 rounded-xl mb-2 cursor-pointer" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div className="flex-shrink-0 rounded-lg overflow-hidden" style={{ width: "52px", height: "34px", background: "var(--surface2)" }}>
                  <img src={item.thumb} alt={item.title} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: "var(--text)" }}>{item.title}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text3)" }}>{item.type} · {item.size} · {item.date}</div>
                </div>
                <button className="text-sm opacity-40 hover:opacity-100" style={{ color: "var(--text2)" }}>🗑</button>
              </div>
            ))}
          </div>
        )}

        {filtered.length === 0 && (
          <div className="text-center mt-16 text-sm" style={{ color: "var(--text3)" }}>No files found.</div>
        )}
      </div>
    </div>
  );
}
