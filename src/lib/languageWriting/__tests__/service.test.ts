import { describe, expect, it } from "vitest";
import { buildLearnerContext } from "../../languageTutor";
import { WritingPracticeService, type WritingProvider } from "../index";

describe("writing practice", () => {
  it("preserves raw writing and makes correction acceptance explicit", async () => {
    const provider: WritingProvider = { id: "local", version: "1", correct: async () => [{ id: "c", sourceStart: 0, sourceEnd: 3, learnerText: "Yo", correctedText: "Yo", category: "naturalness", explanation: "Good", confidence: 0.9, accepted: false }] };
    const context = buildLearnerContext({ profile: { id: "p", targetLanguage: "es", baseLanguage: "en" }, lexicon: [] });
    const draft = await new WritingPracticeService(provider).correct({ id: "prompt", profileId: "p", mode: "interest", prompt: "Travel", targetLanguage: "es", context }, "Yo viajo");
    expect(draft.rawText).toBe("Yo viajo");
    expect(draft.corrections[0]?.accepted).toBe(false);
  });
});
