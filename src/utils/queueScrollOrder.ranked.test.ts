import { describe, expect, it } from "vitest";
import {
  MAX_SAME_TYPE_CONSECUTIVE,
  interleaveShare,
  measureRankedScale,
  orderRankedScrollItems,
  orderScrollItemsByCombinedCriterion,
  type RankedScrollItem,
} from "./queueScrollOrder";

function ranked(
  id: string,
  priority: number,
  topics: string[] = [],
  type: RankedScrollItem["type"] = "flashcard",
): RankedScrollItem {
  return { id, type, engagementScore: priority, priority, topics };
}

describe("measureRankedScale", () => {
  it("reports the observed spread", () => {
    const scale = measureRankedScale([{ priority: 0.2 }, { priority: 0.9 }]);
    expect(scale.min).toBeCloseTo(0.2);
    expect(scale.max).toBeCloseTo(0.9);
  });

  it("reports no spread for a single item", () => {
    const scale = measureRankedScale([{ priority: 0.5 }]);
    expect(scale.max - scale.min).toBe(0);
  });

  it("reports no spread for an empty pool", () => {
    expect(measureRankedScale([])).toEqual({ min: 0, max: 0 });
  });
});

describe("interleaveShare", () => {
  it("is zero at the knob's floor", () => {
    expect(interleaveShare({ diversity: 0, jitterWeight: 5 }).penaltyShare).toBe(0);
  });

  it("is bounded by half the spread at the knob's ceiling", () => {
    expect(interleaveShare({ diversity: 1, jitterWeight: 5 }).penaltyShare).toBe(0.5);
  });

  it("clamps an out-of-range knob", () => {
    expect(interleaveShare({ diversity: 5, jitterWeight: 1 }).penaltyShare).toBe(0.5);
    expect(interleaveShare({ diversity: -1, jitterWeight: 1 }).penaltyShare).toBe(0);
  });
});

describe("orderRankedScrollItems", () => {
  const pool = [
    ranked("a", 0.9, ["transformers"]),
    ranked("b", 0.85, ["transformers"]),
    ranked("c", 0.8, ["transformers"]),
    ranked("d", 0.5, ["cooking"]),
    ranked("e", 0.45, ["cooking"]),
    ranked("f", 0.2, ["gardening"]),
  ];

  it("orders by the composite score when the interleave knob is off", () => {
    const ordered = orderRankedScrollItems(pool, { diversity: 0, jitterWeight: 0 });
    expect(ordered.map((i) => i.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("lifts an off-topic item into a run of one topic", () => {
    const flat = orderRankedScrollItems(pool, { diversity: 0, jitterWeight: 0 });
    const varied = orderRankedScrollItems(pool, { diversity: 1, jitterWeight: 0 });

    expect(flat.map((i) => i.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    // A:0.9 t, B:0.85 t, C:0.8 t, D:0.5 cooking, E:0.45 cooking, F:0.2 garden.
    // With the knob up, D interrupts the transformer run before B and C appear.
    expect(varied.map((i) => i.id)).toEqual(["a", "d", "b", "c", "e", "f"]);

    // The longest run of consecutive same-topic items shrinks.
    const longestRun = (order: RankedScrollItem[], topicOf: (i: RankedScrollItem) => string) => {
      let best = 0;
      let current = 0;
      let previous: string | null = null;
      for (const item of order) {
        const topic = topicOf(item);
        current = topic === previous ? current + 1 : 1;
        previous = topic;
        if (current > best) best = current;
      }
      return best;
    };
    const topicOf = (i: RankedScrollItem) => i.topics?.[0] ?? "none";
    expect(longestRun(varied, topicOf)).toBeLessThan(longestRun(flat, topicOf));
  });

  it("never lets a topic bonus overtake the composite score", () => {
    // Two items: the better one is only just ahead, and the bonus is capped at
    // half the spread, so the ordering survives.
    const tight = [
      ranked("better", 0.61, ["x"]),
      ranked("worse", 0.60, ["y", "z"]),
    ];
    const ordered = orderRankedScrollItems(tight, { diversity: 1, jitterWeight: 0 });
    expect(ordered[0].id).toBe("better");
  });

  it("is deterministic for an unchanged pool", () => {
    const first = orderRankedScrollItems(pool, { diversity: 0.5 });
    const second = orderRankedScrollItems(pool, { diversity: 0.5 });
    expect(first.map((i) => i.id)).toEqual(second.map((i) => i.id));
  });

  it("orders a flat pool by jitter without dividing by a zero spread", () => {
    const flat = [ranked("a", 0.5), ranked("b", 0.5), ranked("c", 0.5)];
    const ordered = orderRankedScrollItems(flat, { diversity: 1, jitterWeight: 1 });
    expect(ordered).toHaveLength(3);
    expect(new Set(ordered.map((i) => i.id)).size).toBe(3);
  });

  it("handles an empty or single-item pool", () => {
    expect(orderRankedScrollItems([], { diversity: 1 })).toEqual([]);
    expect(orderRankedScrollItems([ranked("a", 0.5)], { diversity: 1 }).map((i) => i.id)).toEqual(["a"]);
  });

  it("never penalises an item that carries no topics", () => {
    const topicless = [ranked("a", 0.9, []), ranked("b", 0.5, []), ranked("c", 0.1, [])];
    for (const diversity of [0, 0.5, 1]) {
      expect(orderRankedScrollItems(topicless, { diversity, jitterWeight: 0 }).map((i) => i.id))
        .toEqual(["a", "b", "c"]);
    }
  });

  it("lets a topicless item rise past a repeat of a run", () => {
    const mixed = [
      ranked("top", 0.9, ["t"]),
      ranked("mid", 0.7, ["t"]),
      ranked("notopic", 0.6, []),
    ];
    const pos = (order: RankedScrollItem[], id: string) => order.findIndex((i) => i.id === id);
    const withoutPenalty = orderRankedScrollItems(mixed, { diversity: 0, jitterWeight: 0 });
    const withPenalty = orderRankedScrollItems(mixed, { diversity: 1, jitterWeight: 0 });

    // `mid` repeats `t` and is penalised; `notopic` cannot be a repeat, so it
    // overtakes it despite a lower score.
    expect(pos(withoutPenalty, "notopic")).toBe(2);
    expect(pos(withPenalty, "notopic")).toBe(1);
  });
});

describe("the two sorts coexist", () => {
  it("keeps the legacy combined sort and its variety guard intact", () => {
    // `orderScrollItemsByCombinedCriterion` still serves the pre-DAQE path; this
    // asserts the guard constant it depends on is unchanged.
    expect(MAX_SAME_TYPE_CONSECUTIVE).toBe(3);
    const items = [
      ranked("a", 9, [], "flashcard"),
      ranked("b", 9, [], "flashcard"),
      ranked("c", 9, [], "flashcard"),
      ranked("d", 8, [], "flashcard"),
      ranked("e", 7, [], "document"),
    ];
    const ordered = orderScrollItemsByCombinedCriterion(items);
    expect(ordered).toHaveLength(5);
    expect(ordered.map((i) => i.id)).toContain("e");
  });
});
