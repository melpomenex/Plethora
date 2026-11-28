/**
 * Learning Goals API client.
 *
 * Wraps Tauri backend commands when running in the native app and provides a
 * clean in-memory fallback when `!isTauri()` (browser/PWA/unit tests) that
 * enforces zero-duplication source links, the Smart Feed exploration-candidate
 * invariant, and non-destructive goal deletion.
 */

import { invokeCommand, isTauri } from "../lib/tauri";
import {
  assertValidGoalSourceLink,
  evaluateGoalFeasibility,
  getDefaultGoalPolicy,
  type EvaluateGoalFeasibilityInput,
} from "../lib/learning-goals/feasibility";
import type {
  CreateLearningGoalInput,
  EvolveLearningGoalInput,
  GoalFeasibilityReport,
  GoalSourceKind,
  GoalSourceRole,
  LearningGoal,
  LearningGoalKind,
  LearningGoalMilestone,
  LearningGoalMilestoneStatus,
  LearningGoalSource,
  LearningGoalStatus,
  UpdateLearningGoalInput,
} from "../types/learningGoal";

export interface ListLearningGoalsFilter {
  status?: LearningGoalStatus | LearningGoalStatus[];
  kind?: LearningGoalKind;
}

export interface LinkGoalSourceInput {
  goalId: string;
  sourceKind: GoalSourceKind;
  sourceId: string;
  sourceRole?: GoalSourceRole;
  weight?: number;
  label?: string;
  isAiExcluded?: boolean;
}

export interface UpsertGoalMilestoneInput {
  id?: string;
  title: string;
  targetDate?: string | null;
  status?: LearningGoalMilestoneStatus;
  linkedNodeId?: string | null;
  sortOrder?: number;
}

// ---------------------------------------------------------------------------
// In-memory browser/test fallback state (zero-duplication, non-destructive)
// ---------------------------------------------------------------------------

let fallbackSequence = 0;
const fallbackGoals = new Map<string, LearningGoal>();

function nextId(prefix: string): string {
  fallbackSequence += 1;
  return `${prefix}-${Date.now()}-${fallbackSequence}`;
}

function cloneGoal(goal: LearningGoal): LearningGoal {
  return {
    ...goal,
    targetDimensions: [...goal.targetDimensions],
    policy: { ...goal.policy },
    sources: goal.sources.map((s) => ({ ...s })),
    milestones: goal.milestones.map((m) => ({ ...m })),
  };
}

/**
 * Resets the in-memory browser fallback store. Intended for unit tests.
 */
export function resetBrowserLearningGoalsState(): void {
  fallbackGoals.clear();
  fallbackSequence = 0;
}

function resolveDefaultSourceRole(sourceKind: GoalSourceKind): GoalSourceRole {
  return sourceKind === "smart_feed" ? "exploration_candidate" : "primary";
}

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

