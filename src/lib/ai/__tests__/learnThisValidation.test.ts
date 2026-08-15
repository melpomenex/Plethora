/**
 * Candidate validation pipeline tests (task 2.9, spec:
 * ai-learning-material-generation "Candidate validation").
 *
 *  - grounded candidates pass;
 *  - ungrounded answers and non-verbatim cloze deletions are FLAGGED (kept,
 *    not dropped) and cannot be accepted without editing;
 *  - duplicates against existing items (≥ 0.85) and against earlier
 *    candidates in the same proposal are flagged;
 *  - duplicate-check failures never block the preview (advisory).
 */

import { describe, expect, it, vi } from "vitest";
import type { DuplicateCandidate } from "../../../api/learning-items";
import type { LearningCardCandidate, LearningMaterialProposal } from "../schemas/learningMaterial";
import {
  DUPLICATE_SIMILARITY_THRESHOLD,
  checkCandidateGrounding,
  dedupeCandidates,
  validateLearnThisProposal,
} from "../tasks/definitions/learnThisValidation";

const PASSAGE =
  "Entropy is a measure of the number of microstates consistent with a macrostate. Temperature is the average kinetic energy of particles in a system.";

function card(partial: Partial<LearningCardCandidate>): LearningCardCandidate {
  return {
    cardType: "definition",
    conceptKeys: ["entropy"],
    question: "Define entropy.",
    answer:
      "Entropy is a measure of the number of microstates consistent with a macrostate.",
    ...partial,
  };
}

function proposal(cards: LearningCardCandidate[]): LearningMaterialProposal {
  return {
    importance: 0.8,
    knowledgeType: "definition",
    concepts: ["entropy"],
    suggestedCards: cards,
    prerequisites: [],
    tags: ["physics"],
    rationale: "Core definition.",
  };
}

const noDuplicates = async () => [] as DuplicateCandidate[];

describe("checkCandidateGrounding", () => {
  it("passes a grounded answer", () => {
    const result = checkCandidateGrounding(card({}), PASSAGE);
    expect(result.grounded).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("flags a fabricated answer", () => {
    const result = checkCandidateGrounding(
      card({ answer: "Entropy is purple cheese riding a unicycle through hyperspace." }),
      PASSAGE
    );
    expect(result.grounded).toBe(false);
    expect(result.issues.join(" ")).toContain("not grounded");
  });

  it("flags a cloze deletion that is not verbatim in the source", () => {
    const result = checkCandidateGrounding(
      card({
        cardType: "cloze",
        question: "Entropy is a form of {{c1::phagocytosis}}.",
        clozeText: "Entropy is a form of {{c1::phagocytosis}}.",
        answer: "phagocytosis",
      }),
      PASSAGE
    );
    expect(result.grounded).toBe(false);
    expect(result.issues.join(" ")).toContain("verbatim");
  });

  it("passes a verbatim cloze deletion", () => {
    const result = checkCandidateGrounding(
      card({
        cardType: "cloze",
        question: "Entropy is a {{c1::measure}} of microstates.",
        clozeText: "Entropy is a {{c1::measure}} of microstates.",
        answer: "measure",
      }),
      PASSAGE
    );
    expect(result.grounded).toBe(true);
  });
});

describe("validateLearnThisProposal", () => {
  it("marks grounded, unique candidates valid", async () => {
    const validated = await validateLearnThisProposal(
      proposal([
        card({}),
        card({
          conceptKeys: ["temperature"],
          question: "What is temperature?",
          answer: "Temperature is the average kinetic energy of particles in a system.",
        }),
      ]),
      PASSAGE,
      { checkExistingDuplicates: noDuplicates }
    );
    expect(validated.validCount).toBe(2);
    expect(validated.candidates.every((c) => c.status === "valid")).toBe(true);
  });

  it("flags ungrounded candidates without dropping them", async () => {
    const validated = await validateLearnThisProposal(
      proposal([card({}), card({ answer: "Entropy is purple cheese in hyperspace." })]),
      PASSAGE,
      { checkExistingDuplicates: noDuplicates }
    );
    expect(validated.candidates).toHaveLength(2);
    expect(validated.candidates[0].status).toBe("valid");
    expect(validated.candidates[1].status).toBe("ungrounded");
    expect(validated.candidates[1].issues.length).toBeGreaterThan(0);
  });

  it("flags candidates similar to existing items at the create-item threshold", async () => {
    // Parity requirement: `create_learning_item` refuses at ≥ 0.85; the
    // pipeline must flag at exactly the same similarity.
    expect(DUPLICATE_SIMILARITY_THRESHOLD).toBe(0.85);
    const check = vi.fn(async () => [
      { id: "existing-1", question: "Define entropy.", similarity: 0.91 },
    ] as DuplicateCandidate[]);
    const validated = await validateLearnThisProposal(proposal([card({})]), PASSAGE, {
      checkExistingDuplicates: check,
    });
    expect(validated.candidates[0].status).toBe("duplicate");
    expect(validated.candidates[0].duplicateOfItemId).toBe("existing-1");
    expect(check).toHaveBeenCalledWith("Define entropy.", 3);
  });

  it("ignores weak existing-item similarity below the threshold", async () => {
    const validated = await validateLearnThisProposal(proposal([card({})]), PASSAGE, {
      checkExistingDuplicates: async () => [
        { id: "weak", question: "What is enthalpy?", similarity: 0.4 },
      ],
    });
    expect(validated.candidates[0].status).toBe("valid");
  });

  it("flags a later candidate that duplicates an earlier one in the same proposal", async () => {
    const duplicate = card({ question: " Define entropy. ", answer: "  Entropy is a measure of the number of microstates consistent with a macrostate. " });
    const validated = await validateLearnThisProposal(
      proposal([card({}), duplicate]),
      PASSAGE,
      { checkExistingDuplicates: noDuplicates }
    );
    expect(validated.candidates[0].status).toBe("valid");
    expect(validated.candidates[1].status).toBe("duplicate");
    expect(validated.candidates[1].duplicateOfIndex).toBe(1);
  });

  it("treats duplicate-check errors as advisory", async () => {
    const validated = await validateLearnThisProposal(proposal([card({})]), PASSAGE, {
      checkExistingDuplicates: async () => {
        throw new Error("db offline");
      },
    });
    expect(validated.candidates[0].status).toBe("valid");
  });

  it("only queries existing items for non-self-duplicates", async () => {
    const check = vi.fn(noDuplicates);
    const duplicate = card({ question: " Define entropy. ", answer: " Entropy is a measure of the number of microstates consistent with a macrostate." });
    await validateLearnThisProposal(proposal([card({}), duplicate]), PASSAGE, {
      checkExistingDuplicates: check,
    });
    expect(check).toHaveBeenCalledTimes(1);
  });
});

describe("dedupeCandidates", () => {
  it("keeps first occurrences using the existing dedup signature", () => {
    const first = card({});
    const second = card({
      question: "  Define entropy.",
      answer: "Entropy is a measure of the number of microstates consistent with a macrostate ",
    });
    const distinct = card({ question: "What is temperature?", answer: "Average kinetic energy of particles." });
    const kept = dedupeCandidates([first, second, distinct]);
    expect(kept).toHaveLength(2);
    expect(kept[0].question).toBe(first.question);
    expect(kept[1].question).toBe(distinct.question);
  });
});
