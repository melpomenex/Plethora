import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkGradingRecoveryStatus,
  retryFailedGrading,
  regradeAllSubjective,
  resumeGradingJob,
} from '../gradingRecovery';
import * as coordinatorMod from '../gradingCoordinator';
import * as studyGenApi from '../../../../api/study-generation';
import type {
  AttemptDetail,
  GradeRecord,
  ResponseSubmission,
} from '../../../../types/assessmentSessions';
import type { ShortAnswerQuestion, AssessmentQuestionRevision } from '../../../../types/assessmentQuestions';

vi.mock('../gradingCoordinator', () => ({
  runGradingCoordinator: vi.fn(),
}));

vi.mock('../../../../api/study-generation', () => ({
  resumeStudyGenerationJob: vi.fn(),
  cancelStudyGenerationJob: vi.fn(),
}));

describe('gradingRecovery', () => {
  const shortAnswerQ: ShortAnswerQuestion = {
    schemaVersion: 1,
    kind: 'short-answer',
    prompt: 'Define osmosis',
    maxPoints: 4,
    sourceRefIds: [],
    difficulty: 3,
    applicationLevel: 'recall',
    hints: [],
    explanation: 'Osmosis definition',
    learningObjectives: [],
    referenceAnswer: 'Diffusion of water across a semipermeable membrane.',
    keyFacts: [],
    acceptedAnswers: [],
    rubric: {
      schemaVersion: 1,
      expectedConcepts: ['osmosis'],
      gradingConstraints: [],
      criteria: [],
    },
  };

  const shortAnswerQRev: AssessmentQuestionRevision = {
    id: 'q_1',
    questionId: 'qid_1',
    blueprintRevisionId: 'bpr_1',
    revision: 1,
    slotKey: 'slot_1',
    fingerprint: 'fp_1',
    question: shortAnswerQ,
    validation: 'valid',
    committedAt: '2026-11-10T12:00:00Z',
    provider: null,
    createdAt: '2026-11-10T12:00:00Z',
  };

  const baseDetail: AttemptDetail = {
    attempt: {
      id: 'att_1',
      blueprintRevisionId: 'bpr_1',
      blueprintTitle: 'Biology Exam',
      mode: 'exam',
      status: 'submitted',
      startedAt: '2026-11-10T12:00:00Z',
      deadlineAt: null,
      submittedAt: '2026-11-10T12:30:00Z',
      completedAt: null,
      awardedPoints: null,
      maximumPoints: 10,
      clientStartKey: 'k_1',
      revision: 2,
      questionRevisionIds: ['q_1', 'q_2', 'q_3'],
      submissionReason: 'user',
      submissionKey: 'subm_1',
      createdAt: '2026-11-10T12:00:00Z',
      updatedAt: '2026-11-10T12:30:00Z',
    },
    responses: [],
    submissions: [
      {
        id: 'sub_1',
        responseId: 'resp_1',
        attemptId: 'att_1',
        questionRevisionId: 'q_1',
        ordinal: 1,
        kind: 'exam-final',
        mark: 'answered',
        hintLevel: 0,
        response: { kind: 'short-answer', text: 'Answer 1' },
        createdAt: '2026-11-10T12:10:00Z',
      },
      {
        id: 'sub_2',
        responseId: 'resp_2',
        attemptId: 'att_1',
        questionRevisionId: 'q_2',
        ordinal: 1,
        kind: 'exam-final',
        mark: 'answered',
        hintLevel: 0,
        response: { kind: 'short-answer', text: 'Answer 2' },
        createdAt: '2026-11-10T12:15:00Z',
      },
      {
        id: 'sub_3',
        responseId: 'resp_3',
        attemptId: 'att_1',
        questionRevisionId: 'q_3',
        ordinal: 1,
        kind: 'exam-final',
        mark: 'answered',
        hintLevel: 0,
        response: { kind: 'short-answer', text: 'Answer 3' },
        createdAt: '2026-11-10T12:20:00Z',
      },
    ],
    currentGrades: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkGradingRecoveryStatus', () => {
    it('detects fully final attempt', () => {
      const grades: GradeRecord[] = [
        {
          id: 'g_1',
          responseSubmissionId: 'sub_1',
          questionRevisionId: 'q_1',
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
          createdAt: '2026-11-10T12:25:00Z',
        },
        {
          id: 'g_2',
          responseSubmissionId: 'sub_2',
          questionRevisionId: 'q_2',
          origin: 'ai',
          state: 'final',
          points: 3,
          maxPoints: 4,
          assessment: null,
          criteria: [],
          provenance: null,
          manualReason: null,
          supersedesGradeId: null,
          isCurrent: true,
          createdAt: '2026-11-10T12:25:00Z',
        },
        {
          id: 'g_3',
          responseSubmissionId: 'sub_3',
          questionRevisionId: 'q_3',
          origin: 'deterministic',
          state: 'final',
          points: 2,
          maxPoints: 2,
          assessment: null,
          criteria: [],
          provenance: null,
          manualReason: null,
          supersedesGradeId: null,
          isCurrent: true,
          createdAt: '2026-11-10T12:25:00Z',
        },
      ];

      const status = checkGradingRecoveryStatus({
        ...baseDetail,
        currentGrades: grades,
      });

      expect(status.isFullyFinal).toBe(true);
      expect(status.canRetry).toBe(false);
      expect(status.canManualReview).toBe(false);
      expect(status.finalCount).toBe(3);
      expect(status.pendingCount).toBe(0);
      expect(status.needsReviewCount).toBe(0);
      expect(status.failedCount).toBe(0);
    });

    it('identifies needs-review and failed submissions correctly', () => {
      const grades: GradeRecord[] = [
        {
          id: 'g_1',
          responseSubmissionId: 'sub_1',
          questionRevisionId: 'q_1',
          origin: 'ai',
          state: 'needs-review',
          points: null,
          maxPoints: 4,
          assessment: null,
          criteria: [],
          provenance: null,
          manualReason: null,
          supersedesGradeId: null,
          isCurrent: true,
          createdAt: '2026-11-10T12:25:00Z',
        },
        {
          id: 'g_2',
          responseSubmissionId: 'sub_2',
          questionRevisionId: 'q_2',
          origin: 'ai',
          state: 'failed',
          points: null,
          maxPoints: 4,
          assessment: null,
          criteria: [],
          provenance: null,
          manualReason: null,
          supersedesGradeId: null,
          isCurrent: true,
          createdAt: '2026-11-10T12:25:00Z',
        },
      ];

      const status = checkGradingRecoveryStatus({
        ...baseDetail,
        currentGrades: grades,
      });

      expect(status.isFullyFinal).toBe(false);
      expect(status.needsReviewCount).toBe(1);
      expect(status.failedCount).toBe(1);
      expect(status.pendingCount).toBe(1); // sub_3 has no current grade
      expect(status.canRetry).toBe(true);
      expect(status.canManualReview).toBe(true);
      expect(status.needsReviewSubmissionIds).toEqual(['sub_1']);
      expect(status.failedSubmissionIds).toEqual(['sub_2']);
    });
  });

  describe('retryFailedGrading', () => {
    it('calls runGradingCoordinator with a fresh creation key and regrade: false', async () => {
      vi.mocked(coordinatorMod.runGradingCoordinator).mockResolvedValue({
        jobId: 'job_retry',
        attemptId: 'att_1',
        completedSteps: 1,
        totalSteps: 1,
        outcomes: [],
        latestAttemptDetail: baseDetail,
      });

      const res = await retryFailedGrading(baseDetail, [shortAnswerQRev]);
      expect(res.jobId).toBe('job_retry');
      expect(coordinatorMod.runGradingCoordinator).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptDetail: baseDetail,
          regrade: false,
          creationKey: expect.any(String),
        })
      );
    });
  });

  describe('regradeAllSubjective', () => {
    it('calls runGradingCoordinator with regrade: true and a fresh creation key', async () => {
      vi.mocked(coordinatorMod.runGradingCoordinator).mockResolvedValue({
        jobId: 'job_regrade',
        attemptId: 'att_1',
        completedSteps: 2,
        totalSteps: 2,
        outcomes: [],
        latestAttemptDetail: baseDetail,
      });

      const res = await regradeAllSubjective(baseDetail, [shortAnswerQRev]);
      expect(res.jobId).toBe('job_regrade');
      expect(coordinatorMod.runGradingCoordinator).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptDetail: baseDetail,
          regrade: true,
          creationKey: expect.any(String),
        })
      );
    });
  });

  describe('resumeGradingJob', () => {
    it('calls resumeStudyGenerationJob and continues coordinator', async () => {
      vi.mocked(coordinatorMod.runGradingCoordinator).mockResolvedValue({
        jobId: 'job_existing',
        attemptId: 'att_1',
        completedSteps: 1,
        totalSteps: 2,
        outcomes: [],
        latestAttemptDetail: baseDetail,
      });

      const res = await resumeGradingJob('job_existing', baseDetail, [shortAnswerQRev]);
      expect(studyGenApi.resumeStudyGenerationJob).toHaveBeenCalledWith('job_existing', expect.any(Object));
      expect(coordinatorMod.runGradingCoordinator).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptDetail: baseDetail,
          regrade: false,
        })
      );
    });
  });
});
