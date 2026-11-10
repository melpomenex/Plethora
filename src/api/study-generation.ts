/**
 * Typed Tauri IPC wrappers for Study Generation narrow jobs.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §10, §11
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T04)
 */

import { invokeCommand, isTauri } from '../lib/tauri';
import { StudyApiError, normalizeStudyError } from './study-plans';
import type {
  CompleteStudyStepInput,
  FailStudyStepInput,
  StartStudyJobInput,
  StudyAiPreflight,
  StudyGenerationJob,
  StudyGenerationStep,
  StudyJobProgress,
} from '../lib/study-plans/generation/types';

function ensureNativeSupport(): void {
  if (!isTauri()) {
    throw new StudyApiError({
      code: 'unsupported_platform',
      messageKey: 'study_generation.error.unsupported_platform',
      retryable: false,
    });
  }
}

export async function startStudyGenerationJob(
  input: StartStudyJobInput
): Promise<StudyGenerationJob> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyGenerationJob>('start_study_generation_job', { input });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function claimStudyJobStep(
  jobId: string,
  stepKey: string,
  leaseOwner: string,
  cancellationEpoch: number
): Promise<StudyGenerationStep> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyGenerationStep>('claim_study_job_step', {
      jobId,
      stepKey,
      leaseOwner,
      cancellationEpoch,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function completeStudyJobStep(
  input: CompleteStudyStepInput
): Promise<StudyJobProgress> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyJobProgress>('complete_study_job_step', { input });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function failStudyJobStep(
  input: FailStudyStepInput
): Promise<StudyJobProgress> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyJobProgress>('fail_study_job_step', { input });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function cancelStudyGenerationJob(
  jobId: string,
  cancellationEpoch: number
): Promise<void> {
  ensureNativeSupport();
  try {
    await invokeCommand<void>('cancel_study_generation_job', {
      jobId,
      cancellationEpoch,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function resumeStudyGenerationJob(
  jobId: string,
  preflight: StudyAiPreflight | Record<string, unknown>
): Promise<StudyGenerationJob> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyGenerationJob>('resume_study_generation_job', {
      jobId,
      preflight,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function recoverInterruptedStudyJobs(): Promise<StudyGenerationJob[]> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyGenerationJob[]>('recover_interrupted_study_jobs');
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function listStudyGenerationJobs(
  targetId?: string | null
): Promise<StudyGenerationJob[]> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyGenerationJob[]>('list_study_generation_jobs', {
      targetId: targetId ?? null,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}
