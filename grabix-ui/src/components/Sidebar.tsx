import { useTheme } from "../context/ThemeContext";
import { IconBrowse, IconConvert, IconDownload, IconLibrary, IconSettings, IconSun, IconMoon, IconFolder, IconHeart } from "./Icons";

const IconFilm = ({ size = 16, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="2.18" />
    <line x1="7" y1="2" x2="7" y2="22" />
    <line x1="17" y1="2" x2="17" y2="22" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <line x1="2" y1="7" x2="7" y2="7" />
    <line x1="2" y1="17" x2="7" y2="17" />
    <line x1="17" y1="17" x2="22" y2="17" />
    <line x1="17" y1="7" x2="22" y2="7" />
  </svg>
);

const IconBook = ({ size = 16, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const IconTv = ({ size = 16, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="15" rx="2" />
    <polyline points="17 2 12 7 7 2" />
  </svg>
);

export type Page = "downloader" | "converter" | "library" | "storage" | "anime" | "manga" | "movies" | "moviebox" | "series" | "favorites" | "settings";

interface Props {
  page: Page;
  setPage: (p: Page) => void;
  activeDownloads: number;
  backendOk: boolean;
}

const GROUPS = [
  {
    label: "Tools",
    items: [
      { id: "downloader" as Page, label: "Downloader", Icon: IconDownload },
      { id: "converter" as Page, label: "Converter", Icon: IconConvert },
      { id: "library" as Page, label: "Library", Icon: IconLibrary },
      { id: "storage" as Page, label: "Storage", Icon: IconFolder },
    ],
  },
  {
    label: "Browse",
    items: [
      { id: "anime" as Page, label: "Anime", Icon: IconTv },
      { id: "manga" as Page, label: "Manga", Icon: IconBook },
      { id: "movies" as Page, label: "Movies", Icon: IconFilm },
      { id: "moviebox" as Page, label: "Movie Box", Icon: IconBrowse },
      { id: "series" as Page, label: "TV Series", Icon: IconTv },
      { id: "favorites" as Page, label: "Favorites", Icon: IconHeart },
    ],
  },
  {
    label: "App",
    items: [
      { id: "settings" as Page, label: "Settings", Icon: IconSettings },
    ],
  },
];

export default function Sidebar({ page, setPage, activeDownloads, backendOk }: Props) {
  const { theme, toggle } = useTheme();

  return (
    <aside style={{ width: "var(--sidebar-w)", background: "var(--bg-sidebar)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", flexShrink: 0, height: "100vh" }}>
      <div style={{ padding: "18px 16px 14px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IconDownload size={15} color="white" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1, color: "var(--text-primary)" }}>GRABIX</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>media downloader</div>
          </div>
        </div>
      </div>

      <nav style={{ padding: "10px 8px", flex: 1, overflowY: "auto" }}>
        {GROUPS.map((group) => (
          <div key={group.label} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", letterSpacing: 1, padding: "8px 12px 4px", textTransform: "uppercase" }}>{group.label}</div>
            {group.items.map(({ id, label, Icon }) => (
              <div key={id} className={`nav-item${page === id ? " active" : ""}`} onClick={() => setPage(id)}>
                {id === "favorites" ? (
                  <IconHeart size={16} color={page === id ? "currentColor" : "var(--text-danger)"} filled />
                ) : (
                  <Icon size={16} color="currentColor" />
                )}
                {label}
                {id === "downloader" && activeDownloads > 0 && <span className="nav-badge">{activeDownloads}</span>}
              </div>
            ))}
          </div>
        ))}
      </nav>

      <div style={{ padding: "10px 8px", borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 4 }}>
          <span className={`status-dot ${backendOk ? "online" : "offline"}`} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{backendOk ? "Backend connected" : "Backend offline"}</span>
        </div>
        <div className="nav-item" onClick={toggle} style={{ gap: 10 }}>
          {theme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </div>
      </div>
    </aside>
  );
}
