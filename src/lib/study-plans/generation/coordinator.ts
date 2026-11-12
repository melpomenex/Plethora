/**
 * Durable Curriculum Generation Coordinator.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/01-ARCHITECTURE.md §3.2, §4, §8
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §3.3, §10, §11
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T07)
 */

import {
  validateDecomposeOutputForTask,
  validatePrerequisiteOutputForTask,
} from '../../ai/schemas/curriculumGeneration';
import {
  curriculumDecomposeTask,
  curriculumPrerequisiteTask,
  type CurriculumDecomposeTaskInput,
  type CurriculumPrerequisiteTaskInput,
  type TopicEvidenceItem,
} from '../../ai/tasks/definitions/curriculumTasks';
import {
  cancelStudyGenerationJob,
  claimStudyJobStep,
  completeStudyJobStep,
  failStudyJobStep,
  resumeStudyGenerationJob,
  startStudyGenerationJob,
} from '../../../api/study-generation';
import {
  getStudyPlan,
  saveStudyPlanDraft,
  StudyApiError,
} from '../../../api/study-plans';
import { resolveStudySourceRefs } from '../../../api/study-sources';
import type {
  SaveStudyPlanDraftInput,
  StudyPlanDetail,
} from '../../../types/learningPaths';
import type {
  StudySourceRefInput,
  StudySourceResolution,
  StudySourceScopeV1,
} from '../../../types/studySource';
import {
  hydrateCurriculumEvidence,
  type HydratedEvidenceResult,
} from './evidence';
import { mergeCurriculumProposals, type MergeCurriculumResult } from './merge';
import { EVIDENCE_LIMITS } from './planEvidence';
import { runPinnedStudyTask } from './pinnedTask';
import { computeRequestHash, sha256 } from './requestHash';
import { countIndexedCurriculumSources, prepareCurriculumPreflight, refreshCurriculumScope } from './curriculumPreflight';
import { evaluateStudyPrivacy } from './privacy';
import { classifyRouteDestination, validatePreflightUnchanged } from './preflight';
import { resolveTaskRoute } from '../../ai/tasks/router';
import { AIError } from '../../ai/errors';
import { logModelFailure, MALFORMED_OUTPUT, modelFailure } from './modelFailure';
import type { AITaskResult } from '../../ai/tasks/types';
import type {
  CreateStudyStepInput,
  CurriculumGenerationRequest,
  CurriculumExecutionStats,
  CurriculumEdgeProposal,
  StartStudyJobInput,
  StudyAiPreflight,
  StudyJobProgress,
  StudyGenerationJob,
} from './types';

export interface CoordinatorDependencies {
  startJobFn?: typeof startStudyGenerationJob;
  countIndexedSourcesFn?: typeof countIndexedCurriculumSources;
  resumeJobFn?: typeof resumeStudyGenerationJob;
  claimStepFn?: typeof claimStudyJobStep;
  completeStepFn?: typeof completeStudyJobStep;
  failStepFn?: typeof failStudyJobStep;
  cancelJobFn?: typeof cancelStudyGenerationJob;
  getPlanFn?: typeof getStudyPlan;
  saveDraftFn?: typeof saveStudyPlanDraft;
  resolveSourceRefsFn?: typeof resolveStudySourceRefs;
  hydrateEvidenceFn?: typeof hydrateCurriculumEvidence;
  runPinnedTaskFn?: typeof runPinnedStudyTask;
  preparePreflightFn?: typeof prepareCurriculumPreflight;
  refreshScopeFn?: typeof refreshCurriculumScope;
  now?: () => number;
}

export interface CoordinatorRunOptions {
  leaseOwner?: string;
  creationKey?: string;
  resumeFrom?: StudyGenerationJob;
  signal?: AbortSignal;
  onProgress?: (progress: StudyJobProgress) => void;
  onJobStarted?: (jobId: string) => void;
  deps?: CoordinatorDependencies;
}

export interface CoordinatorRunResult {
  jobId: string;
  planDetail: StudyPlanDetail;
  mergeResult: MergeCurriculumResult;
  retrieval?: HydratedEvidenceResult['retrieval'];
  execution?: CurriculumExecutionStats;
}

/**
 * Rechecks that live source revisions still match the frozen scope.
 */
