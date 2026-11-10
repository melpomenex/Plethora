/**
 * Canonical Question, Rubric, and Response Validation.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§4–6
 * - openspec/changes/generate-study-plan-examinations/
 */

import type { FieldIssue } from '../../../types/learningPaths';
import type {
  AssessmentQuestion,
  AssessmentResponse,
  SingleSelectQuestion,
  MultiSelectQuestion,
  ClozeQuestion,
  ShortAnswerQuestion,
  EssayQuestion,
  AnalyticRubric,
  QuestionKind,
} from '../../../types/assessmentQuestions';

export const QUESTION_LIMITS = {
  PROMPT_MIN_CHARS: 1,
  PROMPT_MAX_CHARS: 2000,
  EXPLANATION_MAX_CHARS: 4000,
  MAX_OBJECTIVES: 6,
  OBJECTIVE_MAX_CHARS: 240,
  MAX_SOURCE_REFS: 4,
  MAX_HINTS: 3,
  HINT_MAX_CHARS: 500,
  MIN_MAX_POINTS: 1,
  MAX_MAX_POINTS: 20,
  ESSAY_MIN_POINTS: 4,
  OPTIONS_MIN: 2,
  OPTIONS_MAX: 8,
  OPTION_TEXT_MAX_CHARS: 500,
  CLOZE_BLANKS_MAX: 20,
  CLOZE_ACCEPTED_MIN: 1,
  CLOZE_ACCEPTED_MAX: 12,
  CLOZE_ACCEPTED_MAX_CHARS: 500,
  SHORT_ANSWER_REF_MAX_CHARS: 8000,
  KEY_FACTS_MIN: 1,
  KEY_FACTS_MAX: 10,
  KEY_FACT_TEXT_MAX_CHARS: 1000,
  ESSAY_REASONING_MIN_CHARS: 1,
  ESSAY_REASONING_MAX_CHARS: 12000,
  RUBRIC_CRITERIA_SHORT_MIN: 1,
  RUBRIC_CRITERIA_SHORT_MAX: 8,
  RUBRIC_CRITERIA_ESSAY_MIN: 2,
  RUBRIC_CRITERIA_ESSAY_MAX: 8,
  RUBRIC_TITLE_MAX_CHARS: 200,
  RUBRIC_LEVEL_MAX_CHARS: 1000,
  RESPONSE_SHORT_MAX_CHARS: 20000,
  RESPONSE_ESSAY_MAX_CHARS: 60000,
  RESPONSE_CLOZE_ANSWER_MAX_CHARS: 2000,
} as const;

export interface QuestionValidationResult {
  valid: boolean;
  issues: FieldIssue[];
}

function normalizeText(text: string): string {
  return text.normalize('NFC').trim();
}

function normalizeCase(text: string): string {
  return normalizeText(text).toLocaleLowerCase('en-US');
}

/**
 * Validates common fields shared by all question variants.
 */
