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

export interface TranslationCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
  now?: () => number;
}

const DEFAULT_MAX_ENTRIES = 128;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function estimateSize(result: StoredTranslationResult): number {
  return utf8Size(JSON.stringify(result));
}

/**
 * Small deterministic LRU cache. Entries are complete provenance records so a
 * future durable store can persist them without making readers provider-aware.
 */
export class TranslationCache {
  private readonly entries = new Map<TranslationCacheKey, TranslationCacheEntry>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private totalBytes = 0;
  private accessSequence = 0;

  constructor(options: TranslationCacheOptions = {}) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES));
    this.maxBytes = Math.max(1, Math.floor(options.maxBytes ?? DEFAULT_MAX_BYTES));
    this.now = options.now ?? Date.now;
  }

  get(key: TranslationCacheKey): StoredTranslationResult | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.metadata.lastAccessedAt = this.now();
    entry.metadata.hitCount += 1;
    entry.accessSequence = ++this.accessSequence;
    return entry.result;
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
