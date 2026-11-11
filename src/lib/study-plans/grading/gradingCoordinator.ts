/**
 * Durable Rubric-Based Exam Grading Coordinator.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§6, 10, 11
 * - openspec/changes/implement-rubric-based-exam-grading/tasks.md (C5-T04)
 */

import {
  startStudyGenerationJob,
  claimStudyJobStep,
  completeStudyJobStep,
  failStudyJobStep,
  cancelStudyGenerationJob,
} from '../../../api/study-generation';
import { getExamAttempt } from '../../../api/exam-sessions';
import { recordRubricGrade } from '../../../api/exam-grading';
import { StudyApiError } from '../../../api/study-plans';
import { runPinnedStudyTask } from '../generation/pinnedTask';
import {
  studyRubricGradeTask,
  type SourceEvidenceSnippet,
} from '../../ai/tasks/definitions/rubricGradingTask';
import { aggregateRubric } from './rubricAggregation';
import { checkGradingConsistency } from './consistencyChecks';
import {
  planGradingJob,
  type PendingGradingItem,
} from './gradingJobPlanner';
import type {
  AttemptDetail,
  GradeSettlementOutcome,
  CriterionJudgmentInput,
} from '../../../types/assessmentSessions';
import type {
  AssessmentQuestionRevision,
  ShortAnswerQuestion,
  EssayQuestion,
} from '../../../types/assessmentQuestions';
import type {
  StudyAiPreflight,
  StudyJobProgress,
} from '../generation/types';
import type { StudyCommandError } from '../../../types/learningPaths';

export interface GradingCoordinatorDependencies {
  startJobFn?: typeof startStudyGenerationJob;
  claimStepFn?: typeof claimStudyJobStep;
  completeStepFn?: typeof completeStudyJobStep;
  failStepFn?: typeof failStudyJobStep;
  cancelJobFn?: typeof cancelStudyGenerationJob;
  getAttemptFn?: typeof getExamAttempt;
  recordRubricGradeFn?: typeof recordRubricGrade;
  runPinnedTaskFn?: typeof runPinnedStudyTask;
}

export interface RunGradingCoordinatorOptions {
  attemptDetail: AttemptDetail;
  questions: Map<string, AssessmentQuestionRevision> | AssessmentQuestionRevision[];
  preflight?: StudyAiPreflight | Record<string, unknown>;
  leaseOwner?: string;
  creationKey?: string;
  regrade?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: StudyJobProgress) => void;
  deps?: GradingCoordinatorDependencies;
}

export interface GradingCoordinatorResult {
  jobId: string;
  attemptId: string;
  completedSteps: number;
  totalSteps: number;
  outcomes: GradeSettlementOutcome[];
  latestAttemptDetail: AttemptDetail;
}

/**
 * Runs the durable rubric exam grading coordinator over pending subjective questions.
 */
