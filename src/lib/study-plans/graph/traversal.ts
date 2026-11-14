import type { PlanPrerequisite, StudyPlanVersionNode } from '../../../types/learningPaths';
import { orderStudyPlan } from '../topology';
import type { StudyPlanGraphEdge, StudyPlanGraphNode } from './types';

export interface TransitiveSubgraphResult {
  focusNodeId: string;
  direction: 'prerequisites' | 'dependents';
  directNodeIds: Set<string>;
  transitiveNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
}

export function computeTransitiveSubgraph(
  focusNodeId: string,
  edges: readonly Pick<StudyPlanGraphEdge, 'id' | 'prerequisiteNodeId' | 'dependentNodeId'>[],
  direction: 'prerequisites' | 'dependents'
): TransitiveSubgraphResult {
  const adj = new Map<string, Array<{ nextId: string; edgeId: string }>>();
  for (const edge of edges) {
    const from = direction === 'prerequisites' ? edge.dependentNodeId : edge.prerequisiteNodeId;
    const to = direction === 'prerequisites' ? edge.prerequisiteNodeId : edge.dependentNodeId;
    let list = adj.get(from);
    if (!list) {
      list = [];
      adj.set(from, list);
    }
    list.push({ nextId: to, edgeId: edge.id });
  }

  const directNodeIds = new Set<string>();
  const transitiveNodeIds = new Set<string>([focusNodeId]);
  const highlightedEdgeIds = new Set<string>();
  const queue: string[] = [focusNodeId];

  for (const entry of adj.get(focusNodeId) ?? []) {
    directNodeIds.add(entry.nextId);
  }

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    for (const entry of adj.get(curr) ?? []) {
      highlightedEdgeIds.add(entry.edgeId);
      if (!transitiveNodeIds.has(entry.nextId)) {
        transitiveNodeIds.add(entry.nextId);
        queue.push(entry.nextId);
      }
    }
  }

  return {
    focusNodeId,
    direction,
    directNodeIds,
    transitiveNodeIds,
    highlightedEdgeIds,
  };
}

export function searchStudyPlanGraphNodes(
  nodes: readonly StudyPlanGraphNode[],
  query: string
): StudyPlanGraphNode[] {
  const normalized = query.trim().toLocaleLowerCase('en-US');
  if (!normalized) return [];

  return nodes.filter((node) => {
    const numberString = node.curriculumNumber > 0 ? String(node.curriculumNumber) : '';
    if (numberString === normalized || `#${numberString}` === normalized) {
      return true;
    }
    if (node.title.toLocaleLowerCase('en-US').includes(normalized)) return true;
    if (node.conceptLabel.toLocaleLowerCase('en-US').includes(normalized)) return true;
    if (node.summary.toLocaleLowerCase('en-US').includes(normalized)) return true;
    return node.learningObjectives.some((obj) => obj.toLocaleLowerCase('en-US').includes(normalized));
  });
}

export type PrerequisiteMutationResult =
  | {
      ok: true;
      prerequisites: PlanPrerequisite[];
      nodes: StudyPlanVersionNode[];
    }
  | {
      ok: false;
      code:
        | 'read_only'
        | 'self_edge'
        | 'duplicate_edge'
        | 'not_found'
        | 'excluded_endpoint'
        | 'dependency_cycle'
        | 'invalid_input';
      errorMessage: string;
    };

export function validateAndAddPrerequisiteEdge(
  nodes: readonly StudyPlanVersionNode[],
  prerequisites: readonly PlanPrerequisite[],
  prerequisiteNodeId: string,
  dependentNodeId: string,
  isReadOnly: boolean
): PrerequisiteMutationResult {
  if (isReadOnly) {
    return {
      ok: false,
      code: 'read_only',
      errorMessage: 'Published study plans are read-only. Create or edit a draft to modify prerequisites.',
    };
  }

  if (prerequisiteNodeId === dependentNodeId) {
    return {
      ok: false,
      code: 'self_edge',
      errorMessage: 'A topic cannot be a prerequisite of itself.',
    };
  }

  const fromNode = nodes.find((n) => n.nodeId === prerequisiteNodeId);
  const toNode = nodes.find((n) => n.nodeId === dependentNodeId);
  if (!fromNode || !toNode) {
    return {
      ok: false,
      code: 'not_found',
      errorMessage: 'Both prerequisite and dependent topics must exist in the study plan.',
    };
  }

  if (!fromNode.included || !toNode.included) {
    return {
      ok: false,
      code: 'excluded_endpoint',
      errorMessage: 'Cannot link removed or excluded topics.',
    };
  }

  const duplicate = prerequisites.some(
    (p) => p.prerequisiteNodeId === prerequisiteNodeId && p.dependentNodeId === dependentNodeId
  );
  if (duplicate) {
    return {
      ok: false,
      code: 'duplicate_edge',
      errorMessage: `"${fromNode.title}" is already a prerequisite for "${toNode.title}".`,
    };
  }

  const nextEdge: PlanPrerequisite = {
    prerequisiteNodeId,
    dependentNodeId,
    support: 'user',
    rationale: null,
    sourceRefIds: [],
  };
  const nextPrerequisites = [...prerequisites, nextEdge];

  const ordered = orderStudyPlan(nodes, nextPrerequisites);
  if (!ordered.ok) {
    if (ordered.error.code === 'dependency_cycle') {
      return {
        ok: false,
        code: 'dependency_cycle',
        errorMessage: `Cannot link "${fromNode.title}" → "${toNode.title}": this would create a circular prerequisite cycle.`,
      };
    }
    return {
      ok: false,
      code: 'invalid_input',
      errorMessage: 'Cannot add prerequisite: study plan topology validation failed.',
    };
  }

  // Respect locked positions: if adding an edge only forces unlocked reorder, accept ordered nodes;
  // if a locked node cannot retain its requested position, keep topological validation intact and warn only if needed.
  return {
    ok: true,
    prerequisites: nextPrerequisites,
    nodes: ordered.value.orderedNodes,
  };
}

export function removePrerequisiteEdge(
  nodes: readonly StudyPlanVersionNode[],
  prerequisites: readonly PlanPrerequisite[],
  prerequisiteNodeId: string,
  dependentNodeId: string,
  isReadOnly: boolean
): PrerequisiteMutationResult {
  if (isReadOnly) {
    return {
      ok: false,
      code: 'read_only',
      errorMessage: 'Published study plans are read-only. Create or edit a draft to remove prerequisites.',
    };
  }

  const nextPrerequisites = prerequisites.filter(
    (p) => !(p.prerequisiteNodeId === prerequisiteNodeId && p.dependentNodeId === dependentNodeId)
  );
  if (nextPrerequisites.length === prerequisites.length) {
    return {
      ok: false,
      code: 'not_found',
      errorMessage: 'Prerequisite edge was not found.',
    };
  }

  const ordered = orderStudyPlan(nodes, nextPrerequisites);
  return {
    ok: true,
    prerequisites: nextPrerequisites,
    nodes: ordered.ok ? ordered.value.orderedNodes : [...nodes],
  };
}
