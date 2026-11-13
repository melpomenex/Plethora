/**
 * Execution-branch preflight and denial tests.
 *
 * Verifies that endpoint-aware preflight gates run BEFORE any source
 * preparation, retrieval, or job creation, for both the library-backed and
 * model-only branches; that hard-budget stops fire before starting jobs; and
 * that unpriced providers are identified and still require consent.
 */

import { describe, expect, it, vi } from 'vitest';
import { performStudyAiPreflight } from '../preflight';
import { curriculumDecomposeTask } from '../../../ai/tasks/definitions/curriculumTasks';
import { StudyApiError } from '../../../../api/study-plans';
import { runCurriculumCoordinator, type CoordinatorDependencies } from '../coordinator';
import { runModelOnlyCurriculumCoordinator, type ModelOnlyCoordinatorDependencies } from '../modelOnlyCoordinator';
import type { StudyAiPreflight, StudyGenerationJob, StudyJobProgress } from '../types';
import type { CurriculumGenerationRequest } from '../types';

const remoteUnpricedRoute = {
  task: curriculumDecomposeTask,
  provider: {
    id: 'vendor-cloud',
    kind: 'cloud',
    baseUrl: 'https://api.vendor.example.com',
    hasApiKey: true,
    getCapabilities: async () => ({ textGeneration: true }),
  },
  requestedModelClass: 'full',
  servedModelClass: 'full',
  fallbackPath: 'none',
} as const;