export async function createLearningGoal(
  input: CreateLearningGoalInput
): Promise<LearningGoal> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Learning goal title cannot be empty.");
  }

  const kind: LearningGoalKind = input.kind ?? "exploration";
  const defaultPolicy = getDefaultGoalPolicy(kind);

  // Validate any initial sources upfront in both Tauri and browser modes.
  const initialSources = (input.initialSources ?? []).map((src) => {
    const role = src.sourceRole ?? resolveDefaultSourceRole(src.sourceKind);
    assertValidGoalSourceLink(src.sourceKind, role);
    return { ...src, sourceRole: role };
  });

  if (isTauri()) {
    return await invokeCommand<LearningGoal>("create_learning_goal", {
      input: {
        ...input,
        title,
        kind,
        initialSources,
      },
    });
  }

  const now = new Date().toISOString();
  const id = nextId("goal");

  const sources: LearningGoalSource[] = [];
  const seenKeys = new Set<string>();
  for (const src of initialSources) {
    const key = `${src.sourceKind}:${src.sourceId}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    sources.push({
      id: nextId("gsrc"),
      goalId: id,
      sourceKind: src.sourceKind,
      sourceId: src.sourceId,
      sourceRole: src.sourceRole,
      weight: src.weight ?? 1.0,
      addedAt: now,
      label: src.label,
      isAiExcluded: src.isAiExcluded,
    });
  }

  const goal: LearningGoal = {
    id,
    title,
    description: input.description ?? null,
    kind,
    status: "active",
    priority: input.priority ?? 50,
    studyPlanId: input.studyPlanId ?? null,
    languageCode: input.languageCode ?? null,
    targetDate: input.targetDate ?? null,
    dailyMinutesBudget:
      input.dailyMinutesBudget !== undefined
        ? input.dailyMinutesBudget
        : defaultPolicy.defaultDailyMinutesBudget,
    targetDimensions: input.targetDimensions?.length
      ? [...input.targetDimensions]
      : [...defaultPolicy.defaultDimensions],
    targetMasteryThreshold:
      input.targetMasteryThreshold ?? defaultPolicy.defaultMasteryThreshold,
    policy: { ...defaultPolicy, ...(input.policy ?? {}) },
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    sources,
    milestones: [],
  };

  fallbackGoals.set(id, goal);
  return cloneGoal(goal);
}

export async function listLearningGoals(
  filter?: ListLearningGoalsFilter
): Promise<LearningGoal[]> {
  if (isTauri()) {
    return await invokeCommand<LearningGoal[]>("list_learning_goals", {
      filter: filter ?? null,
    });
  }

  const statuses = filter?.status
    ? Array.isArray(filter.status)
      ? filter.status
      : [filter.status]
    : null;

  return Array.from(fallbackGoals.values())
    .filter((goal) => {
      if (statuses && !statuses.includes(goal.status)) return false;
      if (filter?.kind && goal.kind !== filter.kind) return false;
      return true;
    })
    .sort((a, b) => b.priority - a.priority || b.updatedAt.localeCompare(a.updatedAt))
    .map(cloneGoal);
}

export async function getLearningGoal(
  goalId: string
): Promise<LearningGoal | null> {
  if (isTauri()) {
    return await invokeCommand<LearningGoal | null>("get_learning_goal_detail", {
      goalId,
    });
  }

  const goal = fallbackGoals.get(goalId);
  return goal ? cloneGoal(goal) : null;
}

export async function updateLearningGoal(
  goalId: string,
  patch: UpdateLearningGoalInput
): Promise<LearningGoal> {
  if (isTauri()) {
    return await invokeCommand<LearningGoal>("update_learning_goal", {
      goalId,
      patch,
    });
  }

  const existing = fallbackGoals.get(goalId);
  if (!existing) {
    throw new Error(`Learning goal "${goalId}" not found.`);
  }

  const now = new Date().toISOString();
  const nextStatus = patch.status ?? existing.status;
  const updated: LearningGoal = {
    ...existing,
    title: patch.title !== undefined ? patch.title.trim() || existing.title : existing.title,
    description:
      patch.description !== undefined ? patch.description : existing.description,
    priority: patch.priority !== undefined ? patch.priority : existing.priority,
    languageCode:
      patch.languageCode !== undefined ? patch.languageCode : existing.languageCode,
    targetDate:
      patch.targetDate !== undefined ? patch.targetDate : existing.targetDate,
    dailyMinutesBudget:
      patch.dailyMinutesBudget !== undefined
        ? patch.dailyMinutesBudget
        : existing.dailyMinutesBudget,
    targetDimensions:
      patch.targetDimensions !== undefined
        ? [...patch.targetDimensions]
        : existing.targetDimensions,
    targetMasteryThreshold:
      patch.targetMasteryThreshold !== undefined
        ? patch.targetMasteryThreshold
        : existing.targetMasteryThreshold,
    policy:
      patch.policy !== undefined
        ? { ...existing.policy, ...patch.policy }
        : existing.policy,
    status: nextStatus,
    completedAt:
      nextStatus === "completed"
        ? existing.completedAt ?? now
        : nextStatus === "active"
          ? null
          : existing.completedAt,
    updatedAt: now,
  };

  fallbackGoals.set(goalId, updated);
  return cloneGoal(updated);
}

export async function evolveLearningGoal(
  goalId: string,
  evolution: EvolveLearningGoalInput
): Promise<LearningGoal> {
  if (isTauri()) {
    return await invokeCommand<LearningGoal>("evolve_learning_goal", {
      goalId,
      evolution,
    });
  }

  const existing = fallbackGoals.get(goalId);
  if (!existing) {
    throw new Error(`Learning goal "${goalId}" not found.`);
  }

  const nextKind = evolution.kind ?? existing.kind;
  const nextKindPolicy = getDefaultGoalPolicy(nextKind);
  const now = new Date().toISOString();

  // Evolves in-place: preserves id, existing sources, and existing milestones.
  const evolved: LearningGoal = {
    ...existing,
    id: existing.id,
    kind: nextKind,
    studyPlanId:
      evolution.studyPlanId !== undefined
        ? evolution.studyPlanId
        : existing.studyPlanId,
    targetDate:
      evolution.targetDate !== undefined ? evolution.targetDate : existing.targetDate,
    dailyMinutesBudget:
      evolution.dailyMinutesBudget !== undefined
        ? evolution.dailyMinutesBudget
        : existing.dailyMinutesBudget ?? nextKindPolicy.defaultDailyMinutesBudget,
    targetDimensions:
      evolution.targetDimensions !== undefined
        ? [...evolution.targetDimensions]
        : existing.targetDimensions,
    targetMasteryThreshold:
      evolution.targetMasteryThreshold !== undefined
        ? evolution.targetMasteryThreshold
        : existing.targetMasteryThreshold,
    languageCode:
      evolution.languageCode !== undefined
        ? evolution.languageCode
        : existing.languageCode,
    policy: {
      ...existing.policy,
      ...nextKindPolicy,
      ...(evolution.policy ?? {}),
    },
    sources: existing.sources,
    milestones: existing.milestones,
    updatedAt: now,
  };

  fallbackGoals.set(goalId, evolved);
  return cloneGoal(evolved);
}

export async function pauseLearningGoal(goalId: string): Promise<LearningGoal> {
  return updateLearningGoal(goalId, { status: "paused" });
}

export async function resumeLearningGoal(goalId: string): Promise<LearningGoal> {
  return updateLearningGoal(goalId, { status: "active" });
}

export async function archiveLearningGoal(goalId: string): Promise<LearningGoal> {
  return updateLearningGoal(goalId, { status: "archived" });
}

export async function deleteLearningGoal(goalId: string): Promise<void> {
  if (isTauri()) {
    await invokeCommand<void>("delete_learning_goal", { goalId });
    return;
  }

  // Non-destructive deletion: removes only this goal and its link/milestone rows.
  // Underlying documents, cards, concepts, Smart Feeds, Study Plans, and other
  // goals referencing those same sources remain completely untouched.
  fallbackGoals.delete(goalId);
}

export async function linkGoalSource(
  input: LinkGoalSourceInput
): Promise<LearningGoalSource> {
  const sourceRole =
    input.sourceRole ?? resolveDefaultSourceRole(input.sourceKind);
  assertValidGoalSourceLink(input.sourceKind, sourceRole);

  if (isTauri()) {
    return await invokeCommand<LearningGoalSource>("link_learning_goal_source", {
      input: {
        ...input,
        sourceRole,
      },
    });
  }

  const goal = fallbackGoals.get(input.goalId);
  if (!goal) {
    throw new Error(`Learning goal "${input.goalId}" not found.`);
  }

  const now = new Date().toISOString();
  // Enforce UNIQUE(goal_id, source_kind, source_id) without duplicating sources.
  const existingIdx = goal.sources.findIndex(
    (s) => s.sourceKind === input.sourceKind && s.sourceId === input.sourceId
  );

  if (existingIdx >= 0) {
    const updatedSource: LearningGoalSource = {
      ...goal.sources[existingIdx],
      sourceRole,
      weight: input.weight ?? goal.sources[existingIdx].weight,
      label: input.label ?? goal.sources[existingIdx].label,
      isAiExcluded: input.isAiExcluded ?? goal.sources[existingIdx].isAiExcluded,
    };
    goal.sources[existingIdx] = updatedSource;
    goal.updatedAt = now;
    return { ...updatedSource };
  }

  const createdSource: LearningGoalSource = {
    id: nextId("gsrc"),
    goalId: goal.id,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    sourceRole,
    weight: input.weight ?? 1.0,
    addedAt: now,
    label: input.label,
    isAiExcluded: input.isAiExcluded,
  };
  goal.sources.push(createdSource);
  goal.updatedAt = now;
  return { ...createdSource };
}

export async function unlinkGoalSource(
  goalId: string,
  sourceKind: GoalSourceKind,
  sourceId: string
): Promise<void> {
  if (isTauri()) {
    await invokeCommand<void>("unlink_learning_goal_source", {
      goalId,
      sourceKind,
      sourceId,
    });
    return;
  }

  const goal = fallbackGoals.get(goalId);
  if (!goal) return;

  goal.sources = goal.sources.filter(
    (s) => !(s.sourceKind === sourceKind && s.sourceId === sourceId)
  );
  goal.updatedAt = new Date().toISOString();
}

export async function upsertGoalMilestone(
  goalId: string,
  milestone: UpsertGoalMilestoneInput
): Promise<LearningGoalMilestone> {
  if (isTauri()) {
    return await invokeCommand<LearningGoalMilestone>(
      "upsert_learning_goal_milestone",
      { goalId, milestone }
    );
  }

  const goal = fallbackGoals.get(goalId);
  if (!goal) {
    throw new Error(`Learning goal "${goalId}" not found.`);
  }

  const now = new Date().toISOString();
  const status: LearningGoalMilestoneStatus = milestone.status ?? "pending";

  if (milestone.id) {
    const idx = goal.milestones.findIndex((m) => m.id === milestone.id);
    if (idx >= 0) {
      const prev = goal.milestones[idx];
      const updated: LearningGoalMilestone = {
        ...prev,
        title: milestone.title.trim() || prev.title,
        targetDate:
          milestone.targetDate !== undefined ? milestone.targetDate : prev.targetDate,
        status,
        linkedNodeId:
          milestone.linkedNodeId !== undefined
            ? milestone.linkedNodeId
            : prev.linkedNodeId,
        sortOrder:
          milestone.sortOrder !== undefined ? milestone.sortOrder : prev.sortOrder,
        completedAt:
          status === "completed"
            ? prev.completedAt ?? now
            : status === "pending"
              ? null
              : prev.completedAt,
        updatedAt: now,
      };
      goal.milestones[idx] = updated;
      goal.updatedAt = now;
      return { ...updated };
    }
  }

  const created: LearningGoalMilestone = {
    id: milestone.id ?? nextId("gmile"),
    goalId: goal.id,
    title: milestone.title.trim(),
    targetDate: milestone.targetDate ?? null,
    status,
    linkedNodeId: milestone.linkedNodeId ?? null,
    sortOrder: milestone.sortOrder ?? goal.milestones.length,
    completedAt: status === "completed" ? now : null,
    createdAt: now,
    updatedAt: now,
  };
  goal.milestones.push(created);
  goal.milestones.sort((a, b) => a.sortOrder - b.sortOrder);
  goal.updatedAt = now;
  return { ...created };
}

export async function evaluateLearningGoalFeasibility(
  goalId: string,
  context?: Omit<EvaluateGoalFeasibilityInput, "goal">
): Promise<GoalFeasibilityReport> {
  if (isTauri()) {
    return await invokeCommand<GoalFeasibilityReport>(
      "get_learning_goal_feasibility",
      { goalId, context: context ?? null }
    );
  }

  const goal = fallbackGoals.get(goalId);
  if (!goal) {
    throw new Error(`Learning goal "${goalId}" not found.`);
  }

  return evaluateGoalFeasibility({
    goal,
    sources: context?.sources ?? goal.sources,
    conceptStates: context?.conceptStates,
    uncompletedReadingMinutes: context?.uncompletedReadingMinutes,
    projectedDueReviewMinutes: context?.projectedDueReviewMinutes,
    nowIso: context?.nowIso,
  });
}

export async function listGoalsForSource(
  sourceKind: GoalSourceKind,
  sourceId: string
): Promise<LearningGoal[]> {
  if (isTauri()) {
    return await invokeCommand<LearningGoal[]>("list_goals_for_source", {
      sourceKind,
      sourceId,
    });
  }

  return Array.from(fallbackGoals.values())
    .filter((goal) =>
      goal.sources.some(
        (s) => s.sourceKind === sourceKind && s.sourceId === sourceId
      )
    )
    .map(cloneGoal);
}
