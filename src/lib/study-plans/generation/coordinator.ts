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
import { runPinnedStudyTask } from './pinnedTask';
import { computeRequestHash, sha256 } from './requestHash';
import type {
  CreateStudyStepInput,
  CurriculumGenerationRequest,
  CurriculumTopicProposal,
  StartStudyJobInput,
  StudyAiPreflight,
  StudyJobProgress,
} from './types';

export interface CoordinatorDependencies {
  startJobFn?: typeof startStudyGenerationJob;
  claimStepFn?: typeof claimStudyJobStep;
  completeStepFn?: typeof completeStudyJobStep;
  failStepFn?: typeof failStudyJobStep;
  cancelJobFn?: typeof cancelStudyGenerationJob;
  getPlanFn?: typeof getStudyPlan;
  saveDraftFn?: typeof saveStudyPlanDraft;
  resolveSourceRefsFn?: typeof resolveStudySourceRefs;
  hydrateEvidenceFn?: typeof hydrateCurriculumEvidence;
  runPinnedTaskFn?: typeof runPinnedStudyTask;
  now?: () => number;
}

export interface CoordinatorRunOptions {
  leaseOwner?: string;
  creationKey?: string;
  signal?: AbortSignal;
  onProgress?: (progress: StudyJobProgress) => void;
  deps?: CoordinatorDependencies;
}

