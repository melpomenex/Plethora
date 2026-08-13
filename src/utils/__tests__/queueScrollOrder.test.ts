import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMBINED_SORT_CONFIG,
  MAX_SAME_TYPE_CONSECUTIVE,
  orderScrollItemsByCombinedCriterion,
  orderScrollItemsByPriority,
  selectByQuotaInOrder,
  stableJitter,
  type PrioritizableScrollItem,
} from "../queueScrollOrder";

type Item = PrioritizableScrollItem;

function doc(id: string, score: number): Item {
  return { id, type: "document", engagementScore: score };
}
function card(id: string, score: number): Item {
  return { id, type: "flashcard", engagementScore: score };
}

describe("orderScrollItemsByPriority", () => {
  it("sorts by engagementScore descending", () => {
    const items = [
      card("c1", 2),
      doc("d1", 9),
      card("c2", 5),
      doc("d2", 7),
    ];
    const ordered = orderScrollItemsByPriority(items).map((i) => i.id);
    // 9, 7, 5, 2 -> d1, d2, c2, c1
    expect(ordered).toEqual(["d1", "d2", "c2", "c1"]);
  });

  it("interleaves types when priorities permit rather than clustering by type", () => {
    // The reported bug: a flashcard-leaning source yielded all flashcards
    // sequentially and the documents were absent. With documents present and
    // the priority sort applied, documents and flashcards interleave by
    // priority rather than segregating. Here interleaved priorities produce a
    // mixed order, and the variety guard caps same-type runs.
    const items = [
      doc("d1", 10),
      card("c1", 9),
      doc("d2", 8),
      card("c2", 7),
      doc("d3", 6),
      card("c3", 5),
      doc("d4", 4),
    ];
    const ordered = orderScrollItemsByPriority(items);
    // Each document has a higher priority than the card after it, so the order
    // is strictly d1,c1,d2,c2,d3,c3,d4 — types alternate, never clustering.
    const types = ordered.map((i) => i.type);
    expect(longestRunOf(types, "document")).toBe(1);
    expect(longestRunOf(types, "flashcard")).toBe(1);
  });

  it("surfaces the higher-priority type first even in a card-heavy source", () => {
    // A single high-priority document among many lower-priority cards must
    // surface at the front (priority wins), and the cards follow. This is the
    // core of the reported bug fix: the document is no longer absent.
    const items = [
      doc("d1", 10),
      card("c1", 8),
      card("c2", 6),
      card("c3", 4),
      card("c4", 2),
    ];
    const ordered = orderScrollItemsByPriority(items);
    expect(ordered[0].id).toBe("d1");
    // The document is present (the bug was its absence), and it leads.
    expect(ordered.map((i) => i.id)).toContain("d1");
  });

  it("breaks same-type runs that exceed the cap", () => {
    // Six flashcards all at the same priority would otherwise be consecutive.
    const items = Array.from({ length: 6 }, (_, i) =>
      card(`c${i}`, 5)
    );
    // Add two documents so there's something to interleave with.
    items.push(doc("d0", 5), doc("d1", 5));
    const ordered = orderScrollItemsByPriority(items);
    const types = ordered.map((i) => i.type);
    expect(longestRunOf(types, "flashcard")).toBeLessThanOrEqual(
      MAX_SAME_TYPE_CONSECUTIVE
    );
  });

  it("does not reorder across priority tiers", () => {
    // A higher-priority document must precede lower-priority flashcards even
    // when the flashcards would otherwise cluster.
    const items = [
      doc("d-high", 10),
      ...Array.from({ length: 5 }, (_, i) => card(`c${i}`, 1)),
    ];
    const ordered = orderScrollItemsByPriority(items);
    // The document is strictly highest priority; it must be first.
    expect(ordered[0].id).toBe("d-high");
  });

  it("tiebreaks equal priorities by id for determinism", () => {
    const items = [card("z", 5), card("a", 5), card("m", 5)];
    const ordered = orderScrollItemsByPriority(items).map((i) => i.id);
    expect(ordered).toEqual(["a", "m", "z"]);
  });

  it("is stable across calls (no random reshuffle)", () => {
    const items = [card("c1", 3), doc("d1", 7), card("c2", 5)];
    const a = orderScrollItemsByPriority(items).map((i) => i.id);
    const b = orderScrollItemsByPriority(items).map((i) => i.id);
    expect(a).toEqual(b);
  });

  it("returns short inputs unchanged", () => {
    const items = [card("c1", 1), card("c2", 2)];
    expect(orderScrollItemsByPriority(items).map((i) => i.id)).toEqual([
      "c2",
      "c1",
    ]);
  });

  it("treats missing engagementScore as zero", () => {
    const items = [
      { id: "a", type: "document" } as Item, // no score
      card("b", 1),
    ];
    const ordered = orderScrollItemsByPriority(items).map((i) => i.id);
    expect(ordered).toEqual(["b", "a"]);
  });

  it("preserves all input items", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? doc(`d${i}`, i) : card(`c${i}`, i)
    );
    const ordered = orderScrollItemsByPriority(items);
    expect(ordered).toHaveLength(items.length);
    expect(new Set(ordered.map((i) => i.id))).toEqual(
      new Set(items.map((i) => i.id))
    );
  });
});

