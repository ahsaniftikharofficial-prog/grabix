import { useEffect, useMemo, useState, type ReactNode } from "react";
import { IconDownload, IconRefresh, IconSearch, IconX } from "../components/Icons";
import {
  fetchConsumetDomainInfo,
  fetchConsumetGenericRead,
  fetchConsumetNews,
  fetchConsumetNewsArticle,
  searchConsumetDomain,
  type ConsumetDomain,
  type ConsumetMediaDetail,
  type ConsumetMediaSummary,
  type ConsumetNewsArticle,
  type ConsumetNewsItem,
} from "../lib/consumetProviders";

type ExploreTab = "news" | "books" | "comics" | "light-novels";

const PROVIDER_BY_TAB: Record<Exclude<ExploreTab, "news">, string> = {
  books: "gutendex",
  comics: "getcomics",
  "light-novels": "readlightnovels",
};

const TOPIC_OPTIONS = [
  { label: "All News", value: "" },
  { label: "Anime", value: "anime" },
  { label: "Manga", value: "manga" },
];

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getReadPreview(value: unknown): string {
  if (typeof value === "string") return value;
  const record = toRecord(value);
  if (!record) return JSON.stringify(value, null, 2);
  if (typeof record.preview_text === "string" && record.preview_text.trim()) return record.preview_text;
  if (typeof record.description === "string" && record.description.trim()) return record.description;
  return JSON.stringify(value, null, 2);
}

function getReadUrl(value: unknown): string {
  const record = toRecord(value);
  if (!record) return "";
  if (typeof record.read_url === "string" && record.read_url.trim()) return record.read_url;
  if (typeof record.url === "string" && record.url.trim()) return record.url;
  return "";
}

function getDownloadLinks(value: unknown): Array<{ label: string; url: string }> {
  const record = toRecord(value);
  if (!record || !Array.isArray(record.downloads)) return [];
  return record.downloads.flatMap((item) => {
    const download = toRecord(item);
    if (!download) return [];
    const label = typeof download.label === "string" ? download.label.trim() : "";
    const url = typeof download.url === "string" ? download.url.trim() : "";
    return label && url ? [{ label, url }] : [];
  });
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="empty-state">
      <IconSearch size={34} />
      <p>{label}</p>
    </div>
  );
}

