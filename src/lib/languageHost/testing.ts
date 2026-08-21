import type { LanguagePeekProvider, LanguagePeekLookupResult } from "../languagePeek";
import type { TranslationProvider } from "../languageTranslation";
import type { LanguageTutorProvider, TutorRequest, TutorResponse } from "../languageTutor";
import type { LanguageProcessingCapabilityManifest } from "../languageProcessing";
import type { ShadowingRecognitionProvider } from "../languageShadowing";

export const SPANISH_EPUB_FIXTURE = {
  documentId: "fixture-spanish-epub",
  languageTag: "es",
  text: "La casa pequeña tiene una ventana abierta.",
  fingerprint: "fixture-spanish-epub-v1",
  sentence: "La casa pequeña tiene una ventana abierta.",
} as const;

export const SPANISH_VIDEO_FIXTURE = {
  videoId: "fixture-spanish-video",
  fingerprint: "fixture-spanish-video-v1",
  segments: [
    { id: "s1", text: "Hola, ¿cómo estás?", startMs: 0, endMs: 1800 },
    { id: "s2", text: "Estoy aprendiendo español.", startMs: 1800, endMs: 4200 },
  ],
} as const;

export const SPANISH_PRACTICE_FIXTURE = {
  profileId: "fixture-spanish-profile",
  prompt: "Estoy aprendiendo español.",
  normalizedAnswer: "estoy aprendiendo español",
} as const;

export function fakeProcessingManifest(languageTag = "es"): LanguageProcessingCapabilityManifest {
  const capabilities = ["detect", "sentenceSegment", "tokenize", "normalize", "lemma", "pos", "morphology", "phraseCandidates", "transliteration", "script"] as const;
  return {
    adapterId: "fixture-processing",
    adapterVersion: "1.0.0",
    kind: "exact-form",
    supportedLanguageTags: [languageTag],
    capabilities: Object.fromEntries(capabilities.map((name) => [name, { supported: true, confidence: { score: 1, label: "high" }, offline: true }])),
    requiresCredentials: false,
    sendsTextOffDevice: false,
    privacyDisclosure: "Deterministic in-memory fixture; no network access.",
  } as unknown as LanguageProcessingCapabilityManifest;
}

export function fakePeekProvider(): LanguagePeekProvider {
  return {
    id: "fixture-peek",
    version: "1.0.0",
    supports: (languageTag) => languageTag === "es",
    lookup: async ({ text }): Promise<LanguagePeekLookupResult> => ({
      ok: true,
      result: {
        providerId: "fixture-peek",
        providerVersion: "1.0.0",
        provenance: "local",
        dictionary: { word: text, senses: [{ definition: "fixture meaning" }], synonyms: [] },
        analysis: { lemma: text.toLowerCase(), partOfSpeech: "noun", confidence: 1 },
      },
    }),
  };
}

export function fakeTranslationProvider(): TranslationProvider {
  return {
    id: "fixture-translation",
    version: "1.0.0",
    kind: "local",
    capabilities: {
      sentenceTranslation: true,
      supportedLanguagePairs: [{ sourceLanguage: "es", targetLanguage: "en" }],
      offlineAvailable: true,
      sendsTextOffDevice: false,
      requiresCredentials: false,
      configured: true,
      supportsCancellation: true,
      privacyDisclosure: "Deterministic in-memory fixture; no network access.",
    },
    translate: async (request) => ({ translatedText: `[fixture] ${request.text}` }),
  };
}

export function fakeTutorProvider(): LanguageTutorProvider {
  return {
    id: "fixture-tutor",
    version: "1.0.0",
    supports: () => true,
    respond: async (request: TutorRequest): Promise<TutorResponse> => ({
      text: `[fixture tutor] ${request.message}`,
      attribution: "grounded",
      targetEntryIds: request.context.items.slice(0, 1).map((item) => item.entryId),
      providerId: "fixture-tutor",
      providerVersion: "1.0.0",
      createdAt: Date.now(),
    }),
  };
}

export function fakeShadowingProvider(): ShadowingRecognitionProvider {
  return {
    id: "fixture-stt",
    version: "1.0.0",
    route: "local",
    supports: (languageTag) => languageTag === "es",
    recognize: async () => ({ text: SPANISH_PRACTICE_FIXTURE.prompt, confidence: 1 }),
  };
}
