import { useState, useRef } from "react";
import {
  IconConvert, IconFolder, IconX, IconAlert, IconUpload,
} from "../components/Icons";
import { BACKEND_API, backendFetch } from "../lib/api";
const API = BACKEND_API;

// ── Types ──────────────────────────────────────────────────────────────────────

interface ConvertJob {
  id: string;          // local UI id
  jobId: string;       // server job id
  inputPath: string;
  inputName: string;
  outputFormat: string;
  status: "queued" | "converting" | "done" | "failed";
  percent: number;
  outputPath: string;
  error: string;
}

// Format groups shown in the UI
const FORMAT_GROUPS = [
  {
    label: "Video",
    formats: [
      { id: "mp4",  label: "MP4",  note: "Most compatible" },
      { id: "webm", label: "WebM", note: "Web-friendly" },
      { id: "mkv",  label: "MKV",  note: "Lossless copy" },
      { id: "gif",  label: "GIF",  note: "Animated (small)" },
    ],
  },
  {
    label: "Audio",
    formats: [
      { id: "mp3",  label: "MP3",  note: "Universal" },
      { id: "m4a",  label: "M4A",  note: "iTunes/Apple" },
      { id: "opus", label: "Opus", note: "Small + quality" },
      { id: "flac", label: "FLAC", note: "Lossless" },
      { id: "wav",  label: "WAV",  note: "Uncompressed" },
    ],
  },
];

function uid() { return Math.random().toString(36).slice(2); }

// ── Component ─────────────────────────────────────────────────────────────────

