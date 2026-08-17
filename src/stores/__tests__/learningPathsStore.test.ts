import { describe, it, expect, beforeEach } from 'vitest';
import { useLearningPathsStore } from '../learningPathsStore';

describe('LearningPathsStore', () => {
  beforeEach(() => {
    useLearningPathsStore.getState().clearPaths();
  });

  it('creates goals and adaptive learning paths', () => {
    const store = useLearningPathsStore.getState();
    const goalId = store.createGoal({
      title: 'Master Modern Cryptography',
      description: 'Zero-knowledge proofs and symmetric ciphers',
    });

    const pathId = store.createPath({
      goalId,
      title: 'ZKP and AES Foundation Path',
      nodes: [
        {
          id: 'n1',
          pathId: 'p1',
          title: 'Discrete Logarithms',
          sourceDocIds: ['doc-crypto-1'],
          prerequisiteNodeIds: [],
          estimatedMasteryStart: 0.2,
          targetMastery: 0.9,
          isUserModified: false,
          status: 'pending',
        },
      ],
    });

    const active = useLearningPathsStore.getState().getActivePath();
    expect(active).not.toBeNull();
    expect(active?.id).toBe(pathId);
    expect(active?.nodes).toHaveLength(1);
  });

  it('updates node status and preserves manual node re-orderings', () => {
    const store = useLearningPathsStore.getState();
    const goalId = store.createGoal({ title: 'Distributed Systems' });
    const pathId = store.createPath({
      goalId,
      title: 'Raft & Paxos Consensus',
      nodes: [
        {
          id: 'n1',
          pathId: 'temp',
          title: 'State Machine Replication',
          sourceDocIds: [],
          prerequisiteNodeIds: [],
          estimatedMasteryStart: 0.4,
          targetMastery: 0.9,
          isUserModified: false,
          status: 'pending',
        },
        {
          id: 'n2',
          pathId: 'temp',
          title: 'Leader Election',
          sourceDocIds: [],
          prerequisiteNodeIds: ['n1'],
          estimatedMasteryStart: 0.2,
          targetMastery: 0.85,
          isUserModified: false,
          status: 'pending',
        },
      ],
    });

    store.updateNodeStatus(pathId, 'n1', 'completed');
    expect(useLearningPathsStore.getState().getActivePath()?.nodes[0].status).toBe('completed');

    store.reorderNodes(pathId, ['n2', 'n1']);
    const reordered = useLearningPathsStore.getState().getActivePath()?.nodes;
    expect(reordered?.[0].id).toBe('n2');
    expect(reordered?.[0].isUserModified).toBe(true);
  });
});
