import React, { useState } from 'react'
import { Grid3X3, List, Search, Trash2, FolderOpen } from 'lucide-react'
import { libraryItems } from '../data/mock'
import Topbar from '../components/Topbar'

export default function LibraryPage({ theme, onToggleTheme }) {
  const [view, setView] = useState('grid')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const [sort, setSort] = useState('Date')

  const filtered = libraryItems
    .filter(i => filter === 'All' || i.type === filter)
    .filter(i => i.title.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <Topbar title="Media Library" theme={theme} onToggleTheme={onToggleTheme} />
      <div className="page">

        {/* Toolbar */}
        <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'20px', flexWrap:'wrap' }}>
          <div style={{
            display:'flex', alignItems:'center', gap:'7px',
            background:'var(--surface)', border:'1px solid var(--border)',
            borderRadius:'8px', padding:'7px 12px', flex:'1', minWidth:'180px'
          }}>
            <Search size={13} style={{ color:'var(--text3)' }} />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search library..."
              style={{ background:'none', border:'none', outline:'none', color:'var(--text)', fontSize:'13px', width:'100%' }}
            />
          </div>

          {['All','Video','Audio'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding:'6px 14px', borderRadius:'99px', fontSize:'12px',
              background: filter === f ? 'var(--accent)' : 'var(--surface)',
              color: filter === f ? '#fff' : 'var(--text2)',
              border: filter === f ? 'none' : '1px solid var(--border)',
              cursor:'pointer', transition:'all 0.18s',
            }}>{f}</button>
          ))}

          <select value={sort} onChange={e => setSort(e.target.value)} style={{ fontSize:'12px' }}>
            {['Date','Name','Size'].map(s => <option key={s}>{s}</option>)}
          </select>

          <div style={{ display:'flex', gap:'4px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'8px', padding:'3px' }}>
            <button className="icon-btn" onClick={() => setView('grid')} style={{
              background: view==='grid' ? 'var(--accent)' : 'none',
              color: view==='grid' ? '#fff' : 'var(--text2)',
              borderRadius:'6px', width:'30px', height:'30px'
            }}><Grid3X3 size={13}/></button>
            <button className="icon-btn" onClick={() => setView('list')} style={{
              background: view==='list' ? 'var(--accent)' : 'none',
              color: view==='list' ? '#fff' : 'var(--text2)',
              borderRadius:'6px', width:'30px', height:'30px'
            }}><List size={13}/></button>
          </div>
        </div>

        {/* Storage bar */}
        <div style={{
          background:'var(--surface)', border:'1px solid var(--border)',
          borderRadius:'var(--radius)', padding:'12px 16px', marginBottom:'20px',
          display:'flex', alignItems:'center', gap:'14px'
        }}>
          <FolderOpen size={16} style={{ color:'var(--text3)' }} />
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:'12px', marginBottom:'6px' }}>
              <span style={{ color:'var(--text2)' }}>Storage used</span>
              <span style={{ color:'var(--text)', fontWeight:'500' }}>38.4 GB / 500 GB</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width:'7.6%' }} />
            </div>
          </div>
        </div>

        {/* Grid */}
        {view === 'grid' && (
          <div className="library-grid">
            {filtered.map(item => (
              <div key={item.id} className="lib-card">
                <div className="lib-thumb">
                  <img src={item.thumb} alt={item.title} />
                </div>
                <div className="lib-info">
                  <div className="lib-title">{item.title}</div>
                  <div className="lib-meta">{item.type} · {item.size}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* List */}
        {view === 'list' && (
          <div>
            {filtered.map(item => (
              <div key={item.id} style={{
                display:'flex', alignItems:'center', gap:'14px',
                padding:'10px 14px', background:'var(--surface)',
                border:'1px solid var(--border)', borderRadius:'var(--radius)',
                marginBottom:'6px', cursor:'pointer', transition:'border-color var(--trans)',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <div style={{ width:'52px', height:'34px', borderRadius:'6px', overflow:'hidden', flexShrink:0 }}>
                  <img src={item.thumb} alt={item.title} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:'13px', fontWeight:'500', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{item.title}</div>
                  <div style={{ fontSize:'11px', color:'var(--text3)' }}>{item.type} · {item.size} · {item.date}</div>
                </div>
                <button className="icon-btn" style={{ color:'var(--text3)' }}><Trash2 size={14}/></button>
              </div>
            ))}
          </div>
        )}

        {filtered.length === 0 && (
          <div style={{ textAlign:'center', color:'var(--text3)', marginTop:'60px', fontSize:'13px' }}>
            No files found.
          </div>
        )}
      </div>
    </div>
  )
}
