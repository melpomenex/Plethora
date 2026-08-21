import { describe, expect, it } from "vitest";
import { advertisedPronunciationDimensions, canProvidePronunciation, evaluatePronunciationFeedback, isPronunciationFeedbackCurrent } from "../index";

describe("pronunciation capability ladder", () => {
  it("does not fabricate specialized scoring when a provider lacks capability", () => {
    const manifest = { providerId: "local", providerVersion: "1", capabilities: ["transcription", "word-confidence"] as const, languages: ["es"], sendsAudioOffDevice: false, maxAudioMs: 30_000, configured: true };
    expect(canProvidePronunciation(manifest, "word-confidence", "es-MX")).toBe(true);
    expect(canProvidePronunciation(manifest, "phoneme", "es-MX")).toBe(false);
    expect(advertisedPronunciationDimensions(manifest, "es-MX")).toEqual(["Transcription match", "Word confidence"]);
    expect(advertisedPronunciationDimensions(manifest, "fr-FR")).toEqual([]);
    expect(isPronunciationFeedbackCurrent({ attemptId: "a", providerId: "local", providerVersion: "1" }, { attemptId: "a", providerId: "local", providerVersion: "1" })).toBe(true);
    expect(isPronunciationFeedbackCurrent({ attemptId: "a", providerId: "local", providerVersion: "1" }, { attemptId: "a", providerId: "local", providerVersion: "2" })).toBe(false);
  });

  it("does not fabricate timing or phoneme scores when the provider only transcribes", () => {
    const result = evaluatePronunciationFeedback({ attemptId: "a", languageTag: "es", expectedText: "Hola mundo", recognizedText: "Hola mundo", confidence: 1, provider: { providerId: "local", providerVersion: "1", capabilities: ["transcription"], languages: ["es"], sendsAudioOffDevice: false, maxAudioMs: 30_000, configured: true } });
    expect(result.status).toBe("ready");
    expect(result.score).toBe(1);
    expect(result.availableDimensions).toEqual(["transcription"]);
    expect(result.issues).toEqual([]);
  });

  it("reports uncertainty instead of a definitive pronunciation result for low confidence", () => {
    const result = evaluatePronunciationFeedback({ attemptId: "a", languageTag: "es", expectedText: "Hola", recognizedText: "Ola", confidence: 0.2, provider: { providerId: "local", providerVersion: "1", capabilities: ["transcription", "word-confidence"], languages: ["es"], sendsAudioOffDevice: false, maxAudioMs: 30_000, configured: true } });
    expect(result.status).toBe("uncertain");
    expect(result.score).toBeDefined();
  });
});
