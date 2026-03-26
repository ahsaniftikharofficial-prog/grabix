import { useState } from "react";
import {
  IconPlay, IconPause, IconStop, IconRefresh,
  IconFolder, IconInfo, IconClock, IconCheck,
  IconAlert, IconX,
} from "../components/Icons";
import { type QueueItem } from "../types/queue";

const API = "http://127.0.0.1:8000";

const TABS = ["All", "Active", "Done", "Failed"] as const;
type Tab = typeof TABS[number];

interface Props {
  queue: QueueItem[];
  setQueue: React.Dispatch<React.SetStateAction<QueueItem[]>>;
}

const STATUS_COLOR: Record<string, string> = {
  done: "var(--success)", failed: "var(--danger)", error: "var(--danger)",
  canceled: "var(--text-muted)", downloading: "var(--accent)",
  processing: "var(--warning)", queued: "var(--text-muted)", paused: "var(--warning)",
  canceling: "var(--text-muted)",
};

const STATUS_LABEL: Record<string, string> = {
  done: "Done", failed: "Failed", error: "Failed", canceled: "Canceled",
  downloading: "Downloading", processing: "Processing…",
  queued: "Queued", paused: "Paused", canceling: "Canceling…",
};

function QueueCard({
  item, onRemove, onAction, onReveal,
}: {
  item: QueueItem;
  onRemove: (id: string) => void;
  onAction: (item: QueueItem, action: string) => void;
  onReveal: (item: QueueItem) => void;
}) {
  const [showProps, setShowProps] = useState(false);

  const isActive = item.status === "downloading" || item.status === "queued" || item.status === "processing";
  const isPaused = item.status === "paused";
  const isDone   = item.status === "done";
  const isFailed = item.status === "failed" || item.status === "error" || item.status === "canceled";
  const cleanSpeed = item.speed.replace(/\x1b\[[0-9;]*m/g, "").replace(/\u001b\[[0-9;]*m/g, "").trim();

  return (
    <div className="card fade-in" style={{ padding: "12px 14px", marginBottom: 10 }}>

      {/* Row 1: thumbnail + title + action buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <img
          src={item.thumbnail}
          alt=""
          style={{ width: 48, height: 32, objectFit: "cover", borderRadius: 5, flexShrink: 0, border: "1px solid var(--border)" }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {item.title || item.url}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
            <span style={{ fontSize: 11, color: STATUS_COLOR[item.status] ?? "var(--text-muted)", fontWeight: 600 }}>
              {STATUS_LABEL[item.status] ?? item.status}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.format.toUpperCase()}</span>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
          {isActive && item.status === "downloading" && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onAction(item, "pause")}>
                <IconPause size={13} />
              </button>
              <span className="tooltip-box">Pause</span>
            </div>
          )}
          {isPaused && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onAction(item, "resume")}>
                <IconPlay size={13} />
              </button>
              <span className="tooltip-box">Resume</span>
            </div>
          )}
          {(isActive || isPaused) && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28, color: "var(--text-danger)" }} onClick={() => onAction(item, "cancel")}>
                <IconStop size={13} />
              </button>
              <span className="tooltip-box">Cancel</span>
            </div>
          )}
          {isFailed && item.serverId && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onAction(item, "retry")}>
                <IconRefresh size={13} />
              </button>
              <span className="tooltip-box">Retry</span>
            </div>
          )}
          {isDone && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onReveal(item)}>
                <IconFolder size={13} />
              </button>
              <span className="tooltip-box">Reveal in Explorer</span>
            </div>
          )}
          {(isDone || isFailed) && (
            <div className="tooltip-wrap">
              <button className={`btn-icon${showProps ? " active" : ""}`} style={{ width: 28, height: 28 }} onClick={() => setShowProps(v => !v)}>
                <IconInfo size={13} />
              </button>
              <span className="tooltip-box">Properties</span>
            </div>
          )}
          <div className="tooltip-wrap">
            <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onRemove(item.id)}>
              <IconX size={13} />
            </button>
            <span className="tooltip-box">Remove</span>
          </div>
        </div>
      </div>

      {/* Row 2: progress bar + stats */}
      {(isActive || isPaused) && (
        <div style={{ marginTop: 10 }}>
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{ width: `${item.percent}%`, opacity: isPaused ? 0.5 : 1 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 0, marginTop: 6 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, color: "var(--text-accent)",
              background: "var(--accent-light)", padding: "2px 7px", borderRadius: 99, marginRight: 8,
            }}>
              {item.percent}%
            </span>
            {item.downloaded && (
              <span style={{ fontSize: 11, color: "var(--text-secondary)", marginRight: 6 }}>
                {item.downloaded}{item.total ? ` / ${item.total}` : ""}
              </span>
            )}
            {cleanSpeed && (
              <span style={{
                fontSize: 11, fontWeight: 600, color: "var(--text-primary)",
                background: "var(--bg-surface2)", padding: "1px 6px", borderRadius: 5, marginRight: 6,
              }}>
                ↓ {cleanSpeed}
              </span>
            )}
            {item.eta && item.eta !== "0s" && (
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto", display: "flex", alignItems: "center", gap: 3 }}>
                <IconClock size={11} /> {item.eta}
              </span>
            )}
          </div>
          {item.filePath && (
            <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.filePath}
            </div>
          )}
        </div>
      )}

      {/* Done summary */}
      {isDone && (
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-success)" }}>
          <IconCheck size={12} />
          <span>Download complete</span>
          {item.total && <span style={{ color: "var(--text-muted)" }}>· {item.total}</span>}
        </div>
      )}

      {/* Error message */}
      {(item.status === "error" || item.status === "failed") && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-danger)", display: "flex", alignItems: "center", gap: 5 }}>
          <IconAlert size={13} /> {item.error || "Download failed. Try again."}
        </div>
      )}

      {/* Properties panel */}
      {showProps && (
        <div style={{
          marginTop: 10, padding: "10px 12px",
          background: "var(--bg-surface2)", borderRadius: "var(--radius-sm)",
          fontSize: 11, color: "var(--text-secondary)",
          display: "flex", flexDirection: "column", gap: 5,
        }}>
          {[
            ["Type",   item.fileType.charAt(0).toUpperCase() + item.fileType.slice(1)],
            ["Format", item.format.toUpperCase()],
            ["Status", STATUS_LABEL[item.status] ?? item.status],
            ["Size",   item.total || "—"],
            ["Path",   item.filePath || "—"],
            ["URL",    item.url || "—"],
          ].map(([label, value]) => (
            <div key={label} style={{ display: "flex", gap: 0 }}>
              <span style={{ color: "var(--text-muted)", minWidth: 54, flexShrink: 0 }}>{label}</span>
              <span style={{ wordBreak: "break-all", color: "var(--text-primary)" }}>{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function QueuePage({ queue, setQueue }: Props) {
  const [tab, setTab] = useState<Tab>("All");

  const tabCount = (t: Tab) => queue.filter(item => {
    if (t === "Active") return ["downloading", "queued", "processing", "paused"].includes(item.status);
    if (t === "Done")   return item.status === "done";
    if (t === "Failed") return ["failed", "error", "canceled"].includes(item.status);
    return true;
  }).length;

  const filtered = queue.filter(item => {
    if (tab === "Active") return ["downloading", "queued", "processing", "paused"].includes(item.status);
    if (tab === "Done")   return item.status === "done";
    if (tab === "Failed") return ["failed", "error", "canceled"].includes(item.status);
    return true;
  });

  const activeCount = queue.filter(
    q => q.status === "downloading" || q.status === "queued" || q.status === "processing"
  ).length;

  const removeFromQueue = (id: string) => {
    setQueue(prev => prev.filter(q => q.id !== id));
  };

  const clearDone = () => {
    setQueue(prev => prev.filter(q => q.status !== "done"));
  };

  const doAction = async (item: QueueItem, action: string) => {
    if (!item.serverId) return;
    try {
      const res = await fetch(`${API}/downloads/${item.serverId}/action?action=${action}`, { method: "POST" });
      const data = await res.json();
      // Optimistically update status from backend response
      setQueue(prev => prev.map(q => q.id === item.id
        ? { ...q, status: data.status ?? q.status }
        : q
      ));
    } catch { /* backend offline */ }
  };

  const doReveal = async (item: QueueItem) => {
    try {
      await fetch(`${API}/open-download-folder?path=${encodeURIComponent(item.filePath || "")}`, { method: "POST" });
    } catch { /* offline */ }
  };

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
          <div style={{ fontSize: 16, fontWeight: 600 }}>Queue</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>
            {activeCount > 0
              ? `${activeCount} active download${activeCount > 1 ? "s" : ""}`
              : queue.length === 0
                ? "No downloads yet — go to Downloader to start"
                : `${queue.length} total`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {queue.some(q => q.status === "done") && (
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={clearDone}>
              Clear done
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ padding: "0 24px", display: "flex", gap: 2, borderBottom: "1px solid var(--border)", background: "var(--bg-surface)" }}>
        {TABS.map(t => {
          const count = tabCount(t);
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "10px 16px",
                fontSize: 12,
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
                background: "transparent",
                color: tab === t ? "var(--text-primary)" : "var(--text-muted)",
                borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
                transition: "all 0.15s",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              {t}
              {count > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  background: tab === t ? "var(--accent-light)" : "var(--bg-surface2)",
                  color: tab === t ? "var(--text-accent)" : "var(--text-muted)",
                  padding: "1px 6px", borderRadius: 99,
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", marginTop: 60, color: "var(--text-muted)", fontSize: 14 }}>
            {tab === "All"
              ? "No downloads yet. Go to Downloader to start one."
              : `No ${tab.toLowerCase()} downloads.`}
          </div>
        ) : (
          filtered.map(item => (
            <QueueCard
              key={item.id}
              item={item}
              onRemove={removeFromQueue}
              onAction={doAction}
              onReveal={doReveal}
            />
          ))
        )}
      </div>
    </div>
  );
}
