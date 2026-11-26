import JSZip from "jszip";
import { normalizeForLookup } from "../languageProcessing/unicode";
import {
  LANGUAGE_PACK_CATALOG,
  filterCatalogPacks,
  findCatalogPack,
  getStarterPackBytes,
  type CatalogFilter,
} from "./catalog";
import {
  detectLanguagePackFormat,
  parseLanguagePackPayload,
  parseStarDictFiles,
} from "./parsers";
import {
  LanguagePackError,
  type DictionaryLookupQuery,
  type InstalledLanguagePack,
  type LanguagePackFormat,
  type LanguagePackKind,
  type LanguagePackManifest,
  type LanguagePackStorageAdapter,
  type PackAttributionItem,
  type PackInstallOptions,
  type PackInstallProgress,
  type PackStorageSummary,
  type PackVerificationResult,
  type ParsedDictionaryEntry,
  type StarDictInputFiles,
  type StoredDictionaryEntry,
} from "./types";

// ---------------------------------------------------------------------------
// SHA-256 (WebCrypto primary + pure-TS FIPS 180-4 fallback)
// ---------------------------------------------------------------------------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_INIT = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256HexSync(bytes: Uint8Array): string {
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  const highBits = Math.floor(bitLen / 0x100000000);
  const lowBits = bitLen >>> 0;
  view.setUint32(paddedLen - 8, highBits, false);
  view.setUint32(paddedLen - 4, lowBits, false);

  const hash = new Uint32Array(SHA256_INIT);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];

    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  let hex = "";
  for (let i = 0; i < hash.length; i += 1) {
    hex += hash[i].toString(16).padStart(8, "0");
  }
  return hex;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof subtle.digest === "function") {
    try {
      const cleanBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(cleanBuffer).set(bytes);
      const digest = await subtle.digest("SHA-256", cleanBuffer);
      const arr = new Uint8Array(digest);
      let hex = "";
      for (let i = 0; i < arr.length; i += 1) {
        hex += arr[i].toString(16).padStart(2, "0");
      }
      return hex;
    } catch {
      // Fall back to pure-TS implementation if WebCrypto fails in restricted env.
    }
  }
  return sha256HexSync(bytes);
}

// ---------------------------------------------------------------------------
// Storage Adapters (Memory & IndexedDB)
// ---------------------------------------------------------------------------

function cloneValue<T>(value: T): T {
  if (value instanceof Uint8Array) return new Uint8Array(value) as T;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function baseSubtag(tag?: string): string {
  return tag?.trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

function languageMatches(packLang: string, queryLang?: string): boolean {
  if (!queryLang) return true;
  const normalizedPack = packLang.trim().toLowerCase();
  const normalizedQuery = queryLang.trim().toLowerCase();
  if (normalizedPack === normalizedQuery) return true;
  return baseSubtag(normalizedPack) === baseSubtag(normalizedQuery);
}

function summarizePacks(packs: readonly InstalledLanguagePack[]): PackStorageSummary {
  const active = packs.filter((pack) => pack.status !== "removed");
  const byLanguage: PackStorageSummary["byLanguage"] = {};
  let installedPacks = 0;
  let corruptPacks = 0;
  let totalStorageBytes = 0;
  let totalEntries = 0;

  for (const pack of active) {
    if (pack.status === "installed") installedPacks += 1;
    if (pack.status === "corrupt") corruptPacks += 1;
    totalStorageBytes += pack.storageBytes;
    totalEntries += pack.entryCount;

    const langKey = pack.languageTag;
    const bucket = byLanguage[langKey] ?? { packCount: 0, storageBytes: 0, entryCount: 0 };
    bucket.packCount += 1;
    bucket.storageBytes += pack.storageBytes;
    bucket.entryCount += pack.entryCount;
    byLanguage[langKey] = bucket;
  }

  return {
    totalPacks: active.length,
    installedPacks,
    corruptPacks,
    totalStorageBytes,
    totalEntries,
    byLanguage,
  };
}

function scoreAndFilterEntries(
  packsById: ReadonlyMap<string, InstalledLanguagePack>,
  allEntries: Iterable<StoredDictionaryEntry>,
  query: DictionaryLookupQuery,
): StoredDictionaryEntry[] {
  const normalizedQuery = normalizeForLookup(query.query.trim(), query.languageTag);
  if (!normalizedQuery) return [];
  const includeLemmaFallback = query.includeLemmaFallback ?? true;
  const limit = Math.max(1, query.limit ?? 50);

  const scored: Array<{ rank: number; entry: StoredDictionaryEntry }> = [];

  for (const entry of allEntries) {
    const pack = packsById.get(entry.packId);
    if (!pack || pack.status !== "installed") continue;
    if (query.packId && entry.packId !== query.packId) continue;
    if (!languageMatches(entry.languageTag, query.languageTag)) continue;

    if (entry.normalizedHeadword === normalizedQuery) {
      scored.push({ rank: 0, entry });
      continue;
    }

    if (includeLemmaFallback) {
      const normalizedLemma = entry.lemma
        ? normalizeForLookup(entry.lemma, entry.languageTag)
        : undefined;
      const normalizedReading = entry.reading
        ? normalizeForLookup(entry.reading, entry.languageTag)
        : undefined;

      if (normalizedLemma === normalizedQuery) {
        scored.push({ rank: 1, entry });
      } else if (normalizedReading === normalizedQuery) {
        scored.push({ rank: 2, entry });
      }
    }
  }

  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const freqA = a.entry.frequencyRank ?? Number.MAX_SAFE_INTEGER;
    const freqB = b.entry.frequencyRank ?? Number.MAX_SAFE_INTEGER;
    return freqA - freqB;
  });

  return scored.slice(0, limit).map((item) => cloneValue(item.entry));
}

