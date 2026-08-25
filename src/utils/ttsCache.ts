import type { WordTiming } from "./wordTimings";
import { foldForMatch } from "./readerSpeechIndex";

const DB_NAME = "plethora-tts-cache";
const DB_VERSION = 3;
const STORE_NAME = "audio-cache";
const META_STORE = "cache-meta";
/** v3 (eliminate-long-running-memory-growth): metadata-only eviction index. */
const ENTRY_META_STORE = "entry-meta";
const DEFAULT_MAX_SIZE_BYTES = 500 * 1024 * 1024;

export interface TTSCacheEntry {
  key: string;
  audioData: ArrayBuffer;
  durationSec: number;
  size: number;
  lastAccessed: number;
  wordTimings?: WordTiming[];
  source?: string;
}

/**
 * Per-entry eviction metadata (design D8). Kept in its own small store so
 * computing eviction order and deleting victims NEVER materializes an
 * `audioData` payload. `sized: false` marks a pre-v3 entry whose size is not
 * yet known (backfilled without reading its payload; sized on first access;
 * evicted last).
 */
interface EntryMeta {
  key: string;
  size: number;
  lastAccessed: number;
  sized: boolean;
}

interface CacheMeta {
  id: "metadata";
  totalSize: number;
  maxSize: number;
}

// ---------------------------------------------------------------------------
// One managed shared connection (task 5.3)
// ---------------------------------------------------------------------------

/**
 * Connection accounting exported for the diagnostics snapshot (task 3.5):
 * `opened` counts successful indexedDB.open calls for this module, `closed`
 * the explicit close()s, `live` the current difference. The fix for the
 * per-operation openDB() leak: everything below goes through ONE
 * promise-cached connection.
 */
const connectionStats = { opened: 0, closed: 0 };

export function getTtsCacheConnectionCount(): { opened: number; closed: number; live: number } {
  return { ...connectionStats, live: connectionStats.opened - connectionStats.closed };
}

let dbPromise: Promise<IDBDatabase> | null = null;
let backfillPromise: Promise<void> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    let created: Promise<IDBDatabase>;
    created = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
          store.createIndex("lastAccessed", "lastAccessed", { unique: false });
        } else if (event.oldVersion < 2) {
          const tx = request.transaction;
          const store = tx?.objectStore(STORE_NAME);
          if (store && !store.indexNames.contains("lastAccessed")) {
            store.createIndex("lastAccessed", "lastAccessed", { unique: false });
          }
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(ENTRY_META_STORE)) {
          db.createObjectStore(ENTRY_META_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        connectionStats.opened += 1;
        const db = request.result;
        // An unexpected close (version change elsewhere) resets the shared
        // connection so the next operation reopens exactly one replacement —
        // but only if this connection still owns the slot.
        db.onclose = () => {
          connectionStats.closed += 1;
          if (dbPromise === created) dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        if (dbPromise === created) dbPromise = null;
        reject(request.error);
      };
    });
    dbPromise = created;
  }
  return dbPromise;
}

async function closeSharedConnection(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  dbPromise = null;
  try {
    db.close();
    connectionStats.closed += 1;
  } catch {
    /* already closed */
  }
}

// Page teardown: close where observable. Registered once per module load and
// never removed — the module lives as long as the page.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("pagehide", () => {
    void closeSharedConnection();
  });
}

/**
 * One-time additive backfill (task 5.4): every payload entry with no
 * entry-meta row gets `{ key, size: 0, lastAccessed: 0, sized: false }` —
 * key-only cursor, payloads never read. Idempotent.
 */
function backfillEntryMeta(db: IDBDatabase): Promise<void> {
  if (backfillPromise) return backfillPromise;
  backfillPromise = (async () => {
    const known = await new Promise<Set<string>>((resolve, reject) => {
      const tx = db.transaction(ENTRY_META_STORE, "readonly");
      const req = tx.objectStore(ENTRY_META_STORE).getAllKeys();
      req.onsuccess = () => resolve(new Set(req.result as string[]));
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, ENTRY_META_STORE], "readwrite");
      const metaStore = tx.objectStore(ENTRY_META_STORE);
      const cursorReq = tx.objectStore(STORE_NAME).openKeyCursor();
      let added = 0;
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        const key = String(cursor.key);
        if (!known.has(key)) {
          metaStore.put({ key, size: 0, lastAccessed: 0, sized: false });
          added += 1;
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      void added;
    });
  })().catch(() => {
    // Backfill is best-effort; unsized entries remain readable and get their
    // metadata written on first access.
  });
  return backfillPromise;
}

const FNV128_OFFSET = 0x6c62272e07bb014262b821756295c58dn;
const FNV128_PRIME = 0x1000000000000000000013bn;
const FNV128_MASK = (1n << 128n) - 1n;

export function digestText128(text: string): string {
  let hash = FNV128_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV128_PRIME) & FNV128_MASK;
  }
  return hash.toString(16).padStart(32, "0");
}

