import { describe, expect, it } from "vitest";
import { composeSession } from "../queueScrollBudget";

describe("composeSession", () => {
  // The reported bug: the sequential path ignored the flashcard slider, so a
  // reading-mode queue never surfaced its due flashcards (371 documents, 6 due
  // extracts, 1037 due flashcards on the reporting machine).
  it("45/0/55 against {371, 6, 1037} yields exactly the 55% flashcard share", () => {
    const result = composeSession({
      targets: { documents: 45, extracts: 0, flashcards: 55 },
      available: { documents: 371, extracts: 6, flashcards: 1037 },
    });
    // N = 371 / 0.45 = 824.44... -> an 824-item session; 55% of that is 453.
    expect(result.documents).toBe(371);
    expect(result.extracts).toBe(0);
    expect(result.flashcards).toBe(453);
    const total = result.documents + result.extracts + result.flashcards;
    expect(total).toBe(824);
    expect(result.flashcards / total).toBeCloseTo(0.55, 1);
  });

  it("40/20/40 yields all 6 extracts with the session size unchanged at 928", () => {
    const result = composeSession({
      targets: { documents: 40, extracts: 20, flashcards: 40 },
      available: { documents: 371, extracts: 6, flashcards: 1037 },
    });
    // N = 371 / 0.4 = 927.5 -> 928. The 180 unusable extract slots are
    // redistributed to documents (already capped) and flashcards.
    expect(result).toEqual({
      documents: 371,
      extracts: 6,
      flashcards: 551,
      shortfall: { documents: 0, extracts: 180, flashcards: 0 },
    });
    const total = result.documents + result.extracts + result.flashcards;
    expect(total).toBe(928);
  });

  it("a zeroed type contributes nothing even when its items are available", () => {
    const result = composeSession({
      targets: { documents: 50, extracts: 0, flashcards: 50 },
      available: { documents: 100, extracts: 40, flashcards: 100 },
    });
    expect(result.extracts).toBe(0);
    // N = 100 / 0.5 = 200; the whole session splits between the two active types.
    const total = result.documents + result.flashcards;
    expect(total).toBe(200);
  });

  it("targets that do not sum to 100 are normalized to shares", () => {
    const result = composeSession({
      targets: { documents: 50, extracts: 50, flashcards: 50 },
      available: { documents: 300, extracts: 300, flashcards: 300 },
    });
    expect(result.documents).toBe(result.extracts);
    expect(result.extracts).toBe(result.flashcards);
  });

  it("all-zero targets return zeros", () => {
    expect(
      composeSession({
        targets: { documents: 0, extracts: 0, flashcards: 0 },
        available: { documents: 10, extracts: 10, flashcards: 10 },
      })
    ).toEqual({
      documents: 0,
      extracts: 0,
      flashcards: 0,
      shortfall: { documents: 0, extracts: 0, flashcards: 0 },
    });
  });

  it("only-one-type-available yields a single-type session", () => {
    const result = composeSession({
      targets: { documents: 1, extracts: 1, flashcards: 1 },
      available: { documents: 10, extracts: 0, flashcards: 0 },
    });
    expect(result).toEqual({
      documents: 10,
      extracts: 0,
      flashcards: 0,
      shortfall: { documents: 0, extracts: 10, flashcards: 10 },
    });
  });

  it("anchors on the remaining active type with the largest target when documents are unavailable", () => {
    const result = composeSession({
      targets: { documents: 60, extracts: 15, flashcards: 25 },
      available: { documents: 0, extracts: 30, flashcards: 100 },
    });
    // Anchor falls back to flashcards (larger target than extracts, 100
    // available): N = 100 / 0.25 = 400, of which extracts can only supply 30.
    expect(result).toEqual({
      documents: 0,
      extracts: 30,
      flashcards: 100,
      shortfall: { documents: 240, extracts: 30, flashcards: 0 },
    });
  });

  it("no count ever exceeds availability", () => {
    const result = composeSession({
      targets: { documents: 10, extracts: 10, flashcards: 80 },
      available: { documents: 5, extracts: 5, flashcards: 3 },
    });
    expect(result.documents).toBeLessThanOrEqual(5);
    expect(result.extracts).toBeLessThanOrEqual(5);
    expect(result.flashcards).toBeLessThanOrEqual(3);
  });

  it("does not pad beyond what is available when every type is exhausted", () => {
    const result = composeSession({
      targets: { documents: 60, extracts: 15, flashcards: 25 },
      available: { documents: 4, extracts: 2, flashcards: 1 },
    });
    expect(result).toEqual({
      documents: 4,
      extracts: 2,
      flashcards: 1,
      shortfall: { documents: 0, extracts: 0, flashcards: 1 },
    });
  });

  it("60/0/40 against a plentiful pool holds the 60:40 ratio with no shortfall", () => {
    const result = composeSession({
      targets: { documents: 60, extracts: 0, flashcards: 40 },
      available: { documents: 200, extracts: 100, flashcards: 200 },
    });
    // N = 200 / 0.6 = 333.33 -> 333 items; the 40% flashcard share is 133.
    expect(result).toEqual({
      documents: 200,
      extracts: 0,
      flashcards: 133,
      shortfall: { documents: 0, extracts: 0, flashcards: 0 },
    });
    const total = result.documents + result.flashcards;
    expect(result.documents / total).toBeCloseTo(0.6, 1);
    expect(result.flashcards / total).toBeCloseTo(0.4, 1);
  });

  it("60/0/40 with only 12 flashcards available yields all 12 and reports the shortfall", () => {
    const result = composeSession({
      targets: { documents: 60, extracts: 0, flashcards: 40 },
      available: { documents: 371, extracts: 6, flashcards: 12 },
    });
    // The flashcard share (247 requested) cannot be filled: all 12 are taken
    // and documents supply everything they have (371) — the session is not
    // shrunk to just the available cards.
    expect(result.documents).toBe(371);
    expect(result.extracts).toBe(0);
    expect(result.flashcards).toBe(12);
    expect(result.shortfall).toEqual({
      documents: 0,
      extracts: 0,
      flashcards: 235,
    });
  });
});
