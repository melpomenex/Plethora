export type GoalStatus = 'active' | 'completed' | 'archived';
export type PathNodeStatus = 'pending' | 'active' | 'completed' | 'skipped';

export interface LearningGoal {
  id: string;
  title: string;
  description?: string;
  scope?: {
    collectionIds?: string[];
    tagIds?: string[];
  };
  status: GoalStatus;
  createdAt: string;
}

export interface LearningPathNode {
  id: string;
  pathId: string;
  title: string;
  conceptId?: string;
  conceptName?: string;
  sourceDocIds: string[];
  prerequisiteNodeIds: string[];
  estimatedMasteryStart: number; // 0.0 - 1.0
  targetMastery: number; // 0.0 - 1.0
  orderIndex: number;
  isUserModified: boolean;
  status: PathNodeStatus;
}

export interface LearningPath {
  id: string;
  goalId: string;
  version: number;
  title: string;
  nodes: LearningPathNode[];
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Topologically sorts path nodes ensuring all prerequisite nodes come before dependent nodes.
 */
export function generateLearningPathTopology(
  nodes: Omit<LearningPathNode, 'orderIndex'>[]
): LearningPathNode[] {
  const nodeMap = new Map<string, Omit<LearningPathNode, 'orderIndex'>>();
  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    inDegree.set(node.id, 0);
    graph.set(node.id, []);
  }

  for (const node of nodes) {
    for (const prereqId of node.prerequisiteNodeIds) {
      if (graph.has(prereqId)) {
        graph.get(prereqId)!.push(node.id);
        inDegree.set(node.id, (inDegree.get(node.id) || 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(id);
    }
  }

  const sorted: LearningPathNode[] = [];
  let orderIndex = 0;

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const node = nodeMap.get(currentId);
    if (node) {
      sorted.push({ ...node, orderIndex: orderIndex++ });
    }

    const dependents = graph.get(currentId) || [];
    for (const depId of dependents) {
      const nextDeg = (inDegree.get(depId) || 1) - 1;
      inDegree.set(depId, nextDeg);
      if (nextDeg === 0) {
        queue.push(depId);
      }
    }
  }

  // If cycle or unvisited nodes exist, append remainder
  for (const node of nodes) {
    if (!sorted.some((s) => s.id === node.id)) {
      sorted.push({ ...node, orderIndex: orderIndex++ });
    }
  }

  return sorted;
}
