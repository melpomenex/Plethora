import { describe, expect, it } from "vitest";
import { cancelPracticeAttempt, createPracticeAttempt, recommendationPreview, resumePracticeAttempt, shouldConfirmPracticeDiscard } from "../index";

function attempt() {
  return createPracticeAttempt({ id: "a", profileId: "p", mode: "dictation", source: { sourceId: "doc", sourceFingerprint: "fp" }, promptText: "Hola", now: 1 });
}

describe("practice lifecycle", () => {
  it("resumes only the same source occurrence", () => {
    const saved = { ...attempt(), rawResponse: "Hola", status: "submitted" as const };
    expect(resumePracticeAttempt(saved, { sourceFingerprint: "fp", promptText: "Hola" })).toBe(saved);
    expect(resumePracticeAttempt(saved, { sourceFingerprint: "new-fp", promptText: "Hola" })).toBeNull();
    expect(resumePracticeAttempt(saved, { sourceFingerprint: "fp", promptText: "Adiós" })).toBeNull();
  });

  it("requires discard confirmation for dirty attempts and marks cancellation", () => {
    const saved = { ...attempt(), rawResponse: "Hola", status: "submitted" as const };
    expect(shouldConfirmPracticeDiscard(saved)).toBe(true);
    expect(cancelPracticeAttempt(saved, 5)).toMatchObject({ status: "cancelled", updatedAt: 5 });
  });

  it("preserves recommendation explanations before an explicit start", () => {
    expect(recommendationPreview({ id: "r", title: "Travel", sourceType: "rss", sourceId: "doc", sourceFingerprint: "fp", explanation: ["low coverage"], score: 0.8 })).toEqual({ candidateId: "r", title: "Travel", sourceType: "rss", sourceId: "doc", sourceFingerprint: "fp", explanation: ["low coverage"], score: 0.8 });
  });
});
