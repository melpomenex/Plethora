/**
 * AI learning semantic memory API (OpenSpec change
 * `add-ondevice-ai-learning-system`, Phase 3).
 *
 * Wraps the backend `ai_learning_*` commands: background indexing lifecycle
 * (enqueue/pause/resume/cancel/reset, aggregate + per-document status) and
 * retrieval with lexical fallback (`retrieve(query, k, filters)`).
 *
 * The embedding config shape mirrors `EmbeddingConfigInput` on the backend;
 * the type and its settings-backed builder live here since the legacy
 * `rag_*` commands were retired (their `document_chunk_embeddings` table was
 * folded into `semantic_chunks` / `semantic_chunk_embeddings` by migration
 * 085). When no config is passed, the backend uses the on-device embedding
 * stub (offline-first default) and retrieval runs lexical-only until the
 * Kotlin embedding backend lands (task 4.5).
 */

import { invokeCommand } from "../lib/tauri";
import type { EmbeddingSettings } from "../types/settings";
import { useSettingsStore } from "../stores/settingsStore";

/** Maps to `EmbeddingConfigInput` on the backend. */
export interface EmbeddingConfig {
  provider: "OpenAI" | "Cohere" | "OpenRouter" | "Ollama";
  openaiApiKey?: string;
  openaiModel?: string;
  cohereApiKey?: string;
  cohereModel?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
}

/**
 * Build an `EmbeddingConfig` from the user's persisted embedding settings plus
 * a resolved API key. Falls back to whatever the settings specify; cloud
 * providers without a key will surface a backend error at call time.
 */
export function buildEmbeddingConfig(
  settings: EmbeddingSettings,
  keys: { openai?: string; cohere?: string; openrouter?: string } = {}
): EmbeddingConfig {
  const providerMap = {
    openai: "OpenAI",
    cohere: "Cohere",
    openrouter: "OpenRouter",
    ollama: "Ollama",
  } as const;

  return {
    provider: providerMap[settings.provider],
    openaiApiKey: keys.openai,
    openaiModel: settings.openaiModel,
    cohereApiKey: keys.cohere,
    cohereModel: settings.cohereModel,
    openrouterApiKey: keys.openrouter,
    openrouterModel: settings.openrouterModel,
    ollamaBaseUrl: settings.ollamaBaseUrl,
    ollamaModel: settings.ollamaModel,
  };
}

/** Location payload for navigating back to a chunk's origin (design D13). */
export interface ChunkLocation {
  sourceType: "pdf" | "epub" | "html" | "markdown" | "text" | "fts";
  documentId: string;
  ordinal: number;
  startOffset: number;
  endOffset: number;
  headingPath?: string[];
  pageNumber?: number;
  /** EPUB CFI range — TS-enriched extension point (not set by Rust yet). */
  cfiRange?: string;
  spineIndex?: number;
  pageRects?: unknown;
  extractId?: string;
  anchorId?: string;
}

export type SemanticSourceType =
  | "document"
  | "extract"
  | "annotation"
  | "card";

export interface RetrievalResult {
  chunkId: string;
  documentId: string;
  documentTitle?: string;
  sourceType: SemanticSourceType | string;
  sourceId?: string;
  ordinal: number;
  text: string;
  headingPath: string[];
  location: ChunkLocation;
  contentHash: string;
  tokenCount: number;
  /** Cosine similarity (semantic) or normalized bm25 (lexicalOnly). */
  score: number;
  mode: "semantic" | "lexicalOnly";
}

export interface RetrievalFilters {
  documentIds?: string[];
  sourceTypes?: SemanticSourceType[];
}

export interface RetrievalResponse {
  results: RetrievalResult[];
  mode: "semantic" | "lexicalOnly";
  candidatesScanned: number;
}

export interface EmbeddingModelUsage {
  model: string;
  embeddingVersion: number;
  chunks: number;
}

export interface AggregateIndexStatus {
  totalDocuments: number;
  indexedDocuments: number;
  queuedDocuments: number;
  indexingDocuments: number;
  staleDocuments: number;
  failedDocuments: number;
  totalChunks: number;
  totalEmbeddings: number;
  embeddingStorageBytes: number;
  embeddingModels: EmbeddingModelUsage[];
  paused: boolean;
  activeDocument?: string;
  pendingDocuments: number;
}

