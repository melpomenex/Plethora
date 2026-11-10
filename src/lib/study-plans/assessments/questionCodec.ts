/**
 * Assessment Question Three-Part Codec and Model Output Conversion.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §5, §5.2
 * - openspec/changes/generate-study-plan-examinations/
 */

import type {
  AssessmentQuestion,
  SingleSelectQuestion,
  MultiSelectQuestion,
  ClozeQuestion,
  ShortAnswerQuestion,
  EssayQuestion,
  AnalyticRubric,
  RubricCriterion,
  ModelQuestion,
  QuotaSlot,
} from '../../../types/assessmentQuestions';
import {
  DEFAULT_POINTS_BY_KIND,
} from '../../../types/assessmentQuestions';
import {
  validateAssessmentQuestion,
  type QuestionValidationResult,
} from './questionValidation';

export interface EncodedQuestionRevision {
  payloadJson: string;
  answerKeyJson: string;
  rubricJson: string | null;
}

/**
 * Encodes an AssessmentQuestion into the three-part storage format:
 * - payloadJson: Public prompt, options, cloze structure, common metadata (no answer keys or rubrics)
 * - answerKeyJson: Committed answer keys, accepted answers, reference answers
 * - rubricJson: Analytic rubric for short-answer and essay, NULL for objective questions
 */
export function encodeQuestionRevision(
  question: AssessmentQuestion
): EncodedQuestionRevision {
  const common = {
    schemaVersion: 1 as const,
    kind: question.kind,
    prompt: question.prompt,
    difficulty: question.difficulty,
    learningObjectives: question.learningObjectives,
    sourceRefIds: question.sourceRefIds,
    explanation: question.explanation,
    maxPoints: question.maxPoints,
    applicationLevel: question.applicationLevel,
    hints: question.hints,
  };

  switch (question.kind) {
    case 'single-select': {
      const payload = {
        ...common,
        options: question.options.map((o) => ({ id: o.id, text: o.text })),
      };
      const answerKey = {
        correctOptionId: question.correctOptionId,
      };
      return {
        payloadJson: JSON.stringify(payload),
        answerKeyJson: JSON.stringify(answerKey),
        rubricJson: null,
      };
    }

    case 'multi-select': {
      const payload = {
        ...common,
        options: question.options.map((o) => ({ id: o.id, text: o.text })),
      };
      const answerKey = {
        correctOptionIds: [...question.correctOptionIds].sort(),
      };
      return {
        payloadJson: JSON.stringify(payload),
        answerKeyJson: JSON.stringify(answerKey),
        rubricJson: null,
      };
    }

    case 'cloze': {
      const payload = {
        ...common,
        segments: question.segments,
        blanks: question.blanks.map((b) => ({
          id: b.id,
          caseSensitive: b.caseSensitive,
        })),
      };
      const answerKey = {
        blanks: question.blanks.map((b) => ({
          id: b.id,
          acceptedAnswers: b.acceptedAnswers,
        })),
      };
      return {
        payloadJson: JSON.stringify(payload),
        answerKeyJson: JSON.stringify(answerKey),
        rubricJson: null,
      };
    }

    case 'short-answer': {
      const payload = {
        ...common,
      };
      const answerKey = {
        referenceAnswer: question.referenceAnswer,
        keyFacts: question.keyFacts,
        acceptedAnswers: question.acceptedAnswers,
      };
      return {
        payloadJson: JSON.stringify(payload),
        answerKeyJson: JSON.stringify(answerKey),
        rubricJson: JSON.stringify(question.rubric),
      };
    }

    case 'essay': {
      const payload = {
        ...common,
      };
      const answerKey = {
        expectedReasoning: question.expectedReasoning,
      };
      return {
        payloadJson: JSON.stringify(payload),
        answerKeyJson: JSON.stringify(answerKey),
        rubricJson: JSON.stringify(question.rubric),
      };
    }
  }
}

/**
 * Decodes and recombines payloadJson, answerKeyJson, and rubricJson into an AssessmentQuestion.
 * Enforces strict validation and prevents conflicting or extraneous fields.
 */
