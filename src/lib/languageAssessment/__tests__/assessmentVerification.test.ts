import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_DIMENSIONS,
  NON_CEFR_DISCLAIMER,
  type AssessmentDimension,
  type AssessmentItem,
  type PlacementSession,
} from "../types";
import {
  buildPlacementSession,
  combineProfileEvidenceWithPlacement,
  finalizePlacementSession,
  stepAdaptiveItem,
} from "../placement";
import { fisherInformation } from "../adaptive";

function makeItem(
  id: string,
  dimension: AssessmentDimension,
  difficulty: number,
): AssessmentItem {
  return {
    id,
    language: "universal",
    dimension,
    targetBand: "B1",
    responseFormat: "multiple-choice",
    prompt: `Item ${id}`,
    options: ["A", "B"],
    correctOptionIndex: 0,
    irt: { difficulty, discrimination: 1.0 },
  };
}

const VOCAB_ITEMS = [
  makeItem("v1", "vocabularyBreadth", -1.5),
  makeItem("v2", "vocabularyBreadth", -0.5),
  makeItem("v3", "vocabularyBreadth", 0.5),
  makeItem("v4", "vocabularyBreadth", 1.5),
];

/** Runs the session to completion by answering every presented item correctly. */
function runAllCorrect(session: PlacementSession): PlacementSession {
  let current = session;
  let guard = 200;
  while (!current.isComplete && current.currentItem && guard-- > 0) {
    const step = stepAdaptiveItem(current, {
      itemId: current.currentItem.id,
      correct: true,
    });
    current = step.session;
  }
  return current;
}

