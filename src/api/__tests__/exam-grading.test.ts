import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as tauriLib from '../../lib/tauri';
import {
  recordRubricGrade,
  recordManualGrade,
  getResponseGradeHistory,
  normalizeGradeRecord,
} from '../exam-grading';
import { StudyApiError } from '../study-plans';

vi.mock('../../lib/tauri', () => ({
  isTauri: vi.fn(),
  invokeCommand: vi.fn(),
}));

describe('Exam Grading API wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ensureNativeSupport', () => {
    it('throws unsupported_platform error when isTauri is false', async () => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(false);

      await expect(
        recordRubricGrade({
          attemptId: 'att_1',
          responseSubmissionId: 'sub_1',
          questionRevisionId: 'qrev_1',
          expectedAttemptRevision: 1,
          state: 'final',
          points: 4,
          maxPoints: 4,
          normalizedScore: 1.0,
          criteria: [],
        })
      ).rejects.toMatchObject({
        code: 'unsupported_platform',
      });

      await expect(
        recordManualGrade({
          attemptId: 'att_1',
          responseSubmissionId: 'sub_1',
          questionRevisionId: 'qrev_1',
          expectedAttemptRevision: 1,
          manualReason: 'Looks good',
          criteria: [],
        })
      ).rejects.toMatchObject({
        code: 'unsupported_platform',
      });

      await expect(getResponseGradeHistory('sub_1')).rejects.toMatchObject({
        code: 'unsupported_platform',
      });
    });
  });

  describe('recordRubricGrade', () => {
    it('calls invokeCommand with record_rubric_grade and returns outcome', async () => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(true);
      const mockOutcome = {
        gradeId: 'grd_1',
        isCurrent: true,
        supersedesGradeId: null,
        attemptStatus: 'partially-graded' as const,
        attemptAwardedPoints: null,
        attemptRevision: 2,
      };
      vi.mocked(tauriLib.invokeCommand).mockResolvedValue(mockOutcome);

      const input = {
        attemptId: 'att_1',
        responseSubmissionId: 'sub_1',
        questionRevisionId: 'qrev_1',
        expectedAttemptRevision: 1,
        state: 'final' as const,
        points: 3,
        maxPoints: 4,
        normalizedScore: 0.75,
        criteria: [
          {
            criterionId: 'crit_1',
            status: 'assessed' as const,
            level: 3,
            answerEvidence: 'quoted text',
            rationale: 'Well explained',
          },
        ],
      };

      const result = await recordRubricGrade(input);
      expect(result).toEqual(mockOutcome);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('record_rubric_grade', { input });
    });
  });

  describe('recordManualGrade', () => {
    it('calls invokeCommand with record_manual_grade and returns outcome', async () => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(true);
      const mockOutcome = {
        gradeId: 'grd_2',
        isCurrent: true,
        supersedesGradeId: 'grd_1',
        attemptStatus: 'complete' as const,
        attemptAwardedPoints: 10,
        attemptRevision: 3,
      };
      vi.mocked(tauriLib.invokeCommand).mockResolvedValue(mockOutcome);

      const input = {
        attemptId: 'att_1',
        responseSubmissionId: 'sub_1',
        questionRevisionId: 'qrev_1',
        expectedAttemptRevision: 2,
        manualReason: 'Re-evaluating based on alternative correct formulation.',
        criteria: [{ criterionId: 'crit_1', level: 4, rationale: 'Acceptable' }],
      };

      const result = await recordManualGrade(input);
      expect(result).toEqual(mockOutcome);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('record_manual_grade', { input });
    });
  });

  describe('getResponseGradeHistory', () => {
    it('calls invokeCommand with get_response_grade_history and normalizes JSON strings', async () => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(true);
      const rawGrade = {
        id: 'grd_1',
        response_submission_id: 'sub_1',
        question_revision_id: 'qrev_1',
        origin: 'ai',
        state: 'final',
        points: 4,
        max_points: 4,
        assessment_json: JSON.stringify({
          score: 1.0,
          completeness: 'complete',
          confidence: 'high',
          feedback: 'Accurate',
          missingConcepts: [],
          misconceptions: [],
        }),
        criteria_json: JSON.stringify([
          {
            criterionId: 'crit_1',
            status: 'assessed',
            level: 4,
            answerEvidence: 'mitochondria is the powerhouse',
            rationale: 'Correct role mentioned',
          },
        ]),
        provenance_json: JSON.stringify({
          provider: 'local',
          model: 'qwen2.5:7b',
          taskType: 'study-rubric-grade',
        }),
        manual_reason: null,
        supersedes_grade_id: null,
        is_current: 1,
        created_at: '2026-11-10T12:00:00Z',
      };

      vi.mocked(tauriLib.invokeCommand).mockResolvedValue([rawGrade]);

      const history = await getResponseGradeHistory('sub_1');
      expect(history).toHaveLength(1);
      expect(history[0].id).toBe('grd_1');
      expect(history[0].responseSubmissionId).toBe('sub_1');
      expect(history[0].isCurrent).toBe(true);
      expect(history[0].assessment?.feedback).toBe('Accurate');
      expect(history[0].criteria).toHaveLength(1);
      expect(history[0].criteria[0].criterionId).toBe('crit_1');
    });
  });
});
