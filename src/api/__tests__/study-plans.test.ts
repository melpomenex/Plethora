import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as tauriLib from '../../lib/tauri';
import {
  createStudyPlan,
  listStudyPlans,
  getStudyPlan,
  saveStudyPlanDraft,
  publishStudyPlanVersion,
  discardStudyPlanDraft,
  setStudyPlanNodeActivity,
  archiveStudyPlan,
  deleteStudyPlan,
  importLegacyStudyPlans,
  StudyApiError,
} from '../study-plans';
import { resolveStudySourceRefs } from '../study-sources';
import type {
  CreateStudyPlanInput,
  SaveStudyPlanDraftInput,
  StudyPlanDetail,
  StudyPlanSummary,
} from '../../types/learningPaths';
import type { StudySourceRefInput, StudySourceResolution } from '../../types/studySource';

vi.mock('../../lib/tauri', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/tauri')>(),
  isTauri: vi.fn(),
  invokeCommand: vi.fn(),
}));

describe('Study Plans and Sources API wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Non-Tauri environment rejection', () => {
    beforeEach(() => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(false);
    });

    it('rejects createStudyPlan with unsupported_platform', async () => {
      const input: CreateStudyPlanInput = {
        title: 'Test',
        goal: 'Goal',
        depth: 'survey',
        sourceScope: { schemaVersion: 1 } as any,
      };
      await expect(createStudyPlan(input)).rejects.toMatchObject({
        code: 'unsupported_platform',
        retryable: false,
      });
      expect(tauriLib.invokeCommand).not.toHaveBeenCalled();
    });

    it('rejects listStudyPlans with unsupported_platform instead of empty array', async () => {
      await expect(listStudyPlans(false)).rejects.toMatchObject({
        code: 'unsupported_platform',
        retryable: false,
      });
      expect(tauriLib.invokeCommand).not.toHaveBeenCalled();
    });

    it('rejects getStudyPlan with unsupported_platform instead of null/empty', async () => {
      await expect(getStudyPlan('sp_123')).rejects.toMatchObject({
        code: 'unsupported_platform',
        retryable: false,
      });
    });

    it('rejects resolveStudySourceRefs with unsupported_platform', async () => {
      await expect(resolveStudySourceRefs([])).rejects.toMatchObject({
        code: 'unsupported_platform',
        retryable: false,
      });
    });
  });

  describe('Tauri environment command dispatch', () => {
    beforeEach(() => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(true);
    });

    it('createStudyPlan dispatches create_study_plan and round-trips DTO', async () => {
      const mockDetail: Partial<StudyPlanDetail> = {
        plan: {
          id: 'sp_1',
          title: 'Plan 1',
          goal: 'Goal 1',
          depth: 'foundational',
          status: 'active',
          currentVersionId: null,
          currentVersion: 0,
          draftVersionId: 'spv_1',
          revision: 1,
          createdAt: '2026-11-10T00:00:00Z',
          updatedAt: '2026-11-10T00:00:00Z',
        },
      };
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(mockDetail);

      const input: CreateStudyPlanInput = {
        title: 'Plan 1',
        goal: 'Goal 1',
        depth: 'foundational',
        sourceScope: { schemaVersion: 1 } as any,
      };

      const result = await createStudyPlan(input);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('create_study_plan', { input });
      expect(result).toEqual(mockDetail);
    });

    it('listStudyPlans passes includeArchived and returns summaries', async () => {
      const mockSummaries: StudyPlanSummary[] = [
        {
          id: 'sp_1',
          title: 'Plan 1',
          goal: 'Goal 1',
          depth: 'deep',
          status: 'active',
          currentVersion: 1,
          revision: 7,
          nodeCount: 5,
          completedNodeCount: 2,
          sourceDocumentCount: 3,
          hasDraft: false,
          updatedAt: '2026-11-10T00:00:00Z',
        },
      ];
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(mockSummaries);

      const res = await listStudyPlans(true);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('list_study_plans', { includeArchived: true });
      expect(res).toEqual(mockSummaries);
    });

    it('getStudyPlan passes planId and versionId', async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce({} as StudyPlanDetail);
      await getStudyPlan('sp_123', 'spv_456');
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('get_study_plan', {
        planId: 'sp_123',
        versionId: 'spv_456',
      });
    });

    it('saveStudyPlanDraft dispatches save_study_plan_draft', async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce({} as StudyPlanDetail);
      const input: SaveStudyPlanDraftInput = {
        planId: 'sp_1',
        expectedDraftRevision: 2,
        nodes: [],
        prerequisites: [],
      };
      await saveStudyPlanDraft(input);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('save_study_plan_draft', { input });
    });

    it('publishStudyPlanVersion dispatches publish_study_plan_version', async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce({} as StudyPlanDetail);
      await publishStudyPlanVersion('sp_1', 'spv_draft', 3);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('publish_study_plan_version', {
        planId: 'sp_1',
        draftVersionId: 'spv_draft',
        expectedPlanRevision: 3,
      });
    });

    it('discardStudyPlanDraft dispatches discard_study_plan_draft', async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce({} as StudyPlanDetail);
      await discardStudyPlanDraft('sp_1', 2);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('discard_study_plan_draft', {
        planId: 'sp_1',
        expectedPlanRevision: 2,
      });
    });

    it('setStudyPlanNodeActivity dispatches set_study_plan_node_activity', async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce({} as StudyPlanDetail);
      await setStudyPlanNodeActivity('sp_1', 'spn_1', 'in-progress', 4);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('set_study_plan_node_activity', {
        planId: 'sp_1',
        nodeId: 'spn_1',
        activity: 'in-progress',
        expectedPlanRevision: 4,
      });
    });

    it('archiveStudyPlan and deleteStudyPlan dispatch correctly', async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValue(undefined);

      await archiveStudyPlan('sp_1', 5);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('archive_study_plan', {
        planId: 'sp_1',
        expectedPlanRevision: 5,
      });

      await deleteStudyPlan('sp_1', 6);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('delete_study_plan', {
        planId: 'sp_1',
        expectedPlanRevision: 6,
      });
    });

    it('importLegacyStudyPlans dispatches import_legacy_study_plans', async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce({
        planId: 'sp_imported',
        importedNodeCount: 4,
        importedVersion: 1,
        isRetry: false,
      });
      const res = await importLegacyStudyPlans('{"paths":[]}', 'hash_abc');
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('import_legacy_study_plans', {
        payload: '{"paths":[]}',
        importHash: 'hash_abc',
      });
      expect(res.planId).toBe('sp_imported');
    });

    it('resolveStudySourceRefs dispatches resolve_study_source_refs', async () => {
      const mockResolutions: StudySourceResolution[] = [
        {
          ref: {
            schemaVersion: 1,
            id: 'ssr_1',
            documentId: 'd1',
            excerpt: 'Excerpt text',
            revision: 'rev1',
            revisionKind: 'content-hash',
            excerptSha256: 'sha256:abc',
            documentTitle: 'Title',
            sourceType: 'pdf',
            capturedAt: '2026-03-31T00:00:00Z',
          },
          status: 'current',
          navigation: 'exact',
        },
      ];
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(mockResolutions);

      const input: StudySourceRefInput[] = [
        {
          documentId: 'd1',
          sourceType: 'pdf',
          revision: 'rev1',
          excerpt: 'Excerpt text',
        },
      ];

      const res = await resolveStudySourceRefs(input);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('resolve_study_source_refs', { input });
      expect(res).toEqual(mockResolutions);
    });
  });

  describe('Error normalization and preservation', () => {
    beforeEach(() => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(true);
    });

    it('preserves structured StudyCommandError details on rejection', async () => {
      const nativeError = {
        code: 'stale_revision',
        messageKey: 'study_plan.error.stale_revision',
        retryable: true,
        details: {
          expectedRevision: 2,
          actualRevision: 3,
        },
      };
      vi.mocked(tauriLib.invokeCommand).mockRejectedValueOnce(nativeError);

      try {
        await saveStudyPlanDraft({
          planId: 'sp_1',
          expectedDraftRevision: 2,
          nodes: [],
          prerequisites: [],
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(StudyApiError);
        const apiErr = err as StudyApiError;
        expect(apiErr.code).toBe('stale_revision');
        expect(apiErr.messageKey).toBe('study_plan.error.stale_revision');
        expect(apiErr.retryable).toBe(true);
        expect(apiErr.details).toEqual({
          expectedRevision: 2,
          actualRevision: 3,
        });
      }
    });

    it('normalizes generic Error to storage_failed', async () => {
      vi.mocked(tauriLib.invokeCommand).mockRejectedValueOnce(new Error('Connection dropped'));

      try {
        await getStudyPlan('sp_1');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(StudyApiError);
        const apiErr = err as StudyApiError;
        expect(apiErr.code).toBe('storage_failed');
        expect(apiErr.messageKey).toBe('Connection dropped');
        expect(apiErr.retryable).toBe(true);
      }
    });
  });
});