/**
 * Deterministic in-memory storage adapter for tests, headless runs, and quick prototyping.
 */
export class MemoryLanguagePackStorageAdapter implements LanguagePackStorageAdapter {
  private readonly packs = new Map<string, InstalledLanguagePack>();
  private readonly entries = new Map<string, StoredDictionaryEntry[]>();
  private readonly rawBytes = new Map<string, Uint8Array>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  async listPacks(): Promise<InstalledLanguagePack[]> {
    return [...this.packs.values()].map((pack) => cloneValue(pack));
  }

  async getPack(packId: string): Promise<InstalledLanguagePack | null> {
    const found = this.packs.get(packId);
    return found ? cloneValue(found) : null;
  }

  async upsertPack(pack: InstalledLanguagePack, rawBytes?: Uint8Array): Promise<void> {
    this.packs.set(pack.id, cloneValue(pack));
    if (rawBytes !== undefined) {
      this.rawBytes.set(pack.id, new Uint8Array(rawBytes));
    }
  }

  async insertDictionaryEntries(
    packId: string,
    languageTag: string,
    entries: readonly ParsedDictionaryEntry[],
  ): Promise<number> {
    const stored: StoredDictionaryEntry[] = entries.map((entry) => ({
      ...cloneValue(entry),
      packId,
      languageTag,
    }));
    this.entries.set(packId, stored);
    return stored.length;
  }

  async lookupDictionary(query: DictionaryLookupQuery): Promise<StoredDictionaryEntry[]> {
    const allEntries: StoredDictionaryEntry[] = [];
    for (const packEntries of this.entries.values()) {
      for (const entry of packEntries) allEntries.push(entry);
    }
    return scoreAndFilterEntries(this.packs, allEntries, query);
  }

  async getPackBytes(packId: string): Promise<Uint8Array | null> {
    const bytes = this.rawBytes.get(packId);
    return bytes ? new Uint8Array(bytes) : null;
  }

  async verifyPack(packId: string): Promise<PackVerificationResult> {
    const checkedAt = this.now();
    const pack = this.packs.get(packId);
    if (!pack || pack.status === "removed") {
      return {
        packId,
        valid: false,
        status: "removed",
        actualEntryCount: 0,
        reason: "Pack is not installed",
        checkedAt,
      };
    }

    const storedEntries = this.entries.get(packId) ?? [];
    const actualEntryCount = storedEntries.length;
    const raw = this.rawBytes.get(packId);
    let actualSha256 = pack.actualSha256;
    let reason: string | undefined;

    if (actualEntryCount !== pack.entryCount) {
      reason = `Entry count mismatch: expected ${pack.entryCount}, found ${actualEntryCount}`;
    } else if (!raw && pack.storageBytes > 0) {
      reason = "Pack archive bytes are missing from storage";
    } else if (raw && pack.sha256) {
      actualSha256 = await sha256Hex(raw);
      if (actualSha256.toLowerCase() !== pack.sha256.toLowerCase()) {
        reason = `Checksum mismatch: expected ${pack.sha256}, found ${actualSha256}`;
      }
    }

    if (reason) {
      const updated: InstalledLanguagePack = {
        ...pack,
        status: "corrupt",
        actualSha256,
        error: reason,
        lastVerifiedAt: checkedAt,
        updatedAt: checkedAt,
      };
      this.packs.set(packId, updated);
      return {
        packId,
        valid: false,
        status: "corrupt",
        expectedSha256: pack.sha256 || undefined,
        actualSha256,
        expectedEntryCount: pack.entryCount,
        actualEntryCount,
        reason,
        checkedAt,
      };
    }

    const verified: InstalledLanguagePack = {
      ...pack,
      status: "installed",
      actualSha256,
      error: undefined,
      lastVerifiedAt: checkedAt,
    };
    this.packs.set(packId, verified);
    return {
      packId,
      valid: true,
      status: "installed",
      expectedSha256: pack.sha256 || undefined,
      actualSha256,
      expectedEntryCount: pack.entryCount,
      actualEntryCount,
      checkedAt,
    };
  }

