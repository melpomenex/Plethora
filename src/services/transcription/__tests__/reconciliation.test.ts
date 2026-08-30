import { describe, expect, it } from "vitest";
import { mergeTranscriptChunks } from "../reconciliation";

describe("mergeTranscriptChunks", () => {
  it('dedupes overlapping boundary words for "the mitochondria is" + "is the powerhouse"', () => {
    const merged = mergeTranscriptChunks([
      "the mitochondria is",
      "is the powerhouse",
    ]);
    expect(merged).toBe("the mitochondria is the powerhouse");
  });

  it("does not duplicate words at chunk boundaries", () => {
    const merged = mergeTranscriptChunks([
      "hello brave",
      "brave new world",
    ]);
    expect(merged).toBe("hello brave new world");
    expect(merged.split(" ").filter((word) => word === "brave")).toHaveLength(1);
  });

  it("handles multi-word overlaps", () => {
    const merged = mergeTranscriptChunks([
      "once upon a time",
      "a time traveler arrived",
    ]);
    expect(merged).toBe("once upon a time traveler arrived");
  });

  it("returns an empty string for no chunks", () => {
    expect(mergeTranscriptChunks([])).toBe("");
  });

  it("normalizes extra whitespace inside chunks", () => {
    const merged = mergeTranscriptChunks([
      "  hello   world  ",
      "world   again ",
    ]);
    expect(merged).toBe("hello world again");
  });
});
