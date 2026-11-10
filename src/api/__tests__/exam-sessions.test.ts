import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as tauriLib from '../../lib/tauri';
import {
  startExamAttempt,
  getExamAttempt,
  listExamAttempts,
  saveExamResponse,
  submitExamAttempt,
  checkPracticeResponse,
  cancelExamAttempt,
  deleteExamHistory,
} from '../exam-sessions';
import { StudyApiError } from '../study-plans';
import type {
  AttemptDetail,
  AttemptSummary,
  ExamResponse,
  PracticeCheckResult,
} from '../../types/assessmentSessions';

vi.mock('../../lib/tauri', () => ({
  isTauri: vi.fn(),
  invokeCommand: vi.fn(),
}));

describe('Exam Sessions API wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockAttemptDetail: AttemptDetail = {
    attempt: {
      id: 'att_1',
      blueprintRevisionId: 'bpr_1',
      blueprintTitle: 'Cell Biology Exam',
      mode: 'exam',
      status: 'in-progress',
      startedAt: '2026-11-10T12:00:00Z',
      deadlineAt: '2026-11-10T12:30:00Z',
      submittedAt: null,
      completedAt: null,
      awardedPoints: null,
      maximumPoints: 10,
      clientStartKey: 'start_key_1',
      revision: 1,
      questionRevisionIds: ['qrev_1', 'qrev_2'],
      submissionReason: null,
      submissionKey: null,
      createdAt: '2026-11-10T12:00:00Z',
      updatedAt: '2026-11-10T12:00:00Z',
    },
    responses: [
      {
        id: 'resp_1',
        attemptId: 'att_1',
        questionRevisionId: 'qrev_1',
        draft: { kind: 'single-select', optionId: 'opt_a' },
        mark: 'answered',
        revision: 1,
        lastClientMutationId: 'mut_1',
        updatedAt: '2026-11-10T12:05:00Z',
      },
    ],
    submissions: [],
    currentGrades: [],
  };

  it('fails closed when not running inside Tauri', async () => {
    vi.mocked(tauriLib.isTauri).mockReturnValue(false);

    await expect(
      startExamAttempt({
        blueprintRevisionId: 'bpr_1',
        clientStartKey: 'start_1',
      })
    ).rejects.toMatchObject({
      code: 'unsupported_platform',
    });

    await expect(getExamAttempt('att_1')).rejects.toBeInstanceOf(StudyApiError);
    await expect(listExamAttempts()).rejects.toBeInstanceOf(StudyApiError);
    await expect(
      saveExamResponse({
        attemptId: 'att_1',
        responseId: 'resp_1',
        expectedResponseRevision: 1,
        lastClientMutationId: 'mut_1',
        draft: { kind: 'single-select', optionId: 'opt_1' },
        mark: 'answered',
      })
    ).rejects.toBeInstanceOf(StudyApiError);
    await expect(
      submitExamAttempt({
        attemptId: 'att_1',
        expectedAttemptRevision: 1,
        submissionKey: 'sub_1',
        submissionReason: 'user',
        objectiveGrades: [],
      })
    ).rejects.toBeInstanceOf(StudyApiError);
    await expect(
      checkPracticeResponse({
        attemptId: 'att_1',
        responseId: 'resp_1',
        expectedAttemptRevision: 1,
        clientMutationId: 'mut_1',
        hintLevel: 1,
        draft: { kind: 'single-select', optionId: 'opt_1' },
        mark: 'answered',
        objectiveGrade: null,
      })
    ).rejects.toBeInstanceOf(StudyApiError);
    await expect(cancelExamAttempt('att_1', 1)).rejects.toBeInstanceOf(StudyApiError);
    await expect(deleteExamHistory('att_1')).rejects.toBeInstanceOf(StudyApiError);
  });

  describe('when running inside Tauri', () => {
    beforeEach(() => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(true);
    });

    it('startExamAttempt invokes start_exam_attempt and returns detail', async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(mockAttemptDetail);

      const res = await startExamAttempt({
        blueprintRevisionId: 'bpr_1',
        clientStartKey: 'start_1',
      });

      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('start_exam_attempt', {
        input: {
          blueprintRevisionId: 'bpr_1',
          clientStartKey: 'start_1',
        },
      });
      expect(res).toEqual(mockAttemptDetail);
    });

    it('getExamAttempt invokes get_exam_attempt', async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(mockAttemptDetail);

      const res = await getExamAttempt('att_1');

      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('get_exam_attempt', {
        attemptId: 'att_1',
        attempt_id: 'att_1',
      });
      expect(res.attempt.id).toBe('att_1');
    });

    it('listExamAttempts invokes list_exam_attempts', async () => {
      const summary: AttemptSummary = {
        id: 'att_1',
        blueprintRevisionId: 'bpr_1',
        blueprintId: 'bp_1',
        blueprintTitle: 'Cell Biology Exam',
        mode: 'exam',
        status: 'complete',
        startedAt: '2026-11-10T12:00:00Z',
        deadlineAt: null,
        completedAt: '2026-11-10T12:20:00Z',
        awardedPoints: 10,
        maximumPoints: 10,
        questionCount: 2,
      };
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce([summary]);

      const res = await listExamAttempts({ mode: 'exam' });

      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('list_exam_attempts', {
        input: { mode: 'exam' },
      });
      expect(res).toEqual([summary]);
    });

    it('saveExamResponse invokes save_exam_response', async () => {
      const savedResp: ExamResponse = mockAttemptDetail.responses[0];
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(savedResp);

      const input = {
        attemptId: 'att_1',
        responseId: 'resp_1',
        expectedResponseRevision: 1,
        lastClientMutationId: 'mut_1',
        draft: { kind: 'single-select' as const, optionId: 'opt_a' },
        mark: 'answered' as const,
      };
      const res = await saveExamResponse(input);

      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('save_exam_response', {
        input: {
          attemptId: 'att_1',
          responseId: 'resp_1',
          expectedResponseRevision: 1,
          lastClientMutationId: 'mut_1',
          draftJson: JSON.stringify(input.draft),
          mark: 'answered',
        },
      });
      expect(res.id).toBe('resp_1');
    });

    it('submitExamAttempt invokes submit_exam_attempt', async () => {
      const completedDetail = {
        ...mockAttemptDetail,
        attempt: { ...mockAttemptDetail.attempt, status: 'complete' as const, awardedPoints: 10 },
      };
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(completedDetail);

      const input = {
        attemptId: 'att_1',
        expectedAttemptRevision: 1,
        submissionKey: 'sub_1',
        submissionReason: 'user' as const,
        objectiveGrades: [],
      };
      const res = await submitExamAttempt(input);

      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('submit_exam_attempt', {
        input,
      });
      expect(res.attempt.status).toBe('complete');
    });

    it('checkPracticeResponse invokes check_practice_response', async () => {
      const practiceResult: PracticeCheckResult = {
        submission: {
          id: 'subm_1',
          responseId: 'resp_1',
          attemptId: 'att_1',
          questionRevisionId: 'qrev_1',
          ordinal: 1,
          kind: 'practice-check',
          response: { kind: 'single-select', optionId: 'opt_a' },
          mark: 'answered',
          hintLevel: 1,
          createdAt: '2026-11-10T12:10:00Z',
        },
        grade: {
          id: 'grd_1',
          responseSubmissionId: 'subm_1',
          questionRevisionId: 'qrev_1',
          origin: 'deterministic',
          state: 'final',
          points: 2,
          maxPoints: 2,
          outcome: 'correct',
          assessment: null,
          criteria: [],
          provenance: null,
          manualReason: null,
          supersedesGradeId: null,
          isCurrent: true,
          createdAt: '2026-11-10T12:10:00Z',
        },
        attemptRevision: 2,
      };
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(practiceResult);

      const input = {
        attemptId: 'att_1',
        responseId: 'resp_1',
        expectedAttemptRevision: 1,
        clientMutationId: 'mut_p1',
        hintLevel: 1,
        draft: { kind: 'single-select' as const, optionId: 'opt_a' },
        mark: 'answered' as const,
        objectiveGrade: null,
      };
      const res = await checkPracticeResponse(input);

      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('check_practice_response', {
        input: {
          attemptId: 'att_1',
          responseId: 'resp_1',
          expectedAttemptRevision: 1,
          clientMutationId: 'mut_p1',
          hintLevel: 1,
          draftJson: JSON.stringify(input.draft),
          mark: 'answered',
          objectiveGrade: null,
        },
      });
      expect(res.submission.ordinal).toBe(1);
    });

    it('cancelExamAttempt invokes cancel_exam_attempt', async () => {
      const cancelledDetail = {
        ...mockAttemptDetail,
        attempt: { ...mockAttemptDetail.attempt, status: 'cancelled' as const },
      };
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(cancelledDetail);

      const res = await cancelExamAttempt('att_1', 1);

      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('cancel_exam_attempt', {
        attemptId: 'att_1',
        attempt_id: 'att_1',
        expectedRevision: 1,
        expected_revision: 1,
      });
      expect(res.attempt.status).toBe('cancelled');
    });

    it('deleteExamHistory invokes delete_exam_history', async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(undefined);

      await deleteExamHistory('att_1');

      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('delete_exam_history', {
        attemptId: 'att_1',
        attempt_id: 'att_1',
      });
    });

    it('normalizes IPC errors into StudyApiError', async () => {
      vi.mocked(tauriLib.invokeCommand).mockRejectedValueOnce({
        code: 'stale_revision',
        messageKey: 'study.assessment.error.stale_revision',
      });

      await expect(getExamAttempt('att_1')).rejects.toMatchObject({
        code: 'stale_revision',
        messageKey: 'study.assessment.error.stale_revision',
      });
    });
  });
});
