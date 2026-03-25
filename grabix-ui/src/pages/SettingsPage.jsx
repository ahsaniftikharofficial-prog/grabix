import React, { useState } from 'react'
import { Zap } from 'lucide-react'
import Topbar from '../components/Topbar'

function Toggle({ on, onChange }) {
  return (
    <div className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <div className="toggle-thumb" />
    </div>
  )
}

export default function SettingsPage({ theme, onToggleTheme }) {
  const [settings, setSettings] = useState({
    darkMode: theme === 'dark',
    autoFetch: true,
    notifications: true,
    maxConcurrent: '3',
    defaultQuality: '1080p',
    defaultFormat: 'MP4',
    subtitleLang: 'English',
    downloadPath: 'C:\\Users\\User\\Downloads\\GRABIX',
  })

  const set = (key, val) => setSettings(prev => ({ ...prev, [key]: val }))

  return (
    <div>
      <Topbar title="Settings" theme={theme} onToggleTheme={onToggleTheme} />
      <div className="page" style={{ maxWidth:'640px' }}>

        {/* General */}
        <div className="settings-section">
          <div className="settings-section-title">General</div>

          <div className="setting-row">
            <div>
              <div className="setting-label">Dark Mode</div>
              <div className="setting-desc">Switch between dark and light theme</div>
            </div>
            <Toggle on={theme === 'dark'} onChange={onToggleTheme} />
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-label">Auto-fetch URL info</div>
              <div className="setting-desc">Automatically fetch video details when URL is pasted</div>
            </div>
            <Toggle on={settings.autoFetch} onChange={v => set('autoFetch', v)} />
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-label">Notifications</div>
              <div className="setting-desc">Show notification when download completes</div>
            </div>
            <Toggle on={settings.notifications} onChange={v => set('notifications', v)} />
          </div>
        </div>

        {/* Downloads */}
        <div className="settings-section">
          <div className="settings-section-title">Downloads</div>

          <div className="setting-row">
            <div>
              <div className="setting-label">Default quality</div>
              <div className="setting-desc">Preferred video resolution</div>
            </div>
            <select value={settings.defaultQuality} onChange={e => set('defaultQuality', e.target.value)}>
              {['4K (2160p)','1080p','720p','480p','360p'].map(q => <option key={q}>{q}</option>)}
            </select>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-label">Default format</div>
              <div className="setting-desc">Preferred output file format</div>
            </div>
            <select value={settings.defaultFormat} onChange={e => set('defaultFormat', e.target.value)}>
              {['MP4','MKV','WebM','MP3','M4A'].map(f => <option key={f}>{f}</option>)}
            </select>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-label">Max concurrent downloads</div>
              <div className="setting-desc">How many downloads run at the same time</div>
            </div>
            <select value={settings.maxConcurrent} onChange={e => set('maxConcurrent', e.target.value)}>
              {['1','2','3','4','5'].map(n => <option key={n}>{n}</option>)}
            </select>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-label">Default subtitle language</div>
              <div className="setting-desc">Auto-download subtitles in this language</div>
            </div>
            <select value={settings.subtitleLang} onChange={e => set('subtitleLang', e.target.value)}>
              {['None','English','Urdu','Hindi','Japanese','Arabic'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-label">Download location</div>
              <div className="setting-desc" style={{ fontFamily:'monospace', fontSize:'11px' }}>{settings.downloadPath}</div>
            </div>
            <button className="btn btn-ghost" style={{ padding:'6px 14px', fontSize:'12px' }}>Change</button>
          </div>
        </div>

        {/* About */}
        <div className="settings-section">
          <div className="settings-section-title">About</div>
          <div className="setting-row">
            <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
              <div style={{
                width:'36px', height:'36px', background:'var(--accent)',
                borderRadius:'9px', display:'flex', alignItems:'center', justifyContent:'center'
              }}>
                <Zap size={18} color="#fff" fill="#fff"/>
              </div>
              <div>
                <div className="setting-label">GRABIX</div>
                <div className="setting-desc">Version 0.1.0 — Phase 1</div>
              </div>
            </div>
            <span className="badge badge-accent">Up to date</span>
          </div>
        </div>

      </div>
    </div>
  )
}