function validateCommonFields(
  q: AssessmentQuestion,
  issues: FieldIssue[],
  basePath: string = ''
): void {
  const p = (field: string) => (basePath ? `${basePath}.${field}` : field);

  if (q.schemaVersion !== 1) {
    issues.push({
      path: p('schemaVersion'),
      code: 'invalid_schema_version',
      messageKey: 'study.assessment.error.invalid_schema_version',
    });
  }

  const prompt = typeof q.prompt === 'string' ? q.prompt.trim() : '';
  if (
    prompt.length < QUESTION_LIMITS.PROMPT_MIN_CHARS ||
    q.prompt.length > QUESTION_LIMITS.PROMPT_MAX_CHARS
  ) {
    issues.push({
      path: p('prompt'),
      code: 'invalid_prompt_length',
      messageKey: 'study.assessment.error.invalid_prompt_length',
    });
  }

  if (![1, 2, 3, 4, 5].includes(q.difficulty)) {
    issues.push({
      path: p('difficulty'),
      code: 'invalid_difficulty',
      messageKey: 'study.assessment.error.invalid_difficulty',
    });
  }

  const allowedLevels = [
    'recall',
    'comprehension',
    'application',
    'multi-step-reasoning',
  ];
  if (!allowedLevels.includes(q.applicationLevel)) {
    issues.push({
      path: p('applicationLevel'),
      code: 'invalid_application_level',
      messageKey: 'study.assessment.error.invalid_application_level',
    });
  }

  if (typeof q.explanation !== 'string' || q.explanation.length > QUESTION_LIMITS.EXPLANATION_MAX_CHARS) {
    issues.push({
      path: p('explanation'),
      code: 'invalid_explanation_length',
      messageKey: 'study.assessment.error.invalid_explanation_length',
    });
  }

  if (
    !Number.isInteger(q.maxPoints) ||
    q.maxPoints < QUESTION_LIMITS.MIN_MAX_POINTS ||
    q.maxPoints > QUESTION_LIMITS.MAX_MAX_POINTS
  ) {
    issues.push({
      path: p('maxPoints'),
      code: 'invalid_max_points',
      messageKey: 'study.assessment.error.invalid_max_points',
    });
  }

  if (!Array.isArray(q.learningObjectives) || q.learningObjectives.length > QUESTION_LIMITS.MAX_OBJECTIVES) {
    issues.push({
      path: p('learningObjectives'),
      code: 'invalid_learning_objectives',
      messageKey: 'study.assessment.error.invalid_learning_objectives',
    });
  } else {
    for (let i = 0; i < q.learningObjectives.length; i++) {
      const obj = q.learningObjectives[i];
      if (typeof obj !== 'string' || obj.trim().length === 0 || obj.length > QUESTION_LIMITS.OBJECTIVE_MAX_CHARS) {
        issues.push({
          path: p(`learningObjectives[${i}]`),
          code: 'invalid_objective_length',
          messageKey: 'study.assessment.error.invalid_objective_length',
        });
      }
    }
  }

  if (!Array.isArray(q.sourceRefIds) || q.sourceRefIds.length > QUESTION_LIMITS.MAX_SOURCE_REFS) {
    issues.push({
      path: p('sourceRefIds'),
      code: 'invalid_source_refs',
      messageKey: 'study.assessment.error.invalid_source_refs',
    });
  } else {
    const seenRefs = new Set<string>();
    for (let i = 0; i < q.sourceRefIds.length; i++) {
      const ref = q.sourceRefIds[i];
      if (typeof ref !== 'string' || ref.trim().length === 0) {
        issues.push({
          path: p(`sourceRefIds[${i}]`),
          code: 'invalid_source_ref',
          messageKey: 'study.assessment.error.invalid_source_ref',
        });
      } else if (seenRefs.has(ref)) {
        issues.push({
          path: p(`sourceRefIds[${i}]`),
          code: 'duplicate_source_ref',
          messageKey: 'study.assessment.error.duplicate_source_ref',
        });
      } else {
        seenRefs.add(ref);
      }
    }
  }

  if (!Array.isArray(q.hints) || q.hints.length > QUESTION_LIMITS.MAX_HINTS) {
    issues.push({
      path: p('hints'),
      code: 'invalid_hints_count',
      messageKey: 'study.assessment.error.invalid_hints_count',
    });
  } else {
    for (let i = 0; i < q.hints.length; i++) {
      const hint = q.hints[i];
      if (typeof hint !== 'string' || hint.trim().length === 0 || hint.length > QUESTION_LIMITS.HINT_MAX_CHARS) {
        issues.push({
          path: p(`hints[${i}]`),
          code: 'invalid_hint_length',
          messageKey: 'study.assessment.error.invalid_hint_length',
        });
      }
    }
  }
}

/**
 * Validates that hints do not leak committed answers.
 */
function validateHintAnswerLeakage(
  q: AssessmentQuestion,
  issues: FieldIssue[],
  basePath: string = ''
): void {
  const p = (field: string) => (basePath ? `${basePath}.${field}` : field);
  if (!Array.isArray(q.hints) || q.hints.length === 0) return;

  const forbiddenNormalized = new Set<string>();

  if (q.kind === 'single-select') {
    const correctOpt = q.options?.find((o) => o.id === q.correctOptionId);
    if (correctOpt) {
      forbiddenNormalized.add(normalizeCase(correctOpt.text));
      forbiddenNormalized.add(normalizeCase(correctOpt.id));
    }
  } else if (q.kind === 'multi-select') {
    if (Array.isArray(q.correctOptionIds)) {
      for (const id of q.correctOptionIds) {
        forbiddenNormalized.add(normalizeCase(id));
        const opt = q.options?.find((o) => o.id === id);
        if (opt) forbiddenNormalized.add(normalizeCase(opt.text));
      }
    }
  } else if (q.kind === 'cloze') {
    if (Array.isArray(q.blanks)) {
      for (const b of q.blanks) {
        if (Array.isArray(b.acceptedAnswers)) {
          for (const ans of b.acceptedAnswers) {
            forbiddenNormalized.add(normalizeCase(ans));
          }
        }
      }
    }
  } else if (q.kind === 'short-answer') {
    if (typeof q.referenceAnswer === 'string') {
      forbiddenNormalized.add(normalizeCase(q.referenceAnswer));
    }
    if (Array.isArray(q.acceptedAnswers)) {
      for (const ans of q.acceptedAnswers) {
        forbiddenNormalized.add(normalizeCase(ans));
      }
    }
  } else if (q.kind === 'essay') {
    if (typeof q.expectedReasoning === 'string') {
      forbiddenNormalized.add(normalizeCase(q.expectedReasoning));
    }
  }

  for (let i = 0; i < q.hints.length; i++) {
    const normalizedHint = normalizeCase(q.hints[i]);
    if (forbiddenNormalized.has(normalizedHint)) {
      issues.push({
        path: p(`hints[${i}]`),
        code: 'hint_equals_answer',
        messageKey: 'study.assessment.error.hint_equals_answer',
      });
    }
  }
}

/**
 * Validates single-select question specifics.
 */
