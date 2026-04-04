import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconAudio,
  IconCheck,
  IconFilter,
  IconFolder,
  IconGrid,
  IconImage,
  IconList,
  IconPlay,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconVideo,
  IconX,
} from "../components/Icons";
import { PageEmptyState, PageErrorState } from "../components/PageStates";
import { BACKEND_API, backendFetch, backendJson } from "../lib/api";
import { deleteOfflineMangaRecord, listOfflineMangaRecords, type OfflineMangaRecord } from "../lib/mangaOffline";

const API = BACKEND_API;

interface LibItem {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  channel: string;
  type: "video" | "audio" | "thumbnail" | "subtitle" | "manga";
  file_path: string;
  file_size: number;
  file_size_label: string;
  duration: string;
  date: string;
  raw_date: string;
  tags: string;
  category: string;
  status: string;
  broken: boolean;
  local_available: boolean;
  source_type: "history" | "untracked" | "offline-manga";
  offline_key: string;
  chapter_count: number;
  storage_label: string;
  display_layout: "poster" | "landscape" | "square";
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  action: () => Promise<void>;
}

type ViewMode = "grid" | "list";
type CategoryId =
  | "all"
  | "movies"
  | "tv"
  | "anime"
  | "youtube"
  | "manga"
  | "books"
  | "comics"
  | "light-novels"
  | "audio"
  | "subtitles"
  | "other";

