/**
 * Assessment Response Validation.
 *
 * Implements response shape, bounds, option references, and confidence checks.
 * Specifications: 02-SHARED-CONTRACTS.md §5.1, §7.
 */

import type {
  AssessmentQuestion,
  AssessmentResponse,
  LearnerConfidence,
  ResponseMark,
} from '../../../types/assessmentQuestions';

export const VALID_CONFIDENCE_STOPS: readonly LearnerConfidence[] = [
  0, 0.3, 0.5, 0.7, 0.9, 1,
] as const;

export const MAX_SHORT_ANSWER_CHARS = 20_000;
export const MAX_ESSAY_CHARS = 60_000;
export const MAX_CLOZE_BLANK_CHARS = 2_000;

export interface ResponseValidationIssue {
  field: string;
  message: string;
}

export interface ResponseValidationResult {
  valid: boolean;
  issues: ResponseValidationIssue[];
}

export function isValidConfidence(
  confidence: unknown
): confidence is LearnerConfidence {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    return false;
  }
  return VALID_CONFIDENCE_STOPS.includes(confidence as LearnerConfidence);
}

export function validateAssessmentResponse(
  response: unknown,
  question: AssessmentQuestion,
  mark?: ResponseMark
): ResponseValidationResult {
  const issues: ResponseValidationIssue[] = [];

  if (!response || typeof response !== 'object') {
    return {
      valid: false,
      issues: [{ field: 'response', message: 'Response must be an object' }],
    };
  }

  const res = response as Record<string, unknown>;

  // Check kind discriminant matches question kind
  if (res.kind !== question.kind) {
    issues.push({
      field: 'kind',
      message: `Response kind '${res.kind}' does not match question kind '${question.kind}'`,
    });
    return { valid: false, issues };
  }

  // Validate optional learner confidence
  if ('confidence' in res && res.confidence !== undefined && res.confidence !== null) {
    if (!isValidConfidence(res.confidence)) {
      issues.push({
        field: 'confidence',
        message: `Confidence must be one of [0, 0.3, 0.5, 0.7, 0.9, 1], received ${res.confidence}`,
      });
    }
  }

  // Check unknown top-level keys
  const allowedKeys = new Set(['kind', 'confidence']);

  switch (question.kind) {
    case 'single-select': {
      allowedKeys.add('optionId');
      for (const key of Object.keys(res)) {
        if (!allowedKeys.has(key)) {
          issues.push({ field: key, message: `Unknown property '${key}' in single-select response` });
        }
      }

      const optionId = res.optionId;
      if (optionId !== null && typeof optionId !== 'string') {
        issues.push({ field: 'optionId', message: 'optionId must be a string or null' });
      } else if (typeof optionId === 'string') {
        const validIds = new Set(question.options.map((o) => o.id));
        if (!validIds.has(optionId)) {
          issues.push({ field: 'optionId', message: `Option '${optionId}' is not in the question options` });
        }
      }

      if (mark === 'answered' && (!optionId || typeof optionId !== 'string')) {
        issues.push({ field: 'optionId', message: "Response marked as 'answered' must select an option" });
      }
      break;
    }

    case 'multi-select': {
      allowedKeys.add('optionIds');
      for (const key of Object.keys(res)) {
        if (!allowedKeys.has(key)) {
          issues.push({ field: key, message: `Unknown property '${key}' in multi-select response` });
        }
      }

      if (!Array.isArray(res.optionIds)) {
        issues.push({ field: 'optionIds', message: 'optionIds must be an array' });
      } else {
        const ids = res.optionIds as unknown[];
        const seen = new Set<string>();
        const validIds = new Set(question.options.map((o) => o.id));

        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          if (typeof id !== 'string') {
            issues.push({ field: `optionIds[${i}]`, message: 'Option ID must be a string' });
          } else {
            if (seen.has(id)) {
              issues.push({ field: `optionIds[${i}]`, message: `Duplicate option ID '${id}'` });
            }
            seen.add(id);
            if (!validIds.has(id)) {
              issues.push({ field: `optionIds[${i}]`, message: `Option '${id}' is not in the question options` });
            }
          }
        }

        if (mark === 'answered' && ids.length === 0) {
          issues.push({ field: 'optionIds', message: "Response marked as 'answered' must select at least one option" });
        }
      }
      break;
    }

    case 'cloze': {
      allowedKeys.add('answers');
      for (const key of Object.keys(res)) {
        if (!allowedKeys.has(key)) {
          issues.push({ field: key, message: `Unknown property '${key}' in cloze response` });
        }
      }

      if (!res.answers || typeof res.answers !== 'object' || Array.isArray(res.answers)) {
        issues.push({ field: 'answers', message: 'answers must be an object map of blankId to answer' });
      } else {
        const answers = res.answers as Record<string, unknown>;
        const validBlankIds = new Set(question.blanks.map((b) => b.id));
        let hasAnyAnswer = false;

        for (const [blankId, val] of Object.entries(answers)) {
          if (!validBlankIds.has(blankId)) {
            issues.push({ field: `answers.${blankId}`, message: `Blank '${blankId}' is not in the question blanks` });
          }
          if (typeof val !== 'string') {
            issues.push({ field: `answers.${blankId}`, message: 'Blank answer must be a string' });
          } else {
            if (val.length > MAX_CLOZE_BLANK_CHARS) {
              issues.push({
                field: `answers.${blankId}`,
                message: `Blank answer exceeds maximum length of ${MAX_CLOZE_BLANK_CHARS} characters`,
              });
            }
            if (val.trim().length > 0) {
              hasAnyAnswer = true;
            }
          }
        }

        if (mark === 'answered' && !hasAnyAnswer) {
          issues.push({ field: 'answers', message: "Response marked as 'answered' must have at least one non-empty blank" });
        }
      }
      break;
    }

    case 'short-answer': {
      allowedKeys.add('text');
      for (const key of Object.keys(res)) {
        if (!allowedKeys.has(key)) {
          issues.push({ field: key, message: `Unknown property '${key}' in short-answer response` });
        }
      }

      if (typeof res.text !== 'string') {
        issues.push({ field: 'text', message: 'text must be a string' });
      } else {
        if (res.text.length > MAX_SHORT_ANSWER_CHARS) {
          issues.push({
            field: 'text',
            message: `Short-answer text exceeds maximum length of ${MAX_SHORT_ANSWER_CHARS} characters`,
          });
        }
        if (mark === 'answered' && res.text.trim().length === 0) {
          issues.push({ field: 'text', message: "Response marked as 'answered' cannot be empty" });
        }
      }
      break;
    }

    case 'essay': {
      allowedKeys.add('text');
      for (const key of Object.keys(res)) {
        if (!allowedKeys.has(key)) {
          issues.push({ field: key, message: `Unknown property '${key}' in essay response` });
        }
      }

      if (typeof res.text !== 'string') {
        issues.push({ field: 'text', message: 'text must be a string' });
      } else {
        if (res.text.length > MAX_ESSAY_CHARS) {
          issues.push({
            field: 'text',
            message: `Essay text exceeds maximum length of ${MAX_ESSAY_CHARS} characters`,
          });
        }
        if (mark === 'answered' && res.text.trim().length === 0) {
          issues.push({ field: 'text', message: "Response marked as 'answered' cannot be empty" });
        }
      }
      break;
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Creates a blank/empty response for a given question.
 */
export function createEmptyResponse(question: AssessmentQuestion): AssessmentResponse {
  switch (question.kind) {
    case 'single-select':
      return { kind: 'single-select', optionId: null };
    case 'multi-select':
      return { kind: 'multi-select', optionIds: [] };
    case 'cloze': {
      const answers: Record<string, string> = {};
      for (const blank of question.blanks) {
        answers[blank.id] = '';
      }
      return { kind: 'cloze', answers };
    }
    case 'short-answer':
      return { kind: 'short-answer', text: '' };
    case 'essay':
      return { kind: 'essay', text: '' };
  }
}

export const MIN_HINT_LEVEL = 0;
export const MAX_HINT_LEVEL = 3;

/** Shared hint-level bounds (C7-T02): integer 0..3. */
export function isValidHintLevel(level: unknown): boolean {
  return typeof level === 'number' && Number.isInteger(level) && level >= MIN_HINT_LEVEL && level <= MAX_HINT_LEVEL;
}

/**
 * Validates a practice hint request against committed hints.
 * Rejects: not precommitted (level > hints.length), out-of-order reveal,
 * exceeding 3, or exam/diagnostic mode leak.
 */
export function validatePracticeHintRequest(
  question: AssessmentQuestion,
  requestedLevel: number,
  currentlyRevealed: number,
  mode: 'exam' | 'practice' | 'diagnostic',
): { valid: boolean; reason?: string } {
  if (mode !== 'practice') return { valid: false, reason: 'exam_hint_leak' };
  if (!isValidHintLevel(requestedLevel)) return { valid: false, reason: 'exceed3' };
  const committed = Array.isArray(question.hints) ? question.hints.length : 0;
  if (requestedLevel > committed) return { valid: false, reason: 'not_precommitted' };
  if (requestedLevel > currentlyRevealed + 1) return { valid: false, reason: 'out_of_order' };
  return { valid: true };
}
