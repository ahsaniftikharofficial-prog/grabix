import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "../context/ThemeContext";
import { useContentFilter } from "../context/ContentFilterContext";
import {
  BACKEND_API,
  backendFetch,
  backendJson,
  fetchDiagnosticsLogs,
  fetchStartupDiagnostics,
  type DiagnosticsLogsPayload,
  type StartupDiagnosticsPayload,
} from "../lib/api";
import { IconFolder, IconSun, IconMoon, IconInfo, IconCheck } from "../components/Icons";

// ─── Types ────────────────────────────────────────────────────────────────────

type NavSection =
  | "appearance"
  | "downloads"
  | "player"
  | "browsing"
  | "library"
  | "manga"
  | "network"
  | "about";

interface SegmentOption { label: string; value: string }

// ─── Nav SVG icons (match the app's lucide-style icon weight) ─────────────────

function NavIconAppearance() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
    </svg>
  );
}

function NavIconDownloads() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  );
}

function NavIconPlayer() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  );
}

function NavIconBrowsing() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}

function NavIconLibrary() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  );
}

function NavIconManga() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
    </svg>
  );
}

function NavIconNetwork() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  );
}

function NavIconAbout() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function SettingRow({ label, sub, children }: { label: string; sub: string; children: ReactNode }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "14px 0",
      borderBottom: "1px solid var(--border)",
    }}>
      <div style={{ flex: 1, paddingRight: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.45 }}>{sub}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        width: 40, height: 22, borderRadius: 99, cursor: "pointer",
        background: value ? "var(--accent)" : "var(--border)",
        position: "relative", transition: "background 0.2s", flexShrink: 0,
      }}
    >
      <div style={{
        position: "absolute", top: 3,
        left: value ? 21 : 3,
        width: 16, height: 16, borderRadius: "50%",
        background: "white", transition: "left 0.2s",
        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
      }} />
    </div>
  );
}

function SegmentedControl({ options, value, onChange }: {
  options: SegmentOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
      {options.map((opt, i) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            padding: "5px 11px", fontSize: 12,
            background: value === opt.value ? "var(--text-primary)" : "transparent",
            color: value === opt.value ? "var(--bg-surface)" : "var(--text-muted)",
            border: "none",
            borderLeft: i === 0 ? "none" : "1px solid var(--border)",
            cursor: "pointer", transition: "background 0.15s, color 0.15s",
            fontFamily: "var(--font)",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SelectInput({ value, onChange, children }: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: "var(--bg-surface2)", color: "var(--text-primary)",
        border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
        padding: "6px 10px", fontSize: 13, fontFamily: "var(--font)", outline: "none",
      }}
    >
      {children}
    </select>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
      letterSpacing: "0.08em", textTransform: "uppercase",
      marginBottom: 6, marginTop: 20,
    }}>
      {children}
    </div>
  );
}

// ─── Sidebar nav item ─────────────────────────────────────────────────────────

function NavItem({
  icon, label, active, onClick,
}: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%", padding: "9px 16px",
        background: active ? "var(--bg-surface2)" : "transparent",
        border: "none", borderRadius: 0,
        color: active ? "var(--text-primary)" : "var(--text-muted)",
        fontSize: 13, fontWeight: active ? 600 : 400,
        cursor: "pointer", textAlign: "left",
        transition: "background 0.15s, color 0.15s",
        fontFamily: "var(--font)",
      }}
    >
      <span style={{ width: 18, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {icon}
      </span>
      {label}
    </button>
  );
}

// ─── Accent color swatches ────────────────────────────────────────────────────

