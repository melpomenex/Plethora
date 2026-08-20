import type {
  AnalysisChunk,
  AnalysisPage,
  AnalysisSummary,
  AnalysisVersion,
  JobState,
  LanguageAnalysisResult,
  ProcessingJobCheckpoint,
  TokenSpan,
} from "./types";

export interface ProcessingResultRecord {
  processingKey: string;
  version: AnalysisVersion;
  chunkCount: number;
  summary: AnalysisSummary;
  updatedAt: number;
}

export interface LanguageProcessingStore {
  getJob(jobId: string): Promise<ProcessingJobCheckpoint | null>;
  putJob(checkpoint: ProcessingJobCheckpoint): Promise<void>;
  getChunks(processingKey: string): Promise<AnalysisChunk[]>;
  putChunk(processingKey: string, chunk: AnalysisChunk): Promise<void>;
  getResult(processingKey: string): Promise<ProcessingResultRecord | null>;
  putResult(result: ProcessingResultRecord): Promise<void>;
  pageTokens(processingKey: string, offset: number, limit: number): Promise<AnalysisPage | null>;
  cleanup(olderThan: number): Promise<number>;
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Deterministic test/offline store. It has the same paging semantics as IDB. */
export class MemoryLanguageProcessingStore implements LanguageProcessingStore {
  private readonly jobs = new Map<string, ProcessingJobCheckpoint>();
  private readonly chunks = new Map<string, Map<number, AnalysisChunk>>();
  private readonly results = new Map<string, ProcessingResultRecord>();

  async getJob(jobId: string): Promise<ProcessingJobCheckpoint | null> {
    return clone(this.jobs.get(jobId) ?? null);
  }

  async putJob(checkpoint: ProcessingJobCheckpoint): Promise<void> {
    this.jobs.set(checkpoint.jobId, clone(checkpoint));
  }

  async getChunks(processingKey: string): Promise<AnalysisChunk[]> {
    return [...(this.chunks.get(processingKey)?.values() ?? [])]
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map(clone);
  }

  async putChunk(processingKey: string, chunk: AnalysisChunk): Promise<void> {
    const chunks = this.chunks.get(processingKey) ?? new Map<number, AnalysisChunk>();
    chunks.set(chunk.chunkIndex, clone(chunk));
    this.chunks.set(processingKey, chunks);
  }

  async getResult(processingKey: string): Promise<ProcessingResultRecord | null> {
    return clone(this.results.get(processingKey) ?? null);
  }

  async putResult(result: ProcessingResultRecord): Promise<void> {
    this.results.set(result.processingKey, clone(result));
  }

  async pageTokens(processingKey: string, offset: number, limit: number): Promise<AnalysisPage | null> {
    const result = this.results.get(processingKey);
    if (!result) return null;
    const tokens = [...(this.chunks.get(processingKey)?.values() ?? [])]
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .flatMap((chunk) => chunk.tokens)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const safeOffset = Math.max(0, Math.floor(offset));
    const safeLimit = Math.max(1, Math.floor(limit));
    const page = tokens.slice(safeOffset, safeOffset + safeLimit);
    return {
      processingKey,
      offset: safeOffset,
      limit: safeLimit,
      total: tokens.length,
      tokens: clone(page),
      hasMore: safeOffset + page.length < tokens.length,
      version: clone(result.version),
    };
  }

