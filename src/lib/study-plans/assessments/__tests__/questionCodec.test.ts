import { describe, it, expect } from 'vitest';
import {
  encodeQuestionRevision,
  decodeQuestionRevision,
  convertModelQuestion,
} from '../questionCodec';
import type {
  SingleSelectQuestion,
  ShortAnswerQuestion,
  ModelQuestion,
  QuotaSlot,
} from '../../../../types/assessmentQuestions';

describe('questionCodec', () => {
  const sampleSingleSelect: SingleSelectQuestion = {
    schemaVersion: 1,
    kind: 'single-select',
    prompt: 'What algorithm does Raft implement?',
    difficulty: 2,
    learningObjectives: ['Identify consensus'],
    sourceRefIds: ['src-1'],
    explanation: 'Raft is a consensus algorithm.',
    maxPoints: 1,
    applicationLevel: 'recall',
    hints: ['Think of distributed state machines.'],
    options: [
      { id: 'opt-1', text: 'Consensus' },
      { id: 'opt-2', text: 'Sorting' },
    ],
    correctOptionId: 'opt-1',
  };

  const sampleShortAnswer: ShortAnswerQuestion = {
    schemaVersion: 1,
    kind: 'short-answer',
    prompt: 'How does Raft elect a new leader?',
    difficulty: 3,
    learningObjectives: ['Explain elections'],
    sourceRefIds: ['src-1'],
    explanation: 'Nodes increment term and request votes.',
    maxPoints: 2,
    applicationLevel: 'comprehension',
    hints: [],
    referenceAnswer: 'A candidate increments the current term and sends RequestVote RPCs.',
    keyFacts: [
      { id: 'kf-1', text: 'Increments term', required: true },
      { id: 'kf-2', text: 'Collects majority votes', required: true },
    ],
    acceptedAnswers: ['Candidate requests votes from peers after term increment.'],
    rubric: {
      schemaVersion: 1,
      criteria: [
        {
          id: 'crit-1',
          title: 'Term Increment',
          assessmentInstruction: 'Verify candidate increments term.',
          weight: 50,
          grounding: 'source',
          sourceRefIds: ['src-1'],
          keyFactIds: ['kf-1'],
          levels: {
            '0': 'None',
            '1': 'Vague',
            '2': 'Partial',
            '3': 'Good',
            '4': 'Complete',
          },
        },
        {
          id: 'crit-2',
          title: 'Quorum Vote',
          assessmentInstruction: 'Verify majority votes rule.',
          weight: 50,
          grounding: 'reasoning',
          sourceRefIds: [],
          keyFactIds: ['kf-2'],
          levels: {
            '0': 'None',
            '1': 'Vague',
            '2': 'Partial',
            '3': 'Good',
            '4': 'Complete',
          },
        },
      ],
      expectedConcepts: ['Term', 'RequestVote'],
      gradingConstraints: [],
    },
  };

  it('round-trips single-select question through encode and decode', () => {
    const encoded = encodeQuestionRevision(sampleSingleSelect);
    expect(encoded.rubricJson).toBeNull();

    const payload = JSON.parse(encoded.payloadJson);
    expect(payload.correctOptionId).toBeUndefined();

    const answerKey = JSON.parse(encoded.answerKeyJson);
    expect(answerKey.correctOptionId).toBe('opt-1');

    const decoded = decodeQuestionRevision(
      encoded.payloadJson,
      encoded.answerKeyJson,
      encoded.rubricJson
    );
    expect(decoded.validation.valid).toBe(true);
    expect(decoded.question).toEqual(sampleSingleSelect);
  });

  it('round-trips short-answer question through encode and decode', () => {
    const encoded = encodeQuestionRevision(sampleShortAnswer);
    expect(encoded.rubricJson).not.toBeNull();

    const payload = JSON.parse(encoded.payloadJson);
    expect(payload.referenceAnswer).toBeUndefined();
    expect(payload.keyFacts).toBeUndefined();
    expect(payload.rubric).toBeUndefined();

    const decoded = decodeQuestionRevision(
      encoded.payloadJson,
      encoded.answerKeyJson,
      encoded.rubricJson
    );
    expect(decoded.validation.valid).toBe(true);
    expect(decoded.question).toEqual(sampleShortAnswer);
  });

  it('fails closed when objective question has a non-null rubricJson', () => {
    const encoded = encodeQuestionRevision(sampleSingleSelect);
    expect(() =>
      decodeQuestionRevision(encoded.payloadJson, encoded.answerKeyJson, '{}')
    ).toThrow('unexpected_rubric_for_objective_kind');
  });

  it('fails closed when subjective question is missing rubricJson', () => {
    const encoded = encodeQuestionRevision(sampleShortAnswer);
    expect(() =>
      decodeQuestionRevision(encoded.payloadJson, encoded.answerKeyJson, null)
    ).toThrow('missing_rubric_for_subjective_kind');
  });

  it('fails closed when payload contains leaked answer keys', () => {
    const encoded = encodeQuestionRevision(sampleSingleSelect);
    const leakedPayload = JSON.stringify({
      ...JSON.parse(encoded.payloadJson),
      correctOptionId: 'opt-1',
    });
    expect(() =>
      decodeQuestionRevision(leakedPayload, encoded.answerKeyJson, null)
    ).toThrow('payload_contains_answer_key');
  });

  it('converts a model question batch item into a canonical AssessmentQuestion', () => {
    const modelQ: ModelQuestion = {
      kind: 'single-select',
      prompt: 'Which state is default for a Raft node on boot?',
      explanation: 'All nodes begin in Follower state.',
      sourceHandles: ['h_src_1'],
      applicationLevel: 'recall',
      learningObjectives: ['Recall initial Raft state'],
      hints: ['Think of the lowest privilege state.'],
      options: [
        { handle: 'h_opt_1', text: 'Follower' },
        { handle: 'h_opt_2', text: 'Leader' },
      ],
      correctOptionHandle: 'h_opt_1',
    };

    const slot: QuotaSlot = {
      slotKey: 'slot-1',
      slotIndex: 0,
      topicIndex: 0,
      kind: 'single-select',
      difficulty: 1,
    };

    const sourceMap = { h_src_1: 'ref-doc-1' };
    const converted = convertModelQuestion(modelQ, slot, sourceMap) as SingleSelectQuestion;

    expect(converted.kind).toBe('single-select');
    expect(converted.difficulty).toBe(1);
    expect(converted.sourceRefIds).toEqual(['ref-doc-1']);
    expect(converted.maxPoints).toBe(1);
    expect(converted.options).toHaveLength(2);
    expect(converted.correctOptionId).toBe(converted.options[0].id);
  });
});
