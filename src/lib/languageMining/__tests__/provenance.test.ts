import { describe, expect, it } from "vitest";
import { miningPayloadToFlashcardProvenance } from "../provenance";

describe("miningPayloadToFlashcardProvenance", () => {
  it("carries explicit mediaRange through to flashcard provenance", () => {
    const result = miningPayloadToFlashcardProvenance({
      sourceAnchor: { sourceType: "transcript", mediaId: "video-1" },
      sourceFingerprint: "fp-1",
      mediaRange: { mediaId: "video-1", startMs: 1000, endMs: 1900 },
    });
    expect(result.origin).toBe("mining");
    expect(result.mediaRange).toEqual({ mediaId: "video-1", startMs: 1000, endMs: 1900 });
    expect(result.sourceFingerprint).toBe("fp-1");
  });

  it("reconstructs mediaRange from payload media fields when explicit range is absent", () => {
    const result = miningPayloadToFlashcardProvenance({
      mediaId: "video-1",
      mediaStartMs: 500,
      mediaEndMs: 1200,
    });
    expect(result.mediaId).toBe("video-1");
    expect(result.mediaStartMs).toBe(500);
    expect(result.mediaEndMs).toBe(1200);
    expect(result.mediaRange).toEqual({ mediaId: "video-1", startMs: 500, endMs: 1200 });
  });

  it("omits mediaRange when no media fields are present", () => {
    const result = miningPayloadToFlashcardProvenance({
      sourceFingerprint: "fp-2",
    });
    expect(result.mediaRange).toBeUndefined();
    expect(result.mediaId).toBeUndefined();
    expect(result.origin).toBe("mining");
  });

  it("ignores partial media fields (missing endMs)", () => {
    const result = miningPayloadToFlashcardProvenance({
      mediaId: "video-1",
      mediaStartMs: 500,
    });
    expect(result.mediaRange).toBeUndefined();
    expect(result.mediaStartMs).toBe(500);
  });
});
