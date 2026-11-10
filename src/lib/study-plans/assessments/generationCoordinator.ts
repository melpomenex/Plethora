/**
 * Durable Assessment Question Generation Coordinator.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/01-ARCHITECTURE.md §3.2, §4, §8
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §4.1, §5.2, §10, §11
 * - openspec/changes/generate-study-plan-examinations/ (C3-T07)
 */

import {
  cancelStudyGenerationJob,
  claimStudyJobStep,
  completeStudyJobStep,
  failStudyJobStep,
  startStudyGenerationJob,
} from '../../../api/study-generation';
import { StudyApiError } from '../../../api/study-plans';
import { resolveStudySourceRefs } from '../../../api/study-sources';
import type {
  BlueprintDetail,
  GenerationProvenance,
  QuotaReport,
  QuotaSlot,
} from '../../../types/assessmentQuestions';
import type {
  StudySourceRefInput,
  StudySourceRefV1,
  StudySourceResolution,
  StudySourceScopeV1,
} from '../../../types/studySource';
import type {
  CreateStudyStepInput,
  StartStudyJobInput,
  StudyAiPreflight,
  StudyJobProgress,
} from '../generation/types';
import { runPinnedStudyTask } from '../generation/pinnedTask';
import { sha256 } from '../generation/requestHash';
import {
  studyQuestionTask,
  type StudyQuestionTaskInput,
} from '../../ai/tasks/definitions/studyQuestionTasks';
import { BlueprintService } from './blueprintService';
import {
  calculateModelCallBudget,
  planQuestionBatches,
  resolveBatchSize,
  type QuestionBatchPlan,
} from './evidencePlanner';
import {
  buildQuotaReport,
  translateAndFilterCandidates,
} from './generationMerge';
import { encodeQuestionRevision } from './questionCodec';
import { planQuotaSlots } from './quotaPlanner';

export interface AssessmentGenerationRequest {
  blueprintRevisionId: string;
  expectedRevision: number;
  planId?: string | null;
  isMobile?: boolean;
}

export interface AssessmentCoordinatorDependencies {
  getBlueprintRevisionFn?: typeof BlueprintService.getBlueprintRevision;
  saveBlueprintDraftFn?: typeof BlueprintService.saveBlueprintDraft;
  saveQuestionDraftFn?: typeof BlueprintService.saveQuestionDraft;
  startJobFn?: typeof startStudyGenerationJob;
  claimStepFn?: typeof claimStudyJobStep;
  completeStepFn?: typeof completeStudyJobStep;
  failStepFn?: typeof failStudyJobStep;
  cancelJobFn?: typeof cancelStudyGenerationJob;
  resolveSourceRefsFn?: typeof resolveStudySourceRefs;
  runPinnedTaskFn?: typeof runPinnedStudyTask;
}

export interface AssessmentCoordinatorOptions {
  leaseOwner?: string;
  creationKey?: string;
  signal?: AbortSignal;
  onProgress?: (progress: StudyJobProgress) => void;
  deps?: AssessmentCoordinatorDependencies;
}

export interface AssessmentCoordinatorResult {
  jobId: string;
  blueprintDetail: BlueprintDetail;
  quotaReport: QuotaReport;
  acceptedCount: number;
  deficitsCount: number;
  callsMade: number;
}

/**
 * Rechecks that live source revisions still match the frozen blueprint source scope.
 */
export async function verifyAssessmentSourceRevisions(
  sourceScope: StudySourceScopeV1,
  resolveRefsFn = resolveStudySourceRefs
): Promise<StudySourceRefV1[]> {
  const docs = sourceScope.resolvedDocuments || [];
  if (docs.length === 0) return [];

  const testInputs: StudySourceRefInput[] = docs.map((d) => ({
    documentId: d.documentId,
    documentTitle: d.title,
    sourceType: d.sourceType,
    excerpt: `Source document: ${d.title}`,
    revision: d.revision,
  }));

  let resolutions: StudySourceResolution[] = [];
  try {
    resolutions = await resolveRefsFn(testInputs);
  } catch {
    throw new StudyApiError({
      code: 'missing_source',
      messageKey: 'study_generation.error.source_missing',
      retryable: false,
    });
  }

  const verifiedRefs: StudySourceRefV1[] = [];

  for (let i = 0; i < resolutions.length; i++) {
    const res = resolutions[i];
    const expected = docs[i];
    if (res.status === 'missing') {
      throw new StudyApiError({
        code: 'missing_source',
        messageKey: 'study_generation.error.source_missing',
        retryable: false,
      });
    }
    if (res.status === 'stale' || (res.ref.revision && res.ref.revision !== expected.revision)) {
      throw new StudyApiError({
        code: 'stale_source',
        messageKey: 'study_generation.error.source_changed',
        retryable: false,
      });
    }
    verifiedRefs.push(res.ref);
  }

  return verifiedRefs;
}

