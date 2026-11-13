/**
 * Study AI Job Controller & Concurrency Manager.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/01-ARCHITECTURE.md §3.2, §9
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §10, §11
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T07)
 */

import {
  cancelStudyGenerationJob,
  listStudyGenerationJobs,
  recoverInterruptedStudyJobs,
} from '../../../api/study-generation';
import { StudyApiError } from '../../../api/study-plans';
import {
  runCurriculumCoordinator,
  type CoordinatorRunOptions,
  type CoordinatorRunResult,
} from './coordinator';
import {
  runModelOnlyCurriculumCoordinator,
  type ModelOnlyCurriculumGenerationRequest,
  type CoordinatorRunOptions as ModelOnlyCoordinatorRunOptions,
  type CoordinatorRunResult as ModelOnlyCoordinatorRunResult,
} from './modelOnlyCoordinator';
import type {
  CurriculumGenerationRequest,
  StudyAiPreflight,
  StudyGenerationJob,
  StudyJobProgress,
} from './types';

export const MAX_CONCURRENT_STUDY_JOBS = 2;

interface ActiveJobEntry {
  jobId: string;
  targetId: string;
  abortController: AbortController;
  promise: Promise<CoordinatorRunResult>;
}

export class StudyJobController {
  private activeJobs = new Map<string, ActiveJobEntry>();
  private subscribers = new Map<string, Set<(progress: StudyJobProgress) => void>>();

  /**
   * Current number of actively running in-memory jobs.
   */
  public get activeJobCount(): number {
    return this.activeJobs.size;
  }

  /**
   * Starts a curriculum generation job under global and target concurrency constraints.
   * - Enforces at most 2 Study jobs concurrently.
   * - Enforces at most 1 active job per target.
   */
  public async startCurriculumJob(
    request: CurriculumGenerationRequest,
    preflight: StudyAiPreflight,
    options: CoordinatorRunOptions = {}
  ): Promise<CoordinatorRunResult> {
    const targetId = request.planId;

    // 1. Enforce per-target concurrency synchronously (at most 1 active job per target)
    for (const entry of this.activeJobs.values()) {
      if (entry.targetId === targetId) {
        throw new StudyApiError({
          code: 'invalid_state',
          messageKey: 'study_generation.error.target_job_active',
          retryable: true,
        });
      }
    }

    // 2. Enforce global concurrency synchronously (at most 2 Study AI jobs concurrently)
    if (this.activeJobs.size >= MAX_CONCURRENT_STUDY_JOBS) {
      throw new StudyApiError({
        code: 'invalid_state',
        messageKey: 'study_generation.error.concurrency_limit',
        retryable: true,
      });
    }

    const abortController = new AbortController();
    const compositeSignal = options.signal
      ? this.combineAbortSignals(options.signal, abortController.signal)
      : abortController.signal;

    // Track a placeholder entry synchronously to reserve the concurrency slot
    const tempJobKey = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let assignedJobId = tempJobKey;

    const onProgress = (prog: StudyJobProgress) => {
      options.onProgress?.(prog);
      this.notifySubscribers(assignedJobId, prog);
    };

    const runPromise = (async () => {
      try {
        const result = await runCurriculumCoordinator(request, preflight, {
          ...options,
          signal: compositeSignal,
          onProgress,
          onJobStarted: (jobId) => {
            const entry = this.activeJobs.get(tempJobKey);
            if (entry) {
              this.activeJobs.delete(tempJobKey);
              entry.jobId = jobId;
              this.activeJobs.set(jobId, entry);
            }
            assignedJobId = jobId;
            options.onJobStarted?.(jobId);
          },
        });
        assignedJobId = result.jobId;
        return result;
      } finally {
        this.activeJobs.delete(tempJobKey);
        this.activeJobs.delete(assignedJobId);
      }
    })();

    this.activeJobs.set(tempJobKey, {
      jobId: tempJobKey,
      targetId,
      abortController,
      promise: runPromise,
    });

    return runPromise;
  }

  /**
   * Pauses an actively running job by aborting its in-memory task without
   * cancelling its SQLite row, allowing safe resumption later.
   */
  public pauseJob(jobId: string): boolean {
    const entry = this.findEntry(jobId);
    if (!entry) return false;
    entry.abortController.abort();
    return true;
  }

  /**
   * Cancels a job: aborts in-memory execution and calls the native cancel command.
   */
  public async cancelJob(jobId: string, cancellationEpoch = 0): Promise<void> {
    const entry = this.findEntry(jobId);
    if (entry) {
      entry.abortController.abort();
    }
    await cancelStudyGenerationJob(jobId, cancellationEpoch);
  }

