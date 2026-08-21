import { describe, expect, it } from "vitest";
import { fakePeekProvider, fakeProcessingManifest, fakeShadowingProvider, fakeTranslationProvider, fakeTutorProvider, SPANISH_EPUB_FIXTURE, SPANISH_PRACTICE_FIXTURE, SPANISH_VIDEO_FIXTURE } from "../testing";
import { createTranslationCacheKey, translationCacheIdentity } from "../../languageTranslation";

describe("language integration fixtures", () => {
  it("are deterministic and cover the cross-surface stories", async () => {
    expect(SPANISH_EPUB_FIXTURE.languageTag).toBe("es");
    expect(SPANISH_VIDEO_FIXTURE.segments).toHaveLength(2);
    expect(await fakeShadowingProvider().recognize({ attemptId: "a", profileId: SPANISH_PRACTICE_FIXTURE.profileId, languageTag: "es", audio: new Blob(["audio"]) })).toMatchObject({ text: SPANISH_PRACTICE_FIXTURE.prompt, confidence: 1 });
    expect(SPANISH_PRACTICE_FIXTURE.normalizedAnswer).toContain("español");
    expect(fakeProcessingManifest().capabilities.tokenize.supported).toBe(true);
    expect((await fakePeekProvider().lookup({ text: "casa", languageTag: "es" })).ok).toBe(true);
    const cacheKey = createTranslationCacheKey(translationCacheIdentity({ text: "Hola", sourceFingerprint: "fixture", profileId: "p", sourceLanguage: "es", targetLanguage: "en", providerId: "fixture-translation", providerVersion: "1.0.0" }));
    expect((await fakeTranslationProvider().translate({ text: "Hola", sourceLanguage: "es", targetLanguage: "en", profileId: "p", sourceFingerprint: "fixture", cacheKey })).translatedText).toContain("fixture");
    expect((await fakeTutorProvider().respond({ profileId: "p", mode: "explain", message: "Explain", context: { schemaVersion: 1, profileId: "p", targetLanguage: "es", baseLanguage: "en", items: [], generatedAt: 0, freshness: "fresh" } })).attribution).toBe("grounded");
  });
});
