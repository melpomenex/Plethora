/**
 * Task-definition invariants for `LearnThisTask` (task 2.9, design D4/D9/D16):
 *  - containment clause in the static system instruction;
 *  - document text (passage/title/heading) ONLY inside untrusted blocks;
 *  - router class, budgets, structured-output wiring;
 *  - caps enforced as caps (≤ 8 cards, ≤ 2 per concept);
 *  - two-stage validation: strict grounding → shape-only → fail closed.
 */

import { describe, expect, it } from "vitest";
import { findUntrustedLeaks, hasContainmentClause } from "../tasks/containment";
import { getTaskDefinition } from "../tasks/registry";
import {
  LEARN_THIS_MAX_OUTPUT_TOKENS,
  LEARN_THIS_TASK_ID,
  LEARN_THIS_TIMEOUT_MS,
  enforceLearnThisCaps,
  learnThisTask,
} from "../tasks/definitions/learnThisTask";
import { isFailedOutcome, isValidOutcome } from "../schemas/common";
import {
  MAX_CARDS_PER_CONCEPT,
  MAX_LEARNING_CARDS,
  type LearningMaterialProposal,
} from "../schemas/learningMaterial";

const NEEDLE_PASSAGE =
  "UNIQUE-PASSAGE Entropy is a measure of the number of microstates consistent with a macrostate. UNIQUE-END";
const NEEDLE_TITLE = "UNIQUE-TITLE Thermodynamics Chapter 4";
const NEEDLE_HEADING = "UNIQUE-HEADING Statistical Definitions";

function makeProposal(overrides: Partial<LearningMaterialProposal> = {}): LearningMaterialProposal {
  return {
    importance: 0.8,
    knowledgeType: "definition",
    concepts: ["entropy"],
    suggestedCards: [
      {
        cardType: "definition",
        conceptKeys: ["entropy"],
        question: "Define entropy.",
        answer:
          "Entropy is a measure of the number of microstates consistent with a macrostate.",
      },
    ],
    prerequisites: [],
    tags: ["physics"],
    rationale: "Core statistical-mechanics definition.",
    ...overrides,
  };
}

describe("learnThisTask definition invariants (design D4/D9/D16)", () => {
  it("registers under its task id in the router registry", () => {
    expect(getTaskDefinition(LEARN_THIS_TASK_ID)).toBe(learnThisTask as never);
  });

  it("uses the full model class with the card-generation latency budget", () => {
    expect(learnThisTask.modelClass).toBe("full");
    expect(learnThisTask.outputKind).toBe("structured");
    expect(learnThisTask.maxOutputTokens).toBe(LEARN_THIS_MAX_OUTPUT_TOKENS);
    expect(LEARN_THIS_MAX_OUTPUT_TOKENS).toBe(600);
    expect(learnThisTask.timeoutMs).toBe(LEARN_THIS_TIMEOUT_MS);
    expect(LEARN_THIS_TIMEOUT_MS).toBe(20_000);
  });

  it("declares the canonical learningMaterialProposal schema", () => {
    expect(learnThisTask.schema?.name).toBe("LearningMaterialProposal");
    expect(learnThisTask.schema?.nativeName).toBe("learningMaterialProposal");
    expect(learnThisTask.schema?.json).toContain("knowledgeType");
  });

  it("carries the containment clause in the static system instruction", () => {
    expect(hasContainmentClause(learnThisTask.systemInstruction)).toBe(true);
  });

  it("embeds passage, title and heading ONLY inside untrusted blocks", () => {
    const built = learnThisTask.buildInput({
      passage: NEEDLE_PASSAGE,
      documentTitle: NEEDLE_TITLE,
      sectionHeading: NEEDLE_HEADING,
    });
    const leaks = findUntrustedLeaks(built.text, [NEEDLE_PASSAGE, NEEDLE_TITLE, NEEDLE_HEADING]);
    expect(leaks).toEqual([]);
    expect(built.text).toContain('<untrusted_source id="passage">');
    expect(built.text).toContain('<untrusted_source id="document-title">');
    expect(built.text).toContain('<untrusted_source id="section-heading">');
  });

  it("omits optional context blocks when not provided", () => {
    const built = learnThisTask.buildInput({ passage: NEEDLE_PASSAGE });
    expect(built.text).not.toContain("document-title");
    expect(built.text).not.toContain("section-heading");
  });
});

