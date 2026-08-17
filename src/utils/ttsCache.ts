const DB_NAME = "plethora-tts-cache"; // legacy `plethora-tts-cache` DB is left as inert garbage
const DB_VERSION = 1;
const STORE_NAME = "audio-cache";
const META_STORE = "cache-meta";
const DEFAULT_MAX_SIZE_BYTES = 500 * 1024 * 1024;

export interface TTSCacheEntry {
  key: string;
  audioData: ArrayBuffer;
  durationSec: number;
  size: number;
  lastAccessed: number;
}

interface CacheMeta {
  id: "metadata";
  totalSize: number;
  maxSize: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("lastAccessed", "lastAccessed", { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const FNV128_OFFSET = 0x6c62272e07bb014262b821756295c58dn;
const FNV128_PRIME = 0x1000000000000000000013bn;
const FNV128_MASK = (1n << 128n) - 1n;

/**
 * FNV-1a widened to 128 bits. This remains synchronous for cache lookups,
 * while providing a collision space appropriate for the 500 MB audio store.
 */
export function digestText128(text: string): string {
  let hash = FNV128_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV128_PRIME) & FNV128_MASK;
  }
  return hash.toString(16).padStart(32, "0");
}

export function makeCacheKey(
  provider: string,
  model: string,
  voice: string,
  speed: number,
  format: string,
  text: string,
): string {
  return [provider, model, voice, speed, format, digestText128(text)]
    .map((part) => encodeURIComponent(String(part)))
    .join(":");
}

let cachedTotalSize: number | null = null;

async function getMeta(db: IDBDatabase): Promise<CacheMeta> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readonly");
    const store = tx.objectStore(META_STORE);
    const req = store.get("metadata");
    req.onsuccess = () => {
      const meta = req.result as CacheMeta | undefined;
      resolve(meta || { id: "metadata", totalSize: 0, maxSize: DEFAULT_MAX_SIZE_BYTES });
    };
    req.onerror = () => reject(req.error);
  });
}

async function saveMeta(db: IDBDatabase, meta: CacheMeta): Promise<void> {
  cachedTotalSize = meta.totalSize;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readwrite");
    const store = tx.objectStore(META_STORE);
    store.put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function ensureCacheSize(db: IDBDatabase): Promise<void> {
  const meta = await getMeta(db);
  if (meta.totalSize <= meta.maxSize) return;

  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const index = store.index("lastAccessed");

  const entries: TTSCacheEntry[] = [];
  return new Promise((resolve, reject) => {
    const cursorReq = index.openCursor(null, "next");
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        entries.push(cursor.value);
        cursor.continue();
      } else {
        entries.sort((a, b) => a.lastAccessed - b.lastAccessed);
        let freed = 0;
        let deleteOp = Promise.resolve();
        for (const entry of entries) {
          if (meta.totalSize - freed <= meta.maxSize) break;
          freed += entry.size;
          deleteOp = deleteOp.then(() =>
            new Promise<void>((res, rej) => {
              const del = store.delete(entry.key);
              del.onsuccess = () => res();
              del.onerror = () => rej(del.error);
            })
          );
        }
        deleteOp.then(async () => {
          meta.totalSize = Math.max(0, meta.totalSize - freed);
          await saveMeta(db, meta);
          resolve();
        }).catch(reject);
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

export async function getCachedAudio(key: string): Promise<{ audioData: ArrayBuffer; durationSec: number } | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const entry = req.result as TTSCacheEntry | undefined;
        if (!entry) {
          resolve(null);
          return;
        }
        entry.lastAccessed = Date.now();
        store.put(entry);
        resolve({ audioData: entry.audioData, durationSec: entry.durationSec });
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function setCachedAudio(key: string, audioData: ArrayBuffer, durationSec: number): Promise<void> {
  try {
    const db = await openDB();
    const size = audioData.byteLength;
    const entry: TTSCacheEntry = {
      key,
      audioData,
      durationSec,
      size,
      lastAccessed: Date.now(),
    };

    const meta = await getMeta(db);
    meta.totalSize += size;
    await saveMeta(db, meta);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(entry);
      tx.oncomplete = () => {
        ensureCacheSize(db).catch(() => {});
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Cache unavailable, silently skip
  }
}

export async function clearAudioCache(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_NAME, META_STORE], "readwrite");
    tx.objectStore(STORE_NAME).clear();
    const meta: CacheMeta = { id: "metadata", totalSize: 0, maxSize: DEFAULT_MAX_SIZE_BYTES };
    tx.objectStore(META_STORE).put(meta);
    cachedTotalSize = 0;
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function getCacheSize(): Promise<{ totalSize: number; maxSize: number; entryCount: number }> {
  try {
    const db = await openDB();
    const meta = await getMeta(db);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const countReq = store.count();
      countReq.onsuccess = () => {
        resolve({ totalSize: meta.totalSize, maxSize: meta.maxSize, entryCount: countReq.result });
      };
      countReq.onerror = () => reject(countReq.error);
    });
  } catch {
    return { totalSize: 0, maxSize: DEFAULT_MAX_SIZE_BYTES, entryCount: 0 };
  }
}

export async function updateMaxCacheSize(maxSizeMB: number): Promise<void> {
  const maxSize = maxSizeMB * 1024 * 1024;
  try {
    const db = await openDB();
    const meta = await getMeta(db);
    meta.maxSize = maxSize;
    await saveMeta(db, meta);
    await ensureCacheSize(db);
  } catch {
    // ignore
  }
}
