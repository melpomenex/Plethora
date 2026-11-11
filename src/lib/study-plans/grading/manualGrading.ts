/**
 * Manual Rubric Grading and Override Engine.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §6
 * - openspec/changes/implement-rubric-based-exam-grading/ (C5-T01, C5-T06)
 *
 * Requirements:
 * 1. Requires nonempty manualReason string.
 * 2. Requires explicit level (0..4) for every criterion in the committed rubric.
 * 3. Recalculates full-precision official points deterministically.
 * 4. Yields an authorized GradeRecord with origin='manual', state='final'.
 */

import type {
  AnalyticRubric,
  RubricLevel,
} from '../../../types/assessmentQuestions';
import type {
  CriterionResult,
  GradeRecord,
} from '../../../types/assessmentSessions';
import { calculateRubricScore } from './rubricAggregation';

export interface ManualCriterionInput {
  criterionId: string;
  level: RubricLevel;
  rationale?: string | null;
}

export interface ManualGradeInput {
  attemptId: string;
  responseSubmissionId: string;
  expectedAttemptRevision: number;
  questionRevisionId: string;
  criteria: ManualCriterionInput[];
  manualReason: string;
  supersedesGradeId?: string | null;
}

export interface ManualGradeValidationResult {
  valid: boolean;
  errors: string[];
  gradeRecord?: Omit<GradeRecord, 'id' | 'createdAt'>;
}

export function createManualGradeRecord(
  input: ManualGradeInput,
  rubric: AnalyticRubric,
  maxPoints: number
): ManualGradeValidationResult {
  const errors: string[] = [];

  // 1. Validate manualReason
  if (!input.manualReason || typeof input.manualReason !== 'string' || !input.manualReason.trim()) {
    errors.push('manualReason: nonempty reason is required for manual grading');
  }

  // 2. Validate criteria coverage
  if (!Array.isArray(input.criteria)) {
    errors.push('criteria: expected array of criterion inputs');
    return { valid: false, errors };
  }

  const expectedCriteria = rubric.criteria;
  const expectedMap = new Map(expectedCriteria.map((c) => [c.id, c]));
  const seenIds = new Set<string>();
  const criterionResults: CriterionResult[] = [];

  for (let i = 0; i < input.criteria.length; i++) {
    const item = input.criteria[i];
    if (!item || typeof item !== 'object') {
      errors.push(`criteria[${i}]: expected object`);
      continue;
    }

    const critId = item.criterionId;
    if (!critId || typeof critId !== 'string' || !expectedMap.has(critId)) {
      errors.push(`criteria[${i}].criterionId: unknown criterion id "${critId}"`);
      continue;
    }

    if (seenIds.has(critId)) {
      errors.push(`criteria[${i}].criterionId: duplicate criterion id "${critId}"`);
      continue;
    }
    seenIds.add(critId);

    const level = item.level;
    if (
      typeof level !== 'number' ||
      !Number.isInteger(level) ||
      level < 0 ||
      level > 4
    ) {
      errors.push(`criteria[${critId}].level: must be an integer between 0 and 4`);
      continue;
    }

    criterionResults.push({
      criterionId: critId,
      status: 'manual',
      level: level as RubricLevel,
      rationale: item.rationale?.trim() || null,
    });
  }

  // Check for omitted criteria
  for (const expected of expectedCriteria) {
    if (!seenIds.has(expected.id)) {
      errors.push(`criteria: omitted expected criterion id "${expected.id}"`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // 3. Deterministic point recalculation
  const scoreCalc = calculateRubricScore(rubric, criterionResults, maxPoints);
  if (!scoreCalc.isFullyAssessed || scoreCalc.points === null) {
    errors.push('Failed to compute complete points from manual criteria');
    return { valid: false, errors };
  }

  const gradeRecord: Omit<GradeRecord, 'id' | 'createdAt'> = {
    responseSubmissionId: input.responseSubmissionId,
    questionRevisionId: input.questionRevisionId,
    origin: 'manual',
    state: 'final',
    points: scoreCalc.points,
    maxPoints,
    assessment: null,
    criteria: criterionResults,
    provenance: null,
    manualReason: input.manualReason.trim(),
    supersedesGradeId: input.supersedesGradeId ?? null,
    isCurrent: true,
  };

  return {
    valid: true,
    errors: [],
    gradeRecord,
  };
}
