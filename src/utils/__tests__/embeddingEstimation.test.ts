/**
 * Tests for embedding workload/cost estimation (ai-billing-safety #14):
 * only known static pricing is used; unknown pricing is disclosed, never
 * fabricated.
 */

import { describe, expect, it } from "vitest";
import {
  estimateEmbeddingWorkload,
  formatEmbeddingCostClause,
  embeddingProviderLabel,
} from "../embeddingEstimation";

describe("estimateEmbeddingWorkload", () => {
  it("estimates chunk count from characters and chunk size", () => {
    // chunkSize is words; ~5 chars/word. 10000 chars / (200*5) = 10 chunks.
    const estimate = estimateEmbeddingWorkload({
      characterCount: 10000,
      provider: "openai",
      model: "text-embedding-3-small",
      chunkSize: 200,
    });
    expect(estimate.estimatedChunks).toBe(10);
    expect(estimate.characterCount).toBe(10000);
    expect(estimate.costUnknown).toBe(false);
  });

  it("computes a small USD estimate from known OpenAI pricing", () => {
    const estimate = estimateEmbeddingWorkload({
      characterCount: 1_000_000,
      provider: "openai",
      model: "text-embedding-3-small",
    });
    // 1M chars ≈ 250k tokens ≈ 250k/1M * $0.02 = $0.005.
    expect(estimate.estimatedCostUsd).toBeCloseTo(0.005, 3);
    expect(estimate.costUnknown).toBe(false);
  });

  it("reports unknown cost for OpenRouter (dynamic pricing) instead of guessing", () => {
    const estimate = estimateEmbeddingWorkload({
      characterCount: 100000,
      provider: "openrouter",
      model: "openai/text-embedding-3-small",
    });
    expect(estimate.costUnknown).toBe(true);
    expect(estimate.estimatedCostUsd).toBeUndefined();
  });

  it("reports unknown cost for an unrecognized provider", () => {
    const estimate = estimateEmbeddingWorkload({
      characterCount: 1000,
      provider: "mystery-cloud",
    });
    expect(estimate.costUnknown).toBe(true);
    expect(estimate.estimatedCostUsd).toBeUndefined();
  });
});

describe("formatEmbeddingCostClause", () => {
  it("says cost cannot be estimated when unknown", () => {
    expect(
      formatEmbeddingCostClause({
        estimatedChunks: 10,
        characterCount: 1000,
        costUnknown: true,
      })
    ).toContain("cannot be estimated");
  });

  it("renders a dollar figure when known", () => {
    const clause = formatEmbeddingCostClause({
      estimatedChunks: 10,
      characterCount: 1_000_000,
      estimatedCostUsd: 0.005,
      costUnknown: false,
    });
    expect(clause).toContain("$");
  });
});

describe("embeddingProviderLabel", () => {
  it("capitalizes provider ids for display", () => {
    expect(embeddingProviderLabel("openai")).toBe("OpenAI");
    expect(embeddingProviderLabel("openrouter")).toBe("OpenRouter");
    expect(embeddingProviderLabel("cohere")).toBe("Cohere");
    expect(embeddingProviderLabel("ollama")).toBe("Ollama");
  });
});
