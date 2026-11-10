/**
 * Deterministic Graph Core and Topological Ordering for Study Plans.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §3.1
 * - openspec/changes/establish-persistent-study-plans/
 */

import type {
  StudyPlanVersionNode,
  PlanPrerequisite,
  StudyResult,
  FieldIssue,
} from '../../types/learningPaths';

export interface StudyPlanOrderSuccess {
  orderedNodeIds: string[];
  orderedNodes: StudyPlanVersionNode[];
}

export interface ManualMoveBounds {
  minPosition: number;
  maxPosition: number;
}

/**
 * Binary min-heap for deterministic priority queue.
 */
class MinHeap<T> {
  private readonly items: T[] = [];
  private readonly comparator: (a: T, b: T) => number;

  constructor(comparator: (a: T, b: T) => number) {
    this.comparator = comparator;
  }

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const bottom = this.items.pop();
    if (this.items.length > 0 && bottom !== undefined) {
      this.items[0] = bottom;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(index: number): void {
    const item = this.items[index];
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.items[parentIndex];
      if (this.comparator(item, parent) >= 0) break;
      this.items[index] = parent;
      index = parentIndex;
    }
    this.items[index] = item;
  }

  private sinkDown(index: number): void {
    const length = this.items.length;
    const item = this.items[index];

    while (true) {
      const leftChildIndex = 2 * index + 1;
      const rightChildIndex = 2 * index + 2;
      let swapIndex = -1;

      if (leftChildIndex < length) {
        if (this.comparator(this.items[leftChildIndex], item) < 0) {
          swapIndex = leftChildIndex;
        }
      }

      if (rightChildIndex < length) {
        const compareTarget = swapIndex === -1 ? item : this.items[swapIndex];
        if (this.comparator(this.items[rightChildIndex], compareTarget) < 0) {
          swapIndex = rightChildIndex;
        }
      }

      if (swapIndex === -1) break;
      this.items[index] = this.items[swapIndex];
      index = swapIndex;
    }

    this.items[index] = item;
  }
}

interface HeapNodeItem {
  node: StudyPlanVersionNode;
  previousPosition: number;
  normalizedTitle: string;
  nodeId: string;
}

/**
 * Normalizes title for stable deterministic comparison: NFC normalized and en-US lowercase.
 */
function normalizeTitle(title: string): string {
  return title.normalize('NFC').toLocaleLowerCase('en-US');
}

/**
 * Finds a concrete cycle in a directed graph using deterministic DFS.
 */
function extractConcreteCycle(
  nodes: string[],
  adj: Map<string, string[]>
): string[] {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];
  let foundCycle: string[] | null = null;

  function dfs(curr: string): boolean {
    visited.add(curr);
    inStack.add(curr);
    path.push(curr);

    const neighbors = [...(adj.get(curr) || [])].sort((a, b) => a.localeCompare(b, 'en-US'));
    for (const next of neighbors) {
      if (inStack.has(next)) {
        const cycleStartIndex = path.indexOf(next);
        foundCycle = path.slice(cycleStartIndex).concat(next);
        return true;
      }
      if (!visited.has(next)) {
        if (dfs(next)) return true;
      }
    }

    path.pop();
    inStack.delete(curr);
    return false;
  }

  const sortedCandidates = [...nodes].sort((a, b) => a.localeCompare(b, 'en-US'));
  for (const node of sortedCandidates) {
    if (!visited.has(node)) {
      if (dfs(node)) break;
    }
  }

  return foundCycle || [];
}

/**
 * Pure deterministic topological ordering function.
 *
 * Requirements:
 * - Reject duplicate node ids, empty included titles/objectives, out-of-range positions.
 * - Max 100 manual nodes.
 * - Reject self-edges, duplicate directed edges, edges touching included=false, and dangling endpoints.
 * - Kahn's algorithm with min-heap key: (previousPosition, normalizedTitle, nodeId).
 * - On cycle: return dependency_cycle error with sorted remaining ids and concrete cycle.
 * - Immutability: input objects/arrays are never mutated.
 */