  async removePack(packId: string): Promise<boolean> {
    const existed = this.packs.delete(packId);
    this.entries.delete(packId);
    this.rawBytes.delete(packId);
    return existed;
  }

  async getStorageSummary(): Promise<PackStorageSummary> {
    return summarizePacks([...this.packs.values()]);
  }

  /** Test helper to simulate on-disk / entry corruption for verification & repair tests. */
  async corruptForTest(
    packId: string,
    mode: "bytes" | "entries" | "missing-bytes",
  ): Promise<void> {
    const raw = this.rawBytes.get(packId);
    if (mode === "bytes" && raw && raw.length > 0) {
      const tampered = new Uint8Array(raw);
      tampered[0] = tampered[0] ^ 0xff;
      this.rawBytes.set(packId, tampered);
      return;
    }
    if (mode === "missing-bytes") {
      this.rawBytes.delete(packId);
      return;
    }
    if (mode === "entries") {
      const current = this.entries.get(packId) ?? [];
      this.entries.set(packId, current.slice(0, Math.max(0, current.length - 1)));
    }
  }
}

const IDB_NAME = "plethora-language-packs";
const IDB_VERSION = 1;
const IDB_STORES = {
  packs: "language_packs",
  entries: "dictionary_entries",
  rawBytes: "pack_bytes",
} as const;

interface StoredPackEntriesRow {
  packId: string;
  entries: StoredDictionaryEntry[];
}

interface StoredPackBytesRow {
  packId: string;
  bytes: Uint8Array;
}

/**
 * Browser / PWA IndexedDB storage adapter.
 */
