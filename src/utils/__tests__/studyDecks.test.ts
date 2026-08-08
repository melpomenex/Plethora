import { describe, it, expect } from "vitest";
import {
  computeDeckStats,
  matchesDeck,
  swapDeckTags,
  shouldEnsureBrowserExtensionDeck,
} from "../studyDecks";
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

describe("swapDeckTags", () => {
  const browserDeck: StudyDeck = {
    id: "browser",
    name: "Browser Extension",
    tagFilters: ["browser-extension"],
    filterType: "tags",
  };
  const anatomyDeck: StudyDeck = {
    id: "anatomy",
    name: "Anatomy",
    tagFilters: ["anatomy"],
    filterType: "tags",
  };
  const physiologyDeck: StudyDeck = {
    id: "physiology",
    name: "Physiology",
    tagFilters: ["physiology"],
    filterType: "tags",
  };

  it("preserves provenance tags when moving an extension card to a user deck", () => {
    const tags = ["browser-extension", "image-occlusion"];
    const next = swapDeckTags(tags, [browserDeck, anatomyDeck], anatomyDeck);

    // Spec: "carries anatomy, browser-extension, and image-occlusion" — and
    // nothing else, since those were the only input tags.
    expect(next).toHaveLength(3);
    expect(next).toEqual(expect.arrayContaining(["anatomy", "browser-extension", "image-occlusion"]));
  });

  it("preserves unrelated user tags that are not any deck's filter", () => {
    const tags = ["anatomy", "exam-2027"];
    const next = swapDeckTags(tags, [anatomyDeck, physiologyDeck], physiologyDeck);

    expect(next).toContain("exam-2027");
    expect(next).toContain("physiology");
    expect(next).not.toContain("anatomy");
  });

  it("removes the previous deck's tag when moving between two tag decks", () => {
    const tags = ["anatomy"];
    const next = swapDeckTags(tags, [anatomyDeck, physiologyDeck], physiologyDeck);

    expect(next).toContain("physiology");
    expect(next).not.toContain("anatomy");
  });

  it("keeps all tags when the card matches no deck", () => {
    const tags = ["loner", "browser-extension"];
    const next = swapDeckTags(tags, [anatomyDeck, physiologyDeck], anatomyDeck);

    // target deck's filter is added, non-matching tags survive
    expect(next).toEqual(
      expect.arrayContaining(["loner", "browser-extension", "anatomy"]),
    );
  });

  it("is idempotent when the card is already in the target deck", () => {
    const tags = ["anatomy", "browser-extension"];
    const next = swapDeckTags(tags, [anatomyDeck], anatomyDeck);

    expect(next).toEqual(expect.arrayContaining(["anatomy", "browser-extension"]));
  });

  it("reuses deck: prefix / hierarchy comparison from matchesDeckTags", () => {
    const parentDeck: StudyDeck = {
      id: "biology",
      name: "Biology",
      tagFilters: ["Biology"],
      filterType: "tags",
    };
    // Card sits under the Biology hierarchy; moving out must strip it too.
    const tags = ["deck:Biology::Genetics", "image-occlusion"];
    const next = swapDeckTags(tags, [parentDeck, anatomyDeck], anatomyDeck);

    expect(next).not.toContain("deck:Biology::Genetics");
    expect(next).toContain("image-occlusion");
    expect(next).toContain("anatomy");
  });
});

describe("shouldEnsureBrowserExtensionDeck", () => {
  const extensionCard = { tags: ["browser-extension", "image-occlusion"] };
  const plainCard = { tags: ["biology"] };

  it("returns true when an extension card exists and no deck filters on the tag", () => {
    expect(shouldEnsureBrowserExtensionDeck([extensionCard], [])).toBe(true);
    expect(
      shouldEnsureBrowserExtensionDeck(
        [extensionCard],
        [{ tagFilters: ["biology"] }],
      ),
    ).toBe(true);
  });

  it("returns false when no card carries the tag", () => {
    expect(shouldEnsureBrowserExtensionDeck([plainCard], [])).toBe(false);
    expect(shouldEnsureBrowserExtensionDeck([], [])).toBe(false);
  });

  it("returns false when a deck already filters on browser-extension (idempotent)", () => {
    expect(
      shouldEnsureBrowserExtensionDeck(
        [extensionCard],
        [{ tagFilters: ["browser-extension"] }],
      ),
    ).toBe(false);
  });

  it("does not recreate a renamed deck that still filters on the tag", () => {
    // User renamed "Browser Extension" to "Web Clips"; the deck must not be
    // duplicated because its tag filter still matches.
    const renamedDeck = { tagFilters: ["browser-extension"] };
    expect(shouldEnsureBrowserExtensionDeck([extensionCard], [renamedDeck])).toBe(false);
  });

  it("matches the tag case-insensitively", () => {
    const card = { tags: ["Browser-Extension"] };
    const deck = { tagFilters: ["BROWSER-EXTENSION"] };
    expect(shouldEnsureBrowserExtensionDeck([card], [deck])).toBe(false);
  });
});
