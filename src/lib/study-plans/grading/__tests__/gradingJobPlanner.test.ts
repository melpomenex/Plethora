import { describe, it, expect } from 'vitest';
import {
  findPendingGradingSubmissions,
  planGradingJob,
  isBlankResponse,
} from '../gradingJobPlanner';
import type {
  AttemptDetail,
  ResponseSubmission,
  GradeRecord,
} from '../../../../types/assessmentSessions';
import type {
  ShortAnswerQuestion,
  EssayQuestion,
  SingleSelectQuestion,
  AssessmentQuestionRevision,
} from '../../../../types/assessmentQuestions';

describe('gradingJobPlanner', () => {
  const shortAnswerQ: ShortAnswerQuestion = {
    schemaVersion: 1,
    kind: 'short-answer',
    prompt: 'What organelle produces ATP?',
    maxPoints: 4,
    sourceRefIds: ['ref_1'],
    difficulty: 3,
    applicationLevel: 'recall',
    hints: [],
    explanation: 'Produces ATP',
    learningObjectives: [],
    referenceAnswer: 'Mitochondria produces ATP through cellular respiration.',
    keyFacts: [{ id: 'kf_1', text: 'Mitochondria produces ATP', required: true }],
    acceptedAnswers: ['Mitochondria', 'Mitochondrion'],
    rubric: {
      schemaVersion: 1,
      expectedConcepts: ['ATP'],
      gradingConstraints: [],
      criteria: [
        {
          id: 'crit_1',
          title: 'Organelle Identity',
          assessmentInstruction: 'Identify organelle',
          grounding: 'reasoning',
          sourceRefIds: [],
          keyFactIds: [],
          weight: 1,
          levels: {
            0: 'Incorrect',
            1: 'Vague',
            2: 'Partially correct',
            3: 'Mostly correct',
            4: 'Fully correct',
          },
        },
      ],
    },
  };

  const essayQ: EssayQuestion = {
    schemaVersion: 1,
    kind: 'essay',
    prompt: 'Explain the process of glycolysis.',
    maxPoints: 8,
    sourceRefIds: ['ref_2'],
    difficulty: 4,
    applicationLevel: 'comprehension',
    hints: [],
    explanation: 'Glycolysis',
    learningObjectives: [],
    expectedReasoning: 'Glycolysis breaks down glucose into pyruvate...',
    rubric: {
      schemaVersion: 1,
      expectedConcepts: ['glycolysis', 'pyruvate'],
      gradingConstraints: [],
      criteria: [
        {
          id: 'crit_2',
          title: 'Pathway Steps',
          assessmentInstruction: 'Explain steps',
          grounding: 'reasoning',
          sourceRefIds: [],
          keyFactIds: [],
          weight: 2,
          levels: {
            0: 'Missing',
            1: 'Superficial',
            2: 'Adequate',
            3: 'Good',
            4: 'Exemplary',
          },
        },
      ],
    },
  };

  const selectQ: SingleSelectQuestion = {
    schemaVersion: 1,
    kind: 'single-select',
    prompt: 'Pick one',
    maxPoints: 1,
    sourceRefIds: [],
    difficulty: 1,
    applicationLevel: 'recall',
    hints: [],
    explanation: 'Choice',
    learningObjectives: [],
    options: [
      { id: 'opt_1', text: 'A' },
      { id: 'opt_2', text: 'B' },
    ],
    correctOptionId: 'opt_1',
  };

  const shortAnswerQRev: AssessmentQuestionRevision = {
    id: 'q_sa',
    questionId: 'qid_sa',
    blueprintRevisionId: 'bpr_1',
    revision: 1,
    slotKey: 'slot_1',
    fingerprint: 'fp_sa',
    question: shortAnswerQ,
    validation: 'valid',
    committedAt: '2026-11-10T12:00:00Z',
    provider: null,
    createdAt: '2026-11-10T12:00:00Z',
  };

  const essayQRev: AssessmentQuestionRevision = {
    id: 'q_essay',
    questionId: 'qid_essay',
    blueprintRevisionId: 'bpr_1',
    revision: 1,
    slotKey: 'slot_2',
    fingerprint: 'fp_essay',
    question: essayQ,
    validation: 'valid',
    committedAt: '2026-11-10T12:00:00Z',
    provider: null,
    createdAt: '2026-11-10T12:00:00Z',
  };

  const selectQRev: AssessmentQuestionRevision = {
    id: 'q_select',
    questionId: 'qid_select',
    blueprintRevisionId: 'bpr_1',
    revision: 1,
    slotKey: 'slot_3',
    fingerprint: 'fp_select',
    question: selectQ,
    validation: 'valid',
    committedAt: '2026-11-10T12:00:00Z',
    provider: null,
    createdAt: '2026-11-10T12:00:00Z',
  };

  const baseAttemptDetail: AttemptDetail = {
    attempt: {
      id: 'att_1',
      blueprintRevisionId: 'bpr_1',
      blueprintTitle: 'Test Exam',
      mode: 'exam',
      status: 'in-progress',
      startedAt: '2026-11-10T12:00:00Z',
      deadlineAt: null,
      submittedAt: null,
      completedAt: null,
      awardedPoints: null,
      maximumPoints: 13,
      clientStartKey: 'k_1',
      revision: 1,
      questionRevisionIds: ['q_sa', 'q_essay', 'q_select'],
      submissionReason: null,
      submissionKey: null,
      createdAt: '2026-11-10T12:00:00Z',
      updatedAt: '2026-11-10T12:00:00Z',
    },
    responses: [],
    submissions: [],
    currentGrades: [],
  };

  describe('isBlankResponse', () => {
    it('returns true for null/undefined/empty/whitespace responses', () => {
      expect(isBlankResponse(null)).toBe(true);
      expect(isBlankResponse(undefined)).toBe(true);
      expect(isBlankResponse({ kind: 'short-answer', text: '' })).toBe(true);
      expect(isBlankResponse({ kind: 'short-answer', text: '   ' })).toBe(true);
      expect(isBlankResponse({ kind: 'essay', text: '\n\t  ' })).toBe(true);
      expect(isBlankResponse({ kind: 'short-answer', text: 'Valid answer' })).toBe(false);
    });
  });

  describe('findPendingGradingSubmissions', () => {
    it('identifies nonblank non-exact subjective submissions without final grade', () => {
      const submissions: ResponseSubmission[] = [
        {
          id: 'sub_sa',
          responseId: 'resp_1',
          attemptId: 'att_1',
          questionRevisionId: 'q_sa',
          ordinal: 1,
          kind: 'exam-final',
          mark: 'answered',
          hintLevel: 0,
          response: { kind: 'short-answer', text: 'It generates ATP via the Krebs cycle in the inner membrane' },
          createdAt: '2026-11-10T12:05:00Z',
        },
        {
          id: 'sub_essay',
          responseId: 'resp_2',
          attemptId: 'att_1',
          questionRevisionId: 'q_essay',
          ordinal: 1,
          kind: 'exam-final',
          mark: 'answered',
          hintLevel: 0,
          response: { kind: 'essay', text: 'Glucose enters the cell and is phosphorylated...' },
          createdAt: '2026-11-10T12:10:00Z',
        },
        {
          id: 'sub_select',
          responseId: 'resp_3',
          attemptId: 'att_1',
          questionRevisionId: 'q_select',
          ordinal: 1,
          kind: 'exam-final',
          mark: 'answered',
          hintLevel: 0,
          response: { kind: 'single-select', optionId: 'opt_1' },
          createdAt: '2026-11-10T12:01:00Z',
        },
      ];

      const detail: AttemptDetail = {
        ...baseAttemptDetail,
        submissions,
      };

      const pending = findPendingGradingSubmissions(detail, [shortAnswerQRev, essayQRev, selectQRev]);
      expect(pending).toHaveLength(2);
      expect(pending.map((p) => p.submission.id)).toEqual(['sub_sa', 'sub_essay']);
    });

    it('omits exact acceptedAnswers for short-answer questions', () => {
      const submissions: ResponseSubmission[] = [
        {
          id: 'sub_exact',
          responseId: 'resp_1',
          attemptId: 'att_1',
          questionRevisionId: 'q_sa',
          ordinal: 1,
          kind: 'exam-final',
          mark: 'answered',
          hintLevel: 0,
          response: { kind: 'short-answer', text: 'mitochondria' }, // matches acceptedAnswers
          createdAt: '2026-11-10T12:02:00Z',
        },
      ];

      const detail: AttemptDetail = {
        ...baseAttemptDetail,
        submissions,
      };

      const pending = findPendingGradingSubmissions(detail, [shortAnswerQRev]);
      expect(pending).toHaveLength(0);
    });

    it('omits blank responses', () => {
      const submissions: ResponseSubmission[] = [
        {
          id: 'sub_blank',
          responseId: 'resp_1',
          attemptId: 'att_1',
          questionRevisionId: 'q_essay',
          ordinal: 1,
          kind: 'exam-final',
          mark: 'answered',
          hintLevel: 0,
          response: { kind: 'essay', text: '   ' },
          createdAt: '2026-11-10T12:02:00Z',
        },
      ];

      const detail: AttemptDetail = {
        ...baseAttemptDetail,
        submissions,
      };

      const pending = findPendingGradingSubmissions(detail, [essayQRev]);
      expect(pending).toHaveLength(0);
    });

    it('omits submissions that already have a final grade unless regrade is true', () => {
      const submissions: ResponseSubmission[] = [
        {
          id: 'sub_sa',
          responseId: 'resp_1',
          attemptId: 'att_1',
          questionRevisionId: 'q_sa',
          ordinal: 1,
          kind: 'exam-final',
          mark: 'answered',
          hintLevel: 0,
          response: { kind: 'short-answer', text: 'Mitochondrial matrix' },
          createdAt: '2026-11-10T12:05:00Z',
        },
      ];

      const currentGrades: GradeRecord[] = [
        {
          id: 'grd_1',
          responseSubmissionId: 'sub_sa',
          questionRevisionId: 'q_sa',
          origin: 'ai',
          state: 'final',
          points: 4,
          maxPoints: 4,
          assessment: null,
          criteria: [],
          provenance: null,
          manualReason: null,
          supersedesGradeId: null,
          isCurrent: true,
          createdAt: '2026-11-10T12:06:00Z',
        },
      ];

      const detail: AttemptDetail = {
        ...baseAttemptDetail,
        submissions,
        currentGrades,
      };

      // By default, skipped because already final
      const pendingDefault = findPendingGradingSubmissions(detail, [shortAnswerQRev]);
      expect(pendingDefault).toHaveLength(0);

      // With regrade: true, included
      const pendingRegrade = findPendingGradingSubmissions(detail, [shortAnswerQRev], { regrade: true });
      expect(pendingRegrade).toHaveLength(1);
    });
  });

  describe('planGradingJob', () => {
    it('returns null if there are no pending submissions', () => {
      const detail: AttemptDetail = { ...baseAttemptDetail, submissions: [] };
      const result = planGradingJob({
        attemptDetail: detail,
        questions: [shortAnswerQRev],
      });
      expect(result).toBeNull();
    });

    it('generates a durable job plan with steps and requestHash', () => {
      const submissions: ResponseSubmission[] = [
        {
          id: 'sub_sa',
          responseId: 'resp_1',
          attemptId: 'att_1',
          questionRevisionId: 'q_sa',
          ordinal: 1,
          kind: 'exam-final',
          mark: 'answered',
          hintLevel: 0,
          response: { kind: 'short-answer', text: 'Involved in cellular respiration' },
          createdAt: '2026-11-10T12:05:00Z',
        },
      ];

      const detail: AttemptDetail = {
        ...baseAttemptDetail,
        submissions,
      };

      const result = planGradingJob({
        attemptDetail: detail,
        questions: [shortAnswerQRev],
        creationKey: 'custom_creation_key_1',
      });

      expect(result).not.toBeNull();
      expect(result!.jobInput.kind).toBe('exam-grading');
      expect(result!.jobInput.targetId).toBe('att_1');
      expect(result!.jobInput.creationKey).toBe('custom_creation_key_1');
      expect(result!.jobInput.steps).toHaveLength(1);
      expect(result!.jobInput.steps[0].stepKey).toBe('grade:sub_sa');
      expect(result!.jobInput.steps[0].ordinal).toBe(0);
      expect(typeof result!.jobInput.requestHash).toBe('string');
      expect(result!.jobInput.requestHash.length).toBe(64);
    });
  });
});
