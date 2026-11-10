import { describe, expect, it } from 'vitest';
import {
  gradeCloze,
  gradeEssay,
  gradeMultiSelect,
  gradeQuestionObjective,
  gradeShortAnswer,
  gradeSingleSelect,
  normalizeClozeText,
  normalizeShortAnswerText,
} from '../objectiveGrading';
import type {
  ClozeQuestion,
  EssayQuestion,
  MultiSelectQuestion,
  ShortAnswerQuestion,
  SingleSelectQuestion,
} from '../../../../types/assessmentQuestions';

describe('objectiveGrading', () => {
  describe('normalization boundaries', () => {
    it('normalizes NFKC, trims, and collapses multiple whitespaces', () => {
      // Full-width characters and multi-space/newline
      const raw = '  \tHello \n\n  \tＷｏｒｌｄ  ';
      expect(normalizeClozeText(raw, false)).toBe('hello world');
      expect(normalizeClozeText(raw, true)).toBe('Hello World');
    });

    it('strictly preserves accents and diacritics without stripping', () => {
      expect(normalizeClozeText('café', false)).toBe('café');
      expect(normalizeClozeText('cafe', false)).toBe('cafe');
      expect(normalizeClozeText('café', false)).not.toBe(normalizeClozeText('cafe', false));

      // Decomposed vs precomposed unicode normalize to identical NFKC
      const precomposed = 'café';
      const decomposed = 'cafe\u0301';
      expect(normalizeClozeText(precomposed, false)).toBe(normalizeClozeText(decomposed, false));
    });

    it('strictly preserves punctuation without stripping or fuzzy matching', () => {
      expect(normalizeClozeText('NaCl (aq)', false)).toBe('nacl (aq)');
      expect(normalizeClozeText('NaCl', false)).not.toBe(normalizeClozeText('NaCl (aq)', false));
      expect(normalizeClozeText('O(n log n)', false)).toBe('o(n log n)');
    });

    it('honors case sensitivity setting', () => {
      expect(normalizeClozeText('RNA', false)).toBe('rna');
      expect(normalizeClozeText('RNA', true)).toBe('RNA');
      expect(normalizeClozeText('rna', true)).toBe('rna');
      expect(normalizeClozeText('RNA', true)).not.toBe(normalizeClozeText('rna', true));
    });
  });

  describe('Single-Select grading', () => {
    const question: SingleSelectQuestion = {
      schemaVersion: 1,
      kind: 'single-select',
      prompt: 'Q',
      difficulty: 1,
      learningObjectives: [],
      sourceRefIds: [],
      explanation: '',
      maxPoints: 2,
      applicationLevel: 'recall',
      hints: [],
      options: [
        { id: 'opt_a', text: 'A' },
        { id: 'opt_b', text: 'B' },
      ],
      correctOptionId: 'opt_a',
    };

    it('awards full points for correct option', () => {
      const res = gradeSingleSelect(
        question,
        { kind: 'single-select', optionId: 'opt_a' },
        'answered',
        'rev_1'
      );
      expect(res.points).toBe(2);
      expect(res.maxPoints).toBe(2);
      expect(res.outcome).toBe('correct');
      expect(res.state).toBe('final');
      expect(res.origin).toBe('deterministic');
    });

    it('awards 0 points for incorrect option', () => {
      const res = gradeSingleSelect(
        question,
        { kind: 'single-select', optionId: 'opt_b' },
        'answered',
        'rev_1'
      );
      expect(res.points).toBe(0);
      expect(res.outcome).toBe('incorrect');
      expect(res.state).toBe('final');
    });

    it('awards 0 points for skipped or unanswered', () => {
      const resSkip = gradeSingleSelect(
        question,
        { kind: 'single-select', optionId: null },
        'skipped',
        'rev_1'
      );
      expect(resSkip.points).toBe(0);
      expect(resSkip.outcome).toBe('skipped');

      const resUnans = gradeSingleSelect(
        question,
        { kind: 'single-select', optionId: null },
        'unanswered',
        'rev_1'
      );
      expect(resUnans.points).toBe(0);
      expect(resUnans.outcome).toBe('unanswered');
    });
  });

  describe('Multi-Select grading (all-or-nothing exact set)', () => {
    const question: MultiSelectQuestion = {
      schemaVersion: 1,
      kind: 'multi-select',
      prompt: 'Select 2',
      difficulty: 2,
      learningObjectives: [],
      sourceRefIds: [],
      explanation: '',
      maxPoints: 4,
      applicationLevel: 'comprehension',
      hints: [],
      options: [
        { id: 'm_1', text: '1' },
        { id: 'm_2', text: '2' },
        { id: 'm_3', text: '3' },
        { id: 'm_4', text: '4' },
      ],
      correctOptionIds: ['m_1', 'm_3'],
    };

    it('awards full points for exact set match in any order', () => {
      const resInOrder = gradeMultiSelect(
        question,
        { kind: 'multi-select', optionIds: ['m_1', 'm_3'] },
        'answered',
        'rev_2'
      );
      expect(resInOrder.points).toBe(4);
      expect(resInOrder.outcome).toBe('correct');

      const resReverse = gradeMultiSelect(
        question,
        { kind: 'multi-select', optionIds: ['m_3', 'm_1'] },
        'answered',
        'rev_2'
      );
      expect(resReverse.points).toBe(4);
      expect(resReverse.outcome).toBe('correct');
    });

    it('awards 0 points for partial selection (all-or-nothing)', () => {
      const resPartial = gradeMultiSelect(
        question,
        { kind: 'multi-select', optionIds: ['m_1'] },
        'answered',
        'rev_2'
      );
      expect(resPartial.points).toBe(0);
      expect(resPartial.outcome).toBe('incorrect');
    });

    it('awards 0 points for superset including wrong option', () => {
      const resExtra = gradeMultiSelect(
        question,
        { kind: 'multi-select', optionIds: ['m_1', 'm_2', 'm_3'] },
        'answered',
        'rev_2'
      );
      expect(resExtra.points).toBe(0);
      expect(resExtra.outcome).toBe('incorrect');
    });

    it('awards 0 points for completely wrong selection', () => {
      const resWrong = gradeMultiSelect(
        question,
        { kind: 'multi-select', optionIds: ['m_2', 'm_4'] },
        'answered',
        'rev_2'
      );
      expect(resWrong.points).toBe(0);
      expect(resWrong.outcome).toBe('incorrect');
    });
  });

  describe('Cloze grading (equal per-blank points)', () => {
    it('grades 1-blank cloze accurately', () => {
      const q1: ClozeQuestion = {
        schemaVersion: 1,
        kind: 'cloze',
        prompt: 'Water formula: {{blank_1}}',
        difficulty: 1,
        learningObjectives: [],
        sourceRefIds: [],
        explanation: '',
        maxPoints: 1,
        applicationLevel: 'recall',
        hints: [],
        segments: [{ kind: 'blank', blankId: 'b_1' }],
        blanks: [
          {
            id: 'b_1',
            acceptedAnswers: ['H2O', 'water'],
            caseSensitive: false,
          },
        ],
      };

      const resCorrect = gradeCloze(
        q1,
        { kind: 'cloze', answers: { b_1: 'h2o' } },
        'answered',
        'rev_c1'
      );
      expect(resCorrect.points).toBe(1);
      expect(resCorrect.outcome).toBe('correct');

      const resWrong = gradeCloze(
        q1,
        { kind: 'cloze', answers: { b_1: 'CO2' } },
        'answered',
        'rev_c1'
      );
      expect(resWrong.points).toBe(0);
      expect(resWrong.outcome).toBe('incorrect');
    });

    it('grades 4-blank cloze with equal per-blank points and partial credit', () => {
      const q4: ClozeQuestion = {
        schemaVersion: 1,
        kind: 'cloze',
        prompt: 'Blanks',
        difficulty: 2,
        learningObjectives: [],
        sourceRefIds: [],
        explanation: '',
        maxPoints: 4,
        applicationLevel: 'comprehension',
        hints: [],
        segments: [],
        blanks: [
          { id: 'b1', acceptedAnswers: ['alpha'], caseSensitive: false },
          { id: 'b2', acceptedAnswers: ['beta'], caseSensitive: false },
          { id: 'b3', acceptedAnswers: ['gamma'], caseSensitive: false },
          { id: 'b4', acceptedAnswers: ['delta'], caseSensitive: false },
        ],
      };

      // 4/4 correct
      const resAll = gradeCloze(
        q4,
        { kind: 'cloze', answers: { b1: 'alpha', b2: 'beta', b3: 'gamma', b4: 'delta' } },
        'answered',
        'rev_c4'
      );
      expect(resAll.points).toBe(4);
      expect(resAll.outcome).toBe('correct');

      // 3/4 correct -> partial (3.0 pts)
      const res3 = gradeCloze(
        q4,
        { kind: 'cloze', answers: { b1: 'alpha', b2: 'beta', b3: 'gamma', b4: 'wrong' } },
        'answered',
        'rev_c4'
      );
      expect(res3.points).toBe(3);
      expect(res3.outcome).toBe('partial');

      // 1/4 correct -> partial (1.0 pt)
      const res1 = gradeCloze(
        q4,
        { kind: 'cloze', answers: { b1: 'alpha', b2: 'wrong', b3: 'wrong', b4: 'wrong' } },
        'answered',
        'rev_c4'
      );
      expect(res1.points).toBe(1);
      expect(res1.outcome).toBe('partial');

      // 0/4 correct -> incorrect (0.0 pt)
      const res0 = gradeCloze(
        q4,
        { kind: 'cloze', answers: { b1: 'w1', b2: 'w2', b3: 'w3', b4: 'w4' } },
        'answered',
        'rev_c4'
      );
      expect(res0.points).toBe(0);
      expect(res0.outcome).toBe('incorrect');
    });

    it('grades 3-blank cloze with fractional division and precision preservation', () => {
      const q3: ClozeQuestion = {
        schemaVersion: 1,
        kind: 'cloze',
        prompt: 'Three blanks',
        difficulty: 3,
        learningObjectives: [],
        sourceRefIds: [],
        explanation: '',
        maxPoints: 1,
        applicationLevel: 'application',
        hints: [],
        segments: [],
        blanks: [
          { id: 'b1', acceptedAnswers: ['one'], caseSensitive: false },
          { id: 'b2', acceptedAnswers: ['two'], caseSensitive: false },
          { id: 'b3', acceptedAnswers: ['three'], caseSensitive: false },
        ],
      };

      // 1/3 correct
      const res1 = gradeCloze(
        q3,
        { kind: 'cloze', answers: { b1: 'one', b2: '', b3: '' } },
        'answered',
        'rev_c3'
      );
      expect(res1.points).toBeCloseTo(1 / 3, 5);
      expect(res1.outcome).toBe('partial');

      // 2/3 correct
      const res2 = gradeCloze(
        q3,
        { kind: 'cloze', answers: { b1: 'one', b2: 'two', b3: '' } },
        'answered',
        'rev_c3'
      );
      expect(res2.points).toBeCloseTo(2 / 3, 5);
      expect(res2.outcome).toBe('partial');

      // 3/3 correct
      const res3 = gradeCloze(
        q3,
        { kind: 'cloze', answers: { b1: 'one', b2: 'two', b3: 'three' } },
        'answered',
        'rev_c3'
      );
      expect(res3.points).toBe(1);
      expect(res3.outcome).toBe('correct');
    });
  });

  describe('Short-Answer deterministic grading', () => {
    const question: ShortAnswerQuestion = {
      schemaVersion: 1,
      kind: 'short-answer',
      prompt: 'What is mitochondria?',
      difficulty: 2,
      learningObjectives: [],
      sourceRefIds: [],
      explanation: '',
      maxPoints: 2,
      applicationLevel: 'recall',
      hints: [],
      referenceAnswer: 'The powerhouse of the cell',
      keyFacts: [],
      acceptedAnswers: ['powerhouse of the cell', 'cellular powerhouse'],
      rubric: {
        schemaVersion: 1,
        criteria: [],
        expectedConcepts: [],
        gradingConstraints: [],
      },
    };

    it('awards full points deterministically for accepted exact match', () => {
      const res = gradeShortAnswer(
        question,
        { kind: 'short-answer', text: '  Powerhouse of the Cell  ' },
        'answered',
        'rev_sa'
      );
      expect(res.points).toBe(2);
      expect(res.outcome).toBe('correct');
      expect(res.state).toBe('final');
      expect(res.origin).toBe('deterministic');
    });

    it('marks non-exact paraphrase as pending/needs-review for C5 AI rubric grading', () => {
      const res = gradeShortAnswer(
        question,
        { kind: 'short-answer', text: 'An organelle that generates most of the chemical energy needed by the cell.' },
        'answered',
        'rev_sa'
      );
      expect(res.points).toBeNull();
      expect(res.outcome).toBe('pending');
      expect(res.state).toBe('needs-review');
      expect(res.origin).toBe('ai');
    });

    it('awards 0 points deterministically for empty or whitespace answer', () => {
      const res = gradeShortAnswer(
        question,
        { kind: 'short-answer', text: '   \n  ' },
        'answered',
        'rev_sa'
      );
      expect(res.points).toBe(0);
      expect(res.outcome).toBe('unanswered');
      expect(res.state).toBe('final');
    });

    it('awards 0 points deterministically for skipped or unanswered mark', () => {
      const res = gradeShortAnswer(
        question,
        { kind: 'short-answer', text: 'something' },
        'skipped',
        'rev_sa'
      );
      expect(res.points).toBe(0);
      expect(res.outcome).toBe('skipped');
      expect(res.state).toBe('final');
    });
  });

  describe('Essay deterministic grading', () => {
    const question: EssayQuestion = {
      schemaVersion: 1,
      kind: 'essay',
      prompt: 'Discuss trade policy',
      difficulty: 4,
      learningObjectives: [],
      sourceRefIds: [],
      explanation: '',
      maxPoints: 8,
      applicationLevel: 'multi-step-reasoning',
      hints: [],
      expectedReasoning: 'Outline',
      rubric: {
        schemaVersion: 1,
        criteria: [],
        expectedConcepts: [],
        gradingConstraints: [],
      },
    };

    it('marks non-empty essay as pending/needs-review for C5 AI rubric grading', () => {
      const res = gradeEssay(
        question,
        { kind: 'essay', text: 'In examining 19th century trade tariffs...' },
        'answered',
        'rev_essay'
      );
      expect(res.points).toBeNull();
      expect(res.outcome).toBe('pending');
      expect(res.state).toBe('needs-review');
      expect(res.origin).toBe('ai');
    });

    it('awards 0 points deterministically for empty essay', () => {
      const res = gradeEssay(
        question,
        { kind: 'essay', text: '   ' },
        'answered',
        'rev_essay'
      );
      expect(res.points).toBe(0);
      expect(res.outcome).toBe('unanswered');
      expect(res.state).toBe('final');
    });

    it('awards 0 points deterministically for skipped essay', () => {
      const res = gradeEssay(
        question,
        { kind: 'essay', text: 'ignored' },
        'skipped',
        'rev_essay'
      );
      expect(res.points).toBe(0);
      expect(res.outcome).toBe('skipped');
      expect(res.state).toBe('final');
    });
  });

  describe('gradeQuestionObjective dispatcher', () => {
    it('dispatches to correct question grader based on kind', () => {
      const single: SingleSelectQuestion = {
        schemaVersion: 1,
        kind: 'single-select',
        prompt: 'Q',
        difficulty: 1,
        learningObjectives: [],
        sourceRefIds: [],
        explanation: '',
        maxPoints: 1,
        applicationLevel: 'recall',
        hints: [],
        options: [{ id: 'o1', text: '1' }],
        correctOptionId: 'o1',
      };
      const res = gradeQuestionObjective(
        single,
        { kind: 'single-select', optionId: 'o1' },
        'answered',
        'r1'
      );
      expect(res.outcome).toBe('correct');
      expect(res.points).toBe(1);
    });
  });
});