describe("stableJitter", () => {
  it("is deterministic for the same id and bounded in [-1, 1)", () => {
    const a = stableJitter("card-123");
    const b = stableJitter("card-123");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(-1);
    expect(a).toBeLessThan(1);
  });

  it("differs for different ids", () => {
    expect(stableJitter("a")).not.toBe(stableJitter("b"));
  });
});

describe("orderScrollItemsByCombinedCriterion", () => {
  it("surfaces the highest-priority item first", () => {
    const items = [
      card("c1", 10),
      doc("d1", 90),
      card("c2", 50),
    ];
    const ordered = orderScrollItemsByCombinedCriterion(items);
    expect(ordered[0].id).toBe("d1");
  });

  it("interleaves topics and items when priorities are equal", () => {
    // 3 docs + 3 cards all at priority 50: the proportion bias should prevent
    // a long same-type run.
    const items = [
      doc("d1", 50),
      doc("d2", 50),
      doc("d3", 50),
      card("c1", 50),
      card("c2", 50),
      card("c3", 50),
    ];
    const ordered = orderScrollItemsByCombinedCriterion(items);
    const types = ordered.map((i) => i.type);
    expect(longestRunOf(types, "document")).toBeLessThanOrEqual(2);
    expect(longestRunOf(types, "flashcard")).toBeLessThanOrEqual(2);
  });

  it("is deterministic across calls (same input → same order)", () => {
    const items = [
      doc("d1", 50),
      card("c1", 50),
      doc("d2", 50),
      card("c2", 50),
    ];
    const a = orderScrollItemsByCombinedCriterion(items).map((i) => i.id);
    const b = orderScrollItemsByCombinedCriterion(items).map((i) => i.id);
    expect(a).toEqual(b);
  });

  it("preserves all input items", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0 ? doc(`d${i}`, i * 10) : card(`c${i}`, i * 10),
    );
    const ordered = orderScrollItemsByCombinedCriterion(items);
    expect(ordered).toHaveLength(items.length);
    expect(new Set(ordered.map((i) => i.id))).toEqual(
      new Set(items.map((i) => i.id)),
    );
  });

  it("returns short inputs without dropping items", () => {
    const items = [card("c1", 5)];
    expect(orderScrollItemsByCombinedCriterion(items)).toEqual(items);
  });
});

