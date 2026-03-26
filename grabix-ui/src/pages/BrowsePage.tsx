import { IconBrowse, IconStar, IconPlay } from "../components/Icons";

const COMING = [
  { label: "Anime catalog", sub: "Browse AniList & Jikan — Phase 4", Icon: IconPlay },
  { label: "Manga reader", sub: "MangaDex integration — Phase 4", Icon: IconStar },
  { label: "Movie browser", sub: "TMDB API — Phase 4", Icon: IconBrowse },
];

export default function BrowsePage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)" }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Browse</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>Discover legal anime, manga, and movies</div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, gap: 24 }}>
        <div className="empty-state" style={{ marginBottom: 0 }}>
          <IconBrowse size={44} />
          <p style={{ fontSize: 15, fontWeight: 500 }}>Coming in Phase 4</p>
          <span>Legal anime, manga, and movie browsing</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 360 }}>
          {COMING.map(({ label, sub, Icon }) => (
            <div key={label} className="card" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, opacity: 0.65 }}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: "var(--accent-light)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon size={16} color="var(--text-accent)" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
