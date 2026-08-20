import { describe, expect, it, vi } from "vitest";
import { buildLearnerContext, LanguageTutorService, type LanguageTutorProvider } from "../index";

describe("learner-aware language tutor", () => {
  it("bounds and profile-scopes learner context with redacted source text", () => {
    const packet = buildLearnerContext({ profile: { id: "p1", targetLanguage: "es", baseLanguage: "en" }, lexicon: [
      { entryId: "b", surface: "b", state: "learning", evidenceCount: 2 },
      { entryId: "a", surface: "a", state: "known", evidenceCount: 5 },
      { entryId: "ignored", surface: "ignored", state: "ignored", evidenceCount: 99 },
    ], currentSource: { documentId: "doc", text: "a very long source sentence" }, budget: { maxItems: 1, maxTextCodeUnits: 8, includeSourceText: true }, now: 1 });
    expect(packet.profileId).toBe("p1");
    expect(packet.items.map((item) => item.entryId)).toEqual(["a"]);
    expect(packet.currentSource?.text).toBe("a very l");
    expect(packet.freshness).toBe("partial");
  });

  it("deduplicates provider calls while preserving provider attribution", async () => {
    const respond = vi.fn(async (request: Parameters<LanguageTutorProvider["respond"]>[0]) => ({ text: request.message, attribution: "grounded" as const, targetEntryIds: [], providerId: "test", providerVersion: "1", createdAt: 1 }));
    const provider: LanguageTutorProvider = { id: "test", version: "1", supports: (mode) => mode === "explain", respond };
    const service = new LanguageTutorService([provider]);
    const context = buildLearnerContext({ profile: { id: "p1", targetLanguage: "es", baseLanguage: "en" }, lexicon: [] });
    const request = { profileId: "p1", mode: "explain" as const, message: "Explain this", context };
    await Promise.all([service.respond(request), service.respond(request)]);
    expect(respond).toHaveBeenCalledOnce();
  });
});