function validateSingleSelect(
  q: SingleSelectQuestion,
  issues: FieldIssue[],
  basePath: string = ''
): void {
  const p = (field: string) => (basePath ? `${basePath}.${field}` : field);

  if (
    !Array.isArray(q.options) ||
    q.options.length < QUESTION_LIMITS.OPTIONS_MIN ||
    q.options.length > QUESTION_LIMITS.OPTIONS_MAX
  ) {
    issues.push({
      path: p('options'),
      code: 'invalid_options_count',
      messageKey: 'study.assessment.error.invalid_options_count',
    });
    return;
  }

  const seenIds = new Set<string>();
  const seenTexts = new Set<string>();

  for (let i = 0; i < q.options.length; i++) {
    const opt = q.options[i];
    if (!opt || typeof opt.id !== 'string' || opt.id.trim().length === 0) {
      issues.push({
        path: p(`options[${i}].id`),
        code: 'invalid_option_id',
        messageKey: 'study.assessment.error.invalid_option_id',
      });
    } else if (seenIds.has(opt.id)) {
      issues.push({
        path: p(`options[${i}].id`),
        code: 'duplicate_option_id',
        messageKey: 'study.assessment.error.duplicate_option_id',
      });
    } else {
      seenIds.add(opt.id);
    }

    if (!opt || typeof opt.text !== 'string' || opt.text.trim().length === 0 || opt.text.length > QUESTION_LIMITS.OPTION_TEXT_MAX_CHARS) {
      issues.push({
        path: p(`options[${i}].text`),
        code: 'invalid_option_text',
        messageKey: 'study.assessment.error.invalid_option_text',
      });
    } else {
      const normText = normalizeCase(opt.text);
      if (seenTexts.has(normText)) {
        issues.push({
          path: p(`options[${i}].text`),
          code: 'duplicate_option_text',
          messageKey: 'study.assessment.error.duplicate_option_text',
        });
      } else {
        seenTexts.add(normText);
      }
    }
  }

  if (typeof q.correctOptionId !== 'string' || !seenIds.has(q.correctOptionId)) {
    issues.push({
      path: p('correctOptionId'),
      code: 'unknown_correct_option_id',
      messageKey: 'study.assessment.error.unknown_correct_option_id',
    });
  }
}

/**
 * Validates multi-select question specifics.
 */
function validateMultiSelect(
  q: MultiSelectQuestion,
  issues: FieldIssue[],
  basePath: string = ''
): void {
  const p = (field: string) => (basePath ? `${basePath}.${field}` : field);

  if (
    !Array.isArray(q.options) ||
    q.options.length < QUESTION_LIMITS.OPTIONS_MIN ||
    q.options.length > QUESTION_LIMITS.OPTIONS_MAX
  ) {
    issues.push({
      path: p('options'),
      code: 'invalid_options_count',
      messageKey: 'study.assessment.error.invalid_options_count',
    });
    return;
  }

  const seenIds = new Set<string>();
  const seenTexts = new Set<string>();

  for (let i = 0; i < q.options.length; i++) {
    const opt = q.options[i];
    if (!opt || typeof opt.id !== 'string' || opt.id.trim().length === 0) {
      issues.push({
        path: p(`options[${i}].id`),
        code: 'invalid_option_id',
        messageKey: 'study.assessment.error.invalid_option_id',
      });
    } else if (seenIds.has(opt.id)) {
      issues.push({
        path: p(`options[${i}].id`),
        code: 'duplicate_option_id',
        messageKey: 'study.assessment.error.duplicate_option_id',
      });
    } else {
      seenIds.add(opt.id);
    }

    if (!opt || typeof opt.text !== 'string' || opt.text.trim().length === 0 || opt.text.length > QUESTION_LIMITS.OPTION_TEXT_MAX_CHARS) {
      issues.push({
        path: p(`options[${i}].text`),
        code: 'invalid_option_text',
        messageKey: 'study.assessment.error.invalid_option_text',
      });
    } else {
      const normText = normalizeCase(opt.text);
      if (seenTexts.has(normText)) {
        issues.push({
          path: p(`options[${i}].text`),
          code: 'duplicate_option_text',
          messageKey: 'study.assessment.error.duplicate_option_text',
        });
      } else {
        seenTexts.add(normText);
      }
    }
  }

  if (!Array.isArray(q.correctOptionIds) || q.correctOptionIds.length < 2) {
    issues.push({
      path: p('correctOptionIds'),
      code: 'invalid_correct_options_count',
      messageKey: 'study.assessment.error.invalid_correct_options_count',
    });
    return;
  }

  const seenCorrect = new Set<string>();
  let isSorted = true;

  for (let i = 0; i < q.correctOptionIds.length; i++) {
    const id = q.correctOptionIds[i];
    if (typeof id !== 'string' || !seenIds.has(id)) {
      issues.push({
        path: p(`correctOptionIds[${i}]`),
        code: 'unknown_correct_option_id',
        messageKey: 'study.assessment.error.unknown_correct_option_id',
      });
    } else if (seenCorrect.has(id)) {
      issues.push({
        path: p(`correctOptionIds[${i}]`),
        code: 'duplicate_correct_option_id',
        messageKey: 'study.assessment.error.duplicate_correct_option_id',
      });
    } else {
      seenCorrect.add(id);
    }

    if (i > 0 && q.correctOptionIds[i - 1] > id) {
      isSorted = false;
    }
  }

  if (!isSorted) {
    issues.push({
      path: p('correctOptionIds'),
      code: 'correct_options_not_sorted',
      messageKey: 'study.assessment.error.correct_options_not_sorted',
    });
  }

  // Must have at least 1 distractor
  if (seenCorrect.size >= seenIds.size && seenIds.size > 0) {
    issues.push({
      path: p('options'),
      code: 'no_distractors',
      messageKey: 'study.assessment.error.no_distractors',
    });
  }
}

