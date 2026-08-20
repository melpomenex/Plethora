import { describe, expect, it } from "vitest";
import {
  TranslationService,
  createTranslationProviderRegistry,
  type TranslationProvider,
} from "../index";

function provider(translate: TranslationProvider["translate"]): TranslationProvider {
  return {
    id: "local-test",
    kind: "local",
    version: "1",
    capabilities: {
      sentenceTranslation: true,
      supportedLanguagePairs: [{ sourceLanguage: "es", targetLanguage: "en" }],
      offlineAvailable: true,
      sendsTextOffDevice: false,
      requiresCredentials: false,
      configured: true,
      supportsCancellation: true,
      privacyDisclosure: "Runs locally",
    },
    translate,
  };
}

describe("language translation service", () => {
  it("deduplicates concurrent requests and returns a provenance-bearing cache hit", async () => {
    let calls = 0;
    const service = new TranslationService({
      registry: createTranslationProviderRegistry([provider(async () => {
        calls += 1;
        return { translatedText: "hello" };
      })]),
    });
    const request = { text: "Hola", sourceLanguage: "es", targetLanguage: "en", profileId: "p1" };
    const [first, second] = await Promise.all([service.translate(request), service.translate(request)]);
    const cached = await service.translate(request);
    expect(calls).toBe(1);
    expect(first.translatedText).toBe("hello");
    expect(second.fromCache).toBe(false);
    expect(cached.fromCache).toBe(true);
    expect(cached.provenance.profileId).toBe("p1");
  });

  it("keeps unsupported pairs out of provider calls", async () => {
    const translate = async () => ({ translatedText: "never" });
    const service = new TranslationService({ registry: createTranslationProviderRegistry([provider(translate)]) });
    await expect(service.translate({ text: "Bonjour", sourceLanguage: "fr", targetLanguage: "en", profileId: "p1" })).rejects.toMatchObject({ code: "unsupported-provider" });
  });
});
