import { describe, it, expect } from "vitest";
import {
  buildItemPresentation,
  dueState,
  formatInterval,
  itemTypeMeta,
  stabilityMeta,
  difficultyMeta,
  retrievabilityMeta,
  progressMeta,
  estimatedTimeMeta,
} from "../scheduleItemPresentation";
import type { ScheduleDayItem } from "../../types/queue";

const TODAY = "2026-06-15";

const baseItem: ScheduleDayItem = {
  id: "i1",
  documentId: "doc-1",
  documentTitle: "Test Doc",
  itemType: "learning-item",
  dueDate: TODAY,
  estimatedTime: 10,
  priority: 5,
  tags: [],
  progress: 50,
};

const t = (key: string, vars?: Record<string, string | number>) => {
  if (vars) {
    return `${key}:${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(",")}`;
  }
  return key;
};

describe("itemTypeMeta", () => {
  it("maps each item type to its label and icon key", () => {
    expect(itemTypeMeta("document", t)).toEqual({ key: "document", label: "schedule.documentBadge", icon: "document" });
    expect(itemTypeMeta("extract", t)).toEqual({ key: "extract", label: "schedule.extractBadge", icon: "extract" });
    expect(itemTypeMeta("learning-item", t)).toEqual({ key: "learning-item", label: "schedule.learningBadge", icon: "learning" });
  });
});

describe("formatInterval", () => {
  it("formats sub-day, day, and week intervals", () => {
    expect(formatInterval(0.5, t)).toBe("schedule.intervalHours:count=12");
    expect(formatInterval(0.01, t)).toBe("<1h");
    expect(formatInterval(3, t)).toBe("schedule.intervalDays:count=3");
    expect(formatInterval(21, t)).toBe("schedule.intervalDays:count=21");
    expect(formatInterval(35, t)).toBe("schedule.intervalWeeks:count=5");
  });
});

describe("dueState", () => {
  it("classifies overdue, today, tomorrow, and upcoming", () => {
    expect(dueState("2026-06-14", TODAY, t)?.key).toBe("overdue");
    expect(dueState("2026-06-15", TODAY, t)?.key).toBe("today");
    expect(dueState("2026-06-16", TODAY, t)?.key).toBe("tomorrow");
    expect(dueState("2026-06-20", TODAY, t)?.key).toBe("upcoming");
  });

  it("returns danger severity for overdue", () => {
    expect(dueState("2026-06-14", TODAY, t)?.severity).toBe("danger");
  });

  it("returns null for an invalid date", () => {
    expect(dueState("not-a-date", TODAY, t)).toBeNull();
  });
});

describe("metric metadata", () => {
  it("returns null for missing/undefined metric values", () => {
    expect(stabilityMeta(undefined, t)).toBeNull();
    expect(difficultyMeta(undefined, t)).toBeNull();
    expect(retrievabilityMeta(undefined, t)).toBeNull();
    expect(progressMeta(undefined, t)).toBeNull();
    expect(estimatedTimeMeta(0, t)).toBeNull();
    expect(estimatedTimeMeta(undefined, t)).toBeNull();
  });

  it("handles edge values (zero, NaN, extremes)", () => {
    expect(stabilityMeta(NaN, t)).toBeNull();
    expect(difficultyMeta(0, t)?.severity).toBe("good");
    expect(retrievabilityMeta(0, t)?.severity).toBe("danger");
    expect(retrievabilityMeta(1, t)?.value).toBe(100);
    expect(progressMeta(0, t)?.severity).toBe("neutral");
    expect(progressMeta(100, t)?.severity).toBe("good");
  });

  it("caps bar ratios at 1", () => {
    expect(stabilityMeta(300, t)?.ratio).toBe(1);
    expect(progressMeta(200, t)?.ratio).toBe(1);
  });
});

describe("buildItemPresentation", () => {
  it("resolves title via schedule title helpers", () => {
    const p = buildItemPresentation({ ...baseItem, documentTitle: "My Title" }, TODAY, t);
    expect(p.title).toBe("My Title");
  });

  it("includes due, time, algo flags, tags and category", () => {
    const p = buildItemPresentation(
      { ...baseItem, tags: ["a", "b"], category: "Math", stability: 12, difficulty: 4, interval: 5, retrievability: 0.8, reps: 3 },
      TODAY,
      t,
    );
    expect(p.due?.key).toBe("today");
    expect(p.estimatedTime?.value).toBe("10m");
    expect(p.hasAlgoData).toBe(true);
    expect(p.stability?.severity).toBe("good");
    expect(p.difficulty?.severity).toBe("warning");
    expect(p.retrievability?.severity).toBe("warning");
    expect(p.interval).not.toBeNull();
    expect(p.tags).toEqual(["a", "b"]);
    expect(p.category).toBe("Math");
  });

  it("handles partial/missing data gracefully", () => {
    const p = buildItemPresentation(
      { ...baseItem, documentTitle: "", itemType: "document", stability: undefined, difficulty: undefined, interval: undefined, retrievability: undefined, estimatedTime: 0, tags: [] },
      TODAY,
      t,
    );
    expect(p.due?.key).toBe("today");
    expect(p.stability).toBeNull();
    expect(p.difficulty).toBeNull();
    expect(p.interval).toBeNull();
    expect(p.retrievability).toBeNull();
    expect(p.estimatedTime).toBeNull();
    expect(p.hasAlgoData).toBe(false);
    expect(p.type.icon).toBe("document");
  });

  it("exposes an accessible label containing the value", () => {
    const p = buildItemPresentation({ ...baseItem, stability: 7 }, TODAY, t);
    expect(p.stability?.accessibleLabel).toContain("schedule.stability");
  });
});
