import type { Document } from './document';
import { isCloudEligible } from './privacy';

export type SourceKind = 'document' | 'extract' | 'note' | 'annotation' | 'card';

export interface RagLocator {
  type: 'pdf' | 'epub' | 'video' | 'extract' | 'note';
  page?: number;
  wordAnchor?: string;
  cfi?: string;
  timestampSeconds?: number;
  extractId?: string;
}

export interface RagCitation {
  documentId: string;
  chunkId: string;
  quote: string;
  locator: RagLocator;
  score: number;
}

export interface RagHit {
  id: string;
  documentId: string;
  sourceKind: SourceKind;
  text: string;
  score: number;
  locator?: RagLocator;
  metadata?: Record<string, unknown>;
}

export interface RagQueryOptions {
  query: string;
  topK?: number;
  filters?: {
    collectionId?: string;
    sourceKinds?: SourceKind[];
    tags?: string[];
  };
  rerank?: boolean;
}

export interface RagQueryResult {
  hits: RagHit[];
  fusedFrom: {
    lexical: number;
    vector: number;
  };
  reranked: boolean;
  elapsedMs: number;
}

export function buildPdfAnchorLocator(page: number, wordAnchor?: string): RagLocator {
  return {
    type: 'pdf',
    page,
    wordAnchor,
  };
}

export function buildEpubCfiLocator(cfi: string): RagLocator {
  return {
    type: 'epub',
    cfi,
  };
}

export function buildVideoTimestampLocator(timestampSeconds: number): RagLocator {
  return {
    type: 'video',
    timestampSeconds,
  };
}

export function buildExtractLocator(extractId: string): RagLocator {
  return {
    type: 'extract',
    extractId,
  };
}

/**
 * Ensures that a document is eligible before sending chunks to remote cloud embedding jobs.
 * Local-only documents are strictly filtered out.
 */
export function filterCloudEmbeddingCandidates(documents: Document[]): Document[] {
  return documents.filter((doc) => isCloudEligible(doc));
}