/**
 * Validates cloze question specifics.
 */
function validateCloze(
  q: ClozeQuestion,
  issues: FieldIssue[],
  basePath: string = ''
): void {
  const p = (field: string) => (basePath ? `${basePath}.${field}` : field);

  if (!Array.isArray(q.segments) || q.segments.length === 0) {
    issues.push({
      path: p('segments'),
      code: 'invalid_segments',
      messageKey: 'study.assessment.error.invalid_segments',
    });
    return;
  }

  if (!Array.isArray(q.blanks) || q.blanks.length === 0 || q.blanks.length > QUESTION_LIMITS.CLOZE_BLANKS_MAX) {
    issues.push({
      path: p('blanks'),
      code: 'invalid_blanks_count',
      messageKey: 'study.assessment.error.invalid_blanks_count',
    });
    return;
  }

  // Blanks validation
  const blankMap = new Map<string, { id: string; acceptedAnswers: string[]; caseSensitive: boolean }>();
  for (let i = 0; i < q.blanks.length; i++) {
    const b = q.blanks[i];
    if (!b || typeof b.id !== 'string' || b.id.trim().length === 0) {
      issues.push({
        path: p(`blanks[${i}].id`),
        code: 'invalid_blank_id',
        messageKey: 'study.assessment.error.invalid_blank_id',
      });
      continue;
    }

    if (blankMap.has(b.id)) {
      issues.push({
        path: p(`blanks[${i}].id`),
        code: 'duplicate_blank_id',
        messageKey: 'study.assessment.error.duplicate_blank_id',
      });
      continue;
    }
    blankMap.set(b.id, b);

    if (typeof b.caseSensitive !== 'boolean') {
      issues.push({
        path: p(`blanks[${i}].caseSensitive`),
        code: 'invalid_case_sensitive',
        messageKey: 'study.assessment.error.invalid_case_sensitive',
      });
    }

    if (
      !Array.isArray(b.acceptedAnswers) ||
      b.acceptedAnswers.length < QUESTION_LIMITS.CLOZE_ACCEPTED_MIN ||
      b.acceptedAnswers.length > QUESTION_LIMITS.CLOZE_ACCEPTED_MAX
    ) {
      issues.push({
        path: p(`blanks[${i}].acceptedAnswers`),
        code: 'invalid_accepted_answers_count',
        messageKey: 'study.assessment.error.invalid_accepted_answers_count',
      });
    } else {
      const seenAns = new Set<string>();
      for (let j = 0; j < b.acceptedAnswers.length; j++) {
        const ans = b.acceptedAnswers[j];
        if (typeof ans !== 'string' || ans.trim().length === 0 || ans.length > QUESTION_LIMITS.CLOZE_ACCEPTED_MAX_CHARS) {
          issues.push({
            path: p(`blanks[${i}].acceptedAnswers[${j}]`),
            code: 'invalid_accepted_answer_text',
            messageKey: 'study.assessment.error.invalid_accepted_answer_text',
          });
        } else {
          const normAns = b.caseSensitive ? normalizeText(ans) : normalizeCase(ans);
          if (seenAns.has(normAns)) {
            issues.push({
              path: p(`blanks[${i}].acceptedAnswers[${j}]`),
              code: 'duplicate_accepted_answer',
              messageKey: 'study.assessment.error.duplicate_accepted_answer',
            });
          } else {
            seenAns.add(normAns);
          }
        }
      }
    }
  }

  // Segments validation
  const referencedBlankIds = new Set<string>();
  let previousWasBlank = false;
  let hasAtLeastOneBlank = false;

  for (let i = 0; i < q.segments.length; i++) {
    const seg = q.segments[i];
    if (!seg || typeof seg.kind !== 'string') {
      issues.push({
        path: p(`segments[${i}]`),
        code: 'invalid_segment',
        messageKey: 'study.assessment.error.invalid_segment',
      });
      continue;
    }

    if (seg.kind === 'blank') {
      hasAtLeastOneBlank = true;
      if (previousWasBlank) {
        issues.push({
          path: p(`segments[${i}]`),
          code: 'adjacent_blanks',
          messageKey: 'study.assessment.error.adjacent_blanks',
        });
      }
      previousWasBlank = true;

      if (typeof seg.blankId !== 'string' || !blankMap.has(seg.blankId)) {
        issues.push({
          path: p(`segments[${i}].blankId`),
          code: 'unknown_blank_id',
          messageKey: 'study.assessment.error.unknown_blank_id',
        });
      } else if (referencedBlankIds.has(seg.blankId)) {
        issues.push({
          path: p(`segments[${i}].blankId`),
          code: 'duplicate_blank_reference',
          messageKey: 'study.assessment.error.duplicate_blank_reference',
        });
      } else {
        referencedBlankIds.add(seg.blankId);
      }
    } else if (seg.kind === 'text') {
      previousWasBlank = false;
      if (typeof seg.text !== 'string') {
        issues.push({
          path: p(`segments[${i}].text`),
          code: 'invalid_segment_text',
          messageKey: 'study.assessment.error.invalid_segment_text',
        });
      }
    } else {
      issues.push({
        path: p(`segments[${i}].kind`),
        code: 'invalid_segment_kind',
        messageKey: 'study.assessment.error.invalid_segment_kind',
      });
    }
  }

  if (!hasAtLeastOneBlank) {
    issues.push({
      path: p('segments'),
      code: 'missing_blank_segment',
      messageKey: 'study.assessment.error.missing_blank_segment',
    });
  }

  // Check for orphaned blanks (declared in blanks array but never referenced in segments)
  for (const bId of blankMap.keys()) {
    if (!referencedBlankIds.has(bId)) {
      issues.push({
        path: p('blanks'),
        code: 'orphan_blank_id',
        messageKey: 'study.assessment.error.orphan_blank_id',
      });
    }
  }

  // Source leakage check: segment text must not expose verbatim accepted answers
  for (let i = 0; i < q.segments.length; i++) {
    const seg = q.segments[i];
    if (seg.kind === 'text' && typeof seg.text === 'string') {
      const normSegText = normalizeCase(seg.text);
      for (const [, b] of blankMap.entries()) {
        for (const ans of b.acceptedAnswers) {
          const normAns = normalizeCase(ans);
          // Only check non-trivial answers (>= 2 chars) to avoid single-letter collisions
          if (normAns.length >= 2 && normSegText.includes(normAns)) {
            issues.push({
              path: p(`segments[${i}].text`),
              code: 'cloze_answer_leakage',
              messageKey: 'study.assessment.error.cloze_answer_leakage',
            });
            break;
          }
        }
      }
    }
  }
}

