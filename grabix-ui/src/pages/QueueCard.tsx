// grabix-ui/src/pages/QueueCard.tsx
// Individual download-queue card. Self-contained; receives item + callbacks from DownloaderPage.

import { useState } from "react";
import {
  IconRefresh, IconPlay, IconPause, IconStop, IconFolder, IconInfo,
  IconX, IconCheck, IconAlert, IconClock,
} from "../components/Icons";
import { QueueItem, formatDisplaySpeed, parseDisplayedBytes } from "./downloader.types";

export function QueueCard({
  item, onRemove, onAction, onReveal,
}: {
  item:     QueueItem;
  onRemove: (item: QueueItem) => void | Promise<void>;
  onAction: (item: QueueItem, action: string) => void;
  onReveal: (item: QueueItem) => void;
}) {
  const [showProps, setShowProps] = useState(false);

  const isActive = item.status === "downloading" || item.status === "queued" || item.status === "processing";
  const isPaused = item.status === "paused";
  const isDone   = item.status === "done";
  const isFailed = item.status === "failed" || item.status === "error" || item.status === "canceled";

  const statusColors: Record<string, string> = {
    done: "var(--success)", failed: "var(--danger)", error: "var(--danger)", canceled: "var(--text-muted)",
    downloading: "var(--accent)", processing: "var(--warning)", queued: "var(--text-muted)",
    paused: "var(--warning)", canceling: "var(--text-muted)",
  };
  const statusLabels: Record<string, string> = {
    done: "Done", failed: "Failed", error: "Failed", canceled: "Canceled",
    downloading: "Downloading", processing: "Processing…", queued: "Queued",
    paused: "Paused", canceling: "Canceling…",
  };
  const statusLabel =
    item.status === "paused"  && item.recoverable ? "Paused for recovery" :
    item.status === "failed"  && item.recoverable ? "Needs retry"         :
    (statusLabels[item.status] ?? item.status);

  const cleanSpeed    = formatDisplaySpeed(item.speed);
  const progressMode  = item.progressMode || (item.status === "processing" ? "processing" : item.total ? "determinate" : "activity");
  const hasMergePercent         = progressMode === "processing" && item.percent > 0 && item.percent < 100;
  const showProcessingProgress  = progressMode === "processing" && !hasMergePercent;
  const showDeterminateProgress = progressMode === "determinate" || hasMergePercent;
  const activityBytes           = item.bytesDownloaded || parseDisplayedBytes(item.downloaded || item.size);
  const activityFillPercent     = activityBytes > 0
    ? Math.min(92, Math.max(12, 92 * (1 - Math.exp(-activityBytes / (96 * 1024 * 1024)))))
    : 0;
  const progressLabel = showDeterminateProgress
    ? `${item.percent}%`
    : item.stageLabel || (showProcessingProgress ? "Processing" : item.status === "queued" ? "Queued" : "Downloading");
  const statsSummary = [
    showDeterminateProgress ? progressLabel : item.stageLabel || "",
    cleanSpeed || "",
    item.eta && item.eta !== "0s" ? `${item.eta} remaining` : "",
  ].filter(Boolean).join(" — ");

  return (
    <div className="card fade-in" style={{ padding: "12px 14px" }}>
      {/* Row 1: thumbnail + title + action buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <img
          src={item.thumbnail || "https://via.placeholder.com/96x64?text=DL"}
          onError={(e) => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/96x64?text=DL"; }}
          alt=""
          style={{ width: 48, height: 32, objectFit: "cover", borderRadius: 5, flexShrink: 0, border: "1px solid var(--border)", background: "var(--bg-surface2)" }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
            <span style={{ fontSize: 11, color: statusColors[item.status] ?? "var(--text-muted)", fontWeight: 600 }}>{statusLabel}</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.format.toUpperCase()}</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.downloadEngine === "aria2" ? "aria2" : "Standard"}</span>
          </div>
          {item.engineNote && <div style={{ marginTop: 3, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>{item.engineNote}</div>}
          {statsSummary && (isActive || isPaused) && (
            <div style={{ marginTop: 3, fontSize: 11, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{statsSummary}</div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
          {isActive && item.canPause && item.status !== "queued" && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onAction(item, "pause")}><IconPause size={13} /></button>
              <span className="tooltip-box">Pause</span>
            </div>
          )}
          {isPaused && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onAction(item, "resume")}><IconPlay size={13} /></button>
              <span className="tooltip-box">Resume</span>
            </div>
          )}
          {(isActive || isPaused) && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28, color: "var(--text-danger)" }} onClick={() => onAction(item, "cancel")}><IconStop size={13} /></button>
              <span className="tooltip-box">Stop</span>
            </div>
          )}
          {isFailed && item.serverId && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onAction(item, "retry")}><IconRefresh size={13} /></button>
              <span className="tooltip-box">Retry</span>
            </div>
          )}
          {isDone && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onReveal(item)}><IconFolder size={13} /></button>
              <span className="tooltip-box">Reveal in Explorer</span>
            </div>
          )}
          {(isDone || isFailed) && (
            <div className="tooltip-wrap">
              <button className={`btn-icon${showProps ? " active" : ""}`} style={{ width: 28, height: 28 }} onClick={() => setShowProps((v) => !v)}><IconInfo size={13} /></button>
              <span className="tooltip-box">Properties</span>
            </div>
          )}
          <div className="tooltip-wrap">
            <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => void onRemove(item)}><IconX size={13} /></button>
            <span className="tooltip-box">Remove</span>
          </div>
        </div>
      </div>

      {/* Row 2: progress bar + stats */}
      {(isActive || isPaused) && (
        <div style={{ marginTop: 10 }}>
          <div className="progress-bar-bg">
            <div
              className={`progress-bar-fill${showProcessingProgress ? " indeterminate" : ""}`}
              style={{ width: showDeterminateProgress ? `${item.percent}%` : `${activityFillPercent}%`, opacity: isPaused ? 0.5 : 1 }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 0, marginTop: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-accent)", background: "var(--accent-light)", padding: "2px 7px", borderRadius: 99, marginRight: 8 }}>
              {progressLabel}
            </span>
            {item.downloaded && <span style={{ fontSize: 11, color: "var(--text-secondary)", marginRight: 6 }}>{item.downloaded}{item.total ? ` / ${item.total}` : ""}</span>}
            {cleanSpeed && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", background: "var(--bg-surface2)", padding: "1px 6px", borderRadius: 5, marginRight: 6 }}>↓ {cleanSpeed}</span>}
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
          <IconCheck size={12} /><span>Download complete</span>
          {item.total && <span style={{ color: "var(--text-muted)" }}>· {item.total}</span>}
        </div>
      )}

      {/* Error */}
      {(item.status === "error" || item.status === "failed") && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-danger)", display: "flex", alignItems: "center", gap: 5 }}>
          <IconAlert size={13} /> {item.error || "Download failed. Try again."}
        </div>
      )}
      {item.status === "paused" && item.recoverable && item.error && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-warning)", display: "flex", alignItems: "center", gap: 5 }}>
          <IconAlert size={13} /> {item.error}
        </div>
      )}

      {/* Properties panel */}
      {showProps && (
        <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--bg-surface2)", borderRadius: "var(--radius-sm)", fontSize: 11, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 5 }}>
          {[
            ["Type",    item.fileType.charAt(0).toUpperCase() + item.fileType.slice(1)],
            ["Format",  item.format.toUpperCase()],
            ["Status",  statusLabel],
            ["Recovery", item.recoverable ? "Yes" : "No"],
            ["Retries", String(item.retryCount || 0)],
            ["Size",    item.total || item.size || "—"],
            ["Path",    item.filePath || "—"],
            ["Partial", item.partialFilePath || "—"],
            ["URL",     item.url || "—"],
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
