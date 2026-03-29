import { useEffect, useMemo, useState } from "react";
import {
  fetchConsumetMangaChapters,
  fetchConsumetMangaDiscover,
  fetchConsumetMangaRead,
  searchConsumetManga,
  type ConsumetChapter,
  type ConsumetMediaSummary,
} from "../lib/consumetProviders";
import {
  fetchComickChapters,
  fetchComickFrontpage,
  fetchComickPages,
  fetchMangaChapters,
  fetchMangaDetails,
  fetchMangaPages,
  fetchMangaRecommendations,
  fetchSeasonalManga,
  fetchTrendingManga,
  searchManga,
  toMangaImageProxy,
  type MangaChapter,
  type MangaDetailsResponse,
  type MangaDiscoveryItem,
} from "../lib/mangaProviders";
import { useContentFilter } from "../context/ContentFilterContext";
import { filterAdultContent } from "../lib/contentFilter";
import { IconDownload, IconFolder, IconSearch, IconStar, IconX } from "../components/Icons";
import { BACKEND_API } from "../lib/api";
import {
  getOfflineChapterPages,
  getOfflineMangaKey,
  getOfflineMangaRecord,
  saveOfflineChapterPages,
  saveOfflineMangaRecord,
  type OfflineMangaRecord,
} from "../lib/mangaOffline";

type ReaderState = { chapterIndex: number; chapter: MangaChapter };
type ChapterSource = "auto" | "mangadex" | "consumet" | "comick";
type DownloadState = {
  status: "idle" | "downloading" | "done" | "error";
  message?: string;
  progress?: number;
};

function chapterDownloadKey(mangaKey: string, chapterId: string): string {
  return `${mangaKey}:${chapterId}`;
}

const LANGUAGE_OPTIONS = [
  { label: "English", value: "en" },
  { label: "Arabic", value: "ar" },
  { label: "Hindi", value: "hi" },
  { label: "Urdu", value: "ur" },
  { label: "Spanish", value: "es" },
  { label: "French", value: "fr" },
];

function currentSeason(): string {
  const month = new Date().getMonth() + 1;
  if (month <= 3) return "WINTER";
  if (month <= 6) return "SPRING";
  if (month <= 9) return "SUMMER";
  return "FALL";
}

function coverFallback(title: string): string {
  return `https://via.placeholder.com/300x420/1b1f2a/e5e7eb?text=${encodeURIComponent((title || "M").slice(0, 1).toUpperCase())}`;
}

function chapterNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -1;
}

function sortPageUrls(pages: string[]): string[] {
  const extractKey = (url: string, index: number): number => {
    const match = url.match(/(?:page|p|image|img|\/)(\d+)(?:\D|$)/i) || url.match(/(\d+)(?=\.[a-z]{2,4}(?:\?|$))/i);
    return match ? Number(match[1]) : index + 1;
  };
  return [...pages]
    .map((url, index) => ({ url, index, key: extractKey(url, index) }))
    .sort((left, right) => left.key - right.key || left.index - right.index)
    .map((item) => item.url);
}

function mergeChapterSets(...sets: MangaChapter[][]): MangaChapter[] {
  const byNumber = new Map<string, MangaChapter>();
  for (const set of sets) {
    for (const chapter of set) {
      const number = String(chapter.chapter_number || "").trim();
      const key = number || chapter.chapter_id;
      if (!key || byNumber.has(key)) continue;
      byNumber.set(key, chapter);
    }
  }
  return [...byNumber.values()].sort((left, right) => chapterNumber(left.chapter_number) - chapterNumber(right.chapter_number));
}

function mapConsumetMangaToDiscovery(item: ConsumetMediaSummary): MangaDiscoveryItem {
  return {
    anilist_id: item.anilist_id,
    mal_id: item.mal_id,
    mangadex_id: item.mangadex_id || item.id,
    title: item.title,
    cover_image: item.image || coverFallback(item.title),
    score: item.rating ?? 0,
    genres: item.genres ?? [],
    status: item.status || "Unknown",
    description: item.description || "",
    year: item.year ?? undefined,
  };
}

function mapConsumetChapter(chapter: ConsumetChapter): MangaChapter {
  return {
    chapter_id: chapter.id,
    chapter_number: chapter.number,
    title: chapter.title,
    language: chapter.language || "en",
    pages: 0,
    published_at: chapter.released_at || "",
    provider: "mangadex",
    source_name: "consumet",
  };
}

