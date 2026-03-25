import React from 'react'
import { Play, Download, TrendingUp, HardDrive, Clock } from 'lucide-react'
import { recentDownloads } from '../data/mock'
import Topbar from '../components/Topbar'

export default function HomePage({ theme, onToggleTheme, onNav }) {
  return (
    <div>
      <Topbar title="Home" theme={theme} onToggleTheme={onToggleTheme} />
      <div className="page">

        {/* Hero */}
        <div className="hero">
          <img className="hero-img" src="https://picsum.photos/seed/herointer/1200/400" alt="hero" />
          <div className="hero-overlay">
            <div style={{ display:'flex', gap:'6px', marginBottom:'8px' }}>
              <span className="genre-tag">Sci-Fi</span>
              <span className="genre-tag">Drama</span>
              <span className="badge badge-accent" style={{ fontSize:'11px' }}>★ 8.7</span>
            </div>
            <div className="hero-title">Interstellar</div>
            <div className="hero-sub">A team of explorers travel through a wormhole in space in an attempt to ensure humanity's survival.</div>
            <div className="hero-actions">
              <button className="btn btn-primary" onClick={() => onNav('movies')}>
                <Play size={14} fill="white" /> Watch Now
              </button>
              <button className="btn btn-ghost" onClick={() => onNav('downloader')}>
                <Download size={14} /> Download
              </button>
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{
          display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'12px', marginBottom:'32px'
        }}>
          {[
            { icon: Download, label:'Total Downloads', value:'47', color:'var(--accent)' },
            { icon: HardDrive, label:'Storage Used', value:'38.4 GB', color:'#388E3C' },
            { icon: Clock, label:'Media Hours', value:'142h', color:'#F57C00' },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} style={{
              background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:'var(--radius)', padding:'14px 16px',
              display:'flex', alignItems:'center', gap:'12px'
            }}>
              <div style={{
                width:'36px', height:'36px', borderRadius:'8px',
                background: color + '18',
                display:'flex', alignItems:'center', justifyContent:'center',
              }}>
                <Icon size={16} color={color} />
              </div>
              <div>
                <div style={{ fontFamily:'var(--font-display)', fontSize:'18px', fontWeight:'700' }}>{value}</div>
                <div style={{ fontSize:'11px', color:'var(--text3)' }}>{label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Quick paste */}
        <div style={{
          background:'var(--surface)', border:'1px solid var(--border)',
          borderRadius:'var(--radius-lg)', padding:'20px',
          marginBottom:'32px',
        }}>
          <div style={{ fontSize:'13px', fontWeight:'500', marginBottom:'10px', color:'var(--text2)' }}>
            Quick Download
          </div>
          <div className="dl-input-wrap" style={{ marginBottom:'10px' }}>
            <Download size={16} style={{ color:'var(--text3)' }} />
            <input placeholder="Paste YouTube, Twitter, TikTok, or any video URL here..." />
          </div>
          <button className="btn btn-primary" onClick={() => onNav('downloader')}>
            <TrendingUp size={14} /> Open Full Downloader
          </button>
        </div>

        {/* Recent downloads */}
        <div>
          <div className="section-header">
            <span className="section-title">Recent Downloads</span>
            <span className="section-link" onClick={() => onNav('library')}>View all →</span>
          </div>
          <div className="scroll-row">
            {recentDownloads.map(item => (
              <div key={item.id} className="media-card">
                <div className="media-card-thumb">
                  <img src={item.thumb} alt={item.title} />
                </div>
                <div className="media-card-title">{item.title}</div>
                <div className="media-card-sub">{item.format} · {item.duration}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