export interface CoordinatorRunResult {
  jobId: string;
  planDetail: StudyPlanDetail;
  mergeResult: MergeCurriculumResult;
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
  const creationKey = options.creationKey || `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const signal = options.signal;

  // 1. Check initial plan existence and draft
  let planDetail = await getPlan(request.planId);
  if (!planDetail.plan.draftVersionId) {
    throw new StudyApiError({
      code: 'invalid_state',
      messageKey: 'study_generation.error.no_active_draft',
      retryable: false,
    });
  }
  const draftVersionId = planDetail.plan.draftVersionId;
  let currentRevision = planDetail.plan.revision;
  const effectiveGoal = request.goal || planDetail.plan.goal;

  // 2. Hydrate evidence
  const evidence: HydratedEvidenceResult = await hydrateEvidence({
    goal: effectiveGoal,
    sourceScope: request.sourceScope,
    depth: request.depth,
    resolveSourceRefsFn: resolveSourceRefs,
  });

  // 3. Plan steps
  const requestHash = computeRequestHash(request);
  const plannedSteps: CreateStudyStepInput[] = [];
  const batches = evidence.batches.length > 0 ? evidence.batches : [
    {
      batchIndex: 0,
      handles: evidence.allHandles,
      totalChars: evidence.allHandles.reduce((sum, h) => sum + h.excerpt.length, 0),
    },
  ];

  for (let b = 0; b < batches.length; b++) {
    const stepKey = `decompose:${String(b).padStart(4, '0')}`;
    plannedSteps.push({
      stepKey,
      ordinal: b + 1,
      inputHash: sha256(JSON.stringify({ stepKey, requestHash, batchIndex: b })),
    });
  }

  const prereqStepKey = `prerequisites:${String(batches.length).padStart(4, '0')}`;
  plannedSteps.push({
    stepKey: prereqStepKey,
    ordinal: batches.length + 1,
    inputHash: sha256(JSON.stringify({ stepKey: prereqStepKey, requestHash })),
  });

  // 4. Start native job
  const startInput: StartStudyJobInput = {
    creationKey,
    kind: 'curriculum',
    targetId: draftVersionId,
    targetRevision: currentRevision,
    requestHash,
    preflight,
    steps: plannedSteps,
  };

  const job = await startJob(startInput);

  // 5. Execution loop
  const accumulatedTopics: CurriculumTopicProposal[] = [];
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

  try {
    for (let stepIdx = job.nextStepIndex; stepIdx < plannedSteps.length; stepIdx++) {
      const plannedStep = plannedSteps[stepIdx];

      // Fail-closed abort check before claiming
      if (signal?.aborted) {
        await cancelJob(job.id, job.cancellationEpoch);
        throw new StudyApiError({
          code: 'cancelled',
          messageKey: 'study_generation.error.cancelled',
          retryable: false,
        });
      }

      // Recheck source revisions before each step
      await verifySourceRevisions(request.sourceScope, resolveSourceRefs);

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

        let taskResult;
        try {
          taskResult = await runPinned(
            curriculumDecomposeTask,
            taskInput,
            { signal, targetId: `${job.id}:${step.stepKey}` },
            preflight
          );
        } catch (err: unknown) {
          await failStep({
            jobId: job.id,
            stepKey: step.stepKey,
            leaseOwner,
            cancellationEpoch: job.cancellationEpoch,
            error: {
              code: 'provider_unavailable',
              messageKey: 'study_generation.error.provider_failed',
              retryable: true,
            },
          });
          throw err;
        }

        // Validate output
        const allowedHandles = batch.handles.map((h) => h.handle);
        const valResult = validateDecomposeOutputForTask(taskResult.output, allowedHandles);
        if (!valResult.ok) {
          await failStep({
            jobId: job.id,
            stepKey: step.stepKey,
            leaseOwner,
            cancellationEpoch: job.cancellationEpoch,
            error: {
              code: 'invalid_model_output',
              messageKey: 'study_generation.error.malformed_output',
              retryable: true,
            },
          });
          throw new StudyApiError({
            code: 'invalid_model_output',
            messageKey: 'study_generation.error.malformed_output',
            retryable: true,
          });
        }

        accumulatedTopics.push(...taskResult.output.topics);

        // Reconcile and checkpoint draft
        latestMergeResult = mergeCurriculumProposals({
          baseVersion: planDetail.version,
          proposedTopics: accumulatedTopics,
          proposedEdges: [],
          depth: request.depth,
          handleToSourceRefIdMap: evidence.handleToSourceRefIdMap,
        });

        const saveInput: SaveStudyPlanDraftInput = {
          planId: request.planId,
          expectedDraftRevision: currentRevision,
          nodes: latestMergeResult.nodes,
          prerequisites: [],
        };
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
          },
          status: isFinal ? 'awaiting-review' : 'running',
        });
        options.onProgress?.(progress);

      } else if (step.stepKey.startsWith('prerequisites:')) {
        // Build topic items from accumulated topics or fallback to draft nodes
        let topicItems: TopicEvidenceItem[] = [];
        if (accumulatedTopics.length > 0) {
          topicItems = accumulatedTopics.map((t) => ({
            handle: t.handle,
            title: t.title,
            conceptName: t.conceptName,
            objectives: t.learningObjectives,
            sourceHandles: t.sourceHandles,
          }));
        } else {
          topicItems = planDetail.version.nodes.map((n) => ({
            handle: `t_${n.position}`,
            title: n.title,
            conceptName: n.conceptLabel,
            objectives: n.learningObjectives,
            sourceHandles: [],
          }));
        }

        const taskInput: CurriculumPrerequisiteTaskInput = {
          jobId: job.id,
          stepKey: step.stepKey,
          topics: topicItems,
          sources: evidence.allHandles.map((h) => ({
            handle: h.handle,
            title: h.documentTitle,
            excerpt: h.excerpt,
          })),
        };

        let taskResult;
        try {
          taskResult = await runPinned(
            curriculumPrerequisiteTask,
            taskInput,
            { signal, targetId: `${job.id}:${step.stepKey}` },
            preflight
          );
        } catch (err: unknown) {
          await failStep({
            jobId: job.id,
            stepKey: step.stepKey,
            leaseOwner,
            cancellationEpoch: job.cancellationEpoch,
            error: {
              code: 'provider_unavailable',
              messageKey: 'study_generation.error.provider_failed',
              retryable: true,
            },
          });
          throw err;
        }

        // Validate output
        const knownTopicHandles = topicItems.map((t) => t.handle);
        const allowedSourceHandles = evidence.allHandles.map((h) => h.handle);
        const valResult = validatePrerequisiteOutputForTask(
          taskResult.output,
          knownTopicHandles,
          allowedSourceHandles.length > 0 ? allowedSourceHandles : undefined
        );

        if (!valResult.ok) {
          await failStep({
            jobId: job.id,
            stepKey: step.stepKey,
            leaseOwner,
            cancellationEpoch: job.cancellationEpoch,
            error: {
              code: 'invalid_model_output',
              messageKey: 'study_generation.error.malformed_output',
              retryable: true,
            },
          });
          throw new StudyApiError({
            code: 'invalid_model_output',
            messageKey: 'study_generation.error.malformed_output',
            retryable: true,
          });
        }

        const effectiveTopics: CurriculumTopicProposal[] =
          accumulatedTopics.length > 0
            ? accumulatedTopics
            : planDetail.version.nodes.map((n) => ({
                handle: `t_${n.position}`,
                title: n.title,
                summary: n.summary,
                learningObjectives: n.learningObjectives,
                conceptName: n.conceptLabel,
                materialSupport: (n.materialSupport === 'unsupported' ? 'unsupported' : 'grounded') as 'grounded' | 'unsupported',
                sourceHandles: n.sourceRefIds,
                whyHere: n.whyHere,
              }));

        // Merge edges with Kahn cycle pruning & DAG ordering
        latestMergeResult = mergeCurriculumProposals({
          baseVersion: planDetail.version,
          proposedTopics: effectiveTopics,
          proposedEdges: taskResult.output.edges,
          depth: request.depth,
          handleToSourceRefIdMap: evidence.handleToSourceRefIdMap,
        });

        const saveInput: SaveStudyPlanDraftInput = {
          planId: request.planId,
          expectedDraftRevision: currentRevision,
          nodes: latestMergeResult.nodes,
          prerequisites: latestMergeResult.prerequisites,
        };
        planDetail = await saveDraft(saveInput);
        currentRevision = planDetail.plan.revision;

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
            labelKey: 'study_generation.progress.prerequisites_complete',
          },
          status: 'awaiting-review',
        });
        options.onProgress?.(progress);
      }
    }

    return {
      jobId: job.id,
      planDetail,
      mergeResult: latestMergeResult,
    };
  } catch (err) {
    if (signal?.aborted) {
      try {
        await cancelJob(job.id, job.cancellationEpoch);
      } catch {
        // ignore secondary cancellation error
      }
    }
    throw err;
  }
}
