/**
 * ProfileSwitcher.tsx — Phase 6
 * Compact profile panel for the Sidebar bottom area.
 * Shows current profile avatar + name, expands to switch/add profiles.
 */

import { useState } from "react";
import { useProfile, AVATAR_COLORS } from "../../context/ProfileContext";

export function ProfileSwitcher() {
  const { profiles, activeProfile, switchProfile, addProfile, removeProfile } = useProfile();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(AVATAR_COLORS[1]);
  const [newIsKids, setNewIsKids] = useState(false);

  const handleAdd = () => {
    if (!newName.trim()) return;
    addProfile(newName.trim(), newColor, newIsKids);
    setNewName(""); setNewColor(AVATAR_COLORS[1]); setNewIsKids(false);
    setAdding(false);
  };

  return (
    <div style={{ position: "relative" }}>
      {/* Current profile pill */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
          borderRadius: 8, cursor: "pointer", userSelect: "none",
          background: open ? "var(--bg-active)" : "transparent",
          transition: "background 0.15s",
        }}
      >
        <Avatar name={activeProfile.name} color={activeProfile.color} size={26} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {activeProfile.name}
          {activeProfile.isKids && <span style={{ marginLeft: 4, fontSize: 10, color: "var(--text-muted)" }}>👶</span>}
        </span>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{open ? "▲" : "▼"}</span>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 4px)", left: 0, right: 0,
          background: "var(--bg-surface)", border: "1px solid var(--border)",
          borderRadius: 10, boxShadow: "var(--shadow-lg)", zIndex: 999, overflow: "hidden",
        }}>
          <div style={{ padding: "6px 4px" }}>
            {profiles.map(p => (
              <div
                key={p.id}
                onClick={() => { switchProfile(p.id); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 10px", borderRadius: 7, cursor: "pointer",
                  background: p.id === activeProfile.id ? "var(--bg-active)" : "transparent",
                  transition: "background 0.12s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = p.id === activeProfile.id ? "var(--bg-active)" : "var(--bg-hover)")}
                onMouseLeave={e => (e.currentTarget.style.background = p.id === activeProfile.id ? "var(--bg-active)" : "transparent")}
              >
                <Avatar name={p.name} color={p.color} size={22} />
                <span style={{ fontSize: 12, flex: 1, fontWeight: p.id === activeProfile.id ? 700 : 400, color: "var(--text-primary)" }}>
                  {p.name} {p.isKids ? "👶" : ""}
                </span>
                {p.id !== "default" && (
                  <button
                    onClick={e => { e.stopPropagation(); removeProfile(p.id); }}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--text-muted)", padding: "0 2px", lineHeight: 1 }}
                    title="Remove profile"
                  >✕</button>
                )}
              </div>
            ))}
          </div>

          {/* Add profile */}
          {profiles.length < 5 && (
            <div style={{ borderTop: "1px solid var(--border)", padding: "8px 10px" }}>
              {!adding ? (
                <button
                  onClick={() => setAdding(true)}
                  style={{ width: "100%", background: "none", border: "1px dashed var(--border)", borderRadius: 7, padding: "6px 10px", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", fontFamily: "var(--font)" }}
                >
                  + Add Profile
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <input
                    value={newName} onChange={e => setNewName(e.target.value)}
                    placeholder="Profile name" autoFocus
                    onKeyDown={e => e.key === "Enter" && handleAdd()}
                    style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", color: "var(--text-primary)", fontSize: 12, fontFamily: "var(--font)", outline: "none" }}
                  />
                  <div style={{ display: "flex", gap: 4 }}>
                    {AVATAR_COLORS.map(c => (
                      <button key={c} onClick={() => setNewColor(c)}
                        style={{ width: 18, height: 18, borderRadius: "50%", background: c, border: c === newColor ? "2px solid white" : "2px solid transparent", cursor: "pointer" }} />
                    ))}
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}>
                    <input type="checkbox" checked={newIsKids} onChange={e => setNewIsKids(e.target.checked)} />
                    Kids profile
                  </label>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={handleAdd} style={{ flex: 1, background: "var(--accent)", border: "none", borderRadius: 6, padding: "5px", color: "var(--text-on-accent)", fontSize: 11, cursor: "pointer", fontFamily: "var(--font)" }}>Create</button>
                    <button onClick={() => setAdding(false)} style={{ flex: 1, background: "var(--bg-surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px", color: "var(--text-secondary)", fontSize: 11, cursor: "pointer", fontFamily: "var(--font)" }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Avatar({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: color,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontWeight: 700, fontSize: size * 0.42, flexShrink: 0, userSelect: "none",
    }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
