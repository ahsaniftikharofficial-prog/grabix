import React from 'react'
import { Play, Download, Star } from 'lucide-react'
import { moviesList } from '../data/mock'
import Topbar from '../components/Topbar'

export default function MoviesPage({ theme, onToggleTheme, onNav }) {
  return (
    <div>
      <Topbar title="Movies" theme={theme} onToggleTheme={onToggleTheme} />
      <div className="page">

        {/* Hero */}
        <div className="content-hero">
          <img className="content-hero-img" src="https://picsum.photos/seed/moviehero/1200/400" alt="hero" />
          <div className="content-hero-overlay">
            <div className="content-hero-genre">
              <span className="genre-tag">Sci-Fi</span>
              <span className="genre-tag">Adventure</span>
              <span className="badge badge-accent" style={{fontSize:'11px'}}>★ 8.6</span>
            </div>
            <div className="content-hero-title">Dune:<br/>Part Two</div>
            <div className="content-hero-desc">
              Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.
            </div>
            <div className="content-hero-actions">
              <button className="btn btn-primary"><Play size={14} fill="white"/> Watch Now</button>
              <button className="btn btn-ghost" onClick={() => onNav('downloader')}><Download size={14}/> Download</button>
            </div>
          </div>
        </div>

        {/* Now Popular */}
        <div className="section-header">
          <span className="section-title">Now Popular</span>
        </div>
        <div className="scroll-row" style={{ marginBottom:'32px' }}>
          {moviesList.map(item => (
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

        {/* Top Rated */}
        <div className="section-header">
          <span className="section-title">Top Rated</span>
        </div>
        <div className="scroll-row">
          {[...moviesList].sort((a,b) => b.rating - a.rating).map(item => (
            <div key={item.id} className="content-card">
              <div className="content-card-poster">
                <img src={item.thumb} alt={item.title} />
              </div>
              <div className="content-card-title">{item.title}</div>
              <div className="content-card-sub">{item.year}</div>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
