import { readLocalAppSettings } from "./appSettings";

const DB_NAME = "grabix-media-cache";
const DB_VERSION = 1;
const STORE_NAME = "images";

interface CachedMediaRecord {
  key: string;
  sourceUrl: string;
  contentType: string;
  blob: Blob;
  storedAt: number;
  expiresAt: number;
  size: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error("Could not open media cache."));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function makeKey(url: string): string {
  return `img:${url}`;
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDatabase();
  return await new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = handler(store);
    request.onerror = () => reject(request.error || new Error("Media cache request failed."));
    request.onsuccess = () => resolve(request.result);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error || new Error("Media cache transaction failed."));
  });
}

export async function clearMediaCache(): Promise<void> {
  await runTransaction("readwrite", (store) => store.clear());
}

export async function getMediaCacheStats(): Promise<{ items: number; bytes: number }> {
  const records = (await runTransaction<CachedMediaRecord[]>("readonly", (store) => store.getAll())) || [];
  let bytes = 0;
  for (const record of records) {
    bytes += Number(record.size || record.blob?.size || 0);
  }
  return { items: records.length, bytes };
}

export async function pruneExpiredMediaCache(): Promise<void> {
  const records = (await runTransaction<CachedMediaRecord[]>("readonly", (store) => store.getAll())) || [];
  const now = Date.now();
  const expiredKeys = records.filter((record) => !record.expiresAt || record.expiresAt <= now).map((record) => record.key);
  if (expiredKeys.length === 0) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const key of expiredKeys) {
      store.delete(key);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("Media cache cleanup failed."));
    };
  });
}

export async function getCachedMediaObjectUrl(url: string): Promise<string | null> {
  const settings = readLocalAppSettings();
  if (!settings.enable_media_cache || !url) return null;
  try {
    const record = await runTransaction<CachedMediaRecord | undefined>("readonly", (store) => store.get(makeKey(url)));
    if (!record) return null;
    if (!record.expiresAt || record.expiresAt <= Date.now()) {
      await runTransaction("readwrite", (store) => store.delete(makeKey(url)));
      return null;
    }
    return URL.createObjectURL(record.blob);
  } catch {
    return null;
  }
}

export async function cacheMediaFromUrl(url: string): Promise<string> {
  const settings = readLocalAppSettings();
  if (!settings.enable_media_cache || !url) return url;

  const existing = await getCachedMediaObjectUrl(url);
  if (existing) return existing;

  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Image request failed with ${response.status}`);
  }
  const blob = await response.blob();
  const ttlMs = settings.media_cache_days * 24 * 60 * 60 * 1000;
  const record: CachedMediaRecord = {
    key: makeKey(url),
    sourceUrl: url,
    contentType: blob.type || response.headers.get("content-type") || "image/jpeg",
    blob,
    storedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
    size: blob.size,
  };
  try {
    await runTransaction("readwrite", (store) => store.put(record));
  } catch {
    return url;
  }
  return URL.createObjectURL(blob);
}

