import React from "react";

interface Props {
  title: string;
  theme: string;
  onToggleTheme: () => void;
}

export default function Topbar({ title, theme, onToggleTheme }: Props) {
  return (
    <div
      className="flex items-center gap-3 px-8 sticky top-0 z-10"
      style={{
        height: "56px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
      }}
    >
      <h1 className="flex-1 font-bold text-lg" style={{ color: "var(--text)" }}>
        {title}
      </h1>

      {/* Search */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", width: "220px" }}
      >
        <span style={{ color: "var(--text3)" }}>⌕</span>
        <input
          placeholder="Search..."
          className="bg-transparent outline-none w-full text-sm"
          style={{ color: "var(--text)" }}
        />
      </div>

      {/* Theme toggle */}
      <button
        onClick={onToggleTheme}
        className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
        style={{ color: "var(--text2)", background: "var(--surface)", border: "1px solid var(--border)" }}
        title="Toggle theme"
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>

      {/* Bell */}
      <button
        className="w-9 h-9 rounded-lg flex items-center justify-center"
        style={{ color: "var(--text2)", background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        🔔
      </button>

      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold cursor-pointer"
        style={{ background: "var(--accent)" }}
      >
        A
      </div>
    </div>
  );
}
