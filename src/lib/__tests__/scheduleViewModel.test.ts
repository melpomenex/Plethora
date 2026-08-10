import { describe, it, expect } from "vitest";
import {
  buildScheduleViewModel,
  localDateKey,
  dateKeyOf,
  loadBucket,
  groupScheduleItems,
  spreadTargetDay,
  FORECAST_HORIZON_DAYS,
  SEVEN_DAY_WINDOW,
} from "../scheduleViewModel";
import type { ForecastPoint, ScheduleDayItem } from "../../types/queue";

// Fixed "today" so tests are deterministic regardless of when they run.
const TODAY = "2026-06-15";

function day(offset: number): string {
  const d = new Date(2026, 5, 15 + offset); // June 15 2026 local
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function item(overrides: Partial<ScheduleDayItem> & { id: string }): ScheduleDayItem {
  return {
    id: overrides.id,
    documentId: "doc-1",
    documentTitle: "Doc",
    itemType: "learning-item",
    dueDate: TODAY,
    estimatedTime: 5,
    priority: 5,
    tags: [],
    progress: 50,
    ...overrides,
  };
}

function forecast(overrides: Partial<ForecastPoint> & { date: string }): ForecastPoint {
  return {
    due_learning_items: 0,
    due_documents: 0,
    due_total: 0,
    ...overrides,
  };
}

describe("localDateKey", () => {
  it("produces the local calendar date key, not UTC", () => {
    // June 15 2026 23:30 local — key must stay on the 15th locally.
    const d = new Date(2026, 5, 15, 23, 30);
    expect(localDateKey(d)).toBe("2026-06-15");
  });

  it("zero-pads month and day", () => {
    expect(localDateKey(new Date(2026, 0, 3))).toBe("2026-01-03");
  });
});

describe("dateKeyOf / loadBucket", () => {
  it("normalizes bare dates and RFC3339 timestamps to the same key", () => {
    expect(dateKeyOf(item({ id: "a", dueDate: "2026-06-15" }))).toBe("2026-06-15");
    expect(dateKeyOf(item({ id: "b", dueDate: "2026-06-15T12:34:56Z" }))).toBe("2026-06-15");
  });

  it("buckets load magnitudes", () => {
    expect(loadBucket(0)).toBe("none");
    expect(loadBucket(10)).toBe("light");
    expect(loadBucket(11)).toBe("moderate");
    expect(loadBucket(26)).toBe("heavy");
    expect(loadBucket(51)).toBe("critical");
  });
});

describe("groupScheduleItems", () => {
  it("groups by normalized date and orders dates ascending", () => {
    const groups = groupScheduleItems([
      item({ id: "f", dueDate: day(2) }),
      item({ id: "o", dueDate: day(-1) }),
      item({ id: "t", dueDate: TODAY }),
    ]);
    expect(groups.map((g) => g.dateKey)).toEqual([day(-1), TODAY, day(2)]);
  });

  it("sorts items within a group by descending priority with stable tie-break", () => {
    const groups = groupScheduleItems([
      item({ id: "low", dueDate: TODAY, priority: 1 }),
      item({ id: "high", dueDate: TODAY, priority: 9 }),
      item({ id: "mid", dueDate: TODAY, priority: 5 }),
    ]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["high", "mid", "low"]);
  });

  it("sums estimated minutes per group", () => {
    const groups = groupScheduleItems([
      item({ id: "a", dueDate: TODAY, estimatedTime: 10 }),
      item({ id: "b", dueDate: TODAY, estimatedTime: 15 }),
    ]);
    expect(groups[0].estimatedMinutes).toBe(25);
  });
});

describe("buildScheduleViewModel", () => {
  it("separates dueToday, overdue, and dueNow exactly by calendar date", () => {
    const vm = buildScheduleViewModel({
      forecast: [forecast({ date: TODAY, due_total: 0 })],
      items: [
        item({ id: "overdue2", dueDate: day(-2) }),
        item({ id: "overdue1", dueDate: day(-1) }),
        item({ id: "today", dueDate: TODAY }),
        item({ id: "tomorrow", dueDate: day(1) }),
      ],
      todayKey: TODAY,
      selectedDate: null,
    });
    expect(vm.insights.dueToday).toBe(1);
    expect(vm.insights.overdue).toBe(2);
    expect(vm.insights.dueNow).toBe(3);
  });

  it("computes next-seven-day average from the displayed next seven days only", () => {
    const points = Array.from({ length: 14 }, (_, i) =>
      forecast({ date: day(i), due_total: i + 1 }));
    const vm = buildScheduleViewModel({
      forecast: points,
      items: [],
      todayKey: TODAY,
      selectedDate: null,
    });
    // Sum of day offsets 1..7 = 28, / 7 = 4.
    expect(vm.insights.nextSevenAverage).toBe(4);
    expect(vm.insights.horizonTotal).toBe(105); // 1..14
  });

  it("divides the seven-day average by available days when the window is short", () => {
    const points = [forecast({ date: TODAY, due_total: 9 }), forecast({ date: day(1), due_total: 9 })];
    const vm = buildScheduleViewModel({
      forecast: points,
      items: [],
      todayKey: TODAY,
      selectedDate: null,
    });
    expect(vm.insights.nextSevenAverage).toBe(9); // 18 / 2, not 18 / 7
  });

  it("identifies the peak day within the 14-day horizon", () => {
    const points = Array.from({ length: 14 }, (_, i) =>
      forecast({ date: day(i), due_total: i === 6 ? 42 : 3 }));
    const vm = buildScheduleViewModel({
      forecast: points,
      items: [],
      todayKey: TODAY,
      selectedDate: null,
    });
    expect(vm.insights.peakDay?.dateKey).toBe(day(6));
    expect(vm.insights.peakDay?.dueTotal).toBe(42);
    expect(vm.forecastDays.filter((d) => d.isPeak)).toHaveLength(1);
  });

  it("returns explicit zero values for empty inputs", () => {
    const vm = buildScheduleViewModel({
      forecast: [],
      items: [],
      todayKey: TODAY,
      selectedDate: null,
    });
    expect(vm.insights).toEqual({
      dueToday: 0,
      overdue: 0,
      dueNow: 0,
      horizonTotal: 0,
      nextSevenAverage: 0,
      peakDay: null,
    });
    expect(vm.forecastDays).toEqual([]);
    expect(vm.groups).toEqual([]);
    expect(vm.visibleGroups).toEqual([]);
    expect(vm.visibleEstimatedMinutes).toBe(0);
    expect(vm.canSpread).toBe(false);
    expect(vm.spreadSource).toBeNull();
  });

  it("marks today and selected structure on forecast days", () => {
    const points = [forecast({ date: TODAY, due_total: 4 }), forecast({ date: day(1), due_total: 6 })];
    const vm = buildScheduleViewModel({
      forecast: points,
      items: [],
      todayKey: TODAY,
      selectedDate: day(1),
    });
    const todayDay = vm.forecastDays.find((d) => d.dateKey === TODAY)!;
    const selectedDay = vm.forecastDays.find((d) => d.dateKey === day(1))!;
    expect(todayDay.isToday).toBe(true);
    expect(todayDay.isSelected).toBe(false);
    expect(selectedDay.isSelected).toBe(true);
    // Relative magnitude within the horizon: 4/6 and 6/6.
    expect(todayDay.magnitude).toBeCloseTo(4 / 6);
    expect(selectedDay.magnitude).toBeCloseTo(1);
    expect(todayDay.bucket).toBe("light");
    expect(selectedDay.bucket).toBe("light");
  });

  it("filters visible groups by the selected date", () => {
    const vm = buildScheduleViewModel({
      forecast: [],
      items: [
        item({ id: "a", dueDate: TODAY }),
        item({ id: "b", dueDate: day(1) }),
      ],
      todayKey: TODAY,
      selectedDate: day(1),
    });
    expect(vm.visibleGroups).toHaveLength(1);
    expect(vm.visibleGroups[0].dateKey).toBe(day(1));
    expect(vm.visibleEstimatedMinutes).toBe(5);
  });

  it("normalizes a timestamp selectedDate to its date key", () => {
    const vm = buildScheduleViewModel({
      forecast: [],
      items: [item({ id: "a", dueDate: day(2) })],
      todayKey: TODAY,
      selectedDate: `${day(2)}T08:00:00Z`,
    });
    expect(vm.visibleGroups.map((g) => g.dateKey)).toEqual([day(2)]);
  });

  it("computes spread source from the selected date when present", () => {
    const vm = buildScheduleViewModel({
      forecast: [],
      items: [
        item({ id: "li", dueDate: TODAY, itemType: "learning-item" }),
        item({ id: "doc", dueDate: TODAY, itemType: "document" }),
      ],
      todayKey: TODAY,
      selectedDate: TODAY,
    });
    expect(vm.spreadSource).toEqual({ dateKey: TODAY, itemCount: 2, eligibleCount: 1 });
    expect(vm.canSpread).toBe(true);
  });

  it("computes spread source from the peak horizon day when no date is selected", () => {
    const points = Array.from({ length: 14 }, (_, i) =>
      forecast({ date: day(i), due_total: i === 3 ? 30 : 1 }));
    const vm = buildScheduleViewModel({
      forecast: points,
      items: [item({ id: "li", dueDate: day(3), itemType: "learning-item" })],
      todayKey: TODAY,
      selectedDate: null,
    });
    expect(vm.spreadSource?.dateKey).toBe(day(3));
    expect(vm.canSpread).toBe(true);
  });

  it("disables spread when the source has no eligible (learning) items", () => {
    const vm = buildScheduleViewModel({
      forecast: [forecast({ date: TODAY, due_total: 8 })],
      items: [item({ id: "doc", dueDate: TODAY, itemType: "document" })],
      todayKey: TODAY,
      selectedDate: TODAY,
    });
    expect(vm.spreadSource?.eligibleCount).toBe(0);
    expect(vm.canSpread).toBe(false);
  });

  it("disables spread when there is no source workload at all", () => {
    const vm = buildScheduleViewModel({
      forecast: [],
      items: [],
      todayKey: TODAY,
      selectedDate: null,
    });
    expect(vm.canSpread).toBe(false);
    expect(vm.spreadSource).toBeNull();
  });

  it("keeps the displayed horizon to FORECAST_HORIZON_DAYS days", () => {
    const points = Array.from({ length: 40 }, (_, i) =>
      forecast({ date: day(i), due_total: 1 }));
    const vm = buildScheduleViewModel({
      forecast: points,
      items: [],
      todayKey: TODAY,
      selectedDate: null,
    });
    expect(vm.forecastDays).toHaveLength(FORECAST_HORIZON_DAYS);
    expect(SEVEN_DAY_WINDOW).toBe(7);
  });

  it("distributes spread items evenly across the horizon using absolute index", () => {
    // 45 items across 14 days in batches of 20: the batch boundary must not
    // cluster items — absolute-index math spreads across days 0..13.
    const horizon = 14;
    const targets = Array.from({ length: 45 }, (_, i) => spreadTargetDay(i, 45, horizon));
    expect(new Set(targets).size).toBeGreaterThanOrEqual(10);
    // First items land early, last items land late (monotonic non-decreasing).
    for (let i = 1; i < targets.length; i++) {
      expect(targets[i]).toBeGreaterThanOrEqual(targets[i - 1]);
    }
    // No target exceeds the horizon.
    for (const t of targets) expect(t).toBeLessThan(horizon);
  });

  it("handles spread edge cases (single item, empty, tiny horizon)", () => {
    expect(spreadTargetDay(0, 1, 30)).toBe(0);
    expect(spreadTargetDay(0, 0, 14)).toBe(0);
    expect(spreadTargetDay(0, 10, 0)).toBe(0);
    // 10 items / 3 days → perDay=4: index 5 lands on day 1, index 9 on day 2.
    expect(spreadTargetDay(5, 10, 3)).toBe(1);
    expect(spreadTargetDay(9, 10, 3)).toBe(2);
  });

  it("populates learning/document composition on forecast days", () => {
    const vm = buildScheduleViewModel({
      forecast: [forecast({ date: TODAY, due_total: 7, due_learning_items: 5, due_documents: 2 })],
      items: [],
      todayKey: TODAY,
      selectedDate: null,
    });
    expect(vm.forecastDays[0].learningCount).toBe(5);
    expect(vm.forecastDays[0].documentCount).toBe(2);
  });
});
