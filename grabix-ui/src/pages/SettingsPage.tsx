import React, { useState } from "react";
import Topbar from "../components/Topbar";

interface Props { theme: string; onToggleTheme: () => void; }

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <div onClick={onChange} className="relative cursor-pointer flex-shrink-0" style={{ width: "38px", height: "22px", background: on ? "var(--accent)" : "var(--surface2)", borderRadius: "99px", border: "1px solid var(--border)", transition: "background 0.2s" }}>
      <div style={{ position: "absolute", top: "2px", left: on ? "18px" : "2px", width: "16px", height: "16px", background: "#fff", borderRadius: "50%", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
    </div>
  );
}

export default function SettingsPage({ theme, onToggleTheme }: Props) {
  const [autoFetch, setAutoFetch]         = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [quality, setQuality]             = useState("1080p");
  const [format, setFormat]               = useState("MP4");
  const [maxDL, setMaxDL]                 = useState("3");
  const [subLang, setSubLang]             = useState("English");

  const Section = ({ title }: { title: string }) => (
    <div className="text-xs font-bold uppercase tracking-widest mb-3 mt-7 first:mt-0" style={{ color: "var(--text3)" }}>{title}</div>
  );

  const Row = ({ label, desc, right }: { label: string; desc?: string; right: React.ReactNode }) => (
    <div className="flex items-center justify-between px-4 py-3.5 rounded-xl mb-2" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div>
        <div className="text-sm font-medium" style={{ color: "var(--text)" }}>{label}</div>
        {desc && <div className="text-xs mt-0.5" style={{ color: "var(--text3)" }}>{desc}</div>}
      </div>
      {right}
    </div>
  );

  const Sel = ({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: string[] }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="px-3 py-1.5 rounded-lg text-xs outline-none" style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)" }}>
      {opts.map((o) => <option key={o}>{o}</option>)}
    </select>
  );

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Settings" theme={theme} onToggleTheme={onToggleTheme} />
      <div className="flex-1 overflow-y-auto p-8" style={{ maxWidth: "640px" }}>

        <Section title="General" />
        <Row label="Dark Mode" desc="Switch between dark and light theme" right={<Toggle on={theme === "dark"} onChange={onToggleTheme} />} />
        <Row label="Auto-fetch URL info" desc="Fetch video details when URL is pasted" right={<Toggle on={autoFetch} onChange={() => setAutoFetch(!autoFetch)} />} />
        <Row label="Download notifications" desc="Notify when download completes" right={<Toggle on={notifications} onChange={() => setNotifications(!notifications)} />} />

        <Section title="Downloads" />
        <Row label="Default quality" desc="Preferred video resolution" right={<Sel value={quality} onChange={setQuality} opts={["4K","1080p","720p","480p","360p"]} />} />
        <Row label="Default format" desc="Preferred output format" right={<Sel value={format} onChange={setFormat} opts={["MP4","MKV","WebM","MP3","M4A"]} />} />
        <Row label="Max concurrent downloads" desc="How many downloads run at once" right={<Sel value={maxDL} onChange={setMaxDL} opts={["1","2","3","4","5"]} />} />
        <Row label="Default subtitle language" right={<Sel value={subLang} onChange={setSubLang} opts={["None","English","Urdu","Hindi","Japanese","Arabic"]} />} />
        <Row
          label="Download location"
          desc="~/Downloads/GRABIX"
          right={<button className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text2)" }}>Change</button>}
        />

        <Section title="Backend" />
        <Row
          label="Backend status"
          desc="FastAPI running at http://127.0.0.1:8000"
          right={
            <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "rgba(46,125,50,0.1)", color: "var(--green)" }}>
              ● Running
            </span>
          }
        />

        <Section title="About" />
        <Row
          label="GRABIX"
          desc="Version 0.1.0 — Phase 1 Foundation"
          right={<span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "var(--accent-bg)", color: "var(--accent)" }}>Up to date</span>}
        />

      </div>
    </div>
  );
}
