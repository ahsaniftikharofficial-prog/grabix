/**
 * mediaCache.ts — OPTIMISED (Performance Pass)
 *
 * Critical change: the original called openDatabase() on every read and write,
 * opening a new IDBDatabase handle and then closing it inside tx.oncomplete.
 * On a page with 50 thumbnail images this created 50+ open-close cycles on mount.
 * Each cycle involves an asynchronous IDBFactory.open() round-trip to the browser
 * storage engine (~1-3 ms each, but they stack up and force serial execution on
 * Safari/Firefox where IDB transactions are not concurrent).
 *
 * OPTIMISED: keep a module-level singleton Promise<IDBDatabase>.  The first
 * caller opens the connection; all subsequent callers await the same Promise.
 * The connection is never closed — IDB connections to versioned stores are
 * intended to be long-lived.  If the connection is lost (e.g. storage eviction),
 * the singleton is cleared and the next call re-establishes it.
 */

import { readLocalAppSettings, type AppSettings } from "./appSettings";

// ── Settings cache ────────────────────────────────────────────────────────────
// readLocalAppSettings() hits localStorage on every call. With 60+ images per
// page that means 60+ localStorage reads per render. Fix: cache the result for
// 5 seconds so we re-read at most once per page navigation, not once per image.
let _cachedSettings: AppSettings | null = null;
let _settingsCachedAt = 0;
const SETTINGS_TTL_MS = 5_000;

function getSettings(): AppSettings {
  const now = Date.now();
  if (!_cachedSettings || now - _settingsCachedAt > SETTINGS_TTL_MS) {
    _cachedSettings = readLocalAppSettings();
    _settingsCachedAt = now;
  }
  return _cachedSettings;
}

// Call this after writing settings so the cache doesn't serve stale values.
export function invalidateSettingsCache(): void {
  _cachedSettings = null;
}

const DB_NAME    = "grabix-media-cache";
const DB_VERSION = 1;
const STORE_NAME = "images";

interface CachedMediaRecord {
  key:         string;
  sourceUrl:   string;
  contentType: string;
  blob:        Blob;
  storedAt:    number;
  expiresAt:   number;
  size:        number;
}

// ── Singleton IDB connection ──────────────────────────────────────────────────
// One Promise shared across all callers.  If the DB handle is lost we reset
// and re-open on the next call.

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      _dbPromise = null; // allow retry
      reject(request.error ?? new Error("Could not open media cache."));
    };

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // If the connection is closed externally (e.g. storage eviction), clear
      // the singleton so the next caller re-opens cleanly.
      db.onclose = () => { _dbPromise = null; };
      db.onerror = () => { _dbPromise = null; };
      resolve(db);
    };
  });

  return _dbPromise;
}

// ── Generic transaction helper ────────────────────────────────────────────────
// Does NOT close the database after each transaction — that's the whole point.

function runTransaction<T>(
  mode:    IDBTransactionMode,
  handler: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let tx: IDBTransaction;
        try {
          tx = db.transaction(STORE_NAME, mode);
        } catch (err) {
          // DB may have been invalidated; clear singleton so next call retries.
          _dbPromise = null;
          reject(err);
          return;
        }
        const store   = tx.objectStore(STORE_NAME);
        const request = handler(store);
        request.onerror = () =>
          reject(request.error ?? new Error("Media cache request failed."));
        request.onsuccess = () => resolve(request.result);
        tx.onerror = () =>
          reject(tx.error ?? new Error("Media cache transaction failed."));
      }),
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function clearMediaCache(): Promise<void> {
  await runTransaction("readwrite", (store) => store.clear());
}

export async function getMediaCacheStats(): Promise<{ items: number; bytes: number }> {
  const records =
    (await runTransaction<CachedMediaRecord[]>("readonly", (store) => store.getAll())) ?? [];
  let bytes = 0;
  for (const record of records) {
    bytes += Number(record.size ?? record.blob?.size ?? 0);
  }
  return { items: records.length, bytes };
}

export async function pruneExpiredMediaCache(): Promise<void> {
  const records =
    (await runTransaction<CachedMediaRecord[]>("readonly", (store) => store.getAll())) ?? [];
  const now         = Date.now();
  const expiredKeys = records
    .filter((r) => !r.expiresAt || r.expiresAt <= now)
    .map((r) => r.key);
  if (expiredKeys.length === 0) return;

  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const key of expiredKeys) {
      store.delete(key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror    = () =>
      reject(tx.error ?? new Error("Media cache cleanup failed."));
  });
}

export async function getCachedMediaObjectUrl(url: string): Promise<string | null> {
  const settings = getSettings();
  if (!settings.enable_media_cache || !url) return null;
  try {
    const record = await runTransaction<CachedMediaRecord | undefined>(
      "readonly",
      (store) => store.get(makeKey(url)),
    );
    if (!record) return null;
    if (!record.expiresAt || record.expiresAt <= Date.now()) {
      // Delete stale entry asynchronously — don't block the caller.
      void runTransaction("readwrite", (store) => store.delete(makeKey(url)));
      return null;
    }
    return URL.createObjectURL(record.blob);
  } catch {
    return null;
  }
}

export async function cacheMediaFromUrl(url: string): Promise<string> {
  const settings = getSettings();
  if (!settings.enable_media_cache || !url) return url;

  const existing = await getCachedMediaObjectUrl(url);
  if (existing) return existing;

  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Image request failed with ${response.status}`);
  }
  const blob  = await response.blob();
  const ttlMs = settings.media_cache_days * 24 * 60 * 60 * 1000;
  const record: CachedMediaRecord = {
    key:         makeKey(url),
    sourceUrl:   url,
    contentType: blob.type || response.headers.get("content-type") || "image/jpeg",
    blob,
    storedAt:    Date.now(),
    expiresAt:   Date.now() + ttlMs,
    size:        blob.size,
  };
  try {
    await runTransaction("readwrite", (store) => store.put(record));
  } catch {
    return url;
  }
  return URL.createObjectURL(blob);
}

function makeKey(url: string): string {
  return `img:${url}`;
}