function dedupeMangaItems(items: MangaDiscoveryItem[]): MangaDiscoveryItem[] {
  const seen = new Set<string>();
  const result: MangaDiscoveryItem[] = [];
  for (const item of items) {
    const key = `${item.anilist_id ?? ""}-${item.mangadex_id ?? ""}-${item.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="empty-state">
      <IconX size={34} />
      <p>{message}</p>
      <button className="btn btn-ghost" onClick={onRetry}>Try Again</button>
    </div>
  );
}

function LoadingGrid({ count = 8 }: { count?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 14 }}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="card" style={{ overflow: "hidden" }}>
          <div style={{ width: "100%", height: 230, background: "var(--bg-surface2)" }} />
          <div style={{ padding: "10px 12px" }}>
            <div style={{ height: 12, borderRadius: 4, background: "var(--bg-surface2)", marginBottom: 8 }} />
            <div style={{ height: 10, width: "60%", borderRadius: 4, background: "var(--bg-surface2)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="empty-state">
      <IconSearch size={36} />
      <p>{label}</p>
    </div>
  );
}

function MangaReaderImage({ src, alt, index, total, onLoadNext }: { src: string; alt: string; index: number; total: number; onLoadNext: () => void }) {
  return (
    <div style={{ width: "100%", maxWidth: 900 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Page {index + 1} / {total}</div>
      <img
        src={src}
        alt={alt}
        loading={index < 2 ? "eager" : "lazy"}
        decoding="async"
        referrerPolicy="no-referrer"
        style={{ width: "100%", display: "block", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-surface2)" }}
        onLoad={onLoadNext}
        onError={(event) => { (event.target as HTMLImageElement).style.opacity = "0.35"; }}
      />
    </div>
  );
}

function MangaCard({
  item,
  onOpen,
  onRead,
  onDownload,
}: {
  item: MangaDiscoveryItem;
  onOpen: () => void;
  onRead: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="card" style={{ overflow: "hidden", textAlign: "left", cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
      <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(); }} style={{ outline: "none" }}>
      <div style={{ position: "relative" }}>
        <img
          src={item.cover_image || coverFallback(item.title)}
          alt={item.title}
          loading="lazy"
          decoding="async"
          style={{ width: "100%", height: 230, objectFit: "cover", display: "block" }}
          onError={(event) => { (event.target as HTMLImageElement).src = coverFallback(item.title); }}
        />
        {!!item.score && (
          <div style={{ position: "absolute", top: 8, right: 8, display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 999, background: "rgba(0,0,0,0.72)", color: "#f6d061", fontSize: 11, fontWeight: 700 }}>
            <IconStar size={10} color="#f6d061" />
            {item.score}
          </div>
        )}
      </div>
      <div style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>{item.title}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.status}</span>
          {item.year ? <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.year}</span> : null}
        </div>
      </div>
      </div>
      <div style={{ padding: "0 12px 12px" }}>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center", height: 32 }} onClick={onRead}>
            Read
          </button>
          <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center", height: 32 }} onClick={onDownload}>
            Chapters
          </button>
        </div>
      </div>
    </div>
  );
}

function HorizontalRail({
  title,
  subtitle,
  items,
  onOpen,
  onRead,
  onDownload,
}: {
  title: string;
  subtitle?: string;
  items: MangaDiscoveryItem[];
  onOpen: (item: MangaDiscoveryItem) => void;
  onRead: (item: MangaDiscoveryItem) => void;
  onDownload: (item: MangaDiscoveryItem) => void;
}) {
  return (
    <section>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
        {subtitle ? <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</div> : null}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(165px, 1fr))", gap: 14 }}>
        {items.map((item) => {
          return (
            <MangaCard
              key={`${title}-${item.anilist_id ?? item.mangadex_id ?? item.title}`}
              item={item}
              onOpen={() => onOpen(item)}
              onRead={() => onRead(item)}
              onDownload={() => onDownload(item)}
            />
          );
        })}
      </div>
    </section>
  );
}

export default function MangaPage() {
  const { adultContentBlocked } = useContentFilter();
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [trending, setTrending] = useState<MangaDiscoveryItem[]>([]);
  const [seasonal, setSeasonal] = useState<MangaDiscoveryItem[]>([]);
  const [comickHot, setComickHot] = useState<MangaDiscoveryItem[]>([]);
  const [consumetHot, setConsumetHot] = useState<MangaDiscoveryItem[]>([]);
  const [searchResults, setSearchResults] = useState<MangaDiscoveryItem[]>([]);
  const [homeLoading, setHomeLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<MangaDiscoveryItem | null>(null);
  const [detailData, setDetailData] = useState<MangaDetailsResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [chapters, setChapters] = useState<MangaChapter[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [chaptersError, setChaptersError] = useState<string | null>(null);
  const [chapterLanguage, setChapterLanguage] = useState("en");
  const [chapterSource, setChapterSource] = useState<ChapterSource>("auto");
  const [resolvedChapterSource, setResolvedChapterSource] = useState<"mangadex" | "comick" | null>(null);
  const [chapterGroup, setChapterGroup] = useState(0);
  const [reader, setReader] = useState<ReaderState | null>(null);
  const [readerPages, setReaderPages] = useState<string[]>([]);
  const [readerLoading, setReaderLoading] = useState(false);
  const [readerError, setReaderError] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<MangaDiscoveryItem[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [offlineRecord, setOfflineRecord] = useState<OfflineMangaRecord | null>(null);
  const [chapterDownloadStates, setChapterDownloadStates] = useState<Record<string, DownloadState>>({});
  const [downloadedChapterKeys, setDownloadedChapterKeys] = useState<Set<string>>(new Set());

  const season = useMemo(() => currentSeason(), []);
  const seasonYear = useMemo(() => new Date().getFullYear(), []);
  const filteredTrending = useMemo(() => filterAdultContent(trending, adultContentBlocked), [trending, adultContentBlocked]);
  const filteredSeasonal = useMemo(() => filterAdultContent(seasonal, adultContentBlocked), [seasonal, adultContentBlocked]);
  const filteredComickHot = useMemo(() => filterAdultContent(comickHot, adultContentBlocked), [comickHot, adultContentBlocked]);
  const filteredConsumetHot = useMemo(() => filterAdultContent(consumetHot, adultContentBlocked), [consumetHot, adultContentBlocked]);
  const filteredSearchResults = useMemo(() => filterAdultContent(searchResults, adultContentBlocked), [searchResults, adultContentBlocked]);
  const filteredRecommendations = useMemo(() => filterAdultContent(recommendations, adultContentBlocked), [recommendations, adultContentBlocked]);
  const visibleLibraryItems = useMemo(
    () => dedupeMangaItems([...filteredTrending, ...filteredSeasonal, ...filteredComickHot, ...filteredConsumetHot, ...filteredSearchResults, ...filteredRecommendations]),
    [filteredTrending, filteredSeasonal, filteredComickHot, filteredConsumetHot, filteredSearchResults, filteredRecommendations]
  );

  const updateChapterDownloadState = (mangaKey: string, chapterId: string, next: DownloadState) => {
    const key = chapterDownloadKey(mangaKey, chapterId);
    setChapterDownloadStates((current) => ({ ...current, [key]: next }));
  };

  const markChapterDownloaded = (mangaKey: string, chapterId: string) => {
    const key = chapterDownloadKey(mangaKey, chapterId);
    setDownloadedChapterKeys((current) => new Set([...current, key]));
  };

  const revealDownloadedChapter = async (chapter: MangaChapter) => {
    if (!selectedItem) return;
    const mangaKey = getOfflineMangaKey(selectedItem);
    try {
      const response = await fetch(
        `${BACKEND_API}/open-download-folder?path=${encodeURIComponent("")}`,
        { method: "POST" }
      );
      if (!response.ok) {
        throw new Error(`Reveal failed with ${response.status}`);
      }
      updateChapterDownloadState(mangaKey, chapter.chapter_id, {
        status: "done",
        message: "Opened downloads folder.",
        progress: 100,
      });
    } catch (error) {
      updateChapterDownloadState(mangaKey, chapter.chapter_id, {
        status: "error",
        message: error instanceof Error ? error.message : "Could not open Explorer.",
      });
    }
  };

  const resolveDetailsForItem = async (item: MangaDiscoveryItem) => (
    item.anilist_id
      ? await fetchMangaDetails(item.anilist_id, "anilist_id")
      : await fetchMangaDetails(item.mangadex_id!, "mangadex_id")
  );

  const resolveChaptersForItem = async (item: MangaDiscoveryItem, details: MangaDetailsResponse | null, language = "en", source: ChapterSource = "auto") => {
    const mangadexId = details?.mangadex?.mangadex_id || item.mangadex_id;
    const wantsMangadex = source !== "comick" && source !== "consumet" && !!mangadexId;
    const wantsConsumet = source !== "comick" && !!mangadexId;
    const wantsComick = source !== "mangadex";
    const [mdxResult, consumetResult, comickResult] = await Promise.allSettled([
      wantsMangadex ? fetchMangaChapters(mangadexId!, language) : Promise.resolve([] as MangaChapter[]),
      wantsConsumet ? fetchConsumetMangaChapters(mangadexId!, "mangadex") : Promise.resolve([] as ConsumetChapter[]),
      wantsComick ? fetchComickChapters(item.title) : Promise.resolve({ match: null, items: [] as MangaChapter[], total: 0 }),
    ]);

    const mdxItems = mdxResult.status === "fulfilled"
      ? [...mdxResult.value].map((entry) => ({ ...entry, provider: "mangadex" as const })).sort((a, b) => chapterNumber(a.chapter_number) - chapterNumber(b.chapter_number))
      : [];
    const consumetItems = consumetResult.status === "fulfilled"
      ? [...consumetResult.value].map(mapConsumetChapter).sort((a, b) => chapterNumber(a.chapter_number) - chapterNumber(b.chapter_number))
      : [];
    const comickItems = comickResult.status === "fulfilled"
      ? [...(comickResult.value.items ?? [])].map((entry) => ({ ...entry, provider: "comick" as const })).sort((a, b) => chapterNumber(a.chapter_number) - chapterNumber(b.chapter_number))
      : [];

    let chosen: MangaChapter[] = [];
    let resolvedSource: "mangadex" | "comick" | null = null;
    if (source === "mangadex") {
      chosen = mdxItems;
      resolvedSource = chosen.length ? "mangadex" : null;
    } else if (source === "consumet") {
      chosen = consumetItems;
      resolvedSource = chosen.length ? "mangadex" : null;
    } else if (source === "comick") {
      chosen = comickItems;
      resolvedSource = chosen.length ? "comick" : null;
    } else {
      chosen = mergeChapterSets(consumetItems, mdxItems, comickItems);
      resolvedSource = consumetItems.length || mdxItems.length ? "mangadex" : (comickItems.length ? "comick" : null);
    }

    if (!chosen.length && mdxItems.length) {
      chosen = mdxItems;
      resolvedSource = "mangadex";
    }
    if (!chosen.length && comickItems.length) {
      chosen = comickItems;
      resolvedSource = "comick";
    }
    if (!chosen.length) {
      throw new Error("No chapters available from Consumet, MangaDex, or Comick for this title.");
    }
    return { chapters: chosen, resolvedSource };
  };

  const resolvePagesForChapter = async (chapter: MangaChapter): Promise<string[]> => {
    const attempts: Array<() => Promise<string[]>> = [];
    const consumetRead = async () => fetchConsumetMangaRead(chapter.chapter_id, "mangadex");
    const mangadexRead = async () => fetchMangaPages(chapter.chapter_id);
    const comickRead = async () => fetchComickPages(chapter.chapter_url ?? chapter.chapter_id);

    if (chapter.provider === "comick") {
      attempts.push(comickRead);
    } else {
      attempts.push(mangadexRead, consumetRead, comickRead);
    }

    let lastError: unknown = null;
    for (const attempt of attempts) {
      try {
        const nextPages = await attempt();
        if (nextPages.length > 0) {
          return sortPageUrls(
            nextPages.map((url) => (
              !url || url.startsWith("blob:") || url.includes("/manga/image-proxy?")
                ? url
                : toMangaImageProxy(url)
            ))
          );
        }
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    return [];
  };

  const hydrateOfflineFlags = async (items: MangaDiscoveryItem[]) => {
    const chapterKeys: string[] = [];
    await Promise.all(items.map(async (item) => {
      const mangaKey = getOfflineMangaKey(item);
      const record = await getOfflineMangaRecord(mangaKey);
      if (!record) return;
      await Promise.all(record.chapters.map(async (chapter) => {
        const pages = await getOfflineChapterPages(mangaKey, chapter.chapter_id);
        if (pages.length > 0) {
          chapterKeys.push(chapterDownloadKey(mangaKey, chapter.chapter_id));
        }
      }));
    }));
    setDownloadedChapterKeys((current) => new Set([...current, ...chapterKeys]));
  };

  const openDetails = async (item: MangaDiscoveryItem, preferOffline = false) => {
    const key = getOfflineMangaKey(item);
    const localRecord = await getOfflineMangaRecord(key);
    setSelectedItem(item);
    setReader(null);
    if (preferOffline && localRecord) {
      setOfflineRecord(localRecord);
      setDetailData(localRecord.detailData);
      setChapters(localRecord.chapters);
      setResolvedChapterSource(localRecord.chapterSource);
      setDetailError(null);
      setChaptersError(null);
      return;
    }
    setOfflineRecord(localRecord);
  };

  const handleRead = async (item: MangaDiscoveryItem) => {
    await openDetails(item, true);
  };

  const ensureOfflineMetadata = async (item: MangaDiscoveryItem) => {
    const key = getOfflineMangaKey(item);
    const existing = await getOfflineMangaRecord(key);
    if (existing) return existing;
    const details = await resolveDetailsForItem(item);
    const chapterData = await resolveChaptersForItem(item, details);
    const record: OfflineMangaRecord = {
      key,
      item,
      detailData: details,
      chapters: chapterData.chapters,
      chapterSource: chapterData.resolvedSource,
      downloadedAt: new Date().toISOString(),
    };
    await saveOfflineMangaRecord(record);
    return record;
  };

  const handleDownload = async (item: MangaDiscoveryItem) => {
    await openDetails(item, true);
  };

  const handleChapterDownload = async (chapter: MangaChapter) => {
    if (!selectedItem) return;
    const mangaKey = getOfflineMangaKey(selectedItem);
    updateChapterDownloadState(mangaKey, chapter.chapter_id, { status: "downloading", message: "Preparing chapter...", progress: 0 });
    try {
      const record = await ensureOfflineMetadata(selectedItem);
      if (!offlineRecord || offlineRecord.key !== record.key) {
        setOfflineRecord(record);
      }
      const pageUrls = await resolvePagesForChapter(chapter);
      const blobs: Blob[] = [];
      for (let pageIndex = 0; pageIndex < pageUrls.length; pageIndex += 1) {
        const response = await fetch(pageUrls[pageIndex]);
        if (!response.ok) throw new Error(`Page ${pageIndex + 1} failed with ${response.status}`);
        blobs.push(await response.blob());
        updateChapterDownloadState(mangaKey, chapter.chapter_id, {
          status: "downloading",
          message: `Downloading page ${pageIndex + 1}/${pageUrls.length}`,
          progress: ((pageIndex + 1) / Math.max(1, pageUrls.length)) * 100,
        });
      }
      await saveOfflineChapterPages(mangaKey, chapter.chapter_id, blobs);
      markChapterDownloaded(mangaKey, chapter.chapter_id);
      updateChapterDownloadState(mangaKey, chapter.chapter_id, { status: "done", message: "Saved offline.", progress: 100 });
    } catch (error) {
      updateChapterDownloadState(mangaKey, chapter.chapter_id, {
        status: "error",
        message: error instanceof Error ? error.message : "Chapter download failed.",
      });
    }
  };

  const loadHome = async () => {
    setHomeLoading(true);
    setHomeError(null);
    try {
      const [trendingResult, seasonalResult, comickResult, consumetResult] = await Promise.allSettled([
        fetchTrendingManga(1),
        fetchSeasonalManga(seasonYear, season),
        fetchComickFrontpage("trending", 1, 12, 7),
        fetchConsumetMangaDiscover("trending", 1),
      ]);

      const nextTrending = trendingResult.status === "fulfilled" ? trendingResult.value : [];
      const nextSeasonal = seasonalResult.status === "fulfilled" ? seasonalResult.value : [];
      const nextComickHot = comickResult.status === "fulfilled" ? comickResult.value : [];
      const nextConsumetHot = consumetResult.status === "fulfilled"
        ? consumetResult.value.map(mapConsumetMangaToDiscovery)
        : [];

      setTrending(nextTrending);
      setSeasonal(nextSeasonal);
      setComickHot(nextComickHot);
      setConsumetHot(nextConsumetHot);

      if (!nextTrending.length && !nextSeasonal.length && !nextComickHot.length && !nextConsumetHot.length) {
        const reasons = [trendingResult, seasonalResult, comickResult, consumetResult]
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => (result.reason instanceof Error ? result.reason.message : "Could not load manga discovery."));
        setHomeError(reasons[0] || "Could not load manga discovery.");
      }
    } finally {
      setHomeLoading(false);
    }
  };

  useEffect(() => { void loadHome(); }, []);

  useEffect(() => {
    void hydrateOfflineFlags(visibleLibraryItems);
  }, [visibleLibraryItems]);

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const [nativeResult, consumetResult] = await Promise.allSettled([
          searchManga(query),
          searchConsumetManga(query),
        ]);
        if (cancelled) return;
        const merged = dedupeMangaItems([
          ...(nativeResult.status === "fulfilled" ? nativeResult.value : []),
          ...(consumetResult.status === "fulfilled" ? consumetResult.value.map(mapConsumetMangaToDiscovery) : []),
        ]);
        setSearchResults(merged);
        if (!merged.length && nativeResult.status === "rejected" && consumetResult.status === "rejected") {
          throw nativeResult.reason instanceof Error ? nativeResult.reason : consumetResult.reason;
        }
      } catch (error) {
        if (!cancelled) {
          setSearchError(error instanceof Error ? error.message : "Search failed.");
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [query]);

  useEffect(() => {
    if (!selectedItem?.anilist_id && !selectedItem?.mangadex_id) {
      setDetailData(null);
      setChapters([]);
      setOfflineRecord(null);
      return;
    }
    const selectedKey = selectedItem ? getOfflineMangaKey(selectedItem) : "";
    if (offlineRecord && offlineRecord.key === selectedKey) {
      setDetailLoading(false);
      setDetailError(null);
      setDetailData(offlineRecord.detailData);
      setChapters(offlineRecord.chapters);
      setResolvedChapterSource(offlineRecord.chapterSource);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setDetailLoading(true);
      setDetailError(null);
      setReader(null);
      try {
        const details = await resolveDetailsForItem(selectedItem);
        if (!cancelled) setDetailData(details);
      } catch (error) {
        if (!cancelled) {
          setDetailError(error instanceof Error ? error.message : "Could not load manga details.");
          setDetailData(null);
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [offlineRecord, selectedItem]);

  useEffect(() => {
    setReader(null);
    setChapterGroup(0);
  }, [detailData?.mangadex?.mangadex_id, selectedItem?.title, chapterLanguage, chapterSource]);

  useEffect(() => {
    if (!selectedItem?.title) {
      setChapters([]);
      setResolvedChapterSource(null);
      setChaptersError(null);
      return;
    }
    const selectedKey = getOfflineMangaKey(selectedItem);
    if (offlineRecord && offlineRecord.key === selectedKey) {
      setChaptersLoading(false);
      setChaptersError(null);
      setChapters(offlineRecord.chapters);
      setResolvedChapterSource(offlineRecord.chapterSource);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setChaptersLoading(true);
      setChaptersError(null);
      try {
        const chapterData = await resolveChaptersForItem(selectedItem, detailData, chapterLanguage, chapterSource);
        if (cancelled) return;
        setResolvedChapterSource(chapterData.resolvedSource);
        setChapters(chapterData.chapters);
      } catch (error) {
        if (!cancelled) {
          setChaptersError(error instanceof Error ? error.message : "Could not load chapters.");
          setChapters([]);
        }
      } finally {
        if (!cancelled) setChaptersLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [chapterLanguage, chapterSource, detailData, offlineRecord, selectedItem]);

  useEffect(() => {
    if (!reader) {
      setReaderPages([]);
      setReaderError(null);
      return;
    }
    let cancelled = false;
    let objectUrls: string[] = [];
    const run = async () => {
      setReaderLoading(true);
      setReaderError(null);
      try {
        if (selectedItem) {
          const key = getOfflineMangaKey(selectedItem);
          const localPages = await getOfflineChapterPages(key, reader.chapter.chapter_id);
          if (localPages.length > 0) {
            objectUrls = localPages.map((blob) => URL.createObjectURL(blob));
            if (!cancelled) {
              setReaderPages(objectUrls);
              setReaderLoading(false);
            }
            return;
          }
        }
        const pages = await resolvePagesForChapter(reader.chapter);
        if (!cancelled) {
          setReaderPages(sortPageUrls(pages));
          if (!pages.length) {
            setReaderError("No reader pages were returned from MangaDex or ComicK for this chapter.");
          }
        }
      } catch (error) {
        if (!cancelled) {
          setReaderError(error instanceof Error ? error.message : "Could not load chapter pages from MangaDex or ComicK.");
          setReaderPages([]);
        }
      } finally {
        if (!cancelled) setReaderLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [reader, selectedItem]);

  useEffect(() => {
    if (!detailData?.anilist?.anilist_id) {
      setRecommendations([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setRecommendationsLoading(true);
      try {
        const anilistId = detailData.anilist?.anilist_id;
        if (!anilistId) {
          if (!cancelled) setRecommendations([]);
          return;
        }
        const items = await fetchMangaRecommendations(anilistId);
        if (!cancelled) setRecommendations(items);
      } catch {
        if (!cancelled) setRecommendations([]);
      } finally {
        if (!cancelled) setRecommendationsLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [detailData?.anilist?.anilist_id]);

  const visibleChapters = chapters.slice(chapterGroup * 100, chapterGroup * 100 + 100);
  const chapterGroups = Math.max(1, Math.ceil(chapters.length / 100));
  const activeChapter = reader?.chapter ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Manga</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>AniList discovery, Jikan metadata, plus switchable Consumet, MangaDex, and Comick readers</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}><IconSearch size={13} color="var(--text-muted)" /></div>
            <input className="input-base" style={{ paddingLeft: 32, width: 260, fontSize: 13 }} placeholder="Search manga..." value={searchText} onChange={(event) => setSearchText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setQuery(searchText.trim()); setSelectedItem(null); setReader(null); } }} />
          </div>
          <button className="btn btn-primary" onClick={() => { setQuery(searchText.trim()); setSelectedItem(null); setReader(null); }}>Search</button>
          {(query || selectedItem) && <button className="btn btn-ghost" onClick={() => { setSearchText(""); setQuery(""); setSelectedItem(null); setReader(null); }}><IconX size={13} /> Clear</button>}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {!selectedItem && !reader && !query && (
          homeLoading ? <LoadingGrid count={10} /> : homeError ? <ErrorState message={homeError} onRetry={() => void loadHome()} /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
              <HorizontalRail title="Trending Now" subtitle="Powered by AniList discovery" items={filteredTrending} onOpen={(item) => void openDetails(item)} onRead={(item) => void handleRead(item)} onDownload={(item) => void handleDownload(item)} />
              <HorizontalRail title={`${season.charAt(0)}${season.slice(1).toLowerCase()} Picks`} subtitle={`Seasonal manga for ${seasonYear}`} items={filteredSeasonal} onOpen={(item) => void openDetails(item)} onRead={(item) => void handleRead(item)} onDownload={(item) => void handleDownload(item)} />
              {filteredConsumetHot.length > 0 && <HorizontalRail title="Consumet MangaDex" subtitle="Primary manga reader matches from Consumet" items={filteredConsumetHot} onOpen={(item) => void openDetails(item)} onRead={(item) => void handleRead(item)} onDownload={(item) => void handleDownload(item)} />}
              {filteredComickHot.length > 0 && <HorizontalRail title="Comick Hot" subtitle="Backup reader picks for long series" items={filteredComickHot} onOpen={(item) => void openDetails(item)} onRead={(item) => void handleRead(item)} onDownload={(item) => void handleDownload(item)} />}
            </div>
          )
        )}
        {!selectedItem && !reader && !!query && (
          searchLoading ? <LoadingGrid count={12} /> : searchError ? <ErrorState message={searchError} onRetry={() => setQuery((value) => value)} /> : filteredSearchResults.length === 0 ? <EmptyState label="No results found." /> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 14 }}>
              {filteredSearchResults.map((item) => (
                <MangaCard
                  key={item.anilist_id ?? item.title}
                  item={item}
                  onOpen={() => void openDetails(item)}
                  onRead={() => void handleRead(item)}
                  onDownload={() => void handleDownload(item)}
                />
              ))}
            </div>
          )
        )}
        {selectedItem && !reader && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <button className="btn btn-ghost" onClick={() => setSelectedItem(null)}>Back to manga</button>
            </div>
            <button className="btn btn-primary" style={{ position: "fixed", right: 24, bottom: 24, zIndex: 25, boxShadow: "var(--shadow-lg)" }} onClick={() => setSelectedItem(null)}>
              Back
            </button>
            {detailLoading ? <LoadingGrid count={4} /> : detailError ? <ErrorState message={detailError} onRetry={() => setSelectedItem({ ...selectedItem })} /> : detailData ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
                <section className="card" style={{ padding: 18, display: "grid", gridTemplateColumns: "160px minmax(0, 1fr)", gap: 18 }}>
                  <img src={detailData.jikan?.cover_image || detailData.anilist?.cover_image || detailData.mangadex?.cover_image || detailData.comick?.cover_image || coverFallback(selectedItem.title)} alt={selectedItem.title} loading="eager" decoding="async" style={{ width: 160, height: 230, objectFit: "cover", borderRadius: 14, border: "1px solid var(--border)" }} onError={(event) => { (event.target as HTMLImageElement).src = coverFallback(selectedItem.title); }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2 }}>{selectedItem.title}</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                      {!!detailData.jikan?.score && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--bg-surface2)", padding: "5px 10px", borderRadius: 999, color: "#f6d061", fontSize: 12, fontWeight: 700 }}><IconStar size={11} color="#f6d061" /> MAL {detailData.jikan.score}</span>}
                      {!!detailData.anilist?.score && <span style={{ background: "var(--bg-surface2)", padding: "5px 10px", borderRadius: 999, fontSize: 12 }}>AniList {detailData.anilist.score}</span>}
                      <span style={{ background: "var(--bg-surface2)", padding: "5px 10px", borderRadius: 999, fontSize: 12 }}>{detailData.jikan?.status || detailData.anilist?.status || detailData.mangadex?.status || "Unknown"}</span>
                    </div>
                    <div style={{ marginTop: 14, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>{detailData.jikan?.synopsis || detailData.anilist?.description || detailData.mangadex?.description || "Metadata unavailable."}</div>
                  </div>
                </section>
                <section className="card" style={{ padding: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>Chapter List</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{resolvedChapterSource === "comick" ? "Comick backup reader" : chapterSource === "consumet" ? "Consumet MangaDex reader" : "MangaDex reader"}</div>
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <select className="input-base" style={{ width: 140, fontSize: 13 }} value={chapterLanguage} onChange={(event) => setChapterLanguage(event.target.value)}>
                        {LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                      <select className="input-base" style={{ width: 180, fontSize: 13 }} value={chapterSource} onChange={(event) => setChapterSource(event.target.value as ChapterSource)} title="Reader source">
                        <option value="auto">Auto</option>
                        <option value="consumet">Consumet Reader</option>
                        <option value="mangadex">MangaDex Reader</option>
                        <option value="comick">Comick Reader</option>
                      </select>
                    </div>
                  </div>
                  {chaptersLoading ? <LoadingGrid count={4} /> : chaptersError ? <ErrorState message={chaptersError} onRetry={() => setChapterSource((value) => value)} /> : chapters.length === 0 ? <EmptyState label="No chapters available from the current reader source." /> : (
                    <>
                      {chapterGroups > 1 && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                          {Array.from({ length: chapterGroups }, (_, index) => {
                            const start = chapters[index * 100]?.chapter_number ?? "?";
                            const end = chapters[Math.min(chapters.length - 1, index * 100 + 99)]?.chapter_number ?? "?";
                            return <button key={`${start}-${end}`} className={`quality-chip${chapterGroup === index ? " active" : ""}`} onClick={() => setChapterGroup(index)}>{start}-{end}</button>;
                          })}
                        </div>
                      )}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
{visibleChapters.map((chapter, index) => {
                          const mangaKey = getOfflineMangaKey(selectedItem);
                          const stateKey = chapterDownloadKey(mangaKey, chapter.chapter_id);
                          const downloadState = chapterDownloadStates[stateKey];
                          const isDownloaded = downloadedChapterKeys.has(stateKey);
                          return (
                            <div key={`${chapter.provider ?? "mangadex"}-${chapter.chapter_id}`} className="card" style={{ padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left", gap: 12, border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>Chapter {chapter.chapter_number}{chapter.title ? ` · ${chapter.title}` : ""}</div>
                                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{(chapter.source_name || chapter.provider || resolvedChapterSource || "mangadex").toUpperCase()} · {chapter.language.toUpperCase()}</div>
                                {downloadState?.message ? <div style={{ fontSize: 11, color: downloadState.status === "error" ? "var(--text-danger)" : "var(--text-muted)", marginTop: 6 }}>{downloadState.message}</div> : null}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                <button className="btn btn-primary" style={{ height: 34 }} onClick={() => setReader({ chapterIndex: chapterGroup * 100 + index, chapter })}>Read</button>
                                {isDownloaded && (
                                  <button
                                    className="btn btn-ghost"
                                    style={{ width: 42, minWidth: 42, padding: 0, justifyContent: "center", height: 34 }}
                                    onClick={() => void revealDownloadedChapter(chapter)}
                                    title="Reveal downloads folder"
                                  >
                                    <IconFolder size={14} />
                                  </button>
                                )}
                                <button className="btn btn-ghost" style={{ width: 42, minWidth: 42, padding: 0, justifyContent: "center", height: 34, fontSize: 10 }} onClick={() => void handleChapterDownload(chapter)} disabled={downloadState?.status === "downloading"} title={isDownloaded ? "Downloaded" : "Download chapter"}>
                                  {downloadState?.status === "downloading" ? `${Math.round(downloadState.progress || 0)}%` : isDownloaded ? "OK" : <IconDownload size={14} />}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </section>
                <section className="card" style={{ padding: 18 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>You Might Also Like</div>
                  {recommendationsLoading ? <LoadingGrid count={4} /> : filteredRecommendations.length === 0 ? <EmptyState label="No recommendations available right now." /> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 14 }}>{filteredRecommendations.slice(0, 6).map((item) => (
                    <MangaCard
                      key={item.anilist_id ?? item.title}
                      item={item}
                      onOpen={() => void openDetails(item)}
                      onRead={() => void handleRead(item)}
                      onDownload={() => void handleDownload(item)}
                    />
                  ))}</div>}
                </section>
              </div>
            ) : null}
          </>
        )}
        {selectedItem && reader && activeChapter && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <button className="btn btn-ghost" onClick={() => setReader(null)}>Back to details</button>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost" disabled={reader.chapterIndex <= 0} onClick={() => setReader({ chapterIndex: reader.chapterIndex - 1, chapter: chapters[reader.chapterIndex - 1] })}>Previous</button>
                <button className="btn btn-ghost" disabled={reader.chapterIndex >= chapters.length - 1} onClick={() => setReader({ chapterIndex: reader.chapterIndex + 1, chapter: chapters[reader.chapterIndex + 1] })}>Next</button>
              </div>
            </div>
            <button className="btn btn-primary" style={{ position: "fixed", right: 24, bottom: 24, zIndex: 25, boxShadow: "var(--shadow-lg)" }} onClick={() => setReader(null)}>
              Back
            </button>
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{selectedItem.title} · Chapter {activeChapter.chapter_number}</div>
              {activeChapter.title ? <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>{activeChapter.title}</div> : null}
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>Source: {(activeChapter.source_name || activeChapter.provider || resolvedChapterSource || "mangadex").toUpperCase()}</div>
            </div>
            {readerLoading ? <LoadingGrid count={6} /> : readerError ? <ErrorState message={readerError} onRetry={() => setReader({ ...reader })} /> : readerPages.length === 0 ? <EmptyState label="Chapter unavailable - try another chapter or switch reader source." /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
                {readerPages.map((pageUrl, index) => (
                  <MangaReaderImage
                    key={`${pageUrl}-${index}`}
                    src={pageUrl}
                    alt={`Page ${index + 1}`}
                    index={index}
                    total={readerPages.length}
                    onLoadNext={() => {
                      const next = readerPages[index + 1];
                      if (!next || next.startsWith("blob:")) return;
                      const preloader = new Image();
                      preloader.referrerPolicy = "no-referrer";
                      preloader.src = next;
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