/**
 * Validates an analytic rubric.
 */
export function validateAnalyticRubric(
  rubric: AnalyticRubric,
  kind: 'short-answer' | 'essay',
  parentSourceRefIds: string[],
  issues: FieldIssue[],
  basePath: string = 'rubric'
): void {
  const p = (field: string) => (basePath ? `${basePath}.${field}` : field);

  if (!rubric || typeof rubric !== 'object') {
    issues.push({
      path: p(''),
      code: 'missing_rubric',
      messageKey: 'study.assessment.error.missing_rubric',
    });
    return;
  }

  if (rubric.schemaVersion !== 1) {
    issues.push({
      path: p('schemaVersion'),
      code: 'invalid_rubric_schema_version',
      messageKey: 'study.assessment.error.invalid_rubric_schema_version',
    });
  }

  const minCriteria =
    kind === 'essay'
      ? QUESTION_LIMITS.RUBRIC_CRITERIA_ESSAY_MIN
      : QUESTION_LIMITS.RUBRIC_CRITERIA_SHORT_MIN;
  const maxCriteria =
    kind === 'essay'
      ? QUESTION_LIMITS.RUBRIC_CRITERIA_ESSAY_MAX
      : QUESTION_LIMITS.RUBRIC_CRITERIA_SHORT_MAX;

  if (
    !Array.isArray(rubric.criteria) ||
    rubric.criteria.length < minCriteria ||
    rubric.criteria.length > maxCriteria
  ) {
    issues.push({
      path: p('criteria'),
      code: 'invalid_criteria_count',
      messageKey: 'study.assessment.error.invalid_criteria_count',
    });
    return;
  }

  const seenCritIds = new Set<string>();
  const seenTitles = new Set<string>();
  let totalWeight = 0;
  const parentSourcesSet = new Set(parentSourceRefIds);

  for (let i = 0; i < rubric.criteria.length; i++) {
    const crit = rubric.criteria[i];
    if (!crit || typeof crit.id !== 'string' || crit.id.trim().length === 0) {
      issues.push({
        path: p(`criteria[${i}].id`),
        code: 'invalid_criterion_id',
        messageKey: 'study.assessment.error.invalid_criterion_id',
      });
    } else if (seenCritIds.has(crit.id)) {
      issues.push({
        path: p(`criteria[${i}].id`),
        code: 'duplicate_criterion_id',
        messageKey: 'study.assessment.error.duplicate_criterion_id',
      });
    } else {
      seenCritIds.add(crit.id);
    }

    if (
      !crit ||
      typeof crit.title !== 'string' ||
      crit.title.trim().length === 0 ||
      crit.title.length > QUESTION_LIMITS.RUBRIC_TITLE_MAX_CHARS
    ) {
      issues.push({
        path: p(`criteria[${i}].title`),
        code: 'invalid_criterion_title',
        messageKey: 'study.assessment.error.invalid_criterion_title',
      });
    } else {
      const normTitle = normalizeCase(crit.title);
      if (seenTitles.has(normTitle)) {
        issues.push({
          path: p(`criteria[${i}].title`),
          code: 'duplicate_criterion_title',
          messageKey: 'study.assessment.error.duplicate_criterion_title',
        });
      } else {
        seenTitles.add(normTitle);
      }
    }

    if (!Number.isInteger(crit.weight) || crit.weight < 1 || crit.weight > 100) {
      issues.push({
        path: p(`criteria[${i}].weight`),
        code: 'invalid_criterion_weight',
        messageKey: 'study.assessment.error.invalid_criterion_weight',
      });
    } else {
      totalWeight += crit.weight;
    }

    if (!['source', 'reasoning', 'presentation'].includes(crit.grounding)) {
      issues.push({
        path: p(`criteria[${i}].grounding`),
        code: 'invalid_criterion_grounding',
        messageKey: 'study.assessment.error.invalid_criterion_grounding',
      });
    }

    if (crit.grounding === 'source') {
      if (!Array.isArray(crit.sourceRefIds) || crit.sourceRefIds.length === 0) {
        issues.push({
          path: p(`criteria[${i}].sourceRefIds`),
          code: 'missing_criterion_source_refs',
          messageKey: 'study.assessment.error.missing_criterion_source_refs',
        });
      } else if (parentSourceRefIds.length > 0) {
        for (const sId of crit.sourceRefIds) {
          if (!parentSourcesSet.has(sId)) {
            issues.push({
              path: p(`criteria[${i}].sourceRefIds`),
              code: 'unknown_criterion_source_ref',
              messageKey: 'study.assessment.error.unknown_criterion_source_ref',
            });
          }
        }
      }
    }

    // Check levels 0, 1, 2, 3, 4
    if (!crit.levels || typeof crit.levels !== 'object') {
      issues.push({
        path: p(`criteria[${i}].levels`),
        code: 'missing_criterion_levels',
        messageKey: 'study.assessment.error.missing_criterion_levels',
      });
    } else {
      for (const lvl of ['0', '1', '2', '3', '4'] as const) {
        const desc = crit.levels[lvl];
        if (
          typeof desc !== 'string' ||
          desc.trim().length === 0 ||
          desc.length > QUESTION_LIMITS.RUBRIC_LEVEL_MAX_CHARS
        ) {
          issues.push({
            path: p(`criteria[${i}].levels.${lvl}`),
            code: 'invalid_criterion_level_desc',
            messageKey: 'study.assessment.error.invalid_criterion_level_desc',
          });
        }
      }
    }
  }

  if (totalWeight <= 0) {
    issues.push({
      path: p('criteria'),
      code: 'total_weight_non_positive',
      messageKey: 'study.assessment.error.total_weight_non_positive',
    });
  }
}

