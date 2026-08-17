import { describe, it, expect } from 'vitest';
import { generateLearningPathTopology, LearningPathNode } from '../learningPaths';

describe('Learning Path Topology Planning', () => {
  it('orders nodes such that all prerequisites precede dependent nodes', () => {
    const nodes: Omit<LearningPathNode, 'orderIndex'>[] = [
      {
        id: 'node-c',
        pathId: 'p1',
        title: 'Virtual Memory & TLBs',
        sourceDocIds: ['doc-3'],
        prerequisiteNodeIds: ['node-b'],
        estimatedMasteryStart: 0.1,
        targetMastery: 0.8,
        isUserModified: false,
        status: 'pending',
      },
      {
        id: 'node-a',
        pathId: 'p1',
        title: 'Operating System Architecture',
        sourceDocIds: ['doc-1'],
        prerequisiteNodeIds: [],
        estimatedMasteryStart: 0.5,
        targetMastery: 0.9,
        isUserModified: false,
        status: 'pending',
      },
      {
        id: 'node-b',
        pathId: 'p1',
        title: 'Processes & Address Spaces',
        sourceDocIds: ['doc-2'],
        prerequisiteNodeIds: ['node-a'],
        estimatedMasteryStart: 0.3,
        targetMastery: 0.85,
        isUserModified: false,
        status: 'pending',
      },
    ];

    const sorted = generateLearningPathTopology(nodes);

    expect(sorted.map((n) => n.id)).toEqual(['node-a', 'node-b', 'node-c']);
    expect(sorted[0].orderIndex).toBe(0);
    expect(sorted[1].orderIndex).toBe(1);
    expect(sorted[2].orderIndex).toBe(2);
  });
});