export function orderStudyPlan(
  nodes: readonly StudyPlanVersionNode[],
  prerequisites: readonly PlanPrerequisite[],
  previousPositions?: ReadonlyMap<string, number> | Readonly<Record<string, number>>
): StudyResult<StudyPlanOrderSuccess> {
  const fieldIssues: FieldIssue[] = [];

  // Limit check: max 100 nodes
  if (nodes.length > 100) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        messageKey: 'study_plan.error.max_nodes_exceeded',
        retryable: false,
        fieldIssues: [{
          path: 'nodes',
          code: 'max_nodes_exceeded',
          messageKey: 'study_plan.error.max_nodes_exceeded',
        }],
      },
    };
  }

  // 1. Validate node identities and duplicate IDs
  const nodeMap = new Map<string, StudyPlanVersionNode>();
  const titlesSeen = new Set<string>();

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node.nodeId || node.nodeId.trim() === '') {
      fieldIssues.push({
        path: `nodes[${i}].nodeId`,
        code: 'invalid_node_id',
        messageKey: 'study_plan.error.invalid_node_id',
      });
      continue;
    }

    if (nodeMap.has(node.nodeId)) {
      return {
        ok: false,
        error: {
          code: 'duplicate_node',
          messageKey: 'study_plan.error.duplicate_node',
          retryable: false,
          fieldIssues: [{
            path: `nodes[${i}].nodeId`,
            code: 'duplicate_node',
            messageKey: 'study_plan.error.duplicate_node',
          }],
        },
      };
    }
    nodeMap.set(node.nodeId, node);

    // Validate included node fields
    if (node.included) {
      const trimmedTitle = (node.title || '').trim();
      if (trimmedTitle.length < 1 || trimmedTitle.length > 160) {
        fieldIssues.push({
          path: `nodes[${i}].title`,
          code: 'invalid_title_length',
          messageKey: 'study_plan.error.invalid_title_length',
        });
      }

      const normalized = normalizeTitle(trimmedTitle);
      if (titlesSeen.has(normalized)) {
        fieldIssues.push({
          path: `nodes[${i}].title`,
          code: 'repeated_title',
          messageKey: 'study_plan.error.repeated_title',
        });
      }
      titlesSeen.add(normalized);

      if (!node.learningObjectives || node.learningObjectives.length === 0 || node.learningObjectives.length > 6) {
        fieldIssues.push({
          path: `nodes[${i}].learningObjectives`,
          code: 'invalid_objectives_count',
          messageKey: 'study_plan.error.invalid_objectives_count',
        });
      } else {
        for (let j = 0; j < node.learningObjectives.length; j++) {
          const obj = (node.learningObjectives[j] || '').trim();
          if (obj.length < 1 || obj.length > 240) {
            fieldIssues.push({
              path: `nodes[${i}].learningObjectives[${j}]`,
              code: 'invalid_objective_length',
              messageKey: 'study_plan.error.invalid_objective_length',
            });
          }
        }
      }

      if (node.summary && node.summary.trim().length > 1000) {
        fieldIssues.push({
          path: `nodes[${i}].summary`,
          code: 'invalid_summary_length',
          messageKey: 'study_plan.error.invalid_summary_length',
        });
      }

      if (node.sourceRefIds && node.sourceRefIds.length > 8) {
        fieldIssues.push({
          path: `nodes[${i}].sourceRefIds`,
          code: 'max_sources_exceeded',
          messageKey: 'study_plan.error.max_sources_exceeded',
        });
      }
    }
  }

  // 2. Validate prerequisites
  const edgeKeys = new Set<string>();
  for (let i = 0; i < prerequisites.length; i++) {
    const edge = prerequisites[i];
    const { prerequisiteNodeId, dependentNodeId } = edge;

    // Self edge
    if (prerequisiteNodeId === dependentNodeId) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          messageKey: 'study_plan.error.self_edge',
          retryable: false,
          fieldIssues: [{
            path: `prerequisites[${i}]`,
            code: 'self_edge',
            messageKey: 'study_plan.error.self_edge',
          }],
        },
      };
    }

    const edgeKey = `${prerequisiteNodeId}->${dependentNodeId}`;
    if (edgeKeys.has(edgeKey)) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          messageKey: 'study_plan.error.duplicate_edge',
          retryable: false,
          fieldIssues: [{
            path: `prerequisites[${i}]`,
            code: 'duplicate_edge',
            messageKey: 'study_plan.error.duplicate_edge',
          }],
        },
      };
    }
    edgeKeys.add(edgeKey);

    const fromNode = nodeMap.get(prerequisiteNodeId);
    const toNode = nodeMap.get(dependentNodeId);

    // Dangling endpoint (unknown node or excluded node)
    if (!fromNode || !toNode) {
      return {
        ok: false,
        error: {
          code: 'dangling_prerequisite',
          messageKey: 'study_plan.error.dangling_prerequisite',
          retryable: false,
          fieldIssues: [{
            path: `prerequisites[${i}]`,
            code: 'dangling_prerequisite',
            messageKey: 'study_plan.error.dangling_prerequisite',
          }],
        },
      };
    }

    if (!fromNode.included || !toNode.included) {
      return {
        ok: false,
        error: {
          code: 'dangling_prerequisite',
          messageKey: 'study_plan.error.excluded_prerequisite',
          retryable: false,
          fieldIssues: [{
            path: `prerequisites[${i}]`,
            code: 'excluded_prerequisite',
            messageKey: 'study_plan.error.excluded_prerequisite',
          }],
        },
      };
    }
  }

  if (fieldIssues.length > 0) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        messageKey: 'study_plan.error.validation_failed',
        retryable: false,
        fieldIssues,
      },
    };
  }

  // 3. Build Kahn adjacency and indegree for included nodes
  const includedNodes = nodes.filter((n) => n.included);
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of includedNodes) {
    adj.set(node.nodeId, []);
    inDegree.set(node.nodeId, 0);
  }

  for (const edge of prerequisites) {
    const fromNode = nodeMap.get(edge.prerequisiteNodeId);
    const toNode = nodeMap.get(edge.dependentNodeId);
    if (fromNode?.included && toNode?.included) {
      adj.get(edge.prerequisiteNodeId)!.push(edge.dependentNodeId);
      inDegree.set(edge.dependentNodeId, (inDegree.get(edge.dependentNodeId) || 0) + 1);
    }
  }

  // Min-heap with deterministic tie-breaker:
  // (previousPosition ?? Number.MAX_SAFE_INTEGER, normalizedTitle, nodeId)
  const heap = new MinHeap<HeapNodeItem>((a, b) => {
    if (a.previousPosition !== b.previousPosition) {
      return a.previousPosition - b.previousPosition;
    }
    const titleCmp = a.normalizedTitle.localeCompare(b.normalizedTitle, 'en-US');
    if (titleCmp !== 0) {
      return titleCmp;
    }
    return a.nodeId.localeCompare(b.nodeId, 'en-US');
  });

  function getPrevPos(node: StudyPlanVersionNode): number {
    if (previousPositions) {
      if (previousPositions instanceof Map) {
        const p = previousPositions.get(node.nodeId);
        if (p !== undefined) return p;
      } else if (typeof previousPositions === 'object' && node.nodeId in previousPositions) {
        return (previousPositions as Record<string, number>)[node.nodeId];
      }
    }
    return node.position >= 0 ? node.position : Number.MAX_SAFE_INTEGER;
  }

  for (const node of includedNodes) {
    if (inDegree.get(node.nodeId) === 0) {
      heap.push({
        node,
        previousPosition: getPrevPos(node),
        normalizedTitle: normalizeTitle(node.title),
        nodeId: node.nodeId,
      });
    }
  }

  const orderedIncludedNodes: StudyPlanVersionNode[] = [];
  const orderedIncludedIds: string[] = [];

  while (heap.size > 0) {
    const item = heap.pop()!;
    orderedIncludedNodes.push(item.node);
    orderedIncludedIds.push(item.node.nodeId);

    const dependents = adj.get(item.node.nodeId) || [];
    for (const depId of dependents) {
      const nextDeg = inDegree.get(depId)! - 1;
      inDegree.set(depId, nextDeg);
      if (nextDeg === 0) {
        const depNode = nodeMap.get(depId)!;
        heap.push({
          node: depNode,
          previousPosition: getPrevPos(depNode),
          normalizedTitle: normalizeTitle(depNode.title),
          nodeId: depNode.nodeId,
        });
      }
    }
  }

  // 4. Cycle check
  if (orderedIncludedNodes.length < includedNodes.length) {
    const unvisitedIds = includedNodes
      .map((n) => n.nodeId)
      .filter((id) => !orderedIncludedIds.includes(id))
      .sort((a, b) => a.localeCompare(b, 'en-US'));

    const concreteCycle = extractConcreteCycle(unvisitedIds, adj);

    return {
      ok: false,
      error: {
        code: 'dependency_cycle',
        messageKey: 'study_plan.error.dependency_cycle',
        retryable: false,
        fieldIssues: [{
          path: 'prerequisites',
          code: 'dependency_cycle',
          messageKey: 'study_plan.error.dependency_cycle',
        }],
        details: {
          remainingNodeIds: unvisitedIds,
          cycle: concreteCycle,
        },
      },
    };
  }

  // 5. Construct updated nodes with contiguous positions (0..includedCount-1)
  // and preserve excluded nodes with position = -1. Input arrays/nodes are not mutated.
  const finalNodes: StudyPlanVersionNode[] = [];
  const finalOrderedIds: string[] = [];

  for (let pos = 0; pos < orderedIncludedNodes.length; pos++) {
    const orig = orderedIncludedNodes[pos];
    finalNodes.push({
      ...orig,
      position: pos,
    });
    finalOrderedIds.push(orig.nodeId);
  }

  // Append excluded nodes
  for (const node of nodes) {
    if (!node.included) {
      finalNodes.push({
        ...node,
        position: -1,
      });
    }
  }

  return {
    ok: true,
    value: {
      orderedNodeIds: finalOrderedIds,
      orderedNodes: finalNodes,
    },
  };
}

