import { describe, it, expect } from 'vitest';
import {
  translateAndFilterCandidates,
  buildQuotaReport,
} from '../generationMerge';
import type { QuestionBatchPlan } from '../evidencePlanner';
import type { ModelQuestionBatch, QuotaSlot } from '../../../../types/assessmentQuestions';

describe('Assessment Generation Merge and Deficit Calculation', () => {
  const mockPlan: QuestionBatchPlan = {
    batchIndex: 0,
    stepKey: 'batch_0',
    slots: [
      { slotKey: 'slot_1', slotIndex: 0, topicIndex: 0, kind: 'single-select', difficulty: 2 },
      { slotKey: 'slot_2', slotIndex: 1, topicIndex: 0, kind: 'short-answer', difficulty: 3 },
    ],
    sources: [{ handle: 's_0', title: 'Doc', excerpt: 'Text' }],
    sourceMap: { s_0: 'ref_1' },
    topicEvidence: [{ index: 0, title: 'Topic 1', conceptName: 'Concept 1', objectives: ['Obj 1'] }],
  };

  it('translates valid candidate and screens against duplicates', () => {
    const batch: ModelQuestionBatch = {
      schemaVersion: 1,
      questions: [
        {
          slotKey: 'slot_1',
          question: {
            kind: 'single-select',
            prompt: 'Question 1',
            learningObjectives: ['Obj 1'],
            explanation: 'Exp',
            sourceHandles: ['s_0'],
            applicationLevel: 'recall',
            hints: [],
            options: [
              { handle: 'h1', text: 'Option A' },
              { handle: 'h2', text: 'Option B' },
            ],
            correctOptionHandle: 'h1',
          },
        },
      ],
    };

    let count = 0;
    const res1 = translateAndFilterCandidates({
      batch,
      batchPlan: mockPlan,
      idGenerator: (p) => `${p}_${++count}`,
    });

    expect(res1.acceptedCandidates).toHaveLength(1);
    expect(res1.rejectedSlotKeys).toHaveLength(0);
    expect(res1.acceptedCandidates[0].question.kind).toBe('single-select');
    expect(res1.acceptedCandidates[0].question.sourceRefIds).toEqual(['ref_1']);

    // Second translation with same fingerprint should be detected as duplicate!
    const existing = new Set<string>([res1.acceptedCandidates[0].fingerprint]);
    const res2 = translateAndFilterCandidates({
      batch,
      batchPlan: mockPlan,
      existingFingerprints: existing,
    });

    expect(res2.acceptedCandidates).toHaveLength(0);
    expect(res2.rejectedSlotKeys).toEqual(['slot_1']);
    expect(res2.duplicateFingerprints).toHaveLength(1);
  });

  it('aggregates deficits correctly when 30 requested and 17 accepted', () => {
    // 30 slots total
    const slots: QuotaSlot[] = [];
    for (let i = 0; i < 30; i++) {
      slots.push({
        slotKey: `slot_${i}`,
        slotIndex: i,
        topicIndex: i % 3,
        kind: i % 2 === 0 ? 'single-select' : 'short-answer',
        difficulty: (1 + (i % 5)) as any,
      });
    }

    // Only 17 accepted
    const acceptedKeys = new Set<string>();
    for (let i = 0; i < 17; i++) {
      acceptedKeys.add(`slot_${i}`);
    }

    const report = buildQuotaReport(30, slots, acceptedKeys, [], [], false);

    expect(report.requested).toBe(30);
    expect(report.accepted).toBe(17);
    expect(report.shortfallAccepted).toBe(false);

    // Sum of deficits must equal 30 - 17 = 13
    const deficitSum = report.deficits.reduce((sum, d) => sum + d.count, 0);
    expect(deficitSum).toBe(13);
  });
});
