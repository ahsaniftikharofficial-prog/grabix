type StorageScope = "local" | "session";

function getStorage(scope: StorageScope): Storage | null {
  if (typeof window === "undefined") return null;
  return scope === "session" ? window.sessionStorage : window.localStorage;
}

export function versionedStorageKey(baseKey: string, version: string): string {
  return `${baseKey}:${version}`;
}

export function readJsonStorage<T>(scope: StorageScope, key: string, fallback: T): T {
  const storage = getStorage(scope);
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Ignore storage cleanup failures.
    }
    return fallback;
  }
}

export function writeJsonStorage(scope: StorageScope, key: string, value: unknown): void {
  const storage = getStorage(scope);
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage write failures.
  }
}

export function readStringStorage(scope: StorageScope, key: string): string {
  const storage = getStorage(scope);
  if (!storage) return "";
  try {
    return storage.getItem(key) || "";
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Ignore storage cleanup failures.
    }
    return "";
  }
}

export function writeStringStorage(scope: StorageScope, key: string, value: string): void {
  const storage = getStorage(scope);
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage write failures.
  }
}
