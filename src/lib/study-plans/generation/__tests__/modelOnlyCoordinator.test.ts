/**
 * Model-only curriculum coordinator tests.
 *
 * Verifies the isolated no-library execution branch: a model-only plan must
 * never touch library retrieval, embeddings, or web research, whether the
 * library is empty or populated, and durable jobs must resume without
 * cross-branch contamination.
 */

import { describe, expect, it, vi } from 'vitest';
import type { StudyPlanDetail, SaveStudyPlanDraftInput } from '../../../../types/learningPaths';
import type { StudyAiPreflight, StudyGenerationJob, StudyGenerationStep, StudyJobProgress } from '../types';
import type { CurriculumDecomposeBatchOutput, CurriculumPrerequisiteOutput } from '../types';
import {
  runModelOnlyCurriculumCoordinator,
  computeModelOnlyRequestHash,
  type ModelOnlyCurriculumGenerationRequest,
  type ModelOnlyCoordinatorDependencies,
} from '../modelOnlyCoordinator';

function createModelOnlyPlanDetail(revision = 1, populatedLibrary = false): StudyPlanDetail {
  return {
    plan: {
      id: 'plan_model_only_1',
      title: 'Source-free plan',
      goal: 'Learn a new subject from model knowledge',
      depth: 'foundational',
      status: 'active',
      currentVersionId: null,
      currentVersion: 0,
      draftVersionId: 'spv_model_only_draft',
      revision,
      createdAt: '2026-11-12T00:00:00Z',
      updatedAt: '2026-11-12T00:00:00Z',
    },
    version: {
      id: 'spv_model_only_draft',
      planId: 'plan_model_only_1',
      version: 1,
      state: 'draft',
      baseVersionId: null,
      sourceScope: populatedLibrary ? {
        schemaVersion: 1,
        selected: { documentIds: ['d1'], extractIds: [], collectionIds: [], tagIds: [] },
        resolvedDocuments: [{ documentId: 'd1', title: 'D', sourceType: 'pdf', revision: 'r1', revisionKind: 'content-hash', extractIds: [], isAiExcluded: false, isLocalOnly: false }],
        frozenAt: '2026-11-12T00:00:00Z',
        indexCompleteness: 'complete',
        limitations: [],
      } : undefined,
      knowledgeAuthority: { kind: 'model-only' },
      nodes: [],
      prerequisites: [],
      changeSummary: null,
      createdBy: 'ai',
      createdAt: '2026-11-12T00:00:00Z',
      publishedAt: null,
    },
    activityByNodeId: {},
    sourceRefs: {},
  };
}

const modelOnlyPreflight: StudyAiPreflight = {
  providerId: 'ollama:llama3',
  generationDestination: {
    providerClass: 'ollama-local',
    locality: 'device',
    keyless: true,
    billable: false,
    sendsOffDevice: false,
    requiresDisclosure: false,
    requiresCostConsent: false,
    reasonKey: 'ai.destination.device',
  },
  embeddingDestination: null,
  featureAllowed: true,
  documentIds: [],
  sourceExcerptCount: 0,
  sendsSourceOffDevice: false,
  sendsAnswersOffDevice: false,
  billable: false,
  cloudDisclosureAccepted: true,
  costConsentAccepted: true,
  maximumModelCalls: 4,
  executionBranch: 'model-only',
};

const modelOnlyRequest: ModelOnlyCurriculumGenerationRequest = {
  planId: 'plan_model_only_1',
  baseVersionId: 'spv_model_only_draft',
  depth: 'foundational',
};

function makeDecomposeOutput(): CurriculumDecomposeBatchOutput {
  return {
    schemaVersion: 1,
    topics: [
      { handle: 't_0', title: 'Topic A', summary: 'S', learningObjectives: ['O1'], conceptName: 'A', materialSupport: 'unsupported', sourceHandles: [], whyHere: 'Start' },
      { handle: 't_1', title: 'Topic B', summary: 'S', learningObjectives: ['O1'], conceptName: 'B', materialSupport: 'unsupported', sourceHandles: [], whyHere: 'Next' },
      { handle: 't_2', title: 'Topic C', summary: 'S', learningObjectives: ['O1'], conceptName: 'C', materialSupport: 'unsupported', sourceHandles: [], whyHere: 'Later' },
    ],
  };
}

