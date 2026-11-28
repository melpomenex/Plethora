/**
 * Zustand store for Unified Learning Goals.
 *
 * Manages active/paused/archived goals, creation wizard state, in-place goal
 * evolution, zero-duplication cross-goal source lookup, and deterministic
 * feasibility reports.
 */

import { create } from "zustand";
import {
  archiveLearningGoal,
  createLearningGoal,
  deleteLearningGoal,
  evaluateLearningGoalFeasibility,
  evolveLearningGoal,
  linkGoalSource,
  listLearningGoals,
  pauseLearningGoal,
  resumeLearningGoal,
  unlinkGoalSource,
  updateLearningGoal,
  upsertGoalMilestone,
  type ListLearningGoalsFilter,
  type UpsertGoalMilestoneInput,
} from "../api/learning-goals";
import type { EvaluateGoalFeasibilityInput } from "../lib/learning-goals/feasibility";
import type {
  CreateLearningGoalInput,
  EvolveLearningGoalInput,
  GoalFeasibilityReport,
  GoalSourceKind,
  GoalSourceRole,
  LearningGoal,
  LearningGoalMilestone,
  LearningGoalProgressSummary,
  LearningGoalSource,
  UpdateLearningGoalInput,
} from "../types/learningGoal";

export type LearningGoalWizardStep = "intent" | "sources" | "schedule" | "review";

export interface LearningGoalWizardState {
  isOpen: boolean;
  step: LearningGoalWizardStep;
  draft: Partial<CreateLearningGoalInput>;
}

export interface LearningGoalsState {
  goals: LearningGoal[];
  activeGoalId: string | null;
  feasibilityByGoalId: Record<string, GoalFeasibilityReport>;
  isLoading: boolean;
  error: string | null;
  wizard: LearningGoalWizardState;

  // Actions
  loadGoals: (filter?: ListLearningGoalsFilter) => Promise<LearningGoal[]>;
  createGoal: (input: CreateLearningGoalInput) => Promise<LearningGoal>;
  updateGoal: (
    goalId: string,
    patch: UpdateLearningGoalInput
  ) => Promise<LearningGoal>;
  evolveGoal: (
    goalId: string,
    evolution: EvolveLearningGoalInput
  ) => Promise<LearningGoal>;
  pauseGoal: (goalId: string) => Promise<LearningGoal>;
  resumeGoal: (goalId: string) => Promise<LearningGoal>;
  archiveGoal: (goalId: string) => Promise<LearningGoal>;
  deleteGoal: (goalId: string) => Promise<void>;
  linkSource: (
    goalId: string,
    sourceKind: GoalSourceKind,
    sourceId: string,
    sourceRole?: GoalSourceRole,
    weight?: number,
    label?: string
  ) => Promise<LearningGoalSource>;
  unlinkSource: (
    goalId: string,
    sourceKind: GoalSourceKind,
    sourceId: string
  ) => Promise<void>;
  upsertMilestone: (
    goalId: string,
    milestone: UpsertGoalMilestoneInput
  ) => Promise<LearningGoalMilestone>;
  evaluateFeasibility: (
    goalId: string,
    context?: Omit<EvaluateGoalFeasibilityInput, "goal">
  ) => Promise<GoalFeasibilityReport>;
  setActiveGoal: (goalId: string | null) => void;

  // Selectors
  getGoalsForSource: (
    sourceKind: GoalSourceKind,
    sourceId: string
  ) => LearningGoal[];
  getActiveGoals: () => LearningGoal[];
  getPausedGoals: () => LearningGoal[];
  getArchivedGoals: () => LearningGoal[];
  getProgressSummary: (goalId: string) => LearningGoalProgressSummary | null;

  // Wizard
  openWizard: (initialDraft?: Partial<CreateLearningGoalInput>) => void;
  setWizardStep: (step: LearningGoalWizardStep) => void;
  updateWizardDraft: (patch: Partial<CreateLearningGoalInput>) => void;
  closeWizard: () => void;
  submitWizard: () => Promise<LearningGoal>;

  // Reset
  reset: () => void;
}

