/**
 * Unit tests for Evidence Planning & Partitioning (C2-T02).
 */

import { describe, it, expect } from 'vitest';
import { planEvidenceBatches, EVIDENCE_LIMITS } from '../planEvidence';
import type { StudySourceScopeV1 } from '../../../../types/studySource';

describe('Evidence Planning & Partitioning', () => {
  const dummyScope: StudySourceScopeV1 = {
    schemaVersion: 1,
    selected: { documentIds: ['doc-1'], extractIds: [], collectionIds: [], tagIds: [] },
    resolvedDocuments: [
      {
        documentId: 'doc-1',
        title: 'Deep Learning',
        sourceType: 'pdf',
        revision: 'rev-1',
        revisionKind: 'content-hash',
        extractIds: [],
        isAiExcluded: false,
        isLocalOnly: false,
      },
    ],
    frozenAt: '2026-03-31T00:00:00Z',
    indexCompleteness: 'complete',
    limitations: [],
  };

  it('bounds items to depth caps (8 for survey, 16 for foundational, 24 for deep)', () => {
    expect(planEvidenceBatches({ sourceScope: dummyScope, depth: 'survey' }).maxNodesForDepth).toBe(8);
    expect(planEvidenceBatches({ sourceScope: dummyScope, depth: 'foundational' }).maxNodesForDepth).toBe(16);
    expect(planEvidenceBatches({ sourceScope: dummyScope, depth: 'deep' }).maxNodesForDepth).toBe(24);
  });

  it('partitions evidence items into batches respecting 12-handle and 18,000-char limits', () => {
    // Generate 25 evidence items (exceeds single batch of 12 handles)
    const items = Array.from({ length: 25 }).map((_, i) => ({
      documentId: `doc-${i % 3}`,
      excerpt: `Excerpt for concept item number ${i} describing critical learning points.`,
      documentTitle: `Doc Title ${i % 3}`,
    }));

    const result = planEvidenceBatches({
      sourceScope: dummyScope,
      depth: 'foundational',
      evidenceItems: items,
    });

    expect(result.allHandles).toHaveLength(25);
    expect(result.batches.length).toBeGreaterThanOrEqual(3); // 12 + 12 + 1 = 25 items -> 3 batches
    expect(result.batches[0].handles.length).toBeLessThanOrEqual(EVIDENCE_LIMITS.MAX_HANDLES_PER_BATCH);
    expect(result.batches[0].totalChars).toBeLessThanOrEqual(EVIDENCE_LIMITS.MAX_CHARS_PER_BATCH);
    expect(result.allHandles[0].handle).toBe('src_h0');
    expect(result.allHandles[24].handle).toBe('src_h24');
  });

  it('caps global hits at MAX_GLOBAL_HITS (96)', () => {
    const items = Array.from({ length: 120 }).map((_, i) => ({
      documentId: `doc-${i}`,
      excerpt: `Excerpt ${i}`,
    }));

    const result = planEvidenceBatches({
      sourceScope: dummyScope,
      depth: 'deep',
      evidenceItems: items,
    });

    expect(result.allHandles).toHaveLength(96);
  });
});
