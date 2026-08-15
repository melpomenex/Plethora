/**
 * `PassageClassification` — structured envelope of the extract-worthiness
 * task (design D23 / ai-knowledge-relationships spec).
 */

import {
  checkNumber,
  checkString,
  isRecord,
  valid,
  type ValidationOutcome,
} from "./common";

export const PASSAGE_TYPES = [
  "fundamental-claim",
  "definition",
  "important-example",
  "key-argument",
  "formula",
  "process",
  "comparison",
  "supporting-detail",
  "transition",
  "bibliography",
  "low-value",
] as const;
export type PassageType = (typeof PASSAGE_TYPES)[number];

export const SUGGESTED_LEARNING_ACTIONS = [
  "none",
  "extract",
  "flashcard",
  "highlight",
] as const;
export type SuggestedLearningAction = (typeof SUGGESTED_LEARNING_ACTIONS)[number];

export interface PassageClassification {
  type: PassageType;
  /** Extract-worthiness, 0–1; indicators surface only above 0.75. */
  extractWorthiness: number;
  reason: string;
  suggestedLearningAction: SuggestedLearningAction;
}

export const PASSAGE_CLASSIFICATION_SCHEMA = {
  name: "PassageClassification",
  nativeName: "passageClassification",
  json: JSON.stringify({
    type: PASSAGE_TYPES.join("|"),
    extractWorthiness: "0.0-1.0",
    reason: "string",
    suggestedLearningAction: SUGGESTED_LEARNING_ACTIONS.join("|"),
  }),
} as const;

export function validatePassageClassification(
  output: unknown
): ValidationOutcome<PassageClassification> {
  const errors: string[] = [];
  if (!isRecord(output)) {
    return { ok: false, errors: ["root: expected object"] };
  }

  const type = checkStringEnum(output.type, PASSAGE_TYPES, "type", errors);
  const extractWorthiness = checkNumber(output.extractWorthiness, "extractWorthiness", errors, {
    min: 0,
    max: 1,
  });
  const reason = checkString(output.reason, "reason", errors, { maxLength: 1000 });
  const suggestedLearningAction = checkStringEnum(
    output.suggestedLearningAction,
    SUGGESTED_LEARNING_ACTIONS,
    "suggestedLearningAction",
    errors
  );

  if (
    errors.length > 0 ||
    type === undefined ||
    extractWorthiness === undefined ||
    reason === undefined ||
    suggestedLearningAction === undefined
  ) {
    return { ok: false, errors: errors.length > 0 ? errors : ["root: missing required fields"] };
  }
  return valid({ type, extractWorthiness, reason, suggestedLearningAction });
}

function checkStringEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: string[]
): T | undefined {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    errors.push(`${path}: expected one of [${allowed.join("|")}]`);
    return undefined;
  }
  return value as T;
}