function LoadingGrid({ count = 8 }: { count?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="card" style={{ overflow: "hidden" }}>
          <div style={{ width: "100%", height: 220, background: "var(--bg-surface2)" }} />
          <div style={{ padding: "10px 12px" }}>
            <div style={{ height: 12, borderRadius: 4, background: "var(--bg-surface2)", marginBottom: 8 }} />
            <div style={{ height: 10, width: "60%", borderRadius: 4, background: "var(--bg-surface2)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ExplorePage() {
  const [tab, setTab] = useState<ExploreTab>("news");
  const [topic, setTopic] = useState("");
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [newsItems, setNewsItems] = useState<ConsumetNewsItem[]>([]);
  const [mediaItems, setMediaItems] = useState<ConsumetMediaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNews, setSelectedNews] = useState<ConsumetNewsArticle | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<ConsumetMediaDetail | null>(null);
  const [readingContent, setReadingContent] = useState<unknown>(null);
  const [readingLoading, setReadingLoading] = useState(false);

  const provider = tab === "news" ? "" : PROVIDER_BY_TAB[tab];
  const isNews = tab === "news";
  const readUrl = getReadUrl(readingContent);
  const downloadLinks = getDownloadLinks(readingContent);
  const readPreview = readingContent !== null ? getReadPreview(readingContent) : "";
  const title = useMemo(() => {
    if (tab === "news") return "News";
    if (tab === "books") return "Books";
    if (tab === "comics") return "Comics";
    return "Light Novels";
  }, [tab]);

  const loadNews = async (nextTopic: string) => {
    setLoading(true);
    setError(null);
    try {
      setNewsItems(await fetchConsumetNews(nextTopic || undefined));
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Could not load news.");
      setNewsItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedNews(null);
    setSelectedMedia(null);
    setReadingContent(null);
    if (tab === "news") {
      void loadNews(topic);
      return;
    }
    if (!query.trim()) {
      setMediaItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const items = await searchConsumetDomain(tab as ConsumetDomain, query, provider);
        if (!cancelled) setMediaItems(items);
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "Could not load results.");
          setMediaItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [tab, topic, query, provider]);

  const openNews = async (item: ConsumetNewsItem) => {
    try {
      setSelectedNews(await fetchConsumetNewsArticle(item.id));
    } catch {
      setSelectedNews({
        ...item,
        content: item.description,
      });
    }
  };

  const openMedia = async (item: ConsumetMediaSummary) => {
    setReadingContent(null);
    try {
      setSelectedMedia(await fetchConsumetDomainInfo(tab as ConsumetDomain, item.id, item.provider || provider));
    } catch {
      setSelectedMedia({
        domain: tab,
        provider: item.provider || provider,
        item,
      });
    }
  };

  const openRead = async () => {
    if (!selectedMedia) return;
    setReadingLoading(true);
    try {
      const nextContent = await fetchConsumetGenericRead(
        tab as Exclude<ConsumetDomain, "anime" | "manga">,
        selectedMedia.item.id,
        selectedMedia.provider || provider
      );
      setReadingContent(nextContent);
    } catch (fetchError) {
      setReadingContent(fetchError instanceof Error ? fetchError.message : "Could not open this item.");
    } finally {
      setReadingLoading(false);
    }
  };

  const tabs: { id: ExploreTab; label: string }[] = [
    { id: "news", label: "News" },
    { id: "books", label: "Books" },
    { id: "comics", label: "Comics" },
    { id: "light-novels", label: "Light Novels" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Explore</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>Consumet-powered news, books, comics, and light novels</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {isNews ? (
            <select className="input-base" style={{ width: 180, fontSize: 13 }} value={topic} onChange={(event) => setTopic(event.target.value)}>
              {TOPIC_OPTIONS.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
            </select>
          ) : (
            <>
              <div style={{ position: "relative" }}>
                <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}><IconSearch size={13} color="var(--text-muted)" /></div>
                <input className="input-base" style={{ paddingLeft: 32, width: 240, fontSize: 13 }} placeholder={`Search ${title.toLowerCase()}...`} value={searchText} onChange={(event) => setSearchText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") setQuery(searchText.trim()); }} />
              </div>
              <button className="btn btn-primary" onClick={() => setQuery(searchText.trim())}>Search</button>
              {query && <button className="btn btn-ghost" onClick={() => { setSearchText(""); setQuery(""); }}><IconX size={13} /> Clear</button>}
            </>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, padding: "10px 24px 0", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
        {tabs.map((item) => (
          <button key={item.id} onClick={() => setTab(item.id)} style={{ padding: "7px 16px", fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer", background: "transparent", borderBottom: tab === item.id ? "2px solid var(--accent)" : "2px solid transparent", color: tab === item.id ? "var(--accent)" : "var(--text-muted)", transition: "var(--transition)", borderRadius: 0 }}>
            {item.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {loading ? <LoadingGrid /> : error ? (
          <div className="empty-state">
            <IconX size={34} />
            <p>{error}</p>
            <button className="btn btn-ghost" onClick={() => isNews ? void loadNews(topic) : setQuery((value) => value)}><IconRefresh size={14} /> Try Again</button>
          </div>
        ) : isNews ? (
          newsItems.length === 0 ? <EmptyState label="No news articles were available." /> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
              {newsItems.map((item) => (
                <button key={item.id} className="card" style={{ textAlign: "left", overflow: "hidden", cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg-surface)" }} onClick={() => void openNews(item)}>
                  {item.image ? <img src={item.image} alt={item.title} style={{ width: "100%", height: 160, objectFit: "cover" }} /> : <div style={{ width: "100%", height: 160, background: "var(--bg-surface2)" }} />}
                  <div style={{ padding: "12px 14px" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>{item.title}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>{item.published_at || "Latest feed"}</div>
                  </div>
                </button>
              ))}
            </div>
          )
        ) : !query ? (
          <EmptyState label={`Search ${title.toLowerCase()} to load results from ${provider}.`} />
        ) : mediaItems.length === 0 ? (
          <EmptyState label={`No ${title.toLowerCase()} results found.`} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
            {mediaItems.map((item) => (
              <button key={`${item.provider}-${item.id}`} className="card" style={{ overflow: "hidden", textAlign: "left", cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg-surface)" }} onClick={() => void openMedia(item)}>
                {item.image ? <img src={item.image} alt={item.title} style={{ width: "100%", height: 220, objectFit: "cover" }} /> : <div style={{ width: "100%", height: 220, background: "var(--bg-surface2)" }} />}
                <div style={{ padding: "10px 12px" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>{item.title}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>{item.provider.toUpperCase()}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedNews && (
        <Modal onClose={() => setSelectedNews(null)} title={selectedNews.title}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>{selectedNews.published_at || "Latest feed"}</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{selectedNews.content || selectedNews.description || "No article body was returned."}</div>
          {selectedNews.url ? <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => window.open(selectedNews.url, "_blank")}><IconDownload size={14} /> Open Source</button> : null}
        </Modal>
      )}

      {selectedMedia && (
        <Modal onClose={() => { setSelectedMedia(null); setReadingContent(null); }} title={selectedMedia.item.title}>
          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: 14 }}>
            {selectedMedia.item.image ? <img src={selectedMedia.item.image} alt={selectedMedia.item.title} style={{ width: 120, height: 170, objectFit: "cover", borderRadius: 12, border: "1px solid var(--border)" }} /> : <div style={{ width: 120, height: 170, borderRadius: 12, background: "var(--bg-surface2)" }} />}
            <div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {selectedMedia.item.year ? <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12 }}>{selectedMedia.item.year}</span> : null}
                <span style={{ background: "var(--bg-surface2)", padding: "3px 9px", borderRadius: 20, fontSize: 12 }}>{selectedMedia.provider.toUpperCase()}</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>{selectedMedia.item.description || "No description was returned for this item."}</div>
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button className="btn btn-primary" onClick={() => void openRead()} disabled={readingLoading}>
                  <IconDownload size={14} /> {readingLoading ? "Opening..." : tab === "books" ? "Load Preview" : "Open Content"}
                </button>
                {selectedMedia.item.url ? <button className="btn btn-ghost" onClick={() => window.open(selectedMedia.item.url, "_blank")}>Open Source</button> : null}
              </div>
              {readingContent !== null && (readUrl || downloadLinks.length > 0) ? (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                  {readUrl ? (
                    <button className="btn btn-ghost" onClick={() => window.open(readUrl, "_blank")}>
                      <IconDownload size={14} /> Read Online
                    </button>
                  ) : null}
                  {downloadLinks.map((item) => (
                    <button key={`${item.label}-${item.url}`} className="btn btn-ghost" onClick={() => window.open(item.url, "_blank")}>
                      <IconDownload size={14} /> Download {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          {readingContent !== null && (
            <div className="card" style={{ marginTop: 16, padding: 14, background: "var(--bg-surface2)" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>{tab === "books" ? "Preview" : "Read Output"}</div>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>{readPreview}</pre>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: "100%", maxWidth: 760, maxHeight: "90vh", overflow: "auto", padding: 20, border: "1px solid var(--border)" }} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{title}</div>
          <button className="btn-icon" onClick={onClose}><IconX size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
