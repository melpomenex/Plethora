import { describe, expect, it } from "vitest";
import { normalizeAudioChapterBounds } from "../audioChapterBounds";

describe("normalizeAudioChapterBounds", () => {
  it("uses the next chapter and media duration for missing ends", () => {
    expect(normalizeAudioChapterBounds([
      { title: "One", startTime: 0 },
      { title: "Two", startTime: 42 },
    ], 100)).toEqual([
      { title: "One", startTime: 0, endTime: 42 },
      { title: "Two", startTime: 42, endTime: 100 },
    ]);
  });

  it("gives a chapterless audiobook a finite alignment range", () => {
    expect(normalizeAudioChapterBounds([
      { title: "Chapter 1", startTime: 0 },
    ], 3600)[0]?.endTime).toBe(3600);
  });
});
