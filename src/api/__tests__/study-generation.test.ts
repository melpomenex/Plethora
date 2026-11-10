import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as tauriLib from '../../lib/tauri';
import {
  startStudyGenerationJob,
  claimStudyJobStep,
  completeStudyJobStep,
  failStudyJobStep,
  cancelStudyGenerationJob,
  resumeStudyGenerationJob,
  recoverInterruptedStudyJobs,
  listStudyGenerationJobs,
} from '../study-generation';
import type {
  StartStudyJobInput,
  CompleteStudyStepInput,
  FailStudyStepInput,
  StudyGenerationJob,
  StudyGenerationStep,
  StudyJobProgress,
} from '../../lib/study-plans/generation/types';

vi.mock('../../lib/tauri', () => ({
  isTauri: vi.fn(),
  invokeCommand: vi.fn(),
}));

describe('Study Generation API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Non-Tauri environment protection', () => {
    beforeEach(() => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(false);
    });

    it('rejects startStudyGenerationJob with unsupported_platform', async () => {
      const input: StartStudyJobInput = {
        kind: 'curriculum',
        targetId: 'spv_1',
        targetRevision: 1,
        creationKey: 'ck_1',
        requestHash: 'rh_1',
        preflight: {},
        steps: [],
      };
      await expect(startStudyGenerationJob(input)).rejects.toMatchObject({
        code: 'unsupported_platform',
        retryable: false,
      });
      expect(tauriLib.invokeCommand).not.toHaveBeenCalled();
    });

    it('rejects claimStudyJobStep with unsupported_platform', async () => {
      await expect(
        claimStudyJobStep('job_1', 'step_0', 'worker_1', 0)
      ).rejects.toMatchObject({
        code: 'unsupported_platform',
        retryable: false,
      });
      expect(tauriLib.invokeCommand).not.toHaveBeenCalled();
    });

    it('rejects completeStudyJobStep with unsupported_platform', async () => {
      const input: CompleteStudyStepInput = {
        jobId: 'job_1',
        stepKey: 'step_0',
        leaseOwner: 'worker_1',
        cancellationEpoch: 0,
        inputHash: 'ih_1',
        outputRefId: null,
        nextStepIndex: 1,
        progress: { completed: 1, total: 2, labelKey: 'step done' },
      };
      await expect(completeStudyJobStep(input)).rejects.toMatchObject({
        code: 'unsupported_platform',
      });
    });

    it('rejects failStudyJobStep with unsupported_platform', async () => {
      const input: FailStudyStepInput = {
        jobId: 'job_1',
        stepKey: 'step_0',
        leaseOwner: 'worker_1',
        cancellationEpoch: 0,
        error: {
          code: 'model_timeout',
          messageKey: 'study_generation.error.timeout',
          retryable: true,
        },
      };
      await expect(failStudyJobStep(input)).rejects.toMatchObject({
        code: 'unsupported_platform',
      });
    });

    it('rejects cancelStudyGenerationJob with unsupported_platform', async () => {
      await expect(cancelStudyGenerationJob('job_1', 0)).rejects.toMatchObject({
        code: 'unsupported_platform',
      });
    });

    it('rejects resumeStudyGenerationJob with unsupported_platform', async () => {
      await expect(resumeStudyGenerationJob('job_1', {})).rejects.toMatchObject({
        code: 'unsupported_platform',
      });
    });

    it('rejects recoverInterruptedStudyJobs with unsupported_platform', async () => {
      await expect(recoverInterruptedStudyJobs()).rejects.toMatchObject({
        code: 'unsupported_platform',
      });
    });

    it('rejects listStudyGenerationJobs with unsupported_platform', async () => {
      await expect(listStudyGenerationJobs('spv_1')).rejects.toMatchObject({
        code: 'unsupported_platform',
      });
    });
  });

  describe('Tauri environment commands and DTO round-tripping', () => {
    beforeEach(() => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(true);
    });

    it('invokes start_study_generation_job with exact input', async () => {
      const input: StartStudyJobInput = {
        kind: 'curriculum',
        targetId: 'spv_1',
        targetRevision: 1,
        creationKey: 'ck_test',
        requestHash: 'hash_test',
        preflight: { providerId: 'openai' },
        steps: [{ stepKey: 'decompose:0', ordinal: 0, inputHash: 'h0' }],
      };
      const mockJob: StudyGenerationJob = {
        id: 'job_123',
        kind: 'curriculum',
        targetId: 'spv_1',
        targetRevision: 1,
        requestHash: 'hash_test',
        creationKey: 'ck_test',
        status: 'queued',
        nextStepIndex: 0,
        leaseOwner: null,
        leaseExpiresAt: null,
        cancellationEpoch: 0,
        attemptCount: 0,
        preflight: { providerId: 'openai' },
        progress: { completed: 0, total: 1, labelKey: 'queued' },
        lastError: null,
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      };
      vi.mocked(tauriLib.invokeCommand).mockResolvedValue(mockJob);

      const result = await startStudyGenerationJob(input);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('start_study_generation_job', { input });
      expect(result).toEqual(mockJob);
    });

    it('invokes claim_study_job_step and returns step DTO', async () => {
      const mockStep: StudyGenerationStep = {
        jobId: 'job_123',
        stepKey: 'decompose:0',
        ordinal: 0,
        inputHash: 'h0',
        status: 'running',
        outputRefId: null,
        safeError: null,
        completedAt: null,
      };
      vi.mocked(tauriLib.invokeCommand).mockResolvedValue(mockStep);

      const result = await claimStudyJobStep('job_123', 'decompose:0', 'worker_alpha', 0);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('claim_study_job_step', {
        jobId: 'job_123',
        stepKey: 'decompose:0',
        leaseOwner: 'worker_alpha',
        cancellationEpoch: 0,
      });
      expect(result).toEqual(mockStep);
    });

    it('invokes complete_study_job_step and returns progress', async () => {
      const input: CompleteStudyStepInput = {
        jobId: 'job_123',
        stepKey: 'decompose:0',
        leaseOwner: 'worker_alpha',
        cancellationEpoch: 0,
        inputHash: 'h0',
        outputRefId: 'ref_1',
        nextStepIndex: 1,
        progress: { completed: 1, total: 1, labelKey: 'complete' },
        status: 'awaiting-review',
      };
      const mockProgress: StudyJobProgress = {
        completed: 1,
        total: 1,
        labelKey: 'complete',
      };
      vi.mocked(tauriLib.invokeCommand).mockResolvedValue(mockProgress);

      const result = await completeStudyJobStep(input);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('complete_study_job_step', { input });
      expect(result).toEqual(mockProgress);
    });

    it('invokes fail_study_job_step and maps errors', async () => {
      const input: FailStudyStepInput = {
        jobId: 'job_123',
        stepKey: 'decompose:0',
        leaseOwner: 'worker_alpha',
        cancellationEpoch: 0,
        error: {
          code: 'model_timeout',
          messageKey: 'study_generation.error.timeout',
          retryable: true,
        },
      };
      const mockProgress: StudyJobProgress = {
        completed: 0,
        total: 1,
        labelKey: 'failed',
      };
      vi.mocked(tauriLib.invokeCommand).mockResolvedValue(mockProgress);

      const result = await failStudyJobStep(input);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('fail_study_job_step', { input });
      expect(result).toEqual(mockProgress);
    });

    it('invokes cancel_study_generation_job', async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValue(undefined);
      await cancelStudyGenerationJob('job_123', 0);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('cancel_study_generation_job', {
        jobId: 'job_123',
        cancellationEpoch: 0,
      });
    });

    it('invokes resume_study_generation_job', async () => {
      const mockJob: Partial<StudyGenerationJob> = { id: 'job_123', status: 'queued' };
      vi.mocked(tauriLib.invokeCommand).mockResolvedValue(mockJob);

      const result = await resumeStudyGenerationJob('job_123', { providerId: 'anthropic' });
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('resume_study_generation_job', {
        jobId: 'job_123',
        preflight: { providerId: 'anthropic' },
      });
      expect(result).toEqual(mockJob);
    });

    it('invokes recover_interrupted_study_jobs', async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValue([]);
      const result = await recoverInterruptedStudyJobs();
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('recover_interrupted_study_jobs');
      expect(result).toEqual([]);
    });

    it('invokes list_study_generation_jobs with or without targetId', async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValue([]);
      await listStudyGenerationJobs('spv_target');
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('list_study_generation_jobs', {
        targetId: 'spv_target',
      });

      await listStudyGenerationJobs();
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith('list_study_generation_jobs', {
        targetId: null,
      });
    });

    it('normalizes backend errors into StudyApiError', async () => {
      vi.mocked(tauriLib.invokeCommand).mockRejectedValue({
        code: 'job_lease_stale',
        messageKey: 'study_generation.error.lease_stale',
        retryable: true,
      });

      await expect(
        claimStudyJobStep('job_123', 'step_0', 'worker_alpha', 0)
      ).rejects.toMatchObject({
        name: 'StudyApiError',
        code: 'job_lease_stale',
        messageKey: 'study_generation.error.lease_stale',
        retryable: true,
      });
    });
  });
});
