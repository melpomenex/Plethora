/**
 * Unit & Integration tests for Honest Plan Coverage Projection.
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  CoverageAnalysisResult,
  CoverageConceptInput,
} from '../../../ai/concepts/coverage';
import type {
  StudyPlanDetail,
  StudyPlanVersionNode,
} from '../../../../types/learningPaths';
import type { StudySourceScopeV1 } from '../../../../types/studySource';
import { computePlanCoverageProjection } from '../coverageProjection';

describe('computePlanCoverageProjection (C2-T08)', () => {
  const dummyScope: StudySourceScopeV1 = {
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
        title: 'Algorithms Textbook',
        sourceType: 'pdf',
        revision: 'rev_1',
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

  function createMockPlanDetail(nodeCount = 3): StudyPlanDetail {
    const nodes: StudyPlanVersionNode[] = [];
    for (let i = 0; i < nodeCount; i++) {
      nodes.push({
        nodeId: `node_${i}`,
        title: `Concept ${i}`,
        summary: `Summary ${i}`,
        learningObjectives: [`Objective ${i}`],
        conceptId: `c_${i}`,
        conceptLabel: `Concept ${i}`,
        position: i,
        included: true,
        locked: false,
        userAdded: false,
        userModified: false,
        materialSupport: 'grounded',
        whyHere: 'Foundation',
        sourceRefIds: ['ssr_1'],
      });
    }

    return {
      plan: {
        id: 'plan_cov_1',
        title: 'Coverage Plan',
        goal: 'Evaluate coverage',
        depth: 'survey',
        status: 'active',
        currentVersionId: 'spv_1',
        currentVersion: 1,
        draftVersionId: null,
        revision: 1,
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      },
      version: {
        id: 'spv_1',
        planId: 'plan_cov_1',
        version: 1,
        state: 'published',
        baseVersionId: null,
        sourceScope: dummyScope,
        knowledgeAuthority: { kind: 'library', policy: 'source-only' },
        nodes,
        prerequisites: [],
        changeSummary: null,
        createdBy: 'user',
        createdAt: '2026-11-10T00:00:00Z',
        publishedAt: '2026-11-10T00:00:00Z',
      },
      activityByNodeId: {
        node_0: 'completed',
        node_1: 'in-progress',
      },
      sourceRefs: {},
    };
  }

  it('evaluates coverage and maintains separate activity and content projections', async () => {
    const planDetail = createMockPlanDetail(2);

    const mockCoverageRunner = vi.fn().mockImplementation(async (input) => {
      const concepts: CoverageConceptInput[] = input.concepts;
      return {
        concepts: concepts.map((c, idx) => ({
          conceptKey: c.conceptId || c.name,
          conceptName: c.name,
          evidenceCoverage: idx === 0 ? 'supported' : 'partial',
          activity: 'none',
          indexCompleteness: 'complete',
          evidenceRefs: [],
          limitations: [],
        })),
        indexCompleteness: 'complete',
        limitations: [],
        blocked: false,
      } as unknown as CoverageAnalysisResult;
    });

    const result = await computePlanCoverageProjection({
      planDetail,
      sourceScope: dummyScope,
      coverageRunner: mockCoverageRunner,
    });

    expect(result.indexCompleteness).toBe('complete');
    expect(result.nodes.length).toBe(2);

    // Node 0: content coverage is supported, while user activity is completed
    expect(result.nodes[0].contentCoverage).toBe('supported');
    expect(result.nodes[0].activity).toBe('completed');

    // Node 1: content coverage is partial, while user activity is in-progress
    expect(result.nodes[1].contentCoverage).toBe('partial');
    expect(result.nodes[1].activity).toBe('in-progress');

    // Coverage is mapped by concept ID
    expect(result.coverageByConceptId['c_0']).toBeDefined();
    expect(result.coverageByConceptId['c_0'].evidenceCoverage).toBe('supported');
  });

  it('processes plans with >12 concepts in sequential batches of at most 12', async () => {
    // 16 concepts in plan
    const planDetail = createMockPlanDetail(16);

    const batchesReceived: number[] = [];
    const mockCoverageRunner = vi.fn().mockImplementation(async (input) => {
      batchesReceived.push(input.concepts.length);
      return {
        concepts: input.concepts.map((c: any) => ({
          conceptKey: c.conceptKey || c.name,
          conceptName: c.name,
          evidenceCoverage: 'supported',
          activity: 'unseen',
          indexCompleteness: 'complete',
          evidenceRefs: [],
          limitations: [],
        })),
        indexCompleteness: 'complete',
        limitations: [],
        blocked: false,
      } as CoverageAnalysisResult;
    });

    const result = await computePlanCoverageProjection({
      planDetail,
      sourceScope: dummyScope,
      coverageRunner: mockCoverageRunner,
      batchSize: 12,
    });

    // 16 concepts broken into 12 and 4
    expect(batchesReceived).toEqual([12, 4]);
    expect(result.nodes.length).toBe(16);
    expect(result.nodes.every((n) => n.contentCoverage === 'supported')).toBe(true);
  });

  it('honestly propagates partial and unavailable index completeness and limitations', async () => {
    const planDetail = createMockPlanDetail(3);

    const mockCoverageRunner = vi.fn().mockResolvedValue({
      concepts: [
        {
          conceptKey: 'c_0',
          conceptName: 'Concept 0',
          evidenceCoverage: 'partial',
          activity: 'none',
          indexCompleteness: 'partial',
          evidenceRefs: [],
          limitations: ['coverage.limitation.index-partial'],
        },
      ],
      indexCompleteness: 'partial',
      limitations: ['coverage.limitation.index-partial'],
      blocked: false,
    } as unknown as CoverageAnalysisResult);

    const result = await computePlanCoverageProjection({
      planDetail,
      sourceScope: {
        ...dummyScope,
        indexCompleteness: 'partial',
        limitations: ['coverage.limitation.index-partial'],
      },
      coverageRunner: mockCoverageRunner,
    });

    expect(result.indexCompleteness).toBe('partial');
    expect(result.limitations).toContain('coverage.limitation.index-partial');
    expect(result.blocked).toBe(false);
  });

  it('reports blocked state when remote embedding is denied', async () => {
    const planDetail = createMockPlanDetail(2);

    const mockCoverageRunner = vi.fn().mockResolvedValue({
      concepts: [],
      indexCompleteness: 'unavailable',
      limitations: ['coverage.limitation.remote-denied'],
      blocked: true,
    } as CoverageAnalysisResult);

    const result = await computePlanCoverageProjection({
      planDetail,
      sourceScope: dummyScope,
      coverageRunner: mockCoverageRunner,
    });

    expect(result.blocked).toBe(true);
    expect(result.indexCompleteness).toBe('unavailable');
    expect(result.limitations).toContain('coverage.limitation.remote-denied');
  });

  it('returns honest empty projection when plan has no concepts', async () => {
    const planDetail = createMockPlanDetail(0);

    const mockCoverageRunner = vi.fn();
    const result = await computePlanCoverageProjection({
      planDetail,
      sourceScope: dummyScope,
      coverageRunner: mockCoverageRunner,
    });

    expect(mockCoverageRunner).not.toHaveBeenCalled();
    expect(result.nodes).toEqual([]);
    expect(result.coverageByConceptId).toEqual({});
  });
});
