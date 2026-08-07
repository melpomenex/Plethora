import { describe, expect, it } from "vitest";
import { splitReviewBudget } from "../queueScrollBudget";

const base = {
  targetFlashcardCount: 10,
  extractsCountAsFlashcards: true,
  maxExtractsPerSession: 20,
  availableFlashcards: 1000,
  availableExtracts: 5,
};

describe("splitReviewBudget", () => {
  // The reported bug: slider at 0%, yet the queue still filled with extracts
  // because extracts were injected regardless of the percentage.
  it("shows nothing at 0% when extracts count as flashcards", () => {
    expect(splitReviewBudget({ ...base, targetFlashcardCount: 0 })).toEqual({
      flashcards: 0,
      extracts: 0,
    });
  });

  it("still honors 0% for flashcards when extracts are independent", () => {
    const result = splitReviewBudget({
      ...base,
      targetFlashcardCount: 0,
      extractsCountAsFlashcards: false,
    });
    expect(result.flashcards).toBe(0);
    expect(result.extracts).toBe(5);
  });

  it("shares one budget, taking the scarcer extracts first", () => {
    expect(splitReviewBudget(base)).toEqual({ flashcards: 5, extracts: 5 });
  });

  it("never exceeds the per-session extract cap", () => {
    const result = splitReviewBudget({
      ...base,
      targetFlashcardCount: 100,
      availableExtracts: 500,
    });
    expect(result.extracts).toBe(20);
    expect(result.flashcards).toBe(80);
  });

  it("never returns more than is available", () => {
    const result = splitReviewBudget({
      ...base,
      targetFlashcardCount: 50,
      availableFlashcards: 3,
      availableExtracts: 1,
    });
    expect(result).toEqual({ flashcards: 3, extracts: 1 });
  });

  it("clamps a negative target instead of returning negative counts", () => {
    expect(splitReviewBudget({ ...base, targetFlashcardCount: -5 })).toEqual({
      flashcards: 0,
      extracts: 0,
    });
  });
});
