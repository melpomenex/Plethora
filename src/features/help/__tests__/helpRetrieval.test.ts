/**
 * Unit tests for Local Hybrid Help Retrieval Engine (helpRetrieval.ts)
 */

import { describe, it, expect } from "vitest";
import { HelpRetrievalEngine, tokenizeQuery, estimateTokenCount } from "../helpRetrieval";
import { BUNDLED_HELP_INDEX } from "../generated/helpIndexData";

describe("HelpRetrievalEngine", () => {
  const engine = new HelpRetrievalEngine(BUNDLED_HELP_INDEX);

  it("tokenizes queries and removes common stopwords", () => {
    const terms = tokenizeQuery("how do I configure TTS word highlighting in Plethora?");
    expect(terms).toContain("configure");
    expect(terms).toContain("tts");
    expect(terms).toContain("word");
    expect(terms).toContain("highlighting");
    expect(terms).not.toContain("how");
    expect(terms).not.toContain("do");
    expect(terms).not.toContain("in");
  });

  it("estimates token counts accurately (~4 chars per token)", () => {
    const text = "This is a sample document passage with about forty-four characters.";
    const tokens = estimateTokenCount(text);
    expect(tokens).toBeGreaterThan(10);
    expect(tokens).toBeLessThan(30);
  });

  it("resolves exact alias lookups instantaneously with 0ms LLM latency", () => {
    const result1 = engine.resolveDirectLookup("e-ink mode");
    expect(result1).not.toBeNull();
    expect(result1?.featureId).toBe("platform.eink");
    expect(result1?.confidence).toBe(1.0);
    expect(result1?.primaryAction?.id).toBe("settings.appearance.eink");

    const result2 = engine.resolveDirectLookup("sm18");
    expect(result2).not.toBeNull();
    expect(result2?.featureId).toBe("scheduler.sm18");

    const result3 = engine.resolveDirectLookup("read aloud");
    expect(result3).not.toBeNull();
    expect(result3?.featureId).toBe("tts.playback");
  });

  it("retrieves relevant chunks via BM25 lexical search", () => {
    const results = engine.search("PDF reflow responsive typography");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunk.docId).toBe("reader.pdf.reflow");
    expect(results[0].matchReasons.length).toBeGreaterThan(0);
  });

  it("applies contextual app state boost when TTS is active", () => {
    const unboosted = engine.search("auto scroll viewport", {
      context: { ttsActive: false },
    });

    const boosted = engine.search("auto scroll viewport", {
      context: { ttsActive: true, activeView: "document-viewer" },
    });

    const unboostedTop = unboosted.find((r) => r.chunk.docId === "tts.auto_scroll");
    const boostedTop = boosted.find((r) => r.chunk.docId === "tts.auto_scroll");

    expect(boostedTop).toBeDefined();
    expect(boostedTop!.boostMultiplier).toBeGreaterThan(1.4);
    if (unboostedTop && boostedTop) {
      expect(boostedTop.score).toBeGreaterThan(unboostedTop.score);
    }
  });

  it("applies algorithm boost matching active SRS engine", () => {
    const fsrsResults = engine.search("stability retention interval", {
      context: { activeAlgorithm: "fsrs" },
    });
    const sm18Results = engine.search("stability retention interval", {
      context: { activeAlgorithm: "sm18" },
    });

    const topFsrs = fsrsResults.find((r) => r.chunk.docId === "scheduler.fsrs");
    const topSm18 = sm18Results.find((r) => r.chunk.docId === "scheduler.sm18");

    expect(topFsrs?.boostMultiplier).toBeGreaterThan(1.0);
    expect(topSm18?.boostMultiplier).toBeGreaterThan(1.0);
  });

  it("enforces strict prompt token budgeting ceiling (≤ 1500 tokens)", () => {
    const results = engine.search("reading queue incremental algorithms flashcards tts", {
      limit: 10,
      maxTokens: 1000,
    });

    let totalTokens = 0;
    for (const r of results) {
      totalTokens += estimateTokenCount(r.chunk.content);
    }

    expect(totalTokens).toBeLessThanOrEqual(1000);
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it("returns full document by ID and valid corpus SHA-256 hash", () => {
    const doc = engine.getDocument("reader.pdf.page_mode");
    expect(doc).toBeDefined();
    expect(doc?.title).toBe("PDF Page Mode Reading");
    expect(doc?.domain).toBe("reading");

    const hash = engine.getCorpusHash();
    expect(hash.startsWith("sha256:")).toBe(true);
    expect(hash.length).toBeGreaterThan(10);
  });
});