/**
 * Validates short-answer question specifics.
 */
function validateShortAnswer(
  q: ShortAnswerQuestion,
  issues: FieldIssue[],
  basePath: string = ''
): void {
  const p = (field: string) => (basePath ? `${basePath}.${field}` : field);

  if (
    typeof q.referenceAnswer !== 'string' ||
    q.referenceAnswer.trim().length === 0 ||
    q.referenceAnswer.length > QUESTION_LIMITS.SHORT_ANSWER_REF_MAX_CHARS
  ) {
    issues.push({
      path: p('referenceAnswer'),
      code: 'invalid_reference_answer_length',
      messageKey: 'study.assessment.error.invalid_reference_answer_length',
    });
  }

  if (
    !Array.isArray(q.keyFacts) ||
    q.keyFacts.length < QUESTION_LIMITS.KEY_FACTS_MIN ||
    q.keyFacts.length > QUESTION_LIMITS.KEY_FACTS_MAX
  ) {
    issues.push({
      path: p('keyFacts'),
      code: 'invalid_key_facts_count',
      messageKey: 'study.assessment.error.invalid_key_facts_count',
    });
    return;
  }

  const seenFactIds = new Set<string>();
  const requiredFactIds = new Set<string>();

  for (let i = 0; i < q.keyFacts.length; i++) {
    const kf = q.keyFacts[i];
    if (!kf || typeof kf.id !== 'string' || kf.id.trim().length === 0) {
      issues.push({
        path: p(`keyFacts[${i}].id`),
        code: 'invalid_key_fact_id',
        messageKey: 'study.assessment.error.invalid_key_fact_id',
      });
    } else if (seenFactIds.has(kf.id)) {
      issues.push({
        path: p(`keyFacts[${i}].id`),
        code: 'duplicate_key_fact_id',
        messageKey: 'study.assessment.error.duplicate_key_fact_id',
      });
    } else {
      seenFactIds.add(kf.id);
      if (kf.required) {
        requiredFactIds.add(kf.id);
      }
    }

    if (
      !kf ||
      typeof kf.text !== 'string' ||
      kf.text.trim().length === 0 ||
      kf.text.length > QUESTION_LIMITS.KEY_FACT_TEXT_MAX_CHARS
    ) {
      issues.push({
        path: p(`keyFacts[${i}].text`),
        code: 'invalid_key_fact_text',
        messageKey: 'study.assessment.error.invalid_key_fact_text',
      });
    }

    if (typeof kf.required !== 'boolean') {
      issues.push({
        path: p(`keyFacts[${i}].required`),
        code: 'invalid_key_fact_required',
        messageKey: 'study.assessment.error.invalid_key_fact_required',
      });
    }
  }

  if (Array.isArray(q.acceptedAnswers)) {
    for (let i = 0; i < q.acceptedAnswers.length; i++) {
      const ans = q.acceptedAnswers[i];
      if (typeof ans !== 'string' || ans.trim().length === 0 || ans.length > QUESTION_LIMITS.CLOZE_ACCEPTED_MAX_CHARS) {
        issues.push({
          path: p(`acceptedAnswers[${i}]`),
          code: 'invalid_accepted_answer',
          messageKey: 'study.assessment.error.invalid_accepted_answer',
        });
      }
    }
  }

  // Validate rubric and link between criteria and required key facts
  validateAnalyticRubric(q.rubric, 'short-answer', q.sourceRefIds ?? [], issues, p('rubric'));

  if (q.rubric && Array.isArray(q.rubric.criteria)) {
    const coveredFactIds = new Set<string>();
    for (const crit of q.rubric.criteria) {
      if (Array.isArray(crit.keyFactIds)) {
        for (const fId of crit.keyFactIds) {
          if (!seenFactIds.has(fId)) {
            issues.push({
              path: p(`rubric.criteria.${crit.id}.keyFactIds`),
              code: 'unknown_key_fact_id',
              messageKey: 'study.assessment.error.unknown_key_fact_id',
            });
          } else {
            coveredFactIds.add(fId);
          }
        }
      }
    }

    // Every required key fact must be mapped to at least one rubric criterion
    for (const reqId of requiredFactIds) {
      if (!coveredFactIds.has(reqId)) {
        issues.push({
          path: p(`keyFacts.${reqId}`),
          code: 'unmapped_required_key_fact',
          messageKey: 'study.assessment.error.unmapped_required_key_fact',
        });
      }
    }
  }
}

