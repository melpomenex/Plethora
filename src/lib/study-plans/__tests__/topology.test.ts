import { describe, it, expect } from 'vitest';
import {
  orderStudyPlan,
  calculateManualMoveBounds,
  reorderStudyPlanNode,
} from '../topology';
import type {
  StudyPlanVersionNode,
  PlanPrerequisite,
} from '../../../types/learningPaths';

function createNode(
  id: string,
  title: string,
  position = 0,
  included = true
): StudyPlanVersionNode {
  return {
    nodeId: id,
    title,
    summary: 'Summary text',
    learningObjectives: ['Understand ' + title],
    conceptId: null,
    conceptLabel: title,
    position,
    included,
    locked: false,
    userAdded: false,
    userModified: false,
    materialSupport: 'grounded',
    whyHere: null,
    sourceRefIds: ['s1'],
  };
}

describe('Deterministic Topology Ordering (orderStudyPlan)', () => {
  it('orders nodes such that all prerequisites precede dependent nodes', () => {
    const nodes: StudyPlanVersionNode[] = [
      createNode('c', 'Virtual Memory & TLBs', 0),
      createNode('a', 'Operating System Architecture', 1),
      createNode('b', 'Processes & Address Spaces', 2),
    ];

    const prerequisites: PlanPrerequisite[] = [
      {
        prerequisiteNodeId: 'a',
        dependentNodeId: 'b',
        support: 'user',
        rationale: null,
        sourceRefIds: [],
      },
      {
        prerequisiteNodeId: 'b',
        dependentNodeId: 'c',
        support: 'user',
        rationale: null,
        sourceRefIds: [],
      },
    ];

    const result = orderStudyPlan(nodes, prerequisites);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.orderedNodeIds).toEqual(['a', 'b', 'c']);
    expect(result.value.orderedNodes.map((n) => n.position)).toEqual([0, 1, 2]);
  });

  it('guarantees input immutability', () => {
    const nodes = Object.freeze([
      Object.freeze(createNode('b', 'Topic B', 0)),
      Object.freeze(createNode('a', 'Topic A', 1)),
    ]) as readonly StudyPlanVersionNode[];

    const prerequisites = Object.freeze([
      Object.freeze({
        prerequisiteNodeId: 'b',
        dependentNodeId: 'a',
        support: 'user' as const,
        rationale: null,
        sourceRefIds: [],
      }),
    ]) as readonly PlanPrerequisite[];

    const result = orderStudyPlan(nodes, prerequisites);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.orderedNodeIds).toEqual(['b', 'a']);
    // original positions must be untouched in frozen inputs
    expect(nodes[0].position).toBe(0);
    expect(nodes[1].position).toBe(1);
  });

  it('uses (previousPosition, normalizedTitle, nodeId) as deterministic tie-breakers', () => {
    // 3 independent nodes without prerequisites and distinct titles
    const nodes: StudyPlanVersionNode[] = [
      createNode('n3', 'Gamma Topic', 1),
      createNode('n1', 'Alpha Topic', 2),
      createNode('n2', 'Beta Topic', 0),
    ];

    // Priority 1: previousPosition (n2 has 0, n3 has 1, n1 has 2)
    const res1 = orderStudyPlan(nodes, []);
    expect(res1.ok).toBe(true);
    if (res1.ok) {
      expect(res1.value.orderedNodeIds).toEqual(['n2', 'n3', 'n1']);
    }

    // When previousPositions are equal, priority 2 is normalizedTitle:
    const nodesEqualPos: StudyPlanVersionNode[] = [
      createNode('n3', 'Zeta Topic', 0),
      createNode('n1', 'Alpha Topic', 0),
      createNode('n2', 'Beta Topic', 0),
    ];
    const res2 = orderStudyPlan(nodesEqualPos, []);
    expect(res2.ok).toBe(true);
    if (res2.ok) {
      expect(res2.value.orderedNodeIds).toEqual(['n1', 'n2', 'n3']);
    }

    // Negative case: repeated titles among included nodes must be rejected
    const nodesEqualTitle: StudyPlanVersionNode[] = [
      createNode('id-c', 'Same Title', 0),
      createNode('id-a', 'Same Title', 1),
    ];
    const resRepeat = orderStudyPlan(nodesEqualTitle, []);
    expect(resRepeat.ok).toBe(false);
    if (!resRepeat.ok) {
      expect(resRepeat.error.code).toBe('invalid_input');
      expect(resRepeat.error.fieldIssues?.some((i) => i.code === 'repeated_title')).toBe(true);
    }
  });

  it('rejects dependency cycles and extracts concrete cycle deterministically', () => {
    const nodes: StudyPlanVersionNode[] = [
      createNode('a', 'Topic A', 0),
      createNode('b', 'Topic B', 1),
      createNode('c', 'Topic C', 2),
    ];

    // Cycle: a -> b -> c -> a
    const prerequisites: PlanPrerequisite[] = [
      {
        prerequisiteNodeId: 'a',
        dependentNodeId: 'b',
        support: 'user',
        rationale: null,
        sourceRefIds: [],
      },
      {
        prerequisiteNodeId: 'b',
        dependentNodeId: 'c',
        support: 'user',
        rationale: null,
        sourceRefIds: [],
      },
      {
        prerequisiteNodeId: 'c',
        dependentNodeId: 'a',
        support: 'user',
        rationale: null,
        sourceRefIds: [],
      },
    ];

    const result = orderStudyPlan(nodes, prerequisites);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('dependency_cycle');
      expect(result.error.details?.remainingNodeIds).toEqual(['a', 'b', 'c']);
      expect(result.error.details?.cycle).toBeDefined();
      expect(result.error.details?.cycle?.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('rejects dangling prerequisites referencing unknown node IDs', () => {
    const nodes: StudyPlanVersionNode[] = [createNode('a', 'Topic A', 0)];
    const prerequisites: PlanPrerequisite[] = [
      {
        prerequisiteNodeId: 'a',
        dependentNodeId: 'unknown-node',
        support: 'user',
        rationale: null,
        sourceRefIds: [],
      },
    ];

    const result = orderStudyPlan(nodes, prerequisites);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('dangling_prerequisite');
    }
  });

  it('rejects prerequisites touching excluded (included=false) nodes', () => {
    const nodes: StudyPlanVersionNode[] = [
      createNode('a', 'Topic A', 0, true),
      createNode('b', 'Topic B', -1, false), // excluded tombstone
    ];
    const prerequisites: PlanPrerequisite[] = [
      {
        prerequisiteNodeId: 'a',
        dependentNodeId: 'b',
        support: 'user',
        rationale: null,
        sourceRefIds: [],
      },
    ];

    const result = orderStudyPlan(nodes, prerequisites);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('dangling_prerequisite');
    }
  });

  it('rejects self-edges and duplicate edges', () => {
    const nodes: StudyPlanVersionNode[] = [createNode('a', 'Topic A', 0)];
    const selfEdge: PlanPrerequisite[] = [
      {
        prerequisiteNodeId: 'a',
        dependentNodeId: 'a',
        support: 'user',
        rationale: null,
        sourceRefIds: [],
      },
    ];

    const resSelf = orderStudyPlan(nodes, selfEdge);
    expect(resSelf.ok).toBe(false);
    if (!resSelf.ok) {
      expect(resSelf.error.code).toBe('invalid_input');
    }

    const nodes2: StudyPlanVersionNode[] = [
      createNode('a', 'Topic A', 0),
      createNode('b', 'Topic B', 1),
    ];
    const duplicateEdges: PlanPrerequisite[] = [
      {
        prerequisiteNodeId: 'a',
        dependentNodeId: 'b',
        support: 'user',
        rationale: null,
        sourceRefIds: [],
      },
      {
        prerequisiteNodeId: 'a',
        dependentNodeId: 'b',
        support: 'user',
        rationale: null,
        sourceRefIds: [],
      },
    ];

    const resDup = orderStudyPlan(nodes2, duplicateEdges);
    expect(resDup.ok).toBe(false);
    if (!resDup.ok) {
      expect(resDup.error.code).toBe('invalid_input');
    }
  });

  it('rejects duplicate node IDs', () => {
    const nodes: StudyPlanVersionNode[] = [
      createNode('dup-id', 'Topic 1', 0),
      createNode('dup-id', 'Topic 2', 1),
    ];

    const result = orderStudyPlan(nodes, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('duplicate_node');
    }
  });

  it('rejects plans with more than 100 nodes', () => {
    const nodes: StudyPlanVersionNode[] = [];
    for (let i = 0; i < 101; i++) {
      nodes.push(createNode(`n-${i}`, `Topic ${i}`, i));
    }

    const result = orderStudyPlan(nodes, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_input');
    }
  });
});