/**
 * Calculates transitive reachability sets (prerequisites and dependents) for a given node.
 */
function getTransitiveClosures(
  includedNodeIds: Set<string>,
  prerequisites: readonly PlanPrerequisite[]
): {
  prereqClosure: Map<string, Set<string>>;
  depClosure: Map<string, Set<string>>;
} {
  const directPrereqs = new Map<string, Set<string>>();
  const directDeps = new Map<string, Set<string>>();

  for (const id of includedNodeIds) {
    directPrereqs.set(id, new Set());
    directDeps.set(id, new Set());
  }

  for (const p of prerequisites) {
    if (includedNodeIds.has(p.prerequisiteNodeId) && includedNodeIds.has(p.dependentNodeId)) {
      directPrereqs.get(p.dependentNodeId)?.add(p.prerequisiteNodeId);
      directDeps.get(p.prerequisiteNodeId)?.add(p.dependentNodeId);
    }
  }

  function computeClosure(directMap: Map<string, Set<string>>): Map<string, Set<string>> {
    const closure = new Map<string, Set<string>>();
    for (const id of includedNodeIds) {
      const reached = new Set<string>();
      const queue = [...(directMap.get(id) || [])];
      for (const item of queue) {
        reached.add(item);
      }
      let head = 0;
      while (head < queue.length) {
        const curr = queue[head++];
        const nexts = directMap.get(curr) || [];
        for (const n of nexts) {
          if (!reached.has(n)) {
            reached.add(n);
            queue.push(n);
          }
        }
      }
      closure.set(id, reached);
    }
    return closure;
  }

  return {
    prereqClosure: computeClosure(directPrereqs),
    depClosure: computeClosure(directDeps),
  };
}

