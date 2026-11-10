import { describe, it, expect } from 'vitest';
import { screenQuestionDuplicates } from '../questionDuplicates';
import { computeQuestionFingerprint } from '../questionFingerprint';
import type {
  AssessmentQuestionRevision,
  SingleSelectQuestion,
} from '../../../../types/assessmentQuestions';

describe('questionDuplicates', () => {
  const baseQuestion: SingleSelectQuestion = {
    schemaVersion: 1,
    kind: 'single-select',
    prompt: 'In distributed computing systems, which fault-tolerant consensus algorithm does the Raft protocol implement in order to ensure consistent replicated state machine execution across clusters?',
    difficulty: 2,
    learningObjectives: ['Recall consensus'],
    sourceRefIds: ['src-1'],
    explanation: 'Raft implements consensus for replicated state machines.',
    maxPoints: 1,
    applicationLevel: 'recall',
    hints: [],
    options: [
      { id: 'opt-1', text: 'Consensus' },
      { id: 'opt-2', text: 'Sorting' },
    ],
    correctOptionId: 'opt-1',
  };

  const fpBase = computeQuestionFingerprint(baseQuestion);

  it('detects exact fingerprint duplicate across revisions', () => {
    const rev1: AssessmentQuestionRevision = {
      id: 'rev_1',
      questionId: 'q_1',
      blueprintRevisionId: 'bp_1',
      revision: 1,
      slotKey: 'slot_1',
      fingerprint: fpBase,
      question: baseQuestion,
      validation: 'valid',
      committedAt: null,
      provider: null,
      createdAt: '2026-11-10T00:00:00Z',
    };

    const rev2: AssessmentQuestionRevision = {
      ...rev1,
      id: 'rev_2',
      questionId: 'q_2',
      slotKey: 'slot_2',
    };

    const report = screenQuestionDuplicates([rev1, rev2]);
    expect(report.exactDuplicates).toHaveLength(1);
    expect(report.exactDuplicates[0].questionRevisionIds).toEqual(['rev_1', 'rev_2']);
    expect(report.issues.some((i) => i.code === 'duplicate_question_fingerprint')).toBe(true);
  });

  it('flags retake repeat when question fingerprint is in excludedQuestionFingerprints', () => {
    const rev: AssessmentQuestionRevision = {
      id: 'rev_1',
      questionId: 'q_1',
      blueprintRevisionId: 'bp_1',
      revision: 1,
      slotKey: 'slot_1',
      fingerprint: fpBase,
      question: baseQuestion,
      validation: 'valid',
      committedAt: null,
      provider: null,
      createdAt: '2026-11-10T00:00:00Z',
    };

    const report = screenQuestionDuplicates([rev], [fpBase]);
    expect(report.excludedRepeats).toHaveLength(1);
    expect(report.excludedRepeats[0].questionRevisionId).toBe('rev_1');
    expect(report.issues.some((i) => i.code === 'excluded_question_repeat')).toBe(true);
  });

  it('detects near-duplicate questions based on 3-gram similarity', () => {
    const rev1: AssessmentQuestionRevision = {
      id: 'rev_1',
      questionId: 'q_1',
      blueprintRevisionId: 'bp_1',
      revision: 1,
      slotKey: 'slot_1',
      fingerprint: fpBase,
      question: baseQuestion,
      validation: 'valid',
      committedAt: null,
      provider: null,
      createdAt: '2026-11-10T00:00:00Z',
    };

    const nearQuestion: SingleSelectQuestion = {
      ...baseQuestion,
      prompt: 'In distributed computing systems, which fault-tolerant consensus algorithm does the Raft protocol implement in order to ensure consistent replicated state machine execution across nodes?',
      options: [
        { id: 'opt-a', text: 'Consensus' },
        { id: 'opt-b', text: 'Sorting' },
      ],
      correctOptionId: 'opt-a',
    };

    const rev2: AssessmentQuestionRevision = {
      id: 'rev_2',
      questionId: 'q_2',
      blueprintRevisionId: 'bp_1',
      revision: 1,
      slotKey: 'slot_2',
      fingerprint: computeQuestionFingerprint(nearQuestion),
      question: nearQuestion,
      validation: 'valid',
      committedAt: null,
      provider: null,
      createdAt: '2026-11-10T00:00:00Z',
    };

    const report = screenQuestionDuplicates([rev1, rev2]);
    expect(report.nearDuplicates).toHaveLength(1);
    expect(report.nearDuplicates[0].questionIdA).toBe('rev_1');
    expect(report.nearDuplicates[0].questionIdB).toBe('rev_2');
    expect(report.nearDuplicates[0].similarity).toBeGreaterThanOrEqual(0.85);
    expect(report.issues.some((i) => i.code === 'near_duplicate_question')).toBe(true);
  });
});
