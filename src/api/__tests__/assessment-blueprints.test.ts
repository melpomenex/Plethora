import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as tauriLib from '../../lib/tauri';
import {
  createAssessmentBlueprint,
  saveAssessmentBlueprintDraft,
  getAssessmentBlueprintRevision,
  listAssessmentBlueprints,
  upsertAssessmentQuestionDraft,
  publishAssessmentBlueprint,
  discardAssessmentBlueprintDraft,
  archiveAssessmentBlueprint,
  deleteUnusedAssessmentBlueprint,
} from '../assessment-blueprints';
import { StudyApiError } from '../study-plans';
import type {
  CreateBlueprintInput,
  SaveBlueprintDraftInput,
  SaveQuestionDraftInput,
} from '../assessment-blueprints';
import type { AssessmentConfigV1, BlueprintDetail } from '../../types/assessmentQuestions';
import type { StudySourceScopeV1 } from '../../types/studySource';

vi.mock('../../lib/tauri', () => ({
  isTauri: vi.fn(),
  invokeCommand: vi.fn(),
}));

describe('Assessment Blueprints API wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockSourceScope: StudySourceScopeV1 = {
    schemaVersion: 1,
    selected: {
      documentIds: ['doc1'],
      extractIds: [],
      collectionIds: [],
      tagIds: [],
    },
    resolvedDocuments: [],
    frozenAt: '2026-11-10T20:00:00Z',
    indexCompleteness: 'complete',
    limitations: [],
  };

  const mockConfig: AssessmentConfigV1 = {
    schemaVersion: 1,
    mode: 'exam',
    requestedCount: 10,
    typeWeights: { 'single-select': 1 },
    difficultyWeights: { 2: 1 },
    topicTargets: [],
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

  describe('Non-Tauri environment rejection (fail-closed)', () => {
    beforeEach(() => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(false);
    });

    it('rejects createAssessmentBlueprint with unsupported_platform', async () => {
      const input: CreateBlueprintInput = {
        title: 'Exam 1',
        config: mockConfig,
        sourceScope: mockSourceScope,
        sourceSnapshotHash: 'sha256:test',
      };

      await expect(createAssessmentBlueprint(input)).rejects.toMatchObject({
        code: 'unsupported_platform',
        retryable: false,
      });
      expect(tauriLib.invokeCommand).not.toHaveBeenCalled();
    });

    it('rejects listAssessmentBlueprints with unsupported_platform instead of empty array', async () => {
      await expect(listAssessmentBlueprints('plan_1')).rejects.toMatchObject({
        code: 'unsupported_platform',
      });
      expect(tauriLib.invokeCommand).not.toHaveBeenCalled();
    });

    it('rejects publishAssessmentBlueprint with unsupported_platform', async () => {
      await expect(publishAssessmentBlueprint('rev_1', 1, false)).rejects.toMatchObject({
        code: 'unsupported_platform',
      });
    });
  });

  describe('Tauri environment command dispatch and error mapping', () => {
    beforeEach(() => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(true);
    });

    it('dispatches create_assessment_blueprint with expected payload structure', async () => {
      const input: CreateBlueprintInput = {
        planId: 'plan_1',
        title: 'Midterm',
        planVersionId: 'spv_1',
        config: mockConfig,
        sourceScope: mockSourceScope,
        sourceSnapshotHash: 'sha256:abc',
      };

      const mockDetail = {
        blueprint: { id: 'ab_1', title: 'Midterm' },
        revision: { id: 'abr_1', state: 'draft' },
        questions: [],
      } as unknown as BlueprintDetail;

      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(mockDetail);

      const result = await createAssessmentBlueprint(input);
      expect(result).toEqual(mockDetail);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('create_assessment_blueprint', {
        input: {
          planId: 'plan_1',
          title: 'Midterm',
          planVersionId: 'spv_1',
          config: mockConfig,
          sourceScope: input.sourceScope,
          sourceSnapshotHash: 'sha256:abc',
        },
      });
    });

    it('dispatches get_assessment_blueprint_revision with revisionId', async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce({} as BlueprintDetail);

      await getAssessmentBlueprintRevision('abr_123');
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('get_assessment_blueprint_revision', {
        revisionId: 'abr_123',
      });
    });

    it('dispatches save_assessment_blueprint_draft with CAS revision', async () => {
      const input: SaveBlueprintDraftInput = {
        revisionId: 'abr_1',
        expectedRevision: 2,
        title: 'New Title',
      };

      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce({} as BlueprintDetail);

      await saveAssessmentBlueprintDraft(input);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('save_assessment_blueprint_draft', {
        input: {
          revisionId: 'abr_1',
          expectedRevision: 2,
          title: 'New Title',
          config: undefined,
          sourceScope: undefined,
          sourceSnapshotHash: undefined,
        },
      });
    });

    it('dispatches upsert_assessment_question_draft with slot and question details', async () => {
      const input: SaveQuestionDraftInput = {
        blueprintRevisionId: 'abr_1',
        questionId: 'aq_1',
        slotKey: 'slot_0001',
        fingerprint: 'sha256:fp',
        kind: 'single-select',
        payloadJson: '{"prompt":"Q"}',
        answerKeyJson: '{"correctOptionId":"opt_1"}',
        rubricJson: null,
        maxPoints: 1,
        difficulty: 2,
        validation: 'valid',
        validationIssuesJson: null,
        providerJson: null,
        sourceRefIds: ['ref_1'],
        targets: [
          {
            conceptId: 'c1',
            conceptLabel: 'Concept',
            nodeId: 'n1',
            objectiveText: 'Obj',
          },
        ],
      };

      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce({ id: 'aqr_1' });

      await upsertAssessmentQuestionDraft(input);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('upsert_assessment_question_draft', {
        input: {
          blueprintRevisionId: 'abr_1',
          questionId: 'aq_1',
          slotKey: 'slot_0001',
          fingerprint: 'sha256:fp',
          kind: 'single-select',
          payloadJson: '{"prompt":"Q"}',
          answerKeyJson: '{"correctOptionId":"opt_1"}',
          rubricJson: null,
          maxPoints: 1,
          difficulty: 2,
          validation: 'valid',
          validationIssuesJson: null,
          providerJson: null,
          sourceRefIds: ['ref_1'],
          targets: input.targets,
        },
      });
    });

    it('dispatches publish_assessment_blueprint with shortfallAccepted parameter', async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce({} as BlueprintDetail);

      await publishAssessmentBlueprint('abr_1', 2, true);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('publish_assessment_blueprint', {
        revisionId: 'abr_1',
        expectedRevision: 2,
        shortfallAccepted: true,
      });
    });

    it('normalizes quota_shortfall error into typed StudyApiError', async () => {
      vi.mocked(tauriLib.invokeCommand).mockRejectedValueOnce({
        code: 'quota_shortfall',
        messageKey: 'study.assessment.error.quota_shortfall',
        retryable: false,
        details: { requested: 10, valid: 8 },
      });

      try {
        await publishAssessmentBlueprint('abr_1', 1, false);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(StudyApiError);
        const apiErr = err as StudyApiError;
        expect(apiErr.code).toBe('quota_shortfall');
        expect(apiErr.details?.requested).toBe(10);
        expect(apiErr.details?.valid).toBe(8);
      }
    });

    it('dispatches discard, archive, delete commands', async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValue(undefined);

      await discardAssessmentBlueprintDraft('abr_1', 1);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('discard_assessment_blueprint_draft', {
        revisionId: 'abr_1',
        expectedRevision: 1,
      });

      await archiveAssessmentBlueprint('ab_1', 2);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('archive_assessment_blueprint', {
        blueprintId: 'ab_1',
        expectedRevision: 2,
      });

      await deleteUnusedAssessmentBlueprint('ab_1', 3);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('delete_unused_assessment_blueprint', {
        blueprintId: 'ab_1',
        expectedRevision: 3,
      });
    });
  });
});
