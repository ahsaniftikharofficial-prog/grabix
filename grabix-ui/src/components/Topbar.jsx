import React from 'react'
import { Search, Bell, Sun, Moon } from 'lucide-react'

export default function Topbar({ title, theme, onToggleTheme }) {
  return (
    <div className="topbar">
      <div className="topbar-title">{title}</div>
      <div className="topbar-search">
        <Search size={14} style={{ color: 'var(--text3)', flexShrink: 0 }} />
        <input placeholder="Search anything..." />
      </div>
      <button className="icon-btn" onClick={onToggleTheme} title="Toggle theme">
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <button className="icon-btn">
        <Bell size={16} />
      </button>
      <div className="avatar">A</div>
    </div>
  )
}
