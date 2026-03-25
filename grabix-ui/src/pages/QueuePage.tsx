import React, { useState } from "react";
import Topbar from "../components/Topbar";
import { queueItems as initial, QueueItem } from "../data/mock";

interface Props { theme: string; onToggleTheme: () => void; }

const tabs = ["All", "Active", "Done", "Failed"] as const;

export default function QueuePage({ theme, onToggleTheme }: Props) {
  const [items, setItems] = useState<QueueItem[]>(initial);
  const [tab, setTab] = useState<string>("All");

  const filtered = items.filter((i) => {
    if (tab === "Active") return i.status === "downloading" || i.status === "paused";
    if (tab === "Done") return i.status === "done";
    if (tab === "Failed") return i.status === "failed";
    return true;
  });

  const toggle = (id: number) =>
    setItems((p) => p.map((i) => i.id === id ? { ...i, status: i.status === "downloading" ? "paused" : "downloading" as any } : i));
  const remove = (id: number) => setItems((p) => p.filter((i) => i.id !== id));
  const retry  = (id: number) => setItems((p) => p.map((i) => i.id === id ? { ...i, status: "downloading" as any, progress: 0 } : i));

  const statusColor = (s: string) =>
    s === "done" ? "var(--green)" : s === "failed" ? "var(--red)" : s === "paused" ? "var(--text3)" : "var(--accent)";

  const statusLabel = (i: QueueItem) => {
    if (i.status === "downloading") return `${i.speed} · ETA ${i.eta}`;
    if (i.status === "done") return "Complete";
    if (i.status === "paused") return "Paused";
    return "Failed";
  };

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Downloads Queue" theme={theme} onToggleTheme={onToggleTheme} />
      <div className="flex-1 overflow-y-auto p-8">

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-6">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                background: tab === t ? "var(--accent)" : "var(--surface)",
                color: tab === t ? "#fff" : "var(--text2)",
                border: tab === t ? "none" : "1px solid var(--border)",
              }}
            >{t}</button>
          ))}
          <button
            onClick={() => setItems((p) => p.filter((i) => i.status !== "done"))}
            className="ml-auto text-xs px-3 py-1.5 rounded-full"
            style={{ color: "var(--text3)", border: "1px solid var(--border)" }}
          >Clear done</button>
        </div>

        {/* Items */}
        {filtered.length === 0 && (
          <div className="text-center mt-16 text-sm" style={{ color: "var(--text3)" }}>Nothing here.</div>
        )}

        {filtered.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-4 p-4 rounded-xl mb-3"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <div className="flex-shrink-0 w-18 h-12 rounded-lg overflow-hidden" style={{ width: "72px", height: "46px", background: "var(--surface2)" }}>
              <img src={item.thumb} alt={item.title} className="w-full h-full object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate mb-1" style={{ color: "var(--text)" }}>{item.title}</div>
              <div className="text-xs flex items-center gap-1.5" style={{ color: statusColor(item.status) }}>
                <span>{item.status === "downloading" ? "●" : item.status === "done" ? "✓" : item.status === "failed" ? "✗" : "⏸"}</span>
                <span>{item.format}</span>
                <span style={{ color: "var(--text3)" }}>·</span>
                <span>{statusLabel(item)}</span>
              </div>
              {(item.status === "downloading" || item.status === "paused" || item.status === "done") && (
                <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: "var(--surface2)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${item.progress}%`,
                      background: item.status === "done" ? "var(--green)" : "var(--accent)",
                    }}
                  />
                </div>
              )}
            </div>
            <div className="flex gap-1 flex-shrink-0">
              {(item.status === "downloading" || item.status === "paused") && (
                <button
                  onClick={() => toggle(item.id)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
                  style={{ background: "var(--surface2)", color: "var(--text2)" }}
                >{item.status === "downloading" ? "⏸" : "▶"}</button>
              )}
              {item.status === "failed" && (
                <button
                  onClick={() => retry(item.id)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
                  style={{ background: "var(--surface2)", color: "var(--text2)" }}
                >↺</button>
              )}
              <button
                onClick={() => remove(item.id)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
                style={{ background: "var(--surface2)", color: "var(--text3)" }}
              >✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
