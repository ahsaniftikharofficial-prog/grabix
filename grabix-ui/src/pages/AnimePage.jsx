import React, { useState } from 'react'
import { Star, BookOpen, Tv2 } from 'lucide-react'
import { animeList, mangaList } from '../data/mock'
import Topbar from '../components/Topbar'

export default function AnimePage({ theme, onToggleTheme }) {
  const [tab, setTab] = useState('anime')

  return (
    <div>
      <Topbar title="Anime & Manga" theme={theme} onToggleTheme={onToggleTheme} />
      <div className="page">

        {/* Hero */}
        <div className="content-hero">
          <img className="content-hero-img" src="https://picsum.photos/seed/animehero/1200/400" alt="hero" />
          <div className="content-hero-overlay">
            <div className="content-hero-genre">
              <span className="genre-tag">Action</span>
              <span className="genre-tag">Fantasy</span>
            </div>
            <div className="content-hero-title">Jujutsu Kaisen</div>
            <div className="content-hero-desc">
              A boy swallows a cursed talisman — the finger of a Demon — and becomes cursed himself. He enters a school for Jujutsu Sorcerers.
            </div>
            <div className="content-hero-actions">
              <button className="btn btn-primary"><Tv2 size={14}/> Watch Now</button>
              <button className="btn btn-ghost"><BookOpen size={14}/> Add to List</button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap:'6px', marginBottom:'24px' }}>
          {['anime','manga'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding:'7px 20px', borderRadius:'99px', fontSize:'13px', fontWeight:'500',
              background: tab === t ? 'var(--accent)' : 'var(--surface)',
              color: tab === t ? '#fff' : 'var(--text2)',
              border: tab === t ? 'none' : '1px solid var(--border)',
              cursor:'pointer', transition:'all 0.18s',
              textTransform:'capitalize',
            }}>{tab === t ? (t === 'anime' ? '🎌 Anime' : '📚 Manga') : (t === 'anime' ? '🎌 Anime' : '📚 Manga')}</button>
          ))}
        </div>

        {tab === 'anime' && (
          <>
            <div className="section-header">
              <span className="section-title">Trending Now</span>
            </div>
            <div className="scroll-row" style={{ marginBottom:'32px' }}>
              {animeList.map(item => (
                <div key={item.id} className="content-card">
                  <div className="content-card-poster">
                    <img src={item.thumb} alt={item.title} />
                    <div style={{
                      position:'absolute', top:'8px', right:'8px',
                      background:'rgba(0,0,0,0.75)', borderRadius:'99px',
                      padding:'2px 8px', fontSize:'11px', color:'#FFD700',
                      display:'flex', alignItems:'center', gap:'3px'
                    }}>
                      <Star size={9} fill="#FFD700" /> {item.rating}
                    </div>
                  </div>
                  <div className="content-card-title">{item.title}</div>
                  <div className="content-card-sub">{item.genre}</div>
                </div>
              ))}
            </div>

            <div className="section-header">
              <span className="section-title">Top Airing</span>
            </div>
            <div className="scroll-row">
              {[...animeList].reverse().map(item => (
                <div key={item.id} className="content-card">
                  <div className="content-card-poster">
                    <img src={item.thumb} alt={item.title} />
                  </div>
                  <div className="content-card-title">{item.title}</div>
                  <div className="content-card-sub">{item.year}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'manga' && (
          <>
            <div className="section-header">
              <span className="section-title">Popular Manga</span>
            </div>
            <div className="scroll-row">
              {mangaList.map(item => (
                <div key={item.id} className="content-card">
                  <div className="content-card-poster">
                    <img src={item.thumb} alt={item.title} />
                    <div style={{
                      position:'absolute', top:'8px', right:'8px',
                      background:'rgba(0,0,0,0.75)', borderRadius:'99px',
                      padding:'2px 8px', fontSize:'11px', color:'#FFD700',
                      display:'flex', alignItems:'center', gap:'3px'
                    }}>
                      <Star size={9} fill="#FFD700" /> {item.rating}
                    </div>
                  </div>
                  <div className="content-card-title">{item.title}</div>
                  <div className="content-card-sub">{item.genre}</div>
                </div>
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  )
}
