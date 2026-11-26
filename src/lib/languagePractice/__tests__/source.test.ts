import { describe, expect, it } from "vitest";
import { languagePracticeSourceFromAction, type LanguagePracticeActionLike } from "../source";

const baseAction: LanguagePracticeActionLike = {
  source: {
    source: { sourceType: "transcript", mediaId: "video-1" },
    contentId: "doc-1",
    contentFingerprint: "fp-1",
  },
  sourceAnchor: {
    sourceType: "transcript",
    mediaId: "video-1",
    sourceId: "video-1:s1",
    locator: { segmentId: "s1", startMs: 1000, endMs: 1900 },
  },
};

describe("languagePracticeSourceFromAction", () => {
  it("extends explicit practiceSource media range over the anchor locator", () => {
    const source = languagePracticeSourceFromAction({
      ...baseAction,
      practiceSource: { mediaId: "video-1", startMs: 2000, endMs: 2900 },
    });
    expect(source.mediaId).toBe("video-1");
    expect(source.startMs).toBe(2000);
    expect(source.endMs).toBe(2900);
    expect(source.sourceId).toBe("doc-1");
    expect(source.sourceType).toBe("transcript");
    expect(source.sourceFingerprint).toBe("fp-1");
  });

  it("falls back to the anchor locator range", () => {
    const source = languagePracticeSourceFromAction(baseAction);
    expect(source.startMs).toBe(1000);
    expect(source.endMs).toBe(1900);
    expect(source.mediaId).toBe("video-1");
  });

  it("falls back to the source mediaId when no range is present", () => {
    const source = languagePracticeSourceFromAction({
      source: { source: { mediaId: "audio-1" }, contentId: "doc-1" },
    });
    expect(source.mediaId).toBe("audio-1");
    expect(source.startMs).toBeUndefined();
    expect(source.endMs).toBeUndefined();
  });

  it("produces a media-free source for plain documents", () => {
    const source = languagePracticeSourceFromAction({
      source: { source: { sourceType: "document" }, contentId: "doc-2", contentFingerprint: "fp-2" },
      sourceAnchor: { sourceType: "document", documentId: "doc-2" },
    });
    expect(source.mediaId).toBeUndefined();
    expect(source.startMs).toBeUndefined();
    expect(source.sourceId).toBe("doc-2");
  });
});
