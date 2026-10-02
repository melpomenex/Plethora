/**
 * Audio Edition Position Tracking and Multi-Part Playback Resume
 *
 * Persists and restores exact location (partIndex, timeInPart, globalTimeSec)
 * for AI-generated and imported Audio Editions. Uses dual-layer storage
 * (IndexedDB + localStorage synchronous write on unload) to guarantee
 * position survival across background pauses, app restarts, and tab closure.
 */

export interface AudioEditionPosition {
  editionId: string;
  documentId: string;
  partIndex: number;
  timeInPart: number;
  globalTimeSec: number;
  totalDurationSec: number;
  updatedAt: number;
}

const STORE_NAME = "plethora-audio-edition-positions";
const DB_NAME = "plethora-audio-edition-positions-db";
const DB_VERSION = 1;
const LOCAL_STORAGE_PREFIX = "plethora:ae-pos:";
const THROTTLE_MS = 2000;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function keyFor(editionId: string): string {
  return `edition:${editionId}`;
}

function docKeyFor(documentId: string): string {
  return `doc:${documentId}`;
}

let pendingSave: AudioEditionPosition | null = null;
let lastSaveAt = 0;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;

export function resetAudioEditionPositionState(): void {
  pendingSave = null;
  lastSaveAt = Date.now();
  if (throttleTimer) {
    clearTimeout(throttleTimer);
    throttleTimer = null;
  }
}

/**
 * Synchronous write to localStorage for beforeunload or urgent component unmounts.
 */
export function writeAudioEditionPositionSync(pos: AudioEditionPosition): void {
  try {
    const raw = JSON.stringify(pos);
    localStorage.setItem(LOCAL_STORAGE_PREFIX + keyFor(pos.editionId), raw);
    if (pos.documentId) {
      localStorage.setItem(LOCAL_STORAGE_PREFIX + docKeyFor(pos.documentId), raw);
    }
  } catch (err) {
    console.warn("[audioEditionPosition] localStorage write failed:", err);
  }
}

/**
 * Read the latest position synchronously from localStorage.
 */
export function getAudioEditionPositionSync(
  editionId?: string,
  documentId?: string
): AudioEditionPosition | null {
  try {
    let raw: string | null = null;
    if (editionId) {
      raw = localStorage.getItem(LOCAL_STORAGE_PREFIX + keyFor(editionId));
    }
    if (!raw && documentId) {
      raw = localStorage.getItem(LOCAL_STORAGE_PREFIX + docKeyFor(documentId));
    }
    if (!raw) return null;
    return JSON.parse(raw) as AudioEditionPosition;
  } catch {
    return null;
  }
}

/**
 * Read the freshest position for an edition and/or document from IndexedDB or localStorage.
 */
export async function getAudioEditionPosition(
  editionId?: string,
  documentId?: string
): Promise<AudioEditionPosition | null> {
  const syncRecord = getAudioEditionPositionSync(editionId, documentId);

  let idbRecord: AudioEditionPosition | null = null;
  try {
    const db = await openDB();
    const id = editionId ? keyFor(editionId) : documentId ? docKeyFor(documentId) : null;
    if (id) {
      idbRecord = await new Promise<AudioEditionPosition | null>((resolve) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => {
          const val = req.result?.value as AudioEditionPosition | undefined;
          resolve(val ?? null);
        };
        req.onerror = () => resolve(null);
      });
    }
  } catch {
    // IndexedDB unavailable or failed; fallback to localStorage
  }

  if (idbRecord && syncRecord) {
    return idbRecord.updatedAt >= syncRecord.updatedAt ? idbRecord : syncRecord;
  }
  return idbRecord ?? syncRecord ?? null;
}

async function commitToIndexedDB(pos: AudioEditionPosition): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put({ id: keyFor(pos.editionId), value: pos });
      if (pos.documentId) {
        store.put({ id: docKeyFor(pos.documentId), value: pos });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("[audioEditionPosition] IndexedDB write failed:", err);
  }
}

/**
 * Save an Audio Edition playback position with throttling.
 */
export async function saveAudioEditionPosition(
  pos: AudioEditionPosition,
  flushNow = false
): Promise<void> {
  writeAudioEditionPositionSync(pos);
  pendingSave = pos;

  if (flushNow) {
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    lastSaveAt = Date.now();
    await commitToIndexedDB(pos);
    return;
  }

  const elapsed = Date.now() - lastSaveAt;
  if (elapsed >= THROTTLE_MS) {
    lastSaveAt = Date.now();
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    await commitToIndexedDB(pos);
    return;
  }

  if (!throttleTimer) {
    const waitMs = Math.max(50, THROTTLE_MS - elapsed);
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      if (pendingSave) {
        const toSave = pendingSave;
        lastSaveAt = Date.now();
        void commitToIndexedDB(toSave);
      }
    }, waitMs);
  }
}

/**
 * Clear saved Audio Edition position.
 */
export async function clearAudioEditionPosition(
  editionId?: string,
  documentId?: string
): Promise<void> {
  if (editionId) {
    localStorage.removeItem(LOCAL_STORAGE_PREFIX + keyFor(editionId));
  }
  if (documentId) {
    localStorage.removeItem(LOCAL_STORAGE_PREFIX + docKeyFor(documentId));
  }

  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      if (editionId) store.delete(keyFor(editionId));
      if (documentId) store.delete(docKeyFor(documentId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore error on deletion fallback
  }
}

/**
 * Calculate listening progress percentage (0 - 100).
 */
export function getAudioEditionProgress(
  pos?: Pick<AudioEditionPosition, "globalTimeSec" | "totalDurationSec"> | null
): number {
  if (!pos || !Number.isFinite(pos.globalTimeSec) || !Number.isFinite(pos.totalDurationSec)) {
    return 0;
  }
  if (pos.totalDurationSec <= 0) return 0;
  const pct = (pos.globalTimeSec / pos.totalDurationSec) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
