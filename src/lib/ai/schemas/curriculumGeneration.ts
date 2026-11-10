/**
 * AI Schema Descriptors and Validation Adapters for Curriculum Generation tasks.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §3.3
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T01, C2-T06)
 */

import type { ValidationOutcome } from './common';
import type {
  CurriculumDecomposeBatchOutput,
  CurriculumPrerequisiteOutput,
} from '../../study-plans/generation/types';
import {
  CURRICULUM_DECOMPOSE_SCHEMA,
  CURRICULUM_PREREQUISITE_SCHEMA,
} from '../../study-plans/generation/curriculumSchemas';
import {
  validateCurriculumDecomposeBatch,
  validateCurriculumPrerequisiteOutput,
} from '../../study-plans/generation/curriculumValidation';

export { CURRICULUM_DECOMPOSE_SCHEMA, CURRICULUM_PREREQUISITE_SCHEMA };

/**
 * Validates model decomposition output for runTask, converting FieldIssues into ValidationOutcome.
 */
export function validateDecomposeOutputForTask(
  output: unknown,
  allowedSourceHandles: string[]
): ValidationOutcome<CurriculumDecomposeBatchOutput> {
  const result = validateCurriculumDecomposeBatch(output, allowedSourceHandles);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    errors: (result.issues || []).map(
      (issue) => `${issue.path}: ${issue.code} (${issue.messageKey})`
    ),
  };
}

/**
 * Validates model prerequisite edge output for runTask, converting FieldIssues into ValidationOutcome.
 */
export function validatePrerequisiteOutputForTask(
  output: unknown,
  knownTopicHandles: string[],
  allowedSourceHandles?: string[]
): ValidationOutcome<CurriculumPrerequisiteOutput> {
  const result = validateCurriculumPrerequisiteOutput(
    output,
    knownTopicHandles,
    allowedSourceHandles
  );
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    errors: (result.issues || []).map(
      (issue) => `${issue.path}: ${issue.code} (${issue.messageKey})`
    ),
  };
}
