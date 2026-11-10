/**
 * Unit & Integration tests for Rules-Only (No-AI) Curriculum Generation.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Concept, ConceptLink } from '../../../../api/concept-links';
import type {
  SaveStudyPlanDraftInput,
  StudyPlanDetail,
} from '../../../../types/learningPaths';
import type {
  StudySourceRefInput,
  StudySourceScopeV1,
} from '../../../../types/studySource';
import { runNoAiCurriculumCoordinator } from '../noAiCoordinator';
import type { CurriculumGenerationRequest } from '../types';

describe('runNoAiCurriculumCoordinator (C2-T08)', () => {
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
        revision: 'rev_1',
        revisionKind: 'content-hash',
        extractIds: [],
        isAiExcluded: false,
        isLocalOnly: false,
      },
      {
        documentId: 'doc_os_2',
        title: 'Virtual Memory EPUB',
        sourceType: 'epub',
        revision: 'rev_2',
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

  const dummyRequest: CurriculumGenerationRequest = {
    planId: 'plan_no_ai_1',
    baseVersionId: 'spv_draft_1',
    goal: 'Master processes and memory without AI',
    depth: 'survey',
    sourceScope: dummyScope,
    priorEvidence: null,
    knowledgePolicy: 'source-only',
    rulesOnly: true,
  };

  function createMockPlanDetail(): StudyPlanDetail {
    return {
      plan: {
        id: 'plan_no_ai_1',
        title: 'Rules Outline Plan',
        goal: 'Master processes and memory without AI',
        depth: 'survey',
        status: 'active',
        currentVersionId: null,
        currentVersion: 0,
        draftVersionId: 'spv_draft_1',
        revision: 1,
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      },
      version: {
        id: 'spv_draft_1',
        planId: 'plan_no_ai_1',
        version: 1,
        state: 'draft',
        baseVersionId: null,
        sourceScope: dummyScope,
        nodes: [],
        prerequisites: [],
        changeSummary: null,
        createdBy: 'user',
        createdAt: '2026-11-10T00:00:00Z',
        publishedAt: null,
      },
      activityByNodeId: {},
      sourceRefs: {},
    };
  }

  it('generates a reproducible source-cited curriculum using confirmed concepts without AI', async () => {
    let mockPlanDetail = createMockPlanDetail();

    const dummyConcepts: Concept[] = [
      {
        id: 'c_process',
        name: 'Processes and Threads',
        normalizedName: 'processes and threads',
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      },
      {
        id: 'c_vm',
        name: 'Virtual Memory',
        normalizedName: 'virtual memory',
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      },
    ];

    const dummyLinks: ConceptLink[] = [
      {
        id: 'link_1',
        sourceKind: 'document',
        sourceId: 'doc_os_1',
        targetKind: 'concept',
        targetId: 'c_process',
        relationType: 'related-to',
        confidence: 1.0,
        createdBy: 'user',
        createdAt: '2026-11-10T00:00:00Z',
        isDismissed: false,
      },
      {
        id: 'link_2',
        sourceKind: 'document',
        sourceId: 'doc_os_2',
        targetKind: 'concept',
        targetId: 'c_vm',
        relationType: 'related-to',
        confidence: 1.0,
        createdBy: 'user',
        createdAt: '2026-11-10T00:00:00Z',
        isDismissed: false,
      },
      {
        id: 'link_prereq',
        sourceKind: 'concept',
        sourceId: 'c_process',
        targetKind: 'concept',
        targetId: 'c_vm',
        relationType: 'prerequisite-of',
        confidence: 1.0,
        createdBy: 'user',
        createdAt: '2026-11-10T00:00:00Z',
        isDismissed: false,
      },
    ];

    const savedDrafts: SaveStudyPlanDraftInput[] = [];
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

    const mockResolveRefs = vi.fn().mockImplementation(async (inputs: StudySourceRefInput[]) =>
      inputs.map((inp, idx) => ({
        ref: {
          schemaVersion: 1,
          id: `ssr_rules_${idx}`,
          documentId: inp.documentId,
          excerpt: inp.excerpt,
          revision: inp.revision || 'rev_1',
          revisionKind: 'content-hash',
          excerptSha256: 'sha256_mock',
          documentTitle: inp.documentTitle || 'Doc',
          sourceType: inp.sourceType || 'pdf',
          capturedAt: '2026-11-10T00:00:00Z',
        },
        status: 'current',
        navigation: 'coarse',
      }))
    );

    const result = await runNoAiCurriculumCoordinator(dummyRequest, {
      getPlanFn: vi.fn().mockResolvedValue(mockPlanDetail),
      saveDraftFn: mockSaveDraft,
      resolveSourceRefsFn: mockResolveRefs,
      listConfirmedConceptLinksFn: vi.fn().mockResolvedValue(dummyLinks),
      listConceptsFn: vi.fn().mockResolvedValue(dummyConcepts),
    });

    expect(result.isRulesOnly).toBe(true);
    expect(savedDrafts.length).toBe(1);

    // Plan nodes include the confirmed concepts
    expect(result.planDetail.version.nodes.length).toBeGreaterThanOrEqual(2);
    const titles = result.planDetail.version.nodes.map((n) => n.title);
    expect(titles).toContain('Processes and Threads');
    expect(titles).toContain('Virtual Memory');

    // Confirmed prerequisite edge is wired
    expect(result.planDetail.version.prerequisites.length).toBe(1);
    expect(result.planDetail.version.prerequisites[0].support).toBe('confirmed-concept-link');
  });

  it('falls back to source document inventory when no concepts are present', async () => {
    let mockPlanDetail = createMockPlanDetail();

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

    const mockResolveRefs = vi.fn().mockImplementation(async (inputs: StudySourceRefInput[]) =>
      inputs.map((inp, idx) => ({
        ref: {
          schemaVersion: 1,
          id: `ssr_doc_${idx}`,
          documentId: inp.documentId,
          excerpt: inp.excerpt,
          revision: inp.revision || 'rev_1',
          revisionKind: 'content-hash',
          excerptSha256: 'sha256_mock',
          documentTitle: inp.documentTitle || 'Doc',
          sourceType: inp.sourceType || 'pdf',
          capturedAt: '2026-11-10T00:00:00Z',
        },
        status: 'current',
        navigation: 'coarse',
      }))
    );

    const result = await runNoAiCurriculumCoordinator(dummyRequest, {
      getPlanFn: vi.fn().mockResolvedValue(mockPlanDetail),
      saveDraftFn: mockSaveDraft,
      resolveSourceRefsFn: mockResolveRefs,
      listConfirmedConceptLinksFn: vi.fn().mockResolvedValue([]),
      listConceptsFn: vi.fn().mockResolvedValue([]),
    });

    expect(result.isRulesOnly).toBe(true);
    expect(result.planDetail.version.nodes.length).toBeGreaterThanOrEqual(2);
    expect(result.planDetail.version.nodes[0].title).toBe('Operating Systems PDF');
    expect(result.planDetail.version.nodes[1].title).toBe('Virtual Memory EPUB');
    expect(result.planDetail.version.nodes[0].sourceRefIds.length).toBe(1);
  });

  it('fails if source document revision has changed', async () => {
    const staleResolveRefs = vi.fn().mockResolvedValue([
      {
        status: 'stale',
        navigation: 'exact',
        ref: {
          schemaVersion: 1,
          id: 'ssr_stale',
          documentId: 'doc_os_1',
          excerpt: '',
          revision: 'rev_CHANGED',
          revisionKind: 'content-hash',
          excerptSha256: '',
          documentTitle: 'OS',
          sourceType: 'pdf',
          capturedAt: '',
        },
      },
    ]);

    await expect(
      runNoAiCurriculumCoordinator(dummyRequest, {
        getPlanFn: vi.fn().mockResolvedValue(createMockPlanDetail()),
        resolveSourceRefsFn: staleResolveRefs,
      })
    ).rejects.toMatchObject({
      code: 'stale_source',
    });
  });
});