  /**
   * Starts a model-only curriculum job under the same global and per-target
   * concurrency constraints as library-backed generation. This branch never
   * touches library, embedding, or web-research services.
   */
  public async startModelOnlyCurriculumJob(
    request: ModelOnlyCurriculumGenerationRequest,
    preflight: StudyAiPreflight,
    options: ModelOnlyCoordinatorRunOptions = {}
  ): Promise<ModelOnlyCoordinatorRunResult> {
    const targetId = request.planId;
    for (const entry of this.activeJobs.values()) {
      if (entry.targetId === targetId) {
        throw new StudyApiError({
          code: 'invalid_state',
          messageKey: 'study_generation.error.target_job_active',
          retryable: true,
        });
      }
    }
    if (this.activeJobs.size >= MAX_CONCURRENT_STUDY_JOBS) {
      throw new StudyApiError({
        code: 'invalid_state',
        messageKey: 'study_generation.error.concurrency_limit',
        retryable: true,
      });
    }

    const abortController = new AbortController();
    const compositeSignal = options.signal
      ? this.combineAbortSignals(options.signal, abortController.signal)
      : abortController.signal;

    const tempJobKey = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let assignedJobId = tempJobKey;

    const onProgress = (prog: StudyJobProgress) => {
      options.onProgress?.(prog);
      this.notifySubscribers(assignedJobId, prog);
    };

    const runPromise = (async () => {
      try {
        const result = await runModelOnlyCurriculumCoordinator(request, preflight, {
          ...options,
          signal: compositeSignal,
          onProgress,
          onJobStarted: (jobId) => {
            const entry = this.activeJobs.get(tempJobKey);
            if (entry) {
              this.activeJobs.delete(tempJobKey);
              entry.jobId = jobId;
              this.activeJobs.set(jobId, entry);
            }
            assignedJobId = jobId;
            options.onJobStarted?.(jobId);
          },
        });
        assignedJobId = result.jobId;
        return result;
      } finally {
        this.activeJobs.delete(tempJobKey);
        this.activeJobs.delete(assignedJobId);
      }
    })();

    this.activeJobs.set(tempJobKey, {
      jobId: tempJobKey,
      targetId,
      abortController,
      promise: runPromise,
    });

    return runPromise;
  }

  /**
   * Resumes an interrupted, paused, or failed model-only curriculum job.
   */
  public async resumeModelOnlyJob(
    jobId: string,
    request: ModelOnlyCurriculumGenerationRequest,
    freshPreflight: StudyAiPreflight,
    options: ModelOnlyCoordinatorRunOptions = {}
  ): Promise<ModelOnlyCoordinatorRunResult> {
    const jobs = await listStudyGenerationJobs(request.baseVersionId);
    const job = jobs.find((candidate) => candidate.id === jobId &&
      (candidate.status === 'interrupted' || candidate.status === 'failed'));
    if (!job) {
      throw new StudyApiError({ code: 'invalid_state', messageKey: 'study_generation.error.job_unavailable', retryable: true });
    }
    return this.startModelOnlyCurriculumJob(request, freshPreflight, { ...options, resumeFrom: job });
  }

  /**
   * Retries a failed model-only curriculum job.
   */
  public async retryModelOnlyJob(
    jobId: string,
    request: ModelOnlyCurriculumGenerationRequest,
    freshPreflight: StudyAiPreflight,
    options: ModelOnlyCoordinatorRunOptions = {}
  ): Promise<ModelOnlyCoordinatorRunResult> {
    return this.resumeModelOnlyJob(jobId, request, freshPreflight, options);
  }

  /**
   * Resumes an interrupted, paused, or failed job with fresh preflight.
   */
  public async resumeJob(
    jobId: string,
    request: CurriculumGenerationRequest,
    freshPreflight: StudyAiPreflight,
    options: CoordinatorRunOptions = {}
  ): Promise<CoordinatorRunResult> {
    const jobs = await listStudyGenerationJobs(request.baseVersionId);
    const job = jobs.find((candidate) => candidate.id === jobId &&
      (candidate.status === 'interrupted' || candidate.status === 'failed'));
    if (!job) {
      throw new StudyApiError({ code: 'invalid_state', messageKey: 'study_generation.error.job_unavailable', retryable: true });
    }
    return this.startCurriculumJob(request, freshPreflight, { ...options, resumeFrom: job });
  }

  /**
   * Retries a failed step of a job.
   */
  public async retryJob(
    jobId: string,
    request: CurriculumGenerationRequest,
    freshPreflight: StudyAiPreflight,
    options: CoordinatorRunOptions = {}
  ): Promise<CoordinatorRunResult> {
    return this.resumeJob(jobId, request, freshPreflight, options);
  }

  /**
   * Lists study generation jobs, optionally filtered by targetId.
   */
  public async listJobs(targetId?: string): Promise<StudyGenerationJob[]> {
    return listStudyGenerationJobs(targetId);
  }

  /**
   * Recovers any interrupted jobs from previous application sessions.
   */
  public async recoverInterrupted(): Promise<StudyGenerationJob[]> {
    return recoverInterruptedStudyJobs();
  }

  /**
   * Subscribes to progress updates for a specific job.
   */
  public subscribe(
    jobId: string,
    listener: (progress: StudyJobProgress) => void
  ): () => void {
    let subs = this.subscribers.get(jobId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(jobId, subs);
    }
    subs.add(listener);

    return () => {
      subs?.delete(listener);
      if (subs?.size === 0) {
        this.subscribers.delete(jobId);
      }
    };
  }

  /**
   * Notifies all subscribers of a progress update.
   */
  private notifySubscribers(jobId: string, progress: StudyJobProgress): void {
    const subs = this.subscribers.get(jobId);
    if (subs) {
      for (const sub of subs) {
        try {
          sub(progress);
        } catch {
          // Ignore subscriber errors
        }
      }
    }
  }

  /**
   * Finds an active entry by matching either tempKey or assigned jobId.
   */
  private findEntry(jobId: string): ActiveJobEntry | undefined {
    return this.activeJobs.get(jobId);
  }

  /**
   * Combines two AbortSignals into one.
   */
  private combineAbortSignals(sig1: AbortSignal, sig2: AbortSignal): AbortSignal {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (sig1.aborted || sig2.aborted) {
      controller.abort();
      return controller.signal;
    }
    sig1.addEventListener('abort', onAbort, { once: true });
    sig2.addEventListener('abort', onAbort, { once: true });
    return controller.signal;
  }
}

/** Global singleton instance */
export const studyJobController = new StudyJobController();
