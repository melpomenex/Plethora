/**
 * Unit & Integration tests for Durable Curriculum Coordinator and Job Controller.
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  StudyPlanDetail,
  SaveStudyPlanDraftInput,
} from '../../../../types/learningPaths';
import type {
  StudySourceScopeV1,
} from '../../../../types/studySource';
import {
  runCurriculumCoordinator,
  verifySourceRevisions,
  type CoordinatorDependencies,
} from '../coordinator';
import { StudyJobController } from '../jobController';
import type {
  CurriculumDecomposeBatchOutput,
  CurriculumGenerationRequest,
  CurriculumPrerequisiteOutput,
  StudyAiPreflight,
  StudyGenerationJob,
  StudyGenerationStep,
  StudyJobProgress,
} from '../types';

describe('Curriculum Coordinator and Job Controller', () => {
  const dummyScope: StudySourceScopeV1 = {
    schemaVersion: 1,
    selected: {
      documentIds: ['doc_os_1', 'doc_os_2'],
      extractIds: [],
      collectionIds: [],
      tagIds: [],
    },
    resolvedDocuments: [
      {
        documentId: 'doc_os_1',
        title: 'Operating Systems PDF',
        sourceType: 'pdf',
        revision: 'rev_os_1',
        revisionKind: 'content-hash',
        extractIds: [],
        isAiExcluded: false,
        isLocalOnly: false,
      },
      {
        documentId: 'doc_os_2',
        title: 'Virtual Memory EPUB',
        sourceType: 'epub',
        revision: 'rev_os_2',
        revisionKind: 'content-hash',
        extractIds: [],
        isAiExcluded: false,
        isLocalOnly: false,
      },
    ],
    frozenAt: '2026-11-10T00:00:00Z',
    indexCompleteness: 'complete',
    limitations: [],
  };

  const dummyPreflight: StudyAiPreflight = {
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
    documentIds: ['doc_os_1', 'doc_os_2'],
    sourceExcerptCount: 2,
    sendsSourceOffDevice: false,
    sendsAnswersOffDevice: false,
    billable: false,
    cloudDisclosureAccepted: true,
    costConsentAccepted: true,
    maximumModelCalls: 4,
  };

  const dummyRequest: CurriculumGenerationRequest = {
    planId: 'plan_os_100',
    baseVersionId: 'spv_draft_1',
    goal: 'Understand processes and address translation',
    depth: 'survey',
    sourceScope: dummyScope,
    priorEvidence: null,
    knowledgePolicy: 'source-only',
    rulesOnly: false,
  };

  function createMockPlanDetail(revision = 1, draftVersionId = 'spv_draft_1'): StudyPlanDetail {
    return {
      plan: {
        id: 'plan_os_100',
        title: 'Operating Systems Plan',
        goal: 'Understand processes and address translation',
        depth: 'survey',
        status: 'active',
        currentVersionId: null,
        currentVersion: 0,
        draftVersionId,
        revision,
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      },
      version: {
        id: draftVersionId,
        planId: 'plan_os_100',
        version: 1,
        state: 'draft',
        baseVersionId: null,
        sourceScope: dummyScope,
        nodes: [],
        prerequisites: [],
        changeSummary: null,
        createdBy: 'ai',
        createdAt: '2026-11-10T00:00:00Z',
        publishedAt: null,
      },
      activityByNodeId: {},
      sourceRefs: {},
    };
  }

  it('verifySourceRevisions detects stale or missing sources', async () => {
    // Missing source test
    const resolveRefsMissing = vi.fn().mockResolvedValue([
      {
        status: 'missing',
        navigation: 'unavailable',
        ref: {
          schemaVersion: 1,
          id: 'ssr_1',
          documentId: 'doc_os_1',
          excerpt: '',
          revision: 'rev_os_1',
          revisionKind: 'content-hash',
          excerptSha256: '',
          documentTitle: 'OS',
          sourceType: 'pdf',
          capturedAt: '',
        },
      },
    ]);

    await expect(verifySourceRevisions(dummyScope, resolveRefsMissing)).rejects.toMatchObject({
      code: 'missing_source',
    });

    // Stale source test (revision mismatch)
    const resolveRefsStale = vi.fn().mockResolvedValue([
      {
        status: 'current',
        navigation: 'exact',
        ref: {
          schemaVersion: 1,
          id: 'ssr_1',
          documentId: 'doc_os_1',
          excerpt: 'content',
          revision: 'rev_os_CHANGED_NEW',
          revisionKind: 'content-hash',
          excerptSha256: 'hash',
          documentTitle: 'OS',
          sourceType: 'pdf',
          capturedAt: '',
        },
      },
      {
        status: 'current',
        navigation: 'exact',
        ref: {
          schemaVersion: 1,
          id: 'ssr_2',
          documentId: 'doc_os_2',
          excerpt: 'content',
          revision: 'rev_os_2',
          revisionKind: 'content-hash',
          excerptSha256: 'hash',
          documentTitle: 'VM',
          sourceType: 'epub',
          capturedAt: '',
        },
      },
    ]);

    await expect(verifySourceRevisions(dummyScope, resolveRefsStale)).rejects.toMatchObject({
      code: 'stale_source',
    });
  });

  it('executes full 2-step generation workflow and commits checkpoints', async () => {
    let mockPlanDetail = createMockPlanDetail(1);
    const savedDrafts: SaveStudyPlanDraftInput[] = [];
    const completedSteps: string[] = [];

    const mockStartJob = vi.fn().mockResolvedValue({
      id: 'job_gen_1',
      kind: 'curriculum',
      targetId: 'spv_draft_1',
      targetRevision: 1,
      requestHash: 'req_hash_1',
      creationKey: 'ck_1',
      status: 'running',
      nextStepIndex: 0,
      leaseOwner: 'test_owner',
      leaseExpiresAt: '2026-11-10T00:02:00Z',
      cancellationEpoch: 0,
      attemptCount: 1,
      preflight: dummyPreflight,
      progress: { completed: 0, total: 2, labelKey: 'started' },
      lastError: null,
      createdAt: '2026-11-10T00:00:00Z',
      updatedAt: '2026-11-10T00:00:00Z',
    } as StudyGenerationJob);

    const mockClaimStep = vi.fn().mockImplementation((jobId, stepKey) => ({
      jobId,
      stepKey,
      ordinal: stepKey.startsWith('decompose') ? 1 : 2,
      inputHash: 'hash',
      status: 'running',
      outputRefId: null,
      safeError: null,
      completedAt: null,
    } as StudyGenerationStep));

    const mockCompleteStep = vi.fn().mockImplementation((input) => {
      completedSteps.push(input.stepKey);
      return input.progress as StudyJobProgress;
    });

    const mockSaveDraft = vi.fn().mockImplementation(async (input: SaveStudyPlanDraftInput) => {
      savedDrafts.push(input);
      mockPlanDetail = {
        ...mockPlanDetail,
        plan: { ...mockPlanDetail.plan, revision: mockPlanDetail.plan.revision + 1 },
        version: {
          ...mockPlanDetail.version,
          nodes: input.nodes,
          prerequisites: input.prerequisites,
        },
      };
      return mockPlanDetail;
    });

    const mockGetPlan = vi.fn().mockImplementation(async () => mockPlanDetail);

    // Mock evidence hydration with 2 handles
    const mockHydrateEvidence = vi.fn().mockResolvedValue({
      batches: [
        {
          batchIndex: 0,
          handles: [
            {
              handle: 'src_h0',
              documentId: 'doc_os_1',
              documentTitle: 'OS PDF',
              sourceType: 'pdf',
              revision: 'rev_os_1',
              excerpt: 'Processes and threads execution model.',
              excerptSha256: 'sha256_1',
            },
            {
              handle: 'src_h1',
              documentId: 'doc_os_2',
              documentTitle: 'VM EPUB',
              sourceType: 'epub',
              revision: 'rev_os_2',
              excerpt: 'Virtual memory address translation.',
              excerptSha256: 'sha256_2',
            },
          ],
          totalChars: 100,
        },
      ],
      allHandles: [
        {
          handle: 'src_h0',
          documentId: 'doc_os_1',
          documentTitle: 'OS PDF',
          sourceType: 'pdf',
          revision: 'rev_os_1',
          excerpt: 'Processes and threads execution model.',
          excerptSha256: 'sha256_1',
        },
        {
          handle: 'src_h1',
          documentId: 'doc_os_2',
          documentTitle: 'VM EPUB',
          sourceType: 'epub',
          revision: 'rev_os_2',
          excerpt: 'Virtual memory address translation.',
          excerptSha256: 'sha256_2',
        },
      ],
      handleMap: new Map(),
      handleToSourceRefIdMap: new Map([
        ['src_h0', 'ssr_1'],
        ['src_h1', 'ssr_2'],
      ]),
      resolutions: [],
      uniqueHits: [],
      conceptSeeds: ['Processes'],
    });

    // Mock task executions
    const mockRunPinnedTask = vi.fn().mockImplementation(async (taskDef, input) => {
      if (input.stepKey.startsWith('decompose')) {
        const decomposeOutput: CurriculumDecomposeBatchOutput = {
          schemaVersion: 1,
          topics: [
            {
              handle: 't_0',
              title: 'Processes and Threads',
              summary: 'Basics of execution',
              learningObjectives: ['Explain process state transitions'],
              conceptName: 'Processes',
              materialSupport: 'grounded',
              sourceHandles: ['src_h0'],
              whyHere: 'Foundation',
            },
            {
              handle: 't_1',
              title: 'Address Translation',
              summary: 'Virtual memory concepts',
              learningObjectives: ['Compute page offset and frame'],
              conceptName: 'Virtual Memory',
              materialSupport: 'grounded',
              sourceHandles: ['src_h1'],
              whyHere: 'Core memory model',
            },
            {
              handle: 't_2',
              title: 'Page Fault Handling',
              summary: 'Demand paging mechanics',
              learningObjectives: ['Trace page fault interrupt handling'],
              conceptName: 'Page Faults',
              materialSupport: 'grounded',
              sourceHandles: ['src_h1'],
              whyHere: 'Advanced VM',
            },
          ],
        };
        return {
          output: decomposeOutput,
          taskId: 'study-curriculum-decompose',
          providerId: 'ollama:llama3',
          endpointLocality: 'device',
          requestedModelClass: 'reasoning',
          servedModelClass: 'reasoning',
          fallbackPath: 'none',
          validationOutcome: 'success',
        };
      } else {
        const prereqOutput: CurriculumPrerequisiteOutput = {
          schemaVersion: 1,
          edges: [
            {
              prerequisiteHandle: 't_0',
              dependentHandle: 't_1',
              support: 'inferred',
              rationale: 'Process context required for memory translation',
              sourceHandles: ['src_h0'],
            },
            {
              prerequisiteHandle: 't_1',
              dependentHandle: 't_2',
              support: 'inferred',
              rationale: 'Address translation required for page faults',
              sourceHandles: ['src_h1'],
            },
          ],
        };
        return {
          output: prereqOutput,
          taskId: 'study-curriculum-prerequisites',
          providerId: 'ollama:llama3',
          endpointLocality: 'device',
          requestedModelClass: 'reasoning',
          servedModelClass: 'reasoning',
          fallbackPath: 'none',
          validationOutcome: 'success',
        };
      }
    });

    const deps: CoordinatorDependencies = {
      startJobFn: mockStartJob,
      claimStepFn: mockClaimStep,
      completeStepFn: mockCompleteStep,
      saveDraftFn: mockSaveDraft,
      getPlanFn: mockGetPlan,
      hydrateEvidenceFn: mockHydrateEvidence,
      runPinnedTaskFn: mockRunPinnedTask as any,
      resolveSourceRefsFn: vi.fn().mockResolvedValue([
        {
          status: 'current',
          navigation: 'exact',
          ref: {
            schemaVersion: 1,
            id: 'ssr_1',
            documentId: 'doc_os_1',
            excerpt: 'content',
            revision: 'rev_os_1',
            revisionKind: 'content-hash',
            excerptSha256: 'hash',
            documentTitle: 'OS',
            sourceType: 'pdf',
            capturedAt: '',
          },
        },
        {
          status: 'current',
          navigation: 'exact',
          ref: {
            schemaVersion: 1,
            id: 'ssr_2',
            documentId: 'doc_os_2',
            excerpt: 'content',
            revision: 'rev_os_2',
            revisionKind: 'content-hash',
            excerptSha256: 'hash',
            documentTitle: 'VM',
            sourceType: 'epub',
            capturedAt: '',
          },
        },
      ]),
    };

    const result = await runCurriculumCoordinator(dummyRequest, dummyPreflight, { deps });

    expect(result.jobId).toBe('job_gen_1');
    expect(completedSteps).toEqual(['decompose:0000', 'prerequisites:0001']);
    expect(savedDrafts.length).toBe(2);

    // First draft checkpoint has 3 nodes and 0 edges
    expect(savedDrafts[0].nodes.length).toBe(3);
    expect(savedDrafts[0].prerequisites.length).toBe(0);

    // Second draft checkpoint has 3 nodes and 2 edges
    expect(savedDrafts[1].nodes.length).toBe(3);
    expect(savedDrafts[1].prerequisites.length).toBe(2);
    expect(result.planDetail.version.prerequisites.length).toBe(2);
  });

  it('cancels job cleanly and leaves earlier committed checkpoints intact on AbortSignal', async () => {
    let mockPlanDetail = createMockPlanDetail(1);
    const cancelJobFn = vi.fn().mockResolvedValue(undefined);
    const abortController = new AbortController();

    const mockStartJob = vi.fn().mockResolvedValue({
      id: 'job_gen_abort',
      kind: 'curriculum',
      targetId: 'spv_draft_1',
      targetRevision: 1,
      requestHash: 'hash',
      creationKey: 'ck_abort',
      status: 'running',
      nextStepIndex: 0,
      leaseOwner: 'test_owner',
      leaseExpiresAt: '2026-11-10T00:02:00Z',
      cancellationEpoch: 1,
      attemptCount: 1,
      preflight: dummyPreflight,
      progress: { completed: 0, total: 2, labelKey: 'started' },
      lastError: null,
      createdAt: '2026-11-10T00:00:00Z',
      updatedAt: '2026-11-10T00:00:00Z',
    } as StudyGenerationJob);

    const mockClaimStep = vi.fn().mockImplementation((jobId, stepKey) => ({
      jobId,
      stepKey,
      ordinal: 1,
      inputHash: 'hash',
      status: 'running',
      outputRefId: null,
      safeError: null,
      completedAt: null,
    }));

    const mockHydrateEvidence = vi.fn().mockResolvedValue({
      batches: [{ batchIndex: 0, handles: [], totalChars: 0 }],
      allHandles: [],
      handleMap: new Map(),
      handleToSourceRefIdMap: new Map(),
      resolutions: [],
      uniqueHits: [],
      conceptSeeds: [],
    });

    const mockRunPinnedTask = vi.fn().mockImplementation(async () => {
      // Simulate user cancelling mid-inference
      abortController.abort();
      throw new Error('Inference aborted by user');
    });

    const deps: CoordinatorDependencies = {
      startJobFn: mockStartJob,
      claimStepFn: mockClaimStep,
      failStepFn: vi.fn().mockResolvedValue({}),
      cancelJobFn,
      getPlanFn: vi.fn().mockImplementation(async () => mockPlanDetail),
      hydrateEvidenceFn: mockHydrateEvidence,
      runPinnedTaskFn: mockRunPinnedTask as any,
      resolveSourceRefsFn: vi.fn().mockResolvedValue([]),
    };

    await expect(
      runCurriculumCoordinator(dummyRequest, dummyPreflight, {
        signal: abortController.signal,
        deps,
      })
    ).rejects.toThrow();

    expect(cancelJobFn).toHaveBeenCalledWith('job_gen_abort', 1);
  });

  it('StudyJobController enforces global concurrency (max 2) and target concurrency (max 1)', async () => {
    const controller = new StudyJobController();

    const planDetail1 = createMockPlanDetail(1, 'spv_draft_1');
    const planDetail2 = createMockPlanDetail(1, 'spv_draft_2');
    const planDetail3 = createMockPlanDetail(1, 'spv_draft_3');

    let resolveTask1: () => void;
    let resolveTask2: () => void;

    const blockingStepPromise1 = new Promise<any>((res) => {
      resolveTask1 = () =>
        res({
          jobId: 'job_1',
          stepKey: 'decompose:0000',
          ordinal: 1,
          inputHash: 'h',
          status: 'running',
          outputRefId: null,
          safeError: null,
          completedAt: null,
        });
    });

    const blockingStepPromise2 = new Promise<any>((res) => {
      resolveTask2 = () =>
        res({
          jobId: 'job_2',
          stepKey: 'decompose:0000',
          ordinal: 1,
          inputHash: 'h',
          status: 'running',
          outputRefId: null,
          safeError: null,
          completedAt: null,
        });
    });

    const dummyHydratedEvidence = {
      batches: [
        {
          batchIndex: 0,
          handles: [
            {
              handle: 'src_h0',
              documentId: 'doc_os_1',
              documentTitle: 'OS PDF',
              sourceType: 'pdf',
              revision: 'rev_os_1',
              excerpt: 'text',
              excerptSha256: 'sha',
            },
          ],
          totalChars: 4,
        },
      ],
      allHandles: [
        {
          handle: 'src_h0',
          documentId: 'doc_os_1',
          documentTitle: 'OS PDF',
          sourceType: 'pdf',
          revision: 'rev_os_1',
          excerpt: 'text',
          excerptSha256: 'sha',
        },
      ],
      handleMap: new Map(),
      handleToSourceRefIdMap: new Map([['src_h0', 'ssr_1']]),
      resolutions: [],
      uniqueHits: [],
      conceptSeeds: [],
    };

    const mockStartJob = (jobId: string, targetId: string) =>
      vi.fn().mockResolvedValue({
        id: jobId,
        kind: 'curriculum',
        targetId,
        targetRevision: 1,
        requestHash: 'hash',
        creationKey: `ck_${jobId}`,
        status: 'running',
        nextStepIndex: 0,
        leaseOwner: 'test_owner',
        leaseExpiresAt: '2026-11-10T00:02:00Z',
        cancellationEpoch: 0,
        attemptCount: 1,
        preflight: dummyPreflight,
        progress: { completed: 0, total: 2, labelKey: 'started' },
        lastError: null,
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      } as StudyGenerationJob);

    const validTopicsOutput = {
      schemaVersion: 1,
      topics: [
        {
          handle: 't_0',
          title: 'Topic 0',
          summary: 'Summary 0',
          learningObjectives: ['Obj 0'],
          conceptName: 'Concept 0',
          materialSupport: 'grounded',
          sourceHandles: ['src_h0'],
        },
        {
          handle: 't_1',
          title: 'Topic 1',
          summary: 'Summary 1',
          learningObjectives: ['Obj 1'],
          conceptName: 'Concept 1',
          materialSupport: 'grounded',
          sourceHandles: ['src_h0'],
        },
        {
          handle: 't_2',
          title: 'Topic 2',
          summary: 'Summary 2',
          learningObjectives: ['Obj 2'],
          conceptName: 'Concept 2',
          materialSupport: 'grounded',
          sourceHandles: ['src_h0'],
        },
      ],
    };

    // Start job 1
    const job1Promise = controller.startCurriculumJob(
      { ...dummyRequest, planId: 'plan_1' },
      dummyPreflight,
      {
        deps: {
          getPlanFn: vi.fn().mockResolvedValue(planDetail1),
          startJobFn: mockStartJob('job_1', 'plan_1'),
          claimStepFn: vi.fn().mockImplementation(() => blockingStepPromise1),
          hydrateEvidenceFn: vi.fn().mockResolvedValue(dummyHydratedEvidence),
          runPinnedTaskFn: vi.fn().mockResolvedValue({
            output: validTopicsOutput,
          } as any),
          completeStepFn: vi.fn().mockResolvedValue({} as any),
          saveDraftFn: vi.fn().mockResolvedValue(planDetail1),
          resolveSourceRefsFn: vi.fn().mockResolvedValue([]),
        },
      }
    );

    // Attempt starting another job for the SAME target -> should reject
    await expect(
      controller.startCurriculumJob({ ...dummyRequest, planId: 'plan_1' }, dummyPreflight, {
        deps: {
          getPlanFn: vi.fn().mockResolvedValue(planDetail1),
        },
      })
    ).rejects.toMatchObject({
      code: 'invalid_state',
      messageKey: 'study_generation.error.target_job_active',
    });

    // Start job 2 for different target
    const job2Promise = controller.startCurriculumJob(
      { ...dummyRequest, planId: 'plan_2' },
      dummyPreflight,
      {
        deps: {
          getPlanFn: vi.fn().mockResolvedValue(planDetail2),
          startJobFn: mockStartJob('job_2', 'plan_2'),
          claimStepFn: vi.fn().mockImplementation(() => blockingStepPromise2),
          hydrateEvidenceFn: vi.fn().mockResolvedValue(dummyHydratedEvidence),
          runPinnedTaskFn: vi.fn().mockResolvedValue({
            output: validTopicsOutput,
          } as any),
          completeStepFn: vi.fn().mockResolvedValue({} as any),
          saveDraftFn: vi.fn().mockResolvedValue(planDetail2),
          resolveSourceRefsFn: vi.fn().mockResolvedValue([]),
        },
      }
    );

    expect(controller.activeJobCount).toBe(2);

    // Attempt starting a 3rd concurrent job -> should reject due to global cap of 2
    await expect(
      controller.startCurriculumJob({ ...dummyRequest, planId: 'plan_3' }, dummyPreflight, {
        deps: {
          getPlanFn: vi.fn().mockResolvedValue(planDetail3),
        },
      })
    ).rejects.toMatchObject({
      code: 'invalid_state',
      messageKey: 'study_generation.error.concurrency_limit',
    });

    // Finish job 1 and job 2
    resolveTask1!();
    resolveTask2!();
    await job1Promise;
    await job2Promise;

    expect(controller.activeJobCount).toBe(0);
  });

  it('resumes from nextStepIndex without repeating completed steps or duplicating draft nodes', async () => {
    // Simulate draft plan that already has 3 nodes saved from step 0 (decompose)
    let mockPlanDetail = createMockPlanDetail(2);
    mockPlanDetail.version.nodes = [
      {
        nodeId: 'node_1',
        title: 'Processes',
        summary: 'Process execution',
        learningObjectives: ['Explain process states'],
        conceptId: 'c_process',
        conceptLabel: 'Processes',
        position: 0,
        included: true,
        locked: false,
        userAdded: false,
        userModified: false,
        materialSupport: 'grounded',
        whyHere: 'Basis',
        sourceRefIds: ['ssr_1'],
      },
      {
        nodeId: 'node_2',
        title: 'CPU Scheduling',
        summary: 'Scheduling policies',
        learningObjectives: ['Compare FCFS and RR'],
        conceptId: 'c_sched',
        conceptLabel: 'Scheduling',
        position: 1,
        included: true,
        locked: false,
        userAdded: false,
        userModified: false,
        materialSupport: 'grounded',
        whyHere: 'Core',
        sourceRefIds: ['ssr_1'],
      },
    ];

    const claimedSteps: string[] = [];

    const mockStartJob = vi.fn().mockResolvedValue({
      id: 'job_resumed',
      kind: 'curriculum',
      targetId: 'spv_draft_1',
      targetRevision: 2,
      requestHash: 'hash',
      creationKey: 'ck_resume',
      status: 'running',
      nextStepIndex: 1, // Resuming directly at step 1 (prerequisites)
      leaseOwner: 'test_owner',
      leaseExpiresAt: '2026-11-10T00:02:00Z',
      cancellationEpoch: 0,
      attemptCount: 2,
      preflight: dummyPreflight,
      progress: { completed: 1, total: 2, labelKey: 'resumed' },
      lastError: null,
      createdAt: '2026-11-10T00:00:00Z',
      updatedAt: '2026-11-10T00:00:00Z',
    } as StudyGenerationJob);

    const mockClaimStep = vi.fn().mockImplementation((jobId, stepKey) => {
      claimedSteps.push(stepKey);
      return {
        jobId,
        stepKey,
        ordinal: 2,
        inputHash: 'hash',
        status: 'running',
        outputRefId: null,
        safeError: null,
        completedAt: null,
      };
    });

    const mockSaveDraft = vi.fn().mockImplementation(async (input: SaveStudyPlanDraftInput) => {
      mockPlanDetail = {
        ...mockPlanDetail,
        plan: { ...mockPlanDetail.plan, revision: mockPlanDetail.plan.revision + 1 },
        version: {
          ...mockPlanDetail.version,
          nodes: input.nodes,
          prerequisites: input.prerequisites,
        },
      };
      return mockPlanDetail;
    });

    const mockHydrateEvidence = vi.fn().mockResolvedValue({
      batches: [{ batchIndex: 0, handles: [], totalChars: 0 }],
      allHandles: [],
      handleMap: new Map(),
      handleToSourceRefIdMap: new Map(),
      resolutions: [],
      uniqueHits: [],
      conceptSeeds: [],
    });

    const mockRunPinnedTask = vi.fn().mockResolvedValue({
      output: {
        schemaVersion: 1,
        edges: [
          {
            prerequisiteHandle: 't_0',
            dependentHandle: 't_1',
            support: 'inferred',
            rationale: 'Process needed for scheduling',
            sourceHandles: [],
          },
        ],
      },
      taskId: 'study-curriculum-prerequisites',
      providerId: 'ollama:llama3',
      endpointLocality: 'device',
      requestedModelClass: 'reasoning',
      servedModelClass: 'reasoning',
      fallbackPath: 'none',
      validationOutcome: 'success',
    });

    const deps: CoordinatorDependencies = {
      startJobFn: mockStartJob,
      claimStepFn: mockClaimStep,
      completeStepFn: vi.fn().mockResolvedValue({} as any),
      saveDraftFn: mockSaveDraft,
      getPlanFn: vi.fn().mockImplementation(async () => mockPlanDetail),
      hydrateEvidenceFn: mockHydrateEvidence,
      runPinnedTaskFn: mockRunPinnedTask as any,
      resolveSourceRefsFn: vi.fn().mockResolvedValue([]),
    };

    const result = await runCurriculumCoordinator(dummyRequest, dummyPreflight, { deps });

    // Step 0 was skipped; only step 1 (prerequisites:0001) was claimed
    expect(claimedSteps).toEqual(['prerequisites:0001']);
    expect(result.planDetail.version.prerequisites.length).toBe(1);
    expect(result.planDetail.version.nodes.length).toBe(2);
  });

  it('detects stale plan head revision and aborts step', async () => {
    const mockPlanDetail = createMockPlanDetail(1);

    const mockStartJob = vi.fn().mockResolvedValue({
      id: 'job_stale_rev',
      kind: 'curriculum',
      targetId: 'spv_draft_1',
      targetRevision: 1,
      requestHash: 'hash',
      creationKey: 'ck_stale',
      status: 'running',
      nextStepIndex: 0,
      leaseOwner: 'test_owner',
      leaseExpiresAt: '2026-11-10T00:02:00Z',
      cancellationEpoch: 0,
      attemptCount: 1,
      preflight: dummyPreflight,
      progress: { completed: 0, total: 2, labelKey: 'started' },
      lastError: null,
      createdAt: '2026-11-10T00:00:00Z',
      updatedAt: '2026-11-10T00:00:00Z',
    } as StudyGenerationJob);

    // User modified plan in another tab: revision bumped from 1 to 2
    const bumpedPlanDetail = createMockPlanDetail(2);

    let getPlanCallCount = 0;
    const mockGetPlan = vi.fn().mockImplementation(async () => {
      getPlanCallCount++;
      return getPlanCallCount === 1 ? mockPlanDetail : bumpedPlanDetail;
    });

    const deps: CoordinatorDependencies = {
      startJobFn: mockStartJob,
      claimStepFn: vi.fn(),
      getPlanFn: mockGetPlan,
      hydrateEvidenceFn: vi.fn().mockResolvedValue({
        batches: [{ batchIndex: 0, handles: [], totalChars: 0 }],
        allHandles: [],
        handleMap: new Map(),
        handleToSourceRefIdMap: new Map(),
        resolutions: [],
        uniqueHits: [],
        conceptSeeds: [],
      }),
      resolveSourceRefsFn: vi.fn().mockResolvedValue([]),
    };

    await expect(
      runCurriculumCoordinator(dummyRequest, dummyPreflight, { deps })
    ).rejects.toMatchObject({
      code: 'stale_revision',
    });
  });
});
