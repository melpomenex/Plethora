import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runAssessmentGenerationCoordinator,
  verifyAssessmentSourceRevisions,
} from '../generationCoordinator';
import type {
  AssessmentConfigV1,
  BlueprintDetail,
} from '../../../../types/assessmentQuestions';
import { planQuotaSlots } from '../quotaPlanner';
import { AIError } from '../../../ai/errors';
import type { StudyAiPreflight } from '../../generation/types';
import type { StudySourceRefV1, StudySourceResolution } from '../../../../types/studySource';

describe('Assessment Generation Coordinator (C3-T07)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockConfig: AssessmentConfigV1 = {
    schemaVersion: 1,
    mode: 'exam',
    requestedCount: 2,
    typeWeights: { 'single-select': 2 },
    difficultyWeights: { 2: 2 },
    topicTargets: [{ nodeId: 'n1', conceptId: 'c1', weight: 1 }],
    timeLimitSeconds: null,
    knowledgePolicy: 'source-only',
    excludedQuestionFingerprints: [],
    pointsByKind: {
      'single-select': 1,
      'multi-select': 1,
      cloze: 1,
      'short-answer': 2,
      essay: 8,
    },
  };

  const mockPreflight: StudyAiPreflight = {
    providerId: 'native-local',
    generationDestination: 'device-local',
    embeddingDestination: null,
    featureAllowed: true,
    documentIds: ['doc_1'],
    sourceExcerptCount: 1,
    sendsSourceOffDevice: false,
    sendsAnswersOffDevice: false,
    billable: false,
    cloudDisclosureAccepted: true,
    costConsentAccepted: true,
    maximumModelCalls: 6,
  };

  const mockDetail: BlueprintDetail = {
    blueprint: {
      id: 'ab_1',
      planId: 'plan_1',
      title: 'Exam 1',
      currentRevisionId: null,
      lifecycle: 'active',
      revision: 1,
      createdAt: '2026-11-10T20:00:00Z',
      updatedAt: '2026-11-10T20:00:00Z',
    },
    revision: {
      id: 'abr_1',
      blueprintId: 'ab_1',
      revision: 1,
      state: 'draft',
      planVersionId: 'spv_1',
      config: mockConfig,
      scoring: {
        schemaVersion: 1,
        singleSelect: 'exact-option',
        multiSelect: 'exact-set-all-or-nothing',
        cloze: 'equal-per-blank',
        shortAnswer: 'accepted-exact-then-rubric',
        essay: 'analytic-rubric',
        unanswered: 'zero',
        skipped: 'zero',
        negativeMarking: false,
      },
      sourceScope: {
        schemaVersion: 1,
        selected: {
          documentIds: ['doc_1'],
          extractIds: [],
          collectionIds: [],
          tagIds: [],
        },
        resolvedDocuments: [
          {
            documentId: 'doc_1',
            title: 'Doc 1',
            sourceType: 'pdf',
            revision: 'rev_1',
            revisionKind: 'content-hash',
            extractIds: [],
            isAiExcluded: false,
            isLocalOnly: false,
          },
        ],
        frozenAt: '2026-11-10T20:00:00Z',
        indexCompleteness: 'complete',
        limitations: [],
      },
      quota: {
        requested: 2,
        accepted: 0,
        slots: [],
        deficits: [],
        shortfallAccepted: false,
        duplicateQuestionFingerprints: [],
        validationIssues: [],
      },
      generationJobId: null,
      sourceSnapshotHash: 'sha256:snap1',
      createdAt: '2026-11-10T20:00:00Z',
      publishedAt: null,
    },
    questions: [],
  };

  const mockSourceRef: StudySourceRefV1 = {
    schemaVersion: 1,
    id: 'ref_1',
    documentId: 'doc_1',
    documentTitle: 'Doc 1',
    excerpt: 'Sample excerpt from document 1',
    excerptSha256: 'sha256:e1',
    revision: 'rev_1',
    revisionKind: 'content-hash',
    sourceType: 'pdf',
    capturedAt: '2026-11-10T20:00:00Z',
  };

  it('rejects ready blueprint revision (cannot modify ready revision)', async () => {
    const readyDetail: BlueprintDetail = {
      ...mockDetail,
      revision: { ...mockDetail.revision, state: 'ready' },
    };

    await expect(
      runAssessmentGenerationCoordinator(
        { blueprintRevisionId: 'abr_1', expectedRevision: 1 },
        mockPreflight,
        {
          deps: {
            getBlueprintRevisionFn: vi.fn().mockResolvedValue(readyDetail),
          },
        }
      )
    ).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('verifies source revisions and detects stale/missing sources', async () => {
    const mockResolve = vi.fn().mockResolvedValue([
      {
        status: 'stale',
        ref: { ...mockSourceRef, revision: 'rev_different' },
      } as StudySourceResolution,
    ]);

    await expect(
      verifyAssessmentSourceRevisions(mockDetail.revision.sourceScope, {
        ref_1: { ref: mockSourceRef, status: 'current', navigation: 'exact' },
      }, mockResolve)
    ).rejects.toMatchObject({
      code: 'stale_source',
    });
  });

  it.each(['new', 'retry', 'invalid-first-batch'] as const)('generates and saves assessment questions (%s)', async (scenario) => {
    const config = { ...mockConfig, requestedCount: scenario === 'invalid-first-batch' ? 6 : 2 };
    const slots = planQuotaSlots(config, mockDetail.revision.id);
    const draft = {
      ...mockDetail,
      revision: { ...mockDetail.revision, config },
      questions: scenario === 'retry' ? [{
        slotKey: slots[0].slotKey,
        fingerprint: 'saved-question',
        validation: 'valid',
      }] : [],
    } as BlueprintDetail;
    const mockSaveQuestion = vi.fn().mockResolvedValue({ id: 'aqr_1' });
    const mockSaveDraft = vi.fn().mockResolvedValue({
      ...mockDetail,
      revision: {
        ...mockDetail.revision,
        state: 'needs-review',
      },
    });

    const mockStartJob = vi.fn().mockImplementation(async ({ creationKey }) => ({ id: 'job_gen_1', creationKey }));
    const mockClaimStep = vi.fn().mockResolvedValue({
      stepKey: 'question_batch:0000',
      stepStatus: 'pending',
    });
    const mockCompleteStep = vi.fn().mockResolvedValue({ stepStatus: 'completed' });

    const mockRunPinned = vi.fn().mockImplementation(async (_task, input) => {
      if (scenario === 'invalid-first-batch' && input.stepKey === 'question_batch:0000') {
        throw new AIError('InvalidStructuredOutput', 'private raw reply', {
          completion: { attemptCount: 2, terminalFailureKind: 'output-limit' },
        });
      }
      return {
      output: {
        schemaVersion: 1,
        questions: input.slots.map((s: any, idx: number) => ({
          slotKey: s.slotKey,
          question: {
            kind: s.kind,
            prompt: `Question ${idx + 1}`,
            learningObjectives: [`Obj ${idx + 1}`],
            explanation: 'Exp',
            sourceHandles: ['s_0'],
            applicationLevel: 'recall',
            hints: [],
            options: [
              { handle: 'h1', text: 'Opt 1' },
              { handle: 'h2', text: 'Opt 2' },
            ],
            correctOptionHandle: 'h1',
          },
        })),
      },
      provenance: { provider: 'test', model: 'test-model' },
      };
    });

    const mockResolveSources = vi.fn().mockResolvedValue([
      {
        status: 'current',
        navigation: 'exact',
        ref: mockSourceRef,
      } as StudySourceResolution,
    ]);

    const result = await runAssessmentGenerationCoordinator(
      { blueprintRevisionId: 'abr_1', expectedRevision: 1 },
      mockPreflight,
      {
        deps: {
          getBlueprintRevisionFn: vi.fn().mockResolvedValue(draft),
          saveBlueprintDraftFn: mockSaveDraft,
          saveQuestionDraftFn: mockSaveQuestion,
          startJobFn: mockStartJob,
          claimStepFn: mockClaimStep,
          completeStepFn: mockCompleteStep,
          resolveSourceRefsFn: mockResolveSources,
          getStudyPlanFn: vi.fn().mockResolvedValue({
            version: { id: 'spv_1', sourceScope: mockDetail.revision.sourceScope },
            sourceRefs: { ref_1: { ref: mockSourceRef, status: 'current', navigation: 'exact' } },
          }),
          refreshScopeFn: vi.fn(async (scope) => scope),
          preflightFn: vi.fn().mockResolvedValue({
            preflight: mockPreflight,
            route: { provider: { id: 'native-local' }, task: {} },
          }),
          runPinnedTaskFn: mockRunPinned,
        },
      }
    );

    expect(result.jobId).toBe('job_gen_1');
    expect(mockStartJob).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'assessment-generation',
        targetId: 'abr_1',
      })
    );

    expect(mockSaveQuestion).toHaveBeenCalledTimes(scenario === 'retry' ? 1 : 2);
    expect(mockCompleteStep).toHaveBeenCalledTimes(scenario === 'invalid-first-batch' ? 2 : 1);
    expect(result.quotaReport.requested).toBe(config.requestedCount);
    expect(result.quotaReport.accepted).toBe(2);
    if (scenario === 'retry') {
      expect(mockRunPinned.mock.calls[0][1].slots).toEqual([slots[1]]);
    }
    if (scenario === 'invalid-first-batch') {
      expect(result.deficitsCount).toBe(4);
      expect(result.callsMade).toBe(3);
      expect(result.quotaReport.validationIssues).toContainEqual(expect.objectContaining({ code: 'invalid_model_output' }));
      expect(JSON.stringify(result.quotaReport)).not.toContain('private raw reply');
    }
    expect(mockSaveDraft).toHaveBeenCalled();
    const submittedSteps = mockStartJob.mock.calls[0][0].steps;
    expect(submittedSteps.map((step: { ordinal: number }) => step.ordinal)).toEqual(scenario === 'invalid-first-batch' ? [0, 1] : [0]);
    expect(mockCompleteStep.mock.calls[0][0].inputHash).toBe(submittedSteps[0].inputHash);
    expect(mockResolveSources.mock.calls[0][0][0]).toMatchObject({
      documentId: 'doc_1',
      excerpt: 'Sample excerpt from document 1',
      revision: 'rev_1',
    });
  });

  it('fails source-only generation before creating a job when the committed version has no verified refs', async () => {
    const startJob = vi.fn();
    await expect(runAssessmentGenerationCoordinator(
      { blueprintRevisionId: 'abr_1', expectedRevision: 1 },
      mockPreflight,
      { deps: {
        getBlueprintRevisionFn: vi.fn().mockResolvedValue(mockDetail),
        getStudyPlanFn: vi.fn().mockResolvedValue({
          version: { id: 'spv_1', sourceScope: mockDetail.revision.sourceScope }, sourceRefs: {},
        }),
        refreshScopeFn: vi.fn(async (scope) => scope),
        resolveSourceRefsFn: vi.fn(),
        startJobFn: startJob,
      } }
    )).rejects.toMatchObject({ code: 'missing_source' });
    expect(startJob).not.toHaveBeenCalled();
  });

  it('handles abort signal gracefully and throws cancelled error', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runAssessmentGenerationCoordinator(
        { blueprintRevisionId: 'abr_1', expectedRevision: 1 },
        mockPreflight,
        {
          signal: controller.signal,
          deps: {
            getBlueprintRevisionFn: vi.fn().mockResolvedValue(mockDetail),
            resolveSourceRefsFn: vi.fn().mockResolvedValue([{ status: 'exact', ref: mockSourceRef }]),
          },
        }
      )
    ).rejects.toMatchObject({
      code: 'cancelled',
    });
  });
});