export function decodeQuestionRevision(
  payloadJson: string,
  answerKeyJson: string,
  rubricJson: string | null
): { question: AssessmentQuestion; validation: QuestionValidationResult } {
  let payload: Record<string, unknown>;
  let answerKey: Record<string, unknown>;
  let rubric: AnalyticRubric | null = null;

  try {
    payload = JSON.parse(payloadJson);
  } catch {
    throw new Error('study.assessment.error.corrupt_payload_json');
  }

  try {
    answerKey = JSON.parse(answerKeyJson);
  } catch {
    throw new Error('study.assessment.error.corrupt_answer_key_json');
  }

  if (rubricJson !== null) {
    try {
      rubric = JSON.parse(rubricJson);
    } catch {
      throw new Error('study.assessment.error.corrupt_rubric_json');
    }
  }

  const kind = payload.kind as string;

  // Enforce rubricJson nullability according to kind
  if (['single-select', 'multi-select', 'cloze'].includes(kind) && rubricJson !== null) {
    throw new Error('study.assessment.error.unexpected_rubric_for_objective_kind');
  }
  if (['short-answer', 'essay'].includes(kind) && rubricJson === null) {
    throw new Error('study.assessment.error.missing_rubric_for_subjective_kind');
  }

  // Prevent leakage of answer keys into payload
  if ('correctOptionId' in payload || 'correctOptionIds' in payload || 'acceptedAnswers' in payload) {
    throw new Error('study.assessment.error.payload_contains_answer_key');
  }

  let recombined: AssessmentQuestion;

  switch (kind) {
    case 'single-select': {
      recombined = {
        ...(payload as unknown as Omit<SingleSelectQuestion, 'correctOptionId'>),
        correctOptionId: answerKey.correctOptionId as string,
      } as SingleSelectQuestion;
      break;
    }

    case 'multi-select': {
      recombined = {
        ...(payload as unknown as Omit<MultiSelectQuestion, 'correctOptionIds'>),
        correctOptionIds: answerKey.correctOptionIds as string[],
      } as MultiSelectQuestion;
      break;
    }

    case 'cloze': {
      const payloadBlanks = (payload.blanks as Array<{ id: string; caseSensitive: boolean }>) || [];
      const keyBlanks = (answerKey.blanks as Array<{ id: string; acceptedAnswers: string[] }>) || [];
      const keyMap = new Map(keyBlanks.map((kb) => [kb.id, kb.acceptedAnswers]));

      const fullBlanks = payloadBlanks.map((pb) => ({
        id: pb.id,
        caseSensitive: pb.caseSensitive ?? false,
        acceptedAnswers: keyMap.get(pb.id) ?? [],
      }));

      recombined = {
        ...(payload as unknown as Omit<ClozeQuestion, 'blanks'>),
        blanks: fullBlanks,
      } as ClozeQuestion;
      break;
    }

    case 'short-answer': {
      recombined = {
        ...(payload as unknown as Omit<
          ShortAnswerQuestion,
          'referenceAnswer' | 'keyFacts' | 'acceptedAnswers' | 'rubric'
        >),
        referenceAnswer: answerKey.referenceAnswer as string,
        keyFacts: (answerKey.keyFacts as ShortAnswerQuestion['keyFacts']) || [],
        acceptedAnswers: (answerKey.acceptedAnswers as string[]) || [],
        rubric: rubric!,
      } as ShortAnswerQuestion;
      break;
    }

    case 'essay': {
      recombined = {
        ...(payload as unknown as Omit<EssayQuestion, 'expectedReasoning' | 'rubric'>),
        expectedReasoning: answerKey.expectedReasoning as string,
        rubric: rubric!,
      } as EssayQuestion;
      break;
    }

    default:
      throw new Error(`study.assessment.error.unsupported_question_kind: ${kind}`);
  }

  const validation = validateAssessmentQuestion(recombined);
  return { question: recombined, validation };
}

/**
 * Converts a model-generated local-handle question proposal into a canonical AssessmentQuestion.
 */
