import React, { useState } from 'react'
import { Home, Download, List, FolderOpen, Tv2, Film, Settings, Zap } from 'lucide-react'

const navItems = [
  { id:'home', icon: Home, label:'Home' },
  { id:'downloader', icon: Download, label:'Downloader' },
  { id:'queue', icon: List, label:'Queue' },
  { id:'library', icon: FolderOpen, label:'Library' },
  { id:'anime', icon: Tv2, label:'Anime & Manga' },
  { id:'movies', icon: Film, label:'Movies' },
]

export default function Sidebar({ active, onNav }) {
  const [hovered, setHovered] = useState(false)

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: hovered ? '220px' : '56px',
        transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
        zIndex: 20,
        position: 'relative',
      }}
    >
      {/* Logo */}
      <div style={{
        height: '56px',
        display: 'flex',
        alignItems: 'center',
        padding: '0 14px',
        borderBottom: '1px solid var(--border)',
        gap: '10px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: '28px', height: '28px',
          background: 'var(--accent)',
          borderRadius: '7px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Zap size={15} color="#fff" fill="#fff" />
        </div>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: '16px',
          fontWeight: '800',
          letterSpacing: '.04em',
          whiteSpace: 'nowrap',
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.2s',
          color: 'var(--text)',
        }}>GRABIX</span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 0' }}>
        {navItems.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => onNav(id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              width: '100%',
              padding: '10px 14px',
              background: active === id ? 'var(--accent-glow)' : 'none',
              borderLeft: active === id ? '2px solid var(--accent)' : '2px solid transparent',
              color: active === id ? 'var(--accent)' : 'var(--text2)',
              transition: 'background 0.18s, color 0.18s',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
            onMouseEnter={e => { if (active !== id) e.currentTarget.style.background = 'var(--surface2)' }}
            onMouseLeave={e => { if (active !== id) e.currentTarget.style.background = 'none' }}
          >
            <Icon size={18} style={{ flexShrink: 0 }} />
            <span style={{
              fontFamily: 'var(--font-body)',
              fontSize: '13px',
              fontWeight: active === id ? '500' : '400',
              opacity: hovered ? 1 : 0,
              transition: 'opacity 0.15s',
            }}>{label}</span>
          </button>
        ))}
      </nav>

      {/* Settings at bottom */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
        <button
          onClick={() => onNav('settings')}
          style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            width: '100%', padding: '10px 14px',
            background: active === 'settings' ? 'var(--accent-glow)' : 'none',
            borderLeft: active === 'settings' ? '2px solid var(--accent)' : '2px solid transparent',
            color: active === 'settings' ? 'var(--accent)' : 'var(--text2)',
            transition: 'background 0.18s, color 0.18s',
            whiteSpace: 'nowrap', overflow: 'hidden',
          }}
        >
          <Settings size={18} style={{ flexShrink: 0 }} />
          <span style={{
            fontSize: '13px',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.15s',
          }}>Settings</span>
        </button>
      </div>
    </aside>
  )
}
