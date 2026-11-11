/**
 * Grading Recovery and Retry Utilities.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§6, 10, 11
 * - openspec/changes/implement-rubric-based-exam-grading/tasks.md (C5-T04)
 */

import { resumeStudyGenerationJob, cancelStudyGenerationJob } from '../../../api/study-generation';
import { runGradingCoordinator, type GradingCoordinatorResult, type RunGradingCoordinatorOptions } from './gradingCoordinator';
import type { AttemptDetail } from '../../../types/assessmentSessions';
import type { AssessmentQuestionRevision } from '../../../types/assessmentQuestions';

export interface GradingRecoveryStatus {
  totalQuestions: number;
  finalCount: number;
  needsReviewCount: number;
  failedCount: number;
  pendingCount: number;
  isFullyFinal: boolean;
  canRetry: boolean;
  canManualReview: boolean;
  needsReviewSubmissionIds: string[];
  failedSubmissionIds: string[];
}

/**
 * Inspects an attempt's current grades and determines its recovery and review state.
 */
export function checkGradingRecoveryStatus(attemptDetail: AttemptDetail): GradingRecoveryStatus {
  const currentGrades = (attemptDetail.currentGrades || []).filter((g) => g.isCurrent);
  const submissions = attemptDetail.submissions || [];

  let finalCount = 0;
  let needsReviewCount = 0;
  let failedCount = 0;

  const needsReviewSubmissionIds: string[] = [];
  const failedSubmissionIds: string[] = [];

  const gradedSubmissionIds = new Set<string>();

  for (const grade of currentGrades) {
    gradedSubmissionIds.add(grade.responseSubmissionId);
    if (grade.state === 'final') {
      finalCount++;
    } else if (grade.state === 'needs-review') {
      needsReviewCount++;
      needsReviewSubmissionIds.push(grade.responseSubmissionId);
    } else if (grade.state === 'failed') {
      failedCount++;
      failedSubmissionIds.push(grade.responseSubmissionId);
    }
  }

  // Submissions without any current grade are pending
  const pendingCount = submissions.filter((s) => !gradedSubmissionIds.has(s.id)).length;

  const totalQuestions =
    attemptDetail.attempt.questionRevisionIds?.length || submissions.length || currentGrades.length;

  const isFullyFinal =
    totalQuestions > 0 &&
    finalCount === totalQuestions &&
    needsReviewCount === 0 &&
    failedCount === 0 &&
    pendingCount === 0;

  const canRetry = failedCount > 0 || pendingCount > 0;
  const canManualReview = needsReviewCount > 0 || failedCount > 0;

  return {
    totalQuestions,
    finalCount,
    needsReviewCount,
    failedCount,
    pendingCount,
    isFullyFinal,
    canRetry,
    canManualReview,
    needsReviewSubmissionIds,
    failedSubmissionIds,
  };
}

/**
 * Retries failed or un-graded subjective submissions using a fresh job creation key.
 */
export async function retryFailedGrading(
  attemptDetail: AttemptDetail,
  questions: Map<string, AssessmentQuestionRevision> | AssessmentQuestionRevision[],
  options?: Partial<RunGradingCoordinatorOptions>
): Promise<GradingCoordinatorResult> {
  const freshCreationKey =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `retry_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return await runGradingCoordinator({
    ...options,
    attemptDetail,
    questions,
    creationKey: freshCreationKey,
    regrade: false, // only targets unfinalized/failed submissions
  });
}

/**
 * Explicitly initiates an intentional regrade of all subjective submissions
 * with a new UUID creation key.
 */
export async function regradeAllSubjective(
  attemptDetail: AttemptDetail,
  questions: Map<string, AssessmentQuestionRevision> | AssessmentQuestionRevision[],
  options?: Partial<RunGradingCoordinatorOptions>
): Promise<GradingCoordinatorResult> {
  const freshCreationKey =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `regrade_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return await runGradingCoordinator({
    ...options,
    attemptDetail,
    questions,
    creationKey: freshCreationKey,
    regrade: true,
  });
}

/**
 * Resumes an interrupted grading job from its last completed step.
 */
export async function resumeGradingJob(
  jobId: string,
  attemptDetail: AttemptDetail,
  questions: Map<string, AssessmentQuestionRevision> | AssessmentQuestionRevision[],
  options?: Partial<RunGradingCoordinatorOptions>
): Promise<GradingCoordinatorResult> {
  const preflight = options?.preflight || {
    providerId: 'local',
    generationDestination: 'local_device',
    embeddingDestination: null,
    featureAllowed: true,
    documentIds: [],
    sourceExcerptCount: 0,
    sendsSourceOffDevice: false,
    sendsAnswersOffDevice: false,
    billable: false,
    cloudDisclosureAccepted: true,
    costConsentAccepted: true,
    maximumModelCalls: 5,
  };

  // Signal resume to the native job repository
  await resumeStudyGenerationJob(jobId, preflight);

  return await runGradingCoordinator({
    ...options,
    attemptDetail,
    questions,
    creationKey: options?.creationKey,
    regrade: false,
  });
}

/**
 * Cancels an in-progress grading job.
 */
export async function cancelGrading(
  jobId: string,
  cancellationEpoch: number
): Promise<void> {
  await cancelStudyGenerationJob(jobId, cancellationEpoch);
}
