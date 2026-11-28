/**
 * Unified Learning Session Runtime.
 *
 * Pure + event-wired session orchestration engine providing:
 * - Heterogeneous session lifecycle (create, start, complete, skip, postpone,
 *   reorder, replace, budget adjustment, pause, resume, complete, summarize).
 * - Multi-goal duplicate-work prevention via canonical `dedupeKey` collapsing.
 * - Cross-surface completion reconciliation via `learningEventBus`.
 * - Deterministic idempotent completion emission so duplicate completions never
 *   double-count reviews, learner evidence, or active time.
 * - Strict exam-mode isolation blocking hints, answer reveals, and coaching.
 */

import type {
  CrossSurfaceCompletionNotice,
  LearningActivity,
  LearningActivityStatus,
  LearningActivityType,
  LearningSession,
  LearningSessionMode,
  LearningSessionSummary,
  LearningSourceReference,
  RuntimeCapabilities,
} from "../../types/learningActivity";
import type { LearningEntityKind, LearningEvent, LearningEventType, LearningSurface } from "../../types/learningEvent";
import { learningEventBus } from "../learning-events/learningEventBus";
import { learningActivityRegistry, type LearningActivityRegistry } from "./activityRegistry";

export type ExamAction =
  | "show_hint"
  | "reveal_answer"
  | "open_tutor"
  | "coaching_intervention"
  | "peek_source"
  | "switch_to_study_mode"
  | "jump_to_other_activity"
  | "submit_attempt"
  | "pause_session"
  | "save_checkpoint"
  | "navigate_exam_question";

const EXAM_BLOCKED_ACTIONS = new Set<ExamAction>([
  "show_hint",
  "reveal_answer",
  "open_tutor",
  "coaching_intervention",
  "peek_source",
  "switch_to_study_mode",
  "jump_to_other_activity",
]);

export class ExamIsolationViolationError extends Error {
  readonly code = "exam_isolation_violation";
  readonly action: ExamAction;

  constructor(action: ExamAction, message?: string) {
    super(
      message ??
        `Exam-mode isolation blocks action "${action}" while an isolated exam session is active`,
    );
    this.name = "ExamIsolationViolationError";
    this.action = action;
  }
}

export function isSessionExamIsolated(session: LearningSession): boolean {
  if (session.mode === "exam_isolated") {
    return true;
  }
  return session.activities.some(
    (activity) => activity.status === "in_progress" && activity.examIsolated,
  );
}

/**
 * Enforces strict exam-mode isolation. Throws `ExamIsolationViolationError`
 * when hints, answer reveals, tutor/coaching interventions, or source-peeking
 * are attempted during an exam-isolated session or active exam activity.
 */
export function assertExamIsolationAllows(
  session: LearningSession,
  action: ExamAction,
): void {
  if (!isSessionExamIsolated(session)) {
    return;
  }
  if (EXAM_BLOCKED_ACTIONS.has(action)) {
    throw new ExamIsolationViolationError(action);
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((v) => v.length > 0)));
}

