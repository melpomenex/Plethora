import { describe, expect, it } from "vitest";
import { isAudiobookDocument } from "../audiobookClassification";

describe("isAudiobookDocument", () => {
  it("excludes a podcast episode even with audio fileType and audio tag", () => {
    expect(
      isAudiobookDocument({ fileType: "audio", tags: ["podcast", "audio"] })
    ).toBe(false);
  });

  it("includes a plain audio document with no podcast tag", () => {
    expect(isAudiobookDocument({ fileType: "audio", tags: [] })).toBe(true);
  });

  it("includes a document explicitly tagged audiobook regardless of fileType", () => {
    expect(
      isAudiobookDocument({ fileType: "other", tags: ["Audiobook"] })
    ).toBe(true);
  });

  it("excludes a non-audio document with no relevant tags", () => {
    expect(isAudiobookDocument({ fileType: "epub", tags: [] })).toBe(false);
  });
});
