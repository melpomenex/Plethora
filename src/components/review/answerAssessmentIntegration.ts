/**
 * Integration helpers for free-response assessment in the review session
 * (task 5.8, design D20 / flashcard-review-session spec).
 *
 * Scheduler authority is preserved BY CONSTRUCTION:
 *  - `computeSuggestedRating` only derives an advisory highlight; nothing
 *    ever submits it (the spec's "Auto-grade suggestion is advisory");
 *  - `recordCardAssessment` is a SEPARATE `record_answer_assessment` invoke
 *    fired after grading — it receives no scheduling inputs and touches no
 *    scheduling table. The `submitReview` call sequence is identical with
 *    or without an assessment present.
 */

import { recordAnswerAssessment } from "../../api/answer-assessment";
import type { AnswerAssessment } from "../../lib/ai/schemas/answerAssessment";
import type { ReviewRating } from "../../api/review";

/** Confidence at or above which a suggestion may be surfaced (advisory only). */
export const AUTO_GRADE_CONFIDENCE_THRESHOLD = 0.8;

/** Advisory mapping: what the assessment would suggest the user tap. */
export function computeSuggestedRating(assessment: AnswerAssessment): ReviewRating {
  switch (assessment.classification) {
    case "correct":
      return 3;
    case "partial":
      return 2;
    case "incorrect":
    case "misconception":
    default:
      return 1;
  }
}

/** True when the experimental auto-grade flag may highlight a suggestion. */
export function shouldSuggestGrade(
  assessment: AnswerAssessment | null,
  autoGradeEnabled: boolean
): assessment is AnswerAssessment {
  if (!autoGradeEnabled || !assessment) return false;
  return (
    assessment.confidence >= AUTO_GRADE_CONFIDENCE_THRESHOLD &&
    // A suggestion that matches nothing actionable is noise; every
    // classification maps to a real button, so this always holds today —
    // kept explicit so future classifications must decide.
    [1, 2, 3, 4].includes(computeSuggestedRating(assessment))
  );
}

export interface CardAssessmentPayload {
  cardId: string;
  question: string;
  expectedAnswer: string;
  userAnswer: string;
  assessment: AnswerAssessment;
  provider: string;
  model?: string | null;
}

/**
 * Persist the assessment AFTER the user's own grade was submitted.
 * Fire-and-forget and non-fatal: storage problems never surface in the
 * review flow (spec: "no errors surfaced").
 *
 * NOTE: `submit_review` returns the updated item, not a review-result id,
 * so the record correlates by item + created_at until a result id is
 * available client-side (see src/api/answer-assessment.ts).
 */
export async function recordCardAssessment(payload: CardAssessmentPayload): Promise<boolean> {
  try {
    await recordAnswerAssessment({
      itemId: payload.cardId,
      reviewResultId: null,
      assessment: payload.assessment,
      provider: payload.provider,
      model: payload.model ?? null,
    });
    return true;
  } catch (err) {
    console.warn("[answer-assessment] recording failed (non-fatal)", err);
    return false;
  }
}
