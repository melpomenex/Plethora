import { describe, expect, it } from 'vitest';
import {
  createEmptyResponse,
  isValidConfidence,
  MAX_CLOZE_BLANK_CHARS,
  MAX_ESSAY_CHARS,
  MAX_SHORT_ANSWER_CHARS,
  validateAssessmentResponse,
} from '../responseValidation';
import type {
  ClozeQuestion,
  EssayQuestion,
  MultiSelectQuestion,
  ShortAnswerQuestion,
  SingleSelectQuestion,
} from '../../../../types/assessmentQuestions';

describe('responseValidation', () => {
  const singleQuestion: SingleSelectQuestion = {
    schemaVersion: 1,
    kind: 'single-select',
    prompt: 'Choose one',
    difficulty: 2,
    learningObjectives: [],
    sourceRefIds: [],
    explanation: '',
    maxPoints: 2,
    applicationLevel: 'recall',
    hints: [],
    options: [
      { id: 'opt_1', text: 'Option 1' },
      { id: 'opt_2', text: 'Option 2' },
    ],
    correctOptionId: 'opt_1',
  };

  const multiQuestion: MultiSelectQuestion = {
    schemaVersion: 1,
    kind: 'multi-select',
    prompt: 'Choose multiple',
    difficulty: 3,
    learningObjectives: [],
    sourceRefIds: [],
    explanation: '',
    maxPoints: 3,
    applicationLevel: 'comprehension',
    hints: [],
    options: [
      { id: 'm_1', text: 'M1' },
      { id: 'm_2', text: 'M2' },
      { id: 'm_3', text: 'M3' },
    ],
    correctOptionIds: ['m_1', 'm_2'],
  };

  const clozeQuestion: ClozeQuestion = {
    schemaVersion: 1,
    kind: 'cloze',
    prompt: 'Fill blanks',
    difficulty: 2,
    learningObjectives: [],
    sourceRefIds: [],
    explanation: '',
    maxPoints: 2,
    applicationLevel: 'recall',
    hints: [],
    segments: [
      { kind: 'text', text: 'Hello ' },
      { kind: 'blank', blankId: 'b_1' },
    ],
    blanks: [
      {
        id: 'b_1',
        acceptedAnswers: ['world'],
        caseSensitive: false,
      },
    ],
  };

  const shortQuestion: ShortAnswerQuestion = {
    schemaVersion: 1,
    kind: 'short-answer',
    prompt: 'Explain concept',
    difficulty: 3,
    learningObjectives: [],
    sourceRefIds: [],
    explanation: '',
    maxPoints: 4,
    applicationLevel: 'application',
    hints: [],
    referenceAnswer: 'Sample solution',
    keyFacts: [{ id: 'kf_1', text: 'Fact 1', required: true }],
    acceptedAnswers: ['Exact match'],
    rubric: {
      schemaVersion: 1,
      criteria: [
        {
          id: 'crit_1',
          title: 'Accuracy',
          assessmentInstruction: 'Assess accuracy',
          weight: 100,
          grounding: 'reasoning',
          sourceRefIds: [],
          keyFactIds: ['kf_1'],
          levels: { '0': 'Bad', '1': 'Poor', '2': 'Fair', '3': 'Good', '4': 'Excellent' },
        },
      ],
      expectedConcepts: ['concept'],
      gradingConstraints: [],
    },
  };

  const essayQuestion: EssayQuestion = {
    schemaVersion: 1,
    kind: 'essay',
    prompt: 'Discuss essay',
    difficulty: 4,
    learningObjectives: [],
    sourceRefIds: [],
    explanation: '',
    maxPoints: 8,
    applicationLevel: 'multi-step-reasoning',
    hints: [],
    expectedReasoning: 'Detailed outline',
    rubric: {
      schemaVersion: 1,
      criteria: [
        {
          id: 'crit_e1',
          title: 'Depth',
          assessmentInstruction: 'Assess depth',
          weight: 100,
          grounding: 'reasoning',
          sourceRefIds: [],
          keyFactIds: [],
          levels: { '0': '0', '1': '1', '2': '2', '3': '3', '4': '4' },
        },
      ],
      expectedConcepts: ['thesis'],
      gradingConstraints: [],
    },
  };

  describe('confidence validation', () => {
    it('accepts all six declared confidence stops', () => {
      const stops = [0, 0.3, 0.5, 0.7, 0.9, 1] as const;
      for (const stop of stops) {
        expect(isValidConfidence(stop)).toBe(true);
        const res = validateAssessmentResponse(
          { kind: 'single-select', optionId: 'opt_1', confidence: stop },
          singleQuestion
        );
        expect(res.valid).toBe(true);
      }
    });

    it('rejects confidence outside six stops and NaN', () => {
      expect(isValidConfidence(0.2)).toBe(false);
      expect(isValidConfidence(0.8)).toBe(false);
      expect(isValidConfidence(NaN)).toBe(false);
      expect(isValidConfidence(-1)).toBe(false);
      expect(isValidConfidence(2)).toBe(false);

      const res = validateAssessmentResponse(
        { kind: 'single-select', optionId: 'opt_1', confidence: 0.8 },
        singleQuestion
      );
      expect(res.valid).toBe(false);
      expect(res.issues[0].field).toBe('confidence');
    });

    it('retains confidence when mark is skipped or unanswered', () => {
      const resSkipped = validateAssessmentResponse(
        { kind: 'single-select', optionId: null, confidence: 0.7 },
        singleQuestion,
        'skipped'
      );
      expect(resSkipped.valid).toBe(true);

      const resUnanswered = validateAssessmentResponse(
        { kind: 'single-select', optionId: null, confidence: 0.3 },
        singleQuestion,
        'unanswered'
      );
      expect(resUnanswered.valid).toBe(true);
    });
  });

  describe('kind discriminant check', () => {
    it('rejects response when kind does not match question kind', () => {
      const res = validateAssessmentResponse(
        { kind: 'multi-select', optionIds: ['opt_1'] },
        singleQuestion
      );
      expect(res.valid).toBe(false);
      expect(res.issues[0].field).toBe('kind');
    });
  });

  describe('single-select validation', () => {
    it('accepts valid optionId', () => {
      const res = validateAssessmentResponse(
        { kind: 'single-select', optionId: 'opt_1' },
        singleQuestion,
        'answered'
      );
      expect(res.valid).toBe(true);
    });

    it('rejects unknown optionId', () => {
      const res = validateAssessmentResponse(
        { kind: 'single-select', optionId: 'unknown_opt' },
        singleQuestion
      );
      expect(res.valid).toBe(false);
      expect(res.issues[0].field).toBe('optionId');
    });

    it('rejects null optionId when mark is answered', () => {
      const res = validateAssessmentResponse(
        { kind: 'single-select', optionId: null },
        singleQuestion,
        'answered'
      );
      expect(res.valid).toBe(false);
      expect(res.issues[0].field).toBe('optionId');
    });

    it('rejects extra unknown top-level keys', () => {
      const res = validateAssessmentResponse(
        { kind: 'single-select', optionId: 'opt_1', hackerField: true },
        singleQuestion
      );
      expect(res.valid).toBe(false);
      expect(res.issues.some((i) => i.field === 'hackerField')).toBe(true);
    });
  });

  describe('multi-select validation', () => {
    it('accepts valid unique optionIds', () => {
      const res = validateAssessmentResponse(
        { kind: 'multi-select', optionIds: ['m_1', 'm_2'] },
        multiQuestion,
        'answered'
      );
      expect(res.valid).toBe(true);
    });

    it('rejects duplicate optionIds', () => {
      const res = validateAssessmentResponse(
        { kind: 'multi-select', optionIds: ['m_1', 'm_1'] },
        multiQuestion
      );
      expect(res.valid).toBe(false);
      expect(res.issues.some((i) => i.message.includes('Duplicate'))).toBe(true);
    });

    it('rejects unknown optionId', () => {
      const res = validateAssessmentResponse(
        { kind: 'multi-select', optionIds: ['m_1', 'unknown_m'] },
        multiQuestion
      );
      expect(res.valid).toBe(false);
      expect(res.issues.some((i) => i.message.includes('not in the question options'))).toBe(true);
    });

    it('rejects empty optionIds when mark is answered', () => {
      const res = validateAssessmentResponse(
        { kind: 'multi-select', optionIds: [] },
        multiQuestion,
        'answered'
      );
      expect(res.valid).toBe(false);
    });
  });

  describe('cloze validation', () => {
    it('accepts valid cloze answers', () => {
      const res = validateAssessmentResponse(
        { kind: 'cloze', answers: { b_1: 'world' } },
        clozeQuestion,
        'answered'
      );
      expect(res.valid).toBe(true);
    });

    it('rejects unknown blank id', () => {
      const res = validateAssessmentResponse(
        { kind: 'cloze', answers: { unknown_blank: 'foo' } },
        clozeQuestion
      );
      expect(res.valid).toBe(false);
      expect(res.issues.some((i) => i.message.includes('not in the question blanks'))).toBe(true);
    });

    it('rejects answer exceeding character limit', () => {
      const oversize = 'a'.repeat(MAX_CLOZE_BLANK_CHARS + 1);
      const res = validateAssessmentResponse(
        { kind: 'cloze', answers: { b_1: oversize } },
        clozeQuestion
      );
      expect(res.valid).toBe(false);
      expect(res.issues.some((i) => i.message.includes('exceeds maximum length'))).toBe(true);
    });

    it('rejects all-empty answers when mark is answered', () => {
      const res = validateAssessmentResponse(
        { kind: 'cloze', answers: { b_1: '   ' } },
        clozeQuestion,
        'answered'
      );
      expect(res.valid).toBe(false);
    });
  });

  describe('short-answer validation', () => {
    it('accepts valid short-answer text', () => {
      const res = validateAssessmentResponse(
        { kind: 'short-answer', text: 'This is my short answer' },
        shortQuestion,
        'answered'
      );
      expect(res.valid).toBe(true);
    });

    it('rejects text exceeding character limit', () => {
      const oversize = 'a'.repeat(MAX_SHORT_ANSWER_CHARS + 1);
      const res = validateAssessmentResponse(
        { kind: 'short-answer', text: oversize },
        shortQuestion
      );
      expect(res.valid).toBe(false);
      expect(res.issues.some((i) => i.message.includes('exceeds maximum length'))).toBe(true);
    });

    it('rejects empty text when mark is answered', () => {
      const res = validateAssessmentResponse(
        { kind: 'short-answer', text: '   ' },
        shortQuestion,
        'answered'
      );
      expect(res.valid).toBe(false);
    });
  });

  describe('essay validation', () => {
    it('accepts valid essay text', () => {
      const res = validateAssessmentResponse(
        { kind: 'essay', text: 'This is my essay discussion...' },
        essayQuestion,
        'answered'
      );
      expect(res.valid).toBe(true);
    });

    it('rejects text exceeding character limit', () => {
      const oversize = 'a'.repeat(MAX_ESSAY_CHARS + 1);
      const res = validateAssessmentResponse(
        { kind: 'essay', text: oversize },
        essayQuestion
      );
      expect(res.valid).toBe(false);
      expect(res.issues.some((i) => i.message.includes('exceeds maximum length'))).toBe(true);
    });

    it('rejects empty text when mark is answered', () => {
      const res = validateAssessmentResponse(
        { kind: 'essay', text: '' },
        essayQuestion,
        'answered'
      );
      expect(res.valid).toBe(false);
    });
  });

  describe('createEmptyResponse', () => {
    it('creates correct empty template for each question kind', () => {
      expect(createEmptyResponse(singleQuestion)).toEqual({
        kind: 'single-select',
        optionId: null,
      });
      expect(createEmptyResponse(multiQuestion)).toEqual({
        kind: 'multi-select',
        optionIds: [],
      });
      expect(createEmptyResponse(clozeQuestion)).toEqual({
        kind: 'cloze',
        answers: { b_1: '' },
      });
      expect(createEmptyResponse(shortQuestion)).toEqual({
        kind: 'short-answer',
        text: '',
      });
      expect(createEmptyResponse(essayQuestion)).toEqual({
        kind: 'essay',
        text: '',
      });
    });
  });
});
