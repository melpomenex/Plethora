import { describe, it, expect } from 'vitest';
import {
  allocateLargestRemainder,
  planQuotaSlots,
  evaluateQuotaReport,
  calculateMaxQuestionModelCalls,
  computeSlotKey,
} from '../quotaPlanner';
import type {
  AssessmentConfigV1,
  AssessmentQuestionRevision,
  SingleSelectQuestion,
} from '../../../../types/assessmentQuestions';

describe('quotaPlanner', () => {
  describe('allocateLargestRemainder', () => {
    it('matches exact shared specification examples', () => {
      // Example 1: total 10, type weights [5, 2, 3, 0, 0] -> [5, 2, 3, 0, 0]
      const typeWeights = [
        { key: 'single-select', weight: 5 },
        { key: 'multi-select', weight: 2 },
        { key: 'cloze', weight: 3 },
      ];
      const result1 = allocateLargestRemainder(10, typeWeights, [
        'single-select',
        'multi-select',
        'cloze',
      ]);
      expect(result1.get('single-select')).toBe(5);
      expect(result1.get('multi-select')).toBe(2);
      expect(result1.get('cloze')).toBe(3);

      // Example 2: total 10, two equal topic weights -> [5, 5]
      const topicWeights = [
        { key: 0, weight: 1 },
        { key: 1, weight: 1 },
      ];
      const result2 = allocateLargestRemainder(10, topicWeights, [0, 1]);
      expect(result2.get(0)).toBe(5);
      expect(result2.get(1)).toBe(5);

      // Example 3: total 10, difficulty weights 1:0.2, 3:0.6, 5:0.2 -> counts {1:2, 3:6, 5:2}
      const diffWeights = [
        { key: 1, weight: 0.2 },
        { key: 3, weight: 0.6 },
        { key: 5, weight: 0.2 },
      ];
      const result3 = allocateLargestRemainder(10, diffWeights, [1, 3, 5]);
      expect(result3.get(1)).toBe(2);
      expect(result3.get(3)).toBe(6);
      expect(result3.get(5)).toBe(2);
    });

    it('breaks remainder ties using ascending stableKeys order', () => {
      // 3 items to distribute among 3 equal weights of 1
      // total = 4 => floor is 1 each, 1 remainder unit to distribute.
      // Ties broken by first in stable order: key 'A' gets 2, 'B' gets 1, 'C' gets 1.
      const entries = [
        { key: 'A', weight: 1 },
        { key: 'B', weight: 1 },
        { key: 'C', weight: 1 },
      ];
      const result = allocateLargestRemainder(4, entries, ['A', 'B', 'C']);
      expect(result.get('A')).toBe(2);
      expect(result.get('B')).toBe(1);
      expect(result.get('C')).toBe(1);
    });

    it('rejects all-zero or negative weights', () => {
      expect(() =>
        allocateLargestRemainder(10, [{ key: 'A', weight: 0 }], ['A'])
      ).toThrow('all_zero_weights');

      expect(() =>
        allocateLargestRemainder(10, [{ key: 'A', weight: -1 }], ['A'])
      ).toThrow('invalid_weight');
    });
  });

  describe('planQuotaSlots', () => {
    const validConfig: AssessmentConfigV1 = {
      schemaVersion: 1,
      mode: 'exam',
      requestedCount: 10,
      typeWeights: {
        'single-select': 5,
        'multi-select': 3,
        cloze: 2,
      },
      difficultyWeights: {
        1: 2,
        3: 6,
        5: 2,
      },
      topicTargets: [
        { nodeId: 'node-1', conceptId: null, weight: 1 },
        { nodeId: 'node-2', conceptId: null, weight: 1 },
      ],
      timeLimitSeconds: 1800,
      knowledgePolicy: 'source-only',
      excludedQuestionFingerprints: [],
      pointsByKind: {
        'single-select': 1,
        'multi-select': 1,
        cloze: 1,
        'short-answer': 2,
        essay: 8,
      },
    };

    it('generates exact marginal counts across all dimensions', () => {
      const slots = planQuotaSlots(validConfig, 'bp_rev_1');
      expect(slots).toHaveLength(10);

      // Check Kind marginals: 5 single-select, 3 multi-select, 2 cloze
      const kindCounts: Record<string, number> = {};
      for (const s of slots) {
        kindCounts[s.kind] = (kindCounts[s.kind] ?? 0) + 1;
      }
      expect(kindCounts['single-select']).toBe(5);
      expect(kindCounts['multi-select']).toBe(3);
      expect(kindCounts['cloze']).toBe(2);

      // Check Difficulty marginals: 2 diff-1, 6 diff-3, 2 diff-5
      const diffCounts: Record<number, number> = {};
      for (const s of slots) {
        diffCounts[s.difficulty] = (diffCounts[s.difficulty] ?? 0) + 1;
      }
      expect(diffCounts[1]).toBe(2);
      expect(diffCounts[3]).toBe(6);
      expect(diffCounts[5]).toBe(2);

      // Check Topic marginals: 5 topic-0, 5 topic-1
      const topicCounts: Record<number, number> = {};
      for (const s of slots) {
        topicCounts[s.topicIndex] = (topicCounts[s.topicIndex] ?? 0) + 1;
      }
      expect(topicCounts[0]).toBe(5);
      expect(topicCounts[1]).toBe(5);
    });

    it('hashes slotKey deterministically', () => {
      const key1 = computeSlotKey('rev_test', 0);
      const key2 = computeSlotKey('rev_test', 0);
      const key3 = computeSlotKey('rev_test', 1);

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('rejects requestedCount out of bounds (N=0, N=41)', () => {
      expect(() =>
        planQuotaSlots({ ...validConfig, requestedCount: 0 }, 'rev_1')
      ).toThrow('invalid_requested_count');

      expect(() =>
        planQuotaSlots({ ...validConfig, requestedCount: 41 }, 'rev_1')
      ).toThrow('invalid_requested_count');
    });
  });

  describe('evaluateQuotaReport and 30 -> 17 Shortfall Example', () => {
    it('accurately evaluates 30 -> 17 shortfall example', () => {
      const config30: AssessmentConfigV1 = {
        schemaVersion: 1,
        mode: 'exam',
        requestedCount: 30,
        typeWeights: { 'single-select': 1 },
        difficultyWeights: { 3: 1 },
        topicTargets: [{ nodeId: 'node-1', conceptId: null, weight: 1 }],
        timeLimitSeconds: null,
        knowledgePolicy: 'source-only',
        excludedQuestionFingerprints: [],
        pointsByKind: {
          'single-select': 1,
          'multi-select': 1,
          cloze: 1,
          'short-answer': 2,
          essay: 8,
        },
      };

      const slots = planQuotaSlots(config30, 'rev_30');
      expect(slots).toHaveLength(30);

      const dummyQuestion: SingleSelectQuestion = {
        schemaVersion: 1,
        kind: 'single-select',
        prompt: 'Sample',
        difficulty: 3,
        learningObjectives: ['obj'],
        sourceRefIds: ['src-1'],
        explanation: 'exp',
        maxPoints: 1,
        applicationLevel: 'recall',
        hints: [],
        options: [
          { id: 'opt-1', text: 'A' },
          { id: 'opt-2', text: 'B' },
        ],
        correctOptionId: 'opt-1',
      };

      // Only 17 slots have accepted valid questions
      const acceptedQuestions: AssessmentQuestionRevision[] = slots.slice(0, 17).map((s, idx) => ({
        id: `aqr_${idx}`,
        questionId: `aq_${idx}`,
        blueprintRevisionId: 'rev_30',
        revision: 1,
        slotKey: s.slotKey,
        fingerprint: `fp_${idx}`,
        question: dummyQuestion,
        validation: 'valid',
        committedAt: null,
        provider: null,
        createdAt: '2026-11-10T00:00:00Z',
      }));

      // When shortfall is NOT accepted: returns deficit issue
      const unacceptedReport = evaluateQuotaReport(slots, acceptedQuestions, false);
      expect(unacceptedReport.requested).toBe(30);
      expect(unacceptedReport.accepted).toBe(17);
      expect(unacceptedReport.shortfallAccepted).toBe(false);

      const totalDeficits = unacceptedReport.deficits.reduce((sum, d) => sum + d.count, 0);
      expect(totalDeficits).toBe(13); // 30 - 17 = 13
      expect(unacceptedReport.validationIssues.some((i) => i.code === 'quota_shortfall')).toBe(true);

      // When shortfall IS accepted: no shortfall validation issue
      const acceptedReport = evaluateQuotaReport(slots, acceptedQuestions, true);
      expect(acceptedReport.shortfallAccepted).toBe(true);
      expect(acceptedReport.validationIssues.some((i) => i.code === 'quota_shortfall')).toBe(false);
    });
  });

  describe('calculateMaxQuestionModelCalls', () => {
    it('computes 2 * ceil(N / batchSize)', () => {
      // Desktop batchSize = 4
      expect(calculateMaxQuestionModelCalls(10, false)).toBe(6); // 2 * ceil(10/4) = 2 * 3 = 6
      expect(calculateMaxQuestionModelCalls(30, false)).toBe(16); // 2 * ceil(30/4) = 2 * 8 = 16

      // Mobile batchSize = 2
      expect(calculateMaxQuestionModelCalls(10, true)).toBe(10); // 2 * ceil(10/2) = 2 * 5 = 10
    });
  });
});
