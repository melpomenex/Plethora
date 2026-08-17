import { beforeEach, describe, expect, it } from 'vitest';
import { useKnowledgeGraphStore } from '../knowledgeGraphStore';
import { ConceptNode, ConceptEdge } from '../../types/knowledgeGraph';

describe('KnowledgeGraphStore & Neighborhood Traversal', () => {
  beforeEach(() => {
    localStorage.clear();
    useKnowledgeGraphStore.getState().clear();
  });

  const nodeA: ConceptNode = {
    id: 'concept-1',
    name: 'Working Memory',
    type: 'concept',
    definition: 'A cognitive system with limited capacity.',
    aliases: ['Short-Term Buffer'],
    provenance: [],
    createdAt: new Date().toISOString(),
  };

  const nodeB: ConceptNode = {
    id: 'concept-2',
    name: 'Central Executive',
    type: 'concept',
    definition: 'Component managing attention.',
    aliases: [],
    provenance: [],
    createdAt: new Date().toISOString(),
  };

  const edgeAB: ConceptEdge = {
    id: 'edge-1',
    fromId: 'concept-1',
    toId: 'concept-2',
    relation: 'extends',
    confidence: 0.95,
    evidence: [],
    createdBy: 'ai',
    createdAt: new Date().toISOString(),
  };

  it('upserts nodes and edges', () => {
    const store = useKnowledgeGraphStore.getState();
    store.upsertNode(nodeA);
    store.upsertNode(nodeB);
    store.upsertEdge(edgeAB);

    expect(useKnowledgeGraphStore.getState().nodes.length).toBe(2);
    expect(useKnowledgeGraphStore.getState().edges.length).toBe(1);
  });

  it('retrieves connected neighborhood for a node', () => {
    const store = useKnowledgeGraphStore.getState();
    store.upsertNode(nodeA);
    store.upsertNode(nodeB);
    store.upsertEdge(edgeAB);

    const neighborhood = store.getNeighborhood('concept-1');
    expect(neighborhood.nodes.length).toBe(2);
    expect(neighborhood.edges.length).toBe(1);
  });

  it('merges nodes and re-parents edges', () => {
    const store = useKnowledgeGraphStore.getState();
    store.upsertNode(nodeA);
    store.upsertNode(nodeB);
    store.upsertEdge(edgeAB);

    const nodeC: ConceptNode = {
      id: 'concept-3',
      name: 'WM Buffer',
      type: 'concept',
      aliases: [],
      provenance: [],
      createdAt: new Date().toISOString(),
    };
    store.upsertNode(nodeC);

    // Edge from C to B
    store.upsertEdge({
      id: 'edge-2',
      fromId: 'concept-3',
      toId: 'concept-2',
      relation: 'supports',
      confidence: 0.9,
      evidence: [],
      createdBy: 'user',
      createdAt: new Date().toISOString(),
    });

    // Merge C into A
    store.mergeNodes('concept-3', 'concept-1');

    const updatedNodes = useKnowledgeGraphStore.getState().nodes;
    expect(updatedNodes.some((n) => n.id === 'concept-3')).toBe(false);

    const targetNode = updatedNodes.find((n) => n.id === 'concept-1');
    expect(targetNode?.aliases).toContain('WM Buffer');

    const updatedEdges = useKnowledgeGraphStore.getState().edges;
    // Edge-2 should now be from concept-1 to concept-2
    const reparented = updatedEdges.find((e) => e.id === 'edge-2');
    expect(reparented?.fromId).toBe('concept-1');
  });
});
