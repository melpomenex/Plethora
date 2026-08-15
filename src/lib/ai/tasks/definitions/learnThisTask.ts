/**
 * `LearnThisTask` — Phase 1 "Learn this" structured proposal (design D16 /
 * ai-learning-material-generation spec, tasks 2.1–2.2).
 *
 * Full model class, structured output validated against the canonical
 * `LearningMaterialProposal` schema. The static system instruction carries the
 * untrusted-content containment clause (D9) and the knowledge-type → card-type
 * mapping policy; the selection passage and any document title/section context
 * enter the user turn ONLY inside untrusted blocks.
 *
 * Caps (≤ 8 cards per invocation, ≤ 2 per concept) are enforced as *capping*
 * here — the proposal keeps its order (the model's importance ordering), and
 * candidates beyond a cap are dropped before validation — so an over-eager
 * model degrades to "top candidates within the cap" instead of failing the
 * whole request. Structural garbage still fails closed (strict-JSON repair →
 * `InvalidStructuredOutput`). Source grounding (verbatim cloze, answer
 * grounding) is deliberately deferred to the validation pipeline
 * (`learnThisValidation.ts`) where ungrounded candidates are *flagged* per
 * candidate, not allowed to kill the envelope.
 */

import {
  LEARNING_MATERIAL_SCHEMA,
  MAX_CARDS_PER_CONCEPT,
  MAX_LEARNING_CARDS,
  validateLearningMaterialProposal,
  type LearningMaterialProposal,
} from "../../schemas/learningMaterial";
import { isRecord, isFailedOutcome, isValidOutcome } from "../../schemas/common";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../containment";
import { registerTasks } from "../registry";
import type { AITaskDefinition } from "../types";

export const LEARN_THIS_TASK_ID = "learn-this";

/**
 * Card-generation timeout. Design D28 targeted ≤ 20 s, but on-device
 * structured generation of full proposals (cards + rationale) regularly
 * exceeds that on Nano hardware; tuned to 60 s after device testing. When a
 * cloud provider is configured and cloud fallback is allowed, the automatic
 * retry covers the gap.
 */
export const LEARN_THIS_TIMEOUT_MS = 60_000;
export const LEARN_THIS_MAX_OUTPUT_TOKENS = 1500;

export interface LearnThisInput {
  /** The selected passage (untrusted document content). */
  passage: string;
  /** Optional document title for context (untrusted document content). */
  documentTitle?: string;
  /** Optional section heading for context (untrusted document content). */
  sectionHeading?: string;
}

const LEARN_THIS_CORE_INSTRUCTION = [
  "You are a learning-material designer. Analyze the passage in the <untrusted_source id=\"passage\"> block and return a JSON learning-material proposal.",
  "Classify the passage's knowledgeType as exactly one of: definition, enumeration, process, comparison, formula, causeEffect, dateEvent, example.",
  "Then propose 2-5 spaced-repetition card candidates whose cardType matches the knowledge type:",
  "definition -> definition or qa; enumeration -> cloze; process -> process (ordered steps); comparison -> comparison (A-vs-B); formula -> formula (conceptual); causeEffect -> causeEffect (why-how); dateEvent -> qa; example -> example (apply).",
  "Cloze cards MUST quote the source sentence verbatim in clozeText with the deletion wrapped as {{c1::answer}}; the deletion text must appear word-for-word in the passage.",
  "Every answer MUST be stated in the passage — never add outside knowledge. Each concept may be tested by at most 2 cards. Do not invent questions about content the passage does not contain.",
  "Set importance (0.0-1.0) by how central the passage is to understanding the document, list the key concepts, any prerequisite concepts a learner needs first, up to 6 short tags, and a 1-2 sentence rationale.",
  "Return ONLY the JSON object.",
].join("\n");

export const learnThisTask: AITaskDefinition<LearnThisInput, LearningMaterialProposal> = {
  id: LEARN_THIS_TASK_ID,
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\n${LEARN_THIS_CORE_INSTRUCTION}`,
  buildInput: ({ passage, documentTitle, sectionHeading }) => ({
    text: [
      "Analyze this passage and propose learning material as JSON.",
      "",
      ...(documentTitle
        ? ["Document title:", wrapUntrustedBlock("document-title", documentTitle), ""]
        : []),
      ...(sectionHeading
        ? ["Section heading:", wrapUntrustedBlock("section-heading", sectionHeading), ""]
        : []),
      "Passage:",
      wrapUntrustedBlock("passage", passage),
    ].join("\n"),
  }),
  outputKind: "structured",
  schema: LEARNING_MATERIAL_SCHEMA,
  validate: validateLearnThisOutput,
  maxOutputTokens: LEARN_THIS_MAX_OUTPUT_TOKENS,
  timeoutMs: LEARN_THIS_TIMEOUT_MS,
  streaming: false,
  requirement: "prompt",
};

/**
 * Enforce the spec caps as caps, not failures: keep the first
 * `MAX_LEARNING_CARDS` cards (the proposal's importance ordering) and at most
 * `MAX_CARDS_PER_CONCEPT` cards per concept, preserving order. Returns the
 * original object reference when nothing changes.
 */
export function enforceLearnThisCaps(
  output: unknown
): unknown {
  if (!isRecord(output) || !Array.isArray(output.suggestedCards)) {
    return output;
  }
  const cards = output.suggestedCards as unknown[];
  const kept: unknown[] = [];
  const perConcept = new Map<string, number>();
  for (const card of cards) {
    if (kept.length >= MAX_LEARNING_CARDS) break;
    const concept =
      isRecord(card) && typeof card.concept === "string"
        ? card.concept.trim().toLowerCase()
        : "";
    if (concept) {
      const count = perConcept.get(concept) ?? 0;
      if (count >= MAX_CARDS_PER_CONCEPT) continue;
      perConcept.set(concept, count + 1);
    }
    kept.push(card);
  }
  if (kept.length === cards.length) return output;
  return { ...output, suggestedCards: kept };
}

/**
 * Two-stage validation: strict (shape + verbatim cloze + answer grounding
 * against the source passage) first; when only source-grounding failed, fall
 * back to shape-only validation so those candidates reach the preview flagged
 * as `ungrounded` (they cannot be accepted without editing — enforced by the
 * preview UI, not by discarding the proposal). Structural failures fall
 * through to the strict-JSON repair path in `runTask`.
 */
function validateLearnThisOutput(
  output: unknown,
  input: LearnThisInput
): ReturnType<typeof validateLearningMaterialProposal> {
  const capped = enforceLearnThisCaps(output);
  const strict = validateLearningMaterialProposal(capped, { sourceText: input.passage });
  if (isValidOutcome(strict)) return strict;

  const shapeOnly = validateLearningMaterialProposal(capped, {});
  if (isValidOutcome(shapeOnly)) return shapeOnly;

  return isFailedOutcome(strict) ? strict : { ok: false, errors: ["learn-this: invalid output"] };
}

registerTasks(learnThisTask);
