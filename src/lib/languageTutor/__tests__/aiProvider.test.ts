import { describe, expect, it, vi } from "vitest";
import { buildLearnerContext } from "../context";
import { createAiLanguageTutorProvider, createProductionLanguageTutorService, languageTutorTask } from "../aiProvider";

describe("languageTutor aiProvider", () => {
  const context = buildLearnerContext({
    profile: { id: "prof-1", targetLanguage: "es", baseLanguage: "en", proficiency: "A2" },
    lexicon: [{ entryId: "entry-1", surface: "viajar", lemma: "viajar", state: "learning", evidenceCount: 3, sourceDocumentId: "doc-1" }],
    recentEncounters: ["viajar"],
    documents: ["doc-1"],
    activitySummary: { lookupsCount: 5, reviewsCount: 10, activeMinutes: 15 },
  });

  it("serializes correctionLevel, targetLexicalCoveragePercent, encounters, documents, and activity in prompt", () => {
    const prompt = languageTutorTask.buildInput({
      profileId: "prof-1",
      mode: "correction",
      message: "Yo viajar mañana",
      context,
      targetLexicalCoveragePercent: 85,
      correctionLevel: "detailed",
    }).text;
    expect(prompt).toContain("Soft lexical familiarity target: ~85%");
    expect(prompt).toContain("Correction granularity: detailed");
    expect(prompt).toContain("Recent encounters: viajar");
    expect(prompt).toContain("Active documents/interests: doc-1");
    expect(prompt).toContain("Activity evidence: lookups=5, reviews=10, activeMinutes=15");
  });

  it("throws ai-provider-unavailable when no AI provider is available", async () => {
    const provider = createAiLanguageTutorProvider({
      isAnyAiAvailableFn: async () => false,
    });
    await expect(
      provider.respond({ profileId: "prof-1", mode: "explain", message: "hola", context }),
    ).rejects.toThrow("ai-provider-unavailable");
  });

  it("enforces cloud consent and propagates provider failures", async () => {
    const cloudBlocked = createAiLanguageTutorProvider({
      isAnyAiAvailableFn: async () => true,
      resolveAiPathFn: async () => "cloud",
      getActiveCloudConfigFn: () => ({ provider: "openai", baseUrl: "https://api.openai.com/v1" } as never),
    });
    await expect(
      cloudBlocked.respond({ profileId: "prof-1", mode: "explain", message: "hola", context, privacy: "local-only" }),
    ).rejects.toThrow("cloud-ai-not-permitted");

    const failing = createAiLanguageTutorProvider({
      isAnyAiAvailableFn: async () => true,
      resolveAiPathFn: async () => "ondevice",
      runTaskFn: vi.fn(async () => {
        throw new Error("model-crashed");
      }),
    });
    await expect(
      failing.respond({ profileId: "prof-1", mode: "explain", message: "hola", context }),
    ).rejects.toThrow("model-crashed");
  });

  it("returns validated output from production service", async () => {
    const service = createProductionLanguageTutorService({
      isAnyAiAvailableFn: async () => true,
      resolveAiPathFn: async () => "ondevice",
      runTaskFn: vi.fn(async () => ({
        output: { text: "Try 'Yo viajo mañana'.", attribution: "grounded", targetEntryIds: ["entry-1"] },
        providerId: "local-llm",
        baseModelName: "qwen",
        providerKind: "ondevice",
        durationMs: 12,
      })) as never,
    });
    const res = await service.respond({
      profileId: "prof-1",
      mode: "correction",
      message: "Yo viajar mañana",
      context,
      correctionLevel: "important",
    });
    expect(res.text).toContain("viajo");
    expect(res.attribution).toBe("grounded");
    expect(res.targetEntryIds).toEqual(["entry-1"]);
  });
});
