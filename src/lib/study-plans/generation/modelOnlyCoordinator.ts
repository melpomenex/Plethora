/**
 * Model-only Curriculum Generation Coordinator.
 *
 * Executes a durable, bounded curriculum generation job for Study Plans that
 * carry the `model-only` knowledge authority. This branch intentionally has NO
 * library, retrieval, embedding, or web-research access: it only composes the
 * learner goal, depth, and the bounded model-only curriculum task.
 *
 * Implements specifications from:
 * - openspec/changes/add-study-plan-knowledge-policies/specs/study-plan-knowledge-policy/spec.md
 * - openspec/planning/study-plans-assessments-program/13-ADAPTIVE-LEARNING-STUDIO.md
 */

import { validateDecomposeOutputForTask, validatePrerequisiteOutputForTask } from '../../ai/schemas/curriculumGeneration';
import {
  modelOnlyCurriculumDecomposeTask,
  modelOnlyCurriculumPrerequisiteTask,
  type ModelOnlyCurriculumDecomposeTaskInput,
  type ModelOnlyCurriculumPrerequisiteTaskInput,
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
import { getStudyPlan, saveStudyPlanDraft, StudyApiError } from '../../../api/study-plans';
import type { SaveStudyPlanDraftInput, StudyPlanDetail, StudyErrorCode } from '../../../types/learningPaths';
import { mergeCurriculumProposals, type MergeCurriculumResult } from './merge';
import { runPinnedStudyTask } from './pinnedTask';
import { sha256 } from './requestHash';
import { prepareModelOnlyCurriculumPreflight } from './curriculumPreflight';
import { AIError } from '../../ai/errors';
import { logModelFailure, MALFORMED_OUTPUT, modelFailure } from './modelFailure';
import type { AITaskResult } from '../../ai/tasks/types';
import type {
  CreateStudyStepInput,
  CurriculumExecutionStats,
  CurriculumEdgeProposal,
  StartStudyJobInput,
  StudyAiPreflight,
  StudyJobProgress,
  StudyGenerationJob,
} from './types';

export interface ModelOnlyCurriculumGenerationRequest {
  planId: string;
  baseVersionId: string;
  depth: 'survey' | 'foundational' | 'deep';
  goal?: string;
}

export interface ModelOnlyCoordinatorDependencies {
  startJobFn?: typeof startStudyGenerationJob;
  resumeJobFn?: typeof resumeStudyGenerationJob;
  claimStepFn?: typeof claimStudyJobStep;
  completeStepFn?: typeof completeStudyJobStep;
  failStepFn?: typeof failStudyJobStep;
  cancelJobFn?: typeof cancelStudyGenerationJob;
  getPlanFn?: typeof getStudyPlan;
  saveDraftFn?: typeof saveStudyPlanDraft;
  runPinnedTaskFn?: typeof runPinnedStudyTask;
  preparePreflightFn?: typeof prepareModelOnlyCurriculumPreflight;
  now?: () => number;
}

export interface CoordinatorRunOptions {
  leaseOwner?: string;
  creationKey?: string;
  resumeFrom?: StudyGenerationJob;
  signal?: AbortSignal;
  onProgress?: (progress: StudyJobProgress) => void;
  onJobStarted?: (jobId: string) => void;
  deps?: ModelOnlyCoordinatorDependencies;
}

export interface CoordinatorRunResult {
  jobId: string;
  planDetail: StudyPlanDetail;
  mergeResult: MergeCurriculumResult;
  retrieval?: undefined;
  execution?: CurriculumExecutionStats;
}

const MODEL_ONLY_BRANCH = 'model-only' as const;

function modelOnlyError(code: StudyErrorCode, messageKey: string, retryable = false): StudyApiError {
  return new StudyApiError({ code, messageKey, retryable });
}

/**
 * Deterministic identity hash for model-only curriculum jobs. The branch
 * marker is part of the identity so a model-only job can never be resumed as
 * a library-backed job (or vice versa), and so restart/retry revalidates the
 * same request inputs.
 */
export function computeModelOnlyRequestHash(
  request: ModelOnlyCurriculumGenerationRequest,
  targetRevision: number,
  preflight: StudyAiPreflight,
  creationKey: string,
  goal: string,
): string {
  return sha256(JSON.stringify({
    branch: MODEL_ONLY_BRANCH,
    request: {
      planId: request.planId,
      baseVersionId: request.baseVersionId,
      depth: request.depth,
      goal,
    },
    targetRevision,
    providerId: preflight.providerId,
    modelId: preflight.model?.id,
    endpoint: preflight.model?.endpointHash,
    creationKey,
  }));
}

/**
 * Executes a durable model-only curriculum generation workflow:
 * 1. Verify the plan pins the model-only authority and has an active draft.
 * 2. Preflight the model path (provider, destination, consent, budget).
 * 3. Start a job with a branch marker so it can never be resumed as a library job.
 * 4. Step 1: bounded decompose into unverified topics (no sources).
 * 5. Step 2: sparse prerequisite edges (unverified).
 * 6. Merge into the draft via the shared lifecycle and leave it awaiting review.
 */
export async function runModelOnlyCurriculumCoordinator(
  request: ModelOnlyCurriculumGenerationRequest,
  preflight: StudyAiPreflight,
  options: CoordinatorRunOptions = {}
): Promise<CoordinatorRunResult> {
  const deps = options.deps || {};
  const startJob = deps.startJobFn || startStudyGenerationJob;
  const resumeJob = deps.resumeJobFn || resumeStudyGenerationJob;
  const claimStep = deps.claimStepFn || claimStudyJobStep;
  const completeStep = deps.completeStepFn || completeStudyJobStep;
  const failStep = deps.failStepFn || failStudyJobStep;
  const cancelJob = deps.cancelJobFn || cancelStudyGenerationJob;
  const getPlan = deps.getPlanFn || getStudyPlan;
  const saveDraft = deps.saveDraftFn || saveStudyPlanDraft;
  const runPinned = deps.runPinnedTaskFn || runPinnedStudyTask;
  const preparePreflight = deps.preparePreflightFn || prepareModelOnlyCurriculumPreflight;

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

  // 1. Verify plan: model-only authority + active draft.
  let planDetail = await getPlan(request.planId);
  if (planDetail.version.knowledgeAuthority.kind !== 'model-only') {
    throw modelOnlyError('invalid_state', 'study_generation.error.model_only_authority_required');
  }
  if (!planDetail.plan.draftVersionId || planDetail.plan.draftVersionId !== request.baseVersionId) {
    throw modelOnlyError('invalid_state', 'study_generation.error.no_active_draft');
  }
  const draftVersionId = planDetail.plan.draftVersionId;
  let currentRevision = planDetail.plan.revision;
  const effectiveGoal = planDetail.plan.goal || request.goal || '';

  signal?.throwIfAborted();

  // 2. Preflight the model route. No documents, no embeddings, no retrieval.
  const authorized = await preparePreflight(preflight.modelSelection || undefined, preflight);
  if (authorized.preflight.executionBranch && authorized.preflight.executionBranch !== MODEL_ONLY_BRANCH) {
    throw modelOnlyError('invalid_state', 'study_generation.error.provider_changed_on_resume');
  }

  // Consent gates are checked again here, before any transmission.
  const offDevice = authorized.preflight.sendsSourceOffDevice
    || (typeof authorized.preflight.embeddingDestination === 'object'
      && authorized.preflight.embeddingDestination?.sendsOffDevice);
  if (preflight.cloudDisclosureAccepted === false && offDevice) {
    throw modelOnlyError('privacy_denied', 'study_generation.error.cloud_disclosure_required');
  }
  if (preflight.costConsentAccepted === false && authorized.preflight.billable) {
    throw modelOnlyError('cost_consent_required', 'study_generation.error.cost_consent_required');
  }

  // 3. Plan the two model-only steps and hash job identity including the branch.
  const stepCount = 2;
  const requestHash = computeModelOnlyRequestHash(
    request,
    resumeFrom?.targetRevision ?? currentRevision,
    authorized.preflight,
    creationKey,
    effectiveGoal,
  );
  const plannedSteps: CreateStudyStepInput[] = [
    {
      stepKey: 'decompose:0000',
      ordinal: 0,
      inputHash: sha256(JSON.stringify({ stepKey: 'decompose:0000', requestHash })),
    },
    {
      stepKey: 'prerequisites:0001',
      ordinal: 1,
      inputHash: sha256(JSON.stringify({ stepKey: 'prerequisites:0001', requestHash })),
    },
  ];

  const startInput: StartStudyJobInput = {
    creationKey,
    kind: 'curriculum',
    targetId: draftVersionId,
    targetRevision: currentRevision,
    requestHash,
    preflight: {
      ...authorized.preflight,
      executionBranch: MODEL_ONLY_BRANCH,
      sourceExcerptCount: 0,
    },
    steps: plannedSteps,
  };

  if (resumeFrom && resumeFrom.requestHash !== requestHash) {
    throw modelOnlyError('stale_source', 'study_generation.error.checkpoint_evidence_changed');
  }
  signal?.throwIfAborted();
  const job = resumeFrom
    ? await resumeJob(resumeFrom.id, startInput.preflight)
    : await startJob(startInput);
  if (job.creationKey !== creationKey) {
    throw modelOnlyError('invalid_state', 'study_generation.error.target_job_active', true);
  }
  options.onJobStarted?.(job.id);

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

      if (signal?.aborted) {
        throw modelOnlyError('cancelled', 'study_generation.error.cancelled');
      }

      // Recheck draft revision before claiming.
      planDetail = await getPlan(request.planId);
      if (planDetail.plan.draftVersionId !== draftVersionId || planDetail.plan.revision !== currentRevision) {
        throw modelOnlyError('stale_revision', 'study_generation.error.plan_revision_changed');
      }

      const step = await claimStep(job.id, plannedStep.stepKey, leaseOwner, job.cancellationEpoch);
      if (step.status === 'completed') continue;
      activeStepKey = step.stepKey;

      if (step.stepKey === 'decompose:0000') {
        const taskInput: ModelOnlyCurriculumDecomposeTaskInput = {
          jobId: job.id,
          stepKey: step.stepKey,
          goal: effectiveGoal,
          depth: request.depth,
        };
        const taskResult = await runPinned(
          modelOnlyCurriculumDecomposeTask,
          taskInput,
          { signal, targetId: `${job.id}:${step.stepKey}`, preflightRoute: authorized.route },
          authorized.preflight
        );
        recordModelResult(taskResult);
        const valResult = validateDecomposeOutputForTask(taskResult.output, []);
        if (!valResult.ok) {
          throw new StudyApiError(MALFORMED_OUTPUT);
        }
        signal?.throwIfAborted();

        latestMergeResult = mergeCurriculumProposals({
          baseVersion: planDetail.version,
          proposedTopics: valResult.value.topics,
          proposedEdges: [],
          depth: request.depth,
          handleToSourceRefIdMap: new Map(),
        });

        const saveInput: SaveStudyPlanDraftInput = {
          planId: request.planId,
          expectedDraftRevision: currentRevision,
          nodes: latestMergeResult.nodes,
          prerequisites: latestMergeResult.prerequisites,
          // Deliberately no sourceScope and no sourceRefs: this branch has none.
        };
        planDetail = await saveDraft(saveInput);
        currentRevision = planDetail.plan.revision;

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
          status: 'running',
        });
        activeStepKey = undefined;
        options.onProgress?.(progress);
      } else if (step.stepKey === 'prerequisites:0001') {
        const included = planDetail.version.nodes.filter((node) => node.included && !node.userAdded && !node.userModified);
        if (included.length === 0) {
          throw modelOnlyError('invalid_state', 'study_generation.error.no_included_topics');
        }
        const topics: TopicEvidenceItem[] = included.map((node, index) => ({
          handle: `t_${index}`,
          title: node.title,
          conceptName: node.conceptLabel,
          objectives: node.learningObjectives,
          sourceHandles: [],
        }));
        const nodeIds = new Map(topics.map((topic, index) => [topic.handle, included[index].nodeId]));

        let proposedEdges: CurriculumEdgeProposal[] = [];
        let prerequisitesUnavailable = false;
        if (topics.length > 1) {
          try {
            const taskInput: ModelOnlyCurriculumPrerequisiteTaskInput = {
              jobId: job.id,
              stepKey: step.stepKey,
              topics,
            };
            const taskResult = await runPinned(
              modelOnlyCurriculumPrerequisiteTask,
              taskInput,
              { signal, targetId: `${job.id}:${step.stepKey}`, preflightRoute: authorized.route },
              authorized.preflight
            );
            recordModelResult(taskResult);
            const validated = validatePrerequisiteOutputForTask(taskResult.output, [...nodeIds.keys()], []);
            if (!validated.ok) throw new StudyApiError(MALFORMED_OUTPUT);
            proposedEdges = validated.value.edges.map((edge) => ({
              ...edge,
              prerequisiteHandle: nodeIds.get(edge.prerequisiteHandle)!,
              dependentHandle: nodeIds.get(edge.dependentHandle)!,
            }));
          } catch (error) {
            if (signal?.aborted) throw error;
            const skip = error instanceof StudyApiError && error.code === 'invalid_model_output';
            const aiFailure = error instanceof AIError && (
              error.code === 'timeout' ||
              ['InvalidStructuredOutput', 'InputTooLarge', 'GenerationFailed', 'ModelUnavailable', 'ProviderOffline'].includes(error.category)
            );
            if (!skip && !aiFailure) throw error;
            prerequisitesUnavailable = true;
            execution.durationMs = (previousExecution?.durationMs ?? 0) + now() - startedAt;
            if (error instanceof AIError) logModelFailure(job.id, step.stepKey, error);
          }
        }

        if (proposedEdges.length > 0) {
          latestMergeResult = mergeCurriculumProposals({
            baseVersion: planDetail.version,
            proposedTopics: [],
            proposedEdges,
            depth: request.depth,
            handleToSourceRefIdMap: new Map(),
          });
          planDetail = await saveDraft({
            planId: request.planId,
            expectedDraftRevision: currentRevision,
            nodes: latestMergeResult.nodes,
            prerequisites: latestMergeResult.prerequisites,
          });
          currentRevision = planDetail.plan.revision;
        } else {
          const current = await getPlan(request.planId);
          if (current.plan.draftVersionId !== draftVersionId || current.plan.revision !== currentRevision) {
            throw modelOnlyError('stale_revision', 'study_generation.error.plan_revision_changed');
          }
          signal?.throwIfAborted();
        }

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