export async function runGradingCoordinator(
  options: RunGradingCoordinatorOptions
): Promise<GradingCoordinatorResult> {
  const deps = options.deps || {};
  const startJob = deps.startJobFn || startStudyGenerationJob;
  const claimStep = deps.claimStepFn || claimStudyJobStep;
  const completeStep = deps.completeStepFn || completeStudyJobStep;
  const failStep = deps.failStepFn || failStudyJobStep;
  const cancelJob = deps.cancelJobFn || cancelStudyGenerationJob;
  const getAttempt = deps.getAttemptFn || getExamAttempt;
  const recordGrade = deps.recordRubricGradeFn || recordRubricGrade;
  const runPinned = deps.runPinnedTaskFn || runPinnedStudyTask;

  const leaseOwner =
    options.leaseOwner ||
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `lease_${Date.now()}`);

  const planned = planGradingJob({
    attemptDetail: options.attemptDetail,
    questions: options.questions,
    preflight: options.preflight,
    creationKey: options.creationKey,
    regrade: options.regrade,
  });

  // If no subjective questions require grading, return immediately
  if (!planned || planned.jobInput.steps.length === 0) {
    return {
      jobId: '',
      attemptId: options.attemptDetail.attempt.id,
      completedSteps: 0,
      totalSteps: 0,
      outcomes: [],
      latestAttemptDetail: options.attemptDetail,
    };
  }

  const { jobInput, pendingItems } = planned;

  // Start native job
  const job = await startJob(jobInput);

  let currentAttemptDetail = options.attemptDetail;
  let currentAttemptRevision = currentAttemptDetail.attempt.revision;
  const outcomes: GradeSettlementOutcome[] = [];

  const pendingItemBySubmissionId = new Map<string, PendingGradingItem>();
  for (const item of pendingItems) {
    pendingItemBySubmissionId.set(item.submission.id, item);
  }

  for (let stepIdx = job.nextStepIndex; stepIdx < jobInput.steps.length; stepIdx++) {
    const plannedStep = jobInput.steps[stepIdx];
    const submissionId = plannedStep.stepKey.replace(/^grade:/, '');
    const pendingItem = pendingItemBySubmissionId.get(submissionId);

    if (!pendingItem) {
      continue;
    }

    // Fail-closed cancellation check before claiming
    if (options.signal?.aborted) {
      await cancelJob(job.id, job.cancellationEpoch);
      throw new StudyApiError({
        code: 'cancelled',
        messageKey: 'study_generation.error.cancelled',
        retryable: false,
      });
    }

    // Claim step
    const claimedStep = await claimStep(
      job.id,
      plannedStep.stepKey,
      leaseOwner,
      job.cancellationEpoch
    );

    const questionRevision = pendingItem.question;
    const question = questionRevision.question as ShortAnswerQuestion | EssayQuestion;
    const studentText =
      'text' in pendingItem.submission.response &&
      typeof pendingItem.submission.response.text === 'string'
        ? pendingItem.submission.response.text
        : '';

    // Build source snippets from question source refs if available
    const sources: SourceEvidenceSnippet[] = (question.sourceRefIds || []).map(
      (refId, idx) => ({
        handle: `s_${idx}`,
        excerpt: `Source material for ${refId}`,
      })
    );

    const taskInput = {
      jobId: job.id,
      stepKey: claimedStep.stepKey,
      attemptId: currentAttemptDetail.attempt.id,
      responseSubmissionId: pendingItem.submission.id,
      questionRevision,
      studentResponse: studentText,
      sources,
    };

    let taskResult;
    try {
      taskResult = await runPinned(
        studyRubricGradeTask,
        taskInput,
        {
          signal: options.signal,
          targetId: `${job.id}:${claimedStep.stepKey}`,
        },
        job.preflight as StudyAiPreflight
      );
    } catch {
      // Step failed or interrupted
      const safeError: StudyCommandError = {
        code: 'grading_unavailable',
        messageKey: 'study.grading.error.failed',
        retryable: true,
      };

      await failStep({
        jobId: job.id,
        stepKey: claimedStep.stepKey,
        leaseOwner,
        cancellationEpoch: job.cancellationEpoch,
        error: safeError,
      });

      // Record a failed AI grade record in history if an actual attempt was made
      try {
        const failOutcome = await recordGrade({
          attemptId: currentAttemptDetail.attempt.id,
          responseSubmissionId: pendingItem.submission.id,
          questionRevisionId: questionRevision.id,
          expectedAttemptRevision: currentAttemptRevision,
          state: 'failed',
          points: null,
          maxPoints: question.maxPoints,
          normalizedScore: null,
          criteria: [],
          jobId: job.id,
          stepKey: claimedStep.stepKey,
        });
        outcomes.push(failOutcome);
        currentAttemptRevision = failOutcome.attemptRevision;
      } catch {
        // If recording failed grade fails (e.g. stale revision), ignore and continue
      }

      continue;
    }

    // Task succeeded: evaluate proposal and compute deterministic points
    const proposal = taskResult.output;
    const aggregate = aggregateRubric(question.rubric, proposal.criteria, question.maxPoints);
    const consistency = checkGradingConsistency(
      proposal,
      aggregate,
      question.kind
    );

    const gradeState = consistency.state;
    const officialPoints = consistency.officialPoints;

    const criteriaInputs: CriterionJudgmentInput[] = proposal.criteria.map((c) => {
      if (c.status === 'assessed') {
        return {
          criterionId: c.criterionId,
          status: 'assessed',
          level: c.level,
          answerEvidence: c.answerEvidence,
          rationale: c.rationale,
          missingConceptsJson: JSON.stringify(c.missingConcepts || []),
          misconception: c.misconception || null,
          sourceRefIdsJson: JSON.stringify(c.sourceRefIds || []),
          notAssessableReason: null,
        };
      } else {
        return {
          criterionId: c.criterionId,
          status: 'not-assessable',
          level: null,
          answerEvidence: null,
          rationale: null,
          missingConceptsJson: null,
          misconception: null,
          sourceRefIdsJson: null,
          notAssessableReason: c.reason,
        };
      }
    });

    const limitationsMerged = Array.from(new Set([...(proposal.limitations || [])]));

    const settlementOutcome = await recordGrade({
      attemptId: currentAttemptDetail.attempt.id,
      responseSubmissionId: pendingItem.submission.id,
      questionRevisionId: questionRevision.id,
      expectedAttemptRevision: currentAttemptRevision,
      state: gradeState,
      points: officialPoints,
      maxPoints: question.maxPoints,
      normalizedScore: aggregate.normalized,
      assessmentJson: JSON.stringify(proposal.assessment),
      criteria: criteriaInputs,
      provenanceJson: JSON.stringify(taskResult.provenance),
      limitationsJson: JSON.stringify(limitationsMerged),
      jobId: job.id,
      stepKey: claimedStep.stepKey,
    });

    outcomes.push(settlementOutcome);
    currentAttemptRevision = settlementOutcome.attemptRevision;

    const progress: StudyJobProgress = {
      completed: stepIdx + 1,
      total: jobInput.steps.length,
      labelKey: 'study.grading.progress.grading',
    };

    if (options.onProgress) {
      options.onProgress(progress);
    }

    await completeStep({
      jobId: job.id,
      stepKey: claimedStep.stepKey,
      leaseOwner,
      cancellationEpoch: job.cancellationEpoch,
      inputHash: plannedStep.inputHash,
      outputRefId: settlementOutcome.gradeId,
      nextStepIndex: stepIdx + 1,
      progress,
      status: stepIdx + 1 === jobInput.steps.length ? 'completed' : 'running',
    });
  }

  // Reload final fresh attempt detail
  try {
    currentAttemptDetail = await getAttempt(currentAttemptDetail.attempt.id);
  } catch {
    // If reload fails in test or disconnected env, preserve latest cached
  }

  return {
    jobId: job.id,
    attemptId: currentAttemptDetail.attempt.id,
    completedSteps: outcomes.length,
    totalSteps: jobInput.steps.length,
    outcomes,
    latestAttemptDetail: currentAttemptDetail,
  };
}