export class IndexedDbLanguagePackStorageAdapter implements LanguagePackStorageAdapter {
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  private openDb(): Promise<IDBDatabase> {
    const idb = globalThis.indexedDB;
    if (!idb) {
      return Promise.reject(
        new LanguagePackError("storage-error", "IndexedDB is not available in this environment"),
      );
    }
    return new Promise((resolve, reject) => {
      const request = idb.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORES.packs)) {
          db.createObjectStore(IDB_STORES.packs, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(IDB_STORES.entries)) {
          db.createObjectStore(IDB_STORES.entries, { keyPath: "packId" });
        }
        if (!db.objectStoreNames.contains(IDB_STORES.rawBytes)) {
          db.createObjectStore(IDB_STORES.rawBytes, { keyPath: "packId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new LanguagePackError("storage-error", `Failed to open IndexedDB: ${String(request.error)}`));
    });
  }

  private async withStore<T>(
    storeName: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.openDb();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () =>
          reject(new LanguagePackError("storage-error", `IndexedDB error: ${String(req.error)}`));
      });
    } finally {
      db.close();
    }
  }

  async listPacks(): Promise<InstalledLanguagePack[]> {
    const result = await this.withStore<InstalledLanguagePack[]>(
      IDB_STORES.packs,
      "readonly",
      (store) => store.getAll() as IDBRequest<InstalledLanguagePack[]>,
    );
    return result ?? [];
  }

  async getPack(packId: string): Promise<InstalledLanguagePack | null> {
    const result = await this.withStore<InstalledLanguagePack | undefined>(
      IDB_STORES.packs,
      "readonly",
      (store) => store.get(packId) as IDBRequest<InstalledLanguagePack | undefined>,
    );
    return result ?? null;
  }

  async upsertPack(pack: InstalledLanguagePack, rawBytes?: Uint8Array): Promise<void> {
    await this.withStore(IDB_STORES.packs, "readwrite", (store) => store.put(cloneValue(pack)));
    if (rawBytes !== undefined) {
      const row: StoredPackBytesRow = { packId: pack.id, bytes: new Uint8Array(rawBytes) };
      await this.withStore(IDB_STORES.rawBytes, "readwrite", (store) => store.put(row));
    }
  }

  async insertDictionaryEntries(
    packId: string,
    languageTag: string,
    entries: readonly ParsedDictionaryEntry[],
  ): Promise<number> {
    const stored: StoredDictionaryEntry[] = entries.map((entry) => ({
      ...cloneValue(entry),
      packId,
      languageTag,
    }));
    const row: StoredPackEntriesRow = { packId, entries: stored };
    await this.withStore(IDB_STORES.entries, "readwrite", (store) => store.put(row));
    return stored.length;
  }

  async lookupDictionary(query: DictionaryLookupQuery): Promise<StoredDictionaryEntry[]> {
    const [packs, allEntryRows] = await Promise.all([
      this.listPacks(),
      this.withStore<StoredPackEntriesRow[]>(
        IDB_STORES.entries,
        "readonly",
        (store) => store.getAll() as IDBRequest<StoredPackEntriesRow[]>,
      ),
    ]);
    const packsById = new Map(packs.map((pack) => [pack.id, pack]));
    const allEntries = (allEntryRows ?? []).flatMap((row) => row.entries);
    return scoreAndFilterEntries(packsById, allEntries, query);
  }

  async getPackBytes(packId: string): Promise<Uint8Array | null> {
    const row = await this.withStore<StoredPackBytesRow | undefined>(
      IDB_STORES.rawBytes,
      "readonly",
      (store) => store.get(packId) as IDBRequest<StoredPackBytesRow | undefined>,
    );
    return row ? new Uint8Array(row.bytes) : null;
  }

  async verifyPack(packId: string): Promise<PackVerificationResult> {
    const checkedAt = this.now();
    const pack = await this.getPack(packId);
    if (!pack || pack.status === "removed") {
      return {
        packId,
        valid: false,
        status: "removed",
        actualEntryCount: 0,
        reason: "Pack is not installed",
        checkedAt,
      };
    }

    const [entryRow, raw] = await Promise.all([
      this.withStore<StoredPackEntriesRow | undefined>(
        IDB_STORES.entries,
        "readonly",
        (store) => store.get(packId) as IDBRequest<StoredPackEntriesRow | undefined>,
      ),
      this.getPackBytes(packId),
    ]);
    const actualEntryCount = entryRow?.entries.length ?? 0;
    let actualSha256 = pack.actualSha256;
    let reason: string | undefined;

    if (actualEntryCount !== pack.entryCount) {
      reason = `Entry count mismatch: expected ${pack.entryCount}, found ${actualEntryCount}`;
    } else if (!raw && pack.storageBytes > 0) {
      reason = "Pack archive bytes are missing from storage";
    } else if (raw && pack.sha256) {
      actualSha256 = await sha256Hex(raw);
      if (actualSha256.toLowerCase() !== pack.sha256.toLowerCase()) {
        reason = `Checksum mismatch: expected ${pack.sha256}, found ${actualSha256}`;
      }
    }

    if (reason) {
      await this.upsertPack({
        ...pack,
        status: "corrupt",
        actualSha256,
        error: reason,
        lastVerifiedAt: checkedAt,
        updatedAt: checkedAt,
      });
      return {
        packId,
        valid: false,
        status: "corrupt",
        expectedSha256: pack.sha256 || undefined,
        actualSha256,
        expectedEntryCount: pack.entryCount,
        actualEntryCount,
        reason,
        checkedAt,
      };
    }

    await this.upsertPack({
      ...pack,
      status: "installed",
      actualSha256,
      error: undefined,
      lastVerifiedAt: checkedAt,
    });
    return {
      packId,
      valid: true,
      status: "installed",
      expectedSha256: pack.sha256 || undefined,
      actualSha256,
      expectedEntryCount: pack.entryCount,
      actualEntryCount,
      checkedAt,
    };
  }

  async removePack(packId: string): Promise<boolean> {
    const existing = await this.getPack(packId);
    await Promise.all([
      this.withStore(IDB_STORES.packs, "readwrite", (store) => store.delete(packId)),
      this.withStore(IDB_STORES.entries, "readwrite", (store) => store.delete(packId)),
      this.withStore(IDB_STORES.rawBytes, "readwrite", (store) => store.delete(packId)),
    ]);
    return existing !== null;
  }

  async getStorageSummary(): Promise<PackStorageSummary> {
    return summarizePacks(await this.listPacks());
  }
}

