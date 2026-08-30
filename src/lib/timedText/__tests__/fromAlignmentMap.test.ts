import { describe, expect, it } from "vitest";
import { buildTimedTextMapFromAlignment } from "../fromAlignmentMap";
import type { PlethoraAlignmentMap } from "../../ebookAudiobookAlignment/types";
import { ALIGNMENT_MAP_VERSION } from "../../ebookAudiobookAlignment/types";

describe("buildTimedTextMapFromAlignment", () => {
  it("adapts alignment words to timed-text entries", () => {
    const map: PlethoraAlignmentMap = {
      version: ALIGNMENT_MAP_VERSION,
      pairId: "pair-1",
      ebookDocId: "ebook-1",
      audioDocId: "audio-1",
      ebookContentHash: "eh",
      audioContentHash: "ah",
      transcriptFingerprint: "tf",
      granularity: "word",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      overallConfidence: 0.9,
      chapters: [
        {
          ebookChapterHref: "ch1.xhtml",
          audioChapterIndex: 0,
          audioStartMs: 0,
          audioEndMs: 5000,
          chapterConfidence: 0.9,
          status: "complete",
          words: [
            {
              text: "Hello",
              locator: { kind: "epub", chapterHref: "ch1.xhtml", charOffset: 0 },
              startMs: 0,
              endMs: 400,
              confidence: 0.95,
              interpolated: false,
              op: "match",
            },
          ],
        },
      ],
    };

    const timed = buildTimedTextMapFromAlignment(map);
    expect(timed.sourceType).toBe("audiobook_alignment");
    expect(timed.entries[0].locator).toEqual({
      kind: "epub-href",
      chapterHref: "ch1.xhtml",
      charOffset: 0,
    });
    expect(timed.entries[0].timingSource).toBe("measured");
  });
});
