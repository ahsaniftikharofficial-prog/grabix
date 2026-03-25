import { useState } from "react";

function App() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [format, setFormat] = useState("video");
  const [downloadMsg, setDownloadMsg] = useState("");

  const checkVideo = async () => {
    if (!url) return;
    setLoading(true);
    setStatus(null);
    setDownloadMsg("");
    
    try {
      const response = await fetch(`http://127.0.0.1:8000/check-link?url=${encodeURIComponent(url)}`);
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      setStatus({ valid: false, error: "Backend not running." });
    } finally {
      setLoading(false);
    }
  };

  const startDownload = async () => {
    setDownloading(true);
    setDownloadMsg("Starting download...");
    try {
      const response = await fetch(`http://127.0.0.1:8000/download?url=${encodeURIComponent(url)}&format=${format}`);
      const data = await response.json();
      setDownloadMsg(`Downloading in background! Check folder: ${data.folder}`);
    } catch (error) {
      setDownloadMsg("Failed to connect to backend for download.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 font-sans bg-slate-900 text-white">
      <h1 className="text-4xl font-bold mb-2 text-blue-500 tracking-wider">GRABIX</h1>
      <p className="text-slate-400 mb-8 text-sm">Phase 2: Download Engine</p>
      
      <div className="w-full max-w-md space-y-4">
        <input
          type="text"
          placeholder="Paste video link here..."
          className="w-full p-4 rounded-lg bg-slate-800 border border-slate-700 focus:outline-none focus:border-blue-500 transition-colors shadow-inner"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        
        <button 
          onClick={checkVideo}
          disabled={loading || downloading}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 py-3 rounded-lg font-semibold shadow-lg"
        >
          {loading ? "Checking Link..." : "Verify Link"}
        </button>

        {status && status.valid && (
          <div className="mt-6 p-4 bg-slate-800 rounded-lg border border-green-500/50 shadow-lg space-y-4">
            <div className="flex items-start space-x-4">
              {status.thumbnail && (
                <img src={status.thumbnail} alt="Thumbnail" className="w-24 h-auto rounded object-cover" />
              )}
              <div>
                <p className="text-green-400 font-bold text-sm mb-1">✓ Ready</p>
                <p className="text-sm text-slate-200 line-clamp-2">{status.title}</p>
              </div>
            </div>

            <div className="flex space-x-2 pt-2 border-t border-slate-700">
              <select 
                className="bg-slate-700 text-white p-2 rounded flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                <option value="video">MP4 Video (Best Quality)</option>
                <option value="audio">MP3 Audio (Music/Podcast)</option>
              </select>

              <button 
                onClick={startDownload}
                disabled={downloading}
                className="bg-green-600 hover:bg-green-500 disabled:bg-slate-600 px-6 py-2 rounded font-bold"
              >
                {downloading ? "..." : "Download"}
              </button>
            </div>
            
            {downloadMsg && (
              <p className="text-xs text-yellow-400 mt-2">{downloadMsg}</p>
            )}
          </div>
        )}

        {status && status.valid === false && (
          <div className="mt-6 p-4 bg-red-900/20 rounded-lg border border-red-500/50 text-red-400 text-sm">
            {status.error || "Invalid Link."}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;