function mergeSourceReferences(
  first: readonly LearningSourceReference[],
  second: readonly LearningSourceReference[],
): LearningSourceReference[] {
  const seen = new Set<string>();
  const merged: LearningSourceReference[] = [];
  for (const ref of [...first, ...second]) {
    const key = `${ref.entityKind}:${ref.entityId}:${ref.documentId ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push({ ...ref });
    }
  }
  return merged;
}

function mergePrerequisites(
  first: LearningActivity["prerequisiteRequirements"],
  second: LearningActivity["prerequisiteRequirements"],
): LearningActivity["prerequisiteRequirements"] {
  const byId = new Map<string, LearningActivity["prerequisiteRequirements"][number]>();
  for (const prereq of [...first, ...second]) {
    const existing = byId.get(prereq.id);
    if (!existing) {
      byId.set(prereq.id, { ...prereq });
    } else {
      byId.set(prereq.id, {
        ...existing,
        satisfied: existing.satisfied && prereq.satisfied,
      });
    }
  }
  return Array.from(byId.values());
}

/**
 * Collapses duplicate activities sharing the same `dedupeKey` into a single
 * activity preserving the highest-priority descriptor while merging all
 * `goalReferences`, `conceptReferences`, `sourceReferences`, and privacy flags.
 */
export function deduplicateActivities(
  activities: readonly LearningActivity[],
): LearningActivity[] {
  const order: string[] = [];
  const mergedByKey = new Map<string, LearningActivity>();

  for (const candidate of activities) {
    const key = candidate.dedupeKey;
    const existing = mergedByKey.get(key);
    if (!existing) {
      order.push(key);
      mergedByKey.set(key, {
        ...candidate,
        sourceReferences: mergeSourceReferences(candidate.sourceReferences, []),
        conceptReferences: uniqueStrings(candidate.conceptReferences),
        goalReferences: uniqueStrings(candidate.goalReferences),
        prerequisiteRequirements: mergePrerequisites(candidate.prerequisiteRequirements, []),
        capabilityRequirements: {
          required: Array.from(new Set(candidate.capabilityRequirements.required)),
          optional: Array.from(new Set(candidate.capabilityRequirements.optional)),
        },
      });
      continue;
    }

    const candidateHigherPriority =
      candidate.priorityMetadata.score > existing.priorityMetadata.score;
    const primary = candidateHigherPriority ? candidate : existing;
    const secondary = candidateHigherPriority ? existing : candidate;

    mergedByKey.set(key, {
      ...primary,
      sourceReferences: mergeSourceReferences(
        primary.sourceReferences,
        secondary.sourceReferences,
      ),
      conceptReferences: uniqueStrings([
        ...primary.conceptReferences,
        ...secondary.conceptReferences,
      ]),
      goalReferences: uniqueStrings([
        ...primary.goalReferences,
        ...secondary.goalReferences,
      ]),
      prerequisiteRequirements: mergePrerequisites(
        primary.prerequisiteRequirements,
        secondary.prerequisiteRequirements,
      ),
      capabilityRequirements: {
        required: Array.from(
          new Set([
            ...primary.capabilityRequirements.required,
            ...secondary.capabilityRequirements.required,
          ]),
        ),
        optional: Array.from(
          new Set([
            ...primary.capabilityRequirements.optional,
            ...secondary.capabilityRequirements.optional,
          ]),
        ),
      },
      isLocalOnly: primary.isLocalOnly || secondary.isLocalOnly,
      isAiExcluded: primary.isAiExcluded || secondary.isAiExcluded,
      examIsolated: primary.examIsolated || secondary.examIsolated,
    });
  }

  return order.map((key) => mergedByKey.get(key)!);
}

function clampTimeBudget(minutes: number | null | undefined): number | null {
  if (minutes === null || minutes === undefined) {
    return null;
  }
  return Math.max(5, Math.min(120, Math.round(minutes)));
}

function isActionableStatus(status: LearningActivityStatus): boolean {
  return status === "pending" || status === "in_progress" || status === "degraded";
}

function findNextActionableIndex(
  activities: readonly LearningActivity[],
  startFrom = 0,
): number {
  if (activities.length === 0) return 0;
  for (let i = Math.max(0, startFrom); i < activities.length; i += 1) {
    if (isActionableStatus(activities[i].status)) {
      return i;
    }
  }
  for (let i = 0; i < Math.min(startFrom, activities.length); i += 1) {
    if (isActionableStatus(activities[i].status)) {
      return i;
    }
  }
  return activities.length - 1;
}

function generateSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `ls_${crypto.randomUUID()}`;
  }
  return `ls_${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
}

function collectSessionGoals(
  activities: readonly LearningActivity[],
  explicitGoals?: readonly string[],
): string[] {
  const goals = [...(explicitGoals ?? [])];
  for (const activity of activities) {
    goals.push(...activity.goalReferences);
  }
  return uniqueStrings(goals);
}

function computeSessionPrivacy(activities: readonly LearningActivity[]): {
  isLocalOnly: boolean;
  isAiExcluded: boolean;
} {
  return {
    isLocalOnly: activities.some((a) => a.isLocalOnly),
    isAiExcluded: activities.some((a) => a.isAiExcluded),
  };
}

export interface CreateLearningSessionOptions {
  id?: string;
  title?: string;
  profileId?: string;
  mode?: LearningSessionMode;
  goalReferences?: string[];
  timeBudgetMinutes?: number | null;
  activities: LearningActivity[];
  runtimeCapabilities?: RuntimeCapabilities;
  registry?: LearningActivityRegistry;
  nowIso?: string;
  emitEvent?: boolean;
}

export function createLearningSession(
  options: CreateLearningSessionOptions,
): LearningSession {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const registry = options.registry ?? learningActivityRegistry;
  let deduped = deduplicateActivities(options.activities);

  if (options.runtimeCapabilities) {
    deduped = deduped.map((activity) => {
      if (activity.status !== "pending") return activity;
      const negotiation = registry.negotiateCapabilities(
        activity.activityType,
        options.runtimeCapabilities!,
        {
          isLocalOnly: activity.isLocalOnly,
          isAiExcluded: activity.isAiExcluded,
        },
      );
      if (negotiation.status === "degraded") {
        return {
          ...activity,
          status: "degraded",
          degradedReason: negotiation.fallbackReason,
        };
      }
      return activity;
    });
  }

  const privacy = computeSessionPrivacy(deduped);
  const mode: LearningSessionMode =
    options.mode ??
    (deduped.length > 0 && deduped.every((a) => a.examIsolated)
      ? "exam_isolated"
      : "learning");

  const session: LearningSession = {
    id: options.id ?? generateSessionId(),
    title: options.title ?? "Learning Session",
    mode,
    status: "active",
    profileId: options.profileId ?? "balanced",
    goalReferences: collectSessionGoals(deduped, options.goalReferences),
    timeBudgetMinutes: clampTimeBudget(options.timeBudgetMinutes),
    elapsedActiveSeconds: 0,
    currentActivityIndex: findNextActionableIndex(deduped, 0),
    activities: deduped,
    isLocalOnly: privacy.isLocalOnly,
    isAiExcluded: privacy.isAiExcluded,
    createdAt: nowIso,
    updatedAt: nowIso,
    pausedAt: null,
    completedAt: null,
    crossSurfaceNotices: [],
  };

  if (options.emitEvent !== false) {
    learningEventBus.emit({
      idempotencyKey: `learning_session:${session.id}:started`,
      eventType: "session_started",
      surface: "unified_session",
      sessionId: session.id,
      goalId: session.goalReferences[0] ?? null,
      entityKind: "learning_session",
      entityId: session.id,
      isLocalOnly: session.isLocalOnly,
      isAiExcluded: session.isAiExcluded,
      payload: {
        profileId: session.profileId,
        mode: session.mode,
        activityCount: session.activities.length,
      },
      occurredAt: nowIso,
    });
  }

  return session;
}

export interface StartActivityOptions {
  nowIso?: string;
}

export function startActivity(
  session: LearningSession,
  activityId: string,
  options?: StartActivityOptions,
): LearningSession {
  const targetIndex = session.activities.findIndex((a) => a.id === activityId);
  if (targetIndex === -1) {
    throw new Error(`Activity "${activityId}" not found in session "${session.id}"`);
  }

  const activeExamActivity = session.activities.find(
    (a) => a.status === "in_progress" && a.examIsolated && a.id !== activityId,
  );
  if (activeExamActivity) {
    assertExamIsolationAllows(session, "jump_to_other_activity");
  }

  const nowIso = options?.nowIso ?? new Date().toISOString();
  const target = session.activities[targetIndex];
  const activities = session.activities.map((activity, idx) => {
    if (idx === targetIndex) {
      return {
        ...activity,
        status: "in_progress" as const,
        startedAt: activity.startedAt ?? nowIso,
      };
    }
    if (activity.status === "in_progress") {
      return {
        ...activity,
        status: activity.degradedReason ? ("degraded" as const) : ("pending" as const),
      };
    }
    return activity;
  });

  return {
    ...session,
    status: "active",
    mode: target.examIsolated ? "exam_isolated" : session.mode,
    pausedAt: null,
    currentActivityIndex: targetIndex,
    activities,
    updatedAt: nowIso,
  };
}

export interface CompleteActivityOptions {
  activeSeconds?: number;
  payload?: Record<string, unknown>;
  surface?: LearningSurface;
  nowIso?: string;
  registry?: LearningActivityRegistry;
  emitEvent?: boolean;
}

export interface CompleteActivityResult {
  session: LearningSession;
  eventId: string | null;
  emitted: boolean;
}

export function buildActivityCompletionIdempotencyKey(
  sessionId: string,
  activity: Pick<LearningActivity, "id" | "dedupeKey">,
): string {
  return `learning_session:${sessionId}:activity:${activity.id}:${activity.dedupeKey}:completed`;
}

export function completeActivity(
  session: LearningSession,
  activityId: string,
  options?: CompleteActivityOptions,
): CompleteActivityResult {
  const targetIndex = session.activities.findIndex((a) => a.id === activityId);
  if (targetIndex === -1) {
    throw new Error(`Activity "${activityId}" not found in session "${session.id}"`);
  }

  const target = session.activities[targetIndex];
  // Idempotent guard: already completed activity must never double-count.
  if (target.status === "completed") {
    return {
      session,
      eventId: target.completionEventId ?? null,
      emitted: false,
    };
  }

  const nowIso = options?.nowIso ?? new Date().toISOString();
  const activeSeconds = Math.max(0, Math.round(options?.activeSeconds ?? 0));
  const registry = options?.registry ?? learningActivityRegistry;
  const def = registry.get(target.activityType);
  const surface: LearningSurface = options?.surface ?? "unified_session";

  const eventType: LearningEventType =
    target.completionPolicy.canonicalEventType ??
    def?.canonicalEventType ??
    "practice_attempted";

  const primaryRef = target.sourceReferences[0];
  const entityKind: LearningEntityKind =
    primaryRef?.entityKind ?? def?.defaultEntityKind ?? "learning_session";
  const entityId = primaryRef?.entityId ?? target.id;
  const documentId = primaryRef?.documentId ?? null;

  let eventId: string | null = null;
  let emitted = false;

  if (options?.emitEvent !== false) {
    const idempotencyKey = buildActivityCompletionIdempotencyKey(session.id, target);
    const result = learningEventBus.emit({
      idempotencyKey,
      eventType,
      surface,
      sessionId: session.id,
      goalId: target.goalReferences[0] ?? session.goalReferences[0] ?? null,
      entityKind,
      entityId,
      documentId,
      isLocalOnly: target.isLocalOnly || session.isLocalOnly,
      isAiExcluded: target.isAiExcluded || session.isAiExcluded,
      payload: {
        activityId: target.id,
        activityType: target.activityType,
        dedupeKey: target.dedupeKey,
        goalReferences: target.goalReferences,
        conceptReferences: target.conceptReferences,
        activeSeconds,
        ...(options?.payload ?? {}),
      },
      occurredAt: nowIso,
    });
    eventId = result.event.id;
    emitted = result.inserted;
  }

  const activities = session.activities.map((activity, idx) =>
    idx === targetIndex
      ? {
          ...activity,
          status: "completed" as const,
          completedAt: nowIso,
          activeSeconds: (activity.activeSeconds ?? 0) + activeSeconds,
          completionEventId: eventId ?? activity.completionEventId ?? null,
          completedViaSurface: surface,
        }
      : activity,
  );

  const hasRemainingInProgressExam = activities.some(
    (a) => a.status === "in_progress" && a.examIsolated,
  );
  const hasAnyRemainingExam = activities.some(
    (a) => isActionableStatus(a.status) && a.examIsolated,
  );
  const nextMode: LearningSessionMode =
    target.examIsolated && !hasRemainingInProgressExam && !hasAnyRemainingExam
      ? "learning"
      : session.mode;

  const updatedSession: LearningSession = {
    ...session,
    mode: nextMode,
    elapsedActiveSeconds: session.elapsedActiveSeconds + activeSeconds,
    currentActivityIndex: findNextActionableIndex(activities, targetIndex + 1),
    activities,
    updatedAt: nowIso,
  };

  return {
    session: updatedSession,
    eventId,
    emitted,
  };
}

export function skipActivity(
  session: LearningSession,
  activityId: string,
  reason?: string,
  nowIso: string = new Date().toISOString(),
): LearningSession {
  const targetIndex = session.activities.findIndex((a) => a.id === activityId);
  if (targetIndex === -1) {
    throw new Error(`Activity "${activityId}" not found in session "${session.id}"`);
  }

  const target = session.activities[targetIndex];
  if (target.status === "in_progress" && target.examIsolated) {
    assertExamIsolationAllows(session, "jump_to_other_activity");
  }

  const activities = session.activities.map((activity, idx) =>
    idx === targetIndex
      ? {
          ...activity,
          status: "skipped" as const,
          skipOrPostponeReason: reason ?? null,
        }
      : activity,
  );

  return {
    ...session,
    currentActivityIndex: findNextActionableIndex(activities, targetIndex + 1),
    activities,
    updatedAt: nowIso,
  };
}

export function postponeActivity(
  session: LearningSession,
  activityId: string,
  reason?: string,
  nowIso: string = new Date().toISOString(),
): LearningSession {
  const targetIndex = session.activities.findIndex((a) => a.id === activityId);
  if (targetIndex === -1) {
    throw new Error(`Activity "${activityId}" not found in session "${session.id}"`);
  }

  const target = session.activities[targetIndex];
  if (target.status === "in_progress" && target.examIsolated) {
    assertExamIsolationAllows(session, "jump_to_other_activity");
  }

  const activities = session.activities.map((activity, idx) =>
    idx === targetIndex
      ? {
          ...activity,
          status: "postponed" as const,
          skipOrPostponeReason: reason ?? null,
        }
      : activity,
  );

  return {
    ...session,
    currentActivityIndex: findNextActionableIndex(activities, targetIndex + 1),
    activities,
    updatedAt: nowIso,
  };
}

export function revisitActivity(
  session: LearningSession,
  activityId: string,
  nowIso: string = new Date().toISOString(),
): LearningSession {
  const targetIndex = session.activities.findIndex((a) => a.id === activityId);
  if (targetIndex === -1) {
    throw new Error(`Activity "${activityId}" not found in session "${session.id}"`);
  }

  const activities = session.activities.map((activity, idx) =>
    idx === targetIndex
      ? {
          ...activity,
          status: "pending" as const,
          skipOrPostponeReason: null,
        }
      : activity,
  );

  return {
    ...session,
    currentActivityIndex: targetIndex,
    activities,
    updatedAt: nowIso,
  };
}

export function reorderActivities(
  session: LearningSession,
  orderedActivityIds: readonly string[],
  nowIso: string = new Date().toISOString(),
): LearningSession {
  const byId = new Map(session.activities.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const reordered: LearningActivity[] = [];

  for (const id of orderedActivityIds) {
    const item = byId.get(id);
    if (item && !seen.has(id)) {
      seen.add(id);
      reordered.push(item);
    }
  }

  for (const item of session.activities) {
    if (!seen.has(item.id)) {
      reordered.push(item);
    }
  }

  const currentActivityId = session.activities[session.currentActivityIndex]?.id;
  const nextIndex = currentActivityId
    ? Math.max(
        0,
        reordered.findIndex((a) => a.id === currentActivityId),
      )
    : findNextActionableIndex(reordered, 0);

  return {
    ...session,
    currentActivityIndex: nextIndex,
    activities: reordered,
    updatedAt: nowIso,
  };
}

export function replaceActivity(
  session: LearningSession,
  targetActivityId: string,
  replacement: LearningActivity,
  nowIso: string = new Date().toISOString(),
): LearningSession {
  const targetIndex = session.activities.findIndex((a) => a.id === targetActivityId);
  if (targetIndex === -1) {
    throw new Error(`Activity "${targetActivityId}" not found in session "${session.id}"`);
  }

  const replaced = session.activities.map((activity, idx) =>
    idx === targetIndex ? replacement : activity,
  );
  const deduped = deduplicateActivities(replaced);
  const privacy = computeSessionPrivacy(deduped);

  return {
    ...session,
    activities: deduped,
    goalReferences: collectSessionGoals(deduped, session.goalReferences),
    isLocalOnly: session.isLocalOnly || privacy.isLocalOnly,
    isAiExcluded: session.isAiExcluded || privacy.isAiExcluded,
    currentActivityIndex: Math.min(session.currentActivityIndex, Math.max(0, deduped.length - 1)),
    updatedAt: nowIso,
  };
}

export function adjustSessionBudget(
  session: LearningSession,
  timeBudgetMinutes: number | null,
  nowIso: string = new Date().toISOString(),
): LearningSession {
  return {
    ...session,
    timeBudgetMinutes: clampTimeBudget(timeBudgetMinutes),
    updatedAt: nowIso,
  };
}

export interface PauseSessionOptions {
  checkpoint?: Record<string, unknown> | null;
  nowIso?: string;
  emitEvent?: boolean;
}

export function pauseSession(
  session: LearningSession,
  options?: PauseSessionOptions,
): LearningSession {
  assertExamIsolationAllows(session, "pause_session");
  const nowIso = options?.nowIso ?? new Date().toISOString();

  const activities =
    options?.checkpoint !== undefined
      ? session.activities.map((activity, idx) =>
          idx === session.currentActivityIndex
            ? { ...activity, resumeState: options.checkpoint ?? null }
            : activity,
        )
      : session.activities;

  const paused: LearningSession = {
    ...session,
    status: "paused",
    pausedAt: nowIso,
    activities,
    updatedAt: nowIso,
  };

  if (options?.emitEvent !== false) {
    learningEventBus.emit({
      idempotencyKey: `learning_session:${session.id}:paused:${nowIso}`,
      eventType: "session_paused",
      surface: "unified_session",
      sessionId: session.id,
      goalId: session.goalReferences[0] ?? null,
      entityKind: "learning_session",
      entityId: session.id,
      isLocalOnly: session.isLocalOnly,
      isAiExcluded: session.isAiExcluded,
      payload: {
        currentActivityIndex: paused.currentActivityIndex,
        elapsedActiveSeconds: paused.elapsedActiveSeconds,
      },
      occurredAt: nowIso,
    });
  }

  return paused;
}

export interface ResumeSessionOptions {
  nowIso?: string;
  emitEvent?: boolean;
}

export function resumeSession(
  session: LearningSession,
  options?: ResumeSessionOptions,
): LearningSession {
  if (session.status === "completed" || session.status === "abandoned") {
    return session;
  }

  const nowIso = options?.nowIso ?? new Date().toISOString();
  const nextIndex = findNextActionableIndex(session.activities, session.currentActivityIndex);

  const resumed: LearningSession = {
    ...session,
    status: "active",
    pausedAt: null,
    currentActivityIndex: nextIndex,
    updatedAt: nowIso,
  };

  if (options?.emitEvent !== false) {
    learningEventBus.emit({
      idempotencyKey: `learning_session:${session.id}:resumed:${nowIso}`,
      eventType: "session_resumed",
      surface: "unified_session",
      sessionId: session.id,
      goalId: session.goalReferences[0] ?? null,
      entityKind: "learning_session",
      entityId: session.id,
      isLocalOnly: session.isLocalOnly,
      isAiExcluded: session.isAiExcluded,
      payload: {
        currentActivityIndex: resumed.currentActivityIndex,
      },
      occurredAt: nowIso,
    });
  }

  return resumed;
}

export interface CompleteSessionOptions {
  nowIso?: string;
  emitEvent?: boolean;
}

export function completeSession(
  session: LearningSession,
  options?: CompleteSessionOptions,
): LearningSession {
  if (session.status === "completed") {
    return session;
  }

  const nowIso = options?.nowIso ?? new Date().toISOString();
  const completed: LearningSession = {
    ...session,
    status: "completed",
    pausedAt: null,
    completedAt: nowIso,
    updatedAt: nowIso,
  };

  if (options?.emitEvent !== false) {
    const summary = summarizeSession(completed);
    learningEventBus.emit({
      idempotencyKey: `learning_session:${session.id}:completed`,
      eventType: "session_completed",
      surface: "unified_session",
      sessionId: session.id,
      goalId: session.goalReferences[0] ?? null,
      entityKind: "learning_session",
      entityId: session.id,
      isLocalOnly: session.isLocalOnly,
      isAiExcluded: session.isAiExcluded,
      payload: {
        completedCount: summary.completedCount,
        skippedCount: summary.skippedCount,
        postponedCount: summary.postponedCount,
        elapsedActiveSeconds: summary.elapsedActiveSeconds,
      },
      occurredAt: nowIso,
    });
  }

  return completed;
}

export function summarizeSession(session: LearningSession): LearningSessionSummary {
  let completedCount = 0;
  let skippedCount = 0;
  let postponedCount = 0;
  let pendingCount = 0;
  let inProgressCount = 0;
  let degradedCount = 0;
  let completedViaExternalSurfaceCount = 0;
  let totalEstimatedMinutes = 0;
  let remainingEstimatedMinutes = 0;

  const conceptSet = new Set<string>();
  const completedByType: Partial<Record<LearningActivityType, number>> = {};

  for (const activity of session.activities) {
    totalEstimatedMinutes += activity.estimatedMinutes;
    for (const concept of activity.conceptReferences) {
      conceptSet.add(concept);
    }

    switch (activity.status) {
      case "completed":
        completedCount += 1;
        completedByType[activity.activityType] =
          (completedByType[activity.activityType] ?? 0) + 1;
        if (
          activity.completedViaSurface &&
          activity.completedViaSurface !== "unified_session"
        ) {
          completedViaExternalSurfaceCount += 1;
        }
        break;
      case "skipped":
        skippedCount += 1;
        break;
      case "postponed":
        postponedCount += 1;
        break;
      case "in_progress":
        inProgressCount += 1;
        remainingEstimatedMinutes += activity.estimatedMinutes;
        break;
      case "degraded":
        degradedCount += 1;
        remainingEstimatedMinutes += activity.estimatedMinutes;
        break;
      case "pending":
        pendingCount += 1;
        remainingEstimatedMinutes += activity.estimatedMinutes;
        break;
    }
  }

  const totalActivities = session.activities.length;
  const completionRate =
    totalActivities > 0 ? Number((completedCount / totalActivities).toFixed(4)) : 0;

  return {
    sessionId: session.id,
    title: session.title,
    status: session.status,
    mode: session.mode,
    totalActivities,
    completedCount,
    skippedCount,
    postponedCount,
    pendingCount,
    inProgressCount,
    degradedCount,
    completedViaExternalSurfaceCount,
    totalEstimatedMinutes,
    remainingEstimatedMinutes,
    elapsedActiveSeconds: session.elapsedActiveSeconds,
    timeBudgetMinutes: session.timeBudgetMinutes,
    completionRate,
    goalReferences: [...session.goalReferences],
    conceptReferences: Array.from(conceptSet),
    completedByType,
  };
}

const COMPLETION_EVENT_TYPES = new Set<LearningEventType>([
  "review_committed",
  "reading_completed",
  "extract_created",
  "guided_check_completed",
  "practice_attempted",
  "assessment_submitted",
  "assessment_graded",
  "remediation_completed",
]);

function eventMatchesActivity(
  event: LearningEvent,
  activity: LearningActivity,
): boolean {
  if (!COMPLETION_EVENT_TYPES.has(event.eventType)) {
    return false;
  }

  const payloadDedupeKey =
    typeof event.payload?.dedupeKey === "string" ? event.payload.dedupeKey : null;
  if (payloadDedupeKey && payloadDedupeKey === activity.dedupeKey) {
    return true;
  }

  return activity.sourceReferences.some(
    (ref) =>
      ref.entityKind === event.entityKind && ref.entityId === event.entityId,
  );
}

export interface ReconcileExternalEventResult {
  session: LearningSession;
  matchedActivityIds: string[];
}

/**
 * Reconciles a canonical `learningEventBus` completion event emitted from
 * another surface (Review, Scroll Mode, Queue, Reader, Exam) against an open
 * `LearningSession`, marking matching pending/in-progress/degraded activities
 * as `completed` with zero double-counted `activeSeconds`.
 */
export function reconcileExternalLearningEvent(
  session: LearningSession,
  event: LearningEvent,
): ReconcileExternalEventResult {
  if (session.status === "completed" || session.status === "abandoned") {
    return { session, matchedActivityIds: [] };
  }

  // Ignore events emitted by this exact session itself.
  if (event.sessionId === session.id && event.surface === "unified_session") {
    return { session, matchedActivityIds: [] };
  }

  const matchedActivityIds: string[] = [];
  const newNotices: CrossSurfaceCompletionNotice[] = [];

  const activities = session.activities.map((activity) => {
    if (!isActionableStatus(activity.status)) {
      return activity;
    }
    if (!eventMatchesActivity(event, activity)) {
      return activity;
    }

    matchedActivityIds.push(activity.id);
    newNotices.push({
      activityId: activity.id,
      dedupeKey: activity.dedupeKey,
      eventId: event.id,
      surface: event.surface,
      recordedAt: event.occurredAt,
      message: `Completed via ${event.surface} — skipped to prevent duplicate work`,
    });

    return {
      ...activity,
      status: "completed" as const,
      completedAt: event.occurredAt,
      activeSeconds: activity.activeSeconds ?? 0,
      completionEventId: event.id,
      completedViaSurface: event.surface,
    };
  });

  if (matchedActivityIds.length === 0) {
    return { session, matchedActivityIds: [] };
  }

  const currentActivity = activities[session.currentActivityIndex];
  const nextIndex =
    currentActivity && !isActionableStatus(currentActivity.status)
      ? findNextActionableIndex(activities, session.currentActivityIndex + 1)
      : session.currentActivityIndex;

  return {
    session: {
      ...session,
      activities,
      currentActivityIndex: nextIndex,
      crossSurfaceNotices: [...session.crossSurfaceNotices, ...newNotices],
      updatedAt: event.occurredAt,
    },
    matchedActivityIds,
  };
}

/**
 * Subscribes to `learningEventBus` and reconciles external surface completion
 * events into the active session.
 */
export function attachSessionEventReconciler(
  getSession: () => LearningSession | null,
  setSession: (session: LearningSession) => void,
): () => void {
  return learningEventBus.subscribe(null, (event) => {
    const current = getSession();
    if (!current) return;
    const { session: next, matchedActivityIds } = reconcileExternalLearningEvent(
      current,
      event,
    );
    if (matchedActivityIds.length > 0) {
      setSession(next);
    }
  });
}
