import { describe, expect, it } from "vitest";
import { transcriptionResultToVideoSegments } from "../persist";

describe("transcriptionResultToVideoSegments", () => {
  it("maps normalized segments and word timings for karaoke sync", () => {
    const segments = transcriptionResultToVideoSegments({
      text: "hello world",
      providerId: "openrouter:nemotron-3.5",
      segments: [
        {
          startMs: 0,
          endMs: 1200,
          text: "hello world",
          words: [
            { word: "hello", startMs: 0, endMs: 500 },
            { word: "world", startMs: 500, endMs: 1200 },
          ],
        },
      ],
    });

    expect(segments).toEqual([
      {
        time: 0,
        end: 1.2,
        text: "hello world",
        wordTimings: [
          { word: "hello", start_ms: 0, end_ms: 500 },
          { word: "world", start_ms: 500, end_ms: 1200 },
        ],
      },
    ]);
  });
});
