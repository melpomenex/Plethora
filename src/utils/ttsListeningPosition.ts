import { foldForMatch } from "./readerSpeechIndex";
import { digestText128 } from "./ttsCache";
import type { ReaderSpeechIndex, SourceAnchor, SpeechPosition } from "./readerSpeechIndex";

export interface TTSListeningPosition {
  documentId: string;
  profileId: string;
  updatedAt: number;
  textFingerprint: string;
  speechFingerprint: string;
  provider: string;
  model: string;
  voiceId: string;
  stableAnchor: SourceAnchor;
  chunkIndex: number;
  chunkTextHash: string;
  wordIndex: number;
  normalizedCharOffset: number;
  intraChunkMs: number | null;
  surroundingText: string;
  scrollPercentHint: number | null;
  cfi: string | null;
  pageNumber: number | null;
}

const STORE_NAME = "plethora-tts-positions";
const DB_NAME = "plethora-tts-positions-db";
const DB_VERSION = 1;

export function getProfileId(): string {
  try {
    const raw = localStorage.getItem("plethora_user");
    if (raw) { const parsed = JSON.parse(raw); if (parsed?.id) return `u:${parsed.id}`; }
  } catch {}
  return "anon";
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function keyFor(documentId: string, profileId: string): string {
  return `${profileId}::${documentId}`;
}

export function fingerprintDocument(text: string): string {
  const normalized = foldForMatch(text.slice(0, 2000) + text.slice(-2000) + String(text.length));
  return digestText128(normalized);
}

export function fingerprintSpeechIndex(index: ReaderSpeechIndex): string {
  return digestText128(index.chunks.map((c)=>c.sectionKey+":"+c.text.length).join("|"));
}

let pendingSave: TTSListeningPosition | null = null;
let lastSaveAt = 0;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;

export async function getTTSListeningPosition(documentId: string, profileId?: string): Promise<TTSListeningPosition | null> {
  const pid = profileId ?? getProfileId();
  const id = keyFor(documentId, pid);
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => {
        const val = req.result?.value as TTSListeningPosition | undefined;
        if (!val) resolve(null);
        else resolve(val);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    try {
      const raw = localStorage.getItem(`tts-pos:${id}`);
      if (!raw) return null;
      return JSON.parse(raw) as TTSListeningPosition;
    } catch { return null; }
  }
}

export async function saveTTSListeningPosition(pos: TTSListeningPosition, opts: { flush?: boolean } = {}): Promise<void> {
  const now = Date.now();
  if (!opts.flush && now - lastSaveAt < 4000) {
    pendingSave = pos;
    if (throttleTimer) return;
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      if (pendingSave) { const p = pendingSave; pendingSave = null; lastSaveAt = Date.now(); void persist(p); }
    }, 4000);
    return;
  }
  lastSaveAt = now;
  await persist(pos);
}

async function persist(pos: TTSListeningPosition): Promise<void> {
  const id = keyFor(pos.documentId, pos.profileId);
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ id, value: pos });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try { localStorage.setItem(`tts-pos:${id}`, JSON.stringify(pos)); } catch {}
  }
}

export async function flushPendingListeningPosition(): Promise<void> {
  if (pendingSave) { const p = pendingSave; pendingSave = null; if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = null; } await persist(p); lastSaveAt = Date.now(); }
}

/**
 * Synchronous localStorage write used at unload (beforeunload/pagehide): an
 * IndexedDB transaction is not guaranteed to complete before the process
 * exits, so a best-effort sync write ensures the record survives a restart.
 * Idempotent with the async path — both write the same `tts-pos:<id>` key.
 */
export function writeListeningPositionSync(pos: TTSListeningPosition): void {
  const id = keyFor(pos.documentId, pos.profileId);
  try { localStorage.setItem(`tts-pos:${id}`, JSON.stringify(pos)); } catch {}
}

export async function clearTTSListeningPosition(documentId: string, profileId?: string): Promise<void> {
  const pid = profileId ?? getProfileId();
  const id = keyFor(documentId, pid);
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
  try { localStorage.removeItem(`tts-pos:${id}`); } catch {}
}

export function resolveListeningPosition(index: ReaderSpeechIndex, pos: TTSListeningPosition): SpeechPosition | null {
  const viaAnchor = index.locate(pos.stableAnchor);
  if (viaAnchor) {
    const chunk = index.chunks[viaAnchor.chunkIndex];
    if (chunk && digestText128(chunk.text) === pos.chunkTextHash) return viaAnchor;
    if (chunk) return viaAnchor;
  }
  const folded = foldForMatch(pos.surroundingText);
  if (folded) {
    for (let i = 0; i < index.chunks.length; i++) {
      if (foldForMatch(index.chunks[i].text).includes(folded.slice(0, 40))) return { chunkIndex: i, wordIndex: 0 };
    }
  }
  if (pos.cfi) return { chunkIndex: pos.chunkIndex, wordIndex: pos.wordIndex };
  if (pos.pageNumber !== null) {
    const forPage = index.chunksForPage(pos.pageNumber);
    if (forPage.length) return { chunkIndex: forPage[0], wordIndex: 0 };
  }
  if (pos.scrollPercentHint !== null) return { chunkIndex: index.chunkIndexForScrollPercent(pos.scrollPercentHint), wordIndex: 0 };
  return null;
}

export function formatListeningTime(pos: TTSListeningPosition, totalDurationSec?: number): string {
  if (pos.intraChunkMs !== null && totalDurationSec) {
    const sec = Math.floor((pos.chunkIndex / Math.max(1, pos.chunkIndex+1)) * totalDurationSec + pos.intraChunkMs/1000);
    const m = Math.floor(sec/60); const s = sec%60;
    return `${m}:${String(s).padStart(2,"0")}`;
  }
  return `Section ${pos.chunkIndex+1} · word ${pos.wordIndex+1}`;
}