export async function verifySourceRevisions(
  sourceScope: StudySourceScopeV1,
  resolveRefsFn = resolveStudySourceRefs
): Promise<void> {
  const docs = sourceScope.resolvedDocuments || [];
  if (docs.length === 0) return;

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
  }
}

function prerequisiteInput(
  nodes: StudyPlanDetail['version']['nodes'],
  evidence: HydratedEvidenceResult,
  jobId: string,
  stepKey: string,
) {
  const included = nodes.filter((node) => node.included && !node.userAdded && !node.userModified);
  const refIds = new Set(included.flatMap((node) => node.sourceRefIds));
  const handlesByRefId = new Map<string, string>();
  const sources: NonNullable<CurriculumPrerequisiteTaskInput['sources']> = [];
  let sourceChars = 0;
  for (const item of evidence.allHandles) {
    const refId = evidence.handleToSourceRefIdMap.get(item.handle);
    if (!refId || !refIds.has(refId) || handlesByRefId.has(refId)) continue;
    if (sources.length >= EVIDENCE_LIMITS.MAX_HANDLES_PER_BATCH) break;
    if (sourceChars + item.excerpt.length > EVIDENCE_LIMITS.MAX_CHARS_PER_BATCH) continue;
    handlesByRefId.set(refId, item.handle);
    sources.push({ handle: item.handle, title: item.documentTitle, excerpt: item.excerpt });
    sourceChars += item.excerpt.length;
  }
  const topics: TopicEvidenceItem[] = included.map((node, index) => ({
    handle: `t_${index}`,
    title: node.title,
    conceptName: node.conceptLabel,
    objectives: node.learningObjectives,
    sourceHandles: node.sourceRefIds.flatMap((id) => handlesByRefId.get(id) ?? []),
  }));
  const nodeIds = new Map(topics.map((topic, index) => [topic.handle, included[index].nodeId]));
  return { taskInput: { jobId, stepKey, topics, sources }, nodeIds };
}

function canSkipPrerequisites(error: unknown): boolean {
  if (error instanceof StudyApiError) return error.code === 'invalid_model_output';
  return error instanceof AIError && (
    error.code === 'timeout' ||
    ['InvalidStructuredOutput', 'InputTooLarge', 'GenerationFailed', 'ModelUnavailable', 'ProviderOffline'].includes(error.category)
  );
}

function recordPrerequisiteFailure(
  jobId: string, stepKey: string, error: unknown, execution: CurriculumExecutionStats,
): void {
  if (!(error instanceof AIError)) return;
  logModelFailure(jobId, stepKey, error);
  const attempts = error.completion?.attemptCount ?? 0;
  execution.modelCalls += attempts;
  execution.corrections += Number(attempts === 2);
}

/**
 * Executes a durable curriculum generation workflow:
 * 1. Preflight and source verification.
 * 2. Evidence retrieval and hydration.
 * 3. Step 1..N: Decompose batches with checkpointed drafts.
 * 4. Final Step: Prerequisite proposal with Kahn cycle pruning and DAG ordering.
 * 5. Commit to Draft without publishing.
 */
