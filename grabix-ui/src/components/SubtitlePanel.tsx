import { useEffect, useState } from "react";
import { BACKEND_API, type SubtitleTrack } from "../lib/streamProviders";
import { IconCheck, IconSearch, IconSubtitle, IconX } from "./Icons";

export interface SubtitleResult {
  title: string;
  language: string;
  format: string;
  download_url: string;
  source: string;
  cached?: boolean;
}

interface Props {
  mediaTitle: string;
  searchTitle?: string;
  mediaType?: "movie" | "tv";
  visible: boolean;
  onClose: () => void;
  onSubtitleLoaded: (content: string, label: string) => void;
  onOpenLocalFile?: () => void;
  onSelectTrack?: (url: string, label: string) => void;
  availableTracks?: SubtitleTrack[];
  activeSubtitleName?: string;
  onClearSubtitles?: () => void;
}

const LANGUAGE_OPTIONS = [
  { label: "English", code: "en" },
  { label: "Urdu", code: "ur" },
  { label: "Arabic", code: "ar" },
  { label: "Hindi", code: "hi" },
  { label: "French", code: "fr" },
  { label: "Spanish", code: "es" },
  { label: "German", code: "de" },
];

function makeLanguageLabel(code: string): string {
  return LANGUAGE_OPTIONS.find((item) => item.code === code.toLowerCase())?.label ?? code.toUpperCase();
}

function normalizeSourceLabel(value: string): string {
  if (value === "subdl") return "SubDL";
  if (value === "opensubtitles.org") return "OpenSubs.org";
  if (value === "opensubtitles.com") return "OpenSubs.com";
  return value;
}

export default function SubtitlePanel({
  mediaTitle,
  searchTitle,
  mediaType = "movie",
  visible,
  onClose,
  onSubtitleLoaded,
  onOpenLocalFile,
  onSelectTrack,
  availableTracks = [],
  activeSubtitleName,
  onClearSubtitles,
}: Props) {
  const [query, setQuery] = useState(searchTitle || mediaTitle);
  const [language, setLanguage] = useState("en");
  const [results, setResults] = useState<SubtitleResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingUrl, setLoadingUrl] = useState("");
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setQuery(searchTitle || mediaTitle);
      setError("");
      return;
    }
    const timeoutId = window.setTimeout(() => setMounted(false), 180);
    return () => window.clearTimeout(timeoutId);
  }, [mediaTitle, searchTitle, visible]);

  const handleSearch = async () => {
    const title = query.trim();
    if (!title) {
      setResults([]);
      setError("Enter a movie or episode title to search subtitles.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        title,
        language,
        type: mediaType,
      });
      const response = await fetch(`${BACKEND_API}/subtitles/search?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Search failed with ${response.status}`);
      }
      const data = (await response.json()) as { results?: SubtitleResult[] };
      const nextResults = data.results ?? [];
      setResults(nextResults);
      if (nextResults.length === 0) {
        setError("No subtitles found for that search yet. Try editing the title or language.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown subtitle search error";
      setResults([]);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const loadSubtitle = async (result: SubtitleResult) => {
    const title = query.trim() || mediaTitle;
    setLoadingUrl(result.download_url || `${result.source}-${result.language}`);
    setError("");

    try {
      let response: Response;
      if (result.cached) {
        const params = new URLSearchParams({
          title,
          language,
          type: mediaType,
        });
        response = await fetch(`${BACKEND_API}/subtitles/cached?${params.toString()}`);
      } else {
        const params = new URLSearchParams({
          url: result.download_url,
          title,
          language,
          type: mediaType,
          source: result.source,
          format: result.format,
        });
        response = await fetch(`${BACKEND_API}/subtitles/download?${params.toString()}`);
      }

      if (!response.ok) {
        throw new Error(`Subtitle load failed with ${response.status}`);
      }

      const content = await response.text();
      const label = `${title} - ${makeLanguageLabel(language)} - ${result.format.toUpperCase()}`;
      onSubtitleLoaded(content, label);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown subtitle load error";
      setError(message);
    } finally {
      setLoadingUrl("");
    }
  };

  if (!mounted) {
    return null;
  }

  return (
    <div
      data-subtitle-panel="true"
      onClick={(event) => event.stopPropagation()}
      style={{
        position: "absolute",
        left: 20,
        right: 20,
        bottom: 24,
        zIndex: 16,
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(10, 13, 18, 0.96)",
        boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
        backdropFilter: "blur(18px)",
        overflow: "hidden",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(12px) scale(0.98)",
        transition: "opacity 180ms ease, transform 180ms ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "14px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: "rgba(255,255,255,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconSubtitle size={16} color="#f4f7fb" />
          </div>
          <div>
            <div style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>Subtitles</div>
            <div style={{ color: "rgba(255,255,255,0.62)", fontSize: 12 }}>
              Search, cache, and load subtitles without leaving playback.
            </div>
          </div>
        </div>
        <button
          className="player-control-icon"
          onClick={onClose}
          aria-label="Close subtitles"
          title="Close subtitles"
        >
          <IconX size={15} color="currentColor" />
        </button>
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14, maxHeight: 360, overflowY: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) 140px 110px", gap: 10 }}>
          <input
            className="input-base"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search subtitle title..."
            style={{ fontSize: 13 }}
          />
          <select
            className="input-base"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            style={{ fontSize: 13 }}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={handleSearch} disabled={loading}>
            <IconSearch size={13} /> {loading ? "Searching" : "Search"}
          </button>
        </div>

        {(onOpenLocalFile || availableTracks.length > 0 || activeSubtitleName) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>
              Current Sources
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {onOpenLocalFile && (
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onOpenLocalFile}>
                  Load local VTT
                </button>
              )}
              {availableTracks.map((track) => (
                <button
                  key={track.id}
                  className="btn btn-ghost"
                  style={{ fontSize: 12 }}
                  onClick={() => onSelectTrack?.(track.url, track.label)}
                >
                  {track.label}
                </button>
              ))}
              {activeSubtitleName && onClearSubtitles && (
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onClearSubtitles}>
                  Disable current subtitle
                </button>
              )}
            </div>
            {activeSubtitleName && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
                Active: <strong style={{ color: "#fff" }}>{activeSubtitleName}</strong>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>
            Results
          </div>

          {error && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.04)",
                color: "rgba(255,255,255,0.76)",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          )}

          {results.length === 0 && !error && !loading && (
            <div
              style={{
                padding: "14px 12px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.04)",
                color: "rgba(255,255,255,0.58)",
                fontSize: 12,
              }}
            >
              Search for subtitles to load them directly into the player.
            </div>
          )}

          {results.map((result, index) => (
            <div
              key={`${result.source}-${result.download_url || "cached"}-${index}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "12px 12px",
                borderRadius: 14,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "#fff", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {result.title}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 5 }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.62)" }}>{makeLanguageLabel(language)}</span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.62)" }}>{result.format.toUpperCase()}</span>
                  <span style={{ fontSize: 11, color: "#9ec7ff" }}>{normalizeSourceLabel(result.source)}</span>
                  {result.cached && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        color: "#8ef0a8",
                      }}
                    >
                      <IconCheck size={11} color="#8ef0a8" /> Cached
                    </span>
                  )}
                </div>
              </div>

              <button
                className="btn btn-primary"
                style={{ whiteSpace: "nowrap", fontSize: 12 }}
                onClick={() => void loadSubtitle(result)}
                disabled={loadingUrl === (result.download_url || `${result.source}-${result.language}`)}
              >
                {loadingUrl === (result.download_url || `${result.source}-${result.language}`) ? "Loading" : "Load"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
