import { describe, expect, it } from "vitest";
import { createLanguageMiningPayload, miningPayloadCanCreateDraft } from "../index";

describe("language mining payload", () => {
  it("bounds context and preserves source/media provenance", () => {
    const payload = createLanguageMiningPayload({ profileId: "p1", sourceType: "video", sourceId: "video-1", text: "selected", sentenceText: "sentence", selectedText: "selected", mediaId: "audio-1", mediaStartMs: 10, mediaEndMs: 20, frameTimestampMs: 12, sourceFingerprint: "v1", frameAvailable: true, originalAudioAvailability: "available", translationAvailability: "available", analysisAvailability: "available", origin: "mining", surroundingContext: "  context  " }, 1);
    expect(payload.payloadVersion).toBe(1);
    expect(payload.context).toBe("context");
    expect(payload.mediaStartMs).toBe(10);
    expect(payload.frameAvailable).toBe(true);
    expect(miningPayloadCanCreateDraft(payload)).toBe(true);
  });

  it("does not fabricate a draft for stale/failed analysis", () => {
    const payload = createLanguageMiningPayload({ sourceType: "text", sourceId: "doc", text: "word", originalAudioAvailability: "missing", translationAvailability: "missing", analysisAvailability: "stale", origin: "sentence" });
    expect(miningPayloadCanCreateDraft(payload)).toBe(false);
  });
});
