import React from "react";
import Topbar from "../components/Topbar";
import { moviesList } from "../data/mock";

type Page = "home"|"downloader"|"queue"|"library"|"anime"|"movies"|"settings";
interface Props { theme: string; onToggleTheme: () => void; onNav: (p: Page) => void; }

export default function MoviesPage({ theme, onToggleTheme, onNav }: Props) {
  return (
    <div className="flex flex-col h-full">
      <Topbar title="Movies" theme={theme} onToggleTheme={onToggleTheme} />
      <div className="flex-1 overflow-y-auto p-8">

        {/* Hero */}
        <div className="relative rounded-2xl overflow-hidden mb-8" style={{ height: "310px" }}>
          <img src="https://picsum.photos/seed/moviehero2/1200/400" className="w-full h-full object-cover" style={{ opacity: 0.45 }} />
          <div className="absolute inset-0 flex flex-col justify-end p-8" style={{ background: "linear-gradient(90deg,rgba(0,0,0,0.9) 0%,rgba(0,0,0,0.2) 65%,transparent)" }}>
            <div className="flex gap-2 mb-2">
              <span className="text-xs px-2 py-0.5 rounded-full border border-white/30 text-white/80">Sci-Fi</span>
              <span className="text-xs px-2 py-0.5 rounded-full border border-white/30 text-white/80">Adventure</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "var(--accent-bg)", color: "var(--accent)" }}>★ 8.6</span>
            </div>
            <div className="text-white font-black text-4xl mb-2 leading-tight">Dune:<br/>Part Two</div>
            <div className="text-white/60 text-sm mb-4 max-w-md">
              Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.
            </div>
            <div className="flex gap-3">
              <button className="px-5 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: "var(--accent)" }}>▶ Watch Now</button>
              <button onClick={() => onNav("downloader")} className="px-5 py-2 rounded-lg text-sm font-semibold" style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}>↓ Download</button>
            </div>
          </div>
        </div>

        {/* Now Popular */}
        <div className="font-semibold mb-4" style={{ color: "var(--text)" }}>Now Popular</div>
        <div className="flex gap-4 overflow-x-auto pb-2 mb-8" style={{ scrollbarWidth: "none" }}>
          {moviesList.map((item) => (
            <div key={item.id} className="flex-shrink-0 cursor-pointer group">
              <div className="relative rounded-xl overflow-hidden mb-2" style={{ width: "140px", height: "200px", background: "var(--surface2)" }}>
                <img src={item.thumb} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                <div className="absolute top-2 right-2 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(0,0,0,0.7)", color: "#FFD700" }}>
                  ★ {item.rating}
                </div>
              </div>
              <div className="text-xs font-medium" style={{ color: "var(--text)", width: "140px" }}>{item.title}</div>
              <div className="text-xs mt-0.5" style={{ color: "var(--text3)" }}>{item.genre}</div>
            </div>
          ))}
        </div>

        {/* Top Rated */}
        <div className="font-semibold mb-4" style={{ color: "var(--text)" }}>Top Rated</div>
        <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
          {[...moviesList].sort((a, b) => b.rating - a.rating).map((item) => (
            <div key={item.id} className="flex-shrink-0 cursor-pointer group">
              <div className="relative rounded-xl overflow-hidden mb-2" style={{ width: "140px", height: "200px", background: "var(--surface2)" }}>
                <img src={item.thumb} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
              </div>
              <div className="text-xs font-medium" style={{ color: "var(--text)", width: "140px" }}>{item.title}</div>
              <div className="text-xs mt-0.5" style={{ color: "var(--text3)" }}>{item.year}</div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
