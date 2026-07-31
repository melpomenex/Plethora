import { describe, expect, it } from "vitest";
import { chunkTextForTTS } from "../ttsTextExtraction";

describe("model-aware TTS chunking", () => {
  it("respects a smaller model limit", () => {
    const chunks = chunkTextForTTS("One two three. Four five six. Seven eight nine.", 15);
    expect(chunks.every((chunk) => chunk.length <= 15)).toBe(true);
  });

  it("splits one long sentence at word boundaries", () => {
    const chunks = chunkTextForTTS("This is a deliberately long sentence without a period yet", 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 20)).toBe(true);
    expect(chunks.join(" ")).toContain("deliberately long");
  });
});
