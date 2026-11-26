/**
 * Contracts for offline Language Packs and parsed dictionary entries.
 *
 * Designed to stay framework-free so both Tauri SQLite commands (Wave 1A/2)
 * and browser/IndexedDB/memory adapters can implement `LanguagePackStorageAdapter`.
 */

export type LanguagePackKind =
  | "dictionary"
  | "morphology"
  | "readings"
  | "frequency"
  | "bundle";

export type LanguagePackFormat =
  | "json"
  | "tsv"
  | "yomichan-zip"
  | "stardict"
  | "kaikki-jsonl";

export type LanguagePackStatus =
  | "installed"
  | "downloading"
  | "verifying"
  | "corrupt"
  | "removed";

export type LanguagePackAvailability =
  | "embedded-starter"
  | "local-import"
  | "mirror-list"
  | "upstream-manual";

export interface LanguagePackCapabilities {
  offlineDictionary?: boolean;
  lemmaTable?: boolean;
  readings?: boolean;
  compounds?: boolean;
  frequency?: boolean;
  morphology?: boolean;
}

export interface LanguagePackMirror {
  label: string;
  url?: string;
  homepageUrl?: string;
  formatNote?: string;
}

export interface LanguagePackManifest {
  id: string;
  name: string;
  languageTag: string;
  targetLanguage: string;
  baseLanguage?: string;
  kind: LanguagePackKind;
  format: LanguagePackFormat;
  version: string;
  sizeBytes: number;
  sha256: string;
  downloadUrl?: string;
  license: string;
  attribution: string;
  capabilities: LanguagePackCapabilities;
  description: string;
  availability?: LanguagePackAvailability;
  homepageUrl?: string;
  mirrors?: readonly LanguagePackMirror[];
}

export interface InstalledLanguagePack extends LanguagePackManifest {
  status: LanguagePackStatus;
  entryCount: number;
  installedAt: number;
  updatedAt: number;
  lastVerifiedAt: number;
  storageBytes: number;
  actualSha256?: string;
  error?: string;
}

export interface DictionarySense {
  definition: string;
  glosses?: string[];
  tags?: string[];
}

export interface ParsedDictionaryEntry {
  headword: string;
  normalizedHeadword: string;
  reading?: string;
  lemma?: string;
  pos?: string;
  morphology?: Record<string, string>;
  senses: DictionarySense[];
  examples?: string[];
  frequencyRank?: number;
}

export interface StoredDictionaryEntry extends ParsedDictionaryEntry {
  packId: string;
  languageTag: string;
}

export interface DictionaryLookupQuery {
  query: string;
  languageTag?: string;
  packId?: string;
  includeLemmaFallback?: boolean;
  limit?: number;
}

export interface StarDictInputFiles {
  ifo: string;
  idx: Uint8Array;
  dict: Uint8Array;
}

export interface PackInstallProgress {
  packId: string;
  phase:
    | "downloading"
    | "verifying"
    | "parsing"
    | "storing"
    | "completed"
    | "failed"
    | "cancelled";
  bytesLoaded: number;
  bytesTotal?: number;
  parsedEntries?: number;
  percent?: number;
  message?: string;
}

export interface PackInstallOptions {
  signal?: AbortSignal;
  onProgress?: (progress: PackInstallProgress) => void;
  fetchImpl?: typeof fetch;
  /** Skip SHA-256 verification only when importing unverified local files without a known hash. */
  skipChecksum?: boolean;
}

export interface PackVerificationResult {
  packId: string;
  valid: boolean;
  status: LanguagePackStatus;
  expectedSha256?: string;
  actualSha256?: string;
  expectedEntryCount?: number;
  actualEntryCount: number;
  reason?: string;
  checkedAt: number;
}

export interface LanguageStorageUsage {
  packCount: number;
  storageBytes: number;
  entryCount: number;
}

export interface PackStorageSummary {
  totalPacks: number;
  installedPacks: number;
  corruptPacks: number;
  totalStorageBytes: number;
  totalEntries: number;
  byLanguage: Record<string, LanguageStorageUsage>;
}

export interface PackAttributionItem {
  packId: string;
  name: string;
  version: string;
  languageTag: string;
  license: string;
  attribution: string;
  homepageUrl?: string;
  status: LanguagePackStatus;
}

export interface LanguagePackStorageAdapter {
  listPacks(): Promise<InstalledLanguagePack[]>;
  getPack?(packId: string): Promise<InstalledLanguagePack | null>;
  upsertPack(pack: InstalledLanguagePack, rawBytes?: Uint8Array): Promise<void>;
  insertDictionaryEntries(
    packId: string,
    languageTag: string,
    entries: readonly ParsedDictionaryEntry[],
  ): Promise<number>;
  lookupDictionary(query: DictionaryLookupQuery): Promise<StoredDictionaryEntry[]>;
  verifyPack(packId: string): Promise<PackVerificationResult>;
  removePack(packId: string): Promise<boolean>;
  getStorageSummary(): Promise<PackStorageSummary>;
  getPackBytes?(packId: string): Promise<Uint8Array | null>;
}

export type LanguagePackErrorCode =
  | "checksum-mismatch"
  | "cancelled"
  | "invalid-format"
  | "unsupported-format"
  | "network-error"
  | "no-download-url"
  | "not-found"
  | "corrupt-pack"
  | "storage-error";

export class LanguagePackError extends Error {
  readonly code: LanguagePackErrorCode;
  readonly packId?: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: LanguagePackErrorCode,
    message: string,
    options: {
      packId?: string;
      details?: Readonly<Record<string, unknown>>;
    } = {},
  ) {
    super(message);
    this.name = "LanguagePackError";
    this.code = code;
    this.packId = options.packId;
    this.details = options.details;
  }
}