describe('Manual Move Bounds & Reordering', () => {
  it('calculates earliest and latest valid positions for transitive DAG dependencies', () => {
    // Chain: A -> B -> C -> D
    // Indices: 0, 1, 2, 3
    const nodes: StudyPlanVersionNode[] = [
      createNode('a', 'Topic A', 0),
      createNode('b', 'Topic B', 1),
      createNode('c', 'Topic C', 2),
      createNode('d', 'Topic D', 3),
    ];

    const prerequisites: PlanPrerequisite[] = [
      { prerequisiteNodeId: 'a', dependentNodeId: 'b', support: 'user', rationale: null, sourceRefIds: [] },
      { prerequisiteNodeId: 'b', dependentNodeId: 'c', support: 'user', rationale: null, sourceRefIds: [] },
      { prerequisiteNodeId: 'c', dependentNodeId: 'd', support: 'user', rationale: null, sourceRefIds: [] },
    ];

    // For node 'b':
    // Prereqs: a (at index 0 in other nodes [a, c, d]) -> minPosition = 1
    // Deps: c, d (c at index 1, d at index 2) -> maxPosition = 1
    // So 'b' must remain at position 1.
    const boundsB = calculateManualMoveBounds(nodes, prerequisites, 'b');
    expect(boundsB.ok).toBe(true);
    if (boundsB.ok) {
      expect(boundsB.value.minPosition).toBe(1);
      expect(boundsB.value.maxPosition).toBe(1);
    }

    // Now let's test a branch where node X is independent of B:
    // A -> B -> D
    // A -> X -> D
    const nodesWithBranch: StudyPlanVersionNode[] = [
      createNode('a', 'Topic A', 0),
      createNode('b', 'Topic B', 1),
      createNode('x', 'Topic X', 2),
      createNode('d', 'Topic D', 3),
    ];
    const branchPrereqs: PlanPrerequisite[] = [
      { prerequisiteNodeId: 'a', dependentNodeId: 'b', support: 'user', rationale: null, sourceRefIds: [] },
      { prerequisiteNodeId: 'b', dependentNodeId: 'd', support: 'user', rationale: null, sourceRefIds: [] },
      { prerequisiteNodeId: 'a', dependentNodeId: 'x', support: 'user', rationale: null, sourceRefIds: [] },
      { prerequisiteNodeId: 'x', dependentNodeId: 'd', support: 'user', rationale: null, sourceRefIds: [] },
    ];

    // For 'x': other included are [a, b, d].
    // a is prereq (index 0) -> minPosition = 1
    // d is dep (index 2) -> maxPosition = 2
    // So 'x' can be at index 1 or index 2 (either before or after 'b')!
    const boundsX = calculateManualMoveBounds(nodesWithBranch, branchPrereqs, 'x');
    expect(boundsX.ok).toBe(true);
    if (boundsX.ok) {
      expect(boundsX.value.minPosition).toBe(1);
      expect(boundsX.value.maxPosition).toBe(2);
    }
  });

  it('reorders a node safely within valid bounds and marks userModified = true', () => {
    const nodes: StudyPlanVersionNode[] = [
      createNode('a', 'Topic A', 0),
      createNode('b', 'Topic B', 1),
      createNode('x', 'Topic X', 2),
      createNode('d', 'Topic D', 3),
    ];
    const branchPrereqs: PlanPrerequisite[] = [
      { prerequisiteNodeId: 'a', dependentNodeId: 'b', support: 'user', rationale: null, sourceRefIds: [] },
      { prerequisiteNodeId: 'b', dependentNodeId: 'd', support: 'user', rationale: null, sourceRefIds: [] },
      { prerequisiteNodeId: 'a', dependentNodeId: 'x', support: 'user', rationale: null, sourceRefIds: [] },
      { prerequisiteNodeId: 'x', dependentNodeId: 'd', support: 'user', rationale: null, sourceRefIds: [] },
    ];

    // Move 'x' to position 1 (swapping with 'b')
    const reorderResult = reorderStudyPlanNode(nodes, branchPrereqs, 'x', 1);
    expect(reorderResult.ok).toBe(true);
    if (reorderResult.ok) {
      const moved = reorderResult.value.find((n) => n.nodeId === 'x')!;
      expect(moved.position).toBe(1);
      expect(moved.userModified).toBe(true);

      const bNode = reorderResult.value.find((n) => n.nodeId === 'b')!;
      expect(bNode.position).toBe(2);

      // Verify all positions contiguous
      const positions = reorderResult.value.map((n) => n.position);
      expect(positions).toEqual([0, 1, 2, 3]);
    }
  });

  it('rejects moving a node before its prerequisite or after its dependent', () => {
    const nodes: StudyPlanVersionNode[] = [
      createNode('a', 'Topic A', 0),
      createNode('b', 'Topic B', 1),
      createNode('c', 'Topic C', 2),
    ];
    const prerequisites: PlanPrerequisite[] = [
      { prerequisiteNodeId: 'a', dependentNodeId: 'b', support: 'user', rationale: null, sourceRefIds: [] },
      { prerequisiteNodeId: 'b', dependentNodeId: 'c', support: 'user', rationale: null, sourceRefIds: [] },
    ];

    // Try moving 'c' before 'a' (target position 0)
    const resBefore = reorderStudyPlanNode(nodes, prerequisites, 'c', 0);
    expect(resBefore.ok).toBe(false);
    if (!resBefore.ok) {
      expect(resBefore.error.code).toBe('order_conflict');
      expect(resBefore.error.details?.minPosition).toBe(2);
      expect(resBefore.error.details?.maxPosition).toBe(2);
    }

    // Try moving 'a' after 'c' (target position 2)
    const resAfter = reorderStudyPlanNode(nodes, prerequisites, 'a', 2);
    expect(resAfter.ok).toBe(false);
    if (!resAfter.ok) {
      expect(resAfter.error.code).toBe('order_conflict');
      expect(resAfter.error.details?.minPosition).toBe(0);
      expect(resAfter.error.details?.maxPosition).toBe(0);
    }
  });
});