const CATEGORY_META: Array<{ id: CategoryId; label: string }> = [
  { id: "all", label: "All" },
  { id: "movies", label: "Movies" },
  { id: "tv", label: "TV Series" },
  { id: "anime", label: "Anime" },
  { id: "youtube", label: "YouTube" },
  { id: "manga", label: "Manga" },
  { id: "books", label: "Books" },
  { id: "comics", label: "Comics" },
  { id: "light-novels", label: "Light Novels" },
  { id: "audio", label: "Audio" },
  { id: "subtitles", label: "Subtitles" },
  { id: "other", label: "Other" },
];

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const hours = Math.floor(mins / 60);
  if (hours > 0) {
    return `${hours}:${String(mins % 60).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function toLibItem(row: Record<string, unknown>): LibItem {
  const type = (["video", "audio", "thumbnail", "subtitle", "manga"].includes(String(row.dl_type || ""))
    ? row.dl_type
    : "video") as LibItem["type"];
  const createdAt = String(row.created_at || "");
  return {
    id: String(row.id || ""),
    url: String(row.url || ""),
    title: String(row.title || "Unknown"),
    thumbnail: String(row.thumbnail || ""),
    channel: String(row.channel || ""),
    type,
    file_path: String(row.file_path || ""),
    file_size: Number(row.file_size || 0),
    file_size_label: String(row.file_size_label || ""),
    duration: formatDuration(Number(row.duration || 0)),
    date: createdAt ? new Date(createdAt).toLocaleDateString() : "",
    raw_date: createdAt,
    tags: String(row.tags || ""),
    category: String(row.category || ""),
    status: String(row.library_status || row.status || ""),
    broken: Boolean(row.broken),
    local_available: Boolean(row.local_available ?? true),
    source_type: (["history", "untracked", "offline-manga"].includes(String(row.source_type || ""))
      ? row.source_type
      : "history") as LibItem["source_type"],
    offline_key: String(row.offline_key || ""),
    chapter_count: Number(row.chapter_count || 0),
    storage_label: String(row.storage_label || ""),
    display_layout: (["poster", "landscape", "square"].includes(String(row.display_layout || ""))
      ? row.display_layout
      : (String(row.dl_type || "") === "audio" || String(row.dl_type || "") === "thumbnail" || String(row.dl_type || "") === "subtitle"
          ? "square"
          : (String(row.category || "").toLowerCase().includes("youtube") || String(row.category || "").toLowerCase().includes("tv")
              ? "landscape"
              : "poster"))) as LibItem["display_layout"],
  };
}

function toOfflineMangaLibItem(row: OfflineMangaRecord): LibItem {
  return {
    id: `offline-manga:${row.key}`,
    url: "",
    title: row.item.title,
    thumbnail: row.item.cover_image || "",
    channel: row.chapterSource ? `Offline • ${row.chapterSource}` : "Offline manga",
    type: "manga",
    file_path: "",
    file_size: 0,
    file_size_label: "",
    duration: "",
    date: row.downloadedAt ? new Date(row.downloadedAt).toLocaleDateString() : "",
    raw_date: row.downloadedAt || "",
    tags: "offline,manga",
    category: "manga",
    status: "offline",
    broken: false,
    local_available: true,
    source_type: "offline-manga",
    offline_key: row.key,
    chapter_count: Array.isArray(row.chapters) ? row.chapters.length : 0,
    storage_label: `${Array.isArray(row.chapters) ? row.chapters.length : 0} chapter(s) offline`,
    display_layout: "poster",
  };
}

function inferDisplayLayout(item: LibItem): LibItem["display_layout"] {
  if (item.display_layout) return item.display_layout;
  const inferredCategory = inferCategory(item);
  if (inferredCategory === "movies" || inferredCategory === "anime" || inferredCategory === "manga") return "poster";
  if (inferredCategory === "youtube" || inferredCategory === "tv") return "landscape";
  if (item.type === "audio" || item.type === "thumbnail" || item.type === "subtitle") return "square";
  return "landscape";
}

function inferCategory(item: LibItem): CategoryId {
  const explicit = item.category.trim().toLowerCase();
  if (explicit === "movies" || explicit === "movie") return "movies";
  if (explicit === "tv series" || explicit === "tv" || explicit === "series") return "tv";
  if (explicit === "anime") return "anime";
  if (explicit === "youtube") return "youtube";
  if (explicit === "manga") return "manga";
  if (explicit === "books" || explicit === "book") return "books";
  if (explicit === "comics" || explicit === "comic") return "comics";
  if (explicit === "light novels" || explicit === "light novel") return "light-novels";
  if (explicit === "audio") return "audio";
  if (explicit === "subtitles" || explicit === "subtitle") return "subtitles";

  const text = `${item.title} ${item.url} ${item.tags} ${item.channel}`.toLowerCase();
  if (item.type === "audio") return "audio";
  if (item.type === "subtitle") return "subtitles";
  if (text.includes("youtube.com") || text.includes("youtu.be")) return "youtube";
  if (text.includes("manga")) return "manga";
  if (text.includes("anime") || text.includes("hianime") || text.includes("aniwatch")) return "anime";
  if (text.includes("tv series") || text.includes("season ") || text.match(/\bs\d{1,2}e\d{1,2}\b/i)) return "tv";
  if (text.includes("book")) return "books";
  if (text.includes("comic")) return "comics";
  if (text.includes("light novel")) return "light-novels";
  return item.type === "video" ? "movies" : "other";
}

function categoryLabel(id: CategoryId): string {
  return CATEGORY_META.find((entry) => entry.id === id)?.label || "Other";
}

function categoryAccent(id: CategoryId): string {
  switch (id) {
    case "movies":
      return "var(--accent)";
    case "tv":
      return "#3fbf8f";
    case "anime":
      return "#ff8c42";
    case "youtube":
      return "#ff5d5d";
    case "manga":
      return "#8e9bff";
    case "books":
      return "#c58bff";
    case "comics":
      return "#ffb020";
    case "light-novels":
      return "#59c3c3";
    case "audio":
      return "var(--text-success)";
    case "subtitles":
      return "var(--text-secondary)";
    default:
      return "var(--text-muted)";
  }
}

function typeIcon(type: LibItem["type"]) {
  if (type === "audio") return <IconAudio size={14} color="currentColor" />;
  if (type === "thumbnail") return <IconImage size={14} color="currentColor" />;
  if (type === "manga") return <IconImage size={14} color="currentColor" />;
  return <IconVideo size={14} color="currentColor" />;
}

export default function LibraryPage() {
  const [items, setItems] = useState<LibItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [activeCategory, setActiveCategory] = useState<CategoryId>("all");
  const [hideMoviesInAll, setHideMoviesInAll] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState("");
  const [editItem, setEditItem] = useState<LibItem | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const load = useCallback(() => {
    setLoading(true);
    setPageError("");
    Promise.all([
      backendJson<Array<Record<string, unknown>>>(`${API}/library/index`),
      listOfflineMangaRecords().catch(() => []),
    ])
      .then(([rows, offlineManga]) => {
        const backendItems = (rows || []).map(toLibItem);
        const offlineItems = (offlineManga || []).map(toOfflineMangaLibItem);
        setItems([...offlineItems, ...backendItems]);
      })
      .catch(() => {
        setItems([]);
        setPageError("Library items could not be loaded right now.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const enhancedItems = useMemo(
    () => items.map((item) => ({ ...item, inferredCategory: inferCategory(item) })),
    [items]
  );

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return enhancedItems
      .filter((item) => !(activeCategory === "all" && hideMoviesInAll && item.inferredCategory === "movies"))
      .filter((item) => activeCategory === "all" || item.inferredCategory === activeCategory)
      .filter((item) => {
        if (!query) return true;
        return [
          item.title,
          item.channel,
          item.tags,
          item.category,
          item.url,
          categoryLabel(item.inferredCategory),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((left, right) => String(right.raw_date).localeCompare(String(left.raw_date)));
  }, [activeCategory, enhancedItems, hideMoviesInAll, search]);

  const groupedItems = useMemo(() => {
    const groups = new Map<CategoryId, Array<(typeof filteredItems)[number]>>();
    for (const entry of filteredItems) {
      const bucket = groups.get(entry.inferredCategory) || [];
      bucket.push(entry);
      groups.set(entry.inferredCategory, bucket);
    }
    return CATEGORY_META
      .filter((entry) => entry.id !== "all")
      .map((entry) => ({
        id: entry.id,
        label: entry.label,
        items: groups.get(entry.id) || [],
      }))
      .filter((entry) => entry.items.length > 0);
  }, [filteredItems]);

  const totalSize = enhancedItems.reduce((sum, item) => sum + item.file_size, 0);
  const brokenCount = enhancedItems.filter((item) => item.broken).length;
  const offlineMangaCount = enhancedItems.filter((item) => item.source_type === "offline-manga").length;
  const totalSizeLabel = totalSize > 1024 ** 3
    ? `${(totalSize / 1024 ** 3).toFixed(1)} GB`
    : totalSize > 1024 ** 2
      ? `${(totalSize / 1024 ** 2).toFixed(1)} MB`
      : `${Math.round(totalSize / 1024)} KB`;

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openFolder = async (item: LibItem) => {
    if (item.source_type === "offline-manga") {
      window.dispatchEvent(new CustomEvent("grabix:navigate", { detail: { page: "manga" } }));
      showToast("Opened Manga page. This title is available offline there.");
      return;
    }
    if (!item.file_path) {
      showToast("This item has no local file path to reveal.");
      return;
    }
    try {
      const response = await backendFetch(`${API}/open-download-folder?path=${encodeURIComponent(item.file_path)}`, { method: "POST" }, { sensitive: true });
      if (!response.ok) {
        throw new Error(`Reveal failed with ${response.status}`);
      }
    } catch {
      // Ignore browser-only failures.
    }
  };

  const playItem = async (item: LibItem) => {
    if (item.source_type === "offline-manga") {
      window.dispatchEvent(new CustomEvent("grabix:navigate", { detail: { page: "manga" } }));
      showToast("Opened Manga page for offline reading.");
      return;
    }
    if (!item.local_available || item.broken || !item.file_path) {
      showToast("This item is not available to open locally.");
      return;
    }
    try {
      const response = await backendFetch(`${API}/open-local-file?path=${encodeURIComponent(item.file_path)}`, { method: "POST" }, { sensitive: true });
      if (!response.ok) {
        throw new Error(`Open failed with ${response.status}`);
      }
    } catch {
      showToast("Could not open the local file.");
    }
  };

  const executeDeleteItem = async (item: LibItem) => {
    if (item.source_type === "offline-manga") {
      await deleteOfflineMangaRecord(item.offline_key);
    } else if (item.source_type === "untracked") {
      const response = await backendFetch(`${API}/library/file?path=${encodeURIComponent(item.file_path)}`, { method: "DELETE" }, { sensitive: true });
      if (!response.ok) throw new Error(`Delete failed with ${response.status}`);
    } else if (item.source_type === "history" && item.broken) {
      const response = await backendFetch(`${API}/library/stale/${encodeURIComponent(item.id)}`, { method: "DELETE" }, { sensitive: true });
      if (!response.ok) throw new Error(`Delete failed with ${response.status}`);
    } else {
      const response = await backendFetch(`${API}/history/${item.id}?delete_file=true`, { method: "DELETE" }, { sensitive: true });
      if (!response.ok) throw new Error(`Delete failed with ${response.status}`);
    }
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
    showToast("Removed from library.");
  };

  const deleteItem = async (item: LibItem) => {
    const confirmMessage = item.source_type === "offline-manga"
      ? "Delete this offline manga from the app?"
      : item.source_type === "history" && item.broken
        ? "Remove this missing item from the library?"
        : "Delete this file from disk and library?";
    setConfirmState({
      title: "Confirm Delete",
      message: confirmMessage,
      confirmLabel: "Delete",
      action: async () => {
        await executeDeleteItem(item);
      },
    });
  };

  const executeDeleteSelected = async () => {
    const selectedItems = items.filter((item) => selectedIds.has(item.id));
    await Promise.all(selectedItems.map(async (item) => {
      if (item.source_type === "offline-manga") {
        await deleteOfflineMangaRecord(item.offline_key);
        return;
      }
      if (item.source_type === "untracked") {
        const response = await backendFetch(`${API}/library/file?path=${encodeURIComponent(item.file_path)}`, { method: "DELETE" }, { sensitive: true });
        if (!response.ok) throw new Error(`Delete failed with ${response.status}`);
        return;
      }
      if (item.source_type === "history" && item.broken) {
        const response = await backendFetch(`${API}/library/stale/${encodeURIComponent(item.id)}`, { method: "DELETE" }, { sensitive: true });
        if (!response.ok) throw new Error(`Delete failed with ${response.status}`);
        return;
      }
      const response = await backendFetch(`${API}/history/${item.id}?delete_file=true`, { method: "DELETE" }, { sensitive: true });
      if (!response.ok) throw new Error(`Delete failed with ${response.status}`);
    }));
    setItems((current) => current.filter((item) => !selectedIds.has(item.id)));
    setSelectedIds(new Set());
    showToast("Selected items deleted.");
  };

  const deleteSelected = async () => {
    if (!selectedIds.size) return;
    setConfirmState({
      title: "Delete Selected Items",
      message: `Delete ${selectedIds.size} selected item(s) from your library?`,
      confirmLabel: `Delete ${selectedIds.size}`,
      action: async () => {
        await executeDeleteSelected();
      },
    });
  };

  const organizeLibrary = async () => {
    setOrganizing(true);
    try {
      const response = await backendFetch(`${API}/library/organize`, { method: "POST" }, { sensitive: true });
      if (!response.ok) {
        throw new Error(`Library organize failed with ${response.status}`);
      }
      const payload = (await response.json()) as { moved?: number };
      showToast(`Organized ${payload.moved || 0} file(s).`);
      load();
    } catch {
      showToast("Library organize failed.");
    } finally {
      setOrganizing(false);
    }
  };

  const reconcileLibrary = async () => {
    setReconciling(true);
    try {
      const response = await backendFetch(`${API}/library/reconcile`, { method: "POST" }, { sensitive: true });
      if (!response.ok) {
        throw new Error(`Library reconcile failed with ${response.status}`);
      }
      const payload = (await response.json()) as {
        marked_missing?: number;
        restored?: number;
        untracked?: number;
      };
      showToast(
        `Reconciled library • ${payload.marked_missing || 0} missing • ${payload.restored || 0} restored • ${payload.untracked || 0} untracked`
      );
      load();
    } catch {
      showToast("Library reconcile failed.");
    } finally {
      setReconciling(false);
    }
  };

  const saveMetadata = async (tags: string, category: string) => {
    if (!editItem || editItem.source_type !== "history") return;
    const response = await backendFetch(
      `${API}/history/${editItem.id}?tags=${encodeURIComponent(tags)}&category=${encodeURIComponent(category)}`,
      { method: "PATCH" },
      { sensitive: true }
    );
    if (!response.ok) {
      throw new Error(`Save failed with ${response.status}`);
    }
    setItems((current) =>
      current.map((item) => (item.id === editItem.id ? { ...item, tags, category } : item))
    );
    setEditItem(null);
    showToast("Library item updated.");
  };

  const renderItems = (entries: typeof filteredItems) => {
    if (viewMode === "list") {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {entries.map((item) => (
            <LibraryRow
              key={item.id}
              item={item}
              selected={selectedIds.has(item.id)}
              onSelect={() => toggleSelected(item.id)}
              onPlay={() => void playItem(item)}
              onOpen={() => void openFolder(item)}
              onDelete={() => void deleteItem(item)}
              onEdit={() => setEditItem(item)}
            />
          ))}
        </div>
      );
    }

    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(185px, 1fr))", gap: 14 }}>
        {entries.map((item) => (
          <LibraryCard
            key={item.id}
            item={item}
            selected={selectedIds.has(item.id)}
            onSelect={() => toggleSelected(item.id)}
            onPlay={() => void playItem(item)}
            onOpen={() => void openFolder(item)}
            onDelete={() => void deleteItem(item)}
            onEdit={() => setEditItem(item)}
          />
        ))}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      {toast ? (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            background: "var(--accent)",
            color: "var(--text-on-accent)",
            borderRadius: 999,
            padding: "9px 16px",
            fontSize: 12,
            fontWeight: 600,
            boxShadow: "var(--shadow-md)",
            zIndex: 999,
          }}
        >
          {toast}
        </div>
      ) : null}

      <div
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-surface)",
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Library</div>
          <div style={{ marginTop: 2, fontSize: 12, color: "var(--text-muted)" }}>
            {loading ? "Refreshing library..." : `${enhancedItems.length} items • ${totalSizeLabel}${brokenCount ? ` • ${brokenCount} broken` : ""}${offlineMangaCount ? ` • ${offlineMangaCount} offline manga` : ""}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {selectedIds.size > 0 ? (
            <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--text-danger)" }} onClick={() => void deleteSelected()}>
              <IconTrash size={13} /> Delete {selectedIds.size}
            </button>
          ) : null}
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => void organizeLibrary()} disabled={organizing}>
            <IconFolder size={13} /> {organizing ? "Organizing..." : "Organize"}
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => void reconcileLibrary()} disabled={reconciling}>
            <IconCheck size={13} /> {reconciling ? "Reconciling..." : "Reconcile"}
          </button>
          <button className="btn-icon" title="Refresh" onClick={load}>
            <IconRefresh size={15} />
          </button>
          <button className={`btn-icon${viewMode === "grid" ? " active" : ""}`} title="Grid view" onClick={() => setViewMode("grid")}>
            <IconGrid size={15} />
          </button>
          <button className={`btn-icon${viewMode === "list" ? " active" : ""}`} title="List view" onClick={() => setViewMode("list")}>
            <IconList size={15} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
            <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>
              <IconSearch size={14} color="var(--text-muted)" />
            </div>
            <input
              className="input-base"
              style={{ paddingLeft: 38 }}
              placeholder="Search titles, categories, tags, channels..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
            <IconFilter size={13} /> Organized by content type
          </div>
          {activeCategory === "all" ? (
            <button
              className={`quality-chip${hideMoviesInAll ? " active" : ""}`}
              onClick={() => setHideMoviesInAll((value) => !value)}
            >
              {hideMoviesInAll ? "Showing non-movies" : "Hide movies"}
            </button>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          {CATEGORY_META.map((entry) => (
            <button
              key={entry.id}
              className={`quality-chip${activeCategory === entry.id ? " active" : ""}`}
              onClick={() => setActiveCategory(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {!loading && pageError ? (
          <PageErrorState
            title="Library is unavailable right now"
            subtitle={pageError}
            onRetry={load}
          />
        ) : !loading && filteredItems.length === 0 ? (
          <PageEmptyState
            title={search ? "No library items matched that search" : "No library items found yet"}
            subtitle={search ? "Try another title, tag, or category." : "Downloads and offline content will appear here once they finish."}
            icon={<IconFolder size={40} />}
          />
        ) : null}

        {activeCategory === "all"
          ? groupedItems.map((group) => (
              <section key={group.id} style={{ marginBottom: 26 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        background: categoryAccent(group.id),
                        boxShadow: `0 0 0 4px color-mix(in srgb, ${categoryAccent(group.id)} 18%, transparent)`,
                      }}
                    />
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{group.label}</div>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{group.items.length} item(s)</div>
                </div>
                {renderItems(group.items)}
              </section>
            ))
          : filteredItems.length > 0
            ? renderItems(filteredItems)
            : null}
      </div>

      {editItem ? (
        <EditLibraryModal item={editItem} onClose={() => setEditItem(null)} onSave={saveMetadata} />
      ) : null}
      {confirmState ? (
        <ConfirmActionModal
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          onClose={() => setConfirmState(null)}
          onConfirm={async () => {
            try {
              await confirmState.action();
            } finally {
              setConfirmState(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function Thumbnail({ item }: { item: LibItem & { inferredCategory?: CategoryId } }) {
  const accent = categoryAccent(item.inferredCategory || inferCategory(item));
  if (item.thumbnail) {
    return (
      <img
        src={item.thumbnail}
        alt={item.title}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
        onError={(event) => {
          (event.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: accent }}>
      {typeIcon(item.type)}
    </div>
  );
}

function CategoryPill({ id }: { id: CategoryId }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "var(--bg-active)",
        color: categoryAccent(id),
        borderRadius: 999,
        padding: "3px 9px",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {categoryLabel(id)}
    </span>
  );
}

function LibraryCard({
  item,
  selected,
  onSelect,
  onPlay,
  onOpen,
  onDelete,
  onEdit,
}: {
  item: LibItem & { inferredCategory?: CategoryId };
  selected: boolean;
  onSelect: () => void;
  onPlay: () => void;
  onOpen: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const inferred = item.inferredCategory || inferCategory(item);
  const displayLayout = inferDisplayLayout(item);
  const mediaHeight = displayLayout === "poster" ? 250 : displayLayout === "landscape" ? 128 : 170;
  const canEdit = item.source_type === "history";
  const canPlay = item.source_type === "offline-manga" || (item.local_available && !item.broken && !!item.file_path);
  return (
    <div
      className="card"
      style={{
        overflow: "hidden",
        cursor: "pointer",
        outline: selected ? "2px solid var(--accent)" : "none",
        border: "1px solid var(--border)",
      }}
      onClick={onSelect}
    >
      <div style={{ position: "relative", height: mediaHeight, background: "var(--bg-surface2)" }}>
        <Thumbnail item={{ ...item, inferredCategory: inferred }} />
        <div style={{ position: "absolute", top: 10, left: 10 }}>
          <CategoryPill id={inferred} />
        </div>
        {item.broken ? (
          <div style={{ position: "absolute", left: 10, bottom: 10, borderRadius: 999, background: "rgba(160, 32, 32, 0.88)", color: "white", padding: "4px 9px", fontSize: 11, fontWeight: 700 }}>
            Broken
          </div>
        ) : item.source_type === "untracked" ? (
          <div style={{ position: "absolute", left: 10, bottom: 10, borderRadius: 999, background: "rgba(63, 99, 191, 0.88)", color: "white", padding: "4px 9px", fontSize: 11, fontWeight: 700 }}>
            Untracked
          </div>
        ) : item.source_type === "offline-manga" ? (
          <div style={{ position: "absolute", left: 10, bottom: 10, borderRadius: 999, background: "rgba(56, 122, 82, 0.9)", color: "white", padding: "4px 9px", fontSize: 11, fontWeight: 700 }}>
            Offline
          </div>
        ) : null}
        {selected ? (
          <div style={{ position: "absolute", right: 10, top: 10, width: 28, height: 28, borderRadius: 999, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IconCheck size={15} color="white" />
          </div>
        ) : null}
      </div>
      <div style={{ padding: "12px 12px 14px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.4, minHeight: displayLayout === "poster" ? 36 : 18 }}>{item.title}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
          {item.file_size_label ? <span>{item.file_size_label}</span> : null}
          {item.storage_label ? <span>{item.storage_label}</span> : null}
          {item.duration ? <span>{item.duration}</span> : null}
          {item.date ? <span>{item.date}</span> : null}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <button className="btn-icon" disabled={!canPlay} onClick={(event) => { event.stopPropagation(); if (canPlay) onPlay(); }} title={item.source_type === "offline-manga" ? "Open for offline reading" : "Open local file"} style={{ opacity: canPlay ? 1 : 0.4 }}>
            <IconPlay size={14} />
          </button>
          <button className="btn-icon" onClick={(event) => { event.stopPropagation(); onOpen(); }} title={item.source_type === "offline-manga" ? "Open Manga page" : "Open folder"}>
            <IconFolder size={14} />
          </button>
          <button className="btn-icon" disabled={!canEdit} onClick={(event) => { event.stopPropagation(); if (canEdit) onEdit(); }} title={canEdit ? "Edit library info" : "Only tracked downloads can be edited"} style={{ opacity: canEdit ? 1 : 0.4 }}>
            <IconFilter size={14} />
          </button>
          <button className="btn-icon" onClick={(event) => { event.stopPropagation(); onDelete(); }} title="Delete" style={{ color: "var(--text-danger)" }}>
            <IconTrash size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function LibraryRow({
  item,
  selected,
  onSelect,
  onPlay,
  onOpen,
  onDelete,
  onEdit,
}: {
  item: LibItem & { inferredCategory?: CategoryId };
  selected: boolean;
  onSelect: () => void;
  onPlay: () => void;
  onOpen: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const inferred = item.inferredCategory || inferCategory(item);
  const displayLayout = inferDisplayLayout(item);
  const thumbSize = displayLayout === "poster"
    ? { width: 58, height: 82 }
    : displayLayout === "landscape"
      ? { width: 96, height: 54 }
      : { width: 64, height: 64 };
  const canEdit = item.source_type === "history";
  const canPlay = item.source_type === "offline-manga" || (item.local_available && !item.broken && !!item.file_path);
  const tags = item.tags
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 3);

  return (
    <div className="card" style={{ display: "flex", gap: 14, padding: 12, alignItems: "center", outline: selected ? "2px solid var(--accent)" : "none" }} onClick={onSelect}>
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: 4,
          border: `2px solid ${selected ? "var(--accent)" : "var(--border)"}`,
          background: selected ? "var(--accent)" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {selected ? <IconCheck size={10} color="white" /> : null}
      </div>
      <div style={{ ...thumbSize, borderRadius: 10, overflow: "hidden", background: "var(--bg-surface2)", flexShrink: 0 }}>
        <Thumbnail item={{ ...item, inferredCategory: inferred }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
          <CategoryPill id={inferred} />
          {item.broken ? <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-danger)" }}>Broken</span> : null}
          {item.source_type === "untracked" ? <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-accent)" }}>Untracked</span> : null}
          {item.source_type === "offline-manga" ? <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-success)" }}>Offline</span> : null}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>{typeIcon(item.type)} {item.type}</span>
          {item.file_size_label ? <span>{item.file_size_label}</span> : null}
          {item.storage_label ? <span>{item.storage_label}</span> : null}
          {item.duration ? <span>{item.duration}</span> : null}
          {item.channel ? <span>{item.channel}</span> : null}
          {item.date ? <span>{item.date}</span> : null}
          {tags.map((tag) => (
            <span key={tag} style={{ background: "var(--bg-overlay)", borderRadius: 999, padding: "2px 7px" }}>
              #{tag}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }} onClick={(event) => event.stopPropagation()}>
        <button className="btn-icon" disabled={!canPlay} onClick={canPlay ? onPlay : undefined} title={item.source_type === "offline-manga" ? "Open for offline reading" : "Open local file"} style={{ opacity: canPlay ? 1 : 0.4 }}>
          <IconPlay size={14} />
        </button>
        <button className="btn-icon" onClick={onOpen} title={item.source_type === "offline-manga" ? "Open Manga page" : "Open folder"}>
          <IconFolder size={14} />
        </button>
        <button className="btn-icon" disabled={!canEdit} onClick={canEdit ? onEdit : undefined} title={canEdit ? "Edit" : "Only tracked downloads can be edited"} style={{ opacity: canEdit ? 1 : 0.4 }}>
          <IconFilter size={14} />
        </button>
        <button className="btn-icon" onClick={onDelete} title="Delete" style={{ color: "var(--text-danger)" }}>
          <IconTrash size={14} />
        </button>
      </div>
    </div>
  );
}

function EditLibraryModal({
  item,
  onClose,
  onSave,
}: {
  item: LibItem;
  onClose: () => void;
  onSave: (tags: string, category: string) => Promise<void>;
}) {
  const [tags, setTags] = useState(item.tags);
  const [category, setCategory] = useState(item.category || categoryLabel(inferCategory(item)));
  const [saving, setSaving] = useState(false);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.74)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 300 }} onClick={onClose}>
      <div className="card" style={{ width: "100%", maxWidth: 520, padding: 20, border: "1px solid var(--border)" }} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Edit Library Item</div>
          <button className="btn-icon" onClick={onClose}>
            <IconX size={15} />
          </button>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>{item.title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Category</div>
            <input className="input-base" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Movies, Anime, Books..." />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Tags</div>
            <input className="input-base" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Hindi, S01E01, Favorites..." />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(tags, category);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmActionModal({
  title,
  message,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.74)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 320 }}
      onClick={onClose}
    >
      <div className="card" style={{ width: "100%", maxWidth: 460, padding: 20, border: "1px solid var(--border)" }} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{title}</div>
          <button className="btn-icon" onClick={onClose}>
            <IconX size={15} />
          </button>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>{message}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="btn btn-primary"
            style={{ background: "var(--text-danger)", borderColor: "var(--text-danger)" }}
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              try {
                await onConfirm();
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "Deleting..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
