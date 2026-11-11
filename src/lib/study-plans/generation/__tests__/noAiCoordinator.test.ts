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

  function createMockPlanDetailWithScope(sourceScope: StudySourceScopeV1): StudyPlanDetail {
    const detail = createMockPlanDetail();
    return { ...detail, version: { ...detail.version, sourceScope } };
  }

  it('preserves confirmed concepts and prerequisite links without fabricating passage citations', async () => {
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

    const refreshedScope: StudySourceScopeV1 = {
      ...dummyScope,
      resolvedDocuments: dummyScope.resolvedDocuments.map((doc) => ({ ...doc, revision: `live-${doc.revision}` })),
      limitations: ['index_not_verified'],
    };
    const mockRefreshScope = vi.fn().mockResolvedValue(refreshedScope);

    const result = await runNoAiCurriculumCoordinator(dummyRequest, {
      getPlanFn: vi.fn().mockResolvedValue(mockPlanDetail),
      saveDraftFn: mockSaveDraft,
      refreshScopeFn: mockRefreshScope,
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
    expect(result.planDetail.version.nodes.every((node) => node.sourceRefIds.length === 0)).toBe(true);
    expect(result.planDetail.version.nodes.every((node) => node.materialSupport === 'unsupported')).toBe(true);
    expect(mockRefreshScope).toHaveBeenCalledWith(dummyScope);
    expect(savedDrafts[0].sourceScope).toEqual(refreshedScope);
  });

  it('uses coarse document inventory with no fake objectives, references, or inferred edges', async () => {
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

    const mockRefreshScope = vi.fn().mockResolvedValue(dummyScope);

    const result = await runNoAiCurriculumCoordinator(dummyRequest, {
      getPlanFn: vi.fn().mockResolvedValue(mockPlanDetail),
      saveDraftFn: mockSaveDraft,
      refreshScopeFn: mockRefreshScope,
      listConfirmedConceptLinksFn: vi.fn().mockResolvedValue([]),
      listConceptsFn: vi.fn().mockResolvedValue([]),
    });

    expect(result.isRulesOnly).toBe(true);
    expect(result.planDetail.version.nodes).toHaveLength(2);
    expect(result.planDetail.version.nodes[0].title).toBe('Operating Systems PDF');
    expect(result.planDetail.version.nodes[1].title).toBe('Virtual Memory EPUB');
    expect(result.planDetail.version.nodes.every((node) => node.sourceRefIds.length === 0)).toBe(true);
    expect(result.planDetail.version.nodes.every((node) => node.learningObjectives[0].startsWith('Review the title'))).toBe(true);
    expect(result.planDetail.version.nodes.every((node) => node.materialSupport === 'unsupported')).toBe(true);
    expect(result.planDetail.version.nodes.every((node) => node.summary.includes('contents were not inspected'))).toBe(true);
    expect(result.planDetail.version.prerequisites).toEqual([]);
    expect(mockRefreshScope).toHaveBeenCalledTimes(1);
  });

  it('fails if source document revision has changed', async () => {
    const staleRefresh = vi.fn().mockRejectedValue({ code: 'stale_source' });

    await expect(
      runNoAiCurriculumCoordinator(dummyRequest, {
        getPlanFn: vi.fn().mockResolvedValue(createMockPlanDetail()),
        refreshScopeFn: staleRefresh,
      })
    ).rejects.toMatchObject({
      code: 'stale_source',
    });
  });

  it('rejects a request whose base draft version is no longer current', async () => {
    const refreshScope = vi.fn().mockResolvedValue(dummyScope);
    await expect(runNoAiCurriculumCoordinator(
      { ...dummyRequest, baseVersionId: 'spv_old_draft' },
      { getPlanFn: vi.fn().mockResolvedValue(createMockPlanDetail()), refreshScopeFn: refreshScope }
    )).rejects.toMatchObject({ code: 'invalid_state' });
    expect(refreshScope).not.toHaveBeenCalled();
  });

  it('uses selected extract links as concepts without fetching broad concept metadata', async () => {
    const extractScope: StudySourceScopeV1 = {
      ...dummyScope,
      selected: { documentIds: [], extractIds: ['extract_selected'], collectionIds: [], tagIds: [] },
      resolvedDocuments: [{ ...dummyScope.resolvedDocuments[0], extractIds: ['extract_selected'] }],
    };
    const extractLinks: ConceptLink[] = [
      {
        id: 'extract-concept-1', sourceKind: 'extract', sourceId: 'extract_selected',
        targetKind: 'concept', targetId: 'c_extract_a', relationType: 'related-to',
        confidence: 1, createdBy: 'user', createdAt: '2026-11-10T00:00:00Z', isDismissed: false,
      },
      {
        id: 'extract-concept-2', sourceKind: 'concept', sourceId: 'c_extract_b',
        targetKind: 'extract', targetId: 'extract_selected', relationType: 'related-to',
        confidence: 1, createdBy: 'user', createdAt: '2026-11-10T00:00:00Z', isDismissed: false,
      },
      {
        id: 'extract-prerequisite', sourceKind: 'concept', sourceId: 'c_extract_a',
        targetKind: 'concept', targetId: 'c_extract_b', relationType: 'prerequisite-of',
        confidence: 1, createdBy: 'user', createdAt: '2026-11-10T00:00:00Z', isDismissed: false,
      },
      {
        id: 'unselected-document-concept', sourceKind: 'document', sourceId: 'doc_os_1',
        targetKind: 'concept', targetId: 'c_unselected_doc', relationType: 'related-to',
        confidence: 1, createdBy: 'user', createdAt: '2026-11-10T00:00:00Z', isDismissed: false,
      },
    ];
    let mockPlanDetail = createMockPlanDetail();
    const saveDraftFn = vi.fn().mockImplementation(async (input: SaveStudyPlanDraftInput) => {
      mockPlanDetail = {
        ...mockPlanDetail,
        version: {
          ...mockPlanDetail.version,
          sourceScope: input.sourceScope as StudySourceScopeV1,
          nodes: input.nodes,
          prerequisites: input.prerequisites,
        },
      };
      return mockPlanDetail;
    });
    const listConceptsFn = vi.fn().mockResolvedValue([]);

    const result = await runNoAiCurriculumCoordinator(
      { ...dummyRequest, sourceScope: extractScope },
      {
        getPlanFn: vi.fn().mockResolvedValue(createMockPlanDetailWithScope(extractScope)),
        refreshScopeFn: vi.fn().mockResolvedValue(extractScope),
        saveDraftFn,
        listConfirmedConceptLinksFn: vi.fn().mockResolvedValue(extractLinks),
        listConceptsFn,
      }
    );

    const titles = result.planDetail.version.nodes.map((node) => node.title);
    expect(titles).toContain('c_extract_a');
    expect(titles).toContain('c_extract_b');
    expect(titles).not.toContain('c_unselected_doc');
    expect(listConceptsFn).not.toHaveBeenCalled();
    expect(result.planDetail.version.prerequisites).toHaveLength(1);
  });
});