/**
 * Validates essay question specifics.
 */
function validateEssay(
  q: EssayQuestion,
  issues: FieldIssue[],
  basePath: string = ''
): void {
  const p = (field: string) => (basePath ? `${basePath}.${field}` : field);

  if (q.maxPoints < QUESTION_LIMITS.ESSAY_MIN_POINTS) {
    issues.push({
      path: p('maxPoints'),
      code: 'essay_max_points_too_low',
      messageKey: 'study.assessment.error.essay_max_points_too_low',
    });
  }

  if (
    typeof q.expectedReasoning !== 'string' ||
    q.expectedReasoning.trim().length < QUESTION_LIMITS.ESSAY_REASONING_MIN_CHARS ||
    q.expectedReasoning.length > QUESTION_LIMITS.ESSAY_REASONING_MAX_CHARS
  ) {
    issues.push({
      path: p('expectedReasoning'),
      code: 'invalid_expected_reasoning_length',
      messageKey: 'study.assessment.error.invalid_expected_reasoning_length',
    });
  }

  validateAnalyticRubric(q.rubric, 'essay', q.sourceRefIds ?? [], issues, p('rubric'));
}

/**
 * Primary validator for any AssessmentQuestion variant.
 */
export function validateAssessmentQuestion(
  q: unknown,
  basePath: string = ''
): QuestionValidationResult {
  const issues: FieldIssue[] = [];

  if (!q || typeof q !== 'object') {
    return {
      valid: false,
      issues: [
        {
          path: basePath || 'question',
          code: 'invalid_question_object',
          messageKey: 'study.assessment.error.invalid_question_object',
        },
      ],
    };
  }

  const candidate = q as AssessmentQuestion;
  const kind = candidate.kind as QuestionKind;

  const validKinds: QuestionKind[] = [
    'single-select',
    'multi-select',
    'cloze',
    'short-answer',
    'essay',
  ];
  if (!validKinds.includes(kind)) {
    return {
      valid: false,
      issues: [
        {
          path: basePath ? `${basePath}.kind` : 'kind',
          code: 'invalid_question_kind',
          messageKey: 'study.assessment.error.invalid_question_kind',
        },
      ],
    };
  }

  validateCommonFields(candidate, issues, basePath);
  validateHintAnswerLeakage(candidate, issues, basePath);

  switch (kind) {
    case 'single-select':
      validateSingleSelect(candidate as SingleSelectQuestion, issues, basePath);
      break;
    case 'multi-select':
      validateMultiSelect(candidate as MultiSelectQuestion, issues, basePath);
      break;
    case 'cloze':
      validateCloze(candidate as ClozeQuestion, issues, basePath);
      break;
    case 'short-answer':
      validateShortAnswer(candidate as ShortAnswerQuestion, issues, basePath);
      break;
    case 'essay':
      validateEssay(candidate as EssayQuestion, issues, basePath);
      break;
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Validates an AssessmentResponse against a question.
 */
export function validateAssessmentResponse(
  question: AssessmentQuestion,
  response: unknown
): QuestionValidationResult {
  const issues: FieldIssue[] = [];

  if (!response || typeof response !== 'object') {
    return {
      valid: false,
      issues: [
        {
          path: 'response',
          code: 'invalid_response_object',
          messageKey: 'study.assessment.error.invalid_response_object',
        },
      ],
    };
  }

  const r = response as AssessmentResponse;

  if (r.kind !== question.kind) {
    return {
      valid: false,
      issues: [
        {
          path: 'response.kind',
          code: 'response_kind_mismatch',
          messageKey: 'study.assessment.error.response_kind_mismatch',
        },
      ],
    };
  }

  if (r.confidence !== undefined) {
    const validConfidences = [0, 0.3, 0.5, 0.7, 0.9, 1];
    if (!validConfidences.includes(r.confidence)) {
      issues.push({
        path: 'response.confidence',
        code: 'invalid_learner_confidence',
        messageKey: 'study.assessment.error.invalid_learner_confidence',
      });
    }
  }

  switch (question.kind) {
    case 'single-select': {
      const resp = r as { kind: 'single-select'; optionId: string | null };
      if (resp.optionId !== null) {
        const optionExists = question.options.some((o) => o.id === resp.optionId);
        if (!optionExists) {
          issues.push({
            path: 'response.optionId',
            code: 'unknown_option_id',
            messageKey: 'study.assessment.error.unknown_option_id',
          });
        }
      }
      break;
    }

    case 'multi-select': {
      const resp = r as { kind: 'multi-select'; optionIds: string[] };
      if (!Array.isArray(resp.optionIds)) {
        issues.push({
          path: 'response.optionIds',
          code: 'invalid_option_ids',
          messageKey: 'study.assessment.error.invalid_option_ids',
        });
      } else {
        const seen = new Set<string>();
        const validOptionIds = new Set(question.options.map((o) => o.id));
        for (let i = 0; i < resp.optionIds.length; i++) {
          const optId = resp.optionIds[i];
          if (!validOptionIds.has(optId)) {
            issues.push({
              path: `response.optionIds[${i}]`,
              code: 'unknown_option_id',
              messageKey: 'study.assessment.error.unknown_option_id',
            });
          }
          if (seen.has(optId)) {
            issues.push({
              path: `response.optionIds[${i}]`,
              code: 'duplicate_response_option_id',
              messageKey: 'study.assessment.error.duplicate_response_option_id',
            });
          }
          seen.add(optId);
        }
      }
      break;
    }

    case 'cloze': {
      const resp = r as { kind: 'cloze'; answers: Record<string, string> };
      if (!resp.answers || typeof resp.answers !== 'object') {
        issues.push({
          path: 'response.answers',
          code: 'invalid_cloze_answers',
          messageKey: 'study.assessment.error.invalid_cloze_answers',
        });
      } else {
        const validBlankIds = new Set(question.blanks.map((b) => b.id));
        for (const [blankId, answerText] of Object.entries(resp.answers)) {
          if (!validBlankIds.has(blankId)) {
            issues.push({
              path: `response.answers.${blankId}`,
              code: 'unknown_blank_id',
              messageKey: 'study.assessment.error.unknown_blank_id',
            });
          }
          if (typeof answerText !== 'string' || answerText.length > QUESTION_LIMITS.RESPONSE_CLOZE_ANSWER_MAX_CHARS) {
            issues.push({
              path: `response.answers.${blankId}`,
              code: 'oversized_cloze_answer',
              messageKey: 'study.assessment.error.oversized_cloze_answer',
            });
          }
        }
      }
      break;
    }

    case 'short-answer': {
      const resp = r as { kind: 'short-answer'; text: string };
      if (typeof resp.text !== 'string' || resp.text.length > QUESTION_LIMITS.RESPONSE_SHORT_MAX_CHARS) {
        issues.push({
          path: 'response.text',
          code: 'oversized_short_answer',
          messageKey: 'study.assessment.error.oversized_short_answer',
        });
      }
      break;
    }

    case 'essay': {
      const resp = r as { kind: 'essay'; text: string };
      if (typeof resp.text !== 'string' || resp.text.length > QUESTION_LIMITS.RESPONSE_ESSAY_MAX_CHARS) {
        issues.push({
          path: 'response.text',
          code: 'oversized_essay_answer',
          messageKey: 'study.assessment.error.oversized_essay_answer',
        });
      }
      break;
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
