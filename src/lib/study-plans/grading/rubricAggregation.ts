/**
 * Rubric Score Aggregation and Normalization Engine.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §6
 * - openspec/changes/implement-rubric-based-exam-grading/ (C5-T01)
 *
 * Rules:
 * 1. Normalized formula: Σ(weight_i * level_i / 4) / Σ(weight_i).
 * 2. Points formula: maxPoints * normalized (full floating-point precision).
 * 3. Never use model score, completeness, or confidence for points.
 * 4. If any criterion is 'not-assessable', official points is strictly null;
 *    a separate provisional preview is computed from assessable criteria.
 */

import type {
  AnalyticRubric,
  RubricLevel,
} from '../../../types/assessmentQuestions';
import type {
  CriterionJudgment,
  CriterionResult,
} from '../../../types/assessmentSessions';

export interface CriterionScoreBreakdown {
  criterionId: string;
  weight: number;
  level: RubricLevel | null;
  contributionPoints: number;
  status: 'assessed' | 'not-assessable' | 'manual';
}

export interface RubricScoreCalculation {
  normalized: number; // 0..1 (based on assessable weight)
  points: number | null; // official points; null if not-assessable or incomplete
  provisionalPoints: number; // preview points
  isFullyAssessed: boolean;
  totalWeight: number;
  assessedWeight: number;
  criterionScores: CriterionScoreBreakdown[];
}

/**
 * Pure calculation of rubric points from criteria results against a committed rubric.
 */
export function calculateRubricScore(
  rubric: AnalyticRubric,
  criteriaResults: (CriterionJudgment | CriterionResult)[],
  maxPoints: number
): RubricScoreCalculation {
  if (maxPoints <= 0) {
    throw new Error('maxPoints must be a positive number');
  }

  const resultMap = new Map<string, CriterionJudgment | CriterionResult>();
  for (const r of criteriaResults) {
    resultMap.set(r.criterionId, r);
  }

  let totalWeight = 0;
  let assessedWeight = 0;
  let weightedLevelSum = 0;
  let allAssessed = true;

  const breakdowns: CriterionScoreBreakdown[] = [];

  for (const crit of rubric.criteria) {
    const weight = crit.weight;
    if (weight <= 0 || !Number.isInteger(weight)) {
      throw new Error(`Criterion "${crit.id}" weight must be a positive integer, got ${weight}`);
    }
    totalWeight += weight;

    const result = resultMap.get(crit.id);
    if (!result) {
      allAssessed = false;
      breakdowns.push({
        criterionId: crit.id,
        weight,
        level: null,
        contributionPoints: 0,
        status: 'not-assessable',
      });
      continue;
    }

    if (result.status === 'not-assessable') {
      allAssessed = false;
      breakdowns.push({
        criterionId: crit.id,
        weight,
        level: null,
        contributionPoints: 0,
        status: 'not-assessable',
      });
    } else {
      // status is 'assessed' or 'manual'
      const level = result.level;
      if (typeof level !== 'number' || level < 0 || level > 4 || !Number.isInteger(level)) {
        throw new Error(`Criterion "${crit.id}" invalid level: ${level}`);
      }

      assessedWeight += weight;
      const ratio = level / 4;
      weightedLevelSum += weight * ratio;

      breakdowns.push({
        criterionId: crit.id,
        weight,
        level: level as RubricLevel,
        // Individual criterion points contribution relative to total rubric weight
        contributionPoints: (weight * ratio * maxPoints) / (rubric.criteria.reduce((s, c) => s + c.weight, 0) || 1),
        status: result.status,
      });
    }
  }

  if (totalWeight <= 0) {
    throw new Error('Total rubric weight must be greater than zero');
  }

  // Assessable normalized score (0..1)
  const normalized = assessedWeight > 0 ? weightedLevelSum / assessedWeight : 0;
  const provisionalPoints = maxPoints * (weightedLevelSum / totalWeight);

  return {
    normalized: allAssessed ? normalized : assessedWeight > 0 ? weightedLevelSum / totalWeight : 0,
    points: allAssessed ? maxPoints * (weightedLevelSum / totalWeight) : null,
    provisionalPoints,
    isFullyAssessed: allAssessed,
    totalWeight,
    assessedWeight,
    criterionScores: breakdowns,
  };
}

export { calculateRubricScore as aggregateRubric };

