import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as tauriLib from '../../lib/tauri';
import {
  getConceptMasterySummary,
  getStudyPlanEvidence,
  listLearningGaps,
  dismissLearningGap,
  refreshLocalLearningGaps,
  reconcileLearningEvidence,
  recordRemediationDisposition,
  getDiagnosticPriorEvidence,
} from '../learning-evidence';

vi.mock('../../lib/tauri', () => ({
  isTauri: vi.fn(),
  invokeCommand: vi.fn(),
}));

describe('Learning Evidence API wrappers (C6-T05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('non-Tauri rejection', () => {
    beforeEach(() => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(false);
    });

    it('rejects every command with unsupported_platform and no invoke', async () => {
      await expect(getConceptMasterySummary('c1')).rejects.toMatchObject({ code: 'unsupported_platform' });
      await expect(getStudyPlanEvidence('p1')).rejects.toMatchObject({ code: 'unsupported_platform' });
      await expect(listLearningGaps(null)).rejects.toMatchObject({ code: 'unsupported_platform' });
      await expect(dismissLearningGap('g1', '2026-01-01T00:00:00.000Z')).rejects.toMatchObject({
        code: 'unsupported_platform',
      });
      await expect(refreshLocalLearningGaps('p1')).rejects.toMatchObject({ code: 'unsupported_platform' });
      await expect(reconcileLearningEvidence(null, 50)).rejects.toMatchObject({
        code: 'unsupported_platform',
      });
      await expect(recordRemediationDisposition('r1', 'accepted')).rejects.toMatchObject({
        code: 'unsupported_platform',
      });
      await expect(getDiagnosticPriorEvidence('ea_1')).rejects.toMatchObject({
        code: 'unsupported_platform',
      });
      expect(tauriLib.invokeCommand).not.toHaveBeenCalled();
    });
  });

  describe('Tauri dispatch', () => {
    beforeEach(() => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(true);
    });

    it('dispatches list/dismiss/refresh/reconcile with exact command names', async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce([]);
      await listLearningGaps('plan_1', false);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('list_learning_gaps', {
        planId: 'plan_1',
        includeDismissed: false,
      });

      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(undefined);
      await dismissLearningGap('gap_1', '2026-01-02T00:00:00.000Z');
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('dismiss_learning_gap', {
        gapId: 'gap_1',
        evidenceCutoff: '2026-01-02T00:00:00.000Z',
      });

      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce([]);
      await refreshLocalLearningGaps('plan_1');
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('refresh_local_learning_gaps', {
        planId: 'plan_1',
      });

      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce({
        processed: 1,
        remaining: 0,
        nextAfterGradeId: null,
        completed: true,
      });
      const res = await reconcileLearningEvidence(null, 100);
      expect(res.completed).toBe(true);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('reconcile_learning_evidence', {
        afterGradeId: null,
        batchLimit: 100,
      });
    });

    it('propagates native errors without fabricating empty data', async () => {
      vi.mocked(tauriLib.invokeCommand).mockRejectedValueOnce({
        code: 'storage_failed',
        messageKey: 'db down',
        retryable: true,
      });
      await expect(getConceptMasterySummary('c1')).rejects.toMatchObject({ code: 'storage_failed' });
    });
  });
});
