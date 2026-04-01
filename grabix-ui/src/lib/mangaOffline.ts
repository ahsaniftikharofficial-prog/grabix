import type { MangaChapter, MangaDetailsResponse, MangaDiscoveryItem } from "./mangaProviders";

const DB_NAME = "grabix-manga-offline";
const DB_VERSION = 1;
const MANGA_STORE = "mangas";
const PAGE_STORE = "chapter_pages";

export interface OfflineMangaRecord {
  key: string;
  item: MangaDiscoveryItem;
  detailData: MangaDetailsResponse | null;
  chapters: MangaChapter[];
  chapterSource: "mangadex" | "comick" | null;
  downloadedAt: string;
}

interface OfflineChapterPagesRecord {
  id: string;
  mangaKey: string;
  chapterId: string;
  pages: Blob[];
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error("Could not open offline manga storage."));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MANGA_STORE)) {
        db.createObjectStore(MANGA_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(PAGE_STORE)) {
        db.createObjectStore(PAGE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function runTransaction<T>(storeName: string, mode: IDBTransactionMode, handler: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = handler(store);
    request.onerror = () => reject(request.error || new Error("Offline manga storage request failed."));
    request.onsuccess = () => resolve(request.result);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error || new Error("Offline manga storage transaction failed."));
  }));
}

export function getOfflineMangaKey(item: Pick<MangaDiscoveryItem, "mangadex_id" | "anilist_id" | "mal_id" | "title">): string {
  if (item.mangadex_id) return `mdx:${item.mangadex_id}`;
  if (item.anilist_id) return `anilist:${item.anilist_id}`;
  if (item.mal_id) return `mal:${item.mal_id}`;
  return `title:${item.title.trim().toLowerCase()}`;
}

export async function getOfflineMangaRecord(key: string): Promise<OfflineMangaRecord | null> {
  return (await runTransaction(MANGA_STORE, "readonly", (store) => store.get(key))) || null;
}

export async function saveOfflineMangaRecord(record: OfflineMangaRecord): Promise<void> {
  await runTransaction(MANGA_STORE, "readwrite", (store) => store.put(record));
}

export async function saveOfflineChapterPages(mangaKey: string, chapterId: string, pages: Blob[]): Promise<void> {
  const record: OfflineChapterPagesRecord = {
    id: `${mangaKey}:${chapterId}`,
    mangaKey,
    chapterId,
    pages,
  };
  await runTransaction(PAGE_STORE, "readwrite", (store) => store.put(record));
}

export async function getOfflineChapterPages(mangaKey: string, chapterId: string): Promise<Blob[]> {
  const record = await runTransaction<OfflineChapterPagesRecord | undefined>(PAGE_STORE, "readonly", (store) => store.get(`${mangaKey}:${chapterId}`));
  return record?.pages || [];
}

export async function listOfflineChapterPageKeys(): Promise<string[]> {
  const records = (await runTransaction<OfflineChapterPagesRecord[]>(PAGE_STORE, "readonly", (store) => store.getAll())) || [];
  return records
    .filter((record) => Array.isArray(record.pages) && record.pages.length > 0)
    .map((record) => record.id);
}

export async function listOfflineMangaRecords(): Promise<OfflineMangaRecord[]> {
  return (await runTransaction(MANGA_STORE, "readonly", (store) => store.getAll())) || [];
}

export async function deleteOfflineMangaRecord(mangaKey: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([MANGA_STORE, PAGE_STORE], "readwrite");
    const mangaStore = tx.objectStore(MANGA_STORE);
    const pageStore = tx.objectStore(PAGE_STORE);
    const getAllRequest = pageStore.getAll();

    getAllRequest.onerror = () => reject(getAllRequest.error || new Error("Could not read offline manga pages."));
    getAllRequest.onsuccess = () => {
      const pageRecords = (getAllRequest.result || []) as OfflineChapterPagesRecord[];
      mangaStore.delete(mangaKey);
      for (const record of pageRecords) {
        if (record.mangaKey === mangaKey) {
          pageStore.delete(record.id);
        }
      }
    };

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("Could not delete offline manga record."));
    };
  });
}
