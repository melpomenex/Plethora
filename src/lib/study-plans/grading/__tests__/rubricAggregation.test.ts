import { describe, it, expect } from 'vitest';
import { calculateRubricScore } from '../rubricAggregation';
import type { AnalyticRubric } from '../../../../types/assessmentQuestions';
import type { CriterionJudgment } from '../../../../types/assessmentSessions';

describe('Rubric Score Aggregation Engine', () => {
  const sampleRubric: AnalyticRubric = {
    schemaVersion: 1,
    expectedConcepts: ['mitochondria', 'ATP'],
    gradingConstraints: [],
    criteria: [
      {
        id: 'crit_1',
        title: 'Criterion 1',
        assessmentInstruction: 'Instruction 1',
        weight: 50,
        grounding: 'source',
        sourceRefIds: ['src_1'],
        keyFactIds: [],
        levels: {
          '0': 'None',
          '1': 'Poor',
          '2': 'Fair',
          '3': 'Good',
          '4': 'Excellent',
        },
      },
      {
        id: 'crit_2',
        title: 'Criterion 2',
        assessmentInstruction: 'Instruction 2',
        weight: 50,
        grounding: 'reasoning',
        sourceRefIds: [],
        keyFactIds: [],
        levels: {
          '0': 'None',
          '1': 'Poor',
          '2': 'Fair',
          '3': 'Good',
          '4': 'Excellent',
        },
      },
    ],
  };

  it('matches the golden specification: equal-weight 8-point levels 4,2 -> 6.0 points', () => {
    const results: CriterionJudgment[] = [
      {
        criterionId: 'crit_1',
        status: 'assessed',
        level: 4,
        answerEvidence: 'evidence 1',
        rationale: 'Level 4 full credit',
        missingConcepts: [],
        misconception: null,
        sourceRefIds: ['src_1'],
      },
      {
        criterionId: 'crit_2',
        status: 'assessed',
        level: 2,
        answerEvidence: 'evidence 2',
        rationale: 'Level 2 half credit',
        missingConcepts: [],
        misconception: null,
        sourceRefIds: [],
      },
    ];

    const score = calculateRubricScore(sampleRubric, results, 8);

    expect(score.isFullyAssessed).toBe(true);
    // normalized = (50 * (4/4) + 50 * (2/4)) / 100 = (50 + 25) / 100 = 0.75
    expect(score.normalized).toBe(0.75);
    // points = 8 * 0.75 = 6.0
    expect(score.points).toBe(6.0);
    expect(score.provisionalPoints).toBe(6.0);
    expect(score.criterionScores[0].contributionPoints).toBe(4.0);
    expect(score.criterionScores[1].contributionPoints).toBe(2.0);
  });

  it('awards full points when all criteria receive level 4', () => {
    const results: CriterionJudgment[] = [
      {
        criterionId: 'crit_1',
        status: 'assessed',
        level: 4,
        answerEvidence: 'e1',
        rationale: 'r1',
        missingConcepts: [],
        misconception: null,
        sourceRefIds: ['src_1'],
      },
      {
        criterionId: 'crit_2',
        status: 'assessed',
        level: 4,
        answerEvidence: 'e2',
        rationale: 'r2',
        missingConcepts: [],
        misconception: null,
        sourceRefIds: [],
      },
    ];

    const score = calculateRubricScore(sampleRubric, results, 10);
    expect(score.normalized).toBe(1.0);
    expect(score.points).toBe(10.0);
  });

  it('awards zero points when all criteria receive level 0', () => {
    const results: CriterionJudgment[] = [
      {
        criterionId: 'crit_1',
        status: 'assessed',
        level: 0,
        answerEvidence: 'e1',
        rationale: 'r1',
        missingConcepts: [],
        misconception: null,
        sourceRefIds: ['src_1'],
      },
      {
        criterionId: 'crit_2',
        status: 'assessed',
        level: 0,
        answerEvidence: 'e2',
        rationale: 'r2',
        missingConcepts: [],
        misconception: null,
        sourceRefIds: [],
      },
    ];

    const score = calculateRubricScore(sampleRubric, results, 10);
    expect(score.normalized).toBe(0.0);
    expect(score.points).toBe(0.0);
  });

  it('handles unequal criteria weights correctly', () => {
    const weightedRubric: AnalyticRubric = {
      ...sampleRubric,
      criteria: [
        { ...sampleRubric.criteria[0], weight: 25 },
        { ...sampleRubric.criteria[1], weight: 75 },
      ],
    };

    const results: CriterionJudgment[] = [
      {
        criterionId: 'crit_1',
        status: 'assessed',
        level: 4, // 25 * 1.0 = 25
        answerEvidence: 'e1',
        rationale: 'r1',
        missingConcepts: [],
        misconception: null,
        sourceRefIds: ['src_1'],
      },
      {
        criterionId: 'crit_2',
        status: 'assessed',
        level: 0, // 75 * 0 = 0
        answerEvidence: 'e2',
        rationale: 'r2',
        missingConcepts: [],
        misconception: null,
        sourceRefIds: [],
      },
    ];

    // normalized = 25 / 100 = 0.25
    const score = calculateRubricScore(weightedRubric, results, 12);
    expect(score.normalized).toBe(0.25);
    expect(score.points).toBe(3.0);
  });

  it('sets official points to null when a criterion is not-assessable while providing provisional points', () => {
    const partialResults: CriterionJudgment[] = [
      {
        criterionId: 'crit_1',
        status: 'assessed',
        level: 4, // 50 * 1.0 = 50
        answerEvidence: 'e1',
        rationale: 'r1',
        missingConcepts: [],
        misconception: null,
        sourceRefIds: ['src_1'],
      },
      {
        criterionId: 'crit_2',
        status: 'not-assessable',
        reason: 'Missing evidence section',
      },
    ];

    const score = calculateRubricScore(sampleRubric, partialResults, 10);
    expect(score.isFullyAssessed).toBe(false);
    expect(score.points).toBe(null); // Official score MUST be null!
    // provisionalPoints computes from total weight: 50 / 100 * 10 = 5.0
    expect(score.provisionalPoints).toBe(5.0);
  });

  it('throws on non-positive max points', () => {
    expect(() => calculateRubricScore(sampleRubric, [], 0)).toThrow(/positive number/);
    expect(() => calculateRubricScore(sampleRubric, [], -5)).toThrow(/positive number/);
  });
});
