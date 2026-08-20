import { describe, expect, it } from "vitest";
import { computeLanguageMetrics } from "../formulas";
import { deriveFreshness, metricValue } from "../freshness";

describe("language analytics formulas", () => {
  it("keeps passive and active evidence separate and exposes denominators", () => {
    const metrics = computeLanguageMetrics({
      observedEventKinds: new Set(["coverage.snapshot", "lexicon.encounter", "practice.evidence"]),
      lemmaStates: new Map([["one", "known"], ["two", "learning"]]),
      encounters: 2,
      uniqueLemmaIds: new Set(["one", "two"]),
      documentIds: new Set(["doc"]),
      lookups: 0,
      readingSessions: 0,
      readingSeconds: 0,
      readingTokens: 0,
      listeningSeconds: 0,
      listeningSentences: 0,
      speakingOutputs: 0,
      writingOutputs: 0,
      stateMovement: { total: 0, transitions: {} },
      coverage: { analyzedTokens: 10, knownTokens: 6, unknownTokens: 4, readyDocuments: 1, pendingDocuments: 0, staleDocuments: 0, difficultyTotal: 20, difficultySamples: 1 },
      passiveEvidence: { count: 2, correct: 0, confidenceTotal: 1.5, confidenceSamples: 2, sources: {} },
      activeEvidence: { count: 1, correct: 1, confidenceTotal: 1, confidenceSamples: 1, sources: {} },
      srsReviews: 0,
      srsRetained: 0,
      freshness: "fresh",
    });
    expect(metrics["coverage.ratio"]?.value).toBe(0.6);
    expect(metrics["evidence.passive_count"]?.value).toBe(2);
    expect(metrics["evidence.active_count"]?.value).toBe(1);
    expect(metrics["coverage.ratio"]?.denominator).toBe(10);
  });

  it("does not turn pending or stale data into a measured zero", () => {
    expect(deriveFreshness({ pending: true, now: 100 })).toMatchObject({ status: "pending" });
    expect(deriveFreshness({ computedAt: 0, now: 100, staleAfterMs: 10 }).status).toBe("stale");
    expect(metricValue(0, { freshness: "pending", measured: false }).value).toBeNull();
  });
});
