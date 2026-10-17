import { describe, expect, it } from "vitest";
import type { LearningItem } from "../../../api/learning-items";
import {
  getDeckManagerCategoryCounts,
  matchesDeckManagerCategory,
  sortDeckManagerCards,
  type DeckManagerSortField,
} from "../deckManagerModel";

function card(
  id: string,
  overrides: Partial<LearningItem> = {},
): LearningItem {
  return {
    id,
    item_type: "Basic",
    question: id,
    answer: "answer",
    difficulty: 1,
    interval: 1,
    ease_factor: 2.5,
    due_date: "2026-01-01T00:00:00.000Z",
    date_created: "2025-01-01T00:00:00.000Z",
    date_modified: "2025-01-01T00:00:00.000Z",
    review_count: 0,
    lapses: 0,
    state: "New",
    is_suspended: false,
    tags: [],
    ...overrides,
  };
}

describe("Deck Manager category model", () => {
  it("uses one Learning rule for Learning and Relearning membership and counts", () => {
    const cards = [
      card("learning", { state: "Learning" }),
      card("relearning", { state: "Relearning" }),
      card("review", { state: "Review" }),
    ];

    expect(cards.filter((item) => matchesDeckManagerCategory(item, "Learning")).map((item) => item.id))
      .toEqual(["learning", "relearning"]);
    expect(getDeckManagerCategoryCounts(cards)["Learning"]).toBe(2);
    expect(getDeckManagerCategoryCounts(cards)[""]).toBe(3);
  });

  it("preserves New, Review, Suspended, and Leeches membership", () => {
    const cards = [
      card("new", { state: "New" }),
      card("learning", { state: "Learning" }),
      card("relearning", { state: "Relearning" }),
      card("review", { state: "Review" }),
      card("suspended", { state: "Review", is_suspended: true }),
      card("leech", { state: "Review", lapses: 5 }),
    ];
    const expectedCounts = { "": 6, New: 1, Learning: 2, Review: 3, Suspended: 1, Leeches: 1 } as const;
    const counts = getDeckManagerCategoryCounts(cards);

    for (const [category, count] of Object.entries(expectedCounts)) {
      expect(counts[category as keyof typeof counts]).toBe(count);
      expect(cards.filter((item) => matchesDeckManagerCategory(item, category as keyof typeof counts))).toHaveLength(count);
    }
  });
});

describe("Deck Manager sort model", () => {
  const cards = [
    card("a", { state: "New", due_date: "2026-01-03", difficulty: 1, interval: 30, review_count: 3, lapses: 1 }),
    card("b", { state: "Learning", due_date: "2026-01-01", difficulty: 3, interval: 10, review_count: 1, lapses: 0 }),
    card("c", { state: "Review", due_date: "2026-01-02", difficulty: 2, interval: 20, review_count: 2, lapses: 2 }),
  ];
  const expectedAscending: Record<DeckManagerSortField, string[]> = {
    due_date: ["b", "c", "a"],
    state: ["a", "b", "c"],
    difficulty: ["a", "c", "b"],
    interval: ["b", "c", "a"],
    review_count: ["b", "c", "a"],
    lapses: ["b", "a", "c"],
  };

  it.each(Object.keys(expectedAscending) as DeckManagerSortField[])(
    "sorts %s in both directions",
    (field) => {
      const originalIds = cards.map((item) => item.id);
      const ascending = sortDeckManagerCards(cards, field, "asc").map((item) => item.id);
      const descending = sortDeckManagerCards(cards, field, "desc").map((item) => item.id);

      expect(ascending).toEqual(expectedAscending[field]);
      expect(descending).toEqual([...expectedAscending[field]].reverse());
      expect(cards.map((item) => item.id)).toEqual(originalIds);
    },
  );
});
