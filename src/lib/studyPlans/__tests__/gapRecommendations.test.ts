import { describe, expect, it } from "vitest";
import {
  COVERAGE_THRESHOLD,
  FLASHCARD_MIN_ITEMS,
  GAP_RECOMMENDATION_CAP,
  PRACTICE_MIN_ACCEPTED_14D,
  inferGapRecommendations,
  lexiconTokenCoverage,
  textTokens,
} from "../gapRecommendations";

function node(overrides: Partial<Parameters<typeof inferGapRecommendations>[0]["nodes"][number]> = {}) {
  return {
    nodeId: "n1",
    title: "Spanish subjunctive",
    objectives: ["Uses of the subjunctive mood"],
    included: true,
    activity: "in-progress",
    sourceRefCount: 2,
    materialSupport: "grounded",
    ...overrides,
  };
}

const emptyLexicon: Parameters<typeof inferGapRecommendations>[0]["lexicon"] = [];

describe("textTokens / lexiconTokenCoverage", () => {
  it("normalizes and de-duplicates tokens, dropping stopwords", () => {
    const tokens = textTokens("The Subjunctive, the subjunctive. y el subjuntivo");
    expect(tokens).toContain("subjunctive");
    expect(tokens).toContain("subjuntivo");
    expect(tokens.filter((token) => token === "the").length).toBe(0);
  });

  it("scores coverage by the share of node tokens present in the lexicon", () => {
    const lexicon = [
      { canonicalForm: "Subjunctive", normalizedForm: "subjunctive", state: "learning", passiveEvidenceCount: 2, activeEvidenceCount: 1 },
    ];
    const coverage = lexiconTokenCoverage(lexicon, "Subjunctive uses and forms");
    expect(coverage).toBeGreaterThan(0.2);
    expect(coverage).toBeLessThanOrEqual(1);
  });
});

describe("inferGapRecommendations", () => {
  it("recommends coverage when node terms are absent from the lexicon", () => {
    const result = inferGapRecommendations({
      nodes: [node()],
      lexicon: emptyLexicon,
      practice: { acceptedAttempts14d: 9, acceptedByMode: {} },
      flashcard: { itemCount: 80 },
    });
    expect(result.some((recommendation) => recommendation.type === "coverage")).toBe(true);
  });

  it("skips coverage when the node has no source material", () => {
    const result = inferGapRecommendations({
      nodes: [node({ sourceRefCount: 0, materialSupport: "unsupported" })],
      lexicon: emptyLexicon,
      practice: { acceptedAttempts14d: 9, acceptedByMode: {} },
      flashcard: { itemCount: 80 },
    });
    expect(result.some((recommendation) => recommendation.type === "coverage")).toBe(false);
  });

  it("recommends practice when accepted attempts are below the threshold", () => {
    const result = inferGapRecommendations({
      nodes: [node()],
      lexicon: [{ canonicalForm: "subjunctive", normalizedForm: "subjunctive", state: "known", passiveEvidenceCount: 5, activeEvidenceCount: 5 }],
      practice: { acceptedAttempts14d: 0, acceptedByMode: {} },
      flashcard: { itemCount: 80 },
    });
    const practice = result.find((recommendation) => recommendation.type === "practice");
    expect(practice).toBeDefined();
    expect(practice!.severity).toBe(0.9);
    expect(practice!.count).toBe(0);
  });

  it("does not recommend practice for completed nodes", () => {
    const result = inferGapRecommendations({
      nodes: [node({ activity: "completed" })],
      lexicon: [{ canonicalForm: "subjunctive", normalizedForm: "subjunctive", state: "known", passiveEvidenceCount: 5, activeEvidenceCount: 5 }],
      practice: { acceptedAttempts14d: 0, acceptedByMode: {} },
      flashcard: { itemCount: 80 },
    });
    expect(result.some((recommendation) => recommendation.type === "practice")).toBe(false);
  });

  it("recommends flashcard mining below the item threshold", () => {
    const result = inferGapRecommendations({
      nodes: [node()],
      lexicon: [{ canonicalForm: "subjunctive", normalizedForm: "subjunctive", state: "known", passiveEvidenceCount: 5, activeEvidenceCount: 5 }],
      practice: { acceptedAttempts14d: 9, acceptedByMode: {} },
      flashcard: { itemCount: 4 },
    });
    const flashcard = result.find((recommendation) => recommendation.type === "flashcard");
    expect(flashcard).toBeDefined();
    expect(flashcard!.severity).toBe(0.7);
  });

  it("caps and sorts by severity descending", () => {
    const nodes = Array.from({ length: 20 }, (_, index) => node({
      nodeId: `n${index}`,
      title: `Topic ${index} with many uncommon words`,
      objectives: ["unfamiliar terminology here"],
      sourceRefCount: 1,
    }));
    const result = inferGapRecommendations({
      nodes,
      lexicon: emptyLexicon,
      practice: { acceptedAttempts14d: 0, acceptedByMode: {} },
      flashcard: { itemCount: 0 },
    });
    expect(result.length).toBeLessThanOrEqual(GAP_RECOMMENDATION_CAP);
    for (let index = 1; index < result.length; index += 1) {
      expect(result[index - 1]!.severity).toBeGreaterThanOrEqual(result[index]!.severity);
    }
  });

  it("exposes threshold constants so the UI can echo them", () => {
    expect(COVERAGE_THRESHOLD).toBe(0.5);
    expect(PRACTICE_MIN_ACCEPTED_14D).toBe(3);
    expect(FLASHCARD_MIN_ITEMS).toBe(25);
  });
});