  async cleanup(olderThan: number): Promise<number> {
    let removed = 0;
    for (const [key, result] of this.results) {
      if (result.updatedAt >= olderThan) continue;
      this.results.delete(key);
      this.chunks.delete(key);
      removed += 1;
    }
    for (const [jobId, job] of this.jobs) {
      if (job.updatedAt < olderThan) {
        this.jobs.delete(jobId);
        removed += 1;
      }
    }
    return removed;
  }
}

const IDB_NAME = "plethora-language-processing";
const IDB_VERSION = 1;
const STORES = {
  jobs: "processing_jobs",
  chunks: "processing_chunks",
  tokens: "processing_tokens",
  results: "processing_results",
} as const;

interface StoredChunk {
  id: string;
  processingKey: string;
  chunkIndex: number;
  updatedAt: number;
  json: string;
}

interface StoredToken {
  id: string;
  processingKey: string;
  chunkIndex: number;
  tokenIndex: number;
  token: TokenSpan;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/**
 * Durable browser/PWA store. Analysis streams live in IndexedDB, never in
 * localStorage or reactive UI state. Tauri's SQLite migration mirrors these
 * four logical tables (see the migration artifact in src-tauri/migrations).
 */
export class IndexedDbLanguageProcessingStore implements LanguageProcessingStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORES.jobs)) {
          const store = database.createObjectStore(STORES.jobs, { keyPath: "jobId" });
          store.createIndex("by_updated_at", "updatedAt");
        }
        if (!database.objectStoreNames.contains(STORES.chunks)) {
          const store = database.createObjectStore(STORES.chunks, { keyPath: "id" });
          store.createIndex("by_processing_key", "processingKey");
          store.createIndex("by_updated_at", "updatedAt");
        }
        if (!database.objectStoreNames.contains(STORES.tokens)) {
          const store = database.createObjectStore(STORES.tokens, { keyPath: "id" });
          store.createIndex("by_processing_key", "processingKey");
        }
        if (!database.objectStoreNames.contains(STORES.results)) {
          const store = database.createObjectStore(STORES.results, { keyPath: "processingKey" });
          store.createIndex("by_updated_at", "updatedAt");
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => reject(request.error ?? new Error("Could not open language processing database"));
    });
    return this.dbPromise;
  }

  async getJob(jobId: string): Promise<ProcessingJobCheckpoint | null> {
    const database = await this.open();
    return requestResult(database.transaction(STORES.jobs, "readonly").objectStore(STORES.jobs).get(jobId));
  }

  async putJob(checkpoint: ProcessingJobCheckpoint): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORES.jobs, "readwrite");
    transaction.objectStore(STORES.jobs).put(checkpoint);
    await transactionDone(transaction);
  }

  async getChunks(processingKey: string): Promise<AnalysisChunk[]> {
    const database = await this.open();
    const transaction = database.transaction(STORES.chunks, "readonly");
    const rows = await requestResult(transaction.objectStore(STORES.chunks).index("by_processing_key").getAll(processingKey)) as StoredChunk[];
    return rows.sort((a, b) => a.chunkIndex - b.chunkIndex).map((row) => JSON.parse(row.json) as AnalysisChunk);
  }

  async putChunk(processingKey: string, chunk: AnalysisChunk): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction([STORES.chunks, STORES.tokens], "readwrite");
    const now = Date.now();
    const chunkStore = transaction.objectStore(STORES.chunks);
    const tokenStore = transaction.objectStore(STORES.tokens);
    const existingTokens = await requestResult(tokenStore.index("by_processing_key").getAll(processingKey)) as StoredToken[];
    for (const token of existingTokens) {
      if (token.chunkIndex === chunk.chunkIndex) tokenStore.delete(token.id);
    }
    chunkStore.put({
      id: `${processingKey}:${chunk.chunkIndex}`,
      processingKey,
      chunkIndex: chunk.chunkIndex,
      updatedAt: now,
      json: JSON.stringify(chunk),
    } satisfies StoredChunk);
    for (const [tokenIndex, token] of chunk.tokens.entries()) {
      tokenStore.put({
        id: `${processingKey}:${chunk.chunkIndex}:${tokenIndex}`,
        processingKey,
        chunkIndex: chunk.chunkIndex,
        tokenIndex,
        token,
      } satisfies StoredToken);
    }
    await transactionDone(transaction);
  }

  async getResult(processingKey: string): Promise<ProcessingResultRecord | null> {
    const database = await this.open();
    return requestResult(database.transaction(STORES.results, "readonly").objectStore(STORES.results).get(processingKey));
  }

  async putResult(result: ProcessingResultRecord): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORES.results, "readwrite");
    transaction.objectStore(STORES.results).put(result);
    await transactionDone(transaction);
  }

  async pageTokens(processingKey: string, offset: number, limit: number): Promise<AnalysisPage | null> {
    const [result, database] = await Promise.all([this.getResult(processingKey), this.open()]);
    if (!result) return null;
    const transaction = database.transaction(STORES.tokens, "readonly");
    const rows = await requestResult(transaction.objectStore(STORES.tokens).index("by_processing_key").getAll(processingKey)) as StoredToken[];
    rows.sort((a, b) => a.chunkIndex - b.chunkIndex || a.tokenIndex - b.tokenIndex);
    const safeOffset = Math.max(0, Math.floor(offset));
    const safeLimit = Math.max(1, Math.floor(limit));
    const tokens = rows.slice(safeOffset, safeOffset + safeLimit).map((row) => row.token);
    return {
      processingKey,
      offset: safeOffset,
      limit: safeLimit,
      total: rows.length,
      tokens,
      hasMore: safeOffset + tokens.length < rows.length,
      version: result.version,
    };
  }

  async cleanup(olderThan: number): Promise<number> {
    const database = await this.open();
    let removed = 0;
    const resultTransaction = database.transaction(STORES.results, "readwrite");
    const resultStore = resultTransaction.objectStore(STORES.results);
    const results = await requestResult(resultStore.index("by_updated_at").getAll(IDBKeyRange.upperBound(olderThan))) as ProcessingResultRecord[];
    const keysToDelete = new Set(results.map((result) => result.processingKey));
    for (const result of results) {
      resultStore.delete(result.processingKey);
      removed += 1;
    }
    await transactionDone(resultTransaction);

    const chunkTransaction = database.transaction([STORES.chunks, STORES.tokens], "readwrite");
    const chunks = await requestResult(chunkTransaction.objectStore(STORES.chunks).index("by_updated_at").getAll(IDBKeyRange.upperBound(olderThan))) as StoredChunk[];
    const allChunks = await requestResult(chunkTransaction.objectStore(STORES.chunks).index("by_processing_key").getAll()) as StoredChunk[];
    for (const chunk of allChunks) {
      if (keysToDelete.has(chunk.processingKey)) chunks.push(chunk);
    }
    for (const chunk of chunks) {
      chunkTransaction.objectStore(STORES.chunks).delete(chunk.id);
      for (const token of await requestResult(chunkTransaction.objectStore(STORES.tokens).index("by_processing_key").getAll(chunk.processingKey)) as StoredToken[]) {
        if (token.chunkIndex === chunk.chunkIndex) chunkTransaction.objectStore(STORES.tokens).delete(token.id);
      }
    }
    await transactionDone(chunkTransaction);
    return removed;
  }
}

