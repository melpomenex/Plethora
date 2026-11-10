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
  // Near-miss normalization: models omit conceptKeys — default to [].
  const conceptKeys = checkStringArray(
    Array.isArray(output.conceptKeys) ? output.conceptKeys : [],
    "conceptKeys",
    errors,
    { max: 8, maxLength: 120 }
  );
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

export interface ValidatedGeneratedCard {
  type: string;
  question: string;
  answer?: string;
  clozeText?: string;
  steps?: string[];
  [key: string]: unknown;
}

/**
 * Validates a generated flashcard candidate:
 * 1. Checks that question is provided and non-empty.
 * 2. Enforces valid cloze delimiters `{{c<digit+>::...}}` for cloze cards (rejecting unclosed or malformed tags).
 * 3. Degrades 1-step ordered steps cards to `qa` cards.
 */
export function validateGeneratedCard(
  input: unknown
): ValidationOutcome<ValidatedGeneratedCard> {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["card: expected object"] };
  }

  const raw = { ...input };
  const rawType = String(raw.type || raw.item_type || raw.card_type || "qa").toLowerCase();

  const question = checkString(raw.question, "question", errors, { maxLength: 2000 });
  if (errors.length > 0 || question === undefined) {
    return { ok: false, errors };
  }

  let finalType = rawType;
  let answer = typeof raw.answer === "string" ? raw.answer : undefined;
  let steps = Array.isArray(raw.steps) ? (raw.steps as string[]) : undefined;

  // Ordered steps handling: degrade 1-step ordered steps to qa
  const isOrderedSteps =
    rawType === "ordered-steps" ||
    rawType === "ordered_steps" ||
    rawType === "process" ||
    rawType === "steps" ||
    (steps !== undefined && steps.length > 0);

  if (isOrderedSteps) {
    if (steps && steps.length === 1) {
      finalType = "qa";
      if (!answer || answer.trim() === "") {
        answer = steps[0];
      }
    } else if (steps && steps.length > 1) {
      finalType = "process";
    }
  }

  // Cloze delimiter validation
  const textToCheck = typeof raw.clozeText === "string" ? raw.clozeText : question;
  const isCloze =
    finalType === "cloze" ||
    /\{\{c\d+::/i.test(textToCheck) ||
    /\[\[c\d+::/i.test(textToCheck);

  if (isCloze) {
    finalType = "cloze";
    const clozePattern = /\{\{c(\d+)::(.+?)(?:::.*?)?\}\}|\[\[c(\d+)::(.+?)(?:::.*?)?\]\]/g;
    const matches = [...textToCheck.matchAll(clozePattern)];

    // Check for malformed or unclosed markers
    const hasUnclosed = /\{\{c\d+::(?!.*\}\})/i.test(textToCheck);
    const hasMalformed = /\{\{c[^0-9\s]/i.test(textToCheck);

    if (matches.length === 0 || hasUnclosed || hasMalformed) {
      errors.push("cloze: invalid cloze syntax: missing or malformed {{c1::...}} delimiter");
    } else {
      for (const m of matches) {
        const indexStr = m[1] ?? m[3];
        const content = m[2] ?? m[4];
        const index = parseInt(indexStr, 10);
        if (isNaN(index) || index < 1 || !content || content.trim() === "") {
          errors.push(`cloze: invalid delimiter index or empty content in "${m[0]}"`);
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const result: ValidatedGeneratedCard = {
    ...raw,
    type: finalType,
    question,
    ...(answer !== undefined ? { answer } : {}),
    ...(steps !== undefined ? { steps } : {}),
  };

  return valid(result);
}
