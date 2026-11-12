/**
 * API-backed, non-persisted Zustand store for Study Plans.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §11
 * - openspec/planning/study-plans-assessments-program/04-DATA-AND-MIGRATION-PLAN.md §9.1
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T07)
 */

import { create } from 'zustand';
import * as api from '../api/study-plans';
import type {
  CreateStudyPlanInput,
  LearningGoal,
  LearningPath,
  LearningPathNode,
  NodeActivity,
  PathNodeStatus,
  SaveStudyPlanDraftInput,
  StudyCommandError,
  StudyPlanDetail,
  StudyPlanSummary,
  StudyPlanVersionNode,
} from '../types/learningPaths';
import { generateLearningPathTopology } from '../types/learningPaths';

export interface LearningPathsStoreState {
  // Authoritative native state cache
  plans: StudyPlanSummary[];
  activePlanId: string | null;
  activePlanDetail: StudyPlanDetail | null;
  isLoading: boolean;
  error: StudyCommandError | null;
  lastRunToken: number;

  // Legacy compatibility cache fields
  goals: LearningGoal[];
  paths: LearningPath[];
  activePathId: string | null;

  // Native API actions
  loadPlans: (includeArchived?: boolean) => Promise<StudyPlanSummary[]>;
  selectPlan: (planId: string | null, versionId?: string | null) => Promise<StudyPlanDetail | null>;
  createStudyPlan: (input: CreateStudyPlanInput) => Promise<StudyPlanDetail>;
  saveDraft: (input: SaveStudyPlanDraftInput) => Promise<StudyPlanDetail>;
  publishVersion: (
    planId: string,
    draftVersionId: string,
    expectedPlanRevision: number
  ) => Promise<StudyPlanDetail>;
  discardDraft: (planId: string, expectedPlanRevision: number) => Promise<StudyPlanDetail>;
  setNodeActivity: (
    planId: string,
    nodeId: string,
    activity: NodeActivity,
    expectedPlanRevision: number
  ) => Promise<StudyPlanDetail>;
  archivePlan: (planId: string, expectedPlanRevision: number) => Promise<void>;
  deletePlan: (planId: string, expectedPlanRevision: number) => Promise<void>;

  // Legacy actions (in-memory only; non-persisted)
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

  // Cache reset (does NOT erase SQLite)
  clearPaths: () => void;
}

function mapDetailToLegacyPath(detail: StudyPlanDetail): LearningPath {
  const nodes: LearningPathNode[] = detail.version.nodes.map((n: StudyPlanVersionNode, idx: number) => {
    const act = detail.activityByNodeId[n.nodeId] ?? 'not-started';
    const legacyStatus: PathNodeStatus =
      act === 'completed'
        ? 'completed'
        : act === 'in-progress'
        ? 'active'
        : act === 'skipped'
        ? 'skipped'
        : 'pending';

    const prereqIds = detail.version.prerequisites
      .filter((p) => p.dependentNodeId === n.nodeId)
      .map((p) => p.prerequisiteNodeId);

    return {
      id: n.nodeId,
      pathId: detail.plan.id,
      title: n.title,
      conceptId: n.conceptId ?? undefined,
      conceptName: n.conceptLabel,
      sourceDocIds: [],
      prerequisiteNodeIds: prereqIds,
      orderIndex: n.position >= 0 ? n.position : idx,
      isUserModified: n.userModified,
      status: legacyStatus,
    };
  });

  return {
    id: detail.plan.id,
    goalId: detail.plan.id,
    version: detail.plan.currentVersion,
    title: detail.plan.title,
    nodes,
    status: detail.plan.status === 'archived' ? 'archived' : 'active',
    createdAt: detail.plan.createdAt,
    updatedAt: detail.plan.updatedAt,
  };
}

