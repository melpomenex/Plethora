import { describe, it, expect } from 'vitest';
import {
  validateAssessmentQuestion,
  validateAssessmentResponse,
} from '../questionValidation';
import type {
  SingleSelectQuestion,
  MultiSelectQuestion,
  ClozeQuestion,
  ShortAnswerQuestion,
  EssayQuestion,
  AnalyticRubric,
  AssessmentResponse,
} from '../../../../types/assessmentQuestions';

describe('questionValidation', () => {
  const validRubric: AnalyticRubric = {
    schemaVersion: 1,
    criteria: [
      {
        id: 'crit-1',
        title: 'Core Concept Clarity',
        assessmentInstruction: 'Evaluate the explanation of Raft log replication.',
        weight: 50,
        grounding: 'source',
        sourceRefIds: ['src-1'],
        keyFactIds: ['kf-1'],
        levels: {
          '0': 'No understanding demonstrated.',
          '1': 'Vague mention of replication.',
          '2': 'Partial explanation with gaps.',
          '3': 'Accurate explanation of leader append.',
          '4': 'Complete and rigorous explanation including commit index.',
        },
      },
      {
        id: 'crit-2',
        title: 'Failure Mode Handling',
        assessmentInstruction: 'Assess understanding of network partitions.',
        weight: 50,
        grounding: 'reasoning',
        sourceRefIds: [],
        keyFactIds: [],
        levels: {
          '0': 'Ignored network partitions.',
          '1': 'Mentioned partitions without detail.',
          '2': 'Identified split-brain possibility.',
          '3': 'Explained majority quorum requirement.',
          '4': 'Comprehensive analysis of leader re-election during partition.',
        },
      },
    ],
    expectedConcepts: ['Raft', 'Quorum'],
    gradingConstraints: ['Deduct points if Byzantine faults are assumed.'],
  };

  const validSingleSelect: SingleSelectQuestion = {
    schemaVersion: 1,
    kind: 'single-select',
    prompt: 'What is the primary role of a leader in Raft?',
    difficulty: 3,
    learningObjectives: ['Understand Raft leader duties'],
    sourceRefIds: ['src-1'],
    explanation: 'The leader handles all client requests and manages log replication.',
    maxPoints: 1,
    applicationLevel: 'comprehension',
    hints: ['Think about client request routing.'],
    options: [
      { id: 'opt-a', text: 'Handles log replication and client requests' },
      { id: 'opt-b', text: 'Acts solely as a passive observer' },
      { id: 'opt-c', text: 'Initiates elections every millisecond' },
    ],
    correctOptionId: 'opt-a',
  };

  describe('Single-Select Validation', () => {
    it('validates a correct single-select question', () => {
      const result = validateAssessmentQuestion(validSingleSelect);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('rejects empty or duplicate option IDs and texts', () => {
      const invalid = {
        ...validSingleSelect,
        options: [
          { id: '', text: 'Option 1' },
          { id: 'opt-1', text: 'Option 1' },
          { id: 'opt-1', text: '   ' },
        ],
      };
      const result = validateAssessmentQuestion(invalid);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'invalid_option_id')).toBe(true);
      expect(result.issues.some((i) => i.code === 'duplicate_option_id')).toBe(true);
      expect(result.issues.some((i) => i.code === 'invalid_option_text')).toBe(true);
    });

    it('rejects unknown correctOptionId', () => {
      const invalid = {
        ...validSingleSelect,
        correctOptionId: 'opt-unknown',
      };
      const result = validateAssessmentQuestion(invalid);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'unknown_correct_option_id')).toBe(true);
    });

    it('rejects duplicate option text after normalization', () => {
      const invalid = {
        ...validSingleSelect,
        options: [
          { id: 'opt-1', text: 'Raft consensus' },
          { id: 'opt-2', text: 'raft consensus ' },
        ],
      };
      const result = validateAssessmentQuestion(invalid);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'duplicate_option_text')).toBe(true);
    });
  });

  describe('Multi-Select Validation', () => {
    const validMultiSelect: MultiSelectQuestion = {
      schemaVersion: 1,
      kind: 'multi-select',
      prompt: 'Which states can a Raft node transition to?',
      difficulty: 2,
      learningObjectives: ['Identify Raft states'],
      sourceRefIds: ['src-1'],
      explanation: 'Raft nodes can be in Follower, Candidate, or Leader states.',
      maxPoints: 1,
      applicationLevel: 'recall',
      hints: [],
      options: [
        { id: 'opt-cand', text: 'Candidate' },
        { id: 'opt-foll', text: 'Follower' },
        { id: 'opt-lead', text: 'Leader' },
        { id: 'opt-obs', text: 'Observer' },
      ],
      correctOptionIds: ['opt-cand', 'opt-foll', 'opt-lead'],
    };

    it('validates a correct multi-select question', () => {
      const result = validateAssessmentQuestion(validMultiSelect);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('rejects when correctOptionIds is not sorted', () => {
      const invalid = {
        ...validMultiSelect,
        correctOptionIds: ['opt-lead', 'opt-cand'],
      };
      const result = validateAssessmentQuestion(invalid);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'correct_options_not_sorted')).toBe(true);
    });

    it('rejects when there are no distractors', () => {
      const invalid: MultiSelectQuestion = {
        ...validMultiSelect,
        options: [
          { id: 'opt-1', text: 'First' },
          { id: 'opt-2', text: 'Second' },
        ],
        correctOptionIds: ['opt-1', 'opt-2'],
      };
      const result = validateAssessmentQuestion(invalid);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'no_distractors')).toBe(true);
    });

    it('rejects fewer than 2 correct options', () => {
      const invalid = {
        ...validMultiSelect,
        correctOptionIds: ['opt-cand'],
      };
      const result = validateAssessmentQuestion(invalid);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'invalid_correct_options_count')).toBe(true);
    });
  });

  describe('Cloze Validation', () => {
    const validCloze: ClozeQuestion = {
      schemaVersion: 1,
      kind: 'cloze',
      prompt: 'Fill in the blanks regarding consensus.',
      difficulty: 3,
      learningObjectives: ['Complete consensus blanks'],
      sourceRefIds: ['src-1'],
      explanation: 'Raft elect leaders using randomized timers.',
      maxPoints: 1,
      applicationLevel: 'recall',
      hints: [],
      segments: [
        { kind: 'text', text: 'In Raft, servers use randomized ' },
        { kind: 'blank', blankId: 'blk-1' },
        { kind: 'text', text: ' to prevent split votes during an ' },
        { kind: 'blank', blankId: 'blk-2' },
        { kind: 'text', text: '.' },
      ],
      blanks: [
        { id: 'blk-1', acceptedAnswers: ['timers', 'timeouts'], caseSensitive: false },
        { id: 'blk-2', acceptedAnswers: ['election'], caseSensitive: false },
      ],
    };

    it('validates a correct cloze question', () => {
      const result = validateAssessmentQuestion(validCloze);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('rejects adjacent blank segments without text separator', () => {
      const invalid: ClozeQuestion = {
        ...validCloze,
        segments: [
          { kind: 'blank', blankId: 'blk-1' },
          { kind: 'blank', blankId: 'blk-2' },
        ],
      };
      const result = validateAssessmentQuestion(invalid);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'adjacent_blanks')).toBe(true);
    });

    it('rejects orphan blanks not referenced in segments', () => {
      const invalid: ClozeQuestion = {
        ...validCloze,
        blanks: [
          ...validCloze.blanks,
          { id: 'blk-orphan', acceptedAnswers: ['orphan'], caseSensitive: false },
        ],
      };
      const result = validateAssessmentQuestion(invalid);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'orphan_blank_id')).toBe(true);
    });

    it('rejects when text segment leaks accepted answer verbatim', () => {
      const invalid: ClozeQuestion = {
        ...validCloze,
        segments: [
          { kind: 'text', text: 'The timers in Raft are randomized ' },
          { kind: 'blank', blankId: 'blk-1' },
          { kind: 'blank', blankId: 'blk-2' },
        ],
      };
      const result = validateAssessmentQuestion(invalid);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'cloze_answer_leakage')).toBe(true);
    });
  });

  describe('Short-Answer & Essay Validation', () => {
    const validShortAnswer: ShortAnswerQuestion = {
      schemaVersion: 1,
      kind: 'short-answer',
      prompt: 'Explain how Raft handles log discrepancies.',
      difficulty: 4,
      learningObjectives: ['Analyze log consistency'],
      sourceRefIds: ['src-1'],
      explanation: 'The leader forces followers to overwrite conflicting log entries.',
      maxPoints: 2,
      applicationLevel: 'application',
      hints: [],
      referenceAnswer: 'The leader maintains nextIndex and decrements it upon rejection until finding the match.',
      keyFacts: [
        { id: 'kf-1', text: 'Leader finds match point with follower', required: true },
        { id: 'kf-2', text: 'Leader overwrites conflicting entries', required: false },
      ],
      acceptedAnswers: ['Leader decrements nextIndex until agreement.'],
      rubric: validRubric,
    };

    it('validates a correct short-answer question', () => {
      const result = validateAssessmentQuestion(validShortAnswer);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('rejects short-answer with unmapped required key fact', () => {
      const invalid: ShortAnswerQuestion = {
        ...validShortAnswer,
        keyFacts: [
          { id: 'kf-1', text: 'Fact 1', required: true },
          { id: 'kf-unmapped', text: 'Fact 2', required: true },
        ],
      };
      const result = validateAssessmentQuestion(invalid);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'unmapped_required_key_fact')).toBe(true);
    });

    const validEssay: EssayQuestion = {
      schemaVersion: 1,
      kind: 'essay',
      prompt: 'Critically analyze safety guarantees in Raft during network partitions.',
      difficulty: 5,
      learningObjectives: ['Partition safety analysis'],
      sourceRefIds: ['src-1'],
      explanation: 'Safety is preserved through strict quorum requirements.',
      maxPoints: 8,
      applicationLevel: 'multi-step-reasoning',
      hints: [],
      expectedReasoning: 'A minority partition cannot commit entries because it lacks quorum.',
      rubric: validRubric,
    };

    it('validates a correct essay question', () => {
      const result = validateAssessmentQuestion(validEssay);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('rejects essay with maxPoints < 4', () => {
      const invalid = {
        ...validEssay,
        maxPoints: 3,
      };
      const result = validateAssessmentQuestion(invalid);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'essay_max_points_too_low')).toBe(true);
    });

    it('rejects essay with fewer than 2 rubric criteria', () => {
      const invalid: EssayQuestion = {
        ...validEssay,
        rubric: {
          ...validRubric,
          criteria: [validRubric.criteria[0]],
        },
      };
      const result = validateAssessmentQuestion(invalid);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'invalid_criteria_count')).toBe(true);
    });
  });

  describe('Hint Leakage and Oversized Fields', () => {
    it('rejects hints that equal committed answer', () => {
      const invalid: SingleSelectQuestion = {
        ...validSingleSelect,
        hints: ['Handles log replication and client requests'],
      };
      const result = validateAssessmentQuestion(invalid);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'hint_equals_answer')).toBe(true);
    });

    it('rejects oversized prompt and more than 3 hints', () => {
      const invalid: SingleSelectQuestion = {
        ...validSingleSelect,
        prompt: 'x'.repeat(2001),
        hints: ['Hint 1', 'Hint 2', 'Hint 3', 'Hint 4'],
      };
      const result = validateAssessmentQuestion(invalid);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'invalid_prompt_length')).toBe(true);
      expect(result.issues.some((i) => i.code === 'invalid_hints_count')).toBe(true);
    });
  });

  describe('Assessment Response Validation', () => {
    it('validates correct response kind and options', () => {
      const resp: AssessmentResponse = {
        kind: 'single-select',
        optionId: 'opt-a',
        confidence: 0.9,
      };
      const res = validateAssessmentResponse(validSingleSelect, resp);
      expect(res.valid).toBe(true);
    });

    it('rejects kind mismatch between response and question', () => {
      const resp: AssessmentResponse = {
        kind: 'multi-select',
        optionIds: ['opt-a'],
      };
      const res = validateAssessmentResponse(validSingleSelect, resp);
      expect(res.valid).toBe(false);
      expect(res.issues.some((i) => i.code === 'response_kind_mismatch')).toBe(true);
    });

    it('rejects invalid learner confidence values', () => {
      const resp = {
        kind: 'single-select',
        optionId: 'opt-a',
        confidence: 0.45,
      };
      const res = validateAssessmentResponse(validSingleSelect, resp);
      expect(res.valid).toBe(false);
      expect(res.issues.some((i) => i.code === 'invalid_learner_confidence')).toBe(true);
    });
  });
});
