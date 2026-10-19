import { describe, expect, it } from "vitest";
import { countTokens, trimToTokenWindow } from "../tokenizer";

describe("tokenizer", () => {
  it("counts tokens for simple and complex strings", async () => {
    const count = await countTokens("The quick brown fox jumps over the lazy dog");
    expect(count).toBeGreaterThan(0);
    expect(typeof count).toBe("number");
  });

  it("trimToTokenWindow returns a string (not Uint8Array) when text exceeds maxTokens", async () => {
    // Generate text that is well over 20 tokens
    const longText = Array.from({ length: 50 }, (_, i) => `Sentence number ${i} about spaced repetition and knowledge indexing.`).join(" ");
    const trimmed = await trimToTokenWindow(longText, 20);

    expect(typeof trimmed).toBe("string");
    expect(typeof trimmed.trim).toBe("function");
    expect(trimmed.trim().length).toBeGreaterThan(0);
    expect(trimmed.length).toBeLessThan(longText.length);
  });

  it("trimToTokenWindow returns original text as string when within maxTokens", async () => {
    const shortText = "Short text";
    const result = await trimToTokenWindow(shortText, 100);

    expect(typeof result).toBe("string");
    expect(result).toBe(shortText);
  });

  it("trimToTokenWindow handles selection-based windowing and returns a string", async () => {
    const longText = Array.from({ length: 50 }, (_, i) => `Paragraph ${i}: Important concepts in memory consolidation.`).join("\n");
    const selection = "Paragraph 25: Important concepts in memory consolidation.";
    const trimmed = await trimToTokenWindow(longText, 30, undefined, selection);

    expect(typeof trimmed).toBe("string");
    expect(typeof trimmed.trim).toBe("function");
    expect(trimmed).toContain("Paragraph 25");
  });

  it("trimToTokenWindow handles scrollPercent windowing and returns a string", async () => {
    const longText = Array.from({ length: 50 }, (_, i) => `Chapter ${i}: Retrieval practice enhances learning retention.`).join("\n");
    const trimmed = await trimToTokenWindow(longText, 25, undefined, undefined, 50);

    expect(typeof trimmed).toBe("string");
    expect(typeof trimmed.trim).toBe("function");
    expect(trimmed.length).toBeGreaterThan(0);
  });
});
