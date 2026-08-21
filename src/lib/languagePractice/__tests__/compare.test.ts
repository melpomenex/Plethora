import { describe, expect, it } from "vitest";
import { comparePracticeResponse, deleteExpiredPracticeAttempts, normalizeLearnerText } from "../index";

describe("language practice comparison", () => {
  it("retains raw answer while comparing normalized Unicode text", () => {
    const comparison = comparePracticeResponse("¿Cómo estás?", "como estas");
    expect(comparison.expected).toBe("¿Cómo estás?");
    expect(comparison.exact).toBe(false);
    expect(comparison.errors.length).toBeGreaterThan(0);
    expect(normalizeLearnerText("¿Cómo estás?", { caseFold: true, stripPunctuation: true, ignoreDiacritics: true, collapseWhitespace: true })).toBe("como estas");
  });

  it("classifies missing/extra/substituted words and honors retention", () => {
    const comparison = comparePracticeResponse("one two", "one three four");
    expect(comparison.errors.map((error) => error.kind)).toEqual(expect.arrayContaining(["substitution", "extra"]));
    const attempts = [{ id: "old", profileId: "p", mode: "dictation" as const, source: {}, promptText: "x", status: "submitted" as const, recordingPolicy: { allowMicrophone: false, persistRecording: false, retentionExpiresAt: 10, privacy: "local-only" as const }, activeEvidenceAccepted: false, createdAt: 0, updatedAt: 0 }];
    expect(deleteExpiredPracticeAttempts(attempts, 11)).toHaveLength(0);
  });

  it("labels token reordering separately from substitution", () => {
    expect(comparePracticeResponse("yo quiero café", "café quiero yo").errors.map((error) => error.kind)).toContain("order");
  });
});
