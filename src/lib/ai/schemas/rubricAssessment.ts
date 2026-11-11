/**
 * Rubric-based assessment schema and validator.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §6
 * - openspec/changes/implement-rubric-based-exam-grading/ (C5-T01)
 */

import {
  checkEnum,
  checkNumber,
  checkString,
  checkStringArray,
  isRecord,
  isFailedOutcome,
  valid,
  type ValidationOutcome,
} from './common';
import {
  validateAnswerAssessment,
} from './answerAssessment';
import type {
  ShortAnswerQuestion,
  EssayQuestion,
  RubricLevel,
} from '../../../types/assessmentQuestions';
import type {
  CriterionJudgment,
  RubricLimitation,
  RubricGradeProposal,
} from '../../../types/assessmentSessions';

export const RUBRIC_LIMITATIONS = [
  'ambiguous-answer',
  'insufficient-source',
  'model-capability',
  'non-reasoning-fallback',
] as const;

export const RUBRIC_ASSESSMENT_SCHEMA = {
  name: 'RubricGradeProposal',
  nativeName: 'rubricGradeProposal',
  json: JSON.stringify({
    schemaVersion: 1,
    criteria: [
      {
        criterionId: 'string',
        status: 'assessed|not-assessable',
        level: '0|1|2|3|4',
        answerEvidence: 'string (exact excerpt from student answer)',
        rationale: 'string',
        missingConcepts: ['string'],
        misconception: 'string?',
        sourceRefIds: ['string'],
      },
    ],
    assessment: {
      classification: 'correct|partial|incorrect|misconception',
      score: '0.0-1.0',
      completeness: '0.0-1.0',
      missingConcepts: ['string'],
      misconception: 'string?',
      feedback: 'string',
      suggestedCorrection: 'string?',
      confidence: '0.0-1.0',
    },
    limitations: ['ambiguous-answer|insufficient-source|model-capability|non-reasoning-fallback'],
  }),
} as const;

export function validateRubricProposal(
  output: unknown,
  question: ShortAnswerQuestion | EssayQuestion,
  learnerResponseText: string
): ValidationOutcome<RubricGradeProposal> {
  const errors: string[] = [];

  if (!isRecord(output)) {
    return { ok: false, errors: ['root: expected object'] };
  }

  if (output.schemaVersion !== 1) {
    errors.push('schemaVersion: expected 1');
  }

  // 1. Validate envelope assessment
  const assessmentOutcome = validateAnswerAssessment(output.assessment);
  if (isFailedOutcome(assessmentOutcome)) {
    for (const err of assessmentOutcome.errors) {
      errors.push(`assessment.${err}`);
    }
  }

  // 2. Validate limitations
  const rawLimitations = output.limitations;
  const validatedLimitations: RubricLimitation[] = [];
  if (rawLimitations !== undefined) {
    if (!Array.isArray(rawLimitations)) {
      errors.push('limitations: expected array');
    } else {
      for (let i = 0; i < rawLimitations.length; i++) {
        const item = rawLimitations[i];
        if (typeof item !== 'string' || !(RUBRIC_LIMITATIONS as readonly string[]).includes(item)) {
          errors.push(`limitations[${i}]: expected one of [${RUBRIC_LIMITATIONS.join('|')}]`);
        } else {
          validatedLimitations.push(item as RubricLimitation);
        }
      }
    }
  }

  // 3. Validate criteria
  const expectedCriteria = question.rubric.criteria;
  const expectedMap = new Map(expectedCriteria.map((c) => [c.id, c]));
  const seenIds = new Set<string>();
  const validatedJudgments: CriterionJudgment[] = [];

  if (!Array.isArray(output.criteria)) {
    errors.push('criteria: expected array');
  } else {
    for (let i = 0; i < output.criteria.length; i++) {
      const item = output.criteria[i];
      if (!isRecord(item)) {
        errors.push(`criteria[${i}]: expected object`);
        continue;
      }

      const critId = item.criterionId;
      if (typeof critId !== 'string' || !critId.trim()) {
        errors.push(`criteria[${i}].criterionId: expected non-empty string`);
        continue;
      }

      if (!expectedMap.has(critId)) {
        errors.push(`criteria[${i}].criterionId: unknown criterion id "${critId}"`);
        continue;
      }

      if (seenIds.has(critId)) {
        errors.push(`criteria[${i}].criterionId: duplicate criterion id "${critId}"`);
        continue;
      }
      seenIds.add(critId);

      const targetCrit = expectedMap.get(critId)!;
      const status = checkEnum(item.status, ['assessed', 'not-assessable'] as const, `criteria[${critId}].status`, errors);

      if (status === 'not-assessable') {
        const reason = checkString(item.reason, `criteria[${critId}].reason`, errors, { minLength: 1, maxLength: 2000 });
        if (reason) {
          validatedJudgments.push({
            criterionId: critId,
            status: 'not-assessable',
            reason,
          });
        }
      } else if (status === 'assessed') {
        const levelNum = checkNumber(item.level, `criteria[${critId}].level`, errors, { min: 0, max: 4, integer: true });
        const rationale = checkString(item.rationale, `criteria[${critId}].rationale`, errors, { minLength: 1, maxLength: 4000 });
        const answerEvidence = checkString(item.answerEvidence, `criteria[${critId}].answerEvidence`, errors, { minLength: 1, maxLength: 50000 });

        // Non-substring evidence check: answerEvidence must be an exact substring of learnerResponseText
        if (answerEvidence && !learnerResponseText.includes(answerEvidence)) {
          errors.push(
            `criteria[${critId}].answerEvidence: evidence quote is not an exact substring of learner response`
          );
        }

        const missingConcepts = checkStringArray(
          Array.isArray(item.missingConcepts) ? item.missingConcepts : [],
          `criteria[${critId}].missingConcepts`,
          errors,
          { max: 10, maxLength: 200 }
        ) ?? [];

        let misconception: string | null = null;
        if (item.misconception !== undefined && item.misconception !== null) {
          const checkedMisc = checkString(item.misconception, `criteria[${critId}].misconception`, errors, { maxLength: 2000 });
          if (checkedMisc) {
            misconception = checkedMisc;
          }
        }

        const sourceRefIds = checkStringArray(
          Array.isArray(item.sourceRefIds) ? item.sourceRefIds : [],
          `criteria[${critId}].sourceRefIds`,
          errors,
          { max: 8 }
        ) ?? [];

        // Forged source handle check: if criterion is grounded in source, every sourceRefId must be in targetCrit.sourceRefIds
        const allowedSourceIds = new Set(targetCrit.sourceRefIds || []);
        for (const sId of sourceRefIds) {
          if (!allowedSourceIds.has(sId)) {
            errors.push(
              `criteria[${critId}].sourceRefIds: forged source reference "${sId}" (not in criterion allowed source refs)`
            );
          }
        }

        if (levelNum !== undefined && rationale && answerEvidence) {
          validatedJudgments.push({
            criterionId: critId,
            status: 'assessed',
            level: levelNum as RubricLevel,
            answerEvidence,
            rationale,
            missingConcepts,
            misconception,
            sourceRefIds,
          });
        }
      }
    }

    // Check for omitted criteria
    for (const expected of expectedCriteria) {
      if (!seenIds.has(expected.id)) {
        errors.push(`criteria: omitted expected criterion id "${expected.id}"`);
      }
    }
  }

  if (errors.length > 0 || !assessmentOutcome.ok) {
    return { ok: false, errors };
  }

  return valid({
    schemaVersion: 1,
    criteria: validatedJudgments,
    assessment: assessmentOutcome.value,
    limitations: validatedLimitations,
  });
}