describe("orderScrollItemsByCombinedCriterion targetTopicShare", () => {
  // Counts match the 60/40 target exactly (24 topics, 16 items), so the mix
  // can be sustained end to end and no type is exhausted early — a
  // same-type tail would otherwise be forced by availability, not by the sort.
  const equalMix = () => [
    ...Array.from({ length: 24 }, (_, i) => doc(`d${i}`, 50)),
    ...Array.from({ length: 16 }, (_, i) => card(`c${i}`, 50)),
  ];

  it("a 60/40 target puts ~12 documents and ~8 flashcards in the first 20 items", () => {
    const ordered = orderScrollItemsByCombinedCriterion(equalMix(), {
      ...DEFAULT_COMBINED_SORT_CONFIG,
      targetTopicShare: 0.6,
    });
    const first20 = ordered.slice(0, 20);
    const docs = first20.filter((item) => item.type === "document").length;
    const cards = first20.length - docs;
    expect(docs).toBeGreaterThanOrEqual(10);
    expect(docs).toBeLessThanOrEqual(14);
    expect(cards).toBeGreaterThanOrEqual(6);
    expect(cards).toBeLessThanOrEqual(10);
    // The same-type run guard holds end to end when the counts match the
    // target.
    const types = ordered.map((item) => item.type);
    expect(longestRunOf(types, "document")).toBeLessThanOrEqual(
      MAX_SAME_TYPE_CONSECUTIVE
    );
    expect(longestRunOf(types, "flashcard")).toBeLessThanOrEqual(
      MAX_SAME_TYPE_CONSECUTIVE
    );
  });

  it("a 1.0 target applies no proportion bias (identical to a 0.0 target)", () => {
    const items = equalMix();
    const full = orderScrollItemsByCombinedCriterion(items, {
      ...DEFAULT_COMBINED_SORT_CONFIG,
      targetTopicShare: 1,
    });
    const none = orderScrollItemsByCombinedCriterion(items, {
      ...DEFAULT_COMBINED_SORT_CONFIG,
      targetTopicShare: 0,
    });
    expect(full.map((item) => item.id)).toEqual(none.map((item) => item.id));
    // And the bias is genuinely active for an interior target: the 0.5 order
    // alternates, so it must differ from the unbiased order.
    const half = orderScrollItemsByCombinedCriterion(items, {
      ...DEFAULT_COMBINED_SORT_CONFIG,
      targetTopicShare: 0.5,
    });
    expect(half.map((item) => item.id)).not.toEqual(none.map((item) => item.id));
  });
});

function longestRunOf<T>(arr: T[], value: T): number {
  let max = 0;
  let cur = 0;
  for (const v of arr) {
    if (v === value) {
      cur++;
      max = Math.max(max, cur);
    } else {
      cur = 0;
    }
  }
  return max;
}

describe("selectByQuotaInOrder", () => {
  it("keeps the list order while honouring the per-type quota", () => {
    const items = [doc("d1", 9), card("c1", 8), doc("d2", 7), card("c2", 6), doc("d3", 5)];

    const { selected, shortfall } = selectByQuotaInOrder(items, {
      documents: 2,
      extracts: 0,
      flashcards: 1,
    });

    expect(selected.map((item) => item.id)).toEqual(["d1", "c1", "d2"]);
    expect(shortfall).toEqual({ documents: 0, extracts: 0, flashcards: 0 });
  });

  it("reports the shortfall when a type is under-supplied", () => {
    const { selected, shortfall } = selectByQuotaInOrder([doc("d1", 9)], {
      documents: 3,
      extracts: 1,
      flashcards: 2,
    });

    expect(selected.map((item) => item.id)).toEqual(["d1"]);
    expect(shortfall).toEqual({ documents: 2, extracts: 1, flashcards: 2 });
  });

  it("draws RSS articles from the documents share", () => {
    const rss: PrioritizableScrollItem = { id: "r1", type: "rss", engagementScore: 9 };

    const { selected } = selectByQuotaInOrder([rss, doc("d1", 8)], {
      documents: 1,
      extracts: 0,
      flashcards: 0,
    });

    expect(selected.map((item) => item.id)).toEqual(["r1"]);
  });
});
