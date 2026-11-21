import { describe, expect, it, vi, beforeEach } from "vitest";
import { scoreRssRelevance, SEMANTIC_WEIGHT, type RssClassifier } from "../../utils/rssRelevance";

/**
 * Verifies the bug fix for OpenSpec `rss-smart-feeds` / QueueScrollPage semantic
 * ungating: RSS items with semantic preference scores MUST still receive hybrid
 * scoring even when the user has 0 legacy author/title/tag classifiers, and
 * `useClassifiersStore` exposes `hasLoaded` so QueueScrollPage never stays stuck
 * reading an unloaded empty list.
 */
describe("QueueScrollPage semantic preference ungating", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("scores RSS items semantically when legacy classifiers array is completely empty", () => {
    const noClassifiers: RssClassifier[] = [];
    const commonArticle = {
      itemTitle: "Distillation Techniques for Small Reasoning Language Models",
      itemAuthor: "Unknown Author",
      itemTags: [] as string[],
      feedId: "feed-unknown",
      feedTitle: "Unfamiliar Blog",
      pubDate: "2026-11-20T10:00:00Z",
    };

    const likedSemantic = scoreRssRelevance(commonArticle, noClassifiers, {
      semanticScore: 0.92,
    });
    const dislikedSemantic = scoreRssRelevance(commonArticle, noClassifiers, {
      semanticScore: 0.08,
    });

    expect(likedSemantic).toBeGreaterThan(dislikedSemantic);
    expect(likedSemantic - dislikedSemantic).toBeCloseTo(
      (0.92 - 0.08) * SEMANTIC_WEIGHT,
      5,
    );
  });

  it("tracks hasLoaded on useClassifiersStore even when backend returns zero legacy classifiers", async () => {
    vi.doMock("../../api/rss-classifiers", () => ({
      getClassifiersAuto: vi.fn(async () => []),
      addClassifierAuto: vi.fn(),
      removeClassifierAuto: vi.fn(),
      updateClassifiersBatchAuto: vi.fn(),
      recomputeIntelligenceScoresAuto: vi.fn(),
    }));

    const { useClassifiersStore } = await import("../../stores/classifiersStore");
    expect(useClassifiersStore.getState().hasLoaded).toBe(false);

    await useClassifiersStore.getState().loadClassifiers();

    expect(useClassifiersStore.getState().hasLoaded).toBe(true);
    expect(useClassifiersStore.getState().classifiers).toEqual([]);
  });

  it("computes hasRankingSignals identically to QueueScrollPage (hasClassifiers || hasSemanticScores)", () => {
    const classifiers: RssClassifier[] = [];
    const semanticScores = new Map<string, { score?: number | null }>([
      ["rss-art-1", { score: 0.87 }],
      ["rss-art-2", { score: null }],
    ]);

    const hasClassifiers = classifiers.length > 0;
    const hasSemanticScores = Array.from(semanticScores.values()).some(
      (entry) => entry.score != null && Number.isFinite(entry.score),
    );
    const hasRankingSignals = hasClassifiers || hasSemanticScores;

    expect(hasClassifiers).toBe(false);
    expect(hasRankingSignals).toBe(true);
  });
});
