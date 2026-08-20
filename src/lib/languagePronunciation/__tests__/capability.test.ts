import { describe, expect, it } from "vitest";
import { canProvidePronunciation } from "../index";

describe("pronunciation capability ladder", () => {
  it("does not fabricate specialized scoring when a provider lacks capability", () => {
    const manifest = { providerId: "local", providerVersion: "1", capabilities: ["transcription", "word-confidence"] as const, languages: ["es"], sendsAudioOffDevice: false, maxAudioMs: 30_000, configured: true };
    expect(canProvidePronunciation(manifest, "word-confidence", "es-MX")).toBe(true);
    expect(canProvidePronunciation(manifest, "phoneme", "es-MX")).toBe(false);
  });
});
