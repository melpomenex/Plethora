/**
 * `AnswerAssessment` — structured envelope of the free-response assessment
 * task (design D20 / ai-answer-assessment spec).
 */

import {
  checkNumber,
  checkString,
  checkStringArray,
  isRecord,
  valid,
  type ValidationOutcome,
} from "./common";

export const ANSWER_CLASSIFICATIONS = ["correct", "partial", "incorrect", "misconception"] as const;
export type AnswerClassification = (typeof ANSWER_CLASSIFICATIONS)[number];

export interface AnswerAssessment {
  classification: AnswerClassification;
  /** Correctness score, 0–1. */
  score: number;
  /** Completeness of the answer, 0–1. */
  completeness: number;
  missingConcepts: string[];
  /** Required when classification is `misconception`. */
  misconception?: string;
  feedback: string;
  suggestedCorrection?: string;
  /** Model self-reported confidence, 0–1. */
  confidence: number;
}

export const ANSWER_ASSESSMENT_SCHEMA = {
  name: "AnswerAssessment",
  nativeName: "answerAssessment",
  json: JSON.stringify({
    classification: ANSWER_CLASSIFICATIONS.join("|"),
    score: "0.0-1.0",
    completeness: "0.0-1.0",
    missingConcepts: ["string"],
    misconception: "string (misconception only)",
    feedback: "string",
    suggestedCorrection: "string?",
    confidence: "0.0-1.0",
  }),
} as const;

export function validateAnswerAssessment(output: unknown): ValidationOutcome<AnswerAssessment> {
  const errors: string[] = [];
  if (!isRecord(output)) {
    return { ok: false, errors: ["root: expected object"] };
  }

  const classification = checkStringEnum(
    output.classification,
    ANSWER_CLASSIFICATIONS,
    "classification",
    errors
  );
  const score = checkNumber(output.score, "score", errors, { min: 0, max: 1 });
  const completeness = checkNumber(output.completeness, "completeness", errors, { min: 0, max: 1 });
  const confidence = checkNumber(output.confidence, "confidence", errors, { min: 0, max: 1 });
  // Near-miss normalization: models omit `missingConcepts` when nothing is
  // missing — default to [] instead of failing the envelope.
  const missingConcepts = checkStringArray(
    Array.isArray(output.missingConcepts) ? output.missingConcepts : [],
    "missingConcepts",
    errors,
    {
      max: 10,
      maxLength: 120,
    }
  );
  const feedback = checkString(output.feedback, "feedback", errors, { maxLength: 2000 });
  const misconception =
    output.misconception === undefined
      ? undefined
      : checkString(output.misconception, "misconception", errors, { maxLength: 1000 });
  const suggestedCorrection =
    output.suggestedCorrection === undefined
      ? undefined
      : checkString(output.suggestedCorrection, "suggestedCorrection", errors, {
          maxLength: 2000,
        });

  if (classification === "misconception" && (misconception === undefined || !misconception)) {
    errors.push("misconception: required when classification is misconception");
  }

  if (
    errors.length > 0 ||
    classification === undefined ||
    score === undefined ||
    completeness === undefined ||
    confidence === undefined ||
    missingConcepts === undefined ||
    feedback === undefined
  ) {
    return { ok: false, errors: errors.length > 0 ? errors : ["root: missing required fields"] };
  }

  return valid({
    classification,
    score,
    completeness,
    missingConcepts,
    misconception,
    feedback,
    suggestedCorrection,
    confidence,
  });
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
