/**
 * NotificationBell.tsx — Phase 6
 * Bell icon with unread badge + dropdown of new episode notifications.
 */

import { useState, useRef, useEffect } from "react";
import { useNotifications, type Notification } from "../../hooks/useNotifications";

const TMDB_IMAGE = "https://image.tmdb.org/t/p/w92";

export function NotificationBell() {
  const { notifications, unreadCount, markAllRead, clearAll, checking } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = () => {
    setOpen(o => !o);
    if (!open && unreadCount > 0) markAllRead();
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={handleOpen}
        title="Notifications"
        style={{
          width: "100%", background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
          borderRadius: 8, color: "var(--text-secondary)", fontFamily: "var(--font)",
          transition: "background 0.12s",
          position: "relative",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={e => (e.currentTarget.style.background = "none")}
      >
        <span style={{ fontSize: 16, position: "relative" }}>
          🔔
          {unreadCount > 0 && (
            <span style={{
              position: "absolute", top: -4, right: -6,
              background: "#ef4444", color: "#fff", borderRadius: "50%",
              fontSize: 9, fontWeight: 800, width: 14, height: 14,
              display: "flex", alignItems: "center", justifyContent: "center",
              lineHeight: 1, border: "2px solid var(--bg-sidebar)",
            }}>
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </span>
        <span style={{ fontSize: 12, fontWeight: 500, flex: 1, textAlign: "left" }}>Notifications</span>
        {checking && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>●</span>}
      </button>

      {open && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 4px)", left: 0, right: 0,
          background: "var(--bg-surface)", border: "1px solid var(--border)",
          borderRadius: 12, boxShadow: "var(--shadow-lg)", zIndex: 999,
          maxHeight: 360, display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>New Episodes</span>
            {notifications.length > 0 && (
              <button onClick={clearAll} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font)" }}>
                Clear all
              </button>
            )}
          </div>

          {/* Notification list */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {notifications.length === 0 ? (
              <div style={{ padding: "24px 14px", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🔕</div>
                No new episodes yet.
                <br />
                <span style={{ fontSize: 11 }}>Add shows to Favorites to track them.</span>
              </div>
            ) : (
              notifications.map(n => (
                <NotifRow key={n.id} notif={n} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotifRow({ notif }: { notif: Notification }) {
  const isNew = !notif.seenAt;
  const timeAgo = formatTimeAgo(notif.createdAt);

  return (
    <div style={{
      display: "flex", gap: 10, padding: "10px 14px",
      borderBottom: "1px solid var(--border)",
      background: isNew ? "var(--bg-active)" : "transparent",
      transition: "background 0.1s",
    }}>
      {notif.poster ? (
        <img
          src={notif.poster.startsWith("http") ? notif.poster : `${TMDB_IMAGE}${notif.poster}`}
          alt=""
          style={{ width: 36, height: 54, objectFit: "cover", borderRadius: 5, flexShrink: 0 }}
        />
      ) : (
        <div style={{ width: 36, height: 54, background: "var(--bg-surface2)", borderRadius: 5, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
          📺
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {isNew && <span style={{ color: "var(--accent)", marginRight: 4 }}>●</span>}
          {notif.showTitle}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.45 }}>{notif.message}</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>{timeAgo}</div>
      </div>
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