describe('Execution-branch preflight denial', () => {
  it('denies library-backed generation before source preparation when a document is AI-excluded', async () => {
    const startJobFn = vi.fn();
    const hydrateEvidenceFn = vi.fn();
    const planDetail = {
      plan: {
        id: 'plan_1', title: 'P', goal: 'G', depth: 'survey' as const, status: 'active' as const,
        currentVersionId: null, currentVersion: 0, draftVersionId: 'spv_draft_1', revision: 1,
        createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z',
      },
      version: {
        id: 'spv_draft_1', planId: 'plan_1', version: 1, state: 'draft' as const,
        baseVersionId: null,
        sourceScope: {
          schemaVersion: 1 as const,
          selected: { documentIds: ['d1'], extractIds: [], collectionIds: [], tagIds: [] },
          resolvedDocuments: [{ documentId: 'd1', title: 'D', sourceType: 'pdf', revision: 'r1', revisionKind: 'content-hash' as const, extractIds: [], isAiExcluded: true, isLocalOnly: false }],
          frozenAt: '2026-11-12T00:00:00Z',
          indexCompleteness: 'complete' as const,
          limitations: [],
        },
        knowledgeAuthority: { kind: 'library', policy: 'source-only' },
        nodes: [], prerequisites: [], changeSummary: null, createdBy: 'user' as const,
        createdAt: '2026-11-12T00:00:00Z', publishedAt: null,
      },
      activityByNodeId: {},
      sourceRefs: {},
    };
    const deps: CoordinatorDependencies = {
      startJobFn,
      hydrateEvidenceFn,
      getPlanFn: vi.fn().mockResolvedValue(planDetail),
      // Simulate the privacy gate rejecting the AI-excluded document during
      // preflight, before any plan/retrieval work is attempted.
      preparePreflightFn: vi.fn().mockRejectedValue(
        new StudyApiError({ code: 'source_ai_excluded', messageKey: 'study_generation.error.ai_excluded_source', retryable: false })
      ),
    };
    const request: CurriculumGenerationRequest = {
      planId: 'plan_1', baseVersionId: 'spv_draft_1', depth: 'survey',
      sourceScope: planDetail.version.sourceScope, knowledgePolicy: 'source-only', rulesOnly: false, priorEvidence: null,
    };
    await expect(runCurriculumCoordinator(request, {} as StudyAiPreflight, { deps }))
      .rejects.toMatchObject({ code: 'source_ai_excluded' });
    expect(startJobFn).not.toHaveBeenCalled();
    expect(hydrateEvidenceFn).not.toHaveBeenCalled();
  });

  it('stops on a hard budget before creating a job', async () => {
    const startJobFn = vi.fn();
    const planDetail = {
      plan: {
        id: 'plan_budget', title: 'P', goal: 'G', depth: 'survey' as const, status: 'active' as const,
        currentVersionId: null, currentVersion: 0, draftVersionId: 'spv_budget_draft', revision: 1,
        createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z',
      },
      version: {
        id: 'spv_budget_draft', planId: 'plan_budget', version: 1, state: 'draft' as const,
        baseVersionId: null,
        sourceScope: {
          schemaVersion: 1 as const,
          selected: { documentIds: ['d1'], extractIds: [], collectionIds: [], tagIds: [] },
          resolvedDocuments: [{ documentId: 'd1', title: 'D', sourceType: 'pdf', revision: 'r1', revisionKind: 'content-hash' as const, extractIds: [], isAiExcluded: false, isLocalOnly: false }],
          frozenAt: '2026-11-12T00:00:00Z',
          indexCompleteness: 'complete' as const,
          limitations: [],
        },
        knowledgeAuthority: { kind: 'library', policy: 'source-only' },
        nodes: [], prerequisites: [], changeSummary: null, createdBy: 'user' as const,
        createdAt: '2026-11-12T00:00:00Z', publishedAt: null,
      },
      activityByNodeId: {},
      sourceRefs: {},
    };
    const request: CurriculumGenerationRequest = {
      planId: 'plan_budget', baseVersionId: 'spv_budget_draft', depth: 'survey',
      sourceScope: planDetail.version.sourceScope, knowledgePolicy: 'source-only', rulesOnly: false, priorEvidence: null,
    };
    const deps: CoordinatorDependencies = {
      startJobFn,
      getPlanFn: vi.fn().mockResolvedValue(planDetail),
      preparePreflightFn: vi.fn().mockResolvedValue({
        route: { provider: { id: 'local', kind: 'ondevice', getCapabilities: vi.fn().mockResolvedValue({ textGeneration: true, reasoning: true }) } },
        preflight: {
          providerId: 'local', featureAllowed: true, documentIds: ['d1'], sourceExcerptCount: 1,
          sendsSourceOffDevice: false, sendsAnswersOffDevice: false, billable: false,
          cloudDisclosureAccepted: true, costConsentAccepted: true, maximumModelCalls: 1,
          generationDestination: { locality: 'device', providerClass: 'apple-native', keyless: true, sendsOffDevice: false, billable: false, requiresDisclosure: false, requiresCostConsent: false },
          embeddingDestination: null,
        } as StudyAiPreflight,
        sourceScope: planDetail.version.sourceScope,
      }),
      hydrateEvidenceFn: vi.fn().mockResolvedValue({
        batches: [{ batchIndex: 0, handles: [{ handle: 'h0', documentId: 'd1', documentTitle: 'D', sourceType: 'pdf', revision: 'r1', excerpt: 'x', excerptSha256: 's' }], totalChars: 10 }],
        allHandles: [], handleMap: new Map(), handleToSourceRefIdMap: new Map(), resolutions: [], uniqueHits: [],
        conceptSeeds: [],
        retrieval: { mode: 'lexicalOnly', embeddingModels: [], queryCount: 1, failedQueries: 0, verifiedPassages: 1, documentsWithEvidence: 1 },
      }),
    };
    await expect(runCurriculumCoordinator(request, { maximumModelCalls: 1 } as StudyAiPreflight, { deps }))
      .rejects.toMatchObject({ messageKey: 'study_generation.error.call_budget_exceeded' });
    expect(startJobFn).not.toHaveBeenCalled();
  });

  it('denies model-only generation without cost consent for a billable unpriced provider', async () => {
    const startJobFn = vi.fn();
    const deps: ModelOnlyCoordinatorDependencies = {
      startJobFn,
      getPlanFn: vi.fn().mockResolvedValue({
        plan: {
          id: 'plan_mo', title: 'MO', goal: 'G', depth: 'survey' as const, status: 'active' as const,
          currentVersionId: null, currentVersion: 0, draftVersionId: 'spv_mo_draft', revision: 1,
          createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z',
        },
        version: {
          id: 'spv_mo_draft', planId: 'plan_mo', version: 1, state: 'draft' as const,
          baseVersionId: null, sourceScope: undefined,
          knowledgeAuthority: { kind: 'model-only' },
          nodes: [], prerequisites: [], changeSummary: null, createdBy: 'user' as const,
          createdAt: '2026-11-12T00:00:00Z', publishedAt: null,
        },
        activityByNodeId: {},
        sourceRefs: {},
      }),
      preparePreflightFn: vi.fn().mockResolvedValue({
        route: { provider: { id: 'vendor-cloud', kind: 'cloud', baseUrl: 'https://api.vendor.example.com', hasApiKey: true, getCapabilities: vi.fn() } },
        preflight: {
          providerId: 'vendor-cloud',
          executionBranch: 'model-only',
          featureAllowed: true,
          documentIds: [],
          sourceExcerptCount: 0,
          sendsSourceOffDevice: true,
          sendsAnswersOffDevice: false,
          billable: true,
          cloudDisclosureAccepted: false,
          costConsentAccepted: false,
          maximumModelCalls: 4,
          generationDestination: { locality: 'remote', providerClass: 'configured-external', keyless: false, sendsOffDevice: true, billable: true, requiresDisclosure: true, requiresCostConsent: true },
          embeddingDestination: null,
        } as StudyAiPreflight,
      }),
    };
    await expect(runModelOnlyCurriculumCoordinator(
      { planId: 'plan_mo', baseVersionId: 'spv_mo_draft', depth: 'survey' },
      { cloudDisclosureAccepted: false, costConsentAccepted: false } as StudyAiPreflight,
      { deps }
    )).rejects.toMatchObject({ code: 'privacy_denied' });
    expect(startJobFn).not.toHaveBeenCalled();
  });

  it('identifies unpriced providers in preflight and still requires consent', async () => {
    const result = await performStudyAiPreflight({
      primaryTask: curriculumDecomposeTask,
      documents: [{ id: 'd1', isAiExcluded: false, isLocalOnly: false }],
      sourceExcerptCount: 1,
      plannedModelSteps: 2,
      routeOverride: remoteUnpricedRoute as never,
      cloudDisclosureAccepted: true,
      costConsentAccepted: true,
      estimateTokens: { input: 1000, output: 500 },
    });
    expect(result.preflight.billable).toBe(true);
    const dest = result.preflight.generationDestination;
    expect(typeof dest === 'object' && dest !== null ? dest.sendsOffDevice : false).toBe(true);
    // No pricing data: cost estimate must remain unknown rather than fabricating 0.
    expect(result.preflight.estimate?.costUsd).toBeUndefined();
    expect(result.preflight.estimate?.inputPrice).toBeUndefined();
    // Consent is still enforced fail-closed for the billable destination.
    await expect(performStudyAiPreflight({
      primaryTask: curriculumDecomposeTask,
      documents: [],
      sourceExcerptCount: 0,
      routeOverride: remoteUnpricedRoute as never,
      cloudDisclosureAccepted: false,
      costConsentAccepted: false,
    })).rejects.toBeInstanceOf(StudyApiError);
  });
});
