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
import { StudyApiError, getStudyPlan } from '../../../api/study-plans';
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
import { AIError } from '../../ai/errors';
import { logModelFailure, modelFailure } from '../generation/modelFailure';
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
  type TopicInfo,
} from './evidencePlanner';
import {
  buildQuotaReport,
  translateAndFilterCandidates,
} from './generationMerge';
import { encodeQuestionRevision } from './questionCodec';
import { planQuotaSlots } from './quotaPlanner';
import { refreshCurriculumScope } from '../generation/curriculumPreflight';
import { performStudyAiPreflight, validatePreflightUnchanged } from '../generation/preflight';
import type { AITaskRoute } from '../../ai/tasks/router';

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
  getStudyPlanFn?: typeof getStudyPlan;
  refreshScopeFn?: typeof refreshCurriculumScope;
  preflightFn?: typeof performStudyAiPreflight;
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
  jobId: string | null;
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
  storedRefsOrResolver: Record<string, StudySourceResolution> | typeof resolveStudySourceRefs = {},
  resolveRefsMaybe = resolveStudySourceRefs
): Promise<StudySourceRefV1[]> {
  const storedRefs = typeof storedRefsOrResolver === 'function' ? {} : storedRefsOrResolver;
  const resolveRefsFn = typeof storedRefsOrResolver === 'function' ? storedRefsOrResolver : resolveRefsMaybe;
  const docs = sourceScope.resolvedDocuments || [];
  const inScope = new Map(docs.map((doc) => [doc.documentId, doc]));
  const persisted = Object.entries(storedRefs).filter(([, resolution]) => {
    const doc = inScope.get(resolution.ref.documentId);
    return resolution.status === 'current' && !!doc && resolution.ref.revision === doc.revision &&
      resolution.ref.revisionKind !== 'unknown' &&
      (sourceScope.selected.documentIds.includes(doc.documentId) ||
        !!resolution.ref.extractId && doc.extractIds.includes(resolution.ref.extractId));
  });
  if (!persisted.length) return [];
  const testInputs: StudySourceRefInput[] = persisted.map(([, resolution]) => ({
    documentId: resolution.ref.documentId,
    extractId: resolution.ref.extractId,
    documentTitle: resolution.ref.documentTitle,
    sourceType: resolution.ref.sourceType,
    excerpt: resolution.ref.excerpt,
    excerptSha256: resolution.ref.excerptSha256,
    revision: resolution.ref.revision,
    revisionKind: resolution.ref.revisionKind,
    jump: resolution.ref.jump,
    chunk: resolution.ref.chunk,
    sectionLabel: resolution.ref.sectionLabel,
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
  if (resolutions.length !== persisted.length) {
    throw new StudyApiError({ code: 'missing_source', messageKey: 'study_generation.error.source_missing', retryable: false });
  }

  const verifiedRefs: StudySourceRefV1[] = [];

  for (let i = 0; i < resolutions.length; i++) {
    const res = resolutions[i];
    const expected = inScope.get(res.ref.documentId);
    if (!expected) {
      throw new StudyApiError({ code: 'missing_source', messageKey: 'study_generation.error.source_missing', retryable: false });
    }
    if (!res?.ref || res.status !== 'current') {
      const stale = res.status === 'stale';
      throw new StudyApiError({
        code: stale ? 'stale_source' : 'missing_source',
        messageKey: stale ? 'study_generation.error.source_changed' : 'study_generation.error.source_missing',
        retryable: false,
      });
    }
    if (res.ref.revision && res.ref.revision !== expected.revision) {
      throw new StudyApiError({
        code: 'stale_source',
        messageKey: 'study_generation.error.source_changed',
        retryable: false,
      });
    }
    verifiedRefs.push({ ...res.ref, id: persisted[i][0] });
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
  const cancelJob = deps.cancelJobFn || cancelStudyGenerationJob;
  const resolveSourceRefs = deps.resolveSourceRefsFn || resolveStudySourceRefs;
  const getPlan = deps.getStudyPlanFn || getStudyPlan;
  const refreshScope = deps.refreshScopeFn || refreshCurriculumScope;
  const preflightFn = deps.preflightFn || performStudyAiPreflight;
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
  const detail = await getRevision(request.blueprintRevisionId);
  if (detail.blueprint.revision !== request.expectedRevision) {
    throw new StudyApiError({ code: 'stale_revision', messageKey: 'study_plan.error.stale_revision', retryable: true });
  }
  if (detail.revision.state === 'ready') {
    throw new StudyApiError({
      code: 'invalid_state',
      messageKey: 'study.assessment.error.cannot_modify_ready_revision',
      retryable: false,
    });
  }

  // 2. Verify source revisions
  const planDetail = detail.blueprint.planId && detail.revision.planVersionId
    ? await getPlan(detail.blueprint.planId, detail.revision.planVersionId)
    : null;
  if (planDetail) {
    if (planDetail.version.id !== detail.revision.planVersionId) {
      throw new StudyApiError({ code: 'stale_source', messageKey: 'study_generation.error.source_changed', retryable: false });
    }
    const planDocs = planDetail.version.sourceScope.resolvedDocuments;
    const blueprintDocs = detail.revision.sourceScope.resolvedDocuments;
    const sameFrozenScope = planDocs.length === blueprintDocs.length && planDocs.every((doc, index) => {
      const blueprintDoc = blueprintDocs[index];
      return doc.documentId === blueprintDoc.documentId && doc.revision === blueprintDoc.revision &&
        JSON.stringify([...doc.extractIds].sort()) === JSON.stringify([...blueprintDoc.extractIds].sort());
    });
    if (!sameFrozenScope) {
      throw new StudyApiError({ code: 'stale_source', messageKey: 'study_generation.error.source_changed', retryable: false });
    }
    await refreshScope(planDetail.version.sourceScope);
  }
  const verifiedSources = await verifyAssessmentSourceRevisions(
    detail.revision.sourceScope,
    planDetail?.sourceRefs || {},
    resolveSourceRefs
  );
  if (detail.revision.config.knowledgePolicy === 'source-only' && verifiedSources.length === 0) {
    throw new StudyApiError({ code: 'missing_source', messageKey: 'study.assessment.error.no_verified_passages', retryable: false });
  }

  const config = detail.revision.config;
  const slots: QuotaSlot[] = planQuotaSlots(config, detail.revision.id);
  const existingFingerprints = new Set(detail.questions.map((question) => question.fingerprint).filter(Boolean));
  const savedSlotKeys = new Set(detail.questions.filter((question) => question.validation === 'valid').map((question) => question.slotKey));
  const acceptedSlotKeys = new Set(slots.filter((slot) => savedSlotKeys.has(slot.slotKey)).map((slot) => slot.slotKey));
  const pendingSlots = slots.filter((slot) => !acceptedSlotKeys.has(slot.slotKey));

  if (!pendingSlots.length) {
    return {
      jobId: null,
      blueprintDetail: detail,
      quotaReport: buildQuotaReport(slots.length, slots, acceptedSlotKeys, [], [], false),
      acceptedCount: acceptedSlotKeys.size,
      deficitsCount: 0,
      callsMade: 0,
    };
  }

  const nodesById = new Map(planDetail?.version.nodes?.filter((node) => node.included).map((node) => [node.nodeId, node]));
  const topics = config.topicTargets.flatMap<TopicInfo>((target, index) => {
    const node = target.nodeId ? nodesById.get(target.nodeId) : undefined;
    return node ? [{
      index,
      title: node.title,
      conceptLabel: node.conceptLabel,
      objectives: node.learningObjectives,
      sourceRefIds: node.sourceRefIds,
    }] : [];
  });
  const batchSize = resolveBatchSize(request.isMobile);
  const plannedBatches = planQuestionBatches({
    slots: pendingSlots,
    sourceRefs: verifiedSources,
    topicTargets: config.topicTargets,
    topics,
    maxBatchSize: batchSize,
  });
  const modelCallBudget = calculateModelCallBudget(pendingSlots.length, batchSize);
  if (modelCallBudget > preflight.maximumModelCalls) {
    throw new StudyApiError({ code: 'invalid_input', messageKey: 'study_generation.error.model_call_budget_exceeded', retryable: false });
  }

  const requestHash = sha256(JSON.stringify({
    revisionId: detail.revision.id,
    targetRevision: detail.blueprint.revision,
    config,
    pendingSlots: pendingSlots.map((slot) => slot.slotKey),
    snapshotHash: detail.revision.sourceSnapshotHash,
  }));
  const taskInputs = plannedBatches.map((batch) => ({
    stepKey: batch.stepKey,
    slots: batch.slots,
    sources: batch.sources,
    topicEvidence: batch.topicEvidence,
    knowledgePolicy: config.knowledgePolicy,
    excludedFingerprints: config.excludedQuestionFingerprints,
  } satisfies Omit<StudyQuestionTaskInput, 'jobId'>));
  const steps: CreateStudyStepInput[] = taskInputs.map((input, ordinal) => ({
    stepKey: input.stepKey,
    ordinal,
    inputHash: sha256(JSON.stringify(input)),
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
  if (job.creationKey !== creationKey) {
    throw new StudyApiError({ code: 'invalid_state', messageKey: 'study_generation.error.target_job_active', retryable: true });
  }
  const authorizedPreflight = { ...preflight };

  const allDuplicates: string[] = [];
  const allIssues: Array<{ path: string; code: string; messageKey: string }> = [];
  let callsMade = 0;

  // 6. Execution Loop
  for (let idx = 0; idx < plannedBatches.length; idx++) {
    const batch = plannedBatches[idx];

    if (signal?.aborted) {
      await cancelJob(job.id, job.cancellationEpoch).catch(() => undefined);
      throw new StudyApiError({ code: 'cancelled', messageKey: 'study_generation.error.cancelled', retryable: false });
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

    const taskInput = { ...taskInputs[idx], jobId: job.id };

    try {
      if (!planDetail) throw new StudyApiError({ code: 'missing_source', messageKey: 'study_generation.error.source_missing', retryable: false });
      const liveScope = await refreshScope(planDetail.version.sourceScope);
      const authorization = await preflightFn({
        primaryTask: studyQuestionTask,
        documents: liveScope.resolvedDocuments.map((doc) => ({ id: doc.documentId, isAiExcluded: doc.isAiExcluded, isLocalOnly: doc.isLocalOnly })),
        sourceExcerptCount: batch.sources.length,
        plannedModelSteps: plannedBatches.length,
        cloudDisclosureAccepted: authorizedPreflight.cloudDisclosureAccepted,
        costConsentAccepted: authorizedPreflight.costConsentAccepted,
        inspectOnly: false,
        selectedConfigId: authorizedPreflight.model?.configId,
      });
      validatePreflightUnchanged(authorizedPreflight, authorization.route);
      const preflightRoute: AITaskRoute = authorization.route;
      if (authorization.preflight.maximumModelCalls < modelCallBudget || callsMade + 2 > authorizedPreflight.maximumModelCalls) {
        throw new StudyApiError({ code: 'invalid_input', messageKey: 'study_generation.error.model_call_budget_exceeded', retryable: false });
      }
      const taskResult = await runPinned(
        studyQuestionTask,
        taskInput,
        {
          signal,
          targetId: `${job.id}:${batch.stepKey}`,
          preflightRoute,
        },
        preflight
      ).catch((error: unknown) => {
        if (!(error instanceof AIError) || error.category !== 'InvalidStructuredOutput') throw error;
        logModelFailure(job.id, batch.stepKey, error);
        callsMade += error.completion?.attemptCount ?? 1;
        const issue = modelFailure(error);
        allIssues.push({ path: `steps.${batch.stepKey}`, code: issue.code, messageKey: issue.messageKey });
        return null;
      });

      signal?.throwIfAborted();
      if (taskResult) {
        callsMade += taskResult.validationOutcome === 'repaired' ? 2 : 1;
        await refreshScope(planDetail.version.sourceScope);
        const batchOutput = taskResult.output;
        const provenance: GenerationProvenance = {
          taskId: taskResult.taskId,
          providerId: taskResult.providerId,
          endpointLocality: typeof authorization.preflight.generationDestination === 'object'
            ? authorization.preflight.generationDestination.locality : 'unknown',
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
      }

      // Complete step
      const isFinal = idx === plannedBatches.length - 1;
      await completeStep({
        jobId: job.id,
        stepKey: batch.stepKey,
        leaseOwner,
        cancellationEpoch: job.cancellationEpoch,
        inputHash: steps[idx].inputHash,
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
        await cancelJob(job.id, job.cancellationEpoch).catch(() => undefined);
        throw new StudyApiError({ code: 'cancelled', messageKey: 'study_generation.error.cancelled', retryable: false });
      }

      if (err instanceof AIError) logModelFailure(job.id, batch.stepKey, err);
      const error = err instanceof AIError ? new StudyApiError(modelFailure(err)) : err;
      await failStep({
        jobId: job.id,
        stepKey: batch.stepKey,
        leaseOwner,
        cancellationEpoch: job.cancellationEpoch,
        error: error instanceof StudyApiError
          ? { code: error.code, messageKey: error.messageKey, retryable: error.retryable }
          : { code: 'internal_error', messageKey: 'study_generation.error.step_stopped', retryable: true },
      }).catch(() => undefined);
      throw error;
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
