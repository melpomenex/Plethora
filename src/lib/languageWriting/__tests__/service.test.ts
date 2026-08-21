import { describe, expect, it } from "vitest";
import { buildLearnerContext } from "../../languageTutor";
import { acceptWritingCorrection, WritingPracticeService, type WritingProvider } from "../index";

describe("writing practice", () => {
  it("preserves raw writing and makes correction acceptance explicit", async () => {
    const provider: WritingProvider = { id: "local", version: "1", correct: async () => [{ id: "c", sourceStart: 0, sourceEnd: 3, learnerText: "Yo", correctedText: "Yo", category: "naturalness", explanation: "Good", confidence: 0.9, accepted: false }] };
    const context = buildLearnerContext({ profile: { id: "p", targetLanguage: "es", baseLanguage: "en" }, lexicon: [] });
    const result = await new WritingPracticeService(provider).correct({ id: "prompt", profileId: "p", mode: "interest", prompt: "Travel", targetLanguage: "es", context }, "Yo viajo");
    expect(result.status).toBe("ready");
    expect(result.draft.rawText).toBe("Yo viajo");
    expect(result.draft.corrections[0]?.accepted).toBe(false);
    expect(acceptWritingCorrection(result.draft, "c").corrections[0]?.accepted).toBe(true);
  });

  it("accepts target-vocabulary prompts without widening the bounded context", async () => {
    const context = buildLearnerContext({ profile: { id: "p", targetLanguage: "es", baseLanguage: "en" }, lexicon: [{ entryId: "e", surface: "viajar", state: "learning", evidenceCount: 2 }] });
    const provider: WritingProvider = { id: "local", version: "1", correct: async () => [] };
    const result = await new WritingPracticeService(provider).correct({ id: "prompt", profileId: "p", mode: "target-vocabulary", prompt: "Use viajar", targetLanguage: "es", context }, "Viajo mucho");
    expect(result.status).toBe("ready");
    expect(result.draft.rawText).toBe("Viajo mucho");
    expect(result.draft.profileId).toBe("p");
  });

  it("keeps an offline draft recoverable without pretending correction exists", async () => {
    const context = buildLearnerContext({ profile: { id: "p", targetLanguage: "es", baseLanguage: "en" }, lexicon: [] });
    const result = await new WritingPracticeService().correct({ id: "prompt", profileId: "p", mode: "current-document", prompt: "Travel", targetLanguage: "es", context }, "Yo viajo");
    expect(result.status).toBe("unavailable");
    expect(result.draft.rawText).toBe("Yo viajo");
    expect(result.draft.corrections).toEqual([]);
  });
});
