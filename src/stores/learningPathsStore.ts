import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  LearningGoal,
  LearningPath,
  LearningPathNode,
  PathNodeStatus,
} from '../types/learningPaths';
import { generateLearningPathTopology } from '../types/learningPaths';

export interface LearningPathsStoreState {
  goals: LearningGoal[];
  paths: LearningPath[];
  activePathId: string | null;
  isLoading: boolean;

  // Actions
  createGoal: (goal: Omit<LearningGoal, 'id' | 'createdAt' | 'status'>) => string;
  createPath: (params: {
    goalId: string;
    title: string;
    nodes: Omit<LearningPathNode, 'orderIndex'>[];
  }) => string;
  updateNodeStatus: (pathId: string, nodeId: string, status: PathNodeStatus) => void;
  reorderNodes: (pathId: string, orderedNodeIds: string[]) => void;
  setActivePathId: (pathId: string | null) => void;
  getActivePath: () => LearningPath | null;
  clearPaths: () => void;
}

export const useLearningPathsStore = create<LearningPathsStoreState>()(
  persist(
    (set, get) => ({
      goals: [],
      paths: [],
      activePathId: null,
      isLoading: false,

      createGoal: (goal) => {
        const id = `goal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const newGoal: LearningGoal = {
          ...goal,
          id,
          status: 'active',
          createdAt: new Date().toISOString(),
        };

        set({ goals: [newGoal, ...get().goals] });
        return id;
      },

      createPath: ({ goalId, title, nodes }) => {
        const id = `path_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const orderedNodes = generateLearningPathTopology(nodes);
        const newPath: LearningPath = {
          id,
          goalId,
          version: 1,
          title,
          nodes: orderedNodes,
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        set({
          paths: [newPath, ...get().paths],
          activePathId: id,
        });
        return id;
      },

      updateNodeStatus: (pathId, nodeId, status) => {
        set({
          paths: get().paths.map((p) => {
            if (p.id !== pathId) return p;
            return {
              ...p,
              updatedAt: new Date().toISOString(),
              nodes: p.nodes.map((n) => (n.id === nodeId ? { ...n, status } : n)),
            };
          }),
        });
      },

      reorderNodes: (pathId, orderedNodeIds) => {
        set({
          paths: get().paths.map((p) => {
            if (p.id !== pathId) return p;
            const nodeMap = new Map(p.nodes.map((n) => [n.id, n]));
            const newNodes: LearningPathNode[] = [];

            orderedNodeIds.forEach((id, index) => {
              const n = nodeMap.get(id);
              if (n) {
                newNodes.push({ ...n, orderIndex: index, isUserModified: true });
              }
            });

            return {
              ...p,
              updatedAt: new Date().toISOString(),
              nodes: newNodes,
            };
          }),
        });
      },

      setActivePathId: (activePathId) => {
        set({ activePathId });
      },

      getActivePath: () => {
        const { paths, activePathId } = get();
        if (!activePathId) return null;
        return paths.find((p) => p.id === activePathId) || null;
      },

      clearPaths: () => {
        set({ goals: [], paths: [], activePathId: null });
      },
    }),
    {
      name: 'plethora-learning-paths',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        goals: state.goals,
        paths: state.paths,
        activePathId: state.activePathId,
      }),
    }
  )
);