export const useLearningPathsStore = create<LearningPathsStoreState>()((set, get) => ({
  plans: [],
  activePlanId: null,
  activePlanDetail: null,
  isLoading: false,
  error: null,
  lastRunToken: 0,

  goals: [],
  paths: [],
  activePathId: null,

  loadPlans: async (includeArchived = false) => {
    const token = get().lastRunToken + 1;
    set({ isLoading: true, error: null, lastRunToken: token });

    try {
      const summaries = await api.listStudyPlans(includeArchived);
      if (get().lastRunToken === token) {
        // Derive legacy summaries
        const legacyPaths: LearningPath[] = summaries.map((s) => ({
          id: s.id,
          goalId: s.id,
          version: s.currentVersion,
          title: s.title,
          nodes: [],
          status: s.status === 'archived' ? 'archived' : 'active',
          createdAt: s.updatedAt,
          updatedAt: s.updatedAt,
        }));

        set({ plans: summaries, paths: legacyPaths, isLoading: false });
      }
      return summaries;
    } catch (err: any) {
      if (get().lastRunToken === token) {
        set({ error: err, isLoading: false });
      }
      throw err;
    }
  },

  selectPlan: async (planId: string | null, versionId?: string | null) => {
    if (!planId) {
      set({ activePlanId: null, activePathId: null, activePlanDetail: null });
      return null;
    }

    const token = get().lastRunToken + 1;
    set({
      isLoading: true,
      error: null,
      activePlanId: planId,
      activePathId: planId,
      lastRunToken: token,
    });

    try {
      const detail = await api.getStudyPlan(planId, versionId);
      if (get().lastRunToken === token) {
        const legacy = mapDetailToLegacyPath(detail);
        const existingPaths = get().paths.filter((p) => p.id !== planId);
        set({
          activePlanDetail: detail,
          paths: [legacy, ...existingPaths],
          isLoading: false,
        });
      }
      return detail;
    } catch (err: any) {
      if (get().lastRunToken === token) {
        set({ error: err, isLoading: false });
      }
      throw err;
    }
  },

  createStudyPlan: async (input: CreateStudyPlanInput) => {
    const token = get().lastRunToken + 1;
    set({ isLoading: true, error: null, lastRunToken: token });

    try {
      const detail = await api.createStudyPlan(input);
      if (get().lastRunToken === token) {
        const summary: StudyPlanSummary = {
          id: detail.plan.id,
          title: detail.plan.title,
          goal: detail.plan.goal,
          depth: detail.plan.depth,
          status: detail.plan.status,
          currentVersion: detail.plan.currentVersion,
          revision: detail.plan.revision,
          nodeCount: detail.version.nodes.filter((n) => n.included).length,
          completedNodeCount: 0,
          sourceDocumentCount: 0,
          hasDraft: detail.plan.draftVersionId !== null,
          updatedAt: detail.plan.updatedAt,
        };
        const legacy = mapDetailToLegacyPath(detail);

        set({
          plans: [summary, ...get().plans],
          paths: [legacy, ...get().paths],
          activePlanId: detail.plan.id,
          activePathId: detail.plan.id,
          activePlanDetail: detail,
          isLoading: false,
        });
      }
      return detail;
    } catch (err: any) {
      if (get().lastRunToken === token) {
        set({ error: err, isLoading: false });
      }
      throw err;
    }
  },

  saveDraft: async (input: SaveStudyPlanDraftInput) => {
    set({ isLoading: true, error: null });
    try {
      const detail = await api.saveStudyPlanDraft(input);
      const legacy = mapDetailToLegacyPath(detail);
      set({
        activePlanDetail: detail,
        paths: get().paths.map((p) => (p.id === detail.plan.id ? legacy : p)),
        isLoading: false,
      });
      return detail;
    } catch (err: any) {
      set({ error: err, isLoading: false });
      throw err;
    }
  },

  publishVersion: async (
    planId: string,
    draftVersionId: string,
    expectedPlanRevision: number
  ) => {
    set({ isLoading: true, error: null });
    try {
      const detail = await api.publishStudyPlanVersion(
        planId,
        draftVersionId,
        expectedPlanRevision
      );
      const legacy = mapDetailToLegacyPath(detail);
      set({
        activePlanDetail: detail,
        plans: get().plans.map((p) =>
          p.id === planId
            ? {
                ...p,
                currentVersion: detail.plan.currentVersion,
                hasDraft: false,
                updatedAt: detail.plan.updatedAt,
              }
            : p
        ),
        paths: get().paths.map((p) => (p.id === planId ? legacy : p)),
        isLoading: false,
      });
      return detail;
    } catch (err: any) {
      set({ error: err, isLoading: false });
      throw err;
    }
  },

  discardDraft: async (planId: string, expectedPlanRevision: number) => {
    set({ isLoading: true, error: null });
    try {
      const detail = await api.discardStudyPlanDraft(planId, expectedPlanRevision);
      const legacy = mapDetailToLegacyPath(detail);
      set({
        activePlanDetail: detail,
        plans: get().plans.map((p) =>
          p.id === planId ? { ...p, hasDraft: false, updatedAt: detail.plan.updatedAt } : p
        ),
        paths: get().paths.map((p) => (p.id === planId ? legacy : p)),
        isLoading: false,
      });
      return detail;
    } catch (err: any) {
      set({ error: err, isLoading: false });
      throw err;
    }
  },

  setNodeActivity: async (
    planId: string,
    nodeId: string,
    activity: NodeActivity,
    expectedPlanRevision: number
  ) => {
    try {
      const detail = await api.setStudyPlanNodeActivity(
        planId,
        nodeId,
        activity,
        expectedPlanRevision
      );
      const legacy = mapDetailToLegacyPath(detail);
      set({
        activePlanDetail: detail,
        paths: get().paths.map((p) => (p.id === planId ? legacy : p)),
      });
      return detail;
    } catch (err: any) {
      set({ error: err });
      throw err;
    }
  },

  archivePlan: async (planId: string, expectedPlanRevision: number) => {
    set({ isLoading: true, error: null });
    try {
      await api.archiveStudyPlan(planId, expectedPlanRevision);
      set({
        plans: get().plans.filter((p) => p.id !== planId),
        paths: get().paths.filter((p) => p.id !== planId),
        activePlanId: get().activePlanId === planId ? null : get().activePlanId,
        activePathId: get().activePathId === planId ? null : get().activePathId,
        activePlanDetail:
          get().activePlanDetail?.plan.id === planId ? null : get().activePlanDetail,
        isLoading: false,
      });
    } catch (err: any) {
      set({ error: err, isLoading: false });
      throw err;
    }
  },

  deletePlan: async (planId: string, expectedPlanRevision: number) => {
    set({ isLoading: true, error: null });
    try {
      await api.deleteStudyPlan(planId, expectedPlanRevision);
      set({
        plans: get().plans.filter((p) => p.id !== planId),
        paths: get().paths.filter((p) => p.id !== planId),
        activePlanId: get().activePlanId === planId ? null : get().activePlanId,
        activePathId: get().activePathId === planId ? null : get().activePathId,
        activePlanDetail:
          get().activePlanDetail?.plan.id === planId ? null : get().activePlanDetail,
        isLoading: false,
      });
    } catch (err: any) {
      set({ error: err, isLoading: false });
      throw err;
    }
  },

  // Legacy in-memory operations (non-persisted)
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
      activePlanId: id,
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
    set({ activePathId, activePlanId: activePathId });
  },

  getActivePath: () => {
    const { paths, activePathId, activePlanDetail } = get();
    if (activePlanDetail) {
      return mapDetailToLegacyPath(activePlanDetail);
    }
    if (!activePathId) return null;
    return paths.find((p) => p.id === activePathId) || null;
  },

  clearPaths: () => {
    // Resets in-memory store only; does NOT erase SQLite
    set({
      plans: [],
      paths: [],
      goals: [],
      activePlanId: null,
      activePathId: null,
      activePlanDetail: null,
      error: null,
      isLoading: false,
    });
  },
}));