const INITIAL_WIZARD_STATE: LearningGoalWizardState = {
  isOpen: false,
  step: "intent",
  draft: {},
};

function upsertGoalInList(
  goals: LearningGoal[],
  goal: LearningGoal
): LearningGoal[] {
  const index = goals.findIndex((g) => g.id === goal.id);
  if (index === -1) {
    return [goal, ...goals];
  }
  const next = [...goals];
  next[index] = goal;
  return next;
}

export const useLearningGoalsStore = create<LearningGoalsState>((set, get) => ({
  goals: [],
  activeGoalId: null,
  feasibilityByGoalId: {},
  isLoading: false,
  error: null,
  wizard: { ...INITIAL_WIZARD_STATE },

  loadGoals: async (filter) => {
    set({ isLoading: true, error: null });
    try {
      const goals = await listLearningGoals(filter);
      set({ goals, isLoading: false });
      return goals;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  createGoal: async (input) => {
    set({ error: null });
    try {
      const created = await createLearningGoal(input);
      set((state) => ({
        goals: upsertGoalInList(state.goals, created),
        activeGoalId: state.activeGoalId ?? created.id,
      }));
      return created;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message });
      throw error;
    }
  },

  updateGoal: async (goalId, patch) => {
    set({ error: null });
    try {
      const updated = await updateLearningGoal(goalId, patch);
      set((state) => ({
        goals: upsertGoalInList(state.goals, updated),
      }));
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message });
      throw error;
    }
  },

  evolveGoal: async (goalId, evolution) => {
    set({ error: null });
    try {
      const evolved = await evolveLearningGoal(goalId, evolution);
      set((state) => ({
        goals: upsertGoalInList(state.goals, evolved),
      }));
      return evolved;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message });
      throw error;
    }
  },

  pauseGoal: async (goalId) => {
    set({ error: null });
    try {
      const paused = await pauseLearningGoal(goalId);
      set((state) => ({
        goals: upsertGoalInList(state.goals, paused),
      }));
      return paused;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message });
      throw error;
    }
  },

  resumeGoal: async (goalId) => {
    set({ error: null });
    try {
      const resumed = await resumeLearningGoal(goalId);
      set((state) => ({
        goals: upsertGoalInList(state.goals, resumed),
      }));
      return resumed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message });
      throw error;
    }
  },

  archiveGoal: async (goalId) => {
    set({ error: null });
    try {
      const archived = await archiveLearningGoal(goalId);
      set((state) => ({
        goals: upsertGoalInList(state.goals, archived),
      }));
      return archived;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message });
      throw error;
    }
  },

  deleteGoal: async (goalId) => {
    set({ error: null });
    try {
      await deleteLearningGoal(goalId);
      set((state) => {
        const nextGoals = state.goals.filter((g) => g.id !== goalId);
        const nextFeasibility = { ...state.feasibilityByGoalId };
        delete nextFeasibility[goalId];
        return {
          goals: nextGoals,
          activeGoalId:
            state.activeGoalId === goalId
              ? (nextGoals[0]?.id ?? null)
              : state.activeGoalId,
          feasibilityByGoalId: nextFeasibility,
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message });
      throw error;
    }
  },

  linkSource: async (goalId, sourceKind, sourceId, sourceRole, weight, label) => {
    set({ error: null });
    try {
      const source = await linkGoalSource({
        goalId,
        sourceKind,
        sourceId,
        sourceRole,
        weight,
        label,
      });
      set((state) => ({
        goals: state.goals.map((g) => {
          if (g.id !== goalId) return g;
          const existingIndex = g.sources.findIndex(
            (s) => s.sourceKind === sourceKind && s.sourceId === sourceId
          );
          const nextSources =
            existingIndex >= 0
              ? g.sources.map((s, idx) => (idx === existingIndex ? source : s))
              : [...g.sources, source];
          return { ...g, sources: nextSources, updatedAt: new Date().toISOString() };
        }),
      }));
      return source;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message });
      throw error;
    }
  },

  unlinkSource: async (goalId, sourceKind, sourceId) => {
    set({ error: null });
    try {
      await unlinkGoalSource(goalId, sourceKind, sourceId);
      set((state) => ({
        goals: state.goals.map((g) => {
          if (g.id !== goalId) return g;
          return {
            ...g,
            sources: g.sources.filter(
              (s) => !(s.sourceKind === sourceKind && s.sourceId === sourceId)
            ),
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message });
      throw error;
    }
  },

  upsertMilestone: async (goalId, milestone) => {
    set({ error: null });
    try {
      const saved = await upsertGoalMilestone(goalId, milestone);
      set((state) => ({
        goals: state.goals.map((g) => {
          if (g.id !== goalId) return g;
          const idx = g.milestones.findIndex((m) => m.id === saved.id);
          const nextMilestones =
            idx >= 0
              ? g.milestones.map((m, i) => (i === idx ? saved : m))
              : [...g.milestones, saved];
          nextMilestones.sort((a, b) => a.sortOrder - b.sortOrder);
          return {
            ...g,
            milestones: nextMilestones,
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
      return saved;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message });
      throw error;
    }
  },

  evaluateFeasibility: async (goalId, context) => {
    set({ error: null });
    try {
      const report = await evaluateLearningGoalFeasibility(goalId, context);
      set((state) => ({
        feasibilityByGoalId: {
          ...state.feasibilityByGoalId,
          [goalId]: report,
        },
      }));
      return report;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message });
      throw error;
    }
  },

  setActiveGoal: (goalId) => set({ activeGoalId: goalId }),

  getGoalsForSource: (sourceKind, sourceId) => {
    return get().goals.filter((goal) =>
      goal.sources.some(
        (s) => s.sourceKind === sourceKind && s.sourceId === sourceId
      )
    );
  },

  getActiveGoals: () => get().goals.filter((g) => g.status === "active"),
  getPausedGoals: () => get().goals.filter((g) => g.status === "paused"),
  getArchivedGoals: () => get().goals.filter((g) => g.status === "archived"),

  getProgressSummary: (goalId) => {
    const goal = get().goals.find((g) => g.id === goalId);
    if (!goal) return null;
    const feasibility = get().feasibilityByGoalId[goalId];
    const completedMilestoneCount = goal.milestones.filter(
      (m) => m.status === "completed"
    ).length;

    return {
      goalId: goal.id,
      progressRatio: feasibility?.progressRatio ?? 0,
      priorMasteredConceptCount: feasibility?.priorMasteredConceptCount ?? 0,
      totalConceptCount: feasibility?.totalConceptCount ?? 0,
      completedMilestoneCount,
      totalMilestoneCount: goal.milestones.length,
      sourceCount: goal.sources.length,
      feasibilityStatus:
        feasibility?.status ?? (goal.targetDate ? "insufficient_data" : "unbounded"),
      remainingMinutes: feasibility?.remainingMinutes ?? 0,
      daysRemaining: feasibility?.daysRemaining ?? null,
    };
  },

  openWizard: (initialDraft = {}) =>
    set({
      wizard: {
        isOpen: true,
        step: "intent",
        draft: { ...initialDraft },
      },
    }),

  setWizardStep: (step) =>
    set((state) => ({
      wizard: { ...state.wizard, step },
    })),

  updateWizardDraft: (patch) =>
    set((state) => ({
      wizard: {
        ...state.wizard,
        draft: { ...state.wizard.draft, ...patch },
      },
    })),

  closeWizard: () => set({ wizard: { ...INITIAL_WIZARD_STATE } }),

  submitWizard: async () => {
    const { draft } = get().wizard;
    if (!draft.title || !draft.title.trim()) {
      throw new Error("Learning goal title is required.");
    }
    const created = await get().createGoal({
      ...draft,
      title: draft.title,
    });
    set({ wizard: { ...INITIAL_WIZARD_STATE } });
    return created;
  },

  reset: () =>
    set({
      goals: [],
      activeGoalId: null,
      feasibilityByGoalId: {},
      isLoading: false,
      error: null,
      wizard: { ...INITIAL_WIZARD_STATE },
    }),
}));
