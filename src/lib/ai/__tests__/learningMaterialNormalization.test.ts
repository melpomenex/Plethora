/**
 * Normalization regression tests for the "Learn this" envelope.
 *
 * Reproduces the on-device failure seen on an EPUB (v2.6.2): Gemini Nano
 * answered `importance: "high"` and a `knowledgeType` outside the canonical
 * enum, and the whole proposal failed validation ("importance: expected
 * finite number", "knowledgeType: expected one of [definition|…]"). Scalar
 * metadata is now coerced before strict validation; card content stays
 * strictly validated (grounding, verbatim cloze).
 */
import { describe, expect, it } from "vitest";
import {
  coerceImportance,
  normalizeCardType,
  normalizeKnowledgeType,
  validateLearningMaterialProposal,
} from "../schemas/learningMaterial";

describe("coerceImportance", () => {
  it.each([
    [0.8, 0.8],
    [1.4, 0.14], // values in (1,10] read as a 0–10 scale
    [-0.2, 0], // clamped
    [8, 0.8], // 0–10 scale tolerated
    ["0.8", 0.8],
    ["8/10", 0.8],
    ["80%", 0.8],
    ["high", 0.75],
    ["Very High", 0.9],
    ["critical", 0.95],
    ["medium", 0.5],
  ])("coerces %p to %p", (input, expected) => {
    expect(coerceImportance(input)).toBeCloseTo(expected, 5);
  });

  it("defaults unparseable values to 0.5", () => {
    expect(coerceImportance("maybe?")).toBe(0.5);
    expect(coerceImportance(undefined)).toBe(0.5);
    expect(coerceImportance(Number.NaN)).toBe(0.5);
  });
});

describe("normalizeKnowledgeType", () => {
  it.each([
    ["date-event", "dateEvent"],
    ["Date Event", "dateEvent"],
    ["temporal", "dateEvent"],
    ["Cause/Effect", "causeEffect"],
    ["cause_effect", "causeEffect"],
    ["Comparison", "comparison"],
    ["concept", "general"],
    ["some-unknown-type", "general"],
  ])("maps %p to %p", (input, expected) => {
    expect(normalizeKnowledgeType(input)).toBe(expected);
  });
});

describe("normalizeCardType", () => {
  it.each([
    ["Q&A", "qa"],
    ["Question/Answer", "qa"],
    ["basic card", "qa"],
    ["fill-in-the-blank", "cloze"],
    ["image occlusion", "occlusion-ref"],
    ["whatever", "qa"],
  ])("maps %p to %p", (input, expected) => {
    expect(normalizeCardType(input)).toBe(expected);
  });
});

describe("validateLearningMaterialProposal with near-miss model output", () => {
  // The exact failure shape from the device: string importance, off-enum
  // knowledgeType, and loosely-spelled card types must no longer fail the
  // envelope.
  const nearMiss = {
    importance: "high",
    knowledgeType: "date-event",
    concepts: ["unification"],
    suggestedCards: [
      {
        cardType: "Q&A",
        conceptKeys: ["unification"],
        question: "What year did German unification complete?",
        answer: "1871",
      },
    ],
    prerequisites: [],
    tags: ["history"],
    rationale: "A date/event worth remembering.",
  };

  it("salvages the on-device near-miss payload", () => {
    const result = validateLearningMaterialProposal(nearMiss, {
      sourceText: "German unification completed in 1871 …",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.importance).toBeCloseTo(0.75, 5);
      expect(result.value.knowledgeType).toBe("dateEvent");
      expect(result.value.suggestedCards[0].cardType).toBe("qa");
    }
  });

  it("defaults omitted metadata (device report: prerequisites/tags/rationale missing)", () => {
    const sparse = {
      importance: 0.7,
      knowledgeType: "definition",
      concepts: ["entropy"],
      suggestedCards: [
        {
          cardType: "cloze",
          question: "Entropy is a measure of {{c1::disorder}}.",
          answer: "disorder",
          clozeText: "",
        },
      ],
      // prerequisites, tags, rationale intentionally omitted
    };
    const result = validateLearningMaterialProposal(sparse, {
      sourceText: "Entropy is a measure of disorder in a system.",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prerequisites).toEqual([]);
      expect(result.value.tags).toEqual([]);
      expect(typeof result.value.rationale).toBe("string");
      // Empty clozeText falls back to the question (the cloze sentence).
      expect(result.value.suggestedCards[0].clozeText).toBe(
        "Entropy is a measure of {{c1::disorder}}."
      );
    }
  });

  it("still fails closed on ungrounded card content", () => {
    const result = validateLearningMaterialProposal(nearMiss, {
      sourceText: "A completely unrelated passage about sourdough starters.",
    });
    expect(result.ok).toBe(false);
  });

  it("still fails closed when the root is not an object", () => {
    expect(validateLearningMaterialProposal("nope").ok).toBe(false);
  });
});
