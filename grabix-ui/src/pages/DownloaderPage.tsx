import { useState } from "react";
import Topbar from "../components/Topbar";

const BACKEND = "http://127.0.0.1:8000";

interface VideoInfo {
  valid: boolean; title?: string; thumbnail?: string; error?: string;
}

interface Props { theme: string; onToggleTheme: () => void; }

export default function DownloaderPage({ theme, onToggleTheme }: Props) {
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [fetching, setFetching] = useState(false);
  const [format, setFormat] = useState("video");
  const [quality, setQuality] = useState("1080p");
  const [subtitle, setSubtitle] = useState("None");
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState("");

  const fetchInfo = async () => {
    if (!url.trim()) return;
    setFetching(true);
    setInfo(null);
    setDownloadMsg("");
    try {
      const res = await fetch(`${BACKEND}/check-link?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      setInfo(data);
    } catch {
      setInfo({ valid: false, error: "Cannot connect to backend. Make sure it is running." });
    } finally {
      setFetching(false);
    }
  };

  const startDownload = async () => {
    setDownloading(true);
    setDownloadMsg("");
    try {
      const res = await fetch(`${BACKEND}/download?url=${encodeURIComponent(url)}&format=${format}`);
      const data = await res.json();
      setDownloadMsg(`✓ Download started! Saving to: ${data.folder}`);
    } catch {
      setDownloadMsg("✗ Failed to connect to backend.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Downloader" theme={theme} onToggleTheme={onToggleTheme} />
      <div className="flex-1 overflow-y-auto p-8" style={{ maxWidth: "740px" }}>

        {/* URL Input */}
        <div className="text-xs font-medium mb-2 uppercase tracking-wider" style={{ color: "var(--text3)" }}>
          Video URL
        </div>
        <div
          className="flex items-center gap-2 px-4 py-3 rounded-xl mb-5 transition-all"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <span style={{ color: "var(--text3)", fontSize: "18px" }}>⊕</span>
          <input
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: "var(--text)" }}
            placeholder="Paste YouTube, Twitter, TikTok, Instagram URL..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchInfo()}
          />
          <button
            onClick={fetchInfo}
            disabled={fetching || !url.trim()}
            className="px-4 py-1.5 rounded-lg text-white text-sm font-semibold disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            {fetching ? "Fetching..." : "Fetch Info"}
          </button>
        </div>

        {/* Backend status hint */}
        <div className="text-xs mb-5 px-1" style={{ color: "var(--text3)" }}>
          ℹ Backend must be running: <code className="px-1 rounded" style={{ background: "var(--surface2)", color: "var(--text2)" }}>cd backend && uvicorn main:app --reload</code>
        </div>

        {/* Error */}
        {info && !info.valid && (
          <div className="fade-up p-4 rounded-xl mb-5 text-sm" style={{ background: "rgba(229,57,53,0.08)", border: "1px solid rgba(229,57,53,0.2)", color: "var(--red)" }}>
            ✗ {info.error || "Invalid URL."}
          </div>
        )}

        {/* Preview */}
        {info && info.valid && (
          <div className="fade-up p-4 rounded-xl mb-5 flex gap-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            {info.thumbnail && (
              <img src={info.thumbnail} alt="thumb" className="w-36 h-24 rounded-lg object-cover flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-bold text-base mb-1 truncate" style={{ color: "var(--text)" }}>{info.title}</div>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(46,125,50,0.12)", color: "var(--green)" }}>
                ✓ Ready to download
              </span>
            </div>
          </div>
        )}

        {/* Options */}
        {info && info.valid && (
          <>
            <div className="flex gap-4 flex-wrap mb-5">
              {[
                { label: "Format", value: format, onChange: setFormat, options: ["video", "audio"] },
                { label: "Quality", value: quality, onChange: setQuality, options: ["4K","1080p","720p","480p","360p"] },
                { label: "Subtitles", value: subtitle, onChange: setSubtitle, options: ["None","English","Urdu","Hindi","Japanese"] },
              ].map(({ label, value, onChange, options }) => (
                <div key={label} className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wider font-medium" style={{ color: "var(--text3)" }}>{label}</span>
                  <select
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)" }}
                  >
                    {options.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>

            {/* Download button */}
            <button
              onClick={startDownload}
              disabled={downloading}
              className="w-full py-3.5 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-opacity"
              style={{ background: "var(--accent)" }}
            >
              {downloading ? (
                <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spinner" /> Downloading...</>
              ) : (
                <>↓ Download Now</>
              )}
            </button>

            {/* Download message */}
            {downloadMsg && (
              <div
                className="fade-up mt-4 p-3 rounded-lg text-sm"
                style={{
                  background: downloadMsg.startsWith("✓") ? "rgba(46,125,50,0.1)" : "rgba(229,57,53,0.08)",
                  color: downloadMsg.startsWith("✓") ? "var(--green)" : "var(--red)",
                  border: `1px solid ${downloadMsg.startsWith("✓") ? "rgba(46,125,50,0.2)" : "rgba(229,57,53,0.2)"}`,
                }}
              >
                {downloadMsg}
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {!info && !fetching && (
          <div className="mt-16 text-center" style={{ color: "var(--text3)" }}>
            <div className="text-4xl mb-3 opacity-30">↓</div>
            <div className="text-sm">Paste a URL above and click Fetch Info</div>
            <div className="text-xs mt-1">Supports YouTube, TikTok, Twitter, Instagram, and 1000+ sites</div>
          </div>
        )}

      </div>
    </div>
  );
}
