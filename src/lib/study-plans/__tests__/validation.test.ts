import { describe, it, expect } from 'vitest';
import {
  validateStudyPlan,
  validateStudyPlanNode,
  validateStudyPlanVersion,
  validateStudyPlanKnowledgeAuthority,
  STUDY_PLAN_LIMITS,
} from '../validation';
import type {
  StudyPlan,
  StudyPlanVersion,
  StudyPlanVersionNode,
} from '../../../types/learningPaths';

function createValidNode(id: string, title: string, pos = 0): StudyPlanVersionNode {
  return {
    nodeId: id,
    title,
    summary: 'A clean summary without HTML',
    learningObjectives: ['Objective 1', 'Objective 2'],
    conceptId: null,
    conceptLabel: title,
    position: pos,
    included: true,
    locked: false,
    userAdded: false,
    userModified: false,
    materialSupport: 'grounded',
    whyHere: null,
    sourceRefIds: ['s1'],
  };
}

describe('Study Plan Validation (validation.ts)', () => {
  it('requires a frozen library scope, forbids one in model-only, and allows source-free manual authority', () => {
    const emptyScope = {
      schemaVersion: 1 as const,
      selected: { documentIds: [], extractIds: [], collectionIds: [], tagIds: [] },
      resolvedDocuments: [],
      frozenAt: '2026-11-12T00:00:00Z',
      indexCompleteness: 'unavailable' as const,
      limitations: [],
    };

    expect(validateStudyPlanKnowledgeAuthority(
      { kind: 'library', policy: 'source-only' }, null
    )).toHaveLength(1);
    expect(validateStudyPlanKnowledgeAuthority(
      { kind: 'model-only' }, emptyScope
    )[0]?.code).toBe('model_only_scope_forbidden');
    expect(validateStudyPlanKnowledgeAuthority(
      { kind: 'model-only' }, null
    )).toHaveLength(0);
    expect(validateStudyPlanKnowledgeAuthority(
      { kind: 'manual' }, null
    )).toHaveLength(0);
  });

  it('rejects unsupported topics or edges in published source-only plans but allows them under source-plus-model-knowledge', () => {
    const scope = {
      schemaVersion: 1 as const,
      selected: { documentIds: ['d1'], extractIds: [], collectionIds: [], tagIds: [] },
      resolvedDocuments: [{ documentId: 'd1', title: 'D', sourceType: 'pdf', revision: 'r1', revisionKind: 'content-hash' as const, extractIds: [], isAiExcluded: false, isLocalOnly: false }],
      frozenAt: '2026-11-12T00:00:00Z',
      indexCompleteness: 'complete' as const,
      limitations: [],
    };
    const unsupportedNode = { ...createValidNode('n1', 'Supplement'), materialSupport: 'unsupported' as const, sourceRefIds: [] };
    const baseVersion: StudyPlanVersion = {
      id: 'spv_1',
      planId: 'sp_1',
      version: 1,
      state: 'published',
      baseVersionId: null,
      sourceScope: scope,
      knowledgeAuthority: { kind: 'library', policy: 'source-only' },
      nodes: [unsupportedNode],
      prerequisites: [],
      changeSummary: null,
      createdBy: 'ai',
      createdAt: '2026-11-12T00:00:00Z',
      publishedAt: '2026-11-12T00:00:00Z',
    };
    const sourceOnly = validateStudyPlanVersion(baseVersion);
    expect(sourceOnly.ok).toBe(false);
    expect(sourceOnly.error!.fieldIssues!.some((f) => f.code === 'source_only_unsupported_node')).toBe(true);

    const mixed: StudyPlanVersion = { ...baseVersion, knowledgeAuthority: { kind: 'library', policy: 'source-plus-model-knowledge' } };
    expect(validateStudyPlanVersion(mixed).ok).toBe(true);

    const withUnsupportedEdge: StudyPlanVersion = {
      ...baseVersion,
      prerequisites: [{ prerequisiteNodeId: 'n1', dependentNodeId: 'n2', support: 'unsupported', rationale: null, sourceRefIds: [] }],
      nodes: [unsupportedNode, { ...createValidNode('n2', 'Dependent', 1) }],
    };
    expect(validateStudyPlanVersion(withUnsupportedEdge).ok).toBe(false);
  });

  describe('validateStudyPlan', () => {
    it('accepts valid plan attributes', () => {
      const plan: Partial<StudyPlan> = {
        title: 'Distributed Systems & Consensus',
        goal: 'Master Raft, Paxos and Byzantine fault tolerance',
        depth: 'foundational',
        status: 'active',
      };
      const result = validateStudyPlan(plan);
      expect(result.ok).toBe(true);
    });

    it('rejects empty or oversized title', () => {
      expect(validateStudyPlan({ title: '', goal: 'Some goal' }).ok).toBe(false);
      expect(validateStudyPlan({ title: '   ', goal: 'Some goal' }).ok).toBe(false);
      expect(
        validateStudyPlan({
          title: 'A'.repeat(STUDY_PLAN_LIMITS.PLAN_TITLE_MAX + 1),
          goal: 'Some goal',
        }).ok
      ).toBe(false);
    });

    it('rejects empty or oversized goal', () => {
      expect(validateStudyPlan({ title: 'Valid Title', goal: '' }).ok).toBe(false);
      expect(validateStudyPlan({ title: 'Valid Title', goal: '   ' }).ok).toBe(false);
      expect(
        validateStudyPlan({
          title: 'Valid Title',
          goal: 'A'.repeat(STUDY_PLAN_LIMITS.PLAN_GOAL_MAX + 1),
        }).ok
      ).toBe(false);
    });

    it('rejects invalid depth or status', () => {
      expect(
        validateStudyPlan({
          title: 'Valid Title',
          goal: 'Valid goal',
          depth: 'invalid' as any,
        }).ok
      ).toBe(false);

      expect(
        validateStudyPlan({
          title: 'Valid Title',
          goal: 'Valid goal',
          status: 'invalid' as any,
        }).ok
      ).toBe(false);
    });
  });

  describe('validateStudyPlanNode', () => {
    it('accepts valid node', () => {
      const node = createValidNode('n1', 'Valid Node');
      const issues = validateStudyPlanNode(node);
      expect(issues).toHaveLength(0);
    });

    it('rejects raw HTML in summary', () => {
      const node = createValidNode('n1', 'Node With HTML');
      node.summary = 'Summary with <script>alert(1)</script> dangerous payload';
      const issues = validateStudyPlanNode(node);
      expect(issues.some((i) => i.code === 'no_raw_html')).toBe(true);
    });

    it('enforces objective limits: 1 to 6 objectives, each 1 to 240 chars', () => {
      const node = createValidNode('n1', 'Node');
      node.learningObjectives = [];
      expect(validateStudyPlanNode(node).some((i) => i.code === 'invalid_objectives_count')).toBe(true);

      node.learningObjectives = [
        'O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7',
      ];
      expect(validateStudyPlanNode(node).some((i) => i.code === 'invalid_objectives_count')).toBe(true);

      node.learningObjectives = [''];
      expect(validateStudyPlanNode(node).some((i) => i.code === 'invalid_objective_length')).toBe(true);

      node.learningObjectives = ['A'.repeat(241)];
      expect(validateStudyPlanNode(node).some((i) => i.code === 'invalid_objective_length')).toBe(true);
    });

    it('enforces max 8 sourceRefIds', () => {
      const node = createValidNode('n1', 'Node');
      node.sourceRefIds = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
      const issues = validateStudyPlanNode(node);
      expect(issues.some((i) => i.code === 'max_sources_exceeded')).toBe(true);
    });

    it('enforces position = -1 for excluded tombstone node', () => {
      const node = createValidNode('n1', 'Node');
      node.included = false;
      node.position = 2; // invalid for excluded
      const issues = validateStudyPlanNode(node);
      expect(issues.some((i) => i.code === 'excluded_node_position')).toBe(true);

      node.position = -1;
      expect(validateStudyPlanNode(node)).toHaveLength(0);
    });
  });

  describe('validateStudyPlanVersion', () => {
    it('accepts valid version graph', () => {
      const version: StudyPlanVersion = {
        id: 'spv_1',
        planId: 'sp_1',
        version: 1,
        state: 'published',
        baseVersionId: null,
        sourceScope: {
          schemaVersion: 1,
          selected: { documentIds: ['doc1'], extractIds: [], collectionIds: [], tagIds: [] },
          resolvedDocuments: [{
            documentId: 'doc1',
            title: 'Doc 1',
            sourceType: 'pdf',
            revision: 'rev1',
            revisionKind: 'content-hash',
            extractIds: [],
            isAiExcluded: false,
            isLocalOnly: true,
          }],
          frozenAt: new Date().toISOString(),
          indexCompleteness: 'complete',
          limitations: [],
        },
        knowledgeAuthority: { kind: 'library', policy: 'source-only' },
        nodes: [
          createValidNode('n1', 'Topic 1', 0),
          createValidNode('n2', 'Topic 2', 1),
        ],
        prerequisites: [{
          prerequisiteNodeId: 'n1',
          dependentNodeId: 'n2',
          support: 'user',
          rationale: null,
          sourceRefIds: [],
        }],
        changeSummary: null,
        createdBy: 'user',
        createdAt: new Date().toISOString(),
        publishedAt: new Date().toISOString(),
      };

      const result = validateStudyPlanVersion(version);
      expect(result.ok).toBe(true);
    });

    it('rejects published grounded node without sourceRefIds', () => {
      const version: StudyPlanVersion = {
        id: 'spv_1',
        planId: 'sp_1',
        version: 1,
        state: 'published',
        baseVersionId: null,
        sourceScope: null,
        knowledgeAuthority: { kind: 'manual' },
        nodes: [
          {
            ...createValidNode('n1', 'Topic 1', 0),
            sourceRefIds: [], // Empty source refs on grounded published node!
          },
        ],
        prerequisites: [],
        changeSummary: null,
        createdBy: 'user',
        createdAt: new Date().toISOString(),
        publishedAt: new Date().toISOString(),
      };

      const result = validateStudyPlanVersion(version);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(
          result.error.fieldIssues?.some(
            (i) => i.code === 'missing_source_for_grounded_node'
          )
        ).toBe(true);
      }
    });

    it('rejects non-contiguous positions', () => {
      const version: StudyPlanVersion = {
        id: 'spv_1',
        planId: 'sp_1',
        version: 1,
        state: 'draft',
        baseVersionId: null,
        sourceScope: null,
        knowledgeAuthority: { kind: 'manual' },
        nodes: [
          createValidNode('n1', 'Topic 1', 0),
          createValidNode('n2', 'Topic 2', 2), // gap! position 1 is missing
        ],
        prerequisites: [],
        changeSummary: null,
        createdBy: 'user',
        createdAt: new Date().toISOString(),
        publishedAt: null,
      };

      const result = validateStudyPlanVersion(version);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(
          result.error.fieldIssues?.some(
            (i) => i.code === 'non_contiguous_positions'
          )
        ).toBe(true);
      }
    });
  });
});
