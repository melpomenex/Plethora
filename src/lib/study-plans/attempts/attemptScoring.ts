/**
 * Aggregate Attempt Scoring and Points Semantics.
 *
 * Implements aggregate point calculation, status derivation, and display rounding.
 * Specifications: 02-SHARED-CONTRACTS.md §7.1.
 */

import type {
  AssessmentQuestionRevision,
} from '../../../types/assessmentQuestions';
import type {
  AttemptScoreSummary,
  AttemptStatus,
  GradeRecord,
  ObjectiveGradeOutput,
} from '../../../types/assessmentSessions';

export interface ScoreCalculationInputGrade {
  questionRevisionId: string;
  state: 'final' | 'needs-review' | 'failed';
  points: number | null;
  maxPoints: number;
}

/**
 * Derives aggregate scores and status across all question revisions in an attempt.
 *
 * Rule: awardedPoints is NULL until EVERY question has a final grade.
 * A separate provisionalObjectivePoints holds the subtotal of resolved final points.
 */
export function calculateAttemptScoreSummary(
  attemptId: string,
  questionRevisions: AssessmentQuestionRevision[],
  grades: Array<ObjectiveGradeOutput | GradeRecord | ScoreCalculationInputGrade>
): AttemptScoreSummary {
  const totalQuestions = questionRevisions.length;
  let maximumPoints = 0;
  let finalQuestions = 0;
  let pendingQuestions = 0;
  let needsReviewQuestions = 0;
  let failedQuestions = 0;
  let provisionalObjectivePoints = 0;
  let totalFinalPoints = 0;

  const gradeMap = new Map<string, ScoreCalculationInputGrade>();
  for (const g of grades) {
    gradeMap.set(g.questionRevisionId, g);
  }

  for (const qRev of questionRevisions) {
    maximumPoints += qRev.question.maxPoints;
    const grade = gradeMap.get(qRev.id);

    if (!grade) {
      pendingQuestions++;
      continue;
    }

    if (grade.state === 'final') {
      finalQuestions++;
      const pts = grade.points ?? 0;
      totalFinalPoints += pts;
      provisionalObjectivePoints += pts;
    } else if (grade.state === 'needs-review') {
      needsReviewQuestions++;
    } else if (grade.state === 'failed') {
      failedQuestions++;
    } else {
      pendingQuestions++;
    }
  }

  const isFullyFinal = totalQuestions > 0 && finalQuestions === totalQuestions;
  const awardedPoints = isFullyFinal ? totalFinalPoints : null;

  let derivedStatus: AttemptStatus = 'in-progress';
  if (isFullyFinal) {
    derivedStatus = 'complete';
  } else if (failedQuestions > 0 && pendingQuestions === 0 && needsReviewQuestions === 0) {
    derivedStatus = 'grading-failed';
  } else if (finalQuestions > 0 || needsReviewQuestions > 0) {
    derivedStatus = 'partially-graded';
  } else if (pendingQuestions < totalQuestions) {
    derivedStatus = 'grading';
  }

  return {
    attemptId,
    maximumPoints,
    awardedPoints,
    provisionalObjectivePoints,
    totalQuestions,
    finalQuestions,
    pendingQuestions,
    needsReviewQuestions,
    failedQuestions,
    isFullyFinal,
    derivedStatus,
  };
}

/**
 * Display-only half-up rounding to 2 decimal places.
 * Calculation retains full IEEE 754 precision; only formatted display strings round.
 */
export function roundDisplayPoints(points: number): number {
  if (!Number.isFinite(points)) return 0;
  return Math.round((points + Number.EPSILON) * 100) / 100;
}

/**
 * Formats points for UI display.
 */
export function formatDisplayPoints(
  points: number | null | undefined,
  fallback = '—'
): string {
  if (points === null || points === undefined || !Number.isFinite(points)) {
    return fallback;
  }
  const rounded = roundDisplayPoints(points);
  // Show clean representation: if whole number, show without trailing .00 or with up to 2 decimals
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(2);
}
