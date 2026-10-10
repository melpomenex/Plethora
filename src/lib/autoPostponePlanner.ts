import type { AutoPostponeCandidate, AutoPostponePlanItem } from "../api/autoPostpone";
import type { PostponeSettings } from "../stores/settingsStore";
import { computePriority, defaultPostponeConfig, postponeElement, type PostponeConfig, type PostponeInput } from "./postpone";
import { localDateKey } from "./scheduleViewModel";
import { parseScheduleDate, toDateString } from "./scheduleUtils";

export interface AutoPostponePlan {
  items: AutoPostponePlanItem[];
  discovered: number;
  skipped: number;
  skipReasons: Partial<Record<AutoPostponeSkipReason, number>>;
  distribution: Record<string, number>;
}

export type AutoPostponeSkipReason =
  | "invalid-date"
  | "unsupported-video-extract"
  | "suspended"
  | "archived"
  | "dismissed"
  | "inactive"
  | "postpone-rules";

function dayNumber(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Math.floor(new Date(year, month - 1, day).getTime() / 86_400_000);
}

function addLocalDays(date: Date, days: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + days);
  return result;
}

function validDateKey(value: string | null): string | null {
  if (!value) return null;
  const parsed = parseScheduleDate(value);
  if (!parsed) return null;
  const key = toDateString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && localDateKey(parsed) !== value) return null;
  return key;
}

function settingsConfig(settings: PostponeSettings): PostponeConfig {
  return {
    ...defaultPostponeConfig,
    itemIncrease: settings.itemIncrease,
    itemMinIncrease: settings.itemMinIncrease,
    itemMaxIncrease: settings.itemMaxIncrease,
    itemCap: settings.itemCap,
    itemFloor: settings.itemFloor,
    topicIncrease: settings.topicIncrease,
    topicMinIncrease: settings.topicMinIncrease,
    topicMaxIncrease: settings.topicMaxIncrease,
    topicCap: settings.topicCap,
    topicFloor: settings.topicFloor,
    minElapsed: settings.minElapsed,
    minPriority: settings.minPriority,
    minPriority2: settings.minPriority2,
    minStability: settings.minStability,
    topicPriorityMin: settings.topicPriorityMin,
    topicRepMin: settings.topicRepMin,
    topicElapsedMin: settings.topicElapsedMin,
    randomize: settings.randomize,
    simpleMode: settings.simpleMode,
  };
}

function toPostponeInput(candidate: AutoPostponeCandidate, today: string): PostponeInput {
  const lastReview = validDateKey(candidate.lastReviewDate);
  const daysSinceReview = lastReview ? Math.max(0, dayNumber(today) - dayNumber(lastReview)) : 0;
  const stability = candidate.stability ?? 1;
  const difficulty = candidate.difficulty ?? 3;
  return {
    id: candidate.id,
    type: candidate.entityType === "document" ? "topic" : "item",
    interval: candidate.interval ?? 0,
    priority: candidate.entityType === "learning-item"
      ? computePriority(stability, difficulty, candidate.lapses)
      : candidate.priorityScore ?? computePriority(stability, difficulty, candidate.lapses),
    stability,
    difficulty,
    reviewCount: candidate.reviewCount,
    lapses: candidate.lapses,
    daysSinceReview,
  };
}

/**
 * Deterministically assigns overdue items to the least-loaded local date over
 * the next 30 days. Existing Schedule semantics are used for every date key.
 */
export function planAutoPostpone(
  candidates: AutoPostponeCandidate[],
  scheduledDates: string[],
  today: Date,
  settings: PostponeSettings,
): AutoPostponePlan {
  const todayKey = localDateKey(today);
  const config = settingsConfig(settings);
  const overdue = candidates.filter((candidate) => {
    if (!candidate.dueDate) return false;
    const dueKey = validDateKey(candidate.dueDate);
    return dueKey === null || dueKey < todayKey;
  });
  const eligible: Array<{ candidate: AutoPostponeCandidate; preferredOffset: number; priority: number }> = [];
  let skipped = 0;
  const skipReasons: Partial<Record<AutoPostponeSkipReason, number>> = {};
  const skip = (reason: AutoPostponeSkipReason) => {
    skipped += 1;
    skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
  };

  for (const candidate of overdue) {
    const dueKey = validDateKey(candidate.dueDate);
    if (!dueKey) {
      skip("invalid-date");
      continue;
    }
    if (candidate.entityType === "video-extract") {
      skip("unsupported-video-extract");
      continue;
    }
    if (candidate.isSuspended) {
      skip("suspended");
      continue;
    }
    if (candidate.isArchived) {
      skip("archived");
      continue;
    }
    if (candidate.isDismissed) {
      skip("dismissed");
      continue;
    }
    if (candidate.isInactive) {
      skip("inactive");
      continue;
    }
    const input = toPostponeInput(candidate, todayKey);
    const decision = postponeElement(input, config);
    if (!decision.postponed) {
      skip("postpone-rules");
      continue;
    }
    eligible.push({
      candidate,
      preferredOffset: Math.max(1, Math.min(30, Math.round(decision.increase))),
      priority: input.priority,
    });
  }

  const dates = Array.from({ length: 30 }, (_, index) => localDateKey(addLocalDays(today, index + 1)));
  const workload = new Map(dates.map((date) => [date, 0]));
  for (const rawDate of scheduledDates) {
    const key = validDateKey(rawDate);
    if (key && workload.has(key)) workload.set(key, (workload.get(key) ?? 0) + 1);
  }

  eligible.sort((a, b) =>
    b.priority - a.priority ||
    a.candidate.entityType.localeCompare(b.candidate.entityType) ||
    a.candidate.id.localeCompare(b.candidate.id),
  );

  const items: AutoPostponePlanItem[] = [];
  const distribution: Record<string, number> = {};
  for (const { candidate, preferredOffset } of eligible) {
    const target = [...dates].sort((a, b) =>
      (workload.get(a) ?? 0) - (workload.get(b) ?? 0) ||
      Math.abs(dayNumber(a) - dayNumber(todayKey) - preferredOffset) -
        Math.abs(dayNumber(b) - dayNumber(todayKey) - preferredOffset) ||
      a.localeCompare(b),
    )[0];
    items.push({
      id: candidate.id,
      entityType: candidate.entityType,
      expectedDueDate: candidate.dueDate!,
      targetDueDate: target,
    });
    workload.set(target, (workload.get(target) ?? 0) + 1);
    distribution[target] = (distribution[target] ?? 0) + 1;
  }

  return { items, discovered: overdue.length, skipped, skipReasons, distribution };
}