export async function runCurriculumCoordinator(
  request: CurriculumGenerationRequest,
  preflight: StudyAiPreflight,
  options: CoordinatorRunOptions = {}
): Promise<CoordinatorRunResult> {
  const deps = options.deps || {};
  const startJob = deps.startJobFn || startStudyGenerationJob;
  const claimStep = deps.claimStepFn || claimStudyJobStep;
  const completeStep = deps.completeStepFn || completeStudyJobStep;
  const failStep = deps.failStepFn || failStudyJobStep;
  const cancelJob = deps.cancelJobFn || cancelStudyGenerationJob;
  const getPlan = deps.getPlanFn || getStudyPlan;
  const saveDraft = deps.saveDraftFn || saveStudyPlanDraft;
  const resolveSourceRefs = deps.resolveSourceRefsFn || resolveStudySourceRefs;
  const hydrateEvidence = deps.hydrateEvidenceFn || hydrateCurriculumEvidence;
  const runPinned = deps.runPinnedTaskFn || runPinnedStudyTask;

  const leaseOwner = options.leaseOwner || `lease_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const resumeFrom = options.resumeFrom;
  const creationKey = resumeFrom?.creationKey || options.creationKey || `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const signal = options.signal;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const previousExecution = resumeFrom?.progress.execution;
  const execution: CurriculumExecutionStats = {
    modelCalls: 0, corrections: 0, reportedInputTokens: 0, reportedOutputTokens: 0,
    responsesWithUsage: 0, durationMs: 0,
    ...previousExecution,
  };
  const recordModelResult = (result: AITaskResult) => {
    const repaired = result.validationOutcome === 'repaired';
    execution.modelCalls += repaired ? 2 : 1;
    execution.corrections += Number(repaired);
    if (result.usage?.inputTokens != null && result.usage?.outputTokens != null) {
      execution.responsesWithUsage++;
      execution.reportedInputTokens += result.usage.inputTokens;
      execution.reportedOutputTokens += result.usage.outputTokens;
    }
    execution.durationMs = (previousExecution?.durationMs ?? 0) + now() - startedAt;
  };

  // 1. Check initial plan existence and draft
  let planDetail = await getPlan(request.planId);
  if (!planDetail.plan.draftVersionId || planDetail.plan.draftVersionId !== request.baseVersionId) {
    throw new StudyApiError({
      code: 'invalid_state',
      messageKey: 'study_generation.error.no_active_draft',
      retryable: false,
    });
  }
  const draftVersionId = planDetail.plan.draftVersionId;
  let currentRevision = planDetail.plan.revision;
  const effectiveGoal = planDetail.plan.goal;

  signal?.throwIfAborted();
  const prepare = deps.preparePreflightFn ?? prepareCurriculumPreflight;
  const authorized = await prepare(planDetail.version.sourceScope, preflight.modelSelection || undefined, preflight);
  if (resumeFrom) {
    const previous = resumeFrom.preflight as StudyAiPreflight;
    if (resumeFrom.kind !== 'curriculum' || resumeFrom.targetId !== draftVersionId ||
        previous.reasoningFallback !== authorized.preflight.reasoningFallback ||
        !previous.embedding || JSON.stringify(previous.embedding) !== JSON.stringify(authorized.preflight.embedding)) {
      throw new StudyApiError({ code: 'invalid_state', messageKey: 'study_generation.error.provider_changed_on_resume', retryable: false });
    }
    validatePreflightUnchanged(previous, authorized.route);
  }
  const refreshScope = deps.refreshScopeFn ?? refreshCurriculumScope;
  const verifyPrivacy = async () => {
    const live = await refreshScope(authorized.sourceScope);
    evaluateStudyPrivacy({
      documents: live.resolvedDocuments.map((doc) => ({
        id: doc.documentId, isAiExcluded: doc.isAiExcluded, isLocalOnly: doc.isLocalOnly,
      })),
      generationDestination: classifyRouteDestination(authorized.route),
      embeddingDestination: typeof authorized.preflight.embeddingDestination === 'object'
        ? authorized.preflight.embeddingDestination : null,
      cloudDisclosureAccepted: preflight.cloudDisclosureAccepted,
      costConsentAccepted: preflight.costConsentAccepted,
    });
    signal?.throwIfAborted();
  };

  const prerequisiteRoute = await resolveTaskRoute(curriculumPrerequisiteTask, {
    providers: [authorized.route.provider],
  });
  if (!prerequisiteRoute) {
    throw new StudyApiError({ code: 'provider_unavailable', messageKey: 'study_generation.error.no_provider_available', retryable: true });
  }
  signal?.throwIfAborted();
  const evidence: HydratedEvidenceResult = await hydrateEvidence({
    goal: effectiveGoal,
    sourceScope: authorized.sourceScope,
    depth: request.depth,
    embeddingConfig: authorized.embeddingConfig,
    resolveSourceRefsFn: resolveSourceRefs,
    signal,
    beforeQuery: verifyPrivacy,
  });
  signal?.throwIfAborted();
  if (evidence.batches.length === 0) {
    const countIndexedSources = deps.countIndexedSourcesFn ?? countIndexedCurriculumSources;
    const documents = authorized.sourceScope.resolvedDocuments;
    const indexedSources = await countIndexedSources(documents.map((doc) => doc.documentId));
    signal?.throwIfAborted();
    console.debug('[study-plans] Curriculum evidence unavailable', {
      selectedDocuments: authorized.sourceScope.selected.documentIds.length,
      selectedExtracts: authorized.sourceScope.selected.extractIds.length,
      resolvedDocuments: documents.length,
      indexedSources,
      retrieval: evidence.retrieval,
      verificationResults: evidence.resolutions.map(({ status, reasonKey }) => ({ status, reasonKey })),
      elapsedMs: now() - startedAt,
    });
    if (evidence.retrieval?.failedQueries) {
      throw new StudyApiError({ code: 'storage_failed', messageKey: 'study_generation.error.retrieval_failed', retryable: true });
    }
    const messageKey = evidence.resolutions.length > 0
      ? 'study_generation.error.unverified_evidence'
      : indexedSources === 0
        ? 'study_generation.error.index_not_ready'
        : 'study_generation.error.no_evidence';
    throw new StudyApiError({ code: 'insufficient_evidence', messageKey, retryable: true });
  }
  const batches = evidence.batches;
  if (2 * (batches.length + 1) > preflight.maximumModelCalls) {
    throw new StudyApiError({ code: 'invalid_state', messageKey: 'study_generation.error.call_budget_exceeded', retryable: false });
  }

  const requestHash = sha256(JSON.stringify({
    request: computeRequestHash({ ...request, sourceScope: authorized.sourceScope }),
    goal: effectiveGoal,
    targetRevision: resumeFrom?.targetRevision ?? currentRevision,
    providerId: authorized.preflight.providerId,
    creationKey,
    modelId: authorized.preflight.model?.id,
    endpoint: authorized.preflight.model?.endpointHash,
    evidence: batches.map((batch) => batch.handles.map((item) => [item.documentId, item.extractId, item.revision, item.excerptSha256])),
  }));
  const plannedSteps: CreateStudyStepInput[] = [];

  for (let b = 0; b < batches.length; b++) {
    const stepKey = `decompose:${String(b).padStart(4, '0')}`;
    plannedSteps.push({
      stepKey,
      // Native claims compare this ordinal directly with the zero-based
      // next_step_index, which starts at 0 for the first step.
      ordinal: b,
      inputHash: sha256(JSON.stringify({ stepKey, requestHash, batchIndex: b })),
    });
  }

  const prereqStepKey = `prerequisites:${String(batches.length).padStart(4, '0')}`;
  plannedSteps.push({
    stepKey: prereqStepKey,
    ordinal: batches.length,
    inputHash: sha256(JSON.stringify({ stepKey: prereqStepKey, requestHash })),
  });

  // 4. Start native job
  const startInput: StartStudyJobInput = {
    creationKey,
    kind: 'curriculum',
    targetId: draftVersionId,
    targetRevision: currentRevision,
    requestHash,
    preflight: {
      ...authorized.preflight,
      sourceExcerptCount: evidence.allHandles.length,
      retrieval: evidence.retrieval,
    },
    steps: plannedSteps,
  };

  if (resumeFrom && resumeFrom.requestHash !== requestHash) {
    throw new StudyApiError({
      code: 'stale_source', messageKey: 'study_generation.error.checkpoint_evidence_changed', retryable: false,
    });
  }
  signal?.throwIfAborted();
  const job = resumeFrom
    ? await (deps.resumeJobFn ?? resumeStudyGenerationJob)(resumeFrom.id, startInput.preflight)
    : await startJob(startInput);
  if (job.creationKey !== creationKey) {
    throw new StudyApiError({ code: 'invalid_state', messageKey: 'study_generation.error.target_job_active', retryable: true });
  }
  options.onJobStarted?.(job.id);
  const sourceRefs = new Map(evidence.resolutions
    .filter(({ status }) => status === 'current')
    .map(({ ref }) => [ref.id, ref]));
  const sourceInputsForDraft = (merge: MergeCurriculumResult) => Object.fromEntries(
    [...new Set([...merge.nodes, ...merge.prerequisites].flatMap((item) => item.sourceRefIds))]
      .flatMap((id) => {
        const ref = sourceRefs.get(id);
        return ref ? [[id, ref]] : [];
      }),
  );

  // 5. Execution loop
  let latestMergeResult: MergeCurriculumResult = {
    nodes: planDetail.version.nodes,
    prerequisites: planDetail.version.prerequisites,
    diff: {
      addedNodeIds: [],
      removedNodeIds: [],
      modifiedNodeIds: [],
      reorderedNodeIds: [],
      addedPrerequisites: [],
      removedPrerequisites: [],
      lockConflicts: [],
    },
    droppedEdgesCount: 0,
  };

  let activeStepKey: string | undefined;
  try {
    for (let stepIdx = job.nextStepIndex; stepIdx < plannedSteps.length; stepIdx++) {
      const plannedStep = plannedSteps[stepIdx];

      // Fail-closed abort check before claiming
      if (signal?.aborted) {
        throw new StudyApiError({
          code: 'cancelled',
          messageKey: 'study_generation.error.cancelled',
          retryable: false,
        });
      }

      // Recheck draft revision before claiming
      planDetail = await getPlan(request.planId);
      if (planDetail.plan.draftVersionId !== draftVersionId || planDetail.plan.revision !== currentRevision) {
        throw new StudyApiError({
          code: 'stale_revision',
          messageKey: 'study_generation.error.plan_revision_changed',
          retryable: false,
        });
      }

      // Claim step
      const step = await claimStep(job.id, plannedStep.stepKey, leaseOwner, job.cancellationEpoch);
      if (step.status === 'completed') continue;
      activeStepKey = step.stepKey;
      await verifyPrivacy();

      if (step.stepKey.startsWith('decompose:')) {
        const batchIndex = parseInt(step.stepKey.split(':')[1], 10) || 0;
        const batch = batches[batchIndex] || batches[0];

        const taskInput: CurriculumDecomposeTaskInput = {
          jobId: job.id,
          stepKey: step.stepKey,
          goal: effectiveGoal,
          depth: request.depth,
          knowledgePolicy: request.knowledgePolicy,
          sources: batch.handles.map((h) => ({
            handle: h.handle,
            title: h.documentTitle,
            excerpt: h.excerpt,
          })),
          conceptSeeds: evidence.conceptSeeds,
          priorEvidenceSummary: request.priorEvidence ? JSON.stringify(request.priorEvidence) : undefined,
        };

        const taskResult = await runPinned(
          curriculumDecomposeTask,
          taskInput,
          { signal, targetId: `${job.id}:${step.stepKey}`, preflightRoute: authorized.route },
          authorized.preflight
        );

        recordModelResult(taskResult);
        // Validate output
        const allowedHandles = batch.handles.map((h) => h.handle);
        const valResult = validateDecomposeOutputForTask(taskResult.output, allowedHandles);
        if (!valResult.ok) {
          throw new StudyApiError(MALFORMED_OUTPUT);
        }

        signal?.throwIfAborted();
        // Reconcile and checkpoint draft
        latestMergeResult = mergeCurriculumProposals({
          baseVersion: planDetail.version,
          proposedTopics: valResult.value.topics,
          proposedEdges: [],
          depth: request.depth,
          handleToSourceRefIdMap: evidence.handleToSourceRefIdMap,
        });

        const saveInput: SaveStudyPlanDraftInput = {
          planId: request.planId,
          expectedDraftRevision: currentRevision,
          nodes: latestMergeResult.nodes,
          prerequisites: latestMergeResult.prerequisites,
          sourceScope: authorized.sourceScope,
          sourceRefs: sourceInputsForDraft(latestMergeResult),
        };
        await verifyPrivacy();
        planDetail = await saveDraft(saveInput);
        currentRevision = planDetail.plan.revision;

        // Complete step
        const isFinal = stepIdx === plannedSteps.length - 1;
        const progress = await completeStep({
          jobId: job.id,
          stepKey: step.stepKey,
          leaseOwner,
          cancellationEpoch: job.cancellationEpoch,
          inputHash: step.inputHash,
          outputRefId: null,
          nextStepIndex: stepIdx + 1,
          progress: {
            completed: stepIdx + 1,
            total: plannedSteps.length,
            labelKey: 'study_generation.progress.decomposing_complete',
            execution: { ...execution },
          },
          status: isFinal ? 'awaiting-review' : 'running',
        });
        activeStepKey = undefined;
        options.onProgress?.(progress);

      } else if (step.stepKey.startsWith('prerequisites:')) {
        const { taskInput, nodeIds } = prerequisiteInput(planDetail.version.nodes, evidence, job.id, step.stepKey);
        if (!planDetail.version.nodes.some((node) => node.included)) {
          throw new StudyApiError({
            code: 'invalid_state', messageKey: 'study_generation.error.no_included_topics', retryable: false,
          });
        }

        let proposedEdges: CurriculumEdgeProposal[] = [];
        let prerequisitesUnavailable = false;
        if (taskInput.topics.length > 1) {
          try {
            const taskResult = await runPinned(
              curriculumPrerequisiteTask,
              taskInput,
              { signal, targetId: `${job.id}:${step.stepKey}`, preflightRoute: prerequisiteRoute },
              authorized.preflight
            );
            recordModelResult(taskResult);
            const validated = validatePrerequisiteOutputForTask(
              taskResult.output,
              [...nodeIds.keys()],
              taskInput.sources.map((source) => source.handle),
            );
            if (!validated.ok) throw new StudyApiError(MALFORMED_OUTPUT);

            proposedEdges = validated.value.edges.map((edge) => ({
              ...edge,
              prerequisiteHandle: nodeIds.get(edge.prerequisiteHandle)!,
              dependentHandle: nodeIds.get(edge.dependentHandle)!,
            }));
          } catch (error) {
            if (signal?.aborted || !canSkipPrerequisites(error)) throw error;
            prerequisitesUnavailable = true;
            execution.durationMs = (previousExecution?.durationMs ?? 0) + now() - startedAt;
            recordPrerequisiteFailure(job.id, step.stepKey, error, execution);
          }
        }

        await verifyPrivacy();
        if (proposedEdges.length > 0) {
          latestMergeResult = mergeCurriculumProposals({
            baseVersion: planDetail.version,
            proposedTopics: [],
            proposedEdges,
            depth: request.depth,
            handleToSourceRefIdMap: evidence.handleToSourceRefIdMap,
          });
          planDetail = await saveDraft({
            planId: request.planId,
            expectedDraftRevision: currentRevision,
            nodes: latestMergeResult.nodes,
            prerequisites: latestMergeResult.prerequisites,
            sourceRefs: sourceInputsForDraft(latestMergeResult),
          });
          currentRevision = planDetail.plan.revision;
        } else {
          const current = await getPlan(request.planId);
          if (current.plan.draftVersionId !== draftVersionId || current.plan.revision !== currentRevision) {
            throw new StudyApiError({
              code: 'stale_revision', messageKey: 'study_generation.error.plan_revision_changed', retryable: false,
            });
          }
          signal?.throwIfAborted();
        }

        // Complete step — final step marks status awaiting-review
        const progress = await completeStep({
          jobId: job.id,
          stepKey: step.stepKey,
          leaseOwner,
          cancellationEpoch: job.cancellationEpoch,
          inputHash: step.inputHash,
          outputRefId: null,
          nextStepIndex: plannedSteps.length,
          progress: {
            completed: plannedSteps.length,
            total: plannedSteps.length,
            labelKey: prerequisitesUnavailable
              ? 'study_generation.progress.prerequisites_unavailable'
              : 'study_generation.progress.prerequisites_complete',
            execution: { ...execution },
          },
          status: 'awaiting-review',
        });
        activeStepKey = undefined;
        options.onProgress?.(progress);
      }
    }

    return {
      jobId: job.id,
      planDetail,
      mergeResult: latestMergeResult,
      retrieval: evidence.retrieval,
      execution,
    };
  } catch (err) {
    const error = err instanceof AIError ? new StudyApiError(modelFailure(err)) : err;
    if (signal?.aborted) {
      try {
        await cancelJob(job.id, job.cancellationEpoch);
      } catch {
        // ignore secondary cancellation error
      }
    } else if (activeStepKey) {
      if (err instanceof AIError) logModelFailure(job.id, activeStepKey, err);
      await failStep({
        jobId: job.id,
        stepKey: activeStepKey,
        leaseOwner,
        cancellationEpoch: job.cancellationEpoch,
        error: error instanceof StudyApiError
          ? { code: error.code, messageKey: error.messageKey, retryable: error.retryable }
          : { code: 'internal_error', messageKey: 'study_generation.error.step_stopped', retryable: true },
      }).catch(() => undefined);
    }
    throw error;
  }
}
