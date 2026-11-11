import { describe, it, expect } from 'vitest';
import { evaluateGradeConsistency } from '../consistencyChecks';
import type { RubricGradeProposal } from '../../../../types/assessmentSessions';
import type { RubricScoreCalculation } from '../rubricAggregation';

describe('Grading Consistency Checks & Coarse Tripwires', () => {
  const baseScoreCalc: RubricScoreCalculation = {
    normalized: 0.8,
    points: 8.0,
    provisionalPoints: 8.0,
    isFullyAssessed: true,
    totalWeight: 100,
    assessedWeight: 100,
    criterionScores: [],
  };

  const baseProposal: RubricGradeProposal = {
    schemaVersion: 1,
    criteria: [
      {
        criterionId: 'c1',
        status: 'assessed',
        level: 4,
        answerEvidence: 'e1',
        rationale: 'r1',
        missingConcepts: [],
        misconception: null,
        sourceRefIds: [],
      },
    ],
    assessment: {
      classification: 'correct',
      score: 0.8,
      completeness: 0.8,
      missingConcepts: [],
      feedback: 'Good.',
      confidence: 0.9,
    },
    limitations: [],
  };

  it('passes cleanly for consistent high-score proposal', () => {
    const outcome = evaluateGradeConsistency(baseProposal, baseScoreCalc, 'short-answer');
    expect(outcome.state).toBe('final');
    expect(outcome.officialPoints).toBe(8.0);
    expect(outcome.tripwires).toHaveLength(0);
    expect(outcome.needsReviewReason).toBe(null);
  });

  it('triggers classification-mismatch tripwire when classified as correct but normalized score < 0.75', () => {
    const lowScoreCalc: RubricScoreCalculation = {
      ...baseScoreCalc,
      normalized: 0.5,
      points: 5.0,
    };

    const outcome = evaluateGradeConsistency(baseProposal, lowScoreCalc, 'short-answer');
    expect(outcome.state).toBe('needs-review');
    expect(outcome.officialPoints).toBe(null);
    expect(outcome.tripwires).toContain('classification-mismatch');
    expect(outcome.needsReviewReason).toMatch(/classification-mismatch/);
  });

  it('triggers classification-mismatch tripwire when classified as incorrect but normalized score > 0.25', () => {
    const incorrectProposal: RubricGradeProposal = {
      ...baseProposal,
      assessment: {
        ...baseProposal.assessment,
        classification: 'incorrect',
      },
    };

    const outcome = evaluateGradeConsistency(incorrectProposal, baseScoreCalc, 'short-answer');
    expect(outcome.state).toBe('needs-review');
    expect(outcome.officialPoints).toBe(null);
    expect(outcome.tripwires).toContain('classification-mismatch');
  });

  it('triggers non-reasoning-fallback tripwire for essay questions', () => {
    const fallbackProposal: RubricGradeProposal = {
      ...baseProposal,
      limitations: ['non-reasoning-fallback'],
    };

    const outcome = evaluateGradeConsistency(fallbackProposal, baseScoreCalc, 'essay');
    expect(outcome.state).toBe('needs-review');
    expect(outcome.officialPoints).toBe(null);
    expect(outcome.tripwires).toContain('non-reasoning-fallback');
  });

  it('triggers ambiguous-answer tripwire when limitation is present', () => {
    const ambiguousProposal: RubricGradeProposal = {
      ...baseProposal,
      limitations: ['ambiguous-answer'],
    };

    const outcome = evaluateGradeConsistency(ambiguousProposal, baseScoreCalc, 'short-answer');
    expect(outcome.state).toBe('needs-review');
    expect(outcome.officialPoints).toBe(null);
    expect(outcome.tripwires).toContain('ambiguous-answer');
  });

  it('triggers not-assessable-criterion tripwire when not fully assessed', () => {
    const notFullyAssessedCalc: RubricScoreCalculation = {
      ...baseScoreCalc,
      isFullyAssessed: false,
      points: null,
    };

    const outcome = evaluateGradeConsistency(baseProposal, notFullyAssessedCalc, 'short-answer');
    expect(outcome.state).toBe('needs-review');
    expect(outcome.officialPoints).toBe(null);
    expect(outcome.tripwires).toContain('not-assessable-criterion');
  });
});
