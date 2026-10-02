import { describe, expect, it } from "vitest";
import { defaultDaqeKnobs } from "./knobs";
import {
  breakdownFor,
  positionOf,
  projectSnapshot,
  snapshotMatchesKnobs,
  termStatus,
  type DaqeQueueSnapshot,
  type RankedQueueItem,
  type TermBreakdown,
} from "./snapshot";
import type { QueueItem } from "../../types/queue";

function item(id: string, index: number): QueueItem {
  return {
    id,
    documentId: `doc-${index}`,
    documentTitle: `Title ${id}`,
    extractId: null,
    learningItemId: null,
    question: null,
    answer: null,
    clozeText: null,
    itemType: "learning-item",
    priority: 5,
    dueDate: "2026-06-01T00:00:00Z",
    estimatedTime: 2,
    tags: [],
    category: null,
    progress: 0,
  } as QueueItem;
}

function breakdown(overrides: Partial<TermBreakdown> = {}): TermBreakdown {
  return {
    srsUrgency: { value: 0.5, available: true, defaulted: false },
    srsWeight: 1,
    goalRelevance: { value: 0, available: false, defaulted: false },
    goalWeight: 0,
    energyFit: { value: 0.5, available: true, defaulted: true },
    energyWeight: 0.4,
    interleavePenalty: { value: 0, available: true, defaulted: false },
    interleaveWeight: 0,
    frictionPenalty: { value: 0, available: true, defaulted: false },
    frictionWeight: 0,
    effectiveEnergyTarget: 3,
    interleaveAgainst: [],
    ...overrides,
  };
}

function snapshotOf(order: string[], knobs = defaultDaqeKnobs()): DaqeQueueSnapshot {
  const ranked: RankedQueueItem[] = order.map((id, index) => ({
    item: item(id, index),
    score: 1 - index * 0.01,
    breakdown: breakdown(),
    inputIndex: index,
  }));
  return {
    id: "snap-1",
    profile: "default",
    knobs: { ...knobs },
    ranked,
    top10: ranked.slice(0, 10),
    computedAt: "2026-06-01T12:00:00Z",
  };
}

describe("snapshotMatchesKnobs", () => {
  it("accepts an exact match", () => {
    expect(snapshotMatchesKnobs(snapshotOf(["a"]), { ...defaultDaqeKnobs() })).toBe(true);
  });

  it("rejects a single changed knob", () => {
    const stored = { ...defaultDaqeKnobs(), energyTarget: 2 };
    expect(snapshotMatchesKnobs(snapshotOf(["a"]), { ...stored })).toBe(false);
  });

  it("rejects a knob-set with a different shape", () => {
    const partial = { energyTarget: 3 } as unknown as Record<string, number>;
    expect(snapshotMatchesKnobs(snapshotOf(["a"]), partial)).toBe(false);
  });
});

describe("projectSnapshot", () => {
  it("returns the pool unchanged when there is no snapshot", () => {
    const pool = [item("a", 0), item("b", 1)];
    const projected = projectSnapshot(pool, null);
    expect(projected.ordered.map((i) => i.id)).toEqual(["a", "b"]);
    expect(projected.breakdowns.size).toBe(0);
    expect(projected.effectiveEnergyTarget).toBeUndefined();
  });

  it("never returns an empty queue for a non-empty pool", () => {
    // The store must always have something to render, even if the snapshot ranks
    // nothing it recognises.
    const pool = [item("a", 0), item("b", 1)];
    const projected = projectSnapshot(pool, snapshotOf(["unrelated"]));
    expect(projected.ordered).toHaveLength(2);
  });

  it("adopts the ranked order", () => {
    const pool = [item("a", 0), item("b", 1), item("c", 2)];
    const projected = projectSnapshot(pool, snapshotOf(["c", "a", "b"]));
    expect(projected.ordered.map((i) => i.id)).toEqual(["c", "a", "b"]);
    expect(projected.orderedIds).toEqual(["c", "a", "b"]);
  });

  it("keeps items the ranker did not place, after the ranked ones", () => {
    const pool = [item("a", 0), item("b", 1), item("orphan", 2)];
    const projected = projectSnapshot(pool, snapshotOf(["b"]));
    expect(projected.ordered.map((i) => i.id)).toEqual(["b", "a", "orphan"]);
  });

  it("does not duplicate an item the snapshot lists twice", () => {
    const pool = [item("a", 0), item("b", 1)];
    const projected = projectSnapshot(pool, snapshotOf(["a", "a", "b"]));
    expect(projected.ordered.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("materialises breakdowns for the visible slice only", () => {
    const order = Array.from({ length: 120 }, (_, i) => `i${i}`);
    const pool = order.map((id, i) => item(id, i));
    const projected = projectSnapshot(pool, snapshotOf(order), 50);

    expect(projected.breakdowns.size).toBe(50);
    expect(breakdownFor(projected, "i0")).toBeDefined();
    expect(breakdownFor(projected, "i49")).toBeDefined();
    expect(breakdownFor(projected, "i50")).toBeUndefined();
  });

  it("reports the effective energy target and its reason", () => {
    const snapshot = snapshotOf(["a"]);
    snapshot.ranked[0].breakdown = breakdown({
      effectiveEnergyTarget: 2,
      energyDownshiftReason: "velocity 28% of baseline",
    });
    const projected = projectSnapshot([item("a", 0)], snapshot);
    expect(projected.effectiveEnergyTarget).toBe(2);
    expect(projected.energyDownshiftReason).toBe("velocity 28% of baseline");
  });

  it("is deterministic for the same inputs", () => {
    const pool = Array.from({ length: 30 }, (_, i) => item(`i${i}`, i));
    const snapshot = snapshotOf(pool.map((i) => i.id).reverse());
    const first = projectSnapshot(pool, snapshot).orderedIds;
    const second = projectSnapshot(pool, snapshot).orderedIds;
    expect(first).toEqual(second);
  });
});

describe("positionOf", () => {
  it("is 1-based", () => {
    const projected = projectSnapshot(
      [item("a", 0), item("b", 1)],
      snapshotOf(["b", "a"]),
    );
    expect(positionOf(projected, "b")).toBe(1);
    expect(positionOf(projected, "a")).toBe(2);
  });

  it("is undefined for an item that is not in the projection", () => {
    const projected = projectSnapshot([item("a", 0)], snapshotOf(["a"]));
    expect(positionOf(projected, "nope")).toBeUndefined();
  });
});

describe("termStatus", () => {
  it("distinguishes measured, defaulted and untracked", () => {
    expect(termStatus({ value: 0.5, available: true, defaulted: false })).toBe("measured");
    expect(termStatus({ value: 0.5, available: true, defaulted: true })).toBe("defaulted");
    expect(termStatus({ value: 0, available: false, defaulted: false })).toBe("untracked");
  });
});