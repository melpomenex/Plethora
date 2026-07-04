import { describe, it, expect } from "vitest";
import { matchesDeck } from "../studyDecks";
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
});