export default function ConverterPage() {
  const [inputPath, setInputPath] = useState("");
  const [outputFormat, setOutputFormat] = useState("mp4");
  const [jobs, setJobs] = useState<ConvertJob[]>([]);
  const [ffmpegOk, setFfmpegOk] = useState<boolean | null>(null);
  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // Check FFmpeg on first render
  useState(() => {
    fetch(`${API}/ffmpeg-status`)
      .then(r => r.json())
      .then(d => setFfmpegOk(d.available))
      .catch(() => setFfmpegOk(false));
  });

  const startConvert = async () => {
    const path = inputPath.trim();
    if (!path || !outputFormat) return;

    const localId = uid();
    const name = path.split(/[\\/]/).pop() ?? path;

    const newJob: ConvertJob = {
      id: localId,
      jobId: "",
      inputPath: path,
      inputName: name,
      outputFormat,
      status: "queued",
      percent: 0,
      outputPath: "",
      error: "",
    };
    setJobs(prev => [newJob, ...prev]);
    setInputPath("");

    try {
      const res = await backendFetch(
        `${API}/convert?input_path=${encodeURIComponent(path)}&output_format=${outputFormat}`,
        { method: "POST" },
        { sensitive: true }
      );
      if (!res.ok) {
        throw new Error(`Convert start failed with ${res.status}`);
      }
      const data = await res.json();
      const jobId = data.job_id;

      setJobs(prev => prev.map(j => j.id === localId ? { ...j, jobId } : j));

      // Poll progress
      const interval = setInterval(async () => {
        try {
          const pr = await fetch(`${API}/convert-status/${jobId}`);
          const pd = await pr.json();
          setJobs(prev => prev.map(j => j.id === localId
            ? {
                ...j,
                status: pd.status,
                percent: pd.percent ?? 0,
                outputPath: pd.output_path ?? "",
                error: pd.error ?? "",
              }
            : j
          ));
          if (pd.status === "done" || pd.status === "failed") {
            clearInterval(interval);
            pollingRef.current.delete(localId);
          }
        } catch { clearInterval(interval); }
      }, 800);
      pollingRef.current.set(localId, interval);

    } catch {
      // FFmpeg offline / backend down — show error immediately
      setJobs(prev => prev.map(j => j.id === localId
        ? { ...j, status: "failed", error: "Backend not reachable. Is the GRABIX backend running?" }
        : j
      ));
    }
  };

  const removeJob = (id: string) => {
    const interval = pollingRef.current.get(id);
    if (interval) { clearInterval(interval); pollingRef.current.delete(id); }
    setJobs(prev => prev.filter(j => j.id !== id));
  };

  const openOutput = async (path: string) => {
    if (!path) return;
    try {
      const response = await backendFetch(`${API}/open-download-folder?path=${encodeURIComponent(path)}`, { method: "POST" }, { sensitive: true });
      if (!response.ok) {
        throw new Error(`Could not open folder (${response.status})`);
      }
    } catch { /* offline */ }
  };

  const activeCount = jobs.filter(j => j.status === "converting" || j.status === "queued").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* ── Topbar ── */}
      <div style={{
        padding: "14px 24px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Converter</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>
            Convert local media files to a different format
          </div>
        </div>
        {activeCount > 0 && (
          <span style={{
            fontSize: 12, color: "var(--text-accent)",
            background: "var(--accent-light)", padding: "4px 10px",
            borderRadius: 99, fontWeight: 500,
            display: "flex", alignItems: "center", gap: 5,
          }}>
            <span className="pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />
            {activeCount} converting
          </span>
        )}
      </div>

      {/* ── Scroll area ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* FFmpeg warning */}
        {ffmpegOk === false && (
          <div className="fade-in" style={{
            padding: "12px 16px", borderRadius: "var(--radius-sm)",
            background: "var(--bg-surface2)", border: "1px solid var(--warning)",
            display: "flex", alignItems: "flex-start", gap: 10,
            fontSize: 13, color: "var(--text-warning)",
          }}>
            <IconAlert size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <strong>FFmpeg not found.</strong> Conversion requires FFmpeg.{" "}
              Install it from <strong>ffmpeg.org</strong> and add it to your PATH, then restart the backend.
            </div>
          </div>
        )}

        {/* ── Input card ── */}
        <div className="card card-padded">
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 10, letterSpacing: 0.5, textTransform: "uppercase" }}>
            File Path
          </div>

          {/* Path input */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <IconUpload size={15} color="var(--text-muted)" />
              </div>
              <input
                className="input-base"
                style={{ paddingLeft: 38 }}
                placeholder="C:\Users\you\Downloads\GRABIX\video.mp4"
                value={inputPath}
                onChange={e => setInputPath(e.target.value)}
                onKeyDown={e => e.key === "Enter" && startConvert()}
              />
            </div>
          </div>

          <div className="divider" style={{ marginBottom: 16 }} />

          {/* Format selector */}
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 10, letterSpacing: 0.5, textTransform: "uppercase" }}>
            Convert to
          </div>

          {FORMAT_GROUPS.map(group => (
            <div key={group.label} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, marginBottom: 6 }}>
                {group.label}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {group.formats.map(fmt => (
                  <button
                    key={fmt.id}
                    className={`filetype-tab${outputFormat === fmt.id ? " active" : ""}`}
                    onClick={() => setOutputFormat(fmt.id)}
                    style={{ flexDirection: "column", alignItems: "flex-start", gap: 1, padding: "8px 12px" }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{fmt.label}</span>
                    <span style={{ fontSize: 10, fontWeight: 400, color: outputFormat === fmt.id ? "rgba(255,255,255,0.7)" : "var(--text-muted)" }}>
                      {fmt.note}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="divider" style={{ marginBottom: 16 }} />

          {/* Convert button */}
          <button
            className="btn btn-primary"
            style={{ height: 40, paddingLeft: 20, paddingRight: 20, fontSize: 14 }}
            onClick={startConvert}
            disabled={!inputPath.trim() || ffmpegOk === false}
          >
            <IconConvert size={15} />
            Convert to {outputFormat.toUpperCase()}
          </button>
        </div>

        {/* ── Job list ── */}
        {jobs.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>Jobs ({jobs.length})</span>
              {jobs.every(j => j.status === "done" || j.status === "failed") && (
                <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setJobs([])}>
                  Clear all
                </button>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {jobs.map(job => (
                <ConvertJobCard key={job.id} job={job} onRemove={removeJob} onOpenOutput={openOutput} />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {jobs.length === 0 && (
          <div className="empty-state">
            <IconConvert size={40} color="var(--text-muted)" />
            <p>No conversions yet</p>
            <span>Paste a file path above and choose an output format</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Job card ──────────────────────────────────────────────────────────────────

function ConvertJobCard({
  job, onRemove, onOpenOutput,
}: {
  job: ConvertJob;
  onRemove: (id: string) => void;
  onOpenOutput: (path: string) => void;
}) {
  const isDone   = job.status === "done";
  const isFailed = job.status === "failed";
  const isActive = job.status === "converting" || job.status === "queued";

  const statusColor = {
    done: "var(--success)", failed: "var(--danger)",
    converting: "var(--accent)", queued: "var(--text-muted)",
  }[job.status] ?? "var(--text-muted)";

  const statusLabel = {
    done: "Done", failed: "Failed", converting: "Converting…", queued: "Queued",
  }[job.status] ?? job.status;

  return (
    <div className="card fade-in" style={{ padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Icon */}
        <div style={{
          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
          background: "var(--bg-surface2)", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <IconConvert size={16} color="var(--text-accent)" />
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {job.inputName}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
            <span style={{ fontSize: 11, color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>→ {job.outputFormat.toUpperCase()}</span>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {isDone && (
            <div className="tooltip-wrap">
              <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onOpenOutput(job.outputPath)}>
                <IconFolder size={13} />
              </button>
              <span className="tooltip-box">Show in folder</span>
            </div>
          )}
          <div className="tooltip-wrap">
            <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => onRemove(job.id)}>
              <IconX size={13} />
            </button>
            <span className="tooltip-box">Remove</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      {isActive && (
        <div style={{ marginTop: 10 }}>
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{ width: `${job.percent}%` }} />
          </div>
          <div style={{ marginTop: 5, fontSize: 11, color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
            <span>{job.percent}%</span>
            <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 300, whiteSpace: "nowrap" }}>
              {job.inputPath}
            </span>
          </div>
        </div>
      )}

      {/* Done summary */}
      {isDone && (
        <div style={{ marginTop: 8, padding: "8px 10px", background: "var(--bg-surface2)", borderRadius: "var(--radius-sm)", fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span style={{ color: "var(--text-success)", marginRight: 6 }}>✓</span>
          {job.outputPath}
        </div>
      )}

      {/* Error */}
      {isFailed && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: "var(--text-danger)" }}>
          <IconAlert size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          {job.error || "Conversion failed."}
        </div>
      )}
    </div>
  );
}
