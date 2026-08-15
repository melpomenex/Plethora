import { describe, expect, it } from "vitest";
import {
  validateLearningMaterialProposal,
  MAX_LEARNING_CARDS,
  type LearningMaterialProposal,
} from "../schemas/learningMaterial";
import { validateAnswerAssessment, type AnswerAssessment } from "../schemas/answerAssessment";
import {
  validateRecallQuestionProposal,
  type RecallQuestionProposal,
} from "../schemas/recallQuestion";
import {
  validateOcclusionLabelSelection,
  type OcclusionLabelSelection,
} from "../schemas/occlusionLabel";
import {
  validatePrerequisiteAnalysis,
  type PrerequisiteAnalysis,
} from "../schemas/prerequisite";import {
  validatePassageClassification,
  type PassageClassification,
} from "../schemas/passageClassification";
import { validateTutorTurn, type TutorTurn } from "../schemas/tutorTurn";

const SOURCE =
  "Mitochondria are organelles found in most eukaryotic cells. They generate most of the cell's supply of ATP, which is used as a source of chemical energy. The inner membrane is folded into cristae.";

/** Build an intentionally invalid variant of a typed payload. */
function invalid<T>(base: T, patch: Record<string, unknown>): T {
  return { ...base, ...patch } as T;
}

describe("LearningMaterialProposal", () => {
  function proposal(
    overrides: Partial<LearningMaterialProposal> = {}
  ): LearningMaterialProposal {
    return {
      importance: 0.8,
      knowledgeType: "definition",
      concepts: ["mitochondria", "ATP"],
      suggestedCards: [
        {
          cardType: "definition",
          concept: "mitochondria",
          conceptKeys: ["mitochondria"],
          question: "What do mitochondria generate?",
          answer: "Most of the cell's supply of ATP",
          evidenceQuote: "generate most of the cell's supply of ATP",
        },
      ],
      prerequisites: ["eukaryotic cells"],
      tags: ["biology"],
      rationale: "Core definition with clear evidence.",
      ...overrides,
    };
  }

  it("accepts a well-formed proposal", () => {
    const result = validateLearningMaterialProposal(proposal(), { sourceText: SOURCE });
    expect(result.ok).toBe(true);
  });

  it("accepts cloze cards whose deletion appears verbatim in the source", () => {
    const result = validateLearningMaterialProposal(
      proposal({
        knowledgeType: "enumeration",
        suggestedCards: [
          {
            cardType: "cloze",
            concept: "ATP",
            conceptKeys: ["ATP"],
            question: "Mitochondria generate most of the cell's supply of {{c1::ATP}}",
            answer: "ATP",
            clozeText: "Mitochondria generate most of the cell's supply of {{c1::ATP}}",
            clozeRanges: [[53, 56]],
          },
        ],
      }),
      { sourceText: SOURCE }
    );
    expect(result.ok).toBe(true);
  });

  it("rejects cloze ranges outside the cloze text", () => {
    const result = validateLearningMaterialProposal(
      proposal({
        suggestedCards: [
          {
            cardType: "cloze",
            conceptKeys: ["ATP"],
            question: "Mitochondria generate most of the cell's supply of {{c1::ATP}}",
            answer: "ATP",
            clozeText: "Mitochondria generate most of the cell's supply of {{c1::ATP}}",
            clozeRanges: [[0, 9999]],
          },
        ],
      }),
      { sourceText: SOURCE }
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(" ")).toContain("clozeRanges");
  });

  it("rejects malformed cloze ranges", () => {
    const result = validateLearningMaterialProposal(
      proposal({
        suggestedCards: [
          {
            cardType: "cloze",
            conceptKeys: ["ATP"],
            question: "Supply of {{c1::ATP}}",
            answer: "ATP",
            clozeText: "Supply of {{c1::ATP}}",
            clozeRanges: [[5, 5]],
          },
        ],
      }),
      { sourceText: SOURCE }
    );
    expect(result.ok).toBe(false);
  });

  it("rejects cards missing required conceptKeys", () => {
    const bad = proposal() as unknown as Record<string, unknown>;
    const card = (bad.suggestedCards as Array<Record<string, unknown>>)[0];
    delete card.conceptKeys;
    const result = validateLearningMaterialProposal(bad);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(" ")).toContain("conceptKeys");
  });

  it("accepts imageRefId on occlusion-ref cards", () => {
    const result = validateLearningMaterialProposal(
      proposal({
        suggestedCards: [
          {
            cardType: "occlusion-ref",
            conceptKeys: ["heart"],
            question: "Label the heart chambers",
            answer: "See image",
            imageRefId: "asset-42",
          },
        ],
      })
    );
    expect(result.ok).toBe(true);
  });

  it("rejects cloze cards whose deletion is not verbatim in the source", () => {
    const result = validateLearningMaterialProposal(
      proposal({
        suggestedCards: [
          {
            cardType: "cloze",
            conceptKeys: ["glucose"],
            question: "Mitochondria produce {{c1::glucose}} for the cell",
            answer: "glucose",
            clozeText: "Mitochondria produce {{c1::glucose}} for the cell",
          },
        ],
      }),
      { sourceText: SOURCE }
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(" ")).toContain("verbatim");
  });

  it("rejects ungrounded answers when source text is provided", () => {
    const result = validateLearningMaterialProposal(
      proposal({
        suggestedCards: [
          {
            cardType: "qa",
            concept: "quantum",
            conceptKeys: ["quantum"],
            question: "What causes stellar collapse?",
            answer: "Quantum entanglement inversion matrices",
          },
        ],
      }),
      { sourceText: SOURCE }
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(" ")).toContain("grounded");
  });

  it("enforces the 8-card cap", () => {
    const cards = Array.from({ length: MAX_LEARNING_CARDS + 1 }, (_, i) => ({
      cardType: "qa" as const,
      concept: `concept-${i}`,
      conceptKeys: [`concept-${i}`],
      question: `Q${i}?`,
      answer: `A${i}`,
    }));
    const result = validateLearningMaterialProposal(proposal({ suggestedCards: cards }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(" ")).toContain("more than 8");
  });

  it("enforces the 2-cards-per-concept cap", () => {
    const result = validateLearningMaterialProposal(
      proposal({
        suggestedCards: [
          { cardType: "qa", concept: "ATP", conceptKeys: ["ATP"], question: "Q1?", answer: "A1" },
          { cardType: "qa", concept: "atp", conceptKeys: ["ATP"], question: "Q2?", answer: "A2" },
          { cardType: "qa", concept: "ATP", conceptKeys: ["ATP"], question: "Q3?", answer: "A3" },
        ],
      })
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(" ").toLowerCase()).toContain(
      "more than 2 cards for concept"
    );
  });

  it("uses the Kotlin-contract knowledge-type spelling and rejects unknowns", () => {
    expect(validateLearningMaterialProposal(proposal({ knowledgeType: "dateEvent" })).ok).toBe(
      true
    );
    expect(
      validateLearningMaterialProposal(invalid(proposal(), { knowledgeType: "date-event" })).ok
    ).toBe(false);
    expect(
      validateLearningMaterialProposal(invalid(proposal(), { knowledgeType: "diagram" })).ok
    ).toBe(false);
    expect(
      validateLearningMaterialProposal(invalid(proposal(), { knowledgeType: "vibe" })).ok
    ).toBe(false);
  });

  it("rejects malformed payloads without partial output", () => {
    expect(validateLearningMaterialProposal(null).ok).toBe(false);
    expect(validateLearningMaterialProposal("text").ok).toBe(false);
    expect(validateLearningMaterialProposal([]).ok).toBe(false);
    expect(validateLearningMaterialProposal({ ...proposal(), importance: 4 }).ok).toBe(false);
    expect(validateLearningMaterialProposal({ ...proposal(), importance: "high" }).ok).toBe(false);
    expect(
      validateLearningMaterialProposal({ ...proposal(), suggestedCards: "many" }).ok
    ).toBe(false);
    expect(
      validateLearningMaterialProposal({ ...proposal(), rationale: "" }).ok
    ).toBe(false);
    const missing = validateLearningMaterialProposal({ importance: 0.5 });
    expect(missing.ok).toBe(false);
    expect(missing.ok === false && missing.errors.length).toBeGreaterThan(0);
  });

  it("rejects adversarial card entries but reports per-card errors", () => {
    const result = validateLearningMaterialProposal(
      invalid(proposal(), {
        suggestedCards: [
          { cardType: "qa", conceptKeys: ["x"], question: "", answer: "A" },
          "not an object",
        ],
      })
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.some((e) => e.includes("question"))).toBe(true);
    expect(result.ok === false && result.errors.some((e) => e.includes("expected object"))).toBe(
      true
    );
  });
});