describe("enforceLearnThisCaps (spec: cap enforcement)", () => {
  it("keeps only the first MAX_LEARNING_CARDS cards (importance ordering)", () => {
    const cards: LearningMaterialProposal["suggestedCards"] = Array.from(
      { length: MAX_LEARNING_CARDS + 3 },
      (_, i) => ({
        cardType: "qa" as const,
        conceptKeys: ["c"],
        concept: `concept-${i}`,
        question: `Q${i}`,
        answer: `A${i}`,
      })
    );
    const capped = enforceLearnThisCaps(makeProposal({ suggestedCards: cards }));
    expect((capped as LearningMaterialProposal).suggestedCards).toHaveLength(MAX_LEARNING_CARDS);
    // Ranked by proposal order: the FIRST 8 survive.
    expect((capped as LearningMaterialProposal).suggestedCards[0].question).toBe("Q0");
    expect((capped as LearningMaterialProposal).suggestedCards[7].question).toBe("Q7");
  });

  it("keeps at most MAX_CARDS_PER_CONCEPT cards per concept", () => {
    const cards: LearningMaterialProposal["suggestedCards"] = Array.from(
      { length: 4 },
      () => ({
        cardType: "qa" as const,
        conceptKeys: ["entropy"],
        concept: "entropy",
        question: "Define entropy.",
        answer: "measure of microstates",
      })
    );
    const capped = enforceLearnThisCaps(makeProposal({ suggestedCards: cards }));
    expect((capped as LearningMaterialProposal).suggestedCards).toHaveLength(MAX_CARDS_PER_CONCEPT);
  });

  it("returns the same reference when under the caps", () => {
    const proposal = makeProposal();
    expect(enforceLearnThisCaps(proposal)).toBe(proposal);
  });

  it("is a no-op for non-candidate payloads", () => {
    expect(enforceLearnThisCaps(null)).toBe(null);
    expect(enforceLearnThisCaps("nope")).toBe("nope");
  });
});

describe("learnThisTask.validate (two-stage, design D5/D16)", () => {
  const input = {
    passage:
      "Entropy is a measure of the number of microstates consistent with a macrostate.",
  };

  it("accepts a grounded proposal on the strict path", () => {
    const outcome = learnThisTask.validate!(makeProposal(), input);
    expect(isValidOutcome(outcome)).toBe(true);
    if (isValidOutcome(outcome)) {
      expect(outcome.value.knowledgeType).toBe("definition");
      expect(outcome.value.suggestedCards).toHaveLength(1);
    }
  });

  it("keeps a well-formed but ungrounded proposal via the shape-only path", () => {
    const proposal = makeProposal({
      suggestedCards: [
        {
          cardType: "definition",
          conceptKeys: ["entropy"],
          question: "Define entropy.",
          answer: "Entropy is purple cheese riding a unicycle through hyperspace.",
        },
      ],
    });
    const outcome = learnThisTask.validate!(proposal, input);
    // The envelope survives (flagging happens per-candidate downstream).
    expect(isValidOutcome(outcome)).toBe(true);
  });

  it("still requires cloze cards to carry a deletion marker", () => {
    const proposal = makeProposal({
      suggestedCards: [
        {
          cardType: "cloze",
          conceptKeys: ["entropy"],
          question: "Entropy measures microstates.",
          answer: "microstates",
        },
      ],
    });
    const outcome = learnThisTask.validate!(proposal, input);
    expect(isFailedOutcome(outcome)).toBe(true);
  });

  it("fails closed on structurally invalid payloads", () => {
    const outcome = learnThisTask.validate!({ importance: 2, knowledgeType: "nope" }, input);
    expect(isFailedOutcome(outcome)).toBe(true);
    if (isFailedOutcome(outcome)) {
      expect(outcome.errors.length).toBeGreaterThan(0);
    }
  });
});