/**
 * Runs the durable question generation coordinator.
 */
export async function runAssessmentGenerationCoordinator(
  request: AssessmentGenerationRequest,
  preflight: StudyAiPreflight,
  options: AssessmentCoordinatorOptions = {}
): Promise<AssessmentCoordinatorResult> {
  const deps = options.deps || {};
  const getRevision = deps.getBlueprintRevisionFn || BlueprintService.getBlueprintRevision;
  const saveDraft = deps.saveBlueprintDraftFn || BlueprintService.saveBlueprintDraft;
  const saveQuestion = deps.saveQuestionDraftFn || BlueprintService.saveQuestionDraft;
  const startJob = deps.startJobFn || startStudyGenerationJob;
  const claimStep = deps.claimStepFn || claimStudyJobStep;
  const completeStep = deps.completeStepFn || completeStudyJobStep;
  const failStep = deps.failStepFn || failStudyJobStep;
  const resolveSourceRefs = deps.resolveSourceRefsFn || resolveStudySourceRefs;
  const runPinned = deps.runPinnedTaskFn || runPinnedStudyTask;

  const leaseOwner =
    options.leaseOwner || `lease_aq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const creationKey =
    options.creationKey || `ck_aq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const signal = options.signal;

  if (signal?.aborted) {
    throw new StudyApiError({
      code: 'cancelled',
      messageKey: 'study_generation.error.cancelled',
      retryable: false,
    });
  }

  // 1. Fetch blueprint revision
  let detail = await getRevision(request.blueprintRevisionId);
  if (detail.revision.state === 'ready') {
    throw new StudyApiError({
      code: 'invalid_state',
      messageKey: 'study.assessment.error.cannot_modify_ready_revision',
      retryable: false,
    });
  }

  // 2. Verify source revisions
  const verifiedSources = await verifyAssessmentSourceRevisions(
    detail.revision.sourceScope,
    resolveSourceRefs
  );

  // 3. Quota allocation & slots construction
  const config = detail.revision.config;
  const slots: QuotaSlot[] = planQuotaSlots(config, detail.revision.id);

  // 4. Batch planning
  const batchSize = resolveBatchSize(request.isMobile);
  const plannedBatches: QuestionBatchPlan[] = planQuestionBatches({
    slots,
    sourceRefs: verifiedSources,
    topicTargets: config.topicTargets,
    isMobile: request.isMobile,
    maxBatchSize: batchSize,
  });

  const modelCallBudget = calculateModelCallBudget(slots.length, batchSize);

  // 5. Start native job
  const requestHash = sha256(
    JSON.stringify({
      revisionId: detail.revision.id,
      config,
      slotsCount: slots.length,
      snapshotHash: detail.revision.sourceSnapshotHash,
    })
  );

  const steps: CreateStudyStepInput[] = plannedBatches.map((b, idx) => ({
    stepKey: b.stepKey,
    ordinal: idx + 1,
    inputHash: sha256(JSON.stringify({ stepKey: b.stepKey, requestHash })),
  }));

  const startInput: StartStudyJobInput = {
    kind: 'assessment-generation',
    targetId: detail.revision.id,
    targetRevision: detail.blueprint.revision,
    creationKey,
    requestHash,
    preflight,
    steps,
  };

  const job = await startJob(startInput);

  // Track state across steps
  const existingFingerprints = new Set<string>();
  const acceptedSlotKeys = new Set<string>();
  for (const q of detail.questions) {
    if (q.fingerprint) existingFingerprints.add(q.fingerprint);
    if (q.slotKey) acceptedSlotKeys.add(q.slotKey);
  }

  const allDuplicates: string[] = [];
  const allIssues: Array<{ path: string; code: string; messageKey: string }> = [];
  let callsMade = 0;

  // 6. Execution Loop
  for (let idx = 0; idx < plannedBatches.length; idx++) {
    const batch = plannedBatches[idx];

    // Check cancellation
    if (signal?.aborted) {
      throw new StudyApiError({
        code: 'cancelled',
        messageKey: 'study_generation.error.cancelled',
        retryable: false,
      });
    }

    // Report progress
    options.onProgress?.({
      completed: idx,
      total: plannedBatches.length,
      labelKey: 'study.assessment.progress.generating_questions',
    });

    // Claim step
    const lease = await claimStep(job.id, batch.stepKey, leaseOwner, job.cancellationEpoch);

    // If step was already completed, skip
    if (lease.status === 'completed') {
      continue;
    }

    // Check call budget cap: at most 2 * ceil(N / batchSize)
    if (callsMade >= modelCallBudget) {
      await failStep({
        jobId: job.id,
        stepKey: batch.stepKey,
        leaseOwner,
        cancellationEpoch: job.cancellationEpoch,
        error: {
          code: 'quota_shortfall',
          messageKey: 'study.assessment.error.model_call_budget_exceeded',
          retryable: false,
        },
      });
      continue;
    }

    const taskInput: StudyQuestionTaskInput = {
      jobId: job.id,
      stepKey: batch.stepKey,
      slots: batch.slots,
      sources: batch.sources,
      topicEvidence: batch.topicEvidence,
      knowledgePolicy: config.knowledgePolicy,
      excludedFingerprints: config.excludedQuestionFingerprints,
    };

    try {
      callsMade++;
      const taskResult = await runPinned(
        studyQuestionTask,
        taskInput,
        {
          signal,
          targetId: `${job.id}:${batch.stepKey}`,
        },
        preflight
      );

      const batchOutput = taskResult.output;
      const provenance: GenerationProvenance = {
        taskId: taskResult.taskId,
        providerId: taskResult.providerId,
        endpointLocality: taskResult.providerKind === 'ondevice' ? 'device' : 'remote',
        requestedModelClass: taskResult.requestedModelClass,
        servedModelClass: taskResult.servedModelClass,
        fallbackPath: taskResult.fallbackPath,
        validationOutcome: taskResult.validationOutcome,
        baseModelName: taskResult.baseModelName,
        promptContractVersion: 'study-ai-v1',
        usage: taskResult.usage,
      };

      // Translate, validate, and screen duplicates
      const mergeRes = translateAndFilterCandidates({
        batch: batchOutput,
        batchPlan: batch,
        existingFingerprints,
        excludedFingerprints: config.excludedQuestionFingerprints,
      });

      // Persist accepted candidates to SQLite via blueprint repository
      for (const candidate of mergeRes.acceptedCandidates) {
        const encoded = encodeQuestionRevision(candidate.question);

        await saveQuestion({
          blueprintRevisionId: detail.revision.id,
          slotKey: candidate.slotKey,
          fingerprint: candidate.fingerprint,
          kind: candidate.question.kind,
          payloadJson: encoded.payloadJson,
          answerKeyJson: encoded.answerKeyJson,
          rubricJson: encoded.rubricJson,
          maxPoints: candidate.question.maxPoints,
          difficulty: candidate.question.difficulty,
          validation: 'valid',
          validationIssuesJson: null,
          providerJson: JSON.stringify(provenance),
          sourceRefIds: candidate.question.sourceRefIds,
          targets: candidate.question.learningObjectives.map((obj) => ({
            conceptLabel: obj,
            objectiveText: obj,
          })),
        });

        acceptedSlotKeys.add(candidate.slotKey);
      }

      allDuplicates.push(...mergeRes.duplicateFingerprints);
      allIssues.push(...mergeRes.issues);

      // Complete step
      const isFinal = idx === plannedBatches.length - 1;
      await completeStep({
        jobId: job.id,
        stepKey: batch.stepKey,
        leaseOwner,
        cancellationEpoch: job.cancellationEpoch,
        inputHash: sha256(JSON.stringify(taskInput)),
        outputRefId: null,
        nextStepIndex: idx + 1,
        progress: {
          completed: idx + 1,
          total: plannedBatches.length,
          labelKey: 'study.assessment.progress.batch_complete',
        },
        status: isFinal ? 'awaiting-review' : 'running',
      });
    } catch (err) {
      if (signal?.aborted) {
        throw new StudyApiError({
          code: 'cancelled',
          messageKey: 'study_generation.error.cancelled',
          retryable: false,
        });
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      await failStep({
        jobId: job.id,
        stepKey: batch.stepKey,
        leaseOwner,
        cancellationEpoch: job.cancellationEpoch,
        error: {
          code: 'invalid_model_output',
          messageKey: errMsg,
          retryable: true,
        },
      });
      allIssues.push({
        path: `steps.${batch.stepKey}`,
        code: 'step_failed',
        messageKey: errMsg,
      });
    }
  }

  // 7. Build updated QuotaReport with exact deficits
  const quotaReport = buildQuotaReport(
    config.requestedCount,
    slots,
    acceptedSlotKeys,
    allDuplicates,
    allIssues,
    false
  );

  // 8. Update blueprint revision draft with final quota report
  const updatedDetail = await saveDraft({
    revisionId: detail.revision.id,
    expectedRevision: detail.blueprint.revision,
    config: {
      ...config,
    },
  });

  return {
    jobId: job.id,
    blueprintDetail: updatedDetail,
    quotaReport,
    acceptedCount: quotaReport.accepted,
    deficitsCount: quotaReport.deficits.reduce((sum, d) => sum + d.count, 0),
    callsMade,
  };
}