// ---------------------------------------------------------------------------
// LanguagePackManager
// ---------------------------------------------------------------------------

export interface LanguagePackManagerOptions {
  storage?: LanguagePackStorageAdapter;
  catalog?: readonly LanguagePackManifest[];
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface LocalPackImportInput {
  id?: string;
  name?: string;
  fileName?: string;
  bytes?: Uint8Array;
  files?: StarDictInputFiles;
  format?: LanguagePackFormat;
  languageTag: string;
  targetLanguage?: string;
  baseLanguage?: string;
  kind?: LanguagePackKind;
  version?: string;
  license?: string;
  attribution?: string;
  description?: string;
  expectedSha256?: string;
  capabilities?: LanguagePackManifest["capabilities"];
}

function throwIfAborted(
  signal: AbortSignal | undefined,
  packId: string,
  onProgress?: (progress: PackInstallProgress) => void,
  bytesLoaded = 0,
  bytesTotal?: number,
): void {
  if (!signal?.aborted) return;
  onProgress?.({
    packId,
    phase: "cancelled",
    bytesLoaded,
    bytesTotal,
    message: "Language pack installation cancelled",
  });
  throw new LanguagePackError("cancelled", `Installation cancelled for pack "${packId}"`, {
    packId,
  });
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (error instanceof Error && error.name === "AbortError");
}

async function bundleStarDictFilesToZip(files: StarDictInputFiles): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("dictionary.ifo", files.ifo);
  zip.file("dictionary.idx", files.idx);
  zip.file("dictionary.dict", files.dict);
  return zip.generateAsync({ type: "uint8array" });
}

export class LanguagePackManager {
  private readonly storage: LanguagePackStorageAdapter;
  private readonly catalog: readonly LanguagePackManifest[];
  private readonly defaultFetchImpl?: typeof fetch;
  private readonly now: () => number;

  constructor(options: LanguagePackManagerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.storage = options.storage ?? new MemoryLanguagePackStorageAdapter(this.now);
    this.catalog = options.catalog ?? LANGUAGE_PACK_CATALOG;
    this.defaultFetchImpl =
      options.fetchImpl ??
      (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined);
  }

  discoverCatalog(filter?: CatalogFilter): LanguagePackManifest[] {
    return filterCatalogPacks(this.catalog, filter);
  }

  async listInstalled(): Promise<InstalledLanguagePack[]> {
    const packs = await this.storage.listPacks();
    return packs.filter((pack) => pack.status !== "removed");
  }

  async getInstalledPack(packId: string): Promise<InstalledLanguagePack | null> {
    if (this.storage.getPack) {
      return this.storage.getPack(packId);
    }
    const all = await this.storage.listPacks();
    return all.find((pack) => pack.id === packId) ?? null;
  }

  async installFromBytes(
    manifest: LanguagePackManifest,
    bytes: Uint8Array,
    options: PackInstallOptions = {},
  ): Promise<InstalledLanguagePack> {
    const { signal, onProgress, skipChecksum } = options;
    const totalBytes = bytes.byteLength;

    throwIfAborted(signal, manifest.id, onProgress, 0, totalBytes);

    onProgress?.({
      packId: manifest.id,
      phase: "verifying",
      bytesLoaded: totalBytes,
      bytesTotal: totalBytes,
      percent: 25,
    });

    const actualSha256 = await sha256Hex(bytes);
    throwIfAborted(signal, manifest.id, onProgress, totalBytes, totalBytes);

    const expectedSha256 = manifest.sha256.trim().toLowerCase();
    if (!skipChecksum) {
      if (!expectedSha256) {
        onProgress?.({
          packId: manifest.id,
          phase: "failed",
          bytesLoaded: totalBytes,
          bytesTotal: totalBytes,
          message: "Manifest is missing expected SHA-256 checksum",
        });
        throw new LanguagePackError(
          "checksum-mismatch",
          `Pack "${manifest.id}" has no expected SHA-256 checksum`,
          { packId: manifest.id, details: { actualSha256 } },
        );
      }
      if (actualSha256 !== expectedSha256) {
        onProgress?.({
          packId: manifest.id,
          phase: "failed",
          bytesLoaded: totalBytes,
          bytesTotal: totalBytes,
          message: `SHA-256 mismatch for ${manifest.id}`,
        });
        throw new LanguagePackError(
          "checksum-mismatch",
          `SHA-256 mismatch for "${manifest.id}": expected ${expectedSha256}, got ${actualSha256}`,
          {
            packId: manifest.id,
            details: { expectedSha256, actualSha256 },
          },
        );
      }
    }

    onProgress?.({
      packId: manifest.id,
      phase: "parsing",
      bytesLoaded: totalBytes,
      bytesTotal: totalBytes,
      percent: 55,
    });

    const entries = await parseLanguagePackPayload(manifest.format, bytes, manifest.languageTag);
    throwIfAborted(signal, manifest.id, onProgress, totalBytes, totalBytes);

    return this.commitParsedPack(manifest, bytes, actualSha256, entries, onProgress, signal);
  }

