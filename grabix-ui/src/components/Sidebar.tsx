import { useTheme } from "../context/ThemeContext";
import {
  IconDownload, IconLibrary, IconSettings, IconBrowse,
  IconSun, IconMoon,
} from "./Icons";

export type Page = "downloader" | "library" | "browse" | "settings";

interface Props {
  page: Page;
  setPage: (p: Page) => void;
  activeDownloads: number;
  backendOk: boolean;
}

const NAV: { id: Page; label: string; Icon: React.FC<any> }[] = [
  { id: "downloader", label: "Downloader", Icon: IconDownload },
  { id: "library",    label: "Library",    Icon: IconLibrary },
  { id: "browse",     label: "Browse",     Icon: IconBrowse },
  { id: "settings",   label: "Settings",   Icon: IconSettings },
];

export default function Sidebar({ page, setPage, activeDownloads, backendOk }: Props) {
  const { theme, toggle } = useTheme();

  return (
    <aside style={{
      width: "var(--sidebar-w)",
      background: "var(--bg-sidebar)",
      borderRight: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
      height: "100vh",
    }}>
      {/* Logo */}
      <div style={{ padding: "18px 16px 14px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: "var(--accent)", display: "flex",
            alignItems: "center", justifyContent: "center",
          }}>
            <IconDownload size={15} color="white" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1, color: "var(--text-primary)" }}>GRABIX</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 0 }}>media downloader</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: "10px 8px", flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", letterSpacing: 1, padding: "4px 12px 8px", textTransform: "uppercase" }}>
          Menu
        </div>
        {NAV.map(({ id, label, Icon }) => (
          <div
            key={id}
            className={`nav-item${page === id ? " active" : ""}`}
            onClick={() => setPage(id)}
          >
            <Icon size={16} />
            {label}
            {id === "downloader" && activeDownloads > 0 && (
              <span className="nav-badge">{activeDownloads}</span>
            )}
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div style={{ padding: "10px 8px", borderTop: "1px solid var(--border)" }}>
        {/* Backend status */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 4 }}>
          <span className={`status-dot ${backendOk ? "online" : "offline"}`} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {backendOk ? "Backend connected" : "Backend offline"}
          </span>
        </div>

        {/* Theme toggle */}
        <div className="nav-item" onClick={toggle} style={{ gap: 10 }}>
          {theme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </div>
      </div>
    </aside>
  );
}