/**
 * Calculates manual-move earliest (minPosition) and latest (maxPosition) bounds for a node.
 * Evaluated with the selected node removed from its slot before bounds are evaluated.
 */
export function calculateManualMoveBounds(
  nodes: readonly StudyPlanVersionNode[],
  prerequisites: readonly PlanPrerequisite[],
  targetNodeId: string
): StudyResult<ManualMoveBounds> {
  const targetNode = nodes.find((n) => n.nodeId === targetNodeId);
  if (!targetNode || !targetNode.included) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        messageKey: 'study_plan.error.node_not_found',
        retryable: false,
      },
    };
  }

  const includedNodes = nodes.filter((n) => n.included);
  const includedIds = new Set(includedNodes.map((n) => n.nodeId));
  const { prereqClosure, depClosure } = getTransitiveClosures(includedIds, prerequisites);

  const transitivePrereqs = prereqClosure.get(targetNodeId) || new Set();
  const transitiveDeps = depClosure.get(targetNodeId) || new Set();

  // Nodes other than target, ordered by current position
  const otherIncluded = includedNodes
    .filter((n) => n.nodeId !== targetNodeId)
    .sort((a, b) => a.position - b.position);

  // In the remaining array of length (includedNodes.length - 1):
  // The target node can be inserted at any index 0..includedNodes.length - 1.
  // Any prerequisite must come BEFORE target. So target must be inserted at index > index of prereq.
  // Any dependent must come AFTER target. So target must be inserted at index <= index of dependent.
  let minPosition = 0;
  let maxPosition = includedNodes.length - 1;

  for (let slot = 0; slot < otherIncluded.length; slot++) {
    const otherId = otherIncluded[slot].nodeId;
    if (transitivePrereqs.has(otherId)) {
      minPosition = Math.max(minPosition, slot + 1);
    }
    if (transitiveDeps.has(otherId)) {
      maxPosition = Math.min(maxPosition, slot);
    }
  }

  if (minPosition > maxPosition) {
    return {
      ok: false,
      error: {
        code: 'order_conflict',
        messageKey: 'study_plan.error.order_conflict',
        retryable: false,
        details: {
          minPosition,
          maxPosition,
        },
      },
    };
  }

  return {
    ok: true,
    value: {
      minPosition,
      maxPosition,
    },
  };
}

