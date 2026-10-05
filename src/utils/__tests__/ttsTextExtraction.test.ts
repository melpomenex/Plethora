import { describe, expect, it, vi } from "vitest";
import {
  chunkTextForTTS,
  cleanTextForTTS,
  normalizeCodeBlocks,
  PrebufferCoordinator,
  splitSentencesWithOffsets,
  translateMathForTTS,
} from "../ttsTextExtraction";

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

describe("Markdown & Math normalization for TTS", () => {
  it("cleans links and styling formatting", () => {
    const raw = "Here is [Plethora](https://example.com) with **bold** and _italic_ concepts.";
    const cleaned = cleanTextForTTS(raw);
    expect(cleaned).toBe("Here is Plethora with bold and italic concepts.");
  });

  it("translates LaTeX math formulas into spoken equivalents", () => {
    const mathText = "Let $x \\in A$ where $\\frac{a}{b} \\le 10$ and $x^2 + y_i = \\infty$.";
    const spoken = translateMathForTTS(mathText);
    expect(spoken).toContain("x in A");
    expect(spoken).toContain("a over b");
    expect(spoken).toContain("less than or equal to");
    expect(spoken).toContain("x squared");
    expect(spoken).toContain("y sub i");
    expect(spoken).toContain("infinity");
  });

  it("handles code block modes: skip, summary, and read", () => {
    const textWithCode = "Before.\n```rust\nfn main() {\n    println!(\"hello\");\n}\n```\nAfter.";
    
    expect(normalizeCodeBlocks(textWithCode, "skip")).not.toContain("main");
    
    const summary = normalizeCodeBlocks(textWithCode, "summary");
    expect(summary).toContain("[code block: rust, 3 lines]");
    
    const read = normalizeCodeBlocks(textWithCode, "read");
    expect(read).toContain("fn main()");
  });
});

describe("Abbreviation-aware sentence splitting with offsets", () => {
  it("preserves character offsets and avoids breaking on abbreviations", () => {
    const text = "Dr. Watson visited e.g. London today. It was pleasant! How are you?";
    const spans = splitSentencesWithOffsets(text);

    expect(spans.length).toBe(3);
    expect(spans[0].text).toBe("Dr. Watson visited e.g. London today.");
    expect(spans[1].text).toBe("It was pleasant!");
    expect(spans[2].text).toBe("How are you?");

    // Check offsets match source text exactly
    for (const span of spans) {
      expect(text.slice(span.startOffset, span.endOffset)).toBe(span.text);
    }
  });
});

describe("PrebufferCoordinator lookahead", () => {
  it("synthesizes current chunk and prefetches N+1 and N+2", async () => {
    const sentences = [
      { text: "First sentence.", startOffset: 0, endOffset: 15 },
      { text: "Second sentence.", startOffset: 16, endOffset: 32 },
      { text: "Third sentence.", startOffset: 33, endOffset: 48 },
      { text: "Fourth sentence.", startOffset: 49, endOffset: 65 },
    ];

    const synthMock = vi.fn().mockImplementation(async (idx: number) => {
      return new Uint8Array([idx]).buffer;
    });

    const coordinator = new PrebufferCoordinator(sentences, synthMock);

    // Request chunk 0
    const chunk0 = await coordinator.getChunk(0);
    expect(new Uint8Array(chunk0)[0]).toBe(0);

    // Chunks 0, 1, and 2 should have been requested
    expect(coordinator.isBuffered(0)).toBe(true);
    expect(coordinator.isBuffered(1)).toBe(true);
    expect(coordinator.isBuffered(2)).toBe(true);
    expect(coordinator.isBuffered(3)).toBe(false);

    expect(synthMock).toHaveBeenCalledWith(0, "First sentence.");
    expect(synthMock).toHaveBeenCalledWith(1, "Second sentence.");
    expect(synthMock).toHaveBeenCalledWith(2, "Third sentence.");

    // Advance to chunk 1: already buffered, triggers prefetch of chunk 3
    const chunk1 = await coordinator.getChunk(1);
    expect(new Uint8Array(chunk1)[0]).toBe(1);
    expect(coordinator.isBuffered(3)).toBe(true);
  });
});