describe('Model-only curriculum coordinator', () => {
  function buildDeps(overrides: {
    populatedLibrary?: boolean;
    resumeFrom?: StudyGenerationJob;
    failStart?: boolean;
    initialNodes?: StudyPlanDetail['version']['nodes'];
    revision?: number;
  } = {}) {
    const startedJobs: Array<{ preflight: StudyAiPreflight; request: ModelOnlyCurriculumGenerationRequest }> = [];
    const savedDrafts: SaveStudyPlanDraftInput[] = [];
    const completedSteps: string[] = [];
    let planDetail = createModelOnlyPlanDetail(overrides.revision ?? 1, overrides.populatedLibrary);
    if (overrides.initialNodes) {
      planDetail = {
        ...planDetail,
        plan: { ...planDetail.plan, revision: overrides.revision ?? 2 },
        version: { ...planDetail.version, nodes: overrides.initialNodes },
      };
    }

    const startJobFn = vi.fn().mockImplementation(async (input: { preflight: unknown }) => {
      if (overrides.failStart) throw new Error('start failed');
      startedJobs.push({ preflight: input.preflight as StudyAiPreflight, request: modelOnlyRequest });
      return {
        id: 'job_model_only_1',
        kind: 'curriculum',
        targetId: 'spv_model_only_draft',
        targetRevision: 1,
        requestHash: 'req_hash_model_only',
        creationKey: 'ck_model_only',
        status: 'running',
        nextStepIndex: 0,
        leaseOwner: null,
        leaseExpiresAt: null,
        cancellationEpoch: 0,
        attemptCount: 1,
        preflight: input.preflight,
        progress: { completed: 0, total: 2, labelKey: 'started' },
        lastError: null,
        createdAt: '2026-11-12T00:00:00Z',
        updatedAt: '2026-11-12T00:00:00Z',
      } as StudyGenerationJob;
    });

    const claimStepFn = vi.fn().mockImplementation((jobId: string, stepKey: string) => ({
      jobId,
      stepKey,
      ordinal: stepKey.startsWith('decompose') ? 1 : 2,
      inputHash: 'hash',
      status: 'running',
      outputRefId: null,
      safeError: null,
      completedAt: null,
    } as StudyGenerationStep));

    const completeStepFn = vi.fn().mockImplementation((input: { stepKey: string; progress: StudyJobProgress }) => {
      completedSteps.push(input.stepKey);
      return input.progress;
    });

    const saveDraftFn = vi.fn().mockImplementation(async (input: SaveStudyPlanDraftInput) => {
      savedDrafts.push(input);
      planDetail = {
        ...planDetail,
        plan: { ...planDetail.plan, revision: planDetail.plan.revision + 1 },
        version: { ...planDetail.version, nodes: input.nodes, prerequisites: input.prerequisites },
      };
      return planDetail;
    });

    const runPinnedTaskFn = vi.fn().mockImplementation(async (_taskDef: unknown, input: { stepKey: string }) => {
      if (input.stepKey.startsWith('decompose')) {
        return {
          output: makeDecomposeOutput(),
          taskId: 'study-curriculum-model-only-decompose',
          providerId: 'ollama:llama3',
          endpointLocality: 'device',
          requestedModelClass: 'reasoning',
          servedModelClass: 'reasoning',
          fallbackPath: 'none',
          validationOutcome: 'success',
        };
      }
      return {
        output: { schemaVersion: 1, edges: [] } as CurriculumPrerequisiteOutput,
        taskId: 'study-curriculum-model-only-prerequisites',
        providerId: 'ollama:llama3',
        endpointLocality: 'device',
        requestedModelClass: 'reasoning',
        servedModelClass: 'reasoning',
        fallbackPath: 'none',
        validationOutcome: 'success',
      };
    });

    const deps: ModelOnlyCoordinatorDependencies = {
      startJobFn,
      resumeJobFn: vi.fn().mockImplementation(async (_jobId: string, preflight: StudyAiPreflight) => ({
        id: 'job_model_only_1',
        kind: 'curriculum',
        targetId: 'spv_model_only_draft',
        targetRevision: 1,
        requestHash: 'req_hash_model_only',
        creationKey: 'ck_model_only',
        status: 'running',
        nextStepIndex: 0,
        leaseOwner: null,
        leaseExpiresAt: null,
        cancellationEpoch: 0,
        attemptCount: 1,
        preflight,
        progress: { completed: 0, total: 2, labelKey: 'started' },
        lastError: null,
        createdAt: '2026-11-12T00:00:00Z',
        updatedAt: '2026-11-12T00:00:00Z',
      } as StudyGenerationJob)),
      claimStepFn,
      completeStepFn,
      failStepFn: vi.fn().mockResolvedValue(undefined),
      cancelJobFn: vi.fn().mockResolvedValue(undefined),
      getPlanFn: vi.fn().mockImplementation(async () => planDetail),
      saveDraftFn,
      runPinnedTaskFn: runPinnedTaskFn as never,
      preparePreflightFn: vi.fn().mockResolvedValue({
        route: { provider: { id: 'ollama:llama3', kind: 'ondevice', getCapabilities: vi.fn() } },
        preflight: modelOnlyPreflight,
      }),
    };

    return { deps, startedJobs, savedDrafts, completedSteps, getPlan: () => planDetail };
  }

  it('generates a bounded model-only curriculum without any library, embedding, or web calls', async () => {
    const { deps, startedJobs, savedDrafts, completedSteps } = buildDeps({ populatedLibrary: true });
    const result = await runModelOnlyCurriculumCoordinator(modelOnlyRequest, modelOnlyPreflight, {
      deps,
      creationKey: 'ck_model_only',
    });

    expect(result.jobId).toBe('job_model_only_1');
    expect(completedSteps).toEqual(['decompose:0000', 'prerequisites:0001']);
    // The job was started with the model-only branch marker and zero source excerpts.
    expect(startedJobs).toHaveLength(1);
    expect(startedJobs[0].preflight.executionBranch).toBe('model-only');
    expect(startedJobs[0].preflight.sourceExcerptCount).toBe(0);
    expect(startedJobs[0].preflight.documentIds).toEqual([]);

    // Draft saves carry no source scope and no source refs.
    expect(savedDrafts).toHaveLength(1);
    expect(savedDrafts[0].sourceScope).toBeUndefined();
    expect(savedDrafts[0].sourceRefs).toBeUndefined();

    // Merged nodes are unverified model output with no library evidence.
    const nodes = result.planDetail.version.nodes;
    expect(nodes).toHaveLength(3);
    for (const node of nodes) {
      expect(node.materialSupport).toBe('unsupported');
      expect(node.sourceRefIds).toEqual([]);
      expect(node.conceptId).toBeNull();
    }
    expect(result.planDetail.version.prerequisites).toEqual([]);
  });

  it('runs identically when the user has no library material at all', async () => {
    const { deps, savedDrafts } = buildDeps({ populatedLibrary: false });
    const result = await runModelOnlyCurriculumCoordinator(modelOnlyRequest, modelOnlyPreflight, {
      deps,
      creationKey: 'ck_model_only',
    });
    expect(result.planDetail.version.nodes).toHaveLength(3);
    expect(savedDrafts[0].sourceScope).toBeUndefined();
  });

  it('rejects a library-backed plan from entering the model-only branch', async () => {
    const planDetail = createModelOnlyPlanDetail();
    planDetail.version.knowledgeAuthority = { kind: 'library', policy: 'source-only' };
    const deps: ModelOnlyCoordinatorDependencies = {
      startJobFn: vi.fn(),
      getPlanFn: vi.fn().mockResolvedValue(planDetail),
      preparePreflightFn: vi.fn(),
    };
    await expect(runModelOnlyCurriculumCoordinator(modelOnlyRequest, modelOnlyPreflight, { deps }))
      .rejects.toMatchObject({ messageKey: 'study_generation.error.model_only_authority_required' });
  });

  it('resumes an interrupted model-only job at the next step and preserves the branch', async () => {
    const initialNodes = makeDecomposeOutput().topics.map((topic, index) => ({
      nodeId: `spn_model_${index}`,
      title: topic.title,
      summary: topic.summary,
      learningObjectives: topic.learningObjectives,
      conceptId: null,
      conceptLabel: topic.conceptName,
      position: index,
      included: true,
      locked: false,
      userAdded: false,
      userModified: false,
      materialSupport: 'unsupported' as const,
      whyHere: topic.whyHere,
      sourceRefIds: [],
    }));
    const { deps, completedSteps } = buildDeps({ initialNodes, revision: 2 });
    const resumeRequestHash = computeModelOnlyRequestHash(
      modelOnlyRequest,
      1,
      modelOnlyPreflight,
      'ck_model_only',
      'Learn a new subject from model knowledge'
    );
    const resumeFromJob = (): StudyGenerationJob => ({
      id: 'job_model_only_1',
      kind: 'curriculum',
      targetId: 'spv_model_only_draft',
      targetRevision: 1,
      requestHash: resumeRequestHash,
      creationKey: 'ck_model_only',
      status: 'interrupted',
      nextStepIndex: 1,
      leaseOwner: null,
      leaseExpiresAt: null,
      cancellationEpoch: 0,
      attemptCount: 1,
      preflight: modelOnlyPreflight,
      progress: { completed: 1, total: 2, labelKey: 'study_generation.progress.decomposing_complete' },
      lastError: null,
      createdAt: '2026-11-12T00:00:00Z',
      updatedAt: '2026-11-12T00:00:00Z',
    });
    const resumeFrom = resumeFromJob();
    // Simulate the native row returning the interrupted job's next step.
    deps.resumeJobFn = vi.fn().mockResolvedValue(resumeFrom);
    const result = await runModelOnlyCurriculumCoordinator(modelOnlyRequest, modelOnlyPreflight, {
      deps,
      resumeFrom,
    });
    expect(result.jobId).toBe('job_model_only_1');
    // Only the pending step runs on resume; decompose was already completed.
    expect(completedSteps).toEqual(['prerequisites:0001']);
  });

  it('preserves the draft and reports retryable failure when a step fails', async () => {
    const { deps, savedDrafts } = buildDeps();
    deps.runPinnedTaskFn = vi.fn().mockRejectedValue(new Error('provider offline')) as never;
    await expect(runModelOnlyCurriculumCoordinator(modelOnlyRequest, modelOnlyPreflight, { deps }))
      .rejects.toBeInstanceOf(Error);
    // The decompose step ran before the failure only if the task ran; with the
    // task failing first, no draft was saved, so work remains recoverable.
    expect(savedDrafts).toHaveLength(0);
  });
});