describe("AnswerAssessment", () => {
  function assessment(overrides: Partial<AnswerAssessment> = {}): AnswerAssessment {
    return {
      classification: "partial",
      score: 0.5,
      completeness: 0.4,
      missingConcepts: ["virtual address space"],
      feedback: "You describe compression but miss paging.",
      suggestedCorrection: "Virtual memory exceeds RAM via disk-backed paging.",
      confidence: 0.8,
      ...overrides,
    };
  }

  it("accepts a well-formed assessment", () => {
    expect(validateAnswerAssessment(assessment()).ok).toBe(true);
    expect(
      validateAnswerAssessment(assessment({ classification: "misconception", misconception: "Thinks memory is compressed" })).ok
    ).toBe(true);
  });

  it("requires a misconception description for misconception classification", () => {
    const result = validateAnswerAssessment(
      assessment({ classification: "misconception", misconception: undefined })
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(" ")).toContain("misconception");
  });

  it("rejects out-of-range scores and bad enums", () => {
    expect(validateAnswerAssessment(invalid(assessment(), { score: 1.5 })).ok).toBe(false);
    expect(validateAnswerAssessment(invalid(assessment(), { completeness: -0.1 })).ok).toBe(false);
    expect(validateAnswerAssessment(invalid(assessment(), { classification: "kinda" })).ok).toBe(
      false
    );
    expect(validateAnswerAssessment(invalid(assessment(), { confidence: "high" })).ok).toBe(false);
  });

  it("rejects non-object payloads", () => {
    expect(validateAnswerAssessment(undefined).ok).toBe(false);
    expect(validateAnswerAssessment(42).ok).toBe(false);
    expect(validateAnswerAssessment("correct").ok).toBe(false);
  });
});

