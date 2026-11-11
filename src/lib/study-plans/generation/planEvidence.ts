/**
 * Deterministic Evidence Planning and Batch Partitioning.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/01-ARCHITECTURE.md §3.2
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §3.3
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T02)
 */

import type { StudyDepth, StudySourceScopeV1 } from '../../../types/studySource';

export const EVIDENCE_LIMITS = {
  MAX_DOCUMENTS: 24,
  MAX_CONCEPT_SEEDS: 12,
  MAX_GLOBAL_HITS: 96,
  MAX_HANDLES_PER_BATCH: 12,
  MAX_CHARS_PER_BATCH: 18000,
  MAX_EXCERPT_CHARS: 1600,
  DEPTH_CAPS: {
    survey: 8,
    foundational: 16,
    deep: 24,
  } as Record<StudyDepth, number>,
} as const;

export interface EvidenceHandleItem {
  handle: string; // e.g. "src_h0", "src_h1"
  documentId: string;
  extractId?: string;
  documentTitle: string;
  sourceType: string;
  revision: string;
  excerpt: string;
  excerptSha256: string;
}

export interface EvidenceBatch {
  batchIndex: number;
  handles: EvidenceHandleItem[];
  totalChars: number;
}

export interface PlanEvidenceOptions {
  sourceScope?: StudySourceScopeV1;
  depth: StudyDepth;
  evidenceItems?: Array<{
    documentId: string;
    extractId?: string;
    documentTitle?: string;
    sourceType?: string;
    revision?: string;
    excerpt: string;
    excerptSha256?: string;
  }>;
}

/**
 * Normalizes, bounds, and groups evidence hits into model-safe batches.
 */
export function planEvidenceBatches(options: PlanEvidenceOptions): {
  batches: EvidenceBatch[];
  allHandles: EvidenceHandleItem[];
  handleMap: Map<string, EvidenceHandleItem>;
  maxNodesForDepth: number;
} {
  const maxNodesForDepth = EVIDENCE_LIMITS.DEPTH_CAPS[options.depth] || 16;
  const rawItems = options.evidenceItems || [];

  // Deduplicate and bound up to MAX_GLOBAL_HITS (96)
  const seenSignatures = new Set<string>();
  const boundedItems: EvidenceHandleItem[] = [];

  for (const item of rawItems) {
    if (boundedItems.length >= EVIDENCE_LIMITS.MAX_GLOBAL_HITS) break;

    const signature = `${item.documentId}:${item.extractId || ''}:${item.excerpt.trim()}`;
    if (seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);

    const handle = `src_h${boundedItems.length}`;
    boundedItems.push({
      handle,
      documentId: item.documentId,
      extractId: item.extractId,
      documentTitle: item.documentTitle || 'Untitled Source',
      sourceType: item.sourceType || 'document',
      revision: item.revision || 'unknown',
      excerpt: item.excerpt.slice(0, EVIDENCE_LIMITS.MAX_EXCERPT_CHARS), // respect excerpt limit
      excerptSha256: item.excerptSha256 || `sha256:${item.documentId}`,
    });
  }

  // Partition into batches of <=12 handles and <=18,000 chars
  const batches: EvidenceBatch[] = [];
  let currentBatchHandles: EvidenceHandleItem[] = [];
  let currentBatchChars = 0;

  for (const handleItem of boundedItems) {
    const itemChars = handleItem.excerpt.length;

    const wouldExceedHandleLimit =
      currentBatchHandles.length >= EVIDENCE_LIMITS.MAX_HANDLES_PER_BATCH;
    const wouldExceedCharLimit =
      currentBatchChars + itemChars > EVIDENCE_LIMITS.MAX_CHARS_PER_BATCH &&
      currentBatchHandles.length > 0;

    if (wouldExceedHandleLimit || wouldExceedCharLimit) {
      batches.push({
        batchIndex: batches.length,
        handles: currentBatchHandles,
        totalChars: currentBatchChars,
      });
      currentBatchHandles = [];
      currentBatchChars = 0;
    }

    currentBatchHandles.push(handleItem);
    currentBatchChars += itemChars;
  }

  if (currentBatchHandles.length > 0) {
    batches.push({
      batchIndex: batches.length,
      handles: currentBatchHandles,
      totalChars: currentBatchChars,
    });
  }

  const handleMap = new Map<string, EvidenceHandleItem>();
  for (const h of boundedItems) {
    handleMap.set(h.handle, h);
  }

  return {
    batches,
    allHandles: boundedItems,
    handleMap,
    maxNodesForDepth,
  };
}
