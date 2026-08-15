/**
 * Answer assessment API (task 5.7 TS wrapper, design D20).
 *
 * Wraps `record_answer_assessment`, `get_answer_assessments_for_item`, and
 * `get_answer_assessment_counts`. Assessments are stored as SEPARATE
 * metadata — recording one never touches the review scheduling path.
 *
 * Correlation note: `submit_review` returns the updated learning item, not
 * a review-result id, so the review flow stores `itemId` + `createdAt` and
 * the assessment correlates to its review result by timestamp; when a
 * review-result id becomes available client-side it can be passed through
 * `reviewResultId` unchanged.
 */

import { invokeCommand } from "../lib/tauri";
import type { AnswerAssessment, AnswerClassification } from "../lib/ai/schemas/answerAssessment";

export interface AnswerAssessmentRecord {
  id: string;
  reviewResultId: number | null;
  itemId: string | null;
  classification: AnswerClassification | string;
  score: number | null;
  completeness: number | null;
  confidence: number | null;
  missingConcepts: string[];
  misconception: string | null;
  feedback: string | null;
  suggestedCorrection: string | null;
  provider: string | null;
  model: string | null;
  createdAt: string;
}

export interface AssessmentClassCounts {
  classification: AnswerClassification | string;
  count: number;
}

/**
 * Persist a validated assessment with provider/model provenance.
 * Non-scheduling by construction: a separate table, keyed to the item and
 * (when known) the review result.
 */
export function recordAnswerAssessment(input: {
  itemId?: string | null;
  reviewResultId?: number | null;
  assessment: AnswerAssessment;
  provider: string;
  model?: string | null;
}): Promise<AnswerAssessmentRecord> {
  const { assessment } = input;
  return invokeCommand<AnswerAssessmentRecord>("record_answer_assessment", {
    itemId: input.itemId ?? null,
    item_id: input.itemId ?? null,
    reviewResultId: input.reviewResultId ?? null,
    review_result_id: input.reviewResultId ?? null,
    assessment: {
      classification: assessment.classification,
      score: assessment.score,
      completeness: assessment.completeness,
      confidence: assessment.confidence,
      missingConcepts: assessment.missingConcepts,
      misconception: assessment.misconception ?? null,
      feedback: assessment.feedback,
      suggestedCorrection: assessment.suggestedCorrection ?? null,
    },
    provider: input.provider,
    model: input.model ?? null,
  });
}

/** Assessments for one learning item, newest first (calibration analysis). */
export function getAnswerAssessmentsForItem(
  itemId: string,
  limit = 20
): Promise<AnswerAssessmentRecord[]> {
  return invokeCommand<AnswerAssessmentRecord[]>("get_answer_assessments_for_item", {
    itemId,
    item_id: itemId,
    limit,
  });
}

/** Count of assessments per classification, for one item or the whole table. */
export function getAnswerAssessmentCounts(
  itemId?: string | null
): Promise<AssessmentClassCounts[]> {
  return invokeCommand<AssessmentClassCounts[]>("get_answer_assessment_counts", {
    itemId: itemId ?? null,
    item_id: itemId ?? null,
  });
}
