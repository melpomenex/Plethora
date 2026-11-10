import { describe, it, expect } from 'vitest';
import {
  toPublicQuestion,
  assertNoPrivateFields,
  type PublicQuestionRevealPolicy,
} from '../publicQuestion';
import type {
  SingleSelectQuestion,
  ShortAnswerQuestion,
} from '../../../../types/assessmentQuestions';

describe('publicQuestion projection', () => {
  const singleSelect: SingleSelectQuestion = {
    schemaVersion: 1,
    kind: 'single-select',
    prompt: 'What algorithm is this?',
    difficulty: 2,
    learningObjectives: ['Learn algorithm'],
    sourceRefIds: ['src-1'],
    explanation: 'Detailed explanation of why it is Raft.',
    maxPoints: 1,
    applicationLevel: 'recall',
    hints: ['Starts with R'],
    options: [
      { id: 'opt-1', text: 'Raft' },
      { id: 'opt-2', text: 'Paxos' },
    ],
    correctOptionId: 'opt-1',
  };

  const shortAnswer: ShortAnswerQuestion = {
    schemaVersion: 1,
    kind: 'short-answer',
    prompt: 'Explain quorum.',
    difficulty: 3,
    learningObjectives: ['Define quorum'],
    sourceRefIds: ['src-1'],
    explanation: 'Quorum prevents split brain.',
    maxPoints: 2,
    applicationLevel: 'comprehension',
    hints: ['Majority count'],
    referenceAnswer: 'A strict majority (N/2 + 1) of cluster nodes.',
    keyFacts: [
      { id: 'kf-1', text: 'Strict majority required', required: true },
    ],
    acceptedAnswers: ['Majority of servers'],
    rubric: {
      schemaVersion: 1,
      criteria: [
        {
          id: 'crit-1',
          title: 'Majority Definition',
          assessmentInstruction: 'Evaluate majority understanding.',
          weight: 100,
          grounding: 'source',
          sourceRefIds: ['src-1'],
          keyFactIds: ['kf-1'],
          levels: {
            '0': 'None',
            '1': 'Vague',
            '2': 'Partial',
            '3': 'Good',
            '4': 'Strict majority formula provided',
          },
        },
      ],
      expectedConcepts: ['Quorum'],
      gradingConstraints: [],
    },
  };

  it('strictly omits private fields before submission in Exam mode', () => {
    const policy: PublicQuestionRevealPolicy = {
      mode: 'exam',
      isSubmitted: false,
    };

    const pubSingle = toPublicQuestion(singleSelect, policy);
    expect('correctOptionId' in pubSingle).toBe(false);
    expect('hints' in pubSingle).toBe(false);
    expect('explanation' in pubSingle).toBe(false);
    expect(() => assertNoPrivateFields(pubSingle)).not.toThrow();

    const pubShort = toPublicQuestion(shortAnswer, policy);
    expect('referenceAnswer' in pubShort).toBe(false);
    expect('acceptedAnswers' in pubShort).toBe(false);
    expect('keyFacts' in pubShort).toBe(false);
    expect('rubric' in pubShort).toBe(false);
    expect('hints' in pubShort).toBe(false);
    expect(() => assertNoPrivateFields(pubShort)).not.toThrow();
  });

  it('allows transparent rubric criteria titles without leaking descriptors', () => {
    const policy: PublicQuestionRevealPolicy = {
      mode: 'exam',
      isSubmitted: false,
      allowTransparentCriteria: true,
    };

    const pubShort = toPublicQuestion(shortAnswer, policy);
    expect(pubShort.kind).toBe('short-answer');
    if (pubShort.kind === 'short-answer') {
      expect(pubShort.criteria).toEqual([
        { id: 'crit-1', title: 'Majority Definition' },
      ]);
      expect('rubric' in pubShort).toBe(false);
      expect(() => assertNoPrivateFields(pubShort)).not.toThrow();
    }
  });

  it('reveals answers and explanations after submission', () => {
    const policy: PublicQuestionRevealPolicy = {
      mode: 'exam',
      isSubmitted: true,
    };

    const pubSingle = toPublicQuestion(singleSelect, policy);
    expect(pubSingle.kind).toBe('single-select');
    if (pubSingle.kind === 'single-select') {
      expect(pubSingle.correctOptionId).toBe('opt-1');
      expect(pubSingle.explanation).toBe('Detailed explanation of why it is Raft.');
    }

    const pubShort = toPublicQuestion(shortAnswer, policy);
    expect(pubShort.kind).toBe('short-answer');
    if (pubShort.kind === 'short-answer') {
      expect(pubShort.referenceAnswer).toBe('A strict majority (N/2 + 1) of cluster nodes.');
      expect(pubShort.acceptedAnswers).toEqual(['Majority of servers']);
      expect(pubShort.rubric).toBeDefined();
    }
  });

  it('assertNoPrivateFields throws if private fields are leaked', () => {
    const leaked = {
      kind: 'single-select',
      prompt: 'Test?',
      correctOptionId: 'opt-1',
    };
    expect(() => assertNoPrivateFields(leaked)).toThrow('Private field leakage detected: \'correctOptionId\'');
  });
});
