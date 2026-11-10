/**
 * AI Schema Descriptors and Validation Adapters for Question Generation tasks.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §5.2
 * - openspec/changes/generate-study-plan-examinations/ (C3-T06)
 */

import type { ValidationOutcome } from './common';
import type { AISchemaDescriptor } from '../tasks/types';
import type {
  ModelQuestion,
  ModelQuestionBatch,
  QuotaSlot,
} from '../../../types/assessmentQuestions';

export const STUDY_QUESTION_GENERATE_SCHEMA: AISchemaDescriptor = {
  name: 'StudyQuestionGenerateBatchOutput',
  nativeName: 'studyQuestionGenerateBatchOutput',
  json: JSON.stringify({
    type: 'object',
    properties: {
      schemaVersion: { type: 'integer', enum: [1] },
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            slotKey: { type: 'string' },
            question: {
              type: 'object',
              properties: {
                kind: {
                  type: 'string',
                  enum: ['single-select', 'multi-select', 'cloze', 'short-answer', 'essay'],
                },
                prompt: { type: 'string' },
                learningObjectives: { type: 'array', items: { type: 'string' } },
                explanation: { type: 'string' },
                sourceHandles: { type: 'array', items: { type: 'string' } },
                applicationLevel: {
                  type: 'string',
                  enum: ['recall', 'comprehension', 'application', 'multi-step-reasoning'],
                },
                hints: { type: 'array', items: { type: 'string' } },
              },
              required: ['kind', 'prompt', 'explanation', 'sourceHandles', 'applicationLevel'],
            },
          },
          required: ['slotKey', 'question'],
        },
      },
    },
    required: ['schemaVersion', 'questions'],
  }),
};

export interface ValidateQuestionBatchOptions {
  expectedSlots: QuotaSlot[];
  allowedSourceHandles: string[];
}

/**
 * Validates a model-generated question batch against assigned quota slots and allowed source handles.
 */
