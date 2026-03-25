import React, { useState } from "react";

type Page = "home" | "downloader" | "queue" | "library" | "anime" | "movies" | "settings";

interface Props {
  active: Page;
  onNav: (page: Page) => void;
}

const navItems: { id: Page; icon: string; label: string }[] = [
  { id: "home",       icon: "⌂",  label: "Home" },
  { id: "downloader", icon: "↓",  label: "Downloader" },
  { id: "queue",      icon: "≡",  label: "Queue" },
  { id: "library",    icon: "▣",  label: "Library" },
  { id: "anime",      icon: "⛩",  label: "Anime & Manga" },
  { id: "movies",     icon: "▶",  label: "Movies" },
];

export default function Sidebar({ active, onNav }: Props) {
  const [open, setOpen] = useState(false);

  const itemBase = `
    flex items-center gap-3 w-full px-3.5 py-2.5 text-left
    border-l-2 transition-all duration-150 cursor-pointer
    text-sm whitespace-nowrap overflow-hidden
  `;

  return (
    <aside
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      style={{
        width: open ? "220px" : "56px",
        transition: "width 0.22s cubic-bezier(0.4,0,0.2,1)",
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        zIndex: 20,
      }}
    >
      {/* Logo */}
      <div
        style={{ borderBottom: "1px solid var(--border)" }}
        className="flex items-center gap-2.5 px-3.5 h-14 overflow-hidden"
      >
        <div
          style={{ background: "var(--accent)", flexShrink: 0 }}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-sm"
        >
          G
        </div>
        <span
          style={{
            fontWeight: 800,
            letterSpacing: "0.06em",
            color: "var(--text)",
            opacity: open ? 1 : 0,
            transition: "opacity 0.15s",
            fontSize: "15px",
          }}
        >
          GRABIX
        </span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-2">
        {navItems.map(({ id, icon, label }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => onNav(id)}
              className={itemBase}
              style={{
                borderLeftColor: isActive ? "var(--accent)" : "transparent",
                background: isActive ? "var(--accent-bg)" : "transparent",
                color: isActive ? "var(--accent)" : "var(--text2)",
              }}
            >
              <span style={{ fontSize: "16px", flexShrink: 0, width: "20px", textAlign: "center" }}>
                {icon}
              </span>
              <span
                style={{
                  opacity: open ? 1 : 0,
                  transition: "opacity 0.12s",
                  fontWeight: isActive ? 500 : 400,
                  color: isActive ? "var(--accent)" : "var(--text2)",
                }}
              >
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Settings at bottom */}
      <div style={{ borderTop: "1px solid var(--border)" }} className="py-2">
        <button
          onClick={() => onNav("settings")}
          className={itemBase}
          style={{
            borderLeftColor: active === "settings" ? "var(--accent)" : "transparent",
            background: active === "settings" ? "var(--accent-bg)" : "transparent",
            color: active === "settings" ? "var(--accent)" : "var(--text2)",
          }}
        >
          <span style={{ fontSize: "16px", flexShrink: 0, width: "20px", textAlign: "center" }}>⚙</span>
          <span style={{ opacity: open ? 1 : 0, transition: "opacity 0.12s" }}>Settings</span>
        </button>
      </div>
    </aside>
  );
}
