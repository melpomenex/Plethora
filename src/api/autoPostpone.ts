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
  manualPriority?: number;
  stability: number | null;
  difficulty: number | null;
  reviewCount: number;
  lapses: number;
  isSuspended: boolean;
  isArchived: boolean;
  isDismissed: boolean;
  isInactive: boolean;
}

export interface AutoPostponeStrictPolicy {
  dailyCapacity: number;
  protectedPriority: number;
}

export interface AutoPostponeStrictCheck {
  windowStart: string;
  windowEnd: string;
  revision: string;
}

export interface AutoPostponeCandidateSet {
  strictPolicy?: AutoPostponeStrictPolicy;
  revision?: string;
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
  strictManual?: boolean,
): Promise<AutoPostponeCandidateSet> {
  return invokeCommand<AutoPostponeCandidateSet>("get_auto_postpone_candidates", {
    collectionId,
    windowStart,
    windowEnd,
    ...(strictManual && { strictManual }),
  });
}

export async function applyAutoPostponePlan(
  collectionId: string,
  plan: AutoPostponePlanItem[],
  strictCheck?: AutoPostponeStrictCheck,
): Promise<{ outcomes: AutoPostponeItemOutcome[] }> {
  const persistedPlan = plan.map((item) => {
    const localMidnight = parseScheduleDate(item.targetDueDate);
    if (!localMidnight) throw new Error(`Invalid auto-postpone target date: ${item.targetDueDate}`);
    return { ...item, targetDueDate: localMidnight.toISOString() };
  });
  return invokeCommand("apply_auto_postpone_plan", { collectionId, plan: persistedPlan, ...(strictCheck && { strictCheck }) });
}
