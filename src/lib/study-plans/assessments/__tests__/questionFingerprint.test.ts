import { describe, it, expect } from 'vitest';
import {
  computeQuestionFingerprint,
  computeDice3GramSimilarity,
  isNearDuplicateQuestion,
} from '../questionFingerprint';
import type { SingleSelectQuestion } from '../../../../types/assessmentQuestions';

describe('questionFingerprint', () => {
  const q1: SingleSelectQuestion = {
    schemaVersion: 1,
    kind: 'single-select',
    prompt: 'What is the consensus algorithm in Raft?',
    difficulty: 2,
    learningObjectives: ['Recall consensus'],
    sourceRefIds: ['src-1'],
    explanation: 'Raft provides state machine replication.',
    maxPoints: 1,
    applicationLevel: 'recall',
    hints: [],
    options: [
      { id: 'opt-a', text: 'State Machine Replication' },
      { id: 'opt-b', text: 'Two Phase Commit' },
    ],
    correctOptionId: 'opt-a',
  };

  it('generates deterministic 64-hex SHA-256 fingerprint', () => {
    const fp1 = computeQuestionFingerprint(q1);
    const fp2 = computeQuestionFingerprint(q1);
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('excludes correct option answer choice from fingerprint', () => {
    // If only the correctOptionId changes, fingerprint must remain unchanged
    const q1ModifiedAnswer: SingleSelectQuestion = {
      ...q1,
      correctOptionId: 'opt-b',
    };
    expect(computeQuestionFingerprint(q1ModifiedAnswer)).toBe(computeQuestionFingerprint(q1));
  });

  it('changes fingerprint when prompt or options change', () => {
    const q2: SingleSelectQuestion = {
      ...q1,
      prompt: 'What algorithm does Paxos implement?',
    };
    expect(computeQuestionFingerprint(q2)).not.toBe(computeQuestionFingerprint(q1));
  });

  describe('Dice 3-gram similarity', () => {
    it('returns 1.0 for identical strings', () => {
      const text = 'The Raft consensus algorithm is designed to be easy to understand.';
      expect(computeDice3GramSimilarity(text, text)).toBe(1.0);
    });

    it('returns high similarity for near-identical paraphrases', () => {
      const textA = 'The Raft consensus algorithm is designed to be easy to understand.';
      const textB = 'The Raft consensus algorithm is structured to be easy to understand.';
      const sim = computeDice3GramSimilarity(textA, textB);
      expect(sim).toBeGreaterThanOrEqual(0.65);
    });

    it('returns low similarity for distinct texts', () => {
      const textA = 'The Raft consensus algorithm handles leader election and log replication.';
      const textB = 'Photosynthesis converts carbon dioxide and water into glucose and oxygen.';
      const sim = computeDice3GramSimilarity(textA, textB);
      expect(sim).toBeLessThan(0.1);
    });

    it('identifies near-duplicate questions at >= 0.85 threshold', () => {
      const qDuplicate: SingleSelectQuestion = {
        ...q1,
        prompt: 'What is the consensus algorithm in Raft?',
        options: [
          { id: 'opt-1', text: 'State Machine Replication' },
          { id: 'opt-2', text: 'Two Phase Commit!' },
        ],
      };
      const result = isNearDuplicateQuestion(q1, qDuplicate);
      expect(result.isDuplicate).toBe(true);
      expect(result.similarity).toBeGreaterThanOrEqual(0.85);
    });
  });
});
