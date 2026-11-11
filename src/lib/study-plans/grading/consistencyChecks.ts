/**
 * Rubric Grading Consistency Checks & Coarse Tripwires.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §6
 * - openspec/changes/implement-rubric-based-exam-grading/ (C5-T01)
 *
 * Tripwires:
 * 1. Classification mismatch:
 *    - Overall assessment is 'correct' while normalized score < 0.75
 *    - Overall assessment is 'incorrect' while normalized score > 0.25
 * 2. Non-reasoning fallback for Essay question
 * 3. Ambiguous answer limitation
 * 4. Any criterion is 'not-assessable'
 *
 * When any tripwire fires, the grade state transitions to 'needs-review'
 * and official points remains null until manual intervention.
 */

import type { QuestionKind } from '../../../types/assessmentQuestions';
import type {
  GradeState,
  RubricGradeProposal,
  RubricLimitation,
} from '../../../types/assessmentSessions';
import type { RubricScoreCalculation } from './rubricAggregation';

export type TripwireReason =
  | 'classification-mismatch'
  | 'non-reasoning-fallback'
  | 'ambiguous-answer'
  | 'not-assessable-criterion'
  | 'insufficient-source'
  | 'model-capability';

export interface ConsistencyCheckResult {
  state: GradeState;
  officialPoints: number | null;
  tripwires: TripwireReason[];
  needsReviewReason: string | null;
}

export function evaluateGradeConsistency(
  proposal: RubricGradeProposal,
  scoreCalc: RubricScoreCalculation,
  questionKind: QuestionKind
): ConsistencyCheckResult {
  const tripwires: TripwireReason[] = [];

  // 1. Check for not-assessable criteria
  if (!scoreCalc.isFullyAssessed) {
    tripwires.push('not-assessable-criterion');
  }

  // 2. Check limitations
  const limitations = new Set<RubricLimitation>(proposal.limitations || []);
  if (limitations.has('ambiguous-answer')) {
    tripwires.push('ambiguous-answer');
  }
  if (limitations.has('insufficient-source')) {
    tripwires.push('insufficient-source');
  }
  if (limitations.has('model-capability')) {
    tripwires.push('model-capability');
  }

  // 3. Essay non-reasoning fallback check
  if (questionKind === 'essay') {
    if (limitations.has('non-reasoning-fallback')) {
      tripwires.push('non-reasoning-fallback');
    }
  }

  // 4. Coarse classification mismatch tripwires
  const classification = proposal.assessment.classification;
  const normalized = scoreCalc.normalized;

  if (classification === 'correct' && normalized < 0.75) {
    tripwires.push('classification-mismatch');
  } else if (classification === 'incorrect' && normalized > 0.25) {
    tripwires.push('classification-mismatch');
  }

  if (tripwires.length > 0) {
    return {
      state: 'needs-review',
      officialPoints: null,
      tripwires,
      needsReviewReason: `Grade requires manual review due to tripwires: ${tripwires.join(', ')}`,
    };
  }

  return {
    state: 'final',
    officialPoints: scoreCalc.points,
    tripwires: [],
    needsReviewReason: null,
  };
}

export { evaluateGradeConsistency as checkGradingConsistency };

