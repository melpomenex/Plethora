/**
 * Unit tests for the review-session assessment integration (task 5.8):
 * the advisory grade suggestion gates and the post-grading persistence
 * path. The scheduling path is untouched by construction — these tests pin
 * that contract (nothing here can submit or alter a rating).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AnswerAssessment } from "../../../lib/ai/schemas/answerAssessment";
import {
  AUTO_GRADE_CONFIDENCE_THRESHOLD,
  computeSuggestedRating,
  recordCardAssessment,
  shouldSuggestGrade,
} from "../answerAssessmentIntegration";
import * as api from "../../../api/answer-assessment";

vi.mock("../../../api/answer-assessment", () => ({
  recordAnswerAssessment: vi.fn().mockResolvedValue({}),
}));

function assessment(overrides: Partial<AnswerAssessment>): AnswerAssessment {
  return {
    classification: "correct",
    score: 0.9,
    completeness: 0.9,
    missingConcepts: [],
    feedback: "good",
    confidence: 0.9,
    ...overrides,
  };
}

describe("computeSuggestedRating (advisory mapping)", () => {
  it("maps each classification to a 4-button rating", () => {
    expect(computeSuggestedRating(assessment({ classification: "correct" }))).toBe(3);
    expect(computeSuggestedRating(assessment({ classification: "partial" }))).toBe(2);
    expect(computeSuggestedRating(assessment({ classification: "incorrect" }))).toBe(1);
    expect(computeSuggestedRating(assessment({ classification: "misconception" }))).toBe(1);
  });
});

describe("shouldSuggestGrade gates", () => {
  it("never suggests when the experimental flag is off (default)", () => {
    expect(shouldSuggestGrade(assessment({}), false)).toBe(false);
  });

  it("never suggests without an assessment", () => {
    expect(shouldSuggestGrade(null, true)).toBe(false);
  });

  it("requires confidence at or above the threshold", () => {
    expect(AUTO_GRADE_CONFIDENCE_THRESHOLD).toBe(0.8);
    expect(
      shouldSuggestGrade(assessment({ confidence: AUTO_GRADE_CONFIDENCE_THRESHOLD }), true)
    ).toBe(true);
    expect(shouldSuggestGrade(assessment({ confidence: 0.79 }), true)).toBe(false);
  });

  it("suggests for every confident classification", () => {
    for (const classification of ["correct", "partial", "incorrect", "misconception"] as const) {
      expect(
        shouldSuggestGrade(assessment({ classification, confidence: 0.95 }), true)
      ).toBe(true);
    }
  });
});

describe("recordCardAssessment (post-grading persistence)", () => {
  beforeEach(() => {
    vi.mocked(api.recordAnswerAssessment).mockClear();
  });

  it("records once with the card id, assessment, and provider provenance", async () => {
    const payload = {
      cardId: "item-1",
      question: "Q?",
      expectedAnswer: "A.",
      userAnswer: "approximately a",
      assessment: assessment({ classification: "partial" }),
      provider: "fake-ondevice",
      model: "nano",
    };
    const ok = await recordCardAssessment(payload);
    expect(ok).toBe(true);
    expect(api.recordAnswerAssessment).toHaveBeenCalledTimes(1);
    expect(api.recordAnswerAssessment).toHaveBeenCalledWith({
      itemId: "item-1",
      reviewResultId: null,
      assessment: payload.assessment,
      provider: "fake-ondevice",
      model: "nano",
    });
  });

  it("swallows storage failures (never surfaces in the review flow)", async () => {
    vi.mocked(api.recordAnswerAssessment).mockRejectedValueOnce(new Error("db locked"));
    const ok = await recordCardAssessment({
      cardId: "item-2",
      question: "Q",
      expectedAnswer: "A",
      userAnswer: "a",
      assessment: assessment({}),
      provider: "p",
    });
    expect(ok).toBe(false);
  });
});
