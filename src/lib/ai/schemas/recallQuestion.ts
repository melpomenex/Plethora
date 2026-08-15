/**
 * `RecallQuestionProposal` — structured envelope of the active-recall
 * question task (design D19 / ai-active-recall spec).
 *
 * Questions are grounded in chunks the user already read; validation requires
 * every `chunkRef` to reference a real chunk id when the known set is given.
 */

import {
  checkString,
  checkStringArray,
  isRecord,
  valid,
  type ValidationOutcome,
} from "./common";

export interface RecallQuestionProposal {
  question: string;
  expectedAnswer: string;
  /** Concept keys used for near-duplicate fingerprinting. */
  conceptKeys: string[];
  /** Ids of the chunks the question is grounded in. */
  chunkRefs: string[];
}

export const RECALL_QUESTION_SCHEMA = {
  name: "RecallQuestionProposal",
  nativeName: "recallQuestionProposal",
  json: JSON.stringify({
    question: "string",
    expectedAnswer: "string",
    conceptKeys: ["string"],
    chunkRefs: ["chunk-id"],
  }),
} as const;

export interface RecallQuestionValidationContext {
  /** Known chunk ids; when provided, every chunkRef must exist in it. */
  knownChunkIds?: string[];
}

export function validateRecallQuestionProposal(
  output: unknown,
  context: RecallQuestionValidationContext = {}
): ValidationOutcome<RecallQuestionProposal> {
  const errors: string[] = [];
  if (!isRecord(output)) {
    return { ok: false, errors: ["root: expected object"] };
  }

  const question = checkString(output.question, "question", errors, { maxLength: 1000 });
  const expectedAnswer = checkString(output.expectedAnswer, "expectedAnswer", errors, {
    maxLength: 2000,
  });
  const conceptKeys = checkStringArray(output.conceptKeys, "conceptKeys", errors, {
    max: 8,
    maxLength: 120,
  });
  const chunkRefs = checkStringArray(output.chunkRefs, "chunkRefs", errors, {
    max: 8,
    maxLength: 200,
  });

  if (chunkRefs !== undefined && chunkRefs.length === 0) {
    errors.push("chunkRefs: at least one chunk reference is required");
  }

  if (
    context.knownChunkIds &&
    chunkRefs !== undefined &&
    chunkRefs.some((ref) => !context.knownChunkIds!.includes(ref))
  ) {
    errors.push("chunkRefs: references a chunk id that does not exist");
  }

  if (
    errors.length > 0 ||
    question === undefined ||
    expectedAnswer === undefined ||
    conceptKeys === undefined ||
    chunkRefs === undefined
  ) {
    return { ok: false, errors: errors.length > 0 ? errors : ["root: missing required fields"] };
  }
  return valid({ question, expectedAnswer, conceptKeys, chunkRefs });
}
