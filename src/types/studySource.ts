/**
 * Canonical Study Source DTOs and Contracts.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §2
 * - openspec/changes/establish-persistent-study-plans/
 */

import type { ExactSearchHitLocation } from './searchHit';

export type StudyDepth = 'survey' | 'foundational' | 'deep';

export type LessonStyle = 'guided' | 'explain-check' | 'challenge';
export type KnowledgePolicy = 'source-only' | 'source-plus-model-knowledge' | 'model-only';

export interface SelectedSourceScope {
  documentIds: string[]; // unique, max 24 after resolution
  extractIds: string[]; // unique, max 200
  collectionIds: string[]; // user selection inputs, not dynamic query authority
  tagIds: string[];
}

export interface ResolvedSourceDocument {
  documentId: string;
  title: string;
  sourceType: string;
  revision: string; // contentHash, else dateModified; never blank
  revisionKind: 'content-hash' | 'modified-at' | 'unknown';
  extractIds: string[];
  isAiExcluded: boolean;
  isLocalOnly: boolean;
}

export interface StudySourceScopeV1 {
  schemaVersion: 1;
  selected: SelectedSourceScope;
  resolvedDocuments: ResolvedSourceDocument[]; // sorted by documentId at freeze
  frozenAt: string;
  indexCompleteness: 'complete' | 'partial' | 'unavailable';
  limitations: string[]; // coverage-v1 limitation keys plus study-specific keys
}

export interface StudySourceChunk {
  chunkId: string;
  ordinal: number;
  startOffset: number;
  endOffset: number;
}

export interface StudySourceRefInput {
  documentId: string;
  extractId?: string;
  excerpt: string; // 1..1600 chars; exact live text before whitespace normalization
  excerptSha256?: string; // recomputed by application, model value ignored
  revision?: string; // recomputed from live source, model value ignored
  revisionKind?: 'content-hash' | 'modified-at' | 'unknown';
  documentTitle?: string; // snapshot refreshed from live source
  sourceType?: string;
  jump?: ExactSearchHitLocation;
  chunk?: StudySourceChunk;
  sectionLabel?: string;
}

export interface StudySourceRefV1 {
  schemaVersion: 1;
  id: string;
  documentId: string;
  excerpt: string; // 1..1600 chars
  revision: string;
  revisionKind: 'content-hash' | 'modified-at' | 'unknown';
  excerptSha256: string; // sha256:<64 hex>
  documentTitle: string;
  sourceType: string;
  capturedAt: string;
  extractId?: string;
  jump?: ExactSearchHitLocation;
  chunk?: StudySourceChunk;
  sectionLabel?: string;
}

export interface StudySourceResolution {
  ref: StudySourceRefV1;
  status: 'current' | 'stale' | 'missing' | 'ambiguous' | 'unsupported';
  navigation: 'exact' | 'coarse' | 'unavailable';
  reasonKey?: string;
}