const ACCENT_COLORS: { id: string; hex: string; label: string }[] = [
  { id: "purple", hex: "#7F77DD", label: "Purple" },
  { id: "teal",   hex: "#1D9E75", label: "Teal"   },
  { id: "coral",  hex: "#D85A30", label: "Coral"  },
  { id: "blue",   hex: "#378ADD", label: "Blue"   },
  { id: "pink",   hex: "#D4537E", label: "Pink"   },
  { id: "amber",  hex: "#D49A20", label: "Amber"  },
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { theme, toggle } = useTheme();
  const { adultContentBlocked, adultPasswordConfigured, unlockAdultContent, configureAdultContent } = useContentFilter();

  // ── Nav
  const [activeSection, setActiveSection] = useState<NavSection>("appearance");

  // ── Appearance
  const [accentColor, setAccentColor] = useState("purple");
  const [cardDensity, setCardDensity] = useState("normal");

  // ── Downloads
  const [downloadFolder, setDownloadFolder] = useState("~/Downloads/GRABIX");
  const [maxConcurrent, setMaxConcurrent] = useState(3);
  const [format, setFormat] = useState("mp4");
  const [quality, setQuality] = useState("1080p");
  const [downloadEngine, setDownloadEngine] = useState<"standard" | "aria2">("standard");
  const [autoStartDownloads, setAutoStartDownloads] = useState(true);
  const [autoFetch, setAutoFetch] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [aria2Available, setAria2Available] = useState(false);

  // ── Player
  const [defaultAudioTrack, setDefaultAudioTrack] = useState("dub");
  const [defaultSubtitleLang, setDefaultSubtitleLang] = useState("en");
  const [subtitleFontSize, setSubtitleFontSize] = useState("medium");
  const [autoplayNextEpisode, setAutoplayNextEpisode] = useState(true);
  const [skipIntro, setSkipIntro] = useState(false);

  // ── Browsing
  const [preferredAnimeProvider, setPreferredAnimeProvider] = useState("hianime");
  const [preferredMovieSource, setPreferredMovieSource] = useState("moviebox");
  const [defaultLandingTab, setDefaultLandingTab] = useState("trending");
  const [showRatingsOnCards, setShowRatingsOnCards] = useState(true);
  const [sfwMode, setSfwMode] = useState(false);

  // ── Library
  const [autoClearCompleted, setAutoClearCompleted] = useState(false);
  const [libraryDefaultSort, setLibraryDefaultSort] = useState("date_desc");
  const [enableMediaCache, setEnableMediaCache] = useState(true);
  const [mediaCacheDays, setMediaCacheDays] = useState("7");

  // ── Manga
  const [mangaReadingDirection, setMangaReadingDirection] = useState("rtl");
  const [mangaPageLayout, setMangaPageLayout] = useState("single");

  // ── Network
  const [httpProxyUrl, setHttpProxyUrl] = useState("");

  // ── Save state
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // ── Adult content
  const [adultError, setAdultError] = useState("");
  const [adultModalOpen, setAdultModalOpen] = useState(false);
  const [adultPassword, setAdultPassword] = useState("");
  const [adultSubmitting, setAdultSubmitting] = useState(false);

  // ── TMDB
  const [tmdbToken, setTmdbToken] = useState("");
  const [tmdbTokenVisible, setTmdbTokenVisible] = useState(false);
  const [tmdbConfigured, setTmdbConfigured] = useState<boolean | null>(null);
  const [tmdbSaving, setTmdbSaving] = useState(false);
  const [tmdbSaveMsg, setTmdbSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ── Diagnostics
  const [selfTest, setSelfTest] = useState<Record<string, unknown> | null>(null);
  const [selfTestRunning, setSelfTestRunning] = useState(false);
  const [startupDiagnostics, setStartupDiagnostics] = useState<StartupDiagnosticsPayload | null>(null);
  const [diagnosticsLogs, setDiagnosticsLogs] = useState<DiagnosticsLogsPayload | null>(null);

  // ─── Load settings ──────────────────────────────────────────────────────────

  useEffect(() => {
    backendJson<Record<string, unknown>>(`${BACKEND_API}/settings`)
      .then((data: Record<string, unknown>) => {
        // Appearance
        if (typeof data.accent_color === "string") setAccentColor(data.accent_color);
        if (typeof data.card_density === "string") setCardDensity(data.card_density);

        // Downloads
        if (typeof data.download_folder === "string" && data.download_folder.trim()) setDownloadFolder(data.download_folder);
        if (typeof data.max_concurrent_downloads === "number") setMaxConcurrent(data.max_concurrent_downloads);
        if (typeof data.default_format === "string") setFormat(data.default_format);
        if (typeof data.default_quality === "string") setQuality(data.default_quality);
        if (data.default_download_engine === "aria2" || data.default_download_engine === "standard") setDownloadEngine(data.default_download_engine);
        if (typeof data.auto_start_downloads === "boolean") setAutoStartDownloads(data.auto_start_downloads);
        if (typeof data.auto_fetch === "boolean") setAutoFetch(data.auto_fetch);
        if (typeof data.notifications === "boolean") setNotifications(data.notifications);

        // Player
        if (typeof data.default_audio_track === "string") setDefaultAudioTrack(data.default_audio_track);
        if (typeof data.default_subtitle_lang === "string") setDefaultSubtitleLang(data.default_subtitle_lang);
        if (typeof data.subtitle_font_size === "string") setSubtitleFontSize(data.subtitle_font_size);
        if (typeof data.autoplay_next_episode === "boolean") setAutoplayNextEpisode(data.autoplay_next_episode);
        if (typeof data.skip_intro === "boolean") setSkipIntro(data.skip_intro);

        // Browsing
        if (typeof data.preferred_anime_provider === "string") setPreferredAnimeProvider(data.preferred_anime_provider);
        if (typeof data.preferred_movie_source === "string") setPreferredMovieSource(data.preferred_movie_source);
        if (typeof data.default_landing_tab === "string") setDefaultLandingTab(data.default_landing_tab);
        if (typeof data.show_ratings_on_cards === "boolean") setShowRatingsOnCards(data.show_ratings_on_cards);
        if (typeof data.sfw_mode === "boolean") setSfwMode(data.sfw_mode);

        // Library
        if (typeof data.auto_clear_completed === "boolean") setAutoClearCompleted(data.auto_clear_completed);
        if (typeof data.library_default_sort === "string") setLibraryDefaultSort(data.library_default_sort);
        if (typeof data.enable_media_cache === "boolean") setEnableMediaCache(data.enable_media_cache);
        if (typeof data.media_cache_days === "number") setMediaCacheDays(String(data.media_cache_days));

        // Manga
        if (typeof data.manga_reading_direction === "string") setMangaReadingDirection(data.manga_reading_direction);
        if (typeof data.manga_page_layout === "string") setMangaPageLayout(data.manga_page_layout);

        // Network
        if (typeof data.http_proxy_url === "string") setHttpProxyUrl(data.http_proxy_url);
      })
      .catch(() => { /* Keep defaults */ });

    backendJson<{ engines?: Array<{ id?: string; available?: boolean }> }>(`${BACKEND_API}/download-engines`)
      .then((data) => {
        const aria2 = data.engines?.find((e) => e.id === "aria2");
        setAria2Available(Boolean(aria2?.available));
      })
      .catch(() => setAria2Available(false));

    backendJson<{ configured: boolean; source: string }>(`${BACKEND_API}/tmdb-status`)
      .then((data) => setTmdbConfigured(data.configured))
      .catch(() => setTmdbConfigured(false));

    void fetchStartupDiagnostics().then((p) => setStartupDiagnostics(p));
    void fetchDiagnosticsLogs(12).then((p) => setDiagnosticsLogs(p)).catch(() => setDiagnosticsLogs(null));
  }, []);

  // ─── Save all settings ──────────────────────────────────────────────────────

  const save = () => {
    setSaveError(false);
    backendFetch(`${BACKEND_API}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Appearance
        theme,
        accent_color: accentColor,
        card_density: cardDensity,
        // Downloads
        auto_fetch: autoFetch,
        notifications,
        default_format: format,
        default_quality: quality,
        default_download_engine: downloadEngine,
        max_concurrent_downloads: maxConcurrent,
        auto_start_downloads: autoStartDownloads,
        // Player
        default_audio_track: defaultAudioTrack,
        default_subtitle_lang: defaultSubtitleLang,
        subtitle_font_size: subtitleFontSize,
        autoplay_next_episode: autoplayNextEpisode,
        skip_intro: skipIntro,
        // Browsing
        preferred_anime_provider: preferredAnimeProvider,
        preferred_movie_source: preferredMovieSource,
        default_landing_tab: defaultLandingTab,
        show_ratings_on_cards: showRatingsOnCards,
        sfw_mode: sfwMode,
        // Library
        auto_clear_completed: autoClearCompleted,
        library_default_sort: libraryDefaultSort,
        enable_media_cache: enableMediaCache,
        media_cache_days: Number(mediaCacheDays),
        // Manga
        manga_reading_direction: mangaReadingDirection,
        manga_page_layout: mangaPageLayout,
        // Network
        http_proxy_url: httpProxyUrl,
      }),
    }, { sensitive: true })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Save failed: ${response.status}`);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })
      .catch(() => {
        setSaveError(true);
        setTimeout(() => setSaveError(false), 3000);
      });
  };

  // ─── TMDB helpers ────────────────────────────────────────────────────────────

  const saveTmdbToken = async () => {
    setTmdbSaving(true);
    setTmdbSaveMsg(null);
    try {
      const result = await backendJson<{ ok: boolean; configured: boolean }>(
        `${BACKEND_API}/tmdb-token`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: tmdbToken }) }
      );
      setTmdbConfigured(result.configured);
      setTmdbToken("");
      setTmdbSaveMsg({
        ok: true,
        text: result.configured ? "Token saved. Movies will load now — no restart needed." : "Token cleared.",
      });
    } catch {
      setTmdbSaveMsg({ ok: false, text: "Could not save token. Is the backend running?" });
    } finally {
      setTmdbSaving(false);
      setTimeout(() => setTmdbSaveMsg(null), 5000);
    }
  };

  const removeTmdbToken = async () => {
    setTmdbSaving(true);
    try {
      await backendJson(`${BACKEND_API}/tmdb-token`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "" }),
      });
      setTmdbConfigured(false);
      setTmdbToken("");
      setTmdbSaveMsg({ ok: true, text: "Token removed." });
    } catch {
      setTmdbSaveMsg({ ok: false, text: "Could not remove token." });
    } finally {
      setTmdbSaving(false);
      setTimeout(() => setTmdbSaveMsg(null), 3000);
    }
  };

  // ─── Adult content helpers ───────────────────────────────────────────────────

  const handleAdultUnlock = async () => {
    setAdultPassword("");
    setAdultError("");
    setAdultModalOpen(true);
  };

  const submitAdultPassword = async () => {
    if (!adultPassword.trim()) { setAdultError("Enter a password to continue."); return; }
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

  // ─── Diagnostics helpers ─────────────────────────────────────────────────────

  const runSelfTest = async () => {
    setSelfTestRunning(true);
    try {
      const payload = await backendJson<Record<string, unknown>>(`${BACKEND_API}/diagnostics/self-test`);
      setSelfTest(payload);
    } catch {
      setSelfTest({ release_gate: { ready: false, failed_checks: [{ label: "Backend self-test could not be reached." }] } });
    } finally {
      setSelfTestRunning(false);
      void fetchDiagnosticsLogs(12).then((p) => setDiagnosticsLogs(p)).catch(() => setDiagnosticsLogs(null));
    }
  };

  const selfTestGate = (selfTest?.release_gate as {
    ready?: boolean;
    failed_checks?: Array<{ label?: string; details?: Record<string, unknown> }>;
  } | undefined) || undefined;

  // ─── Select styles helper ────────────────────────────────────────────────────

  const selectStyle: React.CSSProperties = {
    background: "var(--bg-surface2)", color: "var(--text-primary)",
    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
    padding: "6px 10px", fontSize: 13, fontFamily: "var(--font)", outline: "none",
  };

  // ─── Section content ─────────────────────────────────────────────────────────

  const renderAppearance = () => (
    <>
      <div className="card card-padded">
        <SettingRow label="Theme" sub="Switch between light and dark mode">
          <button className="btn btn-ghost" style={{ gap: 6, fontSize: 13 }} onClick={toggle}>
            {theme === "dark" ? <IconSun size={14} /> : <IconMoon size={14} />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </SettingRow>

        <SettingRow label="Accent color" sub="Drives chips, badges, active states and links across the app">
          <div style={{ display: "flex", gap: 7 }}>
            {ACCENT_COLORS.map(({ id, hex, label }) => (
              <button
                key={id}
                title={label}
                onClick={() => setAccentColor(id)}
                style={{
                  width: 20, height: 20, borderRadius: "50%", border: "none",
                  background: hex, cursor: "pointer", flexShrink: 0,
                  outline: accentColor === id ? `2px solid var(--text-primary)` : "2px solid transparent",
                  outlineOffset: 2, transition: "outline 0.15s",
                }}
              />
            ))}
          </div>
        </SettingRow>

        <div style={{ borderBottom: "none" }}>
          <SettingRow label="Card grid density" sub="Size of poster cards across all browse pages">
            <SegmentedControl
              value={cardDensity}
              onChange={setCardDensity}
              options={[
                { label: "Compact", value: "compact" },
                { label: "Normal",  value: "normal"  },
                { label: "Large",   value: "large"   },
              ]}
            />
          </SettingRow>
        </div>
      </div>
    </>
  );

  const renderDownloads = () => (
    <>
      <SectionLabel>Storage</SectionLabel>
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <SettingRow label="Download folder" sub="Where completed files are saved on your computer">
          <button className="btn btn-ghost" style={{ gap: 6, fontSize: 13 }}>
            <IconFolder size={14} />
            {downloadFolder}
          </button>
        </SettingRow>
      </div>

      <SectionLabel>Format & Quality</SectionLabel>
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <SettingRow label="Default format" sub="Container format used when starting a video download">
          <SelectInput value={format} onChange={setFormat}>
            <option value="mp4">MP4 (video)</option>
            <option value="mp3">MP3 (audio only)</option>
            <option value="webm">WebM</option>
            <option value="mkv">MKV</option>
          </SelectInput>
        </SettingRow>

        <SettingRow label="Default quality" sub="Preferred resolution when multiple options are available">
          <SelectInput value={quality} onChange={setQuality}>
            <option>1080p</option>
            <option>720p</option>
            <option>480p</option>
            <option>360p</option>
          </SelectInput>
        </SettingRow>
      </div>

      <SectionLabel>Engine & Behaviour</SectionLabel>
      <div className="card card-padded">
        <SettingRow
          label="Download engine"
          sub={aria2Available
            ? "Choose the stable standard engine or the faster aria2 for supported downloads."
            : "aria2 is not installed — GRABIX will use the standard engine."}
        >
          <SelectInput value={downloadEngine} onChange={(v) => setDownloadEngine(v as "standard" | "aria2")}>
            <option value="standard">Standard (stable)</option>
            <option value="aria2">aria2 (fast)</option>
          </SelectInput>
        </SettingRow>

        <SettingRow
          label="Max concurrent downloads"
          sub={`${maxConcurrent} simultaneous download${maxConcurrent !== 1 ? "s" : ""}`}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="range" min={1} max={6} step={1} value={maxConcurrent}
              onChange={(e) => setMaxConcurrent(Number(e.target.value))}
              style={{ width: 80, accentColor: "var(--accent)" }}
            />
            <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: "var(--text-muted)", minWidth: 12 }}>
              {maxConcurrent}
            </span>
          </div>
        </SettingRow>

        <SettingRow label="Auto-start downloads" sub="Begin downloading immediately when a URL is confirmed">
          <Toggle value={autoStartDownloads} onChange={setAutoStartDownloads} />
        </SettingRow>

        <SettingRow label="Auto-fetch on paste" sub="Automatically fetch video info when a URL is pasted">
          <Toggle value={autoFetch} onChange={setAutoFetch} />
        </SettingRow>

        <SettingRow label="Download notifications" sub="Show a system notification when a download completes">
          <Toggle value={notifications} onChange={setNotifications} />
        </SettingRow>
      </div>
    </>
  );

  const renderPlayer = () => (
    <>
      <SectionLabel>Audio & Subtitles</SectionLabel>
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <SettingRow label="Default audio track" sub="Preferred dub language for anime and movies">
          <SegmentedControl
            value={defaultAudioTrack}
            onChange={setDefaultAudioTrack}
            options={[
              { label: "Dub",   value: "dub"   },
              { label: "Sub",   value: "sub"   },
              { label: "Hindi", value: "hindi" },
            ]}
          />
        </SettingRow>

        <SettingRow label="Default subtitle language" sub="Subtitle language shown when a track is available">
          <SelectInput value={defaultSubtitleLang} onChange={setDefaultSubtitleLang}>
            <option value="en">English</option>
            <option value="ja">Japanese</option>
            <option value="hi">Hindi</option>
            <option value="ar">Arabic</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="es">Spanish</option>
            <option value="off">Off</option>
          </SelectInput>
        </SettingRow>

        <SettingRow label="Subtitle font size" sub="Size of subtitle text rendered in the player">
          <SegmentedControl
            value={subtitleFontSize}
            onChange={setSubtitleFontSize}
            options={[
              { label: "Small",  value: "small"  },
              { label: "Medium", value: "medium" },
              { label: "Large",  value: "large"  },
            ]}
          />
        </SettingRow>
      </div>

      <SectionLabel>Playback</SectionLabel>
      <div className="card card-padded">
        <SettingRow label="Autoplay next episode" sub="Automatically play the next episode for anime, anime V2, and TV series">
          <Toggle value={autoplayNextEpisode} onChange={setAutoplayNextEpisode} />
        </SettingRow>

        <SettingRow label="Skip intro automatically" sub="Jump past OP/ED segments when an intro marker is detected">
          <Toggle value={skipIntro} onChange={setSkipIntro} />
        </SettingRow>
      </div>
    </>
  );

  const renderBrowsing = () => (
    <>
      <SectionLabel>Sources</SectionLabel>
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <SettingRow label="Preferred anime provider" sub="Primary source used on the Anime and Anime V2 pages">
          <SelectInput value={preferredAnimeProvider} onChange={setPreferredAnimeProvider}>
            <option value="hianime">HiAnime</option>
            <option value="gogoanime">GogoAnime</option>
            <option value="animepahe">AnimePahe</option>
          </SelectInput>
        </SettingRow>

        <SettingRow label="Preferred movie source" sub="Primary source used on the Movies page">
          <SelectInput value={preferredMovieSource} onChange={setPreferredMovieSource}>
            <option value="moviebox">MovieBox</option>
            <option value="vidsrc">VidSrc</option>
            <option value="embedsu">Embed.su</option>
          </SelectInput>
        </SettingRow>
      </div>

      <SectionLabel>Browse experience</SectionLabel>
      <div className="card card-padded">
        <SettingRow label="Default landing tab" sub="Which tab is shown first when you open GRABIX">
          <SelectInput value={defaultLandingTab} onChange={setDefaultLandingTab}>
            <option value="trending">Trending</option>
            <option value="anime">Anime</option>
            <option value="movies">Movies</option>
            <option value="tv">TV Series</option>
            <option value="library">Library</option>
          </SelectInput>
        </SettingRow>

        <SettingRow label="Ratings on cards" sub="Show TMDB score badge on every poster card">
          <Toggle value={showRatingsOnCards} onChange={setShowRatingsOnCards} />
        </SettingRow>

        <SettingRow label="Safe-for-work mode" sub="Hide adult-rated content from all browse pages and search results">
          <Toggle value={sfwMode} onChange={setSfwMode} />
        </SettingRow>
      </div>
    </>
  );

  const renderLibrary = () => (
    <>
      <SectionLabel>Organisation</SectionLabel>
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <SettingRow label="Default sort order" sub="How items are ordered when you open your library">
          <SelectInput value={libraryDefaultSort} onChange={setLibraryDefaultSort}>
            <option value="date_desc">Date added — newest first</option>
            <option value="date_asc">Date added — oldest first</option>
            <option value="title_asc">Title A → Z</option>
            <option value="title_desc">Title Z → A</option>
            <option value="rating_desc">Rating — highest first</option>
          </SelectInput>
        </SettingRow>

        <SettingRow label="Auto-clear completed downloads" sub="Remove entries from the download queue once a file finishes">
          <Toggle value={autoClearCompleted} onChange={setAutoClearCompleted} />
        </SettingRow>
      </div>

      <SectionLabel>Media cache</SectionLabel>
      <div className="card card-padded">
        <SettingRow label="Enable media cache" sub="Cache episode and movie metadata locally to speed up repeated lookups">
          <Toggle value={enableMediaCache} onChange={setEnableMediaCache} />
        </SettingRow>

        <SettingRow
          label="Cache duration"
          sub={enableMediaCache ? `Cached data expires after ${mediaCacheDays} day${mediaCacheDays !== "1" ? "s" : ""}` : "Enable media cache to configure this"}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="range" min={1} max={30} step={1} value={Number(mediaCacheDays)}
              onChange={(e) => setMediaCacheDays(e.target.value)}
              disabled={!enableMediaCache}
              style={{ width: 80, accentColor: "var(--accent)", opacity: enableMediaCache ? 1 : 0.4 }}
            />
            <span style={{ fontSize: 13, color: "var(--text-muted)", minWidth: 40, opacity: enableMediaCache ? 1 : 0.4 }}>
              {mediaCacheDays}d
            </span>
          </div>
        </SettingRow>
      </div>
    </>
  );

  const renderManga = () => (
    <>
      <SectionLabel>Reading experience</SectionLabel>
      <div className="card card-padded">
        <SettingRow label="Reading direction" sub="Page turn direction — right-to-left for manga, left-to-right for manhwa">
          <SegmentedControl
            value={mangaReadingDirection}
            onChange={setMangaReadingDirection}
            options={[
              { label: "← RTL (manga)",    value: "rtl" },
              { label: "LTR (manhwa) →",   value: "ltr" },
              { label: "↓ Vertical scroll", value: "vertical" },
            ]}
          />
        </SettingRow>

        <SettingRow label="Page layout" sub="How many pages to display side-by-side">
          <SegmentedControl
            value={mangaPageLayout}
            onChange={setMangaPageLayout}
            options={[
              { label: "Single",  value: "single"  },
              { label: "Double",  value: "double"  },
              { label: "Long strip", value: "strip" },
            ]}
          />
        </SettingRow>
      </div>
    </>
  );

  const renderNetwork = () => (
    <>
      <SectionLabel>Proxy</SectionLabel>
      <div className="card card-padded">
        <div style={{ padding: "14px 0" }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>HTTP proxy URL</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
            Optional proxy for all outbound requests. Leave blank to connect directly.
            Format: <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>http://host:port</code>
          </div>
          <input
            className="input-base"
            type="text"
            value={httpProxyUrl}
            onChange={(e) => setHttpProxyUrl(e.target.value)}
            placeholder="http://127.0.0.1:8080"
            style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 13 }}
          />
        </div>
      </div>
    </>
  );

  const renderAbout = () => (
    <>
      {/* ── TMDB ── */}
      <SectionLabel>API Keys</SectionLabel>
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <div style={{ padding: "14px 0", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>TMDB Bearer Token</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
                Required for Movies and TV Series pages. Free at{" "}
                <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>
                  themoviedb.org/settings/api
                </a>
              </div>
            </div>
            <div style={{
              fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 99, flexShrink: 0, marginLeft: 12,
              background: tmdbConfigured === null ? "var(--bg-surface2)" : tmdbConfigured ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
              color: tmdbConfigured === null ? "var(--text-muted)" : tmdbConfigured ? "var(--text-success)" : "var(--text-danger)",
            }}>
              {tmdbConfigured === null ? "checking…" : tmdbConfigured ? "✓ Active" : "✗ Missing"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <input
                className="input-base"
                type={tmdbTokenVisible ? "text" : "password"}
                value={tmdbToken}
                onChange={(e) => setTmdbToken(e.target.value)}
                placeholder={tmdbConfigured ? "Paste new token to replace…" : "Paste your TMDB Bearer Token (starts with ey…)"}
                style={{ width: "100%", paddingRight: 36, fontFamily: "var(--font-mono)", fontSize: 12 }}
                onKeyDown={(e) => { if (e.key === "Enter" && tmdbToken.trim() && !tmdbSaving) void saveTmdbToken(); }}
              />
              <button
                onClick={() => setTmdbTokenVisible((v) => !v)}
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 12, padding: 0 }}
                tabIndex={-1}
              >
                {tmdbTokenVisible ? "Hide" : "Show"}
              </button>
            </div>
            <button className="btn btn-primary" style={{ fontSize: 13, height: 34, flexShrink: 0 }} onClick={() => void saveTmdbToken()} disabled={tmdbSaving || !tmdbToken.trim()}>
              {tmdbSaving ? "Saving…" : "Save"}
            </button>
            {tmdbConfigured && (
              <button className="btn btn-ghost" style={{ fontSize: 13, height: 34, flexShrink: 0, color: "var(--text-danger)" }} onClick={() => void removeTmdbToken()} disabled={tmdbSaving}>
                Remove
              </button>
            )}
          </div>
          {tmdbSaveMsg && (
            <div style={{ marginTop: 8, fontSize: 13, color: tmdbSaveMsg.ok ? "var(--text-success)" : "var(--text-danger)" }}>
              {tmdbSaveMsg.text}
            </div>
          )}
          {!tmdbConfigured && tmdbConfigured !== null && (
            <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: "var(--radius-sm)", background: "var(--bg-surface2)", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              <strong>How to get your free token:</strong><br />
              1. Go to <a href="https://www.themoviedb.org/signup" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>themoviedb.org/signup</a> and create a free account<br />
              2. Settings → API → Create → Developer<br />
              3. Fill the form (personal / learning use) and submit<br />
              4. Copy the <strong>API Read Access Token</strong> (the long one starting with <code>ey…</code>)<br />
              5. Paste above and click Save.
            </div>
          )}
        </div>

        {/* ── Adult content ── */}
        <SettingRow
          label="Adult content"
          sub={adultContentBlocked
            ? "Blocked across the app until you unlock it for this session."
            : "Unlocked for this session only. Resets after app restart."}
        >
          {adultContentBlocked ? (
            <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => void handleAdultUnlock()}>
              {adultPasswordConfigured ? "Enable Adult Content" : "Set Adult Password"}
            </button>
          ) : (
            <span style={{ fontSize: 13, color: "var(--text-success)", fontWeight: 600 }}>Unlocked for session</span>
          )}
        </SettingRow>
        {adultError && <div style={{ fontSize: 13, color: "var(--text-danger)", padding: "0 0 10px" }}>{adultError}</div>}
      </div>

      {/* ── About ── */}
      <SectionLabel>About</SectionLabel>
      <div className="card card-padded" style={{ marginBottom: 12 }}>
        <SettingRow label="Version" sub="Current GRABIX version">
          <span style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>0.4.0 · Phase 4</span>
        </SettingRow>
        <SettingRow label="Backend" sub="FastAPI + yt-dlp + FFmpeg">
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "var(--text-success)" }}>
            <IconCheck size={13} /> Active
          </div>
        </SettingRow>
        <SettingRow label="Fast engine" sub="aria2 multi-connection downloader">
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: aria2Available ? "var(--text-success)" : "var(--text-muted)" }}>
            <IconCheck size={13} /> {aria2Available ? "aria2 ready" : "Not installed"}
          </div>
        </SettingRow>
        <div style={{ paddingTop: 10, display: "flex", alignItems: "flex-start", gap: 8, color: "var(--text-muted)", fontSize: 13 }}>
          <IconInfo size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          GRABIX is free and open source. For legal use only — respect copyright.
        </div>
      </div>

      {/* ── Diagnostics ── */}
      <SectionLabel>Diagnostics</SectionLabel>
      <div className="card card-padded">
        <SettingRow label="Release self-test" sub="Run checks against backend, library, storage and providers">
          <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => void runSelfTest()} disabled={selfTestRunning}>
            {selfTestRunning ? "Running…" : "Run self-test"}
          </button>
        </SettingRow>
        {startupDiagnostics && (
          <div style={{ paddingTop: 10, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
            Backend: {startupDiagnostics.backend.status} · Anime Provider: {startupDiagnostics.consumet.status}
          </div>
        )}
        {selfTestGate && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "var(--bg-surface2)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: selfTestGate.ready ? "var(--text-success)" : "var(--text-danger)" }}>
              {selfTestGate.ready ? "All checks passed" : "Some checks failed"}
            </div>
            {!selfTestGate.ready && Array.isArray(selfTestGate.failed_checks) && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--text-secondary)" }}>
                {selfTestGate.failed_checks.map((check, i) => (
                  <div key={i}>
                    {check.label ?? "Unnamed check"}
                    {check.details?.broken_items ? ` (${check.details.broken_items} broken item(s))` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  // ─── Nav definition ───────────────────────────────────────────────────────

  const NAV: { id: NavSection; icon: ReactNode; label: string }[] = [
    { id: "appearance", icon: <NavIconAppearance />, label: "Appearance" },
    { id: "downloads",  icon: <NavIconDownloads />,  label: "Downloads"  },
    { id: "player",     icon: <NavIconPlayer />,     label: "Player"     },
    { id: "browsing",   icon: <NavIconBrowsing />,   label: "Browsing"   },
    { id: "library",    icon: <NavIconLibrary />,    label: "Library"    },
    { id: "manga",      icon: <NavIconManga />,      label: "Manga"      },
    { id: "network",    icon: <NavIconNetwork />,    label: "Network"    },
    { id: "about",      icon: <NavIconAbout />,      label: "About"      },
  ];

  const sectionTitle: Record<NavSection, string> = {
    appearance: "Appearance",
    downloads:  "Downloads",
    player:     "Player",
    browsing:   "Browsing",
    library:    "Library",
    manga:      "Manga",
    network:    "Network",
    about:      "About & Diagnostics",
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* ── Top bar ── */}
      <div style={{
        padding: "14px 24px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Settings</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 1 }}>
            {sectionTitle[activeSection]}
          </div>
        </div>
        <button className="btn btn-primary" style={{ height: 34, fontSize: 13 }} onClick={save}>
          {saveError
            ? "Save failed"
            : saved
            ? <><IconCheck size={13} /> Saved</>
            : "Save changes"}
        </button>
      </div>

      {/* ── Body ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Sidebar ── */}
        <nav style={{
          width: 160, flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--bg-surface)",
          overflowY: "auto",
          paddingTop: 8, paddingBottom: 8,
        }}>
          {NAV.map(({ id, icon, label }) => (
            <NavItem
              key={id}
              icon={icon}
              label={label}
              active={activeSection === id}
              onClick={() => setActiveSection(id)}
            />
          ))}
        </nav>

        {/* ── Content pane ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          <div style={{ maxWidth: 560 }}>
            {activeSection === "appearance" && renderAppearance()}
            {activeSection === "downloads"  && renderDownloads()}
            {activeSection === "player"     && renderPlayer()}
            {activeSection === "browsing"   && renderBrowsing()}
            {activeSection === "library"    && renderLibrary()}
            {activeSection === "manga"      && renderManga()}
            {activeSection === "network"    && renderNetwork()}
            {activeSection === "about"      && renderAbout()}
          </div>
        </div>
      </div>

      {/* ── Adult content modal ── */}
      {adultModalOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 220 }}
          onClick={() => !adultSubmitting && setAdultModalOpen(false)}
        >
          <div className="card card-padded" style={{ width: "100%", maxWidth: 420, border: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
              {adultPasswordConfigured ? "Unlock Adult Content" : "Set Adult Content Password"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 14 }}>
              {adultPasswordConfigured
                ? "Enter the password to unlock adult content for this session."
                : "Create a password for adult-content access on this device."}
            </div>
            <input
              className="input-base"
              type="password"
              autoFocus
              value={adultPassword}
              onChange={(e) => setAdultPassword(e.target.value)}
              placeholder={adultPasswordConfigured ? "Enter password" : "Create password"}
              style={{ width: "100%", marginBottom: 10 }}
              onKeyDown={(e) => { if (e.key === "Enter" && !adultSubmitting) void submitAdultPassword(); }}
            />
            {adultError && <div style={{ fontSize: 13, color: "var(--text-danger)", marginBottom: 12 }}>{adultError}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setAdultModalOpen(false)} disabled={adultSubmitting}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void submitAdultPassword()} disabled={adultSubmitting || !adultPassword.trim()}>
                {adultSubmitting ? "Please wait…" : adultPasswordConfigured ? "Unlock" : "Save & Unlock"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