export function digestJson128(value: unknown): string {
  return digestText128(JSON.stringify(value ?? ""));
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

function normalizeSpeed(speed: number): string {
  const n = Number(speed);
  if (!Number.isFinite(n)) return "1";
  return n.toFixed(3).replace(/\.?0+$/, "");
}

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  try {
    const u = new URL(trimmed);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

export interface TTSCacheKeyV2Params {
  provider: string;
  model: string;
  voice: string;
  speed: number;
  format: string;
  text: string;
  language?: string;
  instructions?: string;
  presetDigest?: string;
  pronunciationDigest?: string;
  clonedVoiceDigest?: string;
  baseUrl?: string;
  supportsInstructions?: boolean;
  supportsLanguage?: boolean;
}

export function makeTTSCacheKeyV2(params: TTSCacheKeyV2Params): string {
  const speedNorm = normalizeSpeed(params.speed);
  const textDigest = digestText128(params.text);
  const langRaw = params.language?.trim() ?? "";
  const langNorm = langRaw.toLowerCase();
  const langDigest = params.supportsLanguage !== false && langNorm && langNorm !== "auto" ? digestText128(foldForMatch(langNorm)) : "";
  const instrRaw = params.instructions?.trim() ?? "";
  const instrDigest = params.supportsInstructions && instrRaw ? digestText128(foldForMatch(instrRaw)) : "";
  const presetDigest = params.presetDigest ?? "";
  const pronDigest = params.pronunciationDigest ?? "";
  const clonedDigest = params.clonedVoiceDigest ?? "";
  const baseUrlNorm = params.baseUrl ? normalizeBaseUrl(params.baseUrl) : "";
  const baseUrlSegment = params.provider === "openai-compatible" && baseUrlNorm ? baseUrlNorm : "";
  return [
    params.provider,
    params.model,
    params.voice,
    speedNorm,
    params.format,
    langDigest,
    instrDigest,
    presetDigest,
    pronDigest,
    clonedDigest,
    baseUrlSegment,
    textDigest,
  ]
    .map((part) => encodeURIComponent(String(part)))
    .join(":");
}

export function legacyMakeCacheKey(provider: string, model: string, voice: string, speed: number, format: string, text: string): string {
  return makeCacheKey(provider, model, voice, speed, format, text);
}

let cachedTotalSize: number | null = null;
let cacheMutex: Promise<void> = Promise.resolve();

/**
 * Serialize cache mutations (task 5.3 preserves the mutex semantics and
 * extends it over the full read-modify-write of `cache-meta`): without the
 * lock, two concurrent puts could both read `totalSize`, both add their own
 * delta, and one increment would be lost.
 */
async function withCacheLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = cacheMutex;
  let release: () => void = () => {};
  cacheMutex = new Promise<void>((res) => { release = res; });
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
  }
}

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

/** Read the eviction index in full — metadata records only, never payloads. */
function readAllEntryMeta(db: IDBDatabase): Promise<EntryMeta[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_META_STORE, "readonly");
    const req = tx.objectStore(ENTRY_META_STORE).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as EntryMeta[]);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Evict down to the configured bound using ONLY the metadata index (D8):
 * victims are chosen by (sized-ness, lastAccessed) and deleted BY KEY from
 * the payload store — the payload store is never read here. Unsized
 * (pre-v3) entries are evicted last; their unknown sizes free 0 accounted
 * bytes, so the loop also stops rather than spinning on them.
 *
 * NOT locked: callers hold the cache lock or go through ensureCacheSize.
 */
async function evictIfOverBudget(db: IDBDatabase): Promise<void> {
  const meta = await getMeta(db);
  if (meta.totalSize <= meta.maxSize) return;
  const entries = await readAllEntryMeta(db);
  const sized = entries.filter((e) => e.sized).sort((a, b) => a.lastAccessed - b.lastAccessed);
  let freed = 0;
  const toDelete: string[] = [];
  for (const entry of sized) {
    if (meta.totalSize - freed <= meta.maxSize) break;
    freed += entry.size;
    toDelete.push(entry.key);
  }
  if (toDelete.length === 0) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, ENTRY_META_STORE], "readwrite");
    const payload = tx.objectStore(STORE_NAME);
    const metaStore = tx.objectStore(ENTRY_META_STORE);
    let pending = toDelete.length;
    let failed: unknown = null;
    for (const key of toDelete) {
      const del = payload.delete(key);
      del.onsuccess = () => { pending--; if (pending === 0) failed ? reject(failed) : resolve(); };
      del.onerror = () => { failed = del.error; pending--; if (pending === 0) reject(failed); };
      metaStore.delete(key);
    }
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  meta.totalSize = Math.max(0, meta.totalSize - freed);
  await saveMeta(db, meta);
}

/** Locked eviction entry point (triggered after every over-size put). */
async function ensureCacheSize(db: IDBDatabase): Promise<void> {
  await withCacheLock(() => evictIfOverBudget(db));
}

