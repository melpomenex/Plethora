import { describe, expect, it } from "vitest";
import { audioSourceAnchor, epubSourceAnchor, pdfSourceAnchor, transcriptSourceAnchor } from "../languageSourceAnchors";

describe("language source anchors", () => {
  it("preserves navigation identity without copying passage text", () => {
    expect(epubSourceAnchor("book-1", "epubcfi(/6/2[chap]!/4/2/4)").locator).toEqual({ cfi: "epubcfi(/6/2[chap]!/4/2/4)", range: undefined });
    expect(pdfSourceAnchor("pdf-1", 4, { kind: "fixed", x: 12, y: 20 }).locator).toMatchObject({ page: 4, kind: "fixed" });
  });

  it("supports timestamped transcript and audio recovery", () => {
    expect(transcriptSourceAnchor("media-1", "segment-2", 1000, 2400)).toEqual(expect.objectContaining({ sourceType: "transcript", mediaId: "media-1" }));
    expect(audioSourceAnchor("media-1", 1000, 2400).locator).toEqual({ startMs: 1000, endMs: 2400 });
  });
});
