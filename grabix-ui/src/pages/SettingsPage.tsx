import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "../context/ThemeContext";
import { useContentFilter } from "../context/ContentFilterContext";
import {
  BACKEND_API,
  backendFetch,
  backendJson,
  fetchDiagnosticsLogs,
  fetchStartupDiagnostics,
  openStartupLog,
  type DiagnosticsLogsPayload,
  type StartupDiagnosticsPayload,
} from "../lib/api";
import { IconFolder, IconSun, IconMoon, IconInfo, IconCheck } from "../components/Icons";
import { DEFAULT_APP_SETTINGS, normalizeAppSettings, readLocalAppSettings, writeLocalAppSettings, type AppSettings } from "../lib/appSettings";
import { clearMediaCache, getMediaCacheStats, pruneExpiredMediaCache } from "../lib/mediaCache";

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
  const { adultContentBlocked, adultPasswordConfigured, unlockAdultContent, configureAdultContent } = useContentFilter();
  const [settings, setSettings] = useState<AppSettings>(() => readLocalAppSettings());
  const [aria2Available, setAria2Available] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [adultError, setAdultError] = useState("");
  const [adultModalOpen, setAdultModalOpen] = useState(false);
  const [adultPassword, setAdultPassword] = useState("");
  const [adultSubmitting, setAdultSubmitting] = useState(false);
  const [selfTest, setSelfTest] = useState<Record<string, unknown> | null>(null);
  const [selfTestRunning, setSelfTestRunning] = useState(false);
  const [startupDiagnostics, setStartupDiagnostics] = useState<StartupDiagnosticsPayload | null>(null);
  const [diagnosticsLogs, setDiagnosticsLogs] = useState<DiagnosticsLogsPayload | null>(null);
  const [cacheStats, setCacheStats] = useState<{ items: number; bytes: number }>({ items: 0, bytes: 0 });
  const [cacheClearing, setCacheClearing] = useState(false);

  useEffect(() => {
    backendJson<Record<string, unknown>>(`${BACKEND_API}/settings`)
      .then((data: Record<string, unknown>) => {
        setSettings(normalizeAppSettings({ ...DEFAULT_APP_SETTINGS, ...readLocalAppSettings(), ...data, theme }));
      })
      .catch(() => {
        // Keep defaults when backend settings are unavailable.
      });

    backendJson<{ engines?: Array<{ id?: string; available?: boolean }> }>(`${BACKEND_API}/download-engines`)
      .then((data: { engines?: Array<{ id?: string; available?: boolean }> }) => {
        const aria2 = data.engines?.find((entry) => entry.id === "aria2");
        setAria2Available(Boolean(aria2?.available));
      })
      .catch(() => setAria2Available(false));

    void fetchStartupDiagnostics().then((payload) => setStartupDiagnostics(payload));
    void fetchDiagnosticsLogs(12).then((payload) => setDiagnosticsLogs(payload)).catch(() => setDiagnosticsLogs(null));
    void pruneExpiredMediaCache().catch(() => undefined);
    void getMediaCacheStats().then(setCacheStats).catch(() => setCacheStats({ items: 0, bytes: 0 }));
  }, []);

  const save = () => {
    setSaveError(false);
    const payload = normalizeAppSettings({ ...settings, theme });
    writeLocalAppSettings(payload);
    backendFetch(`${BACKEND_API}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, { sensitive: true })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Settings save failed with ${response.status}`);
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })
      .catch(() => {
        setSaveError(true);
        setTimeout(() => setSaveError(false), 3000);
      });
  };

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((current) => {
      const next = normalizeAppSettings({ ...current, [key]: value });
      writeLocalAppSettings(next);
      return next;
    });
  };

  const handleClearCache = async () => {
    setCacheClearing(true);
    try {
      await clearMediaCache();
      setCacheStats({ items: 0, bytes: 0 });
    } finally {
      setCacheClearing(false);
    }
  };

  const handleAdultUnlock = async () => {
    setAdultPassword("");
    setAdultError("");
    setAdultModalOpen(true);
  };

  const submitAdultPassword = async () => {
    if (!adultPassword.trim()) {
      setAdultError("Enter a password to continue.");
      return;
    }
    setAdultSubmitting(true);
    setAdultError("");
    try {
      if (adultPasswordConfigured) {
        await unlockAdultContent(adultPassword);
      } else {
        await configureAdultContent(adultPassword);
        await unlockAdultContent(adultPassword);
      }
      setAdultModalOpen(false);
      setAdultPassword("");
    } catch (error) {
      setAdultError(error instanceof Error ? error.message : "Could not unlock adult content.");
    } finally {
      setAdultSubmitting(false);
    }
  };

  const runSelfTest = async () => {
    setSelfTestRunning(true);
    try {
      const payload = await backendJson<Record<string, unknown>>(`${BACKEND_API}/diagnostics/self-test`);
      setSelfTest(payload);
    } catch {
      setSelfTest({
        release_gate: {
          ready: false,
          failed_checks: [{ label: "Backend self-test could not be reached." }],
        },
      });
    } finally {
      setSelfTestRunning(false);
      void fetchDiagnosticsLogs(12).then((payload) => setDiagnosticsLogs(payload)).catch(() => setDiagnosticsLogs(null));
    }
  };

  const exportDiagnostics = async () => {
    try {
      const [backendPayload, startupPayload] = await Promise.all([
        backendJson(`${BACKEND_API}/diagnostics/export`, undefined, { sensitive: true }),
        fetchStartupDiagnostics(),
      ]);
      const blob = new Blob(
        [JSON.stringify({ backend: backendPayload, startup: startupPayload }, null, 2)],
        { type: "application/json" }
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `grabix-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // Ignore export failures.
    }
  };

  const selfTestGate = (selfTest?.release_gate as { ready?: boolean; failed_checks?: Array<{ label?: string; details?: Record<string, unknown> }> } | undefined) || undefined;
  const cacheSizeLabel = cacheStats.bytes >= 1024 * 1024
    ? `${(cacheStats.bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(0, Math.round(cacheStats.bytes / 1024))} KB`;

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
              {settings.download_folder}
            </button>
          </SettingRow>
          <SettingRow label="Default format" sub="Format used when starting a video download">
            <select value={settings.default_format} onChange={(e) => updateSetting("default_format", e.target.value)} style={{ background: "var(--bg-surface2)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 12, fontFamily: "var(--font)", outline: "none" }}>
              <option value="mp4">MP4 (video)</option>
              <option value="mp3">MP3 (audio)</option>
              <option value="webm">WebM</option>
            </select>
          </SettingRow>
          <SettingRow label="Default quality" sub="Video quality preference">
            <select value={settings.default_quality} onChange={(e) => updateSetting("default_quality", e.target.value)} style={{ background: "var(--bg-surface2)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 12, fontFamily: "var(--font)", outline: "none" }}>
              <option>1080p</option>
              <option>720p</option>
              <option>480p</option>
              <option>360p</option>
            </select>
          </SettingRow>
          <SettingRow label="Download engine" sub={aria2Available ? "Choose the stable standard engine or the faster aria2 engine for supported downloads." : "aria2 is not installed right now, so GRABIX will use the standard engine."}>
            <select value={settings.default_download_engine} onChange={(e) => updateSetting("default_download_engine", e.target.value === "aria2" ? "aria2" : "standard")} style={{ background: "var(--bg-surface2)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 12, fontFamily: "var(--font)", outline: "none" }}>
              <option value="standard">Standard (stable)</option>
              <option value="aria2">aria2 (fast)</option>
            </select>
          </SettingRow>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Behaviour</div>
        <div className="card card-padded" style={{ marginBottom: 20 }}>
          <SettingRow label="Auto-fetch on paste" sub="Automatically fetch video info when a URL is pasted">
            <Toggle value={settings.auto_fetch} onChange={(value) => updateSetting("auto_fetch", value)} />
          </SettingRow>
          <SettingRow label="Download notifications" sub="Show a notification when a download completes">
            <Toggle value={settings.notifications} onChange={(value) => updateSetting("notifications", value)} />
          </SettingRow>
          <SettingRow label="Compact media cards" sub="Fit more movies, anime, and manga on screen at once">
            <Toggle value={settings.compact_media_cards} onChange={(value) => updateSetting("compact_media_cards", value)} />
          </SettingRow>
          <SettingRow label="Reduced motion" sub="Make loading and page motion calmer on slower devices">
            <Toggle value={settings.reduced_motion} onChange={(value) => updateSetting("reduced_motion", value)} />
          </SettingRow>
          <SettingRow label="Show rating badges" sub="Show score chips on posters and media cards">
            <Toggle value={settings.show_ratings_badges} onChange={(value) => updateSetting("show_ratings_badges", value)} />
          </SettingRow>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Performance</div>
        <div className="card card-padded" style={{ marginBottom: 20 }}>
          <SettingRow label="Media image cache" sub="Keep posters, covers, and thumbnails locally so they open much faster next time">
            <Toggle value={settings.enable_media_cache} onChange={(value) => updateSetting("enable_media_cache", value)} />
          </SettingRow>
          <SettingRow label="Image cache duration" sub="How long GRABIX keeps saved posters and thumbnails before refreshing them">
            <select value={String(settings.media_cache_days)} onChange={(e) => updateSetting("media_cache_days", Number(e.target.value))} style={{ background: "var(--bg-surface2)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 12, fontFamily: "var(--font)", outline: "none" }}>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </select>
          </SettingRow>
          <SettingRow label="Metadata cache" sub="Keep discover, search, and details data between launches for faster browsing">
            <select value={settings.metadata_cache_mode} onChange={(e) => updateSetting("metadata_cache_mode", e.target.value === "session" ? "session" : "persistent")} style={{ background: "var(--bg-surface2)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 12, fontFamily: "var(--font)", outline: "none" }}>
              <option value="persistent">Persistent</option>
              <option value="session">This session only</option>
            </select>
          </SettingRow>
          <SettingRow label="Stored image cache" sub={`Saved items: ${cacheStats.items} • Approx size: ${cacheSizeLabel}`}>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => void handleClearCache()} disabled={cacheClearing}>
              {cacheClearing ? "Clearing..." : "Clear cache"}
            </button>
          </SettingRow>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Anime</div>
        <div className="card card-padded" style={{ marginBottom: 20 }}>
          <SettingRow label="Preferred anime audio" sub="Choose what GRABIX should prefer first when anime has multiple audio tracks">
            <select value={settings.anime_default_audio} onChange={(e) => updateSetting("anime_default_audio", (e.target.value === "hi" || e.target.value === "original") ? e.target.value : "en")} style={{ background: "var(--bg-surface2)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 12, fontFamily: "var(--font)", outline: "none" }}>
              <option value="en">Dub first</option>
              <option value="original">Sub first</option>
              <option value="hi">Hindi first</option>
            </select>
          </SettingRow>
          <SettingRow label="Preferred anime server" sub="Pick the default Anime server for playback">
            <select value={settings.anime_default_server} onChange={(e) => updateSetting("anime_default_server", (e.target.value === "hd-1" || e.target.value === "hd-2") ? e.target.value : "auto")} style={{ background: "var(--bg-surface2)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 12, fontFamily: "var(--font)", outline: "none" }}>
              <option value="auto">Auto</option>
              <option value="hd-1">HD-1</option>
              <option value="hd-2">HD-2</option>
            </select>
          </SettingRow>
          <SettingRow label="Auto-play next episode" sub="Move to the next episode when the current one finishes">
            <Toggle value={settings.anime_auto_play_next} onChange={(value) => updateSetting("anime_auto_play_next", value)} />
          </SettingRow>
          <SettingRow label="Preload next episode" sub="Warm the next episode in the background for smoother anime playback">
            <Toggle value={settings.anime_preload_next_episode} onChange={(value) => updateSetting("anime_preload_next_episode", value)} />
          </SettingRow>
          <SettingRow label="Show anime trailers" sub="Keep trailer playback and trailer buttons available on anime details">
            <Toggle value={settings.anime_show_trailers} onChange={(value) => updateSetting("anime_show_trailers", value)} />
          </SettingRow>
          <SettingRow label="Prefer fallback playback" sub="Use GRABIX fallback playback sooner when the main Anime engine is slow">
            <Toggle value={settings.anime_prefer_fallback} onChange={(value) => updateSetting("anime_prefer_fallback", value)} />
          </SettingRow>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Manga</div>
        <div className="card card-padded" style={{ marginBottom: 20 }}>
          <SettingRow label="Default manga language" sub="Open manga chapters in this language first when available">
            <select value={settings.manga_default_language} onChange={(e) => updateSetting("manga_default_language", e.target.value)} style={{ background: "var(--bg-surface2)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 12, fontFamily: "var(--font)", outline: "none" }}>
              <option value="en">English</option>
              <option value="ar">Arabic</option>
              <option value="hi">Hindi</option>
              <option value="ur">Urdu</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
            </select>
          </SettingRow>
          <SettingRow label="Manga reader mode" sub="Choose the normal reader, faster reader, backup reader, or let GRABIX decide">
            <select value={settings.manga_reader_mode} onChange={(e) => updateSetting("manga_reader_mode", (["fast", "backup", "auto"].includes(e.target.value) ? e.target.value : "standard") as AppSettings["manga_reader_mode"])} style={{ background: "var(--bg-surface2)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 12, fontFamily: "var(--font)", outline: "none" }}>
              <option value="standard">Standard</option>
              <option value="fast">Fast</option>
              <option value="backup">Backup</option>
              <option value="auto">Auto</option>
            </select>
          </SettingRow>
          <SettingRow label="Auto-open first chapter" sub="Jump straight into reading when you open manga details">
            <Toggle value={settings.manga_auto_open_first_chapter} onChange={(value) => updateSetting("manga_auto_open_first_chapter", value)} />
          </SettingRow>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Movies & TV</div>
        <div className="card card-padded" style={{ marginBottom: 20 }}>
          <SettingRow label="Movie quality target" sub="Preferred stream quality for movies when multiple choices exist">
            <select value={settings.movies_prefer_quality} onChange={(e) => updateSetting("movies_prefer_quality", (e.target.value === "720p" || e.target.value === "480p") ? e.target.value : "1080p")} style={{ background: "var(--bg-surface2)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 12, fontFamily: "var(--font)", outline: "none" }}>
              <option value="1080p">1080p</option>
              <option value="720p">720p</option>
              <option value="480p">480p</option>
            </select>
          </SettingRow>
          <SettingRow label="TV quality target" sub="Preferred stream quality for TV series when multiple choices exist">
            <select value={settings.tv_prefer_quality} onChange={(e) => updateSetting("tv_prefer_quality", (e.target.value === "720p" || e.target.value === "480p") ? e.target.value : "1080p")} style={{ background: "var(--bg-surface2)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 12, fontFamily: "var(--font)", outline: "none" }}>
              <option value="1080p">1080p</option>
              <option value="720p">720p</option>
              <option value="480p">480p</option>
            </select>
          </SettingRow>
          <SettingRow label="Prefer Hindi in Movie Box" sub="Try Hindi-first choices when browsing or opening Movie Box content">
            <Toggle value={settings.moviebox_prefer_hindi} onChange={(value) => updateSetting("moviebox_prefer_hindi", value)} />
          </SettingRow>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Content Filter</div>
        <div className="card card-padded" style={{ marginBottom: 20 }}>
          <SettingRow
            label="Adult content"
            sub={adultContentBlocked ? "Blocked across the app until you unlock it for this session." : "Unlocked for this session only. It will reset after app restart."}
          >
            {adultContentBlocked ? (
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => void handleAdultUnlock()}>
                {adultPasswordConfigured ? "Enable Adult Content" : "Set Adult Password"}
              </button>
            ) : (
              <span style={{ fontSize: 12, color: "var(--text-success)", fontWeight: 600 }}>Unlocked for this session</span>
            )}
          </SettingRow>
          {adultError && (
            <div style={{ fontSize: 12, color: "var(--text-danger)", paddingTop: 10 }}>
              {adultError}
            </div>
          )}
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
          <SettingRow label="Fast engine" sub="aria2 multi-connection downloader availability">
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: aria2Available ? "var(--text-success)" : "var(--text-muted)" }}>
              <IconCheck size={13} /> {aria2Available ? "aria2 ready" : "Not installed"}
            </div>
          </SettingRow>
          <div style={{ paddingTop: 10, display: "flex", alignItems: "flex-start", gap: 8, color: "var(--text-muted)", fontSize: 12 }}>
            <IconInfo size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            GRABIX is free and open source. For legal use only, respect copyright.
          </div>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: 1, textTransform: "uppercase", marginTop: 20, marginBottom: 4 }}>Diagnostics</div>
        <div className="card card-padded">
          <SettingRow label="Release self-test" sub="Runs the local shipping checks against backend, library, storage, and providers">
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => void runSelfTest()} disabled={selfTestRunning}>
              {selfTestRunning ? "Running..." : "Run self-test"}
            </button>
          </SettingRow>
          <SettingRow label="Export diagnostics" sub="Save a local diagnostics JSON bundle for debugging installer/runtime issues">
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => void exportDiagnostics()}>
              Export JSON
            </button>
          </SettingRow>
          <SettingRow label="Startup log" sub="Open the packaged-app startup log if sidecars fail to boot in the installer build">
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => void openStartupLog()}>
              Open log
            </button>
          </SettingRow>
          {startupDiagnostics ? (
            <div style={{ paddingTop: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
              Backend: {startupDiagnostics.backend.status} • Anime Provider: {startupDiagnostics.consumet.status}
            </div>
          ) : null}
          {diagnosticsLogs?.backend_log_path ? (
            <div style={{ paddingTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, wordBreak: "break-all" }}>
              Backend log: {diagnosticsLogs.backend_log_path}
            </div>
          ) : null}
          {selfTestGate ? (
            <div style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "var(--bg-surface2)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: selfTestGate.ready ? "var(--text-success)" : "var(--text-danger)" }}>
                {selfTestGate.ready ? "Release gate passed" : "Release gate has failed checks"}
              </div>
              {!selfTestGate.ready && Array.isArray(selfTestGate.failed_checks) ? (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "var(--text-secondary)" }}>
                  {selfTestGate.failed_checks.map((check, index) => (
                    <div key={index}>
                      {check.label || "Unnamed check"}
                      {check.details?.broken_items ? ` (${check.details.broken_items} broken item(s))` : ""}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <div style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "var(--bg-surface2)" }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Recent failures and warnings</div>
            {diagnosticsLogs?.events?.length ? (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                {diagnosticsLogs.events.slice().reverse().map((entry, index) => (
                  <div key={`${entry.timestamp}-${index}`} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: "var(--bg-surface)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", fontSize: 11, color: "var(--text-muted)" }}>
                      <span>{entry.service} â€¢ {entry.level}</span>
                      <span>{entry.timestamp}</span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600 }}>{entry.message}</div>
                    {entry.correlation_id ? (
                      <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                        Correlation: {entry.correlation_id}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                No recent warnings or failures were recorded.
              </div>
            )}
          </div>
        </div>
      </div>

      {adultModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 220 }} onClick={() => !adultSubmitting && setAdultModalOpen(false)}>
          <div className="card card-padded" style={{ width: "100%", maxWidth: 420, border: "1px solid var(--border)" }} onClick={(event) => event.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{adultPasswordConfigured ? "Unlock Adult Content" : "Set Adult Content Password"}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 14 }}>
              {adultPasswordConfigured ? "Enter the password to unlock adult content for this session." : "Create a password for adult-content access on this device."}
            </div>
            <input
              className="input-base"
              type="password"
              autoFocus
              value={adultPassword}
              onChange={(event) => setAdultPassword(event.target.value)}
              placeholder={adultPasswordConfigured ? "Enter password" : "Create password"}
              style={{ width: "100%", marginBottom: 10 }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !adultSubmitting) {
                  void submitAdultPassword();
                }
              }}
            />
            {adultError ? <div style={{ fontSize: 12, color: "var(--text-danger)", marginBottom: 12 }}>{adultError}</div> : null}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setAdultModalOpen(false)} disabled={adultSubmitting}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void submitAdultPassword()} disabled={adultSubmitting || !adultPassword.trim()}>
                {adultSubmitting ? "Please wait..." : adultPasswordConfigured ? "Unlock" : "Save & Unlock"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