  async installStarDictFiles(
    manifest: Omit<LanguagePackManifest, "format" | "sizeBytes" | "sha256"> & {
      format?: "stardict";
      sizeBytes?: number;
      sha256?: string;
    },
    files: StarDictInputFiles,
    options: PackInstallOptions = {},
  ): Promise<InstalledLanguagePack> {
    const { signal, onProgress } = options;
    throwIfAborted(signal, manifest.id, onProgress);

    onProgress?.({
      packId: manifest.id,
      phase: "parsing",
      bytesLoaded: 0,
      percent: 30,
    });

    const entries = parseStarDictFiles(files, manifest.languageTag);
    throwIfAborted(signal, manifest.id, onProgress);

    const bundledZip = await bundleStarDictFilesToZip(files);
    throwIfAborted(signal, manifest.id, onProgress, bundledZip.byteLength, bundledZip.byteLength);

    const actualSha256 = await sha256Hex(bundledZip);
    if (manifest.sha256 && manifest.sha256.toLowerCase() !== actualSha256) {
      throw new LanguagePackError(
        "checksum-mismatch",
        `SHA-256 mismatch for StarDict pack "${manifest.id}"`,
        {
          packId: manifest.id,
          details: { expectedSha256: manifest.sha256, actualSha256 },
        },
      );
    }

    const fullManifest: LanguagePackManifest = {
      ...manifest,
      format: "stardict",
      sizeBytes: bundledZip.byteLength,
      sha256: manifest.sha256 || actualSha256,
      availability: manifest.availability ?? "local-import",
    };

    return this.commitParsedPack(
      fullManifest,
      bundledZip,
      actualSha256,
      entries,
      onProgress,
      signal,
    );
  }

  async importLocalPack(
    input: LocalPackImportInput,
    options: PackInstallOptions = {},
  ): Promise<InstalledLanguagePack> {
    const packId =
      input.id ??
      `local-${input.languageTag.toLowerCase()}-${(input.fileName ?? "pack")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}`;

    if (input.files) {
      return this.installStarDictFiles(
        {
          id: packId,
          name: input.name ?? `Local ${input.languageTag.toUpperCase()} StarDict Pack`,
          languageTag: input.languageTag,
          targetLanguage: input.targetLanguage ?? input.languageTag,
          baseLanguage: input.baseLanguage ?? "en",
          kind: input.kind ?? "dictionary",
          version: input.version ?? "local",
          sha256: input.expectedSha256,
          license: input.license ?? "User-supplied local pack",
          attribution: input.attribution ?? "Imported locally by user",
          capabilities: input.capabilities ?? { offlineDictionary: true },
          description: input.description ?? "Offline locally imported StarDict dictionary pack.",
          availability: "local-import",
        },
        input.files,
        options,
      );
    }

    if (!input.bytes) {
      throw new LanguagePackError(
        "invalid-format",
        "importLocalPack requires either raw bytes or StarDict files",
        { packId },
      );
    }

    const format = input.format ?? detectLanguagePackFormat(input.fileName, input.bytes);
    if (!format) {
      throw new LanguagePackError(
        "unsupported-format",
        `Could not determine pack format for "${input.fileName ?? packId}"`,
        { packId },
      );
    }

    const computedSha = await sha256Hex(input.bytes);
    const sha256 = input.expectedSha256 ?? computedSha;

    const manifest: LanguagePackManifest = {
      id: packId,
      name: input.name ?? input.fileName ?? `Local ${input.languageTag.toUpperCase()} Pack`,
      languageTag: input.languageTag,
      targetLanguage: input.targetLanguage ?? input.languageTag,
      baseLanguage: input.baseLanguage ?? "en",
      kind: input.kind ?? "dictionary",
      format,
      version: input.version ?? "local",
      sizeBytes: input.bytes.byteLength,
      sha256,
      license: input.license ?? "User-supplied local pack",
      attribution: input.attribution ?? "Imported locally by user",
      capabilities: input.capabilities ?? {
        offlineDictionary: true,
        readings: format === "yomichan-zip" || format === "kaikki-jsonl",
        lemmaTable: format === "kaikki-jsonl" || format === "tsv",
      },
      description:
        input.description ?? `Offline locally imported ${format} language pack.`,
      availability: "local-import",
    };

    return this.installFromBytes(manifest, input.bytes, options);
  }