describe("placement assessment verification (OpenSpec 1.1/3.1)", () => {
  it("omits untested dimensions as unavailable instead of collapsing to a single score", () => {
    const session = buildPlacementSession({
      targetLanguage: "es",
      customItems: [...VOCAB_ITEMS, makeItem("g1", "grammarMorphology", 0)],
      includeListening: false,
      includeSpeaking: false,
    });
    const result = finalizePlacementSession(runAllCorrect(session));

    // Listening/speaking are not active in this session -> unavailable, never guessed.
    for (const dim of ["listeningComprehension", "speakingPronunciation"] as const) {
      const estimate = result.dimensions[dim];
      expect(estimate.status).toBe("unavailable");
      expect(estimate.available).toBe(false);
      expect(estimate.estimatedLevel).toBeNull();
      expect(estimate.numericScore).toBeNull();
    }
    expect(result.unavailableDimensions).toContain("listeningComprehension");
    expect(result.unavailableDimensions).toContain("speakingPronunciation");
    expect(result.isOfficialCertification).toBe(false);
    expect(result.disclaimer).toContain("NOT an official CEFR certification");
  });

  it("reports insufficient-evidence for dimensions below the calibration floor", () => {
    const session = buildPlacementSession({
      targetLanguage: "es",
      customItems: [...VOCAB_ITEMS, makeItem("g1", "grammarMorphology", 0)],
      includeListening: false,
      includeSpeaking: false,
      minItemsPerDimension: 2,
      targetSem: 0.01,
    });
    const finished = runAllCorrect(session);
    expect(finished.stopReason).toBe("item-pool-exhausted");
    const result = finalizePlacementSession(finished);

    // Vocabulary had 4 items -> calibrated; grammar had 1 item -> insufficient evidence.
    const vocab = result.dimensions.vocabularyBreadth;
    expect(vocab.status).toBe("calibrated");
    expect(vocab.available).toBe(true);
    expect(vocab.sampleCount).toBeGreaterThanOrEqual(2);

    const grammar = result.dimensions.grammarMorphology;
    expect(grammar.status).toBe("insufficient-evidence");
    expect(grammar.available).toBe(true);
    expect(grammar.sampleCount).toBe(1);
    expect(grammar.calibrationNote).toContain("Provisional");
  });

  it("reports explicit per-dimension uncertainty bounds for calibrated dimensions", () => {
    const session = buildPlacementSession({
      targetLanguage: "es",
      customItems: VOCAB_ITEMS,
      includeListening: false,
      includeSpeaking: false,
      minItemsPerDimension: 1,
      targetSem: 0.01,
    });
    const result = finalizePlacementSession(runAllCorrect(session));
    const estimate = result.dimensions.vocabularyBreadth;

    expect(estimate.status).toBe("calibrated");
    expect(estimate.estimatedLevel).not.toBeNull();
    expect(estimate.numericScore).not.toBeNull();
    expect(estimate.sem).toBeGreaterThan(0);
    expect(estimate.confidenceInterval.minBand).not.toBeNull();
    expect(estimate.confidenceInterval.maxBand).not.toBeNull();
    expect(estimate.confidenceInterval.low).toBeLessThanOrEqual(estimate.confidenceInterval.high);
    expect(estimate.numericScore!).toBeGreaterThanOrEqual(0);
    expect(estimate.numericScore!).toBeLessThanOrEqual(100);
    expect(estimate.confidenceScore).toBeGreaterThan(0);
  });

  it("selects the next item by maximum Fisher information at the current ability estimate", () => {
    const session = buildPlacementSession({
      targetLanguage: "es",
      customItems: VOCAB_ITEMS,
      includeListening: false,
      includeSpeaking: false,
      minItemsPerDimension: 1,
      targetSem: 0.01,
    });

    let current = session;
    let guard = 200;
    while (!current.isComplete && current.currentItem && guard-- > 0) {
      const item = current.currentItem;
      const state = current.dimensionStates[item.dimension];
      const used = new Set([...state.answeredItemIds, ...state.skippedItemIds]);
      const remaining = current.itemPool.filter(
        (candidate) => candidate.dimension === item.dimension && !used.has(candidate.id),
      );

      // The engine's selection rule: argmax fisherInformation(theta, irt) - 0.01*|b-theta|.
      let best: AssessmentItem | null = null;
      let bestScore = -Infinity;
      for (const candidate of remaining) {
        const info = fisherInformation(state.theta, candidate.irt);
        const score = info - Math.abs(candidate.irt.difficulty - state.theta) * 0.01;
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      expect(best?.id).toBe(item.id);

      const step = stepAdaptiveItem(current, { itemId: item.id, correct: true });
      current = step.session;
    }
    expect(current.stopReason).toBe("item-pool-exhausted");
  });

  it("moves the ability estimate up on correct answers and down on wrong answers", () => {
    const build = () =>
      buildPlacementSession({
        targetLanguage: "es",
        customItems: VOCAB_ITEMS,
        includeListening: false,
        includeSpeaking: false,
        minItemsPerDimension: 1,
        targetSem: 0.01,
      });

    const good = runAllCorrect(build());
    expect(good.dimensionStates.vocabularyBreadth.theta).toBeGreaterThan(0);

    let bad = build();
    let guard = 200;
    while (!bad.isComplete && bad.currentItem && guard-- > 0) {
      bad = stepAdaptiveItem(bad, {
        itemId: bad.currentItem.id,
        correct: false,
      }).session;
    }
    expect(bad.dimensionStates.vocabularyBreadth.theta).toBeLessThan(0);
  });

  it("never counts skipped items as evidence samples", () => {
    const session = buildPlacementSession({
      targetLanguage: "es",
      customItems: VOCAB_ITEMS,
      includeListening: false,
      includeSpeaking: false,
      minItemsPerDimension: 1,
      targetSem: 0.01,
    });
    const step = stepAdaptiveItem(session, {
      itemId: session.currentItem!.id,
      skip: true,
    });
    expect(step.recordedResponse.skipped).toBe(true);
    expect(step.session.dimensionStates.vocabularyBreadth.sampleCount).toBe(0);
    expect(step.session.dimensionStates.vocabularyBreadth.answeredItemIds).toHaveLength(0);
    expect(step.session.dimensionStates.vocabularyBreadth.skippedItemIds).toHaveLength(1);
  });

  it("keeps zero-evidence dimensions unavailable when combining profile evidence with placement", () => {
    const placement = finalizePlacementSession(
      runAllCorrect(
        buildPlacementSession({
          targetLanguage: "es",
          customItems: VOCAB_ITEMS,
          includeListening: false,
          includeSpeaking: false,
          minItemsPerDimension: 1,
          targetSem: 0.01,
        }),
      ),
    );
    const combined = combineProfileEvidenceWithPlacement({}, placement);
    expect(combined.dimensions.vocabularyBreadth.available).toBe(true);
    expect(combined.dimensions.listeningComprehension.available).toBe(false);
    expect(combined.disclaimer).toContain(NON_CEFR_DISCLAIMER.slice(0, 24));
  });

  it("exposes exactly the six documented skill dimensions", () => {
    expect(ASSESSMENT_DIMENSIONS).toEqual([
      "vocabularyBreadth",
      "grammarMorphology",
      "readingComprehension",
      "listeningComprehension",
      "writingProduction",
      "speakingPronunciation",
    ]);
  });
});
