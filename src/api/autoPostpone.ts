import { invokeCommand } from "../lib/tauri";
import { parseScheduleDate } from "../lib/scheduleUtils";

export type AutoPostponeEntityType = "learning-item" | "document" | "extract" | "video-extract";

export interface AutoPostponeCandidate {
  id: string;
  entityType: AutoPostponeEntityType;
  dueDate: string | null;
  lastReviewDate: string | null;
  interval: number | null;
  priorityScore: number | null;
  stability: number | null;
  difficulty: number | null;
  reviewCount: number;
  lapses: number;
  isSuspended: boolean;
  isArchived: boolean;
  isDismissed: boolean;
  isInactive: boolean;
}

export interface AutoPostponeCandidateSet {
  candidates: AutoPostponeCandidate[];
  scheduledDates: string[];
}

export interface AutoPostponePlanItem {
  id: string;
  entityType: AutoPostponeEntityType;
  expectedDueDate: string;
  targetDueDate: string;
}

export interface AutoPostponeItemOutcome {
  id: string;
  status: "postponed" | "skipped";
  reason?: string | null;
}

export async function getAutoPostponeCandidates(
  collectionId: string,
  windowStart: string,
  windowEnd: string,
): Promise<AutoPostponeCandidateSet> {
  return invokeCommand<AutoPostponeCandidateSet>("get_auto_postpone_candidates", {
    collectionId,
    windowStart,
    windowEnd,
  });
}

export async function applyAutoPostponePlan(
  collectionId: string,
  plan: AutoPostponePlanItem[],
): Promise<{ outcomes: AutoPostponeItemOutcome[] }> {
  const persistedPlan = plan.map((item) => {
    const localMidnight = parseScheduleDate(item.targetDueDate);
    if (!localMidnight) throw new Error(`Invalid auto-postpone target date: ${item.targetDueDate}`);
    return { ...item, targetDueDate: localMidnight.toISOString() };
  });
  return invokeCommand("apply_auto_postpone_plan", { collectionId, plan: persistedPlan });
}