export function validateQuestionBatchOutputForTask(
  output: unknown,
  options: ValidateQuestionBatchOptions
): ValidationOutcome<ModelQuestionBatch> {
  const errors: string[] = [];

  if (typeof output !== 'object' || output === null) {
    return { ok: false, errors: ['Output must be a non-null JSON object'] };
  }

  const raw = output as Record<string, unknown>;
  if (raw.schemaVersion !== 1) {
    errors.push(`schemaVersion must be 1, received: ${String(raw.schemaVersion)}`);
  }

  if (!Array.isArray(raw.questions)) {
    return { ok: false, errors: ['questions must be an array'] };
  }

  const expectedSlotMap = new Map<string, QuotaSlot>(
    options.expectedSlots.map((s) => [s.slotKey, s])
  );
  const seenSlotKeys = new Set<string>();
  const allowedSources = new Set<string>(options.allowedSourceHandles);

  const validatedQuestions: Array<{ slotKey: string; question: ModelQuestion }> = [];

  for (let i = 0; i < raw.questions.length; i++) {
    const item = raw.questions[i];
    if (typeof item !== 'object' || item === null) {
      errors.push(`questions[${i}] must be a non-null object`);
      continue;
    }

    const { slotKey, question } = item as { slotKey?: unknown; question?: unknown };
    if (typeof slotKey !== 'string' || slotKey.trim().length === 0) {
      errors.push(`questions[${i}].slotKey must be a non-empty string`);
      continue;
    }

    if (seenSlotKeys.has(slotKey)) {
      errors.push(`questions[${i}]: duplicate slotKey "${slotKey}"`);
      continue;
    }
    seenSlotKeys.add(slotKey);

    const slot = expectedSlotMap.get(slotKey);
    if (!slot) {
      errors.push(`questions[${i}]: slotKey "${slotKey}" was not assigned to this batch`);
      continue;
    }

    if (typeof question !== 'object' || question === null) {
      errors.push(`questions[${i}].question must be a non-null object`);
      continue;
    }

    const q = question as Record<string, unknown>;

    // Kind match
    if (q.kind !== slot.kind) {
      errors.push(
        `questions[${i}]: kind mismatch for slot "${slotKey}": expected "${slot.kind}", received "${String(q.kind)}"`
      );
    }

    // Prompt check
    if (typeof q.prompt !== 'string' || q.prompt.trim().length === 0) {
      errors.push(`questions[${i}].prompt must be a non-empty string`);
    } else if (q.prompt.length > 2000) {
      errors.push(`questions[${i}].prompt exceeds 2000 characters`);
    }

    // Explanation check
    if (typeof q.explanation !== 'string') {
      errors.push(`questions[${i}].explanation must be a string`);
    } else if (q.explanation.length > 4000) {
      errors.push(`questions[${i}].explanation exceeds 4000 characters`);
    }

    // Source handles check
    if (!Array.isArray(q.sourceHandles) || q.sourceHandles.length === 0) {
      errors.push(`questions[${i}].sourceHandles must be a non-empty array`);
    } else {
      if (q.sourceHandles.length > 4) {
        errors.push(`questions[${i}].sourceHandles exceeds maximum of 4 sources`);
      }
      for (const sh of q.sourceHandles) {
        if (typeof sh !== 'string' || !allowedSources.has(sh)) {
          errors.push(`questions[${i}].sourceHandles: forged or unknown source handle "${String(sh)}"`);
        }
      }
    }

    // Application level check
    const validLevels = ['recall', 'comprehension', 'application', 'multi-step-reasoning'];
    if (!validLevels.includes(q.applicationLevel as string)) {
      errors.push(`questions[${i}].applicationLevel must be one of ${validLevels.join(', ')}`);
    }

    // Hints check (0..3)
    if (q.hints !== undefined) {
      if (!Array.isArray(q.hints)) {
        errors.push(`questions[${i}].hints must be an array`);
      } else if (q.hints.length > 3) {
        errors.push(`questions[${i}].hints exceeds maximum of 3 hints`);
      } else {
        for (let hIdx = 0; hIdx < q.hints.length; hIdx++) {
          const h = q.hints[hIdx];
          if (typeof h !== 'string' || h.length === 0 || h.length > 500) {
            errors.push(`questions[${i}].hints[${hIdx}] must be 1-500 characters`);
          }
        }
      }
    }

    // Kind-specific checks
    switch (q.kind) {
      case 'single-select': {
        if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 8) {
          errors.push(`questions[${i}].options must contain between 2 and 8 options`);
        } else {
          const optHandles = new Set<string>();
          for (const opt of q.options) {
            if (typeof opt !== 'object' || opt === null || typeof opt.handle !== 'string') {
              errors.push(`questions[${i}].options contains invalid option`);
            } else {
              optHandles.add(opt.handle);
            }
          }
          if (typeof q.correctOptionHandle !== 'string' || !optHandles.has(q.correctOptionHandle)) {
            errors.push(`questions[${i}].correctOptionHandle must match one of the option handles`);
          }
        }
        break;
      }

      case 'multi-select': {
        if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 8) {
          errors.push(`questions[${i}].options must contain between 2 and 8 options`);
        } else {
          const optHandles = new Set<string>();
          for (const opt of q.options) {
            if (typeof opt !== 'object' || opt === null || typeof opt.handle !== 'string') {
              errors.push(`questions[${i}].options contains invalid option`);
            } else {
              optHandles.add(opt.handle);
            }
          }
          if (
            !Array.isArray(q.correctOptionHandles) ||
            q.correctOptionHandles.length < 2 ||
            !q.correctOptionHandles.every((h) => typeof h === 'string' && optHandles.has(h))
          ) {
            errors.push(`questions[${i}].correctOptionHandles must contain at least 2 valid option handles`);
          }
        }
        break;
      }

      case 'cloze': {
        if (!Array.isArray(q.segments) || q.segments.length === 0) {
          errors.push(`questions[${i}].segments must be a non-empty array`);
        }
        if (!Array.isArray(q.blanks) || q.blanks.length === 0) {
          errors.push(`questions[${i}].blanks must contain at least one blank`);
        } else {
          const blankHandles = new Set<string>();
          for (const b of q.blanks) {
            if (typeof b !== 'object' || b === null || typeof b.handle !== 'string') {
              errors.push(`questions[${i}].blanks contains invalid blank`);
            } else {
              blankHandles.add(b.handle);
              if (!Array.isArray(b.acceptedAnswers) || b.acceptedAnswers.length === 0) {
                errors.push(`questions[${i}].blanks "${b.handle}" must have acceptedAnswers`);
              }
            }
          }
          // Segments with blank must match blank handles
          if (Array.isArray(q.segments)) {
            for (const seg of q.segments) {
              if (seg && seg.kind === 'blank') {
                const bId = seg.blankId;
                if (!bId || !blankHandles.has(bId)) {
                  errors.push(`questions[${i}]: segment blankId "${String(bId)}" does not match any blank handle`);
                }
              }
            }
          }
        }
        break;
      }

      case 'short-answer': {
        if (typeof q.referenceAnswer !== 'string' || q.referenceAnswer.trim().length === 0) {
          errors.push(`questions[${i}].referenceAnswer must be a non-empty string`);
        }
        if (!Array.isArray(q.keyFacts) || q.keyFacts.length === 0) {
          errors.push(`questions[${i}].keyFacts must contain at least 1 key fact`);
        }
        if (typeof q.rubric !== 'object' || q.rubric === null) {
          errors.push(`questions[${i}].rubric is required for short-answer`);
        }
        break;
      }

      case 'essay': {
        if (typeof q.expectedReasoning !== 'string' || q.expectedReasoning.trim().length === 0) {
          errors.push(`questions[${i}].expectedReasoning must be a non-empty string`);
        }
        if (typeof q.rubric !== 'object' || q.rubric === null) {
          errors.push(`questions[${i}].rubric is required for essay`);
        } else {
          const rubric = q.rubric as Record<string, unknown>;
          if (!Array.isArray(rubric.criteria) || rubric.criteria.length < 2) {
            errors.push(`questions[${i}].rubric.criteria must contain at least 2 criteria for essay`);
          }
        }
        break;
      }
    }

    validatedQuestions.push({
      slotKey,
      question: q as unknown as ModelQuestion,
    });
  }

  // Ensure all expected slots are present in batch
  for (const expSlot of options.expectedSlots) {
    if (!seenSlotKeys.has(expSlot.slotKey)) {
      errors.push(`Missing question for assigned slot "${expSlot.slotKey}"`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      questions: validatedQuestions,
    },
  };
}
