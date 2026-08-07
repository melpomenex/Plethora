import { describe, expect, it } from "vitest";
import { FLASHCARD_REVEAL_EVENT, resolveScrollRatingKey } from "../queueScrollKeyboard";

describe("resolveScrollRatingKey", () => {
  it("Space reveals an unrevealed flashcard", () => {
    expect(
      resolveScrollRatingKey(" ", { itemType: "flashcard", flashcardRevealed: false, isRating: false })
    ).toEqual({ kind: "reveal-flashcard" });
  });

  it("Space does nothing for an already-revealed flashcard", () => {
    expect(
      resolveScrollRatingKey(" ", { itemType: "flashcard", flashcardRevealed: true, isRating: false })
    ).toBeNull();
  });

  it("Space does nothing for non-flashcard items", () => {
    for (const itemType of ["document", "extract", "rss", "podcast"] as const) {
      expect(
        resolveScrollRatingKey(" ", { itemType, flashcardRevealed: false, isRating: false })
      ).toBeNull();
    }
  });

  it("1-4 rate non-flashcard items (Again/Hard/Good/Easy)", () => {
    for (const key of ["1", "2", "3", "4"]) {
      expect(
        resolveScrollRatingKey(key, { itemType: "document", flashcardRevealed: false, isRating: false })
      ).toEqual({ kind: "rate", rating: Number(key) });
    }
  });

  it("rates a flashcard only after its answer is revealed", () => {
    expect(
      resolveScrollRatingKey("3", { itemType: "flashcard", flashcardRevealed: false, isRating: false })
    ).toBeNull();
    expect(
      resolveScrollRatingKey("3", { itemType: "flashcard", flashcardRevealed: true, isRating: false })
    ).toEqual({ kind: "rate", rating: 3 });
  });

  it("does not rate while a rating is in flight", () => {
    expect(
      resolveScrollRatingKey("3", { itemType: "document", flashcardRevealed: false, isRating: true })
    ).toBeNull();
  });

  it("does nothing when nothing is showing", () => {
    expect(
      resolveScrollRatingKey("3", { itemType: undefined, flashcardRevealed: false, isRating: false })
    ).toBeNull();
    expect(
      resolveScrollRatingKey(" ", { itemType: undefined, flashcardRevealed: false, isRating: false })
    ).toBeNull();
  });

  it("ignores unrelated keys", () => {
    for (const key of ["ArrowDown", "5", "0", "a", "Escape", "PageDown", "Enter", "F11"]) {
      expect(
        resolveScrollRatingKey(key, { itemType: "document", flashcardRevealed: false, isRating: false })
      ).toBeNull();
    }
  });

  it("exposes the reveal-request event name shared with the flashcard card", () => {
    expect(FLASHCARD_REVEAL_EVENT).toBe("incrementum:flashcard-reveal-request");
  });
});
