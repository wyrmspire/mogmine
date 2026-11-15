// Tiny IndexedDB key-value store for completed candle sets (docs/08 §2: cache on the device).
// Every call resolves; a blocked or missing IndexedDB only means "not cached".
const DB_NAME = "mogmine";
const STORE = "candles";

let opening: Promise<IDBDatabase | null> | null = null;

function open() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return opening;
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

export async function idbSet(key: string, value: unknown): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch { resolve(false); }
  });
}

export async function idbDelete(key: string): Promise<void> {
  const db = await open();
  if (!db) return;
  try { db.transaction(STORE, "readwrite").objectStore(STORE).delete(key); } catch { /* not cached */ }
}
