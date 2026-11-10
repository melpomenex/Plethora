import { describe, it, expect } from 'vitest';
import {
  resolveBatchSize,
  calculateModelCallBudget,
  planQuestionBatches,
  DESKTOP_BATCH_SIZE,
  MOBILE_BATCH_SIZE,
} from '../evidencePlanner';
import type { QuotaSlot } from '../../../../types/assessmentQuestions';
import type { StudySourceRefV1 } from '../../../../types/studySource';

describe('Assessment Evidence Planner', () => {
  it('resolves desktop and mobile batch sizes correctly', () => {
    expect(resolveBatchSize(false)).toBe(DESKTOP_BATCH_SIZE); // 4
    expect(resolveBatchSize(true)).toBe(MOBILE_BATCH_SIZE); // 2
  });

  it('calculates model call budget as 2 * ceil(N / batchSize)', () => {
    expect(calculateModelCallBudget(0, 4)).toBe(0);
    expect(calculateModelCallBudget(1, 4)).toBe(2); // 2 * ceil(1/4) = 2 * 1 = 2
    expect(calculateModelCallBudget(4, 4)).toBe(2); // 2 * ceil(4/4) = 2 * 1 = 2
    expect(calculateModelCallBudget(5, 4)).toBe(4); // 2 * ceil(5/4) = 2 * 2 = 4
    expect(calculateModelCallBudget(10, 4)).toBe(6); // 2 * ceil(10/4) = 2 * 3 = 6
    expect(calculateModelCallBudget(30, 4)).toBe(16); // 2 * ceil(30/4) = 2 * 8 = 16
    expect(calculateModelCallBudget(10, 2)).toBe(10); // mobile: 2 * ceil(10/2) = 10
  });

  it('plans batches partitioning slots and mapping local source handles', () => {
    const slots: QuotaSlot[] = [
      { slotKey: 's1', slotIndex: 0, topicIndex: 0, kind: 'single-select', difficulty: 2 },
      { slotKey: 's2', slotIndex: 1, topicIndex: 0, kind: 'multi-select', difficulty: 3 },
      { slotKey: 's3', slotIndex: 2, topicIndex: 1, kind: 'cloze', difficulty: 2 },
      { slotKey: 's4', slotIndex: 3, topicIndex: 1, kind: 'short-answer', difficulty: 4 },
      { slotKey: 's5', slotIndex: 4, topicIndex: 1, kind: 'essay', difficulty: 5 },
    ];

    const sourceRefs: StudySourceRefV1[] = [
      {
        schemaVersion: 1,
        id: 'ref_1',
        documentId: 'doc_1',
        documentTitle: 'Distributed Systems',
        excerpt: 'Consensus is fundamental.',
        excerptSha256: 'sha256:e1',
        revision: 'rev_1',
        revisionKind: 'content-hash',
        sourceType: 'pdf',
        capturedAt: '2026-11-10T12:00:00Z',
      },
      {
        schemaVersion: 1,
        id: 'ref_2',
        documentId: 'doc_2',
        documentTitle: 'Raft Paper',
        excerpt: 'Raft is understandable.',
        excerptSha256: 'sha256:e2',
        revision: 'rev_2',
        revisionKind: 'content-hash',
        sourceType: 'pdf',
        capturedAt: '2026-11-10T12:00:00Z',
      },
    ];

    const batches = planQuestionBatches({
      slots,
      sourceRefs,
      topicTargets: [
        { nodeId: 'n1', conceptId: 'c1', weight: 1 },
        { nodeId: 'n2', conceptId: 'c2', weight: 1 },
      ],
      maxBatchSize: 4,
    });

    expect(batches).toHaveLength(2);

    // Batch 0 (slots 0..3)
    expect(batches[0].batchIndex).toBe(0);
    expect(batches[0].slots).toHaveLength(4);
    expect(batches[0].sources).toHaveLength(2);
    expect(batches[0].sources[0].handle).toBe('s_0');
    expect(batches[0].sources[1].handle).toBe('s_1');
    expect(batches[0].sourceMap['s_0']).toBe('ref_1');
    expect(batches[0].sourceMap['s_1']).toBe('ref_2');

    // Batch 1 (slot 4)
    expect(batches[1].batchIndex).toBe(1);
    expect(batches[1].slots).toHaveLength(1);
    expect(batches[1].slots[0].slotKey).toBe('s5');
  });
});
