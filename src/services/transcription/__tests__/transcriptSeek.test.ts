import { describe, expect, it } from "vitest";
import {
  findSegmentAtTime,
  seekSecondsFromSegment,
  segmentsSupportSeek,
  segmentsSupportWordKaraoke,
} from "../../../utils/transcriptSeek";

describe("transcriptSeek", () => {
  const segments = [
    { startMs: 0, endMs: 2000, text: "hello" },
    { startMs: 2000, endMs: 5000, text: "world" },
  ];

  it("converts segment start to seek seconds", () => {
    expect(seekSecondsFromSegment(segments[1]!)).toBe(2);
  });

  it("finds active segment at playback time", () => {
    expect(findSegmentAtTime(segments, 2.5)?.text).toBe("world");
  });

  it("detects seek-capable segments", () => {
    expect(segmentsSupportSeek(segments)).toBe(true);
  });

  it("detects word karaoke availability", () => {
    expect(
      segmentsSupportWordKaraoke([
        {
          startMs: 0,
          endMs: 1000,
          text: "hi",
          words: [{ word: "hi", startMs: 0, endMs: 500 }],
        },
      ]),
    ).toBe(true);
  });
});