describe("RecallQuestionProposal", () => {
  function recall(overrides: Partial<RecallQuestionProposal> = {}): RecallQuestionProposal {
    return {
      question: "What does the inner membrane fold into?",
      expectedAnswer: "Cristae",
      conceptKeys: ["mitochondria", "cristae"],
      chunkRefs: ["chunk-1", "chunk-2"],
      ...overrides,
    };
  }

  it("accepts a well-formed proposal with known chunk refs", () => {
    expect(
      validateRecallQuestionProposal(recall(), { knownChunkIds: ["chunk-1", "chunk-2", "chunk-3"] }).ok
    ).toBe(true);
  });

  it("rejects hallucinated chunk refs against the known set", () => {
    const result = validateRecallQuestionProposal(recall(), { knownChunkIds: ["chunk-1"] });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(" ")).toContain("does not exist");
  });

  it("requires at least one chunk ref", () => {
    expect(validateRecallQuestionProposal(recall({ chunkRefs: [] })).ok).toBe(false);
  });

  it("rejects malformed payloads", () => {
    expect(validateRecallQuestionProposal({ question: "Q?" }).ok).toBe(false);
    expect(validateRecallQuestionProposal(null).ok).toBe(false);
    expect(
      validateRecallQuestionProposal({ ...recall(), conceptKeys: "mitochondria" }).ok
    ).toBe(false);
  });
});

describe("OcclusionLabelSelection", () => {
  function selection(overrides: Partial<OcclusionLabelSelection> = {}): OcclusionLabelSelection {
    return {
      appropriate: true,
      selections: [
        {
          labelIds: ["label-1", "label-2"],
          question: "Which chambers are label 1 and 2?",
          answer: "Left ventricle and right atrium",
        },
      ],
      rejected: [{ labelId: "label-3", reason: "Figure caption" }],
      ...overrides,
    };
  }

  it("accepts a well-formed selection with known labels", () => {
    expect(
      validateOcclusionLabelSelection(selection(), {
        knownLabelIds: ["label-1", "label-2", "label-3"],
      }).ok
    ).toBe(true);
  });

  it("rejects label ids that do not reference a real OCR id", () => {
    const result = validateOcclusionLabelSelection(selection(), {
      knownLabelIds: ["label-1"],
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(" ")).toContain("unknown OCR label id");
  });

  it("rejects any model-generated geometry", () => {
    const withGeometry = {
      ...selection(),
      selections: [
        {
          labelIds: ["label-1"],
          question: "Q?",
          answer: "A",
          x: 0.2,
          y: 0.3,
          width: 0.4,
          height: 0.1,
        },
      ],
    };
    const result = validateOcclusionLabelSelection(withGeometry, { knownLabelIds: ["label-1"] });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(" ")).toContain("geometry");
  });

  it("rejects top-level geometry and bbox aliases", () => {
    const result = validateOcclusionLabelSelection({
      ...selection(),
      bboxPercent: [10, 20, 30, 40],
    });
    expect(result.ok).toBe(false);
  });

  it("enforces appropriateness/selection consistency", () => {
    expect(validateOcclusionLabelSelection(selection({ appropriate: false })).ok).toBe(false);
    expect(
      validateOcclusionLabelSelection(selection({ appropriate: true, selections: [] })).ok
    ).toBe(false);
    expect(
      validateOcclusionLabelSelection(selection({ appropriate: false, selections: [], rejected: [] })).ok
    ).toBe(true);
  });

  it("rejects malformed payloads", () => {
    expect(validateOcclusionLabelSelection(null).ok).toBe(false);
    expect(validateOcclusionLabelSelection({ appropriate: "yes" }).ok).toBe(false);
    expect(
      validateOcclusionLabelSelection({ appropriate: true, selections: "many" }).ok
    ).toBe(false);
    expect(
      validateOcclusionLabelSelection({ appropriate: true, selections: [{ labelIds: [] }] }).ok
    ).toBe(false);
  });
});

