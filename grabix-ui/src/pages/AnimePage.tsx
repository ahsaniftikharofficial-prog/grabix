import React, { useState } from "react";
import Topbar from "../components/Topbar";
import { animeList, mangaList } from "../data/mock";

interface Props { theme: string; onToggleTheme: () => void; }

export default function AnimePage({ theme, onToggleTheme }: Props) {
  const [tab, setTab] = useState<"anime"|"manga">("anime");

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Anime & Manga" theme={theme} onToggleTheme={onToggleTheme} />
      <div className="flex-1 overflow-y-auto p-8">

        {/* Hero */}
        <div className="relative rounded-2xl overflow-hidden mb-8" style={{ height: "300px" }}>
          <img src="https://picsum.photos/seed/animehero2/1200/400" className="w-full h-full object-cover" style={{ opacity: 0.45 }} />
          <div className="absolute inset-0 flex flex-col justify-end p-8" style={{ background: "linear-gradient(90deg,rgba(0,0,0,0.9) 0%,rgba(0,0,0,0.2) 65%,transparent)" }}>
            <div className="flex gap-2 mb-2">
              <span className="text-xs px-2 py-0.5 rounded-full border border-white/30 text-white/80">Action</span>
              <span className="text-xs px-2 py-0.5 rounded-full border border-white/30 text-white/80">Fantasy</span>
            </div>
            <div className="text-white font-black text-4xl mb-2 leading-none">Jujutsu<br/>Kaisen</div>
            <div className="text-white/60 text-sm mb-4 max-w-md">
              A boy swallows a cursed talisman and becomes host to a powerful curse. He enters a school for Jujutsu Sorcerers.
            </div>
            <div className="flex gap-3">
              <button className="px-5 py-2 rounded-lg text-white text-sm font-semibold" style={{ background: "var(--accent)" }}>▶ Watch Now</button>
              <button className="px-5 py-2 rounded-lg text-sm font-semibold" style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}>+ Add to List</button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-7">
          {(["anime","manga"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="px-5 py-2 rounded-full text-sm font-medium capitalize" style={{ background: tab === t ? "var(--accent)" : "var(--surface)", color: tab === t ? "#fff" : "var(--text2)", border: tab === t ? "none" : "1px solid var(--border)" }}>
              {t === "anime" ? "🎌 Anime" : "📚 Manga"}
            </button>
          ))}
        </div>

        {tab === "anime" && (
          <>
            <div className="flex justify-between items-center mb-4">
              <span className="font-semibold" style={{ color: "var(--text)" }}>Trending Now</span>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-2 mb-8" style={{ scrollbarWidth: "none" }}>
              {animeList.map((item) => (
                <div key={item.id} className="flex-shrink-0 w-36 cursor-pointer group">
                  <div className="relative rounded-xl overflow-hidden mb-2" style={{ width: "140px", height: "200px", background: "var(--surface2)" }}>
                    <img src={item.thumb} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                    <div className="absolute top-2 right-2 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(0,0,0,0.7)", color: "#FFD700" }}>
                      ★ {item.rating}
                    </div>
                  </div>
                  <div className="text-xs font-medium" style={{ color: "var(--text)" }}>{item.title}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text3)" }}>{item.genre}</div>
                </div>
              ))}
            </div>
            <div className="font-semibold mb-4" style={{ color: "var(--text)" }}>Top Airing</div>
            <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
              {[...animeList].reverse().map((item) => (
                <div key={item.id} className="flex-shrink-0 w-36 cursor-pointer group">
                  <div className="relative rounded-xl overflow-hidden mb-2" style={{ width: "140px", height: "200px", background: "var(--surface2)" }}>
                    <img src={item.thumb} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                  </div>
                  <div className="text-xs font-medium" style={{ color: "var(--text)" }}>{item.title}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text3)" }}>{item.year}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "manga" && (
          <>
            <div className="font-semibold mb-4" style={{ color: "var(--text)" }}>Popular Manga</div>
            <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
              {mangaList.map((item) => (
                <div key={item.id} className="flex-shrink-0 cursor-pointer group">
                  <div className="relative rounded-xl overflow-hidden mb-2" style={{ width: "140px", height: "200px", background: "var(--surface2)" }}>
                    <img src={item.thumb} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                    <div className="absolute top-2 right-2 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(0,0,0,0.7)", color: "#FFD700" }}>
                      ★ {item.rating}
                    </div>
                  </div>
                  <div className="text-xs font-medium" style={{ color: "var(--text)" }}>{item.title}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text3)" }}>{item.genre}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
