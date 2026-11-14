import { describe, expect, it } from 'vitest';
import {
  computeTransitiveSubgraph,
  removePrerequisiteEdge,
  searchStudyPlanGraphNodes,
  validateAndAddPrerequisiteEdge,
} from '../traversal';
import { projectStudyPlanGraph } from '../projection';
import { createFutureOfMathFixture, makeNode } from './fixtures';

describe('graph traversal and draft prerequisite editing', () => {
  it('computes transitive prerequisite and dependent subgraphs accurately', () => {
    const fixture = createFutureOfMathFixture();
    const proj = projectStudyPlanGraph(fixture);

    const prereqsOfT11 = computeTransitiveSubgraph('t11', proj.edges, 'prerequisites');
    expect(prereqsOfT11.directNodeIds).toEqual(new Set(['t10', 't7', 't8']));
    expect(prereqsOfT11.transitiveNodeIds).toEqual(
      new Set(['t11', 't10', 't9', 't7', 't8', 't2', 't3', 't4', 't5', 't1'])
    );
    expect(prereqsOfT11.transitiveNodeIds.has('t6')).toBe(false);
    expect(prereqsOfT11.transitiveNodeIds.has('t12')).toBe(false);

    const depsOfT1 = computeTransitiveSubgraph('t1', proj.edges, 'dependents');
    expect(depsOfT1.directNodeIds).toEqual(new Set(['t2', 't3', 't4']));
    expect(depsOfT1.transitiveNodeIds).toEqual(
      new Set(['t1', 't2', 't3', 't4', 't7', 't8', 't9', 't10', 't11', 't12', 't13'])
    );
  });

  it('searches topics by title, curriculum number, concept label, and learning objective', () => {
    const fixture = createFutureOfMathFixture();
    const proj = projectStudyPlanGraph(fixture);

    expect(searchStudyPlanGraphNodes(proj.nodes, 'Chess').map((n) => n.nodeId)).toEqual(['t5']);
    expect(searchStudyPlanGraphNodes(proj.nodes, '#7').map((n) => n.nodeId)).toEqual(['t7']);
    expect(searchStudyPlanGraphNodes(proj.nodes, 'competing views').map((n) => n.nodeId)).toEqual(['t1']);
    expect(searchStudyPlanGraphNodes(proj.nodes, '   ')).toEqual([]);
  });

  it('validates valid edges, rejects self-links, duplicates, excluded nodes, and cycles', () => {
    const nodes = [
      makeNode('a', 'Foundations', 0),
      makeNode('b', 'Intermediate', 1),
      makeNode('c', 'Advanced', 2),
      makeNode('d', 'Removed', -1, { included: false }),
    ];
    const prereqs = [
      { prerequisiteNodeId: 'a', dependentNodeId: 'b', support: 'user' as const, rationale: null, sourceRefIds: [] },
    ];

    // Read-only rejection
    const ro = validateAndAddPrerequisiteEdge(nodes, prereqs, 'b', 'c', true);
    expect(ro).toMatchObject({ ok: false, code: 'read_only' });

    // Self-link rejection
    const selfRes = validateAndAddPrerequisiteEdge(nodes, prereqs, 'a', 'a', false);
    expect(selfRes).toMatchObject({ ok: false, code: 'self_edge' });

    // Duplicate rejection
    const dupRes = validateAndAddPrerequisiteEdge(nodes, prereqs, 'a', 'b', false);
    expect(dupRes).toMatchObject({ ok: false, code: 'duplicate_edge' });

    // Excluded node rejection
    const excRes = validateAndAddPrerequisiteEdge(nodes, prereqs, 'a', 'd', false);
    expect(excRes).toMatchObject({ ok: false, code: 'excluded_endpoint' });

    // Cycle rejection (b -> a when a -> b exists)
    const cycleRes = validateAndAddPrerequisiteEdge(nodes, prereqs, 'b', 'a', false);
    expect(cycleRes).toMatchObject({ ok: false, code: 'dependency_cycle' });

    // Valid edge creation (b -> c)
    const okRes = validateAndAddPrerequisiteEdge(nodes, prereqs, 'b', 'c', false);
    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.prerequisites).toHaveLength(2);
      expect(okRes.prerequisites[1]).toMatchObject({
        prerequisiteNodeId: 'b',
        dependentNodeId: 'c',
        support: 'user',
      });
    }

    // Valid removal
    const remRes = removePrerequisiteEdge(nodes, prereqs, 'a', 'b', false);
    expect(remRes.ok).toBe(true);
    if (remRes.ok) {
      expect(remRes.prerequisites).toHaveLength(0);
    }
  });
});