export function convertModelQuestion(
  modelQ: ModelQuestion,
  slot: QuotaSlot,
  sourceMap: Record<string, string>,
  idGenerator?: (prefix: string) => string
): AssessmentQuestion {
  const genId = idGenerator || ((prefix: string) => `${prefix}_${Math.random().toString(36).substring(2, 9)}`);

  // Translate source handles to persistent sourceRefIds
  const sourceRefIds = (modelQ.sourceHandles || [])
    .map((h) => sourceMap[h])
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const base = {
    schemaVersion: 1 as const,
    prompt: modelQ.prompt || '',
    difficulty: slot.difficulty,
    learningObjectives: modelQ.learningObjectives || [],
    sourceRefIds,
    explanation: modelQ.explanation || '',
    maxPoints: DEFAULT_POINTS_BY_KIND[slot.kind],
    applicationLevel: modelQ.applicationLevel || 'recall',
    hints: Array.isArray(modelQ.hints) ? modelQ.hints : [],
  };

  switch (slot.kind) {
    case 'single-select': {
      const q = modelQ as Extract<ModelQuestion, { kind: 'single-select' }>;
      const handleToId = new Map<string, string>();
      const options = (q.options || []).map((opt) => {
        const id = genId('opt');
        handleToId.set(opt.handle, id);
        return { id, text: opt.text };
      });
      const correctOptionId = handleToId.get(q.correctOptionHandle) || q.correctOptionHandle;
      return {
        ...base,
        kind: 'single-select',
        options,
        correctOptionId,
      };
    }

    case 'multi-select': {
      const q = modelQ as Extract<ModelQuestion, { kind: 'multi-select' }>;
      const handleToId = new Map<string, string>();
      const options = (q.options || []).map((opt) => {
        const id = genId('opt');
        handleToId.set(opt.handle, id);
        return { id, text: opt.text };
      });
      const correctOptionIds = (q.correctOptionHandles || [])
        .map((h) => handleToId.get(h) || h)
        .sort();
      return {
        ...base,
        kind: 'multi-select',
        options,
        correctOptionIds,
      };
    }

    case 'cloze': {
      const q = modelQ as Extract<ModelQuestion, { kind: 'cloze' }>;
      const handleToId = new Map<string, string>();
      const blanks = (q.blanks || []).map((b) => {
        const id = genId('blk');
        handleToId.set(b.handle, id);
        return {
          id,
          acceptedAnswers: b.acceptedAnswers || [],
          caseSensitive: b.caseSensitive ?? false,
        };
      });

      // Update segment blank references
      const segments = (q.segments || []).map((seg) => {
        if (seg.kind === 'blank') {
          return {
            kind: 'blank' as const,
            blankId: handleToId.get(seg.blankId) || seg.blankId,
          };
        }
        return seg;
      });

      return {
        ...base,
        kind: 'cloze',
        segments,
        blanks,
      };
    }

    case 'short-answer': {
      const q = modelQ as Extract<ModelQuestion, { kind: 'short-answer' }>;
      const factHandleToId = new Map<string, string>();
      const keyFacts = (q.keyFacts || []).map((kf) => {
        const id = genId('kf');
        factHandleToId.set(kf.handle, id);
        return {
          id,
          text: kf.text,
          required: kf.required ?? false,
        };
      });

      const criteria: RubricCriterion[] = ((q.rubric && q.rubric.criteria) || []).map((crit) => {
        const critSourceRefs = (crit.sourceHandles || [])
          .map((h) => sourceMap[h])
          .filter((id): id is string => typeof id === 'string' && id.length > 0);

        const mappedKeyFactIds = (crit.keyFactIds || []).map(
          (h) => factHandleToId.get(h) || h
        );

        return {
          id: genId('crit'),
          title: crit.title,
          assessmentInstruction: crit.assessmentInstruction,
          weight: crit.weight,
          grounding: crit.grounding,
          sourceRefIds: critSourceRefs,
          keyFactIds: mappedKeyFactIds,
          levels: crit.levels,
        };
      });

      const rubric: AnalyticRubric = {
        schemaVersion: 1,
        criteria,
        expectedConcepts: (q.rubric && q.rubric.expectedConcepts) || [],
        gradingConstraints: (q.rubric && q.rubric.gradingConstraints) || [],
      };

      return {
        ...base,
        kind: 'short-answer',
        referenceAnswer: q.referenceAnswer || '',
        keyFacts,
        acceptedAnswers: q.acceptedAnswers || [],
        rubric,
      };
    }

    case 'essay': {
      const q = modelQ as Extract<ModelQuestion, { kind: 'essay' }>;
      const criteria: RubricCriterion[] = ((q.rubric && q.rubric.criteria) || []).map((crit) => {
        const critSourceRefs = (crit.sourceHandles || [])
          .map((h) => sourceMap[h])
          .filter((id): id is string => typeof id === 'string' && id.length > 0);

        return {
          id: genId('crit'),
          title: crit.title,
          assessmentInstruction: crit.assessmentInstruction,
          weight: crit.weight,
          grounding: crit.grounding,
          sourceRefIds: critSourceRefs,
          keyFactIds: [],
          levels: crit.levels,
        };
      });

      const rubric: AnalyticRubric = {
        schemaVersion: 1,
        criteria,
        expectedConcepts: (q.rubric && q.rubric.expectedConcepts) || [],
        gradingConstraints: (q.rubric && q.rubric.gradingConstraints) || [],
      };

      return {
        ...base,
        kind: 'essay',
        expectedReasoning: q.expectedReasoning || '',
        rubric,
      };
    }
  }
}
