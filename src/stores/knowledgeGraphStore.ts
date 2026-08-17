import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ConceptNode, ConceptEdge } from '../types/knowledgeGraph';

export interface KnowledgeGraphStoreState {
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  selectedNodeId: string | null;

  // Actions
  upsertNode: (node: ConceptNode) => void;
  upsertEdge: (edge: ConceptEdge) => void;
  deleteEdge: (id: string) => void;
  mergeNodes: (sourceId: string, targetId: string) => void;
  selectNode: (id: string | null) => void;
  getNeighborhood: (nodeId: string) => { nodes: ConceptNode[]; edges: ConceptEdge[] };
  searchNodes: (query: string) => ConceptNode[];
  clear: () => void;
}

export const useKnowledgeGraphStore = create<KnowledgeGraphStoreState>()(
  persist(
    (set, get) => ({
      nodes: [],
      edges: [],
      selectedNodeId: null,

      upsertNode: (node) => {
        const { nodes } = get();
        const existingIdx = nodes.findIndex((n) => n.id === node.id);
        if (existingIdx >= 0) {
          const updated = [...nodes];
          updated[existingIdx] = {
            ...updated[existingIdx],
            ...node,
            aliases: Array.from(new Set([...updated[existingIdx].aliases, ...node.aliases])),
            provenance: [...updated[existingIdx].provenance, ...node.provenance],
          };
          set({ nodes: updated });
        } else {
          set({ nodes: [...nodes, node] });
        }
      },

      upsertEdge: (edge) => {
        const { edges } = get();
        const existingIdx = edges.findIndex(
          (e) => e.fromId === edge.fromId && e.toId === edge.toId && e.relation === edge.relation
        );
        if (existingIdx >= 0) {
          const updated = [...edges];
          updated[existingIdx] = {
            ...updated[existingIdx],
            ...edge,
            evidence: [...updated[existingIdx].evidence, ...edge.evidence],
          };
          set({ edges: updated });
        } else {
          set({ edges: [...edges, edge] });
        }
      },

      deleteEdge: (id) => {
        set({ edges: get().edges.filter((e) => e.id !== id) });
      },

      mergeNodes: (sourceId, targetId) => {
        const { nodes, edges } = get();
        const sourceNode = nodes.find((n) => n.id === sourceId);
        const targetNode = nodes.find((n) => n.id === targetId);
        if (!sourceNode || !targetNode) return;

        // Merge source aliases and provenance into target
        const updatedTarget: ConceptNode = {
          ...targetNode,
          aliases: Array.from(
            new Set([...targetNode.aliases, sourceNode.name, ...sourceNode.aliases])
          ),
          provenance: [...targetNode.provenance, ...sourceNode.provenance],
        };

        // Re-parent edges from sourceId to targetId
        const updatedEdges = edges
          .map((e) => {
            if (e.fromId === sourceId) return { ...e, fromId: targetId };
            if (e.toId === sourceId) return { ...e, toId: targetId };
            return e;
          })
          // Filter out self-loops created by merge
          .filter((e) => e.fromId !== e.toId);

        set({
          nodes: nodes.filter((n) => n.id !== sourceId).map((n) => (n.id === targetId ? updatedTarget : n)),
          edges: updatedEdges,
        });
      },

      selectNode: (id) => {
        set({ selectedNodeId: id });
      },

      getNeighborhood: (nodeId) => {
        const { nodes, edges } = get();
        const connectedEdges = edges.filter((e) => e.fromId === nodeId || e.toId === nodeId);
        const neighborIds = new Set<string>([
          nodeId,
          ...connectedEdges.map((e) => (e.fromId === nodeId ? e.toId : e.fromId)),
        ]);
        const neighborNodes = nodes.filter((n) => neighborIds.has(n.id));

        return { nodes: neighborNodes, edges: connectedEdges };
      },

      searchNodes: (query) => {
        const q = query.toLowerCase().trim();
        if (!q) return [];
        return get().nodes.filter(
          (n) =>
            n.name.toLowerCase().includes(q) ||
            n.aliases.some((a) => a.toLowerCase().includes(q)) ||
            (n.definition && n.definition.toLowerCase().includes(q))
        );
      },

      clear: () => {
        set({ nodes: [], edges: [], selectedNodeId: null });
      },
    }),
    {
      name: 'plethora-knowledge-graph',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
      }),
    }
  )
);
