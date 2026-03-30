type CacheScope = "memory" | "session" | "local";

interface CacheRecord<T> {
  expiresAt: number;
  value: T;
}

const memoryCache = new Map<string, CacheRecord<unknown>>();
const pendingRequests = new Map<string, Promise<unknown>>();
const CACHE_PREFIX = "grabix:cache:";

function getStorage(scope: CacheScope): Storage | null {
  if (typeof window === "undefined") return null;
  if (scope === "session") return window.sessionStorage;
  if (scope === "local") return window.localStorage;
  return null;
}

function readStorageCache<T>(scope: CacheScope, key: string): T | null {
  const storage = getStorage(scope);
  if (!storage) return null;
  try {
    const raw = storage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const record = JSON.parse(raw) as CacheRecord<T>;
    if (!record?.expiresAt || Date.now() >= record.expiresAt) {
      storage.removeItem(`${CACHE_PREFIX}${key}`);
      return null;
    }
    return record.value ?? null;
  } catch {
    return null;
  }
}

function writeStorageCache<T>(scope: CacheScope, key: string, value: T, ttlMs: number) {
  const storage = getStorage(scope);
  if (!storage) return;
  try {
    storage.setItem(
      `${CACHE_PREFIX}${key}`,
      JSON.stringify({ expiresAt: Date.now() + ttlMs, value } satisfies CacheRecord<T>)
    );
  } catch {
    // Ignore storage write failures.
  }
}

export function getCachedValue<T>(key: string, scope: CacheScope = "memory"): T | null {
  if (scope === "memory") {
    const cached = memoryCache.get(key);
    if (!cached) return null;
    if (Date.now() >= cached.expiresAt) {
      memoryCache.delete(key);
      return null;
    }
    return cached.value as T;
  }
  return readStorageCache<T>(scope, key);
}

export function setCachedValue<T>(
  key: string,
  value: T,
  ttlMs: number,
  scope: CacheScope = "memory"
) {
  if (scope === "memory") {
    memoryCache.set(key, { expiresAt: Date.now() + ttlMs, value });
    return;
  }
  writeStorageCache(scope, key, value, ttlMs);
}

export async function getCachedJson<T>(options: {
  key: string;
  url: string;
  ttlMs: number;
  scope?: CacheScope;
  init?: RequestInit;
  mapError?: (response: Response) => Promise<string> | string;
}): Promise<T> {
  const scope = options.scope ?? "memory";
  const cached = getCachedValue<T>(options.key, scope);
  if (cached) return cached;

  const pending = pendingRequests.get(options.key);
  if (pending) return pending as Promise<T>;

  const request = fetch(options.url, options.init)
    .then(async (response) => {
      if (!response.ok) {
        const detail = options.mapError ? await options.mapError(response) : "";
        throw new Error(detail || `Request failed with ${response.status}`);
      }
      return (await response.json()) as T;
    })
    .then((value) => {
      setCachedValue(options.key, value, options.ttlMs, scope);
      return value;
    })
    .finally(() => {
      pendingRequests.delete(options.key);
    });

  pendingRequests.set(options.key, request as Promise<unknown>);
  return request;
}

export function clearCachedValue(key: string, scope: CacheScope = "memory") {
  if (scope === "memory") {
    memoryCache.delete(key);
    return;
  }
  const storage = getStorage(scope);
  storage?.removeItem(`${CACHE_PREFIX}${key}`);
}