  async installStarterPack(
    packId: string,
    options: PackInstallOptions = {},
  ): Promise<InstalledLanguagePack> {
    const manifest = findCatalogPack(packId, this.catalog);
    if (!manifest) {
      throw new LanguagePackError("not-found", `Catalog pack "${packId}" not found`, { packId });
    }
    const starterBytes = getStarterPackBytes(packId);
    if (!starterBytes) {
      throw new LanguagePackError(
        "no-download-url",
        `Catalog pack "${packId}" is not an embedded starter pack; import a local archive with importLocalPack.`,
        { packId },
      );
    }
    return this.installFromBytes(manifest, starterBytes, options);
  }

  async downloadAndInstall(
    manifest: LanguagePackManifest,
    options: PackInstallOptions = {},
  ): Promise<InstalledLanguagePack> {
    const { signal, onProgress, fetchImpl = this.defaultFetchImpl } = options;

    throwIfAborted(signal, manifest.id, onProgress);

    if (manifest.availability === "embedded-starter" && !manifest.downloadUrl) {
      const starterBytes = getStarterPackBytes(manifest.id);
      if (starterBytes) {
        return this.installFromBytes(manifest, starterBytes, options);
      }
    }

    if (!manifest.downloadUrl) {
      throw new LanguagePackError(
        "no-download-url",
        `Pack "${manifest.id}" has no direct downloadUrl; download from ${manifest.homepageUrl ?? "upstream"} and import via importLocalPack.`,
        { packId: manifest.id },
      );
    }

    if (!fetchImpl) {
      throw new LanguagePackError(
        "network-error",
        "No fetch implementation available for downloading language pack",
        { packId: manifest.id },
      );
    }

    onProgress?.({
      packId: manifest.id,
      phase: "downloading",
      bytesLoaded: 0,
      bytesTotal: manifest.sizeBytes || undefined,
      percent: 0,
    });

    let response: Response;
    try {
      response = await fetchImpl(manifest.downloadUrl, { signal });
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        onProgress?.({
          packId: manifest.id,
          phase: "cancelled",
          bytesLoaded: 0,
          bytesTotal: manifest.sizeBytes || undefined,
        });
        throw new LanguagePackError("cancelled", `Download cancelled for "${manifest.id}"`, {
          packId: manifest.id,
        });
      }
      throw new LanguagePackError(
        "network-error",
        `Network error downloading "${manifest.id}": ${String(error)}`,
        { packId: manifest.id },
      );
    }

    if (!response.ok) {
      throw new LanguagePackError(
        "network-error",
        `Failed to download "${manifest.id}": HTTP ${response.status}`,
        { packId: manifest.id, details: { status: response.status } },
      );
    }

    const headerLen = Number(response.headers?.get?.("content-length") ?? "0");
    const bytesTotal =
      Number.isFinite(headerLen) && headerLen > 0 ? headerLen : manifest.sizeBytes || undefined;

