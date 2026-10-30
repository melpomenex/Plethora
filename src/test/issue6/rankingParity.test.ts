import { describe, expect, it } from "vitest";
import type { QueueItem } from "../../types/queue";
import {
  getPriorityScore,
  getPriorityVector,
  orderQueueItems,
  type PriorityPreset,
} from "../../utils/reviewUx";

const now = new Date("2026-10-29T12:00:00Z").getTime();

function makeItem(overrides: Partial<QueueItem>): QueueItem {
  return {
    id: "item-test",
    documentId: "doc-1",
    documentTitle: "Doc 1",
    itemType: "document",
    priority: 5,
    estimatedTime: 2,
    tags: ["test"],
    progress: 50,
    ...overrides,
  };
}

describe("R01/R02 Ranking Parity and Mathematical Counterexamples", () => {
  it("verifies missing/invalid/extreme memory and date handling", () => {
    // 1. Invalid date string
    const invalidDateItem = makeItem({
      dueDate: "not-a-valid-date",
      canonicalPriority: 0.5,
    });
    const invalidVec = getPriorityVector(invalidDateItem);
    expect(invalidVec.overduePenalty).toBe(0);
    // Neutral fallback T = 0.5 -> retentionRisk = 50
    expect(invalidVec.retentionRisk).toBe(50);

    // 2. NaN retrievability on recall card with no elapsed overdue time
    const nanCard = makeItem({
      itemType: "learning-item",
      dueDate: new Date().toISOString(),
      retrievability: Number.NaN,
      canonicalPriority: 0.5,
    });
    const nanVec = getPriorityVector(nanCard);
    // Falls back to readiness A = 0.5 -> retentionRisk = 50
    expect(nanVec.retentionRisk).toBe(50);

    // 3. Extreme overdue (100,000 days in the past)
    const extremeOverdue = makeItem({
      dueDate: new Date(now - 100_000 * 86_400_000).toISOString(),
      canonicalPriority: 0.5,
    });
    const extremeVec = getPriorityVector(extremeOverdue);
    expect(extremeVec.overduePenalty).toBe(90); // max clamped at 90
    expect(extremeVec.retentionRisk).toBe(95); // max clamped at 95
  });

  it("verifies future versus new document semantics", () => {
    // Future document: T = 0
    const futureDoc = makeItem({
      itemType: "document",
      dueDate: new Date(now + 7 * 86_400_000).toISOString(),
      canonicalPriority: 1.0,
    });
    const futureVec = getPriorityVector(futureDoc);
    expect(futureVec.retentionRisk).toBe(10); // clamped min at 10
    expect(futureVec.overduePenalty).toBe(0);
    expect(futureVec.userIntent).toBe(95); // high priority

    // New document: T = 0.5
    const newDoc = makeItem({
      itemType: "document",
      dueDate: undefined,
      canonicalPriority: 1.0,
    });
    const newVec = getPriorityVector(newDoc);
    expect(newVec.retentionRisk).toBe(50);
    expect(newVec.overduePenalty).toBe(0);
  });

  it("verifies manual-zero legacy flags", () => {
    // Explicit 0: priorityExplicitlySet = true with prioritySlider = 0 -> P = 0
    const explicitZero = makeItem({
      prioritySlider: 0,
      priorityExplicitlySet: true,
      canonicalPriority: 0.0,
    });
    const explicitVec = getPriorityVector(explicitZero);
    expect(explicitVec.userIntent).toBe(10); // clamp(0, 10, 95) = 10

    // Legacy unset zero without canonical priority: fallback to 0.5
    const unsetZero = makeItem({
      prioritySlider: 0,
      priorityExplicitlySet: false,
      canonicalPriority: undefined,
      priorityRating: undefined,
      priority: undefined,
    });
    const unsetVec = getPriorityVector(unsetZero);
    expect(unsetVec.userIntent).toBe(10);
  });

  it("verifies Unicode identities and equal-state deterministic ordering", () => {
    const item1 = makeItem({
      id: "карточка-я",
      itemType: "learning-item",
      priority: 5,
      canonicalPriority: 0.5,
      dueDate: new Date(now).toISOString(),
    });
    const item2 = makeItem({
      id: "карточка-а",
      itemType: "learning-item",
      priority: 5,
      canonicalPriority: 0.5,
      dueDate: new Date(now).toISOString(),
    });

    const orderedForward = orderQueueItems([item1, item2], "maximize-retention");
    const orderedReverse = orderQueueItems([item2, item1], "maximize-retention");

    // Both input permutations MUST produce the exact same deterministic ordering
    expect(orderedForward.map((i) => i.id)).toEqual(orderedReverse.map((i) => i.id));
    expect(orderedForward.map((i) => i.id)).toEqual(["карточка-я", "карточка-а"]);
  });

  it("verifies bounded monotonic results as overdue days increase", () => {
    let prevOverdue = -1;
    let prevRetention = -1;

    for (let d = 0; d <= 90; d += 5) {
      const due = new Date(now - d * 86_400_000).toISOString();
      const item = makeItem({
        dueDate: due,
        canonicalPriority: 0.5,
      });
      const vec = getPriorityVector(item);

      expect(vec.overduePenalty).toBeGreaterThanOrEqual(prevOverdue);
      expect(vec.retentionRisk).toBeGreaterThanOrEqual(prevRetention);
      expect(vec.overduePenalty).toBeLessThanOrEqual(90);
      expect(vec.retentionRisk).toBeLessThanOrEqual(95);

      prevOverdue = vec.overduePenalty;
      prevRetention = vec.retentionRisk;
    }
  });

  describe("Original mathematical counterexamples", () => {
    it("counterexample 1: 30-day late document beats 14-day late document (no day-14 decline)", () => {
      // Old policy: day 14 = 0.726250, day 30 = 0.656250 (day 14 > day 30, regression!)
      // New policy: day 30 > day 14 monotonically.
      const d14 = makeItem({
        id: "d14",
        dueDate: new Date(now - 14 * 86_400_000).toISOString(),
        canonicalPriority: 0.25,
      });
      const d30 = makeItem({
        id: "d30",
        dueDate: new Date(now - 30 * 86_400_000).toISOString(),
        canonicalPriority: 0.25,
      });

      const score14 = getPriorityScore(d14, "maximize-retention");
      const score30 = getPriorityScore(d30, "maximize-retention");

      expect(score30).toBeGreaterThan(score14);
    });

    it("counterexample 2: top-priority new document beats modest 7-day late bottom-priority document", () => {
      const topNew = makeItem({
        id: "top-new",
        dueDate: undefined,
        canonicalPriority: 1.0,
      });
      const modestLateBottom = makeItem({
        id: "late-bottom",
        dueDate: new Date(now - 7 * 86_400_000).toISOString(),
        canonicalPriority: 0.0,
      });

      const scoreNew = getPriorityScore(topNew, "exploratory");
      const scoreLate = getPriorityScore(modestLateBottom, "exploratory");

      expect(scoreNew).toBeGreaterThan(scoreLate);
    });

    it("counterexample 3: future high-priority document does not receive artificial overdue boost", () => {
      const futureDoc = makeItem({
        id: "future-doc",
        dueDate: new Date(now + 7 * 86_400_000).toISOString(),
        canonicalPriority: 1.0,
      });
      const vec = getPriorityVector(futureDoc);
      expect(vec.overduePenalty).toBe(0);
      expect(vec.retentionRisk).toBe(10);
    });

    it("counterexample 4: due recall card with low retrievability has high urgency", () => {
      const weakCard = makeItem({
        id: "weak-card",
        itemType: "learning-item",
        dueDate: new Date(now).toISOString(),
        retrievability: 0.2,
        canonicalPriority: 0.5,
      });
      const vec = getPriorityVector(weakCard);
      // r = 0.2 -> R = 0.8 -> retentionRisk ≈ 80
      expect(vec.retentionRisk).toBe(80);
    });
  });
});
