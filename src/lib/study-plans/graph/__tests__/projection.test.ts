import { describe, expect, it } from 'vitest';
import { projectStudyPlanGraph } from '../projection';
import { createFutureOfMathFixture, makeNode } from './fixtures';

describe('projectStudyPlanGraph', () => {
  it('projects every included topic once and preserves real prerequisites without fabricating edges', () => {
    const fixture = createFutureOfMathFixture();
    const proj = projectStudyPlanGraph(fixture);

    expect(proj.nodes).toHaveLength(13);
    expect(proj.edges).toHaveLength(fixture.prerequisites.length);
    expect(proj.hasPrerequisites).toBe(true);

    // t6 has no incoming or outgoing edges in the fixture and must remain visible and unconnected
    const t6 = proj.nodes.find((n) => n.nodeId === 't6')!;
    expect(t6).toBeDefined();
    expect(t6.directPrerequisiteIds).toEqual([]);
    expect(t6.directDependentIds).toEqual([]);
    expect(t6.prerequisiteReadiness).toBe('entry');

    // t12 is author-locked; locking must NOT be conflated with prerequisite readiness or activity
    const t12 = proj.nodes.find((n) => n.nodeId === 't12')!;
    expect(t12.locked).toBe(true);
    expect(t12.activity).toBe('not-started');
    expect(t12.prerequisiteReadiness).toBe('incomplete-prerequisites');
    expect(t12.incompletePrerequisiteCount).toBe(1);

    // t7 has a stale source
    const t7 = proj.nodes.find((n) => n.nodeId === 't7')!;
    expect(t7.sourceSummary.primaryStatus).toBe('stale');
    expect(t7.sourceSummary.staleCount).toBe(1);
    expect(proj.staleOrMissingSourceNodeCount).toBe(1);
  });

  it('produces zero edges when a plan has no prerequisites (no fabricated sequence arrows)', () => {
    const nodes = [
      makeNode('a', 'Topic A', 0),
      makeNode('b', 'Topic B', 1),
      makeNode('c', 'Topic C', 2),
    ];
    const proj = projectStudyPlanGraph({ nodes, prerequisites: [] });

    expect(proj.nodes).toHaveLength(3);
    expect(proj.edges).toHaveLength(0);
    expect(proj.hasPrerequisites).toBe(false);
    expect(proj.nodes.every((n) => n.prerequisiteReadiness === 'entry')).toBe(true);
  });

  it('respects includeExcluded toggle and reports malformed edges in diagnostics without crashing', () => {
    const nodes = [
      makeNode('a', 'Alpha', 0),
      makeNode('b', 'Beta', 1),
      makeNode('x', 'Removed Topic', -1, { included: false }),
    ];
    const prerequisites = [
      { prerequisiteNodeId: 'a', dependentNodeId: 'a', support: 'user' as const, rationale: null, sourceRefIds: [] },
      { prerequisiteNodeId: 'a', dependentNodeId: 'missing', support: 'inferred' as const, rationale: null, sourceRefIds: [] },
      { prerequisiteNodeId: 'a', dependentNodeId: 'x', support: 'user' as const, rationale: null, sourceRefIds: [] },
      { prerequisiteNodeId: 'a', dependentNodeId: 'b', support: 'user' as const, rationale: null, sourceRefIds: [] },
      { prerequisiteNodeId: 'a', dependentNodeId: 'b', support: 'user' as const, rationale: null, sourceRefIds: [] },
    ];

    const defaultProj = projectStudyPlanGraph({ nodes, prerequisites });
    expect(defaultProj.nodes.map((n) => n.nodeId)).toEqual(['a', 'b']);
    expect(defaultProj.edges).toHaveLength(1);
    expect(defaultProj.invalidEdges).toHaveLength(4);
    expect(defaultProj.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['self_edge', 'dangling_prerequisite', 'excluded_endpoint', 'duplicate_edge'])
    );

    const withExcluded = projectStudyPlanGraph({ nodes, prerequisites, includeExcluded: true });
    expect(withExcluded.nodes.map((n) => n.nodeId)).toEqual(['a', 'b', 'x']);
  });

  it('handles empty study plans safely', () => {
    const proj = projectStudyPlanGraph({ nodes: [], prerequisites: [] });
    expect(proj.nodes).toEqual([]);
    expect(proj.edges).toEqual([]);
    expect(proj.sourceNodes).toEqual([]);
    expect(proj.recommendedNextNodeId).toBeNull();
  });

  it('keeps structuralKey stable across activity changes so non-structural updates do not trigger relayout', () => {
    const fixture = createFutureOfMathFixture();
    const p1 = projectStudyPlanGraph(fixture);
    const p2 = projectStudyPlanGraph({
      ...fixture,
      activityByNodeId: { ...fixture.activityByNodeId, t3: 'completed', t7: 'in-progress' },
    });

    expect(p1.structuralKey).toBe(p2.structuralKey);
  });

  it('groups source documents cleanly for the Source Coverage layer', () => {
    const fixture = createFutureOfMathFixture();
    const proj = projectStudyPlanGraph(fixture);

    expect(proj.sourceNodes.length).toBe(5);
    const ytSource = proj.sourceNodes.find((s) => s.documentId === 'doc_yt')!;
    expect(ytSource).toBeDefined();
    expect(ytSource.linkedNodeIds).toContain('t1');
    expect(ytSource.linkedNodeIds).toContain('t2');
    expect(ytSource.status).toBe('current');

    const staleSource = proj.sourceNodes.find((s) => s.documentId === 'doc_stale')!;
    expect(staleSource.status).toBe('stale');
    expect(staleSource.linkedNodeIds).toEqual(['t7']);
  });
});