    let downloadedBytes: Uint8Array;
    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytesLoaded = 0;
      try {
        for (;;) {
          throwIfAborted(signal, manifest.id, onProgress, bytesLoaded, bytesTotal);
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) {
            chunks.push(value);
            bytesLoaded += value.byteLength;
            onProgress?.({
              packId: manifest.id,
              phase: "downloading",
              bytesLoaded,
              bytesTotal,
              percent: bytesTotal ? Math.min(24, Math.round((bytesLoaded / bytesTotal) * 24)) : undefined,
            });
          }
        }
      } catch (error) {
        if (error instanceof LanguagePackError) throw error;
        if (signal?.aborted || isAbortError(error)) {
          onProgress?.({
            packId: manifest.id,
            phase: "cancelled",
            bytesLoaded,
            bytesTotal,
          });
          throw new LanguagePackError("cancelled", `Download cancelled for "${manifest.id}"`, {
            packId: manifest.id,
          });
        }
        throw new LanguagePackError(
          "network-error",
          `Stream error downloading "${manifest.id}": ${String(error)}`,
          { packId: manifest.id },
        );
      } finally {
        reader.releaseLock?.();
      }
      downloadedBytes = new Uint8Array(bytesLoaded);
      let offset = 0;
      for (const chunk of chunks) {
        downloadedBytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } else {
      const buffer = await response.arrayBuffer();
      throwIfAborted(signal, manifest.id, onProgress, buffer.byteLength, bytesTotal);
      downloadedBytes = new Uint8Array(buffer);
    }

    return this.installFromBytes(manifest, downloadedBytes, options);
  }

  async verifyPack(packId: string): Promise<PackVerificationResult> {
    return this.storage.verifyPack(packId);
  }

  async repairPack(
    packId: string,
    options: PackInstallOptions & {
      bytes?: Uint8Array;
      manifest?: LanguagePackManifest;
    } = {},
  ): Promise<InstalledLanguagePack> {
    const existing = await this.getInstalledPack(packId);
    const catalogManifest = findCatalogPack(packId, this.catalog);
    const baseManifest = options.manifest ?? existing ?? catalogManifest;

    if (!baseManifest) {
      throw new LanguagePackError("not-found", `Cannot repair unknown pack "${packId}"`, {
        packId,
      });
    }

    if (options.bytes) {
      return this.installFromBytes(baseManifest, options.bytes, options);
    }

    const starterBytes = getStarterPackBytes(packId);
    if (starterBytes) {
      return this.installFromBytes(catalogManifest ?? baseManifest, starterBytes, options);
    }

    if (baseManifest.downloadUrl) {
      return this.downloadAndInstall(baseManifest, options);
    }

    if (this.storage.getPackBytes) {
      const storedBytes = await this.storage.getPackBytes(packId);
      if (storedBytes) {
        const storedSha = await sha256Hex(storedBytes);
        if (!baseManifest.sha256 || storedSha === baseManifest.sha256.toLowerCase()) {
          return this.installFromBytes(baseManifest, storedBytes, {
            ...options,
            skipChecksum: !baseManifest.sha256,
          });
        }
      }
    }

    throw new LanguagePackError(
      "corrupt-pack",
      `Pack "${packId}" is corrupt and no valid recovery source (bytes, starter payload, or downloadUrl) is available`,
      { packId },
    );
  }

  async removePack(packId: string): Promise<boolean> {
    return this.storage.removePack(packId);
  }

  async lookup(query: DictionaryLookupQuery): Promise<StoredDictionaryEntry[]> {
    return this.storage.lookupDictionary(query);
  }

  async getStorageUsage(): Promise<PackStorageSummary> {
    return this.storage.getStorageSummary();
  }

  async listAttribution(): Promise<PackAttributionItem[]> {
    const packs = await this.listInstalled();
    return packs.map((pack) => ({
      packId: pack.id,
      name: pack.name,
      version: pack.version,
      languageTag: pack.languageTag,
      license: pack.license,
      attribution: pack.attribution,
      homepageUrl: pack.homepageUrl,
      status: pack.status,
    }));
  }

  private async commitParsedPack(
    manifest: LanguagePackManifest,
    rawBytes: Uint8Array,
    actualSha256: string,
    entries: readonly ParsedDictionaryEntry[],
    onProgress?: (progress: PackInstallProgress) => void,
    signal?: AbortSignal,
  ): Promise<InstalledLanguagePack> {
    onProgress?.({
      packId: manifest.id,
      phase: "storing",
      bytesLoaded: rawBytes.byteLength,
      bytesTotal: rawBytes.byteLength,
      parsedEntries: entries.length,
      percent: 80,
    });

    const previous = await this.getInstalledPack(manifest.id);
    throwIfAborted(signal, manifest.id, onProgress, rawBytes.byteLength, rawBytes.byteLength);

    const insertedCount = await this.storage.insertDictionaryEntries(
      manifest.id,
      manifest.languageTag,
      entries,
    );

    const timestamp = this.now();
    const installed: InstalledLanguagePack = {
      ...manifest,
      sizeBytes: rawBytes.byteLength,
      sha256: manifest.sha256 || actualSha256,
      actualSha256,
      status: "installed",
      entryCount: insertedCount,
      installedAt: previous?.installedAt ?? timestamp,
      updatedAt: timestamp,
      lastVerifiedAt: timestamp,
      storageBytes: rawBytes.byteLength,
      error: undefined,
    };

    await this.storage.upsertPack(installed, rawBytes);

    onProgress?.({
      packId: manifest.id,
      phase: "completed",
      bytesLoaded: rawBytes.byteLength,
      bytesTotal: rawBytes.byteLength,
      parsedEntries: insertedCount,
      percent: 100,
    });

    return installed;
  }
}
