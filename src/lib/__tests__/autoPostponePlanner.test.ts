import { describe, expect, it } from "vitest";
import type { AutoPostponeCandidate } from "../../api/autoPostpone";
import type { PostponeSettings } from "../../stores/settingsStore";
import { defaultPostponeConfig } from "../postpone";
import { localDateKey } from "../scheduleViewModel";
import { planAutoPostpone } from "../autoPostponePlanner";

const settings: PostponeSettings = {
  ...defaultPostponeConfig,
  autoPostponeEnabled: true,
  randomize: false,
};

function candidate(
  id: string,
  dueDate: string | null,
  overrides: Partial<AutoPostponeCandidate> = {},
): AutoPostponeCandidate {
  return {
    id,
    entityType: "learning-item",
    dueDate,
    lastReviewDate: null,
    interval: 12,
    priorityScore: 50,
    stability: 1,
    difficulty: 3,
    reviewCount: 1,
    lapses: 0,
    isSuspended: false,
    isArchived: false,
    isDismissed: false,
    isInactive: false,
    ...overrides,
  };
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + days);
  return result;
}

describe("planAutoPostpone", () => {
  it("spreads a 49-item backlog over the next 30 local dates", () => {
    const today = new Date(2026, 11, 20, 12);
    const overdueDate = localDateKey(addDays(today, -45));
    const candidates = Array.from({ length: 49 }, (_, index) => candidate(`item-${String(index).padStart(2, "0")}`, overdueDate));

    const plan = planAutoPostpone(candidates, [], today, settings);

    expect(plan.discovered).toBe(49);
    expect(plan.skipped).toBe(0);
    expect(plan.items).toHaveLength(49);
    const distribution = Object.values(plan.distribution);
    expect(distribution).toHaveLength(30);
    expect(Math.max(...distribution)).toBe(2);
    expect(Math.min(...distribution)).toBe(1);
    for (const target of plan.items.map((item) => item.targetDueDate)) {
      const offset = Math.round((new Date(`${target}T00:00:00`).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
      expect(offset).toBeGreaterThanOrEqual(1);
      expect(offset).toBeLessThanOrEqual(30);
      expect(target).not.toBe(localDateKey(today));
    }
  });

  it("uses local calendar days and the least-loaded day across a year boundary", () => {
    const today = new Date(2026, 11, 31, 12);
    const tomorrow = localDateKey(addDays(today, 1));
    const overdue = localDateKey(addDays(today, -1));
    const plan = planAutoPostpone(
      [candidate("one", overdue)],
      Array.from({ length: 5 }, () => tomorrow),
      today,
      settings,
    );

    expect(plan.items[0].targetDueDate).toBe("2027-01-02");
  });

  it("does not count missing or due-today schedules and reports ineligible overdue candidates as skipped", () => {
    const today = new Date(2026, 9, 10, 12);
    const todayKey = localDateKey(today);
    const overdue = localDateKey(addDays(today, -1));
    const lastReview = localDateKey(addDays(today, -60));
    const candidates = [
      candidate("missing", null),
      candidate("due-today", todayKey),
      candidate("invalid-date", "not-a-date"),
      candidate("video", overdue, { entityType: "video-extract" }),
      candidate("suspended", overdue, { isSuspended: true }),
      candidate("archived", overdue, { isArchived: true }),
      candidate("dismissed", overdue, { isDismissed: true }),
      candidate("inactive", overdue, { isInactive: true }),
      candidate("established", overdue, {
        lastReviewDate: lastReview,
        priorityScore: 100,
        stability: 30,
        reviewCount: 60,
      }),
      candidate("eligible", overdue),
    ];

    const plan = planAutoPostpone(candidates, [], today, settings);

    expect(plan.discovered).toBe(8);
    expect(plan.skipped).toBe(7);
    expect(plan.skipReasons).toEqual({
      "invalid-date": 1,
      "unsupported-video-extract": 1,
      suspended: 1,
      archived: 1,
      dismissed: 1,
      inactive: 1,
      "postpone-rules": 1,
    });
    expect(plan.items.map((item) => item.id)).toEqual(["eligible"]);
  });

  it("treats timestamp offsets using the same local date normalization as Schedule", () => {
    const today = new Date(2026, 2, 1, 12);
    const todayLocalMidnightUtc = new Date(2026, 2, 1, 0).toISOString();
    const yesterdayLocalMidnightUtc = new Date(2026, 1, 28, 0).toISOString();
    const plan = planAutoPostpone(
      [candidate("today", todayLocalMidnightUtc), candidate("yesterday", yesterdayLocalMidnightUtc)],
      [],
      today,
      settings,
    );

    expect(plan.discovered).toBe(1);
    expect(plan.items.map((item) => item.id)).toEqual(["yesterday"]);
  });
});
