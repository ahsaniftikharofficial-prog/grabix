// grabix-ui/src/pages/AnimePage.tsx
// Phase 4 — Anime: Browse, Search, Detail, Stream, Download

import { useState, useEffect, useRef } from "react";
import {
  IconSearch, IconStar, IconPlay, IconDownload,
  IconX, IconChevronDown, IconRefresh,
} from "../components/Icons";

const JIKAN = "https://api.jikan.moe/v4";
const GRABIX = "http://127.0.0.1:8000";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Anime {
  mal_id: number;
  title: string;
  title_english?: string;
  images: { jpg: { image_url: string; large_image_url?: string } };
  synopsis?: string;
  score?: number;
  episodes?: number;
  status?: string;
  genres?: { name: string }[];
  year?: number;
  season?: string;
  trailer?: { embed_url?: string; url?: string };
  url?: string;
}

type Tab = "trending" | "toprated" | "seasonal";

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AnimePage() {
  const [tab, setTab]           = useState<Tab>("trending");
  const [items, setItems]       = useState<Anime[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [query, setQuery]       = useState("");
  const [detail, setDetail]     = useState<Anime | null>(null);
  const [page, setPage]         = useState(1);
  const searchRef               = useRef<HTMLInputElement>(null);

  const fetchList = async (t: Tab, p = 1) => {
    setLoading(true);
    try {
      let url = "";
      if (t === "trending")  url = `${JIKAN}/top/anime?filter=airing&page=${p}&limit=20`;
      if (t === "toprated")  url = `${JIKAN}/top/anime?page=${p}&limit=20`;
      if (t === "seasonal")  url = `${JIKAN}/seasons/now?page=${p}&limit=20`;
      const r = await fetch(url);
      const d = await r.json();
      setItems(p === 1 ? (d.data ?? []) : prev => [...prev, ...(d.data ?? [])]);
    } catch { setItems([]); }
    finally { setLoading(false); }
  };

  const fetchSearch = async (q: string, p = 1) => {
    setLoading(true);
    try {
      const r = await fetch(`${JIKAN}/anime?q=${encodeURIComponent(q)}&page=${p}&limit=20&sfw=true`);
      const d = await r.json();
      setItems(p === 1 ? (d.data ?? []) : prev => [...prev, ...(d.data ?? [])]);
    } catch { setItems([]); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (query) fetchSearch(query, 1);
    else fetchList(tab, 1);
    setPage(1);
  }, [tab, query]);

  const handleSearch = () => {
    if (search.trim()) setQuery(search.trim());
    else { setQuery(""); fetchList(tab, 1); }
  };

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    if (query) fetchSearch(query, next);
    else fetchList(tab, next);
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: "trending",  label: "Trending" },
    { id: "toprated",  label: "Top Rated" },
    { id: "seasonal",  label: "This Season" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>

      {/* Topbar */}
      <div style={{
        padding: "14px 24px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)", display: "flex",
        alignItems: "center", justifyContent: "space-between", gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Anime</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>Browse, stream and download anime</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}>
              <IconSearch size={13} color="var(--text-muted)" />
            </div>
            <input
              ref={searchRef}
              className="input-base"
              style={{ paddingLeft: 32, width: 220, fontSize: 13 }}
              placeholder="Search anime…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
            />
          </div>
          <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={handleSearch}>Search</button>
          {query && (
            <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => { setQuery(""); setSearch(""); }}>
              <IconX size={13} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      {!query && (
        <div style={{ display: "flex", gap: 4, padding: "10px 24px 0", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "7px 16px", fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer",
                background: "transparent", borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                color: tab === t.id ? "var(--accent)" : "var(--text-muted)",
                transition: "var(--transition)", borderRadius: 0,
              }}
            >{t.label}</button>
          ))}
        </div>
      )}

      {/* Grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {loading && items.length === 0 ? (
          <LoadingGrid />
        ) : items.length === 0 ? (
          <div className="empty-state"><IconSearch size={36} /><p>No results found</p><span>Try a different search term</span></div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
              {items.map(anime => (
                <AnimeCard key={anime.mal_id} anime={anime} onClick={() => setDetail(anime)} />
              ))}
            </div>
            <div style={{ textAlign: "center", marginTop: 24 }}>
              <button className="btn btn-ghost" style={{ gap: 6 }} onClick={loadMore} disabled={loading}>
                <IconRefresh size={14} /> Load more
              </button>
            </div>
          </>
        )}
      </div>

      {/* Detail modal */}
      {detail && <AnimeDetail anime={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

// ─── Anime Card ───────────────────────────────────────────────────────────────
function AnimeCard({ anime, onClick }: { anime: Anime; onClick: () => void }) {
  return (
    <div
      className="card"
      style={{ overflow: "hidden", cursor: "pointer", transition: "transform 0.15s" }}
      onClick={onClick}
      onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-3px)")}
      onMouseLeave={e => (e.currentTarget.style.transform = "translateY(0)")}
    >
      <div style={{ position: "relative" }}>
        <img
          src={anime.images.jpg.large_image_url ?? anime.images.jpg.image_url}
          alt={anime.title}
          style={{ width: "100%", height: 210, objectFit: "cover" }}
          onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/150x210?text=No+Image"; }}
        />
        {anime.score && (
          <div style={{
            position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.75)",
            color: "#fdd663", fontSize: 11, padding: "2px 7px", borderRadius: 6,
            display: "flex", alignItems: "center", gap: 3, fontWeight: 600,
          }}>
            <IconStar size={10} color="#fdd663" /> {anime.score}
          </div>
        )}
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.3 }}>
          {anime.title_english ?? anime.title}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
          {anime.episodes ? `${anime.episodes} eps` : anime.status ?? "—"}
        </div>
      </div>
    </div>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────
function AnimeDetail({ anime, onClose }: { anime: Anime; onClose: () => void }) {
  const [streaming, setStreaming] = useState(false);
  const [dlUrl, setDlUrl]         = useState("");
  const [sending, setSending]     = useState(false);
  const [sent, setSent]           = useState(false);

  const embedUrl = anime.trailer?.embed_url;
  const malUrl   = anime.url ?? `https://myanimelist.net/anime/${anime.mal_id}`;

  const sendToDownloader = async () => {
    if (!dlUrl.trim()) return;
    setSending(true);
    try {
      await fetch(`${GRABIX}/download?url=${encodeURIComponent(dlUrl.trim())}&dl_type=video`);
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } catch { /* ignore */ }
    finally { setSending(false); }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg-surface)", borderRadius: 16, width: "100%", maxWidth: 720,
          maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column",
          boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", gap: 16, padding: "20px 20px 0" }}>
          <img
            src={anime.images.jpg.large_image_url ?? anime.images.jpg.image_url}
            alt={anime.title}
            style={{ width: 100, height: 145, objectFit: "cover", borderRadius: 10, flexShrink: 0, border: "1px solid var(--border)" }}
            onError={e => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/100x145?text=No+Image"; }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.3, marginBottom: 6 }}>
              {anime.title_english ?? anime.title}
            </div>
            {anime.title_english && anime.title !== anime.title_english && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>{anime.title}</div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {anime.score && (
                <span style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, fontWeight: 600, color: "#fdd663" }}>
                  <IconStar size={11} color="#fdd663" /> {anime.score}
                </span>
              )}
              {anime.episodes && (
                <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>
                  {anime.episodes} episodes
                </span>
              )}
              {anime.status && (
                <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>
                  {anime.status}
                </span>
              )}
              {anime.year && (
                <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12, color: "var(--text-secondary)" }}>
                  {anime.year}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {anime.genres?.slice(0, 4).map(g => (
                <span key={g.name} style={{ background: "var(--bg-active)", color: "var(--text-accent)", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 500 }}>
                  {g.name}
                </span>
              ))}
            </div>
          </div>
          <button className="btn-icon" style={{ alignSelf: "flex-start", flexShrink: 0 }} onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 20px" }}>

          {/* Synopsis */}
          {anime.synopsis && (
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 16 }}>
              {anime.synopsis.length > 400 ? anime.synopsis.slice(0, 400) + "…" : anime.synopsis}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {embedUrl && (
              <button
                className="btn btn-primary"
                style={{ gap: 6 }}
                onClick={() => setStreaming(v => !v)}
              >
                <IconPlay size={14} /> {streaming ? "Hide Trailer" : "Watch Trailer"}
              </button>
            )}
            <a
              href={malUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost"
              style={{ gap: 6, textDecoration: "none", fontSize: 13 }}
            >
              View on MAL
            </a>
          </div>

          {/* Trailer embed */}
          {streaming && embedUrl && (
            <div style={{ borderRadius: 10, overflow: "hidden", marginBottom: 16, border: "1px solid var(--border)" }}>
              <iframe
                src={embedUrl}
                width="100%"
                height="340"
                frameBorder="0"
                allowFullScreen
                title="Anime Trailer"
                style={{ display: "block" }}
              />
            </div>
          )}

          {/* Download section */}
          <div style={{ background: "var(--bg-surface2)", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
              <IconDownload size={14} color="var(--accent)" /> Download an Episode
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
              Paste a direct episode URL (e.g. from a legal source) and send it to your GRABIX downloader.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input-base"
                style={{ flex: 1, fontSize: 13 }}
                placeholder="Paste episode URL here…"
                value={dlUrl}
                onChange={e => setDlUrl(e.target.value)}
              />
              <button
                className="btn btn-primary"
                style={{ gap: 6, flexShrink: 0 }}
                onClick={sendToDownloader}
                disabled={sending || !dlUrl.trim()}
              >
                {sent ? <><IconDownload size={13} /> Sent!</> : sending ? "Sending…" : <><IconDownload size={13} /> Download</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
function LoadingGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
      {Array.from({ length: 16 }).map((_, i) => (
        <div key={i} className="card" style={{ overflow: "hidden" }}>
          <div style={{ width: "100%", height: 210, background: "var(--bg-surface2)", animation: "pulse 1.5s infinite" }} />
          <div style={{ padding: "8px 10px" }}>
            <div style={{ height: 12, background: "var(--bg-surface2)", borderRadius: 4, marginBottom: 6 }} />
            <div style={{ height: 10, background: "var(--bg-surface2)", borderRadius: 4, width: "60%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
