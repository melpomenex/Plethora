import { describe, expect, it } from "vitest";
import {
  FLASHCARD_REVEAL_EVENT,
  resolveScrollRatingKey,
  usesNativeGradeKeys,
} from "../queueScrollKeyboard";

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
    expect(FLASHCARD_REVEAL_EVENT).toBe("plethora:flashcard-reveal-request");
  });
});

describe("resolveScrollRatingKey under the SuperMemo six-grade schema", () => {
  const nativeCtx = { itemType: "flashcard" as const, flashcardRevealed: true, isRating: false, nativeGrades: true };

  it("0-5 each submit the exact grade with its equivalent rating", () => {
    const expected: Record<string, { rating: number; grade: number }> = {
      "0": { rating: 1, grade: 0 },
      "1": { rating: 1, grade: 1 },
      "2": { rating: 1, grade: 2 },
      "3": { rating: 2, grade: 3 },
      "4": { rating: 3, grade: 4 },
      "5": { rating: 4, grade: 5 },
    };
    for (const [key, { rating, grade }] of Object.entries(expected)) {
      expect(resolveScrollRatingKey(key, nativeCtx)).toEqual({
        kind: "rate",
        rating,
        grade,
      });
    }
  });

  it("works for non-flashcard items too (documents rate directly)", () => {
    expect(
      resolveScrollRatingKey("5", { itemType: "document", flashcardRevealed: false, isRating: false, nativeGrades: true })
    ).toEqual({ kind: "rate", rating: 4, grade: 5 });
  });

  it("documents NEVER get grade keys: even under SM-20 the caller gates nativeGrades to flashcards", () => {
    // This is the wiring the scroll page uses — a document under a SuperMemo
    // scheduler still rates on plain 1-4 keys matching its four-orb UI.
    const nativeGrades = usesNativeGradeKeys("document", "sm20");
    expect(nativeGrades).toBe(false);
    for (const key of ["1", "2", "3", "4"]) {
      expect(
        resolveScrollRatingKey(key, { itemType: "document", flashcardRevealed: false, isRating: false, nativeGrades })
      ).toEqual({ kind: "rate", rating: Number(key) });
    }
    for (const key of ["0", "5"]) {
      expect(
        resolveScrollRatingKey(key, { itemType: "document", flashcardRevealed: false, isRating: false, nativeGrades })
      ).toBeNull();
    }
  });

  it("flashcards still reveal first: 0-5 do nothing before the reveal", () => {
    expect(
      resolveScrollRatingKey("3", { itemType: "flashcard", flashcardRevealed: false, isRating: false, nativeGrades: true })
    ).toBeNull();
    // Space reveals instead.
    expect(
      resolveScrollRatingKey(" ", { itemType: "flashcard", flashcardRevealed: false, isRating: false, nativeGrades: true })
    ).toEqual({ kind: "reveal-flashcard" });
  });

  it("nothing submits while a rating is in flight", () => {
    expect(
      resolveScrollRatingKey("0", { itemType: "flashcard", flashcardRevealed: true, isRating: true, nativeGrades: true })
    ).toBeNull();
  });

  it("0 and 5 remain inert under the four-grade schema; 1-4 unchanged", () => {
    for (const key of ["0", "5", "6", "9"]) {
      expect(
        resolveScrollRatingKey(key, { itemType: "flashcard", flashcardRevealed: true, isRating: false })
      ).toBeNull();
    }
    // 1-4 still submit plain ratings (no grade) under the four-grade schema —
    // the Review/Queue four-grade keyboard behavior is unchanged.
    for (const key of ["1", "2", "3", "4"]) {
      expect(
        resolveScrollRatingKey(key, { itemType: "flashcard", flashcardRevealed: true, isRating: false })
      ).toEqual({ kind: "rate", rating: Number(key) });
    }
  });
});

describe("usesNativeGradeKeys (which items get 0-5 grade keys)", () => {
  it("flashcards get grade keys only under SuperMemo six-grade schedulers", () => {
    expect(usesNativeGradeKeys("flashcard", "sm18")).toBe(true);
    expect(usesNativeGradeKeys("flashcard", "sm20")).toBe(true);
  });

  it("flashcards under four-grade schedulers keep 1-4 rating keys", () => {
    for (const algorithm of ["fsrs", "sm2", "sm5", "sm8", "sm15"] as const) {
      expect(usesNativeGradeKeys("flashcard", algorithm)).toBe(false);
    }
    expect(usesNativeGradeKeys("flashcard", undefined)).toBe(false);
  });

  it("every non-flashcard item type keeps 1-4 rating keys even under SM-20", () => {
    // Documents/extracts are scheduled by four-grade schedulers (FSRS-6
    // engagement for documents) regardless of the flashcard algorithm.
    for (const itemType of ["document", "extract", "rss", "podcast"] as const) {
      expect(usesNativeGradeKeys(itemType, "sm20")).toBe(false);
      expect(usesNativeGradeKeys(itemType, "sm18")).toBe(false);
    }
  });

  it("no item showing → no grade keys", () => {
    expect(usesNativeGradeKeys(undefined, "sm20")).toBe(false);
  });
});
