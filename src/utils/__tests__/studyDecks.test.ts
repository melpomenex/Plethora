import { describe, it, expect } from "vitest";
import { computeDeckStats, matchesDeck } from "../studyDecks";
import type { StudyDeck } from "../../types/study-decks";

describe("matchesDeck", () => {
  const sampleCard = {
    tags: ["math", "physics"],
    document_id: "doc-123",
    difficulty: 4,
    state: "New",
  };

  it("should match when deck is null", () => {
    expect(matchesDeck(sampleCard, null)).toBe(true);
  });

  it("should filter by documentId when deck.documentId is defined", () => {
    const deckMatchingDoc: StudyDeck = {
      id: "deck-1",
      name: "My Doc Deck",
      tagFilters: [],
      documentId: "doc-123",
      filterType: "all",
    };
    const deckMismatchDoc: StudyDeck = {
      id: "deck-2",
      name: "Other Doc Deck",
      tagFilters: [],
      documentId: "doc-other",
      filterType: "all",
    };

    expect(matchesDeck(sampleCard, deckMatchingDoc)).toBe(true);
    expect(matchesDeck(sampleCard, deckMismatchDoc)).toBe(false);
  });

  it("should support both document_id and documentId on card", () => {
    const deck: StudyDeck = {
      id: "deck-1",
      name: "My Doc Deck",
      tagFilters: [],
      documentId: "doc-123",
      filterType: "all",
    };

    const cardWithCamelCase = {
      tags: [],
      documentId: "doc-123",
    };

    const cardWithSnakeCase = {
      tags: [],
      document_id: "doc-123",
    };

    expect(matchesDeck(cardWithCamelCase, deck)).toBe(true);
    expect(matchesDeck(cardWithSnakeCase, deck)).toBe(true);
  });

  it("should filter by cramType in matchesDeck", () => {
    const cramDeck: StudyDeck = {
      id: "deck-1",
      name: "Cram Deck",
      tagFilters: [],
      documentId: "doc-123",
      filterType: "cram",
    };

    const newCard = {
      tags: [],
      document_id: "doc-123",
      state: "New",
      due_date: new Date(Date.now() + 100000).toISOString(),
    };

    const dueCard = {
      tags: [],
      document_id: "doc-123",
      state: "Review",
      due_date: new Date(Date.now() - 100000).toISOString(),
    };

    const notDueCard = {
      tags: [],
      document_id: "doc-123",
      state: "Review",
      due_date: new Date(Date.now() + 100000).toISOString(),
      lapses: 0,
    };

    expect(matchesDeck(newCard, cramDeck)).toBe(true);
    expect(matchesDeck(dueCard, cramDeck)).toBe(true);
    expect(matchesDeck(notDueCard, cramDeck)).toBe(false);
  });

  it("should filter by difficultyType in matchesDeck", () => {
    const difficultyDeck: StudyDeck = {
      id: "deck-1",
      name: "Hard Deck",
      tagFilters: [],
      documentId: "doc-123",
      filterType: "difficulty",
      difficultyFilters: [4, 5],
    };

    const easyCard = {
      tags: [],
      document_id: "doc-123",
      difficulty: 2,
    };

    const hardCard = {
      tags: [],
      document_id: "doc-123",
      difficulty: 5,
    };

    expect(matchesDeck(easyCard, difficultyDeck)).toBe(false);
    expect(matchesDeck(hardCard, difficultyDeck)).toBe(true);
  });
  it("should filter by tags including deck: prefix and tree-like sub-decks", () => {
    const tagDeck: StudyDeck = {
      id: "deck-1",
      name: "Biology",
      tagFilters: ["Biology"],
      filterType: "tags",
    };

    const directTagCard = {
      tags: ["Biology"],
    };

    const prefixedTagCard = {
      tags: ["deck:Biology"],
    };

    const subdeckTagCard = {
      tags: ["deck:Biology::CellStructure"],
    };

    const slashSubdeckTagCard = {
      tags: ["deck:Biology/Genetics"],
    };

    const unrelatedTagCard = {
      tags: ["deck:Chemistry"],
    };

    expect(matchesDeck(directTagCard, tagDeck)).toBe(true);
    expect(matchesDeck(prefixedTagCard, tagDeck)).toBe(true);
    expect(matchesDeck(subdeckTagCard, tagDeck)).toBe(true);
    expect(matchesDeck(slashSubdeckTagCard, tagDeck)).toBe(true);
    expect(matchesDeck(unrelatedTagCard, tagDeck)).toBe(false);
  });
});

describe("computeDeckStats", () => {
  const deck: StudyDeck = {
    id: "deck-1",
    name: "Biology",
    tagFilters: ["Biology"],
    filterType: "tags",
  };

  it("reports a non-zero total with 0 due for a deck whose cards are all not-yet-due", () => {
    const oneWeekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const items = [
      { tags: ["Biology"], state: "New", due_date: oneWeekFromNow },
      { tags: ["Biology"], state: "Review", due_date: oneWeekFromNow },
    ];

    const [stat] = computeDeckStats([deck], items);

    expect(stat.total).toBe(2);
    expect(stat.due).toBe(0);
  });

  it("reports total 0 for a deck with no matching cards", () => {
    const items = [{ tags: ["Chemistry"], state: "New" }];

    const [stat] = computeDeckStats([deck], items);

    expect(stat.total).toBe(0);
    expect(stat.due).toBe(0);
    expect(stat.newCount).toBe(0);
  });

  it("classifies matched cards into new/learning/review buckets", () => {
    const items = [
      { tags: ["Biology"], state: "New" },
      { tags: ["Biology"], state: "Learning" },
      { tags: ["Biology"], state: "Relearning" },
      { tags: ["Biology"], state: "Review" },
      { tags: ["Chemistry"], state: "Review" },
    ];

    const [stat] = computeDeckStats([deck], items);

    expect(stat.total).toBe(4);
    expect(stat.newCount).toBe(1);
    expect(stat.learningCount).toBe(2);
    expect(stat.reviewCount).toBe(1);
  });

  it("counts a card as due when its due date is today or earlier, or missing", () => {
    const items = [
      { tags: ["Biology"], state: "Review", due_date: new Date(Date.now() - 100000).toISOString() },
      { tags: ["Biology"], state: "New" },
    ];

    const [stat] = computeDeckStats([deck], items);

    expect(stat.due).toBe(2);
  });

  it("produces identical totals for the same items/decks across repeated calls (list vs. modal parity)", () => {
    const items = [
      { tags: ["Biology"], state: "New" },
      { tags: ["Biology"], state: "Review", due_date: new Date(Date.now() - 1000).toISOString() },
    ];

    const forDeckList = computeDeckStats([deck], items);
    const forModal = computeDeckStats([deck], items);

    expect(forModal).toEqual(forDeckList);
  });
});