export function createLanguageProcessingStore(): LanguageProcessingStore {
  if (typeof indexedDB !== "undefined") return new IndexedDbLanguageProcessingStore();
  return new MemoryLanguageProcessingStore();
}

/** Used by the coordinator when registering the equivalent SQLite migration. */
export const LANGUAGE_PROCESSING_SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS language_processing_jobs (
  job_id TEXT PRIMARY KEY,
  processing_key TEXT NOT NULL,
  state TEXT NOT NULL,
  next_chunk_index INTEGER NOT NULL,
  total_chunks INTEGER NOT NULL,
  completed_chunks INTEGER NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS language_processing_results (
  processing_key TEXT PRIMARY KEY,
  version_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS language_processing_chunks (
  processing_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  source_start INTEGER NOT NULL,
  source_end INTEGER NOT NULL,
  chunk_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (processing_key, chunk_index)
);
CREATE TABLE IF NOT EXISTS language_processing_tokens (
  processing_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  token_index INTEGER NOT NULL,
  token_id TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  token_json TEXT NOT NULL,
  PRIMARY KEY (processing_key, chunk_index, token_index)
);
CREATE INDEX IF NOT EXISTS idx_language_processing_tokens_page
  ON language_processing_tokens(processing_key, chunk_index, token_index);
CREATE INDEX IF NOT EXISTS idx_language_processing_jobs_updated
  ON language_processing_jobs(updated_at);
CREATE INDEX IF NOT EXISTS idx_language_processing_results_updated
  ON language_processing_results(updated_at);
`;

// Keep the imported type visible to TS consumers that use persistence records
// as a durable cache result without forcing them to import an implementation.
export type { JobState, LanguageAnalysisResult };