describe("PrerequisiteAnalysis", () => {
  function analysis(overrides: Partial<PrerequisiteAnalysis> = {}): PrerequisiteAnalysis {
    return {
      prerequisites: [
        {
          concept: "Regular pumping lemma",
          why: "The CFL lemma proof builds directly on its regular-language form.",
        },
      ],
      ...overrides,
    };
  }

  it("accepts a well-formed analysis (empty list means no prerequisites)", () => {
    expect(validatePrerequisiteAnalysis(analysis()).ok).toBe(true);
    expect(validatePrerequisiteAnalysis({ prerequisites: [] }).ok).toBe(true);
  });

  it("rejects entries missing concept or why", () => {
    expect(
      validatePrerequisiteAnalysis({ prerequisites: [{ concept: "X" }] }).ok
    ).toBe(false);
    expect(
      validatePrerequisiteAnalysis({ prerequisites: [{ why: "because" }] }).ok
    ).toBe(false);
  });

  it("enforces the cap on entries", () => {
    expect(
      validatePrerequisiteAnalysis({
        prerequisites: Array.from({ length: 13 }, (_, i) => ({
          concept: `c${i}`,
          why: `w${i}`,
        })),
      }).ok
    ).toBe(false);
  });

  it("rejects malformed payloads", () => {
    expect(validatePrerequisiteAnalysis({ prerequisites: "none" }).ok).toBe(false);
    expect(validatePrerequisiteAnalysis({ concepts: [] }).ok).toBe(false);
    expect(validatePrerequisiteAnalysis(null).ok).toBe(false);
    expect(
      validatePrerequisiteAnalysis({ prerequisites: [{ concept: "", why: "w" }] }).ok
    ).toBe(false);
  });
});

describe("PassageClassification", () => {
  function classification(
    overrides: Partial<PassageClassification> = {}
  ): PassageClassification {
    return {
      type: "definition",
      extractWorthiness: 0.82,
      reason: "Formal definition of a key term.",
      suggestedLearningAction: "flashcard",
      ...overrides,
    };
  }

  it("accepts well-formed classifications across the enum", () => {
    for (const type of ["transition", "bibliography", "low-value"] as const) {
      expect(
        validatePassageClassification(classification({ type, extractWorthiness: 0.1, suggestedLearningAction: "none" })).ok
      ).toBe(true);
    }
  });

  it("rejects out-of-range worthiness and bad enums", () => {
    expect(
      validatePassageClassification(invalid(classification(), { extractWorthiness: 1.2 })).ok
    ).toBe(false);
    expect(validatePassageClassification(invalid(classification(), { type: "filler" })).ok).toBe(
      false
    );
    expect(
      validatePassageClassification(invalid(classification(), { suggestedLearningAction: "delete" })).ok
    ).toBe(false);
    expect(validatePassageClassification(invalid(classification(), { reason: "" })).ok).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(validatePassageClassification("definition").ok).toBe(false);
  });
});

describe("TutorTurn", () => {
  function turn(overrides: Partial<TutorTurn> = {}): TutorTurn {
    return {
      move: "question",
      content: "What does the folding of the inner membrane increase?",
      hintLevel: 0,
      stuckDetected: false,
      ...overrides,
    };
  }

  it("accepts well-formed turns including card promotion", () => {
    expect(validateTutorTurn(turn()).ok).toBe(true);
    expect(
      validateTutorTurn(
        turn({ move: "wrap-up", promoteToCard: { question: "Q?", answer: "A" } })
      ).ok
    ).toBe(true);
  });

  it("rejects bad moves, hint levels, and promotion shapes", () => {
    expect(validateTutorTurn(invalid(turn(), { move: "answer" })).ok).toBe(false);
    expect(validateTutorTurn(invalid(turn(), { hintLevel: 4 })).ok).toBe(false);
    expect(validateTutorTurn(invalid(turn(), { hintLevel: 1.5 })).ok).toBe(false);
    expect(validateTutorTurn(invalid(turn(), { stuckDetected: "yes" })).ok).toBe(false);
    expect(validateTutorTurn(invalid(turn(), { promoteToCard: { question: "Q?" } })).ok).toBe(
      false
    );
    expect(validateTutorTurn(invalid(turn(), { content: "" })).ok).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(validateTutorTurn(null).ok).toBe(false);
    expect(validateTutorTurn(7).ok).toBe(false);
  });
});