export async function getCachedAudio(key: string): Promise<{ audioData: ArrayBuffer; durationSec: number; wordTimings?: WordTiming[] } | null> {
  try {
    const db = await getDB();
    await backfillEntryMeta(db);
    return await withCacheLock(async () => {
      const entry = await new Promise<TTSCacheEntry | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result as TTSCacheEntry | undefined);
        req.onerror = () => reject(req.error);
      });
      if (!entry) return null;
      if (!(entry.audioData instanceof ArrayBuffer)) {
        await new Promise<void>((resolve) => {
          const tx = db.transaction([STORE_NAME, ENTRY_META_STORE], "readwrite");
          tx.objectStore(STORE_NAME).delete(key);
          tx.objectStore(ENTRY_META_STORE).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
        return null;
      }
      // Touch metadata only — no payload write-back per hit (the old code
      // rewrote the whole ArrayBuffer on every cache hit).
      await new Promise<void>((resolve) => {
        const tx = db.transaction(ENTRY_META_STORE, "readwrite");
        tx.objectStore(ENTRY_META_STORE).put({
          key,
          size: entry.size ?? entry.audioData.byteLength,
          lastAccessed: Date.now(),
          sized: true,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      return { audioData: entry.audioData, durationSec: entry.durationSec, wordTimings: entry.wordTimings };
    });
  } catch {
    return null;
  }
}

export async function setCachedAudio(key: string, audioData: ArrayBuffer, durationSec: number, wordTimings?: WordTiming[]): Promise<void> {
  try {
    const db = await getDB();
    await backfillEntryMeta(db);
    await withCacheLock(async () => {
      const size = audioData.byteLength;
      // Size delta comes from the metadata index, not a payload read.
      const existingMeta = await new Promise<EntryMeta | undefined>((resolve) => {
        const tx = db.transaction(ENTRY_META_STORE, "readonly");
        const req = tx.objectStore(ENTRY_META_STORE).get(key);
        req.onsuccess = () => resolve(req.result as EntryMeta | undefined);
        req.onerror = () => resolve(undefined);
      });
      const delta = existingMeta?.sized ? size - existingMeta.size : size;
      const entry: TTSCacheEntry = {
        key,
        audioData,
        durationSec,
        size,
        lastAccessed: Date.now(),
        wordTimings: wordTimings?.filter((w) => w.source === "measured") ?? undefined,
      };
      const meta = await getMeta(db);
      meta.totalSize += delta;
      await saveMeta(db, meta);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_NAME, ENTRY_META_STORE], "readwrite");
        tx.objectStore(STORE_NAME).put(entry);
        tx.objectStore(ENTRY_META_STORE).put({ key, size, lastAccessed: entry.lastAccessed, sized: true });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
    // Evict outside the lock after every put (fires only when over budget).
    await ensureCacheSize(db);
  } catch {
  }
}

export async function setCachedAudioDurable(key: string, audioData: ArrayBuffer, durationSec: number, wordTimings?: WordTiming[]): Promise<void> {
  try {
    await setCachedAudio(key, audioData, durationSec, wordTimings);
  } catch (err) {
    const msg = String((err as Error)?.name ?? err);
    if (msg.includes("QuotaExceeded")) {
      try {
        const db = await getDB();
        await ensureCacheSize(db);
        await setCachedAudio(key, audioData, durationSec, wordTimings);
      } catch {
        throw err;
      }
    } else throw err;
  }
}

export async function clearAudioCache(): Promise<void> {
  try {
    const db = await getDB();
    await withCacheLock(async () => {
      const tx = db.transaction([STORE_NAME, META_STORE, ENTRY_META_STORE], "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.objectStore(ENTRY_META_STORE).clear();
      const meta: CacheMeta = { id: "metadata", totalSize: 0, maxSize: DEFAULT_MAX_SIZE_BYTES };
      tx.objectStore(META_STORE).put(meta);
      cachedTotalSize = 0;
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
    // Spec: the shared connection is closed on clearAudioCache.
    await closeSharedConnection();
  } catch {
  }
}

export async function getCacheSize(): Promise<{ totalSize: number; maxSize: number; entryCount: number }> {
  try {
    const db = await getDB();
    const meta = await getMeta(db);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const countReq = store.count();
      countReq.onsuccess = () => resolve({ totalSize: meta.totalSize, maxSize: meta.maxSize, entryCount: countReq.result });
      countReq.onerror = () => reject(countReq.error);
    });
  } catch {
    return { totalSize: 0, maxSize: DEFAULT_MAX_SIZE_BYTES, entryCount: 0 };
  }
}

export async function updateMaxCacheSize(maxSizeMB: number): Promise<void> {
  const maxSize = maxSizeMB * 1024 * 1024;
  try {
    const db = await getDB();
    await withCacheLock(async () => {
      const meta = await getMeta(db);
      meta.maxSize = maxSize;
      await saveMeta(db, meta);
    });
    await ensureCacheSize(db);
  } catch {
  }
}

export function bytesToMiB(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/** Test-only: reset module-level connection state between test databases. */
export function __resetTtsCacheForTests(): void {
  dbPromise = null;
  backfillPromise = null;
  connectionStats.opened = 0;
  connectionStats.closed = 0;
  cacheMutex = Promise.resolve();
  cachedTotalSize = null;
}