export interface DocumentIndexStatus {
  documentId: string;
  state: "unindexed" | "queued" | "indexing" | "indexed" | "stale" | "failed";
  embeddingVersion?: number;
  chunksIndexed: number;
  totalChunks: number;
  error?: string;
  updatedAt: string;
}

export interface IndexStatusResponse {
  aggregate: AggregateIndexStatus;
  documents: DocumentIndexStatus[];
}

/** Default top-k when `retrieve` is called without one (matches Rust). */
export const DEFAULT_RETRIEVAL_K = 8;

/**
 * The persisted paid-embeddings consent flag (ai-billing-safety #14), passed
 * to every billable embedding command so the backend can defensively reject a
 * cloud provider when the user has not explicitly enabled paid embeddings.
 */
export function paidEmbeddingsConsentFlag(): boolean {
  return useSettingsStore.getState().settings.embedding.paidEmbeddingsEnabled === true;
}

/**
 * Enqueue one document for (re)indexing. Call on import and on content
 * update; unchanged content is a no-op thanks to content-hash diffing.
 */
export function enqueueAIDocument(
  documentId: string,
  config?: EmbeddingConfig
): Promise<void> {
  return invokeCommand("ai_learning_enqueue_document", {
    documentId,
    document_id: documentId,
    config: config ?? null,
    paidEmbeddingsEnabled: paidEmbeddingsConsentFlag(),
    paid_embeddings_enabled: paidEmbeddingsConsentFlag(),
  });
}

/**
 * Bulk backfill the library. `requireCharging` (default true) parks the
 * queue paused when the device is not charging (design D14).
 */
export function enqueueAllAIDocuments(
  requireCharging = true,
  config?: EmbeddingConfig
): Promise<void> {
  return invokeCommand("ai_learning_enqueue_all", {
    requireCharging,
    require_charging: requireCharging,
    config: config ?? null,
    paidEmbeddingsEnabled: paidEmbeddingsConsentFlag(),
    paid_embeddings_enabled: paidEmbeddingsConsentFlag(),
  });
}

/** Aggregate + per-document index status for the settings panel. */
export function getAIIndexStatus(
  config?: EmbeddingConfig
): Promise<IndexStatusResponse> {
  return invokeCommand("ai_learning_index_status", {
    config: config ?? null,
    paidEmbeddingsEnabled: paidEmbeddingsConsentFlag(),
  });
}

/** Pause the background indexer (safe mid-document). */
export function pauseAIIndexing(): Promise<void> {
  return invokeCommand("ai_learning_index_pause");
}

/** Resume a paused indexer. */
export function resumeAIIndexing(): Promise<void> {
  return invokeCommand("ai_learning_index_resume");
}

/** Cancel a queued/running document index job. */
export function cancelAIDocumentIndexing(documentId: string): Promise<void> {
  return invokeCommand("ai_learning_index_cancel", {
    documentId,
    document_id: documentId,
  });
}

/** Wipe the rebuildable index; user content is untouched. */
export function resetAIIndex(): Promise<number> {
  return invokeCommand("ai_learning_reset_index");
}

/**
 * Retrieve the top-k chunks for a query. Returns lexical-only results when
 * no embedding backend is available or the index has no current-version
 * embeddings (mode `lexicalOnly` instead of an error).
 */
export function retrieveFromLibrary(
  query: string,
  options: {
    k?: number;
    filters?: RetrievalFilters;
    config?: EmbeddingConfig;
  } = {}
): Promise<RetrievalResponse> {
  return invokeCommand("ai_learning_retrieve", {
    query,
    k: options.k ?? null,
    filters: options.filters ?? null,
    config: options.config ?? null,
    paidEmbeddingsEnabled: paidEmbeddingsConsentFlag(),
    paid_embeddings_enabled: paidEmbeddingsConsentFlag(),
  });
}

/**
 * Deletion sync for extra sources (task 4.7): drop the single chunk of a
 * deleted extract/annotation/card without reindexing its document.
 */
export function removeSourceChunks(
  sourceType: SemanticSourceType,
  sourceId: string
): Promise<number> {
  return invokeCommand("ai_learning_remove_source_chunks", {
    sourceType,
    source_type: sourceType,
    sourceId,
    source_id: sourceId,
  });
}
