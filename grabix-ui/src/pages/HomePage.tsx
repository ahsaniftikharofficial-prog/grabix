import Topbar from "../components/Topbar";
import { recentDownloads } from "../data/mock";

type Page = "home"|"downloader"|"queue"|"library"|"anime"|"movies"|"settings";

interface Props {
  theme: string; onToggleTheme: () => void; onNav: (p: Page) => void;
}

export default function HomePage({ theme, onToggleTheme, onNav }: Props) {
  return (
    <div className="flex flex-col h-full">
      <Topbar title="Home" theme={theme} onToggleTheme={onToggleTheme} />
      <div className="flex-1 overflow-y-auto p-8">

        {/* Hero */}
        <div className="relative rounded-2xl overflow-hidden mb-8" style={{ height: "260px" }}>
          <img
            src="https://picsum.photos/seed/grabixhero/1200/400"
            className="w-full h-full object-cover"
            style={{ opacity: 0.5 }}
          />
          <div
            className="absolute inset-0 flex flex-col justify-end p-8"
            style={{ background: "linear-gradient(90deg,rgba(0,0,0,0.88) 0%,rgba(0,0,0,0.1) 70%,transparent)" }}
          >
            <div className="flex gap-2 mb-2">
              <span className="text-xs px-2 py-0.5 rounded-full border border-white/30 text-white/80">Sci-Fi</span>
              <span className="text-xs px-2 py-0.5 rounded-full border border-white/30 text-white/80">Drama</span>
            </div>
            <div className="text-white font-bold text-3xl mb-1">Interstellar</div>
            <div className="text-white/60 text-sm mb-4 max-w-md">
              A team of explorers travel through a wormhole in space to ensure humanity's survival.
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => onNav("movies")}
                className="px-5 py-2 rounded-lg text-white text-sm font-semibold"
                style={{ background: "var(--accent)" }}
              >▶ Watch Now</button>
              <button
                onClick={() => onNav("downloader")}
                className="px-5 py-2 rounded-lg text-sm font-semibold"
                style={{ background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}
              >↓ Download</button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[
            { icon: "↓", label: "Total Downloads", value: "47", color: "var(--accent)" },
            { icon: "◉", label: "Storage Used", value: "38.4 GB", color: "#388E3C" },
            { icon: "◷", label: "Media Hours", value: "142h", color: "#F57C00" },
          ].map(({ icon, label, value, color }) => (
            <div
              key={label}
              className="flex items-center gap-3 p-4 rounded-xl"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center text-base"
                style={{ background: color + "18", color }}
              >{icon}</div>
              <div>
                <div className="font-bold text-lg" style={{ color: "var(--text)" }}>{value}</div>
                <div className="text-xs" style={{ color: "var(--text3)" }}>{label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Quick paste */}
        <div
          className="p-5 rounded-xl mb-8"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div className="text-sm font-medium mb-3" style={{ color: "var(--text2)" }}>Quick Download</div>
          <div
            className="flex items-center gap-2 px-4 py-3 rounded-xl mb-3"
            style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}
          >
            <span style={{ color: "var(--text3)" }}>↓</span>
            <input
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: "var(--text)" }}
              placeholder="Paste YouTube, TikTok, Twitter, or any video URL..."
              onKeyDown={(e) => e.key === "Enter" && onNav("downloader")}
            />
          </div>
          <button
            onClick={() => onNav("downloader")}
            className="px-5 py-2 rounded-lg text-white text-sm font-semibold"
            style={{ background: "var(--accent)" }}
          >Open Full Downloader →</button>
        </div>

        {/* Recent downloads */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <span className="font-semibold text-base" style={{ color: "var(--text)" }}>Recent Downloads</span>
            <button
              className="text-xs"
              style={{ color: "var(--text3)" }}
              onClick={() => onNav("library")}
            >View all →</button>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
            {recentDownloads.map((item) => (
              <div key={item.id} className="flex-shrink-0 w-40 cursor-pointer group">
                <div className="rounded-xl overflow-hidden mb-2 h-24 w-40" style={{ background: "var(--surface2)" }}>
                  <img src={item.thumb} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                </div>
                <div className="text-xs font-medium truncate" style={{ color: "var(--text)" }}>{item.title}</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--text3)" }}>{item.format} · {item.duration}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
