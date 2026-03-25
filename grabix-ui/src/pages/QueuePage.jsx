import React, { useState } from 'react'
import { Pause, Play, X, RotateCcw, CheckCircle, AlertCircle, Loader } from 'lucide-react'
import { queueItems as initialQueue } from '../data/mock'
import Topbar from '../components/Topbar'

const tabs = ['All', 'Active', 'Done', 'Failed']

export default function QueuePage({ theme, onToggleTheme }) {
  const [items, setItems] = useState(initialQueue)
  const [activeTab, setActiveTab] = useState('All')

  const filtered = items.filter(i => {
    if (activeTab === 'All') return true
    if (activeTab === 'Active') return i.status === 'downloading' || i.status === 'paused'
    if (activeTab === 'Done') return i.status === 'done'
    if (activeTab === 'Failed') return i.status === 'failed'
    return true
  })

  const toggle = (id) => {
    setItems(prev => prev.map(i => i.id === id
      ? { ...i, status: i.status === 'downloading' ? 'paused' : 'downloading' }
      : i
    ))
  }
  const remove = (id) => setItems(prev => prev.filter(i => i.id !== id))
  const retry = (id) => setItems(prev => prev.map(i => i.id === id ? { ...i, status:'downloading', progress:0 } : i))

  const statusIcon = (s) => {
    if (s === 'downloading') return <Loader size={13} style={{ animation:'spin 1s linear infinite' }} color="var(--accent)" />
    if (s === 'done') return <CheckCircle size={13} color="#388E3C" />
    if (s === 'failed') return <AlertCircle size={13} color="var(--red)" />
    if (s === 'paused') return <Pause size={13} color="var(--text3)" />
    return null
  }

  return (
    <div>
      <Topbar title="Downloads Queue" theme={theme} onToggleTheme={onToggleTheme} />
      <div className="page">

        {/* Tabs */}
        <div style={{ display:'flex', gap:'6px', marginBottom:'20px' }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{
              padding:'6px 16px', borderRadius:'99px', fontSize:'12px', fontWeight:'500',
              background: activeTab === t ? 'var(--accent)' : 'var(--surface)',
              color: activeTab === t ? '#fff' : 'var(--text2)',
              border: activeTab === t ? 'none' : '1px solid var(--border)',
              cursor:'pointer', transition:'all 0.18s',
            }}>{t}</button>
          ))}
          <button onClick={() => setItems(prev => prev.filter(i => i.status !== 'done'))} style={{
            marginLeft:'auto', padding:'6px 14px', borderRadius:'99px', fontSize:'12px',
            background:'none', border:'1px solid var(--border)', color:'var(--text3)', cursor:'pointer'
          }}>Clear done</button>
        </div>

        {/* Items */}
        {filtered.length === 0 && (
          <div style={{ textAlign:'center', color:'var(--text3)', marginTop:'60px', fontSize:'13px' }}>
            Nothing here yet.
          </div>
        )}

        {filtered.map(item => (
          <div key={item.id} className="queue-item">
            <div className="queue-thumb">
              <img src={item.thumb} alt={item.title} />
            </div>
            <div className="queue-info">
              <div className="queue-title">{item.title}</div>
              <div className="queue-meta" style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                {statusIcon(item.status)}
                <span>{item.format}</span>
                {item.status === 'downloading' && <span>· {item.speed} · ETA {item.eta}</span>}
                {item.status === 'done' && <span>· Complete</span>}
                {item.status === 'paused' && <span>· Paused</span>}
                {item.status === 'failed' && <span style={{color:'var(--red)'}}>· Failed</span>}
              </div>
              {(item.status === 'downloading' || item.status === 'paused') && (
                <div className="progress-bar" style={{ marginTop:'8px', width:'100%' }}>
                  <div className="progress-fill" style={{ width: item.progress + '%' }} />
                </div>
              )}
              {item.status === 'done' && (
                <div className="progress-bar" style={{ marginTop:'8px' }}>
                  <div className="progress-fill" style={{ width:'100%', background:'#388E3C' }} />
                </div>
              )}
            </div>
            <div className="queue-actions">
              {(item.status === 'downloading' || item.status === 'paused') && (
                <button className="icon-btn" onClick={() => toggle(item.id)}>
                  {item.status === 'downloading' ? <Pause size={14}/> : <Play size={14}/>}
                </button>
              )}
              {item.status === 'failed' && (
                <button className="icon-btn" onClick={() => retry(item.id)}>
                  <RotateCcw size={14} />
                </button>
              )}
              <button className="icon-btn" onClick={() => remove(item.id)}>
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
