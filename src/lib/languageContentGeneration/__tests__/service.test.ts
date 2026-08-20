import { describe, expect, it } from "vitest";
import { buildLearnerContext } from "../../languageTutor";
import { LanguageContentGenerationService, type LanguageContentGenerator } from "../index";

describe("personalized language content generation", () => {
  it("requires profile-matched bounded context and preserves provenance", async () => {
    const generator: LanguageContentGenerator = { id: "local", version: "1", supports: (action) => action === "generate", generate: async (request) => ({ documentId: "generated-1", profileId: request.profileId, title: request.topic, content: "Hola", generatedFingerprint: "", targetLanguage: request.targetLanguage, measuredCoverageStatus: "pending", providerId: "local", providerVersion: "1", createdAt: 1, provenance: { requestId: request.requestId, action: request.action, privacy: request.privacy } }) };
    const context = buildLearnerContext({ profile: { id: "p1", targetLanguage: "es", baseLanguage: "en" }, lexicon: [] });
    const result = await new LanguageContentGenerationService([generator]).generate({ requestId: "r1", profileId: "p1", action: "generate", topic: "travel", targetLanguage: "es", baseLanguage: "en", length: "short", learnerContext: context, privacy: "local-only" });
    expect(result.generatedFingerprint).toBeTruthy();
    expect(result.provenance.privacy).toBe("local-only");
  });

  it("rejects a cross-profile context", async () => {
    const generator: LanguageContentGenerator = { id: "local", version: "1", supports: () => true, generate: async () => { throw new Error("should not run"); } };
    const context = buildLearnerContext({ profile: { id: "p2", targetLanguage: "es", baseLanguage: "en" }, lexicon: [] });
    await expect(new LanguageContentGenerationService([generator]).generate({ requestId: "r1", profileId: "p1", action: "generate", topic: "travel", targetLanguage: "es", baseLanguage: "en", length: "short", learnerContext: context, privacy: "local-only" })).rejects.toThrow("invalid-language-generation-context");
  });
});
