import React, { useState } from 'react'
import { Download, Link2, Scissors, Subtitles, FileVideo, Volume2, CheckCircle } from 'lucide-react'
import Topbar from '../components/Topbar'

const FORMATS = ['MP4', 'MKV', 'WebM', 'MP3', 'M4A']
const QUALITIES = ['4K (2160p)', '1080p', '720p', '480p', '360p', 'Audio Only']
const SUBTITLES = ['None', 'English', 'Urdu', 'Hindi', 'Japanese', 'Arabic']

const mockFetch = (url) => ({
  title: url.includes('youtube') ? 'Sample YouTube Video' : 'Downloaded Media File',
  channel: 'Sample Channel',
  duration: '12:34',
  thumb: 'https://picsum.photos/seed/dlprev/560/320',
  views: '2.4M views',
})

export default function DownloaderPage({ theme, onToggleTheme }) {
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState(null)
  const [format, setFormat] = useState('MP4')
  const [quality, setQuality] = useState('1080p')
  const [subtitle, setSubtitle] = useState('None')
  const [downloading, setDownloading] = useState(false)
  const [done, setDone] = useState(false)

  const handleFetch = () => {
    if (!url.trim()) return
    setPreview(mockFetch(url))
    setDone(false)
  }

  const handleDownload = () => {
    setDownloading(true)
    setTimeout(() => { setDownloading(false); setDone(true) }, 2500)
  }

  return (
    <div>
      <Topbar title="Downloader" theme={theme} onToggleTheme={onToggleTheme} />
      <div className="page" style={{ maxWidth:'720px' }}>

        {/* URL Input */}
        <div style={{ marginBottom:'8px', fontSize:'12px', color:'var(--text3)', fontWeight:'500', textTransform:'uppercase', letterSpacing:'.06em' }}>
          Video URL
        </div>
        <div className="dl-input-wrap">
          <Link2 size={16} style={{ color:'var(--text3)', flexShrink:0 }} />
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleFetch()}
            placeholder="Paste YouTube, Twitter, TikTok, Instagram, or any video URL..."
          />
          <button className="btn btn-primary" style={{ padding:'7px 16px', fontSize:'12px' }} onClick={handleFetch}>
            Fetch Info
          </button>
        </div>

        {/* Preview */}
        {preview && (
          <div className="preview-card">
            <div className="preview-thumb">
              <img src={preview.thumb} alt={preview.title} />
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div className="preview-title">{preview.title}</div>
              <div className="preview-meta" style={{ marginBottom:'6px' }}>{preview.channel} · {preview.duration} · {preview.views}</div>
              <span className="badge badge-green">
                <CheckCircle size={11} /> Ready to download
              </span>
            </div>
          </div>
        )}

        {/* Options */}
        {preview && (
          <>
            <div className="options-row">
              <div className="option-group">
                <div className="option-label"><FileVideo size={11} style={{display:'inline',marginRight:4}}/>Format</div>
                <select value={format} onChange={e => setFormat(e.target.value)}>
                  {FORMATS.map(f => <option key={f}>{f}</option>)}
                </select>
              </div>
              <div className="option-group">
                <div className="option-label">Quality</div>
                <select value={quality} onChange={e => setQuality(e.target.value)}>
                  {QUALITIES.map(q => <option key={q}>{q}</option>)}
                </select>
              </div>
              <div className="option-group">
                <div className="option-label"><Subtitles size={11} style={{display:'inline',marginRight:4}}/>Subtitles</div>
                <select value={subtitle} onChange={e => setSubtitle(e.target.value)}>
                  {SUBTITLES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {/* Trim */}
            <div style={{
              background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:'var(--radius)', padding:'14px 16px', marginBottom:'20px'
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'10px' }}>
                <Scissors size={14} style={{ color:'var(--text2)' }} />
                <span style={{ fontSize:'12px', fontWeight:'500', color:'var(--text2)' }}>Trim (optional)</span>
              </div>
              <div style={{ display:'flex', gap:'12px', alignItems:'center' }}>
                <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                  <span style={{ fontSize:'10px', color:'var(--text3)' }}>Start</span>
                  <input style={{
                    background:'var(--surface2)', border:'1px solid var(--border)',
                    borderRadius:'6px', padding:'5px 10px', color:'var(--text)',
                    fontSize:'13px', width:'90px', outline:'none'
                  }} placeholder="00:00" />
                </div>
                <div style={{ marginTop:'16px', color:'var(--text3)' }}>→</div>
                <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                  <span style={{ fontSize:'10px', color:'var(--text3)' }}>End</span>
                  <input style={{
                    background:'var(--surface2)', border:'1px solid var(--border)',
                    borderRadius:'6px', padding:'5px 10px', color:'var(--text)',
                    fontSize:'13px', width:'90px', outline:'none'
                  }} placeholder="12:34" />
                </div>
              </div>
            </div>

            {/* Download button */}
            {!done ? (
              <button
                className="btn btn-primary"
                style={{ width:'100%', justifyContent:'center', padding:'13px', fontSize:'14px' }}
                onClick={handleDownload}
                disabled={downloading}
              >
                {downloading ? (
                  <>
                    <div style={{
                      width:'14px', height:'14px', border:'2px solid rgba(255,255,255,0.3)',
                      borderTop:'2px solid #fff', borderRadius:'50%',
                      animation:'spin 0.7s linear infinite'
                    }} />
                    Downloading...
                  </>
                ) : (
                  <><Download size={15} /> Download Now</>
                )}
              </button>
            ) : (
              <div style={{
                display:'flex', alignItems:'center', justifyContent:'center',
                gap:'8px', padding:'13px', background:'rgba(56,142,60,0.12)',
                borderRadius:'var(--radius)', border:'1px solid rgba(56,142,60,0.2)',
                color:'#388E3C', fontWeight:'500', fontSize:'14px',
              }}>
                <CheckCircle size={16} /> Download complete!
              </div>
            )}
          </>
        )}

        {!preview && (
          <div style={{
            marginTop:'60px', textAlign:'center', color:'var(--text3)',
          }}>
            <Volume2 size={40} style={{ margin:'0 auto 12px', opacity:0.3 }} />
            <div style={{ fontSize:'14px' }}>Paste a URL above to get started</div>
            <div style={{ fontSize:'12px', marginTop:'4px' }}>Supports YouTube, Twitter, TikTok, Instagram, and 1000+ sites</div>
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
