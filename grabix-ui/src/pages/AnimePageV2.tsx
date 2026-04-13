/**
 * AnimePageV2 — Calls the local Consumet sidecar directly (default port 3000),
 * replicating the working logic from anime.py. Bypasses the backend proxy.
 *
 * ROOT CAUSE OF 502 ERROR:
 * When GRABIX runs, it starts its own consumet on port 3000.
 * That bundled consumet has an outdated aniwatch package → MegaCloud decryption fails.
 * FIX: Run your working consumet-local on a DIFFERENT port:
 *   cd consumet-local && npm update aniwatch && node server.cjs --port 3001
 * Then click the status dot (●) in the search bar and set the URL to port 3001.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import VidSrcPlayer from "../components/VidSrcPlayer";
import { IconSearch, IconX, IconPlay } from "../components/Icons";
import { type StreamSource } from "../lib/streamProviders";

// ─── Consumet URL — persisted so it survives page refreshes ──────────────────
const LS_KEY = "animev2:consumet_url";
function getSavedUrl(): string {
  try { return localStorage.getItem(LS_KEY) || "http://127.0.0.1:3000"; } catch { return "http://127.0.0.1:3000"; }
}
function saveUrl(url: string) {
  try { localStorage.setItem(LS_KEY, url.trim().replace(/\/$/, "")); } catch {}
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface HiAnimeResult { id: string; title: string; type?: string; totalEpisodes?: number; subOrDub?: string; image?: string; }
interface HiAnimeEpisode { id: string; number: number; title?: string; isFiller?: boolean; }
interface HiAnimeInfo {
  anime?: { info?: { name?: string; poster?: string; description?: string } };
  episodes?: HiAnimeEpisode[];
  totalEpisodes?: number;
  subEpisodeCount?: number;
  dubEpisodeCount?: number;
}
interface HiAnimeWatch { sources?: Array<{ url: string; quality?: string; isM3U8?: boolean }>; subtitles?: Array<{ lang?: string; url?: string }>; }

type Screen = "home" | "info" | "player";
type Category = "sub" | "dub";
type Server = "vidcloud" | "vidstreaming";

// ─── API factory (same endpoints as anime.py) ─────────────────────────────────
function makeApi(base: string) {
  const b = base.trim().replace(/\/$/, "");
  return {
    async search(q: string): Promise<HiAnimeResult[]> {
      const r = await fetch(`${b}/anime/hianime/${encodeURIComponent(q)}`);
      if (!r.ok) throw new Error(`Search failed: HTTP ${r.status}${r.status === 0 ? " — is consumet running?" : ""}`);
      const data = await r.json() as { results?: HiAnimeResult[] };
      return data.results ?? [];
    },
    async info(id: string): Promise<HiAnimeInfo> {
      const r = await fetch(`${b}/anime/hianime/info?id=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(`Info failed: HTTP ${r.status}`);
      return r.json() as Promise<HiAnimeInfo>;
    },
    async watch(epId: string, server: Server, cat: Category): Promise<HiAnimeWatch> {
      const r = await fetch(`${b}/anime/hianime/watch/${encodeURIComponent(epId)}?server=${server}&category=${cat}`);
      if (!r.ok) {
        let tip = "";
        if (r.status === 502 || r.status === 404) tip = " MegaCloud extraction failed — aniwatch package may be outdated.";
        throw new Error(`Watch failed: HTTP ${r.status}.${tip}`);
      }
      const data = await r.json() as HiAnimeWatch;
      if (!data.sources?.length) throw new Error("No stream sources returned. The aniwatch package may be outdated.");
      return data;
    },
    async ping(): Promise<boolean> {
      try {
        const r = await fetch(`${b}/`, { signal: AbortSignal.timeout(3500) });
        return r.ok;
      } catch { return false; }
    },
  };
}

// ─── Small shared UI pieces ───────────────────────────────────────────────────
function Spinner() {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 48 }}><div className="player-loader" /></div>;
}

function ErrBox({ msg, tip, onX }: { msg: string; tip?: string; onX?: () => void }) {
  return (
    <div style={{ background: "var(--bg-surface2)", border: "1px solid var(--text-danger)", borderRadius: 8, padding: "12px 16px", margin: "10px 0" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ color: "var(--text-danger)", flex: 1, fontSize: 13 }}>⚠ {msg}</span>
        {onX && <button onClick={onX} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0, flexShrink: 0 }}><IconX size={13} /></button>}
      </div>
      {tip && <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)", background: "var(--bg-input)", borderRadius: 5, padding: "6px 10px", fontFamily: "monospace", wordBreak: "break-all" as const }}>💡 {tip}</div>}
    </div>
  );
}

function Chip({ label, color = "var(--text-muted)" }: { label: string; color?: string }) {
  return <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4, border: `1px solid ${color}`, color, letterSpacing: 0.5, textTransform: "uppercase" as const, flexShrink: 0 }}>{label}</span>;
}

function StatusDot({ ok, onClick }: { ok: boolean | null; onClick: () => void }) {
  const c = ok === null ? "var(--text-muted)" : ok ? "var(--text-success)" : "var(--text-danger)";
  return (
    <button onClick={onClick} title={ok === null ? "Checking…" : ok ? "Consumet online — click to change URL" : "Consumet offline — click to fix"} style={{ width: 28, height: 28, borderRadius: "50%", border: `2px solid ${c}`, background: "var(--bg-surface2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "border-color 0.2s" }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: c, display: "block" }} />
    </button>
  );
}

// ─── Settings modal ───────────────────────────────────────────────────────────
function SettingsModal({ current, onSave, onClose }: { current: string; onSave: (u: string) => void; onClose: () => void }) {
  const [val, setVal] = useState(current);
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");

  const test = async () => {
    setStatus("testing");
    setStatus(await makeApi(val).ping() ? "ok" : "fail");
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, width: 440, boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, color: "var(--text-primary)" }}>⚙ Consumet Server URL</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.65 }}>
          GRABIX runs its own consumet on <strong>port 3000</strong>, but if that one has outdated packages (causing 502/404 errors), you can run your own on a different port and point here.
          <span style={{ display: "block", marginTop: 8, fontFamily: "monospace", fontSize: 11, background: "var(--bg-surface2)", padding: "7px 10px", borderRadius: 5, color: "var(--text-accent)", lineHeight: 1.8 }}>
            cd consumet-local<br />
            npm update aniwatch<br />
            node server.cjs --port 3001
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input value={val} onChange={(e) => { setVal(e.target.value); setStatus("idle"); }} style={{ flex: 1, background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 10px", fontSize: 12, color: "var(--text-primary)", fontFamily: "monospace" }} />
          <button onClick={test} style={{ background: "var(--bg-surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 12px", fontSize: 12, cursor: "pointer", color: "var(--text-secondary)", flexShrink: 0 }}>
            {status === "testing" ? "Testing…" : "Test"}
          </button>
        </div>

        {status === "ok" && <div style={{ fontSize: 12, color: "var(--text-success)", marginBottom: 8 }}>✓ Connected!</div>}
        {status === "fail" && <div style={{ fontSize: 12, color: "var(--text-danger)", marginBottom: 8 }}>✗ Not reachable at that URL.</div>}

        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" as const }}>
          {["http://127.0.0.1:3000", "http://127.0.0.1:3001", "http://127.0.0.1:3002"].map((p) => (
            <button key={p} onClick={() => { setVal(p); setStatus("idle"); }} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 4, border: `1px solid ${val === p ? "var(--accent)" : "var(--border)"}`, background: val === p ? "var(--accent-light)" : "var(--bg-surface2)", color: val === p ? "var(--text-accent)" : "var(--text-muted)", cursor: "pointer", fontFamily: "monospace" }}>
              port {p.split(":").pop()}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 16px", fontSize: 12, cursor: "pointer", color: "var(--text-secondary)" }}>Cancel</button>
          <button onClick={() => { onSave(val); onClose(); }} style={{ background: "var(--accent)", border: "none", borderRadius: 6, padding: "7px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "white" }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Anime card ───────────────────────────────────────────────────────────────
function AnimeCard({ anime, onClick }: { anime: HiAnimeResult; onClick: () => void }) {
  const [err, setErr] = useState(false);
  return (
    <button onClick={onClick} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", cursor: "pointer", textAlign: "left", padding: 0, transition: "transform 0.15s, border-color 0.15s, box-shadow 0.15s", display: "flex", flexDirection: "column", width: "100%" }}
      onMouseEnter={(e) => { const el = e.currentTarget as HTMLButtonElement; el.style.transform = "translateY(-2px)"; el.style.borderColor = "var(--accent)"; el.style.boxShadow = "0 4px 16px rgba(0,0,0,0.18)"; }}
      onMouseLeave={(e) => { const el = e.currentTarget as HTMLButtonElement; el.style.transform = ""; el.style.borderColor = "var(--border)"; el.style.boxShadow = ""; }}>
      <div style={{ width: "100%", aspectRatio: "2/3", background: "var(--bg-surface2)", overflow: "hidden", position: "relative" }}>
        {anime.image && !err ? (
          <img src={anime.image} alt={anime.title} onError={() => setErr(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, color: "var(--text-muted)" }}>🎬</div>
        )}
        {anime.subOrDub === "dub" && <div style={{ position: "absolute", top: 6, right: 6 }}><Chip label="DUB" color="var(--accent)" /></div>}
      </div>
      <div style={{ padding: "8px 10px 10px", flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.35, wordBreak: "break-word" as const }}>{anime.title}</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const }}>
          {anime.type && <Chip label={anime.type} />}
          {(anime.totalEpisodes ?? 0) > 0 && <Chip label={`${anime.totalEpisodes} ep`} />}
        </div>
      </div>
    </button>
  );
}

// ─── Episode row ──────────────────────────────────────────────────────────────
function EpRow({ ep, active, onClick }: { ep: HiAnimeEpisode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ width: "100%", background: active ? "var(--accent-light)" : "var(--bg-surface2)", border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`, borderRadius: 6, padding: "8px 12px", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 10, color: active ? "var(--text-accent)" : "var(--text-primary)", marginBottom: 4, transition: "border-color 0.12s, background 0.12s" }}
      onMouseEnter={(e) => { if (!active) { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = "var(--accent)"; el.style.background = "var(--bg-hover)"; } }}
      onMouseLeave={(e) => { if (!active) { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = "var(--border)"; el.style.background = "var(--bg-surface2)"; } }}>
      <span style={{ minWidth: 36, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>Ep {ep.number}</span>
      <span style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{ep.title || `Episode ${ep.number}`}</span>
      {ep.isFiller && <Chip label="Filler" color="var(--text-warning)" />}
      {active && <IconPlay size={12} />}
    </button>
  );
}

// ─── Stream URL box ───────────────────────────────────────────────────────────
function UrlBox({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); };
  return (
    <div style={{ background: "var(--bg-surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>{label}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input readOnly value={url} onClick={(e) => (e.target as HTMLInputElement).select()} style={{ flex: 1, background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 4, padding: "5px 8px", fontSize: 11, color: "var(--text-primary)", fontFamily: "monospace" }} />
        <button onClick={copy} style={{ background: copied ? "var(--text-success)" : "var(--accent)", color: "white", border: "none", borderRadius: 5, padding: "5px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" as const, flexShrink: 0 }}>{copied ? "✓ Copied" : "Copy"}</button>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AnimePageV2() {
  const [consumetUrl, setConsumetUrl] = useState(getSavedUrl);
  const [showSettings, setShowSettings] = useState(false);
  const [consumetOk, setConsumetOk] = useState<boolean | null>(null);

  const api = useCallback(() => makeApi(consumetUrl), [consumetUrl]);

  const [screen, setScreen] = useState<Screen>("home");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<HiAnimeResult[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const [selectedAnime, setSelectedAnime] = useState<HiAnimeResult | null>(null);
  const [animeInfo, setAnimeInfo] = useState<HiAnimeInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoErr, setInfoErr] = useState<string | null>(null);
  const [selectedEp, setSelectedEp] = useState<HiAnimeEpisode | null>(null);
  const [epFilter, setEpFilter] = useState("");

  const [category, setCategory] = useState<Category>("sub");
  const [server, setServer] = useState<Server>("vidcloud");
  const [watchLoading, setWatchLoading] = useState(false);
  const [watchErr, setWatchErr] = useState<string | null>(null);
  const [watchData, setWatchData] = useState<HiAnimeWatch | null>(null);

  const [player, setPlayer] = useState<{
    title: string; subtitle?: string; poster?: string; sources: StreamSource[];
    currentEpisode?: number; episodeOptions?: number[];
    onSelectEpisode?: (n: number) => Promise<{ sources: StreamSource[]; subtitle?: string }>;
  } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  // Auto-detect consumet URL from backend on first mount (works in dev + packaged)
  useEffect(() => {
    const saved = getSavedUrl();
    detectConsumetUrl().then((detected) => {
      if (!detected) return;
      // Only auto-apply if the user hasn't manually changed it to something custom
      if (saved === FALLBACK_URL || saved === detected) {
        saveUrl(detected);
        setConsumetUrl(detected);
      }
    });
  }, []); // eslint-disable-line

  // Ping consumet on mount / URL change
  useEffect(() => {
    setConsumetOk(null);
    api().ping().then(setConsumetOk);
  }, [api]);

  const doSearch = useCallback(async (q: string) => {
    const t = q.trim(); if (!t) return;
    setSearching(true); setSearchErr(null); setHasSearched(true);
    try {
      const data = await api().search(t);
      setResults(data);
      if (!data.length) setSearchErr("No results found.");
    } catch (e) {
      setSearchErr(e instanceof Error ? e.message : "Search failed.");
      setResults([]);
    } finally { setSearching(false); }
  }, [api]);

  const selectAnime = useCallback(async (anime: HiAnimeResult) => {
    setSelectedAnime(anime); setScreen("info"); setAnimeInfo(null);
    setSelectedEp(null); setWatchData(null); setWatchErr(null); setEpFilter(""); setInfoErr(null); setInfoLoading(true);
    try {
      const info = await api().info(anime.id);
      setAnimeInfo(info);
      setCategory(!(info.subEpisodeCount ?? 0) && (info.dubEpisodeCount ?? 0) ? "dub" : "sub");
    } catch (e) { setInfoErr(e instanceof Error ? e.message : "Failed to load info."); }
    finally { setInfoLoading(false); }
  }, [api]);

  const selectEpisode = useCallback(async (ep: HiAnimeEpisode, cat = category, srv = server) => {
    setSelectedEp(ep); setWatchData(null); setWatchErr(null); setWatchLoading(true);
    try { setWatchData(await api().watch(ep.id, srv, cat)); }
    catch (e) { setWatchErr(e instanceof Error ? e.message : "Failed to get stream."); }
    finally { setWatchLoading(false); }
  }, [api, category, server]);

  useEffect(() => { if (selectedEp) selectEpisode(selectedEp, category, server); }, [server, category]); // eslint-disable-line

  const openPlayer = useCallback((data: HiAnimeWatch, ep: HiAnimeEpisode) => {
    if (!data.sources?.length) return;
    const title = animeInfo?.anime?.info?.name ?? selectedAnime?.title ?? "Anime";
    const poster = animeInfo?.anime?.info?.poster ?? selectedAnime?.image;
    const episodes = animeInfo?.episodes ?? [];
    const subs = (data.subtitles ?? []).filter(s => s.url && s.lang).map((s, i) => ({ id: `sub-${i}`, label: s.lang!, language: s.lang!.slice(0,2).toLowerCase(), url: s.url! }));
    const buildSources = (d: HiAnimeWatch): StreamSource[] =>
      (d.sources ?? []).map((s, i) => ({ id: `h-${i}`, label: s.quality ?? "Auto", provider: "HiAnime", kind: s.isM3U8 ? "hls" : "direct", url: s.url, quality: s.quality, subtitles: subs }));

    setPlayer({
      title, poster, sources: buildSources(data),
      subtitle: `${category === "sub" ? "SUB" : "DUB"} · Ep ${ep.number}${ep.title ? ` · ${ep.title}` : ""}`,
      currentEpisode: ep.number,
      episodeOptions: episodes.map(e => e.number),
      onSelectEpisode: async (n) => {
        const target = episodes.find(e => e.number === n);
        if (!target) throw new Error("Episode not found");
        const nd = await api().watch(target.id, server, category);
        
        return { sources: buildSources({ ...nd, subtitles: nd.subtitles }), subtitle: `${category === "sub" ? "SUB" : "DUB"} · Ep ${n}` };
      },
    });
    setScreen("player");
  }, [animeInfo, selectedAnime, category, server, api]);

  const applySettings = (url: string) => {
    saveUrl(url); setConsumetUrl(url.trim().replace(/\/$/, "") || "http://127.0.0.1:3000");
    setResults([]); setHasSearched(false); setSearchErr(null);
  };

  // ── Player ──────────────────────────────────────────────────────────────────
  if (screen === "player" && player) return (
    <>
      {showSettings && <SettingsModal current={consumetUrl} onSave={applySettings} onClose={() => setShowSettings(false)} />}
      <VidSrcPlayer title={player.title} subtitle={player.subtitle} poster={player.poster} sources={player.sources}
        mediaType="tv" currentEpisode={player.currentEpisode} episodeOptions={player.episodeOptions} episodeLabel="Ep"
        onSelectEpisode={player.onSelectEpisode} onClose={() => setScreen("info")}
        onDownload={async (url) => { await navigator.clipboard.writeText(url); }} />
    </>
  );

  // ── Info screen ─────────────────────────────────────────────────────────────
  if (screen === "info" && selectedAnime) {
    const info = animeInfo?.anime?.info;
    const episodes = animeInfo?.episodes ?? [];
    const subCnt = animeInfo?.subEpisodeCount ?? 0;
    const dubCnt = animeInfo?.dubEpisodeCount ?? 0;
    const filtered = epFilter.trim() ? episodes.filter(e => String(e.number).includes(epFilter) || (e.title ?? "").toLowerCase().includes(epFilter.toLowerCase())) : episodes;
    const watchTip = watchErr && (watchErr.includes("502") || watchErr.includes("404") || watchErr.includes("aniwatch"))
      ? "Try VidStreaming server. If both fail → click ● status dot → switch to port 3001 → run: cd consumet-local && npm update aniwatch && node server.cjs --port 3001"
      : undefined;

    return (
      <>
        {showSettings && <SettingsModal current={consumetUrl} onSave={applySettings} onClose={() => setShowSettings(false)} />}
        <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--bg-app)" }}>
          {/* Topbar */}
          <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <button onClick={() => setScreen("home")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-accent)", fontSize: 13, padding: 0 }}>← Back</button>
            <span style={{ color: "var(--text-muted)" }}>/</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{info?.name ?? selectedAnime.title}</span>
            <StatusDot ok={consumetOk} onClick={() => setShowSettings(true)} />
          </div>

          <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
            {/* Left: meta + episodes */}
            <div style={{ flex: "0 0 380px", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {infoLoading ? <Spinner /> : infoErr ? (
                <div style={{ padding: 16 }}><ErrBox msg={infoErr} tip="Check consumet is running. Click ● to change URL." /></div>
              ) : (<>
                {/* Poster + meta */}
                <div style={{ padding: 14, display: "flex", gap: 12, borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                  <div style={{ width: 76, height: 108, borderRadius: 6, overflow: "hidden", background: "var(--bg-surface2)", flexShrink: 0 }}>
                    {info?.poster ? <img src={info.poster} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>🎬</div>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4, lineHeight: 1.3 }}>{info?.name ?? selectedAnime.title}</div>
                    <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4, marginBottom: 6 }}>
                      {selectedAnime.type && <Chip label={selectedAnime.type} />}
                      {subCnt > 0 && <Chip label={`SUB ${subCnt}`} color="var(--text-success)" />}
                      {dubCnt > 0 && <Chip label={`DUB ${dubCnt}`} color="var(--accent)" />}
                    </div>
                    {info?.description && <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{info.description}</div>}
                  </div>
                </div>

                {/* Audio + server */}
                <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", width: 46, flexShrink: 0 }}>Audio</span>
                    {(["sub", "dub"] as Category[]).map(c => {
                      const dis = c === "sub" ? subCnt === 0 : dubCnt === 0;
                      const act = category === c;
                      return <button key={c} onClick={() => !dis && setCategory(c)} disabled={dis} style={{ padding: "4px 12px", borderRadius: 5, border: `1px solid ${act ? "var(--accent)" : "var(--border)"}`, background: act ? "var(--accent)" : "var(--bg-surface2)", color: act ? "white" : dis ? "var(--text-muted)" : "var(--text-primary)", cursor: dis ? "default" : "pointer", fontSize: 11, fontWeight: 600, opacity: dis ? 0.4 : 1 }}>{c.toUpperCase()}</button>;
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", width: 46, flexShrink: 0 }}>Server</span>
                    {(["vidcloud", "vidstreaming"] as Server[]).map(s => (
                      <button key={s} onClick={() => setServer(s)} style={{ padding: "4px 10px", borderRadius: 5, border: `1px solid ${server === s ? "var(--accent)" : "var(--border)"}`, background: server === s ? "var(--accent-light)" : "var(--bg-surface2)", color: server === s ? "var(--text-accent)" : "var(--text-secondary)", cursor: "pointer", fontSize: 11, fontWeight: server === s ? 700 : 400 }}>
                        {s === "vidcloud" ? "VidCloud" : "VidStreaming"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Episode filter */}
                {episodes.length > 10 && (
                  <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                    <input placeholder="Filter episodes…" value={epFilter} onChange={e => setEpFilter(e.target.value)} style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 10px", fontSize: 12, color: "var(--text-primary)", boxSizing: "border-box" as const }} />
                  </div>
                )}

                {/* Episode list */}
                <div style={{ flex: 1, overflowY: "auto", padding: "8px 14px" }}>
                  {filtered.length === 0
                    ? <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", padding: "24px 0" }}>No episodes</div>
                    : filtered.map(ep => <EpRow key={ep.id} ep={ep} active={selectedEp?.id === ep.id} onClick={() => selectEpisode(ep)} />)
                  }
                </div>
              </>)}
            </div>

            {/* Right: stream result */}
            <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
              {!selectedEp && !watchLoading && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60%", color: "var(--text-muted)", gap: 10 }}>
                  <div style={{ fontSize: 36 }}>👈</div>
                  <div style={{ fontSize: 14 }}>Select an episode from the list</div>
                </div>
              )}
              {watchLoading && <Spinner />}
              {watchErr && <ErrBox msg={watchErr} tip={watchTip} onX={() => setWatchErr(null)} />}
              {watchData && selectedEp && !watchLoading && (<>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                    Episode {selectedEp.number}{selectedEp.title ? ` — ${selectedEp.title}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Chip label={category.toUpperCase()} color="var(--accent)" />
                    <Chip label={server} />
                  </div>
                </div>

                {(watchData.sources?.length ?? 0) > 0 && (
                  <button onClick={() => openPlayer(watchData, selectedEp)} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--accent)", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: 20, transition: "background 0.15s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--accent-hover)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--accent)"; }}>
                    <IconPlay size={16} /> Play in GRABIX Player
                  </button>
                )}

                {(watchData.sources?.length ?? 0) > 0 ? (<>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 10, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>Stream Links ({watchData.sources!.length})</div>
                  {watchData.sources!.map((s, i) => <UrlBox key={i} label={`${s.quality ?? "Auto"} · ${s.isM3U8 ? "HLS/M3U8" : "MP4"}`} url={s.url} />)}
                </>) : <ErrBox msg="No stream sources returned." />}

                {(watchData.subtitles?.length ?? 0) > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>Subtitles ({watchData.subtitles!.length})</div>
                    {watchData.subtitles!.slice(0, 6).map((s, i) => <UrlBox key={i} label={s.lang ?? `Track ${i + 1}`} url={s.url ?? ""} />)}
                  </div>
                )}
              </>)}
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── Home / search ───────────────────────────────────────────────────────────
  return (
    <>
      {showSettings && <SettingsModal current={consumetUrl} onSave={applySettings} onClose={() => setShowSettings(false)} />}
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--bg-app)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", maxWidth: 640 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <IconSearch size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
              <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") doSearch(query); }}
                placeholder="Search anime… (e.g. Naruto, One Piece)"
                style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 32px", fontSize: 13, color: "var(--text-primary)", outline: "none", boxSizing: "border-box" as const }}
                onFocus={e => { (e.target as HTMLInputElement).style.borderColor = "var(--border-focus)"; }}
                onBlur={e => { (e.target as HTMLInputElement).style.borderColor = "var(--border)"; }}
              />
              {query && <button onClick={() => { setQuery(""); setResults([]); setHasSearched(false); }} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0 }}><IconX size={13} /></button>}
            </div>
            <button onClick={() => doSearch(query)} disabled={!query.trim() || searching} style={{ background: "var(--accent)", color: "white", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: query.trim() && !searching ? "pointer" : "default", opacity: query.trim() && !searching ? 1 : 0.5, flexShrink: 0 }}>
              {searching ? "Searching…" : "Search"}
            </button>
            <StatusDot ok={consumetOk} onClick={() => setShowSettings(true)} />
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          {!hasSearched && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60%", color: "var(--text-muted)", gap: 8 }}>
              <div style={{ fontSize: 48 }}>🍜</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-secondary)" }}>Anime V2</div>
              <div style={{ fontSize: 13 }}>Search any anime to get started</div>
              <div style={{ marginTop: 4, fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
                <span>Consumet:</span>
                <code style={{ color: consumetOk ? "var(--text-success)" : consumetOk === false ? "var(--text-danger)" : "var(--text-muted)" }}>{consumetUrl}</code>
                <span style={{ color: consumetOk ? "var(--text-success)" : consumetOk === false ? "var(--text-danger)" : "var(--text-muted)" }}>{consumetOk === null ? "checking…" : consumetOk ? "✓ online" : "✗ offline"}</span>
              </div>
              {consumetOk === false && (
                <div style={{ maxWidth: 440, width: "100%", marginTop: 4 }}>
                  <ErrBox msg="Consumet is not reachable." tip="Click the ● dot to change the URL/port, or start consumet: cd consumet-local && node server.cjs" />
                </div>
              )}
            </div>
          )}
          {searchErr && hasSearched && <ErrBox msg={searchErr} onX={() => setSearchErr(null)} />}
          {results.length > 0 && (<>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>{results.length} result{results.length !== 1 ? "s" : ""} for <strong style={{ color: "var(--text-secondary)" }}>"{query}"</strong></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 14 }}>
              {results.map(a => <AnimeCard key={a.id} anime={a} onClick={() => selectAnime(a)} />)}
            </div>
          </>)}
        </div>
      </div>
    </>
  );
}
