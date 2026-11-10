import { describe, expect, it } from 'vitest';
import {
  calculateAttemptScoreSummary,
  formatDisplayPoints,
  roundDisplayPoints,
} from '../attemptScoring';
import type { AssessmentQuestionRevision } from '../../../../types/assessmentQuestions';
import type { ObjectiveGradeOutput } from '../../../../types/assessmentSessions';

describe('attemptScoring', () => {
  const dummyQuestion = (id: string, maxPoints: number): AssessmentQuestionRevision => ({
    id,
    questionId: `q_${id}`,
    blueprintRevisionId: 'bp_rev_1',
    revision: 1,
    slotKey: `slot_${id}`,
    fingerprint: `fp_${id}`,
    question: {
      schemaVersion: 1,
      kind: 'single-select',
      prompt: `Prompt ${id}`,
      difficulty: 2,
      learningObjectives: [],
      sourceRefIds: [],
      explanation: '',
      maxPoints,
      applicationLevel: 'recall',
      hints: [],
      options: [],
      correctOptionId: 'opt',
    },
    validation: 'valid',
    committedAt: '2026-11-10T00:00:00Z',
    provider: null,
    createdAt: '2026-11-10T00:00:00Z',
  });

  describe('calculateAttemptScoreSummary', () => {
    it('computes full total and marks complete when all questions are final', () => {
      const qRevs = [dummyQuestion('q1', 2), dummyQuestion('q2', 3), dummyQuestion('q3', 5)];
      const grades: ObjectiveGradeOutput[] = [
        {
          questionRevisionId: 'q1',
          origin: 'deterministic',
          state: 'final',
          points: 2,
          maxPoints: 2,
          outcome: 'correct',
        },
        {
          questionRevisionId: 'q2',
          origin: 'deterministic',
          state: 'final',
          points: 1.5,
          maxPoints: 3,
          outcome: 'partial',
        },
        {
          questionRevisionId: 'q3',
          origin: 'deterministic',
          state: 'final',
          points: 5,
          maxPoints: 5,
          outcome: 'correct',
        },
      ];

      const summary = calculateAttemptScoreSummary('att_1', qRevs, grades);
      expect(summary.totalQuestions).toBe(3);
      expect(summary.finalQuestions).toBe(3);
      expect(summary.isFullyFinal).toBe(true);
      expect(summary.maximumPoints).toBe(10);
      expect(summary.awardedPoints).toBe(8.5);
      expect(summary.provisionalObjectivePoints).toBe(8.5);
      expect(summary.derivedStatus).toBe('complete');
    });

    it('keeps awardedPoints null when any question is pending or needs-review', () => {
      const qRevs = [dummyQuestion('q1', 2), dummyQuestion('q2', 8)];
      const grades: ObjectiveGradeOutput[] = [
        {
          questionRevisionId: 'q1',
          origin: 'deterministic',
          state: 'final',
          points: 2,
          maxPoints: 2,
          outcome: 'correct',
        },
        {
          questionRevisionId: 'q2',
          origin: 'ai',
          state: 'needs-review',
          points: null,
          maxPoints: 8,
          outcome: 'pending',
        },
      ];

      const summary = calculateAttemptScoreSummary('att_2', qRevs, grades);
      expect(summary.isFullyFinal).toBe(false);
      expect(summary.awardedPoints).toBeNull();
      expect(summary.provisionalObjectivePoints).toBe(2);
      expect(summary.needsReviewQuestions).toBe(1);
      expect(summary.derivedStatus).toBe('partially-graded');
    });

    it('derives grading-failed when a question has failed state', () => {
      const qRevs = [dummyQuestion('q1', 2), dummyQuestion('q2', 4)];
      const grades: ObjectiveGradeOutput[] = [
        {
          questionRevisionId: 'q1',
          origin: 'deterministic',
          state: 'final',
          points: 2,
          maxPoints: 2,
          outcome: 'correct',
        },
        {
          questionRevisionId: 'q2',
          origin: 'ai',
          state: 'failed',
          points: null,
          maxPoints: 4,
          outcome: 'pending',
        },
      ];

      const summary = calculateAttemptScoreSummary('att_3', qRevs, grades);
      expect(summary.isFullyFinal).toBe(false);
      expect(summary.awardedPoints).toBeNull();
      expect(summary.failedQuestions).toBe(1);
      expect(summary.derivedStatus).toBe('grading-failed');
    });
  });

  describe('display rounding and formatting', () => {
    it('performs half-up 2-decimal rounding', () => {
      expect(roundDisplayPoints(0.333333333)).toBe(0.33);
      expect(roundDisplayPoints(0.666666667)).toBe(0.67);
      expect(roundDisplayPoints(0.125)).toBe(0.13);
      expect(roundDisplayPoints(1.0001)).toBe(1);
      expect(roundDisplayPoints(0)).toBe(0);
    });

    it('formats display points cleanly with fallback', () => {
      expect(formatDisplayPoints(null)).toBe('—');
      expect(formatDisplayPoints(undefined)).toBe('—');
      expect(formatDisplayPoints(NaN)).toBe('—');
      expect(formatDisplayPoints(10)).toBe('10');
      expect(formatDisplayPoints(10.5)).toBe('10.50');
      expect(formatDisplayPoints(0.333333)).toBe('0.33');
    });
  });
});
