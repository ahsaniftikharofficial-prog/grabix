import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "../context/ThemeContext";
import { IconFolder, IconSun, IconMoon, IconInfo, IconCheck } from "../components/Icons";

const API = "http://127.0.0.1:8000";

interface SettingRowProps {
  label: string;
  sub: string;
  children: ReactNode;
}

function SettingRow({ label, sub, children }: SettingRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ flex: 1, paddingRight: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{sub}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div onClick={() => onChange(!value)} style={{ width: 40, height: 22, borderRadius: 99, cursor: "pointer", background: value ? "var(--accent)" : "var(--border)", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
      <div style={{ position: "absolute", top: 3, left: value ? 21 : 3, width: 16, height: 16, borderRadius: "50%", background: "white", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
    </div>
  );
}

export default function SettingsPage() {
  const { theme, toggle } = useTheme();
  const [autoFetch, setAutoFetch] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [format, setFormat] = useState("mp4");
  const [quality, setQuality] = useState("1080p");
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    fetch(`${API}/settings`)
      .then((response) => response.json())
      .then((data: Record<string, unknown>) => {
        if (typeof data.auto_fetch === "boolean") setAutoFetch(data.auto_fetch);
        if (typeof data.notifications === "boolean") setNotifications(data.notifications);
        if (typeof data.default_format === "string") setFormat(data.default_format);
        if (typeof data.default_quality === "string") setQuality(data.default_quality);
      })
      .catch(() => {
        // Keep defaults when backend settings are unavailable.
      });
  }, []);

  const save = () => {
    setSaveError(false);
    fetch(`${API}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theme,
        auto_fetch: autoFetch,
        notifications,
        default_format: format,
        default_quality: quality,
      }),
    })
      .then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })
      .catch(() => {
        setSaveError(true);
        setTimeout(() => setSaveError(false), 3000);
      });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Settings</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>Configure GRABIX</div>
        </div>
        <button className="btn btn-primary" style={{ height: 34, fontSize: 12 }} onClick={save}>
          {saveError ? "Save failed" : saved ? <><IconCheck size={13} /> Saved</> : "Save changes"}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", maxWidth: 560 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Appearance</div>
        <div className="card card-padded" style={{ marginBottom: 20 }}>
          <SettingRow label="Theme" sub="Switch between light and dark mode">
            <button className="btn btn-ghost" style={{ gap: 6, fontSize: 13 }} onClick={toggle}>
              {theme === "dark" ? <IconSun size={14} /> : <IconMoon size={14} />}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
          </SettingRow>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Downloads</div>
        <div className="card card-padded" style={{ marginBottom: 20 }}>
          <SettingRow label="Download folder" sub="Where files are saved on your computer">
            <button className="btn btn-ghost" style={{ gap: 6, fontSize: 12 }}>
              <IconFolder size={14} />
              ~/Downloads/GRABIX
            </button>
          </SettingRow>
          <SettingRow label="Default format" sub="Format used when starting a video download">
            <select value={format} onChange={(e) => setFormat(e.target.value)} style={{ background: "var(--bg-surface2)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 12, fontFamily: "var(--font)", outline: "none" }}>
              <option value="mp4">MP4 (video)</option>
              <option value="mp3">MP3 (audio)</option>
              <option value="webm">WebM</option>
            </select>
          </SettingRow>
          <SettingRow label="Default quality" sub="Video quality preference">
            <select value={quality} onChange={(e) => setQuality(e.target.value)} style={{ background: "var(--bg-surface2)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 12, fontFamily: "var(--font)", outline: "none" }}>
              <option>1080p</option>
              <option>720p</option>
              <option>480p</option>
              <option>360p</option>
            </select>
          </SettingRow>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Behaviour</div>
        <div className="card card-padded" style={{ marginBottom: 20 }}>
          <SettingRow label="Auto-fetch on paste" sub="Automatically fetch video info when a URL is pasted">
            <Toggle value={autoFetch} onChange={setAutoFetch} />
          </SettingRow>
          <SettingRow label="Download notifications" sub="Show a notification when a download completes">
            <Toggle value={notifications} onChange={setNotifications} />
          </SettingRow>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>About</div>
        <div className="card card-padded">
          <SettingRow label="Version" sub="Current GRABIX version">
            <span style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>0.4.0 · Phase 4</span>
          </SettingRow>
          <SettingRow label="Backend" sub="FastAPI + yt-dlp + FFmpeg">
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-success)" }}>
              <IconCheck size={13} /> Active
            </div>
          </SettingRow>
          <div style={{ paddingTop: 10, display: "flex", alignItems: "flex-start", gap: 8, color: "var(--text-muted)", fontSize: 12 }}>
            <IconInfo size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            GRABIX is free and open source. For legal use only, respect copyright.
          </div>
        </div>
      </div>
    </div>
  );
}
