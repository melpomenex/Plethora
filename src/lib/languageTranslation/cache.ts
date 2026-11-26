import {
  getLanguageTranslationCache,
  putLanguageTranslationCache,
  type LanguageTranslationCacheRecord,
} from "../../api/languageEcosystem";
import type { TranslationCacheKey } from "./cacheKey";
import type { StoredTranslationResult } from "./result";

export interface TranslationCacheMetadata {
  key: TranslationCacheKey;
  sourceFingerprint: string;
  profileId: string;
  sourceLanguage: string;
  targetLanguage: string;
  providerId: string;
  providerVersion: string;
  sizeBytes: number;
  createdAt: number;
  lastAccessedAt: number;
  hitCount: number;
}

export interface TranslationCacheEntry {
  result: StoredTranslationResult;
  metadata: TranslationCacheMetadata;
  accessSequence: number;
}

export interface TranslationDurableStore {
  get(cacheKey: string): Promise<LanguageTranslationCacheRecord | null>;
  put(record: LanguageTranslationCacheRecord): Promise<unknown>;
}

export interface TranslationCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
  now?: () => number;
  durableStore?: TranslationDurableStore | false;
}

const DEFAULT_MAX_ENTRIES = 128;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_DURABLE_STORE: TranslationDurableStore = {
  get: getLanguageTranslationCache,
  put: putLanguageTranslationCache,
};

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function estimateSize(result: StoredTranslationResult): number {
  return utf8Size(JSON.stringify(result));
}

/**
 * Small deterministic LRU cache backed optionally by SQLite (`language_translation_cache`).
 * In-memory methods stay synchronous for fast lookups and backwards compatibility.
 */
export class TranslationCache {
  private readonly entries = new Map<TranslationCacheKey, TranslationCacheEntry>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private readonly durableStore: TranslationDurableStore | false;
  private readonly pendingDurableGets = new Map<string, Promise<LanguageTranslationCacheRecord | null>>();
  private totalBytes = 0;
  private accessSequence = 0;

  constructor(options: TranslationCacheOptions = {}) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES));
    this.maxBytes = Math.max(1, Math.floor(options.maxBytes ?? DEFAULT_MAX_BYTES));
    this.now = options.now ?? Date.now;
    this.durableStore = options.durableStore === undefined ? DEFAULT_DURABLE_STORE : options.durableStore;
  }

  get(key: TranslationCacheKey): StoredTranslationResult | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.metadata.lastAccessedAt = this.now();
    entry.metadata.hitCount += 1;
    entry.accessSequence = ++this.accessSequence;
    return entry.result;
  }

  async getPersisted(
    key: TranslationCacheKey,
    rehydrate: (record: LanguageTranslationCacheRecord) => StoredTranslationResult,
  ): Promise<StoredTranslationResult | undefined> {
    const memHit = this.get(key);
    if (memHit) return memHit;
    if (this.durableStore === false) return undefined;

    let lookup = this.pendingDurableGets.get(key);
    if (!lookup) {
      const store = this.durableStore;
      lookup = Promise.resolve()
        .then(() => store.get(key))
        .catch(() => null)
        .finally(() => {
          if (this.pendingDurableGets.get(key) === lookup) {
            this.pendingDurableGets.delete(key);
          }
        });
      this.pendingDurableGets.set(key, lookup);
    }

    const record = await lookup;
    if (!record) return undefined;
    const nowSeconds = Math.floor(this.now() / 1000);
    if (record.expiresAt != null && record.expiresAt <= nowSeconds) return undefined;

    const stored = rehydrate(record);
    this.set(stored);
    return stored;
  }

  set(result: StoredTranslationResult): boolean {
    const sizeBytes = estimateSize(result);
    if (sizeBytes > this.maxBytes) return false;

    const previous = this.entries.get(result.cacheKey);
    if (previous) this.totalBytes -= previous.metadata.sizeBytes;
    const timestamp = this.now();
    const entry: TranslationCacheEntry = {
      result,
      metadata: {
        key: result.cacheKey,
        sourceFingerprint: result.sourceFingerprint,
        profileId: result.profileId,
        sourceLanguage: result.sourceLanguage,
        targetLanguage: result.targetLanguage,
        providerId: result.providerId,
        providerVersion: result.providerVersion,
        sizeBytes,
        createdAt: previous?.metadata.createdAt ?? timestamp,
        lastAccessedAt: timestamp,
        hitCount: previous?.metadata.hitCount ?? 0,
      },
      accessSequence: ++this.accessSequence,
    };
    this.entries.set(result.cacheKey, entry);
    this.totalBytes += sizeBytes;
    this.evictIfNeeded();
    return this.entries.has(result.cacheKey);
  }

  async setPersisted(result: StoredTranslationResult, ttlSeconds?: number): Promise<boolean> {
    const stored = this.set(result);
    if (this.durableStore === false) return stored;

    const createdAtSeconds = Math.floor(this.now() / 1000);
    const expiresAt =
      ttlSeconds && ttlSeconds > 0 ? createdAtSeconds + Math.floor(ttlSeconds) : undefined;
    try {
      await this.durableStore.put({
        cacheKey: result.cacheKey,
        profileId: result.profileId,
        sourceLang: result.sourceLanguage,
        targetLang: result.targetLanguage,
        sourceHash: result.sourceFingerprint,
        providerId: result.providerId,
        providerVersion: result.providerVersion,
        translationText: result.translatedText,
        confidence: result.confidence ?? undefined,
        createdAt: createdAtSeconds,
        expiresAt,
      });
    } catch {
      // Durable persistence failure must never break sentence translation.
    }
    return stored;
  }

  has(key: TranslationCacheKey): boolean {
    return this.entries.has(key);
  }

  delete(key: TranslationCacheKey): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.totalBytes -= entry.metadata.sizeBytes;
    return this.entries.delete(key);
  }

  invalidate(predicate: (metadata: TranslationCacheMetadata) => boolean): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (predicate(entry.metadata)) {
        this.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  metadata(): readonly TranslationCacheMetadata[] {
    return [...this.entries.values()]
      .sort((left, right) => left.accessSequence - right.accessSequence)
      .map((entry) => ({ ...entry.metadata }));
  }

  stats(): { entries: number; bytes: number; maxEntries: number; maxBytes: number } {
    return {
      entries: this.entries.size,
      bytes: this.totalBytes,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
    };
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldest = [...this.entries.values()].sort((left, right) => {
        if (left.accessSequence !== right.accessSequence) return left.accessSequence - right.accessSequence;
        return left.metadata.key.localeCompare(right.metadata.key);
      })[0];
      if (!oldest) return;
      this.delete(oldest.metadata.key);
    }
  }
}
