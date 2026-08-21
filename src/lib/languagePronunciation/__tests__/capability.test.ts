import { describe, expect, it } from "vitest";
import { advertisedPronunciationDimensions, canProvidePronunciation, isPronunciationFeedbackCurrent } from "../index";

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
});
