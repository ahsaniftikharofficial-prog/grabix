import { useState, useEffect } from "react";

type LinkStatus =
  | { valid: true; title: string; thumbnail: string }
  | { valid: false; error: string }
  | null;

function App() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<LinkStatus>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [format, setFormat] = useState("video");
  const [downloadMsg, setDownloadMsg] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const checkVideo = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setStatus(null);
    setDownloadMsg("");
    try {
      const response = await fetch(
        `http://127.0.0.1:8000/check-link?url=${encodeURIComponent(url)}`
      );
      const data = await response.json();
      setStatus(data);
    } catch {
      setStatus({ valid: false, error: "Backend not running. Start the Python server." });
    } finally {
      setLoading(false);
    }
  };

  const startDownload = async () => {
    setDownloading(true);
    setDownloadMsg("Starting download...");
    try {
      const response = await fetch(
        `http://127.0.0.1:8000/download?url=${encodeURIComponent(url)}&format=${format}`
      );
      const data = await response.json();
      setDownloadMsg(`Downloading in background → ${data.folder}`);
    } catch {
      setDownloadMsg("Failed to connect to backend.");
    } finally {
      setDownloading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") checkVideo();
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg:        #080b10;
          --surface:   #0e1319;
          --border:    #1c2430;
          --border-hi: #2a3a50;
          --accent:    #00d4ff;
          --accent2:   #7b61ff;
          --green:     #00e5a0;
          --red:       #ff4d6d;
          --text:      #e8edf5;
          --muted:     #4a5568;
          --font-head: 'Syne', sans-serif;
          --font-mono: 'JetBrains Mono', monospace;
        }

        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-head);
          min-height: 100vh;
          overflow-x: hidden;
        }

        /* ─── Grid Background ─── */
        .grid-bg {
          position: fixed;
          inset: 0;
          background-image:
            linear-gradient(rgba(0,212,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,212,255,0.03) 1px, transparent 1px);
          background-size: 40px 40px;
          pointer-events: none;
          z-index: 0;
        }

        /* ─── Glow orbs ─── */
        .orb {
          position: fixed;
          border-radius: 50%;
          filter: blur(120px);
          pointer-events: none;
          z-index: 0;
          opacity: 0.25;
        }
        .orb-1 {
          width: 500px; height: 500px;
          background: var(--accent2);
          top: -150px; left: -150px;
          animation: drift1 20s ease-in-out infinite alternate;
        }
        .orb-2 {
          width: 400px; height: 400px;
          background: var(--accent);
          bottom: -100px; right: -100px;
          animation: drift2 25s ease-in-out infinite alternate;
        }
        @keyframes drift1 {
          from { transform: translate(0,0); }
          to   { transform: translate(60px, 40px); }
        }
        @keyframes drift2 {
          from { transform: translate(0,0); }
          to   { transform: translate(-50px, -30px); }
        }

        /* ─── Main layout ─── */
        .app {
          position: relative;
          z-index: 1;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          opacity: 0;
          transform: translateY(16px);
          transition: opacity 0.6s ease, transform 0.6s ease;
        }
        .app.mounted {
          opacity: 1;
          transform: translateY(0);
        }

        /* ─── Logo ─── */
        .logo-wrap {
          text-align: center;
          margin-bottom: 3rem;
        }
        .logo-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: rgba(0,212,255,0.06);
          border: 1px solid rgba(0,212,255,0.15);
          border-radius: 100px;
          padding: 0.3rem 1rem;
          font-family: var(--font-mono);
          font-size: 0.65rem;
          letter-spacing: 0.15em;
          color: var(--accent);
          text-transform: uppercase;
          margin-bottom: 1rem;
        }
        .logo-badge::before {
          content: '';
          width: 6px; height: 6px;
          border-radius: 50%;
          background: var(--accent);
          box-shadow: 0 0 8px var(--accent);
          animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
        .logo-title {
          font-size: clamp(3rem, 8vw, 5.5rem);
          font-weight: 800;
          letter-spacing: -0.03em;
          line-height: 1;
          background: linear-gradient(135deg, #ffffff 0%, var(--accent) 60%, var(--accent2) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .logo-tagline {
          margin-top: 0.75rem;
          font-family: var(--font-mono);
          font-size: 0.7rem;
          letter-spacing: 0.2em;
          color: var(--muted);
          text-transform: uppercase;
        }

        /* ─── Card ─── */
        .card {
          width: 100%;
          max-width: 560px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 20px;
          padding: 2rem;
          box-shadow:
            0 0 0 1px rgba(0,0,0,0.5),
            0 24px 64px rgba(0,0,0,0.5),
            inset 0 1px 0 rgba(255,255,255,0.04);
        }

        /* ─── Input row ─── */
        .input-row {
          display: flex;
          gap: 0.75rem;
          align-items: stretch;
        }
        .url-input {
          flex: 1;
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 0.85rem 1.1rem;
          color: var(--text);
          font-family: var(--font-mono);
          font-size: 0.8rem;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .url-input::placeholder { color: var(--muted); }
        .url-input:focus {
          border-color: rgba(0,212,255,0.4);
          box-shadow: 0 0 0 3px rgba(0,212,255,0.08);
        }

        .btn-check {
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          border: none;
          border-radius: 12px;
          padding: 0 1.4rem;
          color: #000;
          font-family: var(--font-head);
          font-weight: 700;
          font-size: 0.82rem;
          letter-spacing: 0.03em;
          cursor: pointer;
          white-space: nowrap;
          transition: opacity 0.2s, transform 0.15s;
        }
        .btn-check:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
        .btn-check:active:not(:disabled) { transform: translateY(0); }
        .btn-check:disabled { opacity: 0.4; cursor: not-allowed; }

        /* ─── Spinner ─── */
        .spinner {
          display: inline-block;
          width: 14px; height: 14px;
          border: 2px solid rgba(0,0,0,0.3);
          border-top-color: #000;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          vertical-align: middle;
          margin-right: 6px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ─── Result panel ─── */
        .result-panel {
          margin-top: 1.25rem;
          border: 1px solid var(--border-hi);
          border-radius: 14px;
          overflow: hidden;
          animation: slideUp 0.3s ease;
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .result-info {
          display: flex;
          gap: 1rem;
          padding: 1rem;
          background: rgba(0,229,160,0.04);
          border-bottom: 1px solid var(--border);
        }
        .result-thumb {
          width: 90px;
          height: 56px;
          object-fit: cover;
          border-radius: 8px;
          flex-shrink: 0;
          border: 1px solid var(--border);
        }
        .result-meta { flex: 1; min-width: 0; }
        .result-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-family: var(--font-mono);
          font-size: 0.62rem;
          letter-spacing: 0.1em;
          color: var(--green);
          text-transform: uppercase;
          margin-bottom: 0.4rem;
        }
        .result-badge::before {
          content: '';
          width: 5px; height: 5px;
          border-radius: 50%;
          background: var(--green);
          box-shadow: 0 0 6px var(--green);
        }
        .result-title {
          font-size: 0.82rem;
          font-weight: 700;
          line-height: 1.4;
          color: var(--text);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .result-actions {
          display: flex;
          gap: 0.75rem;
          padding: 0.9rem 1rem;
          align-items: center;
        }
        .format-select {
          flex: 1;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 0.6rem 0.9rem;
          color: var(--text);
          font-family: var(--font-mono);
          font-size: 0.72rem;
          outline: none;
          cursor: pointer;
          transition: border-color 0.2s;
        }
        .format-select:focus { border-color: rgba(0,212,255,0.3); }
        .format-select option { background: #0e1319; }

        .btn-download {
          background: linear-gradient(135deg, var(--green), #00b87a);
          border: none;
          border-radius: 10px;
          padding: 0.6rem 1.4rem;
          color: #000;
          font-family: var(--font-head);
          font-weight: 700;
          font-size: 0.8rem;
          letter-spacing: 0.04em;
          cursor: pointer;
          white-space: nowrap;
          transition: opacity 0.2s, transform 0.15s;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .btn-download:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
        .btn-download:disabled { opacity: 0.4; cursor: not-allowed; }

        .download-msg {
          padding: 0.6rem 1rem;
          border-top: 1px solid var(--border);
          font-family: var(--font-mono);
          font-size: 0.68rem;
          color: var(--accent);
          background: rgba(0,212,255,0.04);
        }

        /* ─── Error panel ─── */
        .error-panel {
          margin-top: 1.25rem;
          padding: 0.9rem 1rem;
          background: rgba(255,77,109,0.06);
          border: 1px solid rgba(255,77,109,0.25);
          border-radius: 12px;
          font-family: var(--font-mono);
          font-size: 0.72rem;
          color: var(--red);
          animation: slideUp 0.3s ease;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .error-panel::before { content: '✕'; font-weight: 700; }

        /* ─── Footer ─── */
        .footer {
          margin-top: 2.5rem;
          font-family: var(--font-mono);
          font-size: 0.6rem;
          letter-spacing: 0.12em;
          color: var(--muted);
          text-align: center;
          text-transform: uppercase;
        }
        .footer span { color: rgba(0,212,255,0.5); }
      `}</style>

      <div className="grid-bg" />
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <div className={`app ${mounted ? "mounted" : ""}`}>
        {/* Logo */}
        <div className="logo-wrap">
          <div className="logo-badge">Phase 1 · Download Engine</div>
          <div className="logo-title">GRABIX</div>
          <div className="logo-tagline">One App · Every Media · Zero Compromise</div>
        </div>

        {/* Main card */}
        <div className="card">
          <div className="input-row">
            <input
              className="url-input"
              type="text"
              placeholder="Paste a video link..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              className="btn-check"
              onClick={checkVideo}
              disabled={loading || downloading || !url.trim()}
            >
              {loading ? (
                <><span className="spinner" />Checking</>
              ) : (
                "Verify"
              )}
            </button>
          </div>

          {/* Valid result */}
          {status && status.valid && (
            <div className="result-panel">
              <div className="result-info">
                {status.thumbnail && (
                  <img className="result-thumb" src={status.thumbnail} alt="" />
                )}
                <div className="result-meta">
                  <div className="result-badge">Ready to grab</div>
                  <div className="result-title">{status.title}</div>
                </div>
              </div>

              <div className="result-actions">
                <select
                  className="format-select"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  <option value="video">MP4 Video — Best Quality</option>
                  <option value="audio">MP3 Audio — Music / Podcast</option>
                </select>
                <button
                  className="btn-download"
                  onClick={startDownload}
                  disabled={downloading}
                >
                  {downloading ? (
                    <><span className="spinner" />...</>
                  ) : (
                    <>↓ Grab</>
                  )}
                </button>
              </div>

              {downloadMsg && (
                <div className="download-msg">{downloadMsg}</div>
              )}
            </div>
          )}

          {/* Error */}
          {status && !status.valid && (
            <div className="error-panel">{status.error || "Invalid link."}</div>
          )}
        </div>

        <div className="footer">
          GRABIX <span>·</span> Built with Tauri + FastAPI + yt-dlp
        </div>
      </div>
    </>
  );
}

export default App;
