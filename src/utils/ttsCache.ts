import type { WordTiming } from "./wordTimings";
import { foldForMatch } from "./readerSpeechIndex";

const DB_NAME = "plethora-tts-cache";
const DB_VERSION = 2;
const STORE_NAME = "audio-cache";
const META_STORE = "cache-meta";
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
      } else if (request.oldVersion < 2) {
        const tx = request.transaction;
        const store = tx?.objectStore(STORE_NAME);
        if (store && !store.indexNames.contains("lastAccessed")) {
          store.createIndex("lastAccessed", "lastAccessed", { unique: false });
        }
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
  const run = async () => {
    const meta = await getMeta(db);
    if (meta.totalSize <= meta.maxSize) return;
    const entries: TTSCacheEntry[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const idx = store.index("lastAccessed");
      const out: TTSCacheEntry[] = [];
      const cursorReq = idx.openCursor(null, "next");
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          out.push(cursor.value);
          cursor.continue();
        } else resolve(out);
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
    entries.sort((a, b) => a.lastAccessed - b.lastAccessed);
    let freed = 0;
    const toDelete: string[] = [];
    for (const entry of entries) {
      if (meta.totalSize - freed <= meta.maxSize) break;
      freed += entry.size;
      toDelete.push(entry.key);
    }
    if (toDelete.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      let pending = toDelete.length;
      let failed: unknown = null;
      for (const key of toDelete) {
        const del = store.delete(key);
        del.onsuccess = () => { pending--; if (pending === 0) failed ? reject(failed) : resolve(); };
        del.onerror = () => { failed = del.error; pending--; if (pending === 0) reject(failed); };
      }
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    meta.totalSize = Math.max(0, meta.totalSize - freed);
    await saveMeta(db, meta);
  };
  const prev = cacheMutex;
  let release: () => void = () => {};
  cacheMutex = new Promise<void>((res) => { release = res; });
  await prev.catch(() => {});
  try {
    await run();
  } finally {
    release();
  }
}

export async function getCachedAudio(key: string): Promise<{ audioData: ArrayBuffer; durationSec: number; wordTimings?: WordTiming[] } | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const entry = req.result as TTSCacheEntry | undefined;
        if (!entry) { resolve(null); return; }
        if (!(entry.audioData instanceof ArrayBuffer)) {
          store.delete(key);
          resolve(null);
          return;
        }
        entry.lastAccessed = Date.now();
        store.put(entry);
        resolve({ audioData: entry.audioData, durationSec: entry.durationSec, wordTimings: entry.wordTimings });
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function setCachedAudio(key: string, audioData: ArrayBuffer, durationSec: number, wordTimings?: WordTiming[]): Promise<void> {
  try {
    const db = await openDB();
    const size = audioData.byteLength;
    const existing = await new Promise<TTSCacheEntry | undefined>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result as TTSCacheEntry | undefined);
      req.onerror = () => resolve(undefined);
    });
    const delta = existing ? size - existing.size : size;
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
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(entry);
      tx.oncomplete = () => { ensureCacheSize(db).catch(() => {}); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
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
        const db = await openDB();
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
    const db = await openDB();
    const meta = await getMeta(db);
    meta.maxSize = maxSize;
    await saveMeta(db, meta);
    await ensureCacheSize(db);
  } catch {
  }
}

export function bytesToMiB(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}