/**
 * Reorders a study plan node to a target position, enforcing valid DAG bounds.
 * Normalizes contiguous positions 0..includedCount-1 and marks the node userModified = true.
 */
export function reorderStudyPlanNode(
  nodes: readonly StudyPlanVersionNode[],
  prerequisites: readonly PlanPrerequisite[],
  nodeId: string,
  targetPosition: number
): StudyResult<StudyPlanVersionNode[]> {
  const boundsResult = calculateManualMoveBounds(nodes, prerequisites, nodeId);
  if (!boundsResult.ok) {
    return { ok: false, error: boundsResult.error };
  }

  const { minPosition, maxPosition } = boundsResult.value;
  if (targetPosition < minPosition || targetPosition > maxPosition) {
    return {
      ok: false,
      error: {
        code: 'order_conflict',
        messageKey: 'study_plan.error.order_conflict',
        retryable: false,
        details: {
          minPosition,
          maxPosition,
        },
      },
    };
  }

  const targetNode = nodes.find((n) => n.nodeId === nodeId)!;
  const otherIncluded = nodes
    .filter((n) => n.included && n.nodeId !== nodeId)
    .sort((a, b) => a.position - b.position);

  const updatedTarget: StudyPlanVersionNode = {
    ...targetNode,
    userModified: true,
  };

  const newIncluded: StudyPlanVersionNode[] = [
    ...otherIncluded.slice(0, targetPosition),
    updatedTarget,
    ...otherIncluded.slice(targetPosition),
  ];

  const resultNodes: StudyPlanVersionNode[] = newIncluded.map((n, idx) => ({
    ...n,
    position: idx,
  }));

  for (const n of nodes) {
    if (!n.included) {
      resultNodes.push({
        ...n,
        position: -1,
      });
    }
  }

  return {
    ok: true,
    value: resultNodes,
  };
}
