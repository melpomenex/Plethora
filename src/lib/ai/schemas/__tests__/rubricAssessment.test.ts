import { describe, it, expect } from 'vitest';
import { validateRubricProposal } from '../rubricAssessment';
import { isFailedOutcome } from '../common';
import type { ShortAnswerQuestion, EssayQuestion } from '../../../../types/assessmentQuestions';

describe('Rubric Assessment Schema Validator', () => {
  const shortQuestion: ShortAnswerQuestion = {
    schemaVersion: 1,
    kind: 'short-answer',
    prompt: 'Explain the function of mitochondria and ATP production.',
    difficulty: 3,
    learningObjectives: ['obj_cellular_respiration'],
    sourceRefIds: ['src_cell_bio_p42'],
    explanation: 'Mitochondria generate ATP through oxidative phosphorylation.',
    maxPoints: 4,
    applicationLevel: 'comprehension',
    hints: ['Think about cellular respiration.'],
    referenceAnswer: 'Mitochondria produce ATP through oxidative phosphorylation.',
    keyFacts: [{ id: 'kf_1', text: 'Produces ATP', required: true }],
    acceptedAnswers: ['cellular energy'],
    rubric: {
      schemaVersion: 1,
      expectedConcepts: ['mitochondria', 'ATP'],
      gradingConstraints: ['Require explanation of phosphorylation.'],
      criteria: [
        {
          id: 'crit_organelle',
          title: 'Organelle Identification',
          assessmentInstruction: 'Identifies mitochondria as the power generating organelle.',
          weight: 50,
          grounding: 'source',
          sourceRefIds: ['src_cell_bio_p42'],
          keyFactIds: ['kf_1'],
          levels: {
            '0': 'No mention of mitochondria.',
            '1': 'Vague mention of organelles.',
            '2': 'Mentions mitochondria without role.',
            '3': 'Identifies mitochondria clearly.',
            '4': 'Complete and accurate identification with role.',
          },
        },
        {
          id: 'crit_atp',
          title: 'ATP Production Mechanism',
          assessmentInstruction: 'Explains ATP synthesis via respiration.',
          weight: 50,
          grounding: 'source',
          sourceRefIds: ['src_cell_bio_p42'],
          keyFactIds: ['kf_1'],
          levels: {
            '0': 'No mention of ATP.',
            '1': 'Mentions energy vaguely.',
            '2': 'States ATP is produced.',
            '3': 'Describes cellular respiration producing ATP.',
            '4': 'Detailed mechanism of oxidative phosphorylation.',
          },
        },
      ],
    },
  };

  const studentResponse = 'The mitochondria is the cellular powerhouse that produces ATP via respiration.';

  it('validates a correct rubric proposal with exact substring evidence and valid criteria', () => {
    const validOutput = {
      schemaVersion: 1,
      assessment: {
        classification: 'correct',
        score: 0.9,
        completeness: 0.95,
        missingConcepts: [],
        feedback: 'Excellent explanation of mitochondria and ATP.',
        confidence: 0.95,
      },
      limitations: [],
      criteria: [
        {
          criterionId: 'crit_organelle',
          status: 'assessed',
          level: 4,
          answerEvidence: 'mitochondria is the cellular powerhouse',
          rationale: 'Correctly identifies mitochondria.',
          missingConcepts: [],
          sourceRefIds: ['src_cell_bio_p42'],
        },
        {
          criterionId: 'crit_atp',
          status: 'assessed',
          level: 3,
          answerEvidence: 'produces ATP via respiration',
          rationale: 'Accurately explains ATP production via respiration.',
          missingConcepts: [],
          sourceRefIds: ['src_cell_bio_p42'],
        },
      ],
    };

    const outcome = validateRubricProposal(validOutput, shortQuestion, studentResponse);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.criteria).toHaveLength(2);
      expect(outcome.value.criteria[0].status).toBe('assessed');
    }
  });

  it('rejects evidence quotes that are not an exact substring of the learner response', () => {
    const outputWithForgedQuote = {
      schemaVersion: 1,
      assessment: {
        classification: 'correct',
        score: 0.8,
        completeness: 0.8,
        missingConcepts: [],
        feedback: 'Good.',
        confidence: 0.9,
      },
      criteria: [
        {
          criterionId: 'crit_organelle',
          status: 'assessed',
          level: 4,
          answerEvidence: 'The Golgi apparatus packages proteins', // NOT in studentResponse!
          rationale: 'Fabricated answer evidence.',
          missingConcepts: [],
          sourceRefIds: ['src_cell_bio_p42'],
        },
        {
          criterionId: 'crit_atp',
          status: 'assessed',
          level: 3,
          answerEvidence: 'produces ATP via respiration',
          rationale: 'Valid.',
          missingConcepts: [],
          sourceRefIds: ['src_cell_bio_p42'],
        },
      ],
    };

    const outcome = validateRubricProposal(outputWithForgedQuote, shortQuestion, studentResponse);
    expect(outcome.ok).toBe(false);
    if (isFailedOutcome(outcome)) {
      expect(
        outcome.errors.some((e) => e.includes('not an exact substring of learner response'))
      ).toBe(true);
    }
  });

  it('rejects unknown or duplicate criterion IDs', () => {
    const outputWithDuplicate = {
      schemaVersion: 1,
      assessment: {
        classification: 'partial',
        score: 0.5,
        completeness: 0.5,
        missingConcepts: [],
        feedback: 'Partial.',
        confidence: 0.8,
      },
      criteria: [
        {
          criterionId: 'crit_organelle',
          status: 'assessed',
          level: 2,
          answerEvidence: 'mitochondria',
          rationale: 'Vague.',
          missingConcepts: [],
          sourceRefIds: ['src_cell_bio_p42'],
        },
        {
          criterionId: 'crit_organelle', // Duplicate!
          status: 'assessed',
          level: 2,
          answerEvidence: 'mitochondria',
          rationale: 'Vague again.',
          missingConcepts: [],
          sourceRefIds: ['src_cell_bio_p42'],
        },
      ],
    };

    const outcome = validateRubricProposal(outputWithDuplicate, shortQuestion, studentResponse);
    expect(outcome.ok).toBe(false);
    if (isFailedOutcome(outcome)) {
      expect(outcome.errors.some((e) => e.includes('duplicate criterion id'))).toBe(true);
    }
  });

  it('rejects omitted criteria from the committed rubric', () => {
    const outputMissingOne = {
      schemaVersion: 1,
      assessment: {
        classification: 'partial',
        score: 0.5,
        completeness: 0.5,
        missingConcepts: [],
        feedback: 'Incomplete.',
        confidence: 0.8,
      },
      criteria: [
        {
          criterionId: 'crit_organelle',
          status: 'assessed',
          level: 3,
          answerEvidence: 'mitochondria',
          rationale: 'Identified.',
          missingConcepts: [],
          sourceRefIds: ['src_cell_bio_p42'],
        },
        // crit_atp is omitted!
      ],
    };

    const outcome = validateRubricProposal(outputMissingOne, shortQuestion, studentResponse);
    expect(outcome.ok).toBe(false);
    if (isFailedOutcome(outcome)) {
      expect(outcome.errors.some((e) => e.includes('omitted expected criterion id'))).toBe(true);
    }
  });

  it('rejects forged source references not declared on the criterion', () => {
    const outputForgedSource = {
      schemaVersion: 1,
      assessment: {
        classification: 'correct',
        score: 1.0,
        completeness: 1.0,
        missingConcepts: [],
        feedback: 'Great.',
        confidence: 0.9,
      },
      criteria: [
        {
          criterionId: 'crit_organelle',
          status: 'assessed',
          level: 4,
          answerEvidence: 'mitochondria',
          rationale: 'Good.',
          missingConcepts: [],
          sourceRefIds: ['src_unauthorized_external_doc'], // Forged!
        },
        {
          criterionId: 'crit_atp',
          status: 'assessed',
          level: 4,
          answerEvidence: 'produces ATP',
          rationale: 'Good.',
          missingConcepts: [],
          sourceRefIds: ['src_cell_bio_p42'],
        },
      ],
    };

    const outcome = validateRubricProposal(outputForgedSource, shortQuestion, studentResponse);
    expect(outcome.ok).toBe(false);
    if (isFailedOutcome(outcome)) {
      expect(outcome.errors.some((e) => e.includes('forged source reference'))).toBe(true);
    }
  });

  it('rejects fractional or out-of-range rubric levels', () => {
    const outputBadLevel = {
      schemaVersion: 1,
      assessment: {
        classification: 'partial',
        score: 0.5,
        completeness: 0.5,
        missingConcepts: [],
        feedback: 'Fine.',
        confidence: 0.8,
      },
      criteria: [
        {
          criterionId: 'crit_organelle',
          status: 'assessed',
          level: 2.5, // Fractional level!
          answerEvidence: 'mitochondria',
          rationale: 'Level 2.5.',
          missingConcepts: [],
          sourceRefIds: ['src_cell_bio_p42'],
        },
        {
          criterionId: 'crit_atp',
          status: 'assessed',
          level: 5, // Out of range (>4)!
          answerEvidence: 'produces ATP',
          rationale: 'Level 5.',
          missingConcepts: [],
          sourceRefIds: ['src_cell_bio_p42'],
        },
      ],
    };

    const outcome = validateRubricProposal(outputBadLevel, shortQuestion, studentResponse);
    expect(outcome.ok).toBe(false);
  });

  it('validates not-assessable criteria status with reason', () => {
    const outputNotAssessable = {
      schemaVersion: 1,
      assessment: {
        classification: 'partial',
        score: 0.5,
        completeness: 0.5,
        missingConcepts: ['oxidative phosphorylation'],
        feedback: 'Response was partially unreadable.',
        confidence: 0.4,
      },
      criteria: [
        {
          criterionId: 'crit_organelle',
          status: 'assessed',
          level: 3,
          answerEvidence: 'mitochondria',
          rationale: 'Identified.',
          missingConcepts: [],
          sourceRefIds: ['src_cell_bio_p42'],
        },
        {
          criterionId: 'crit_atp',
          status: 'not-assessable',
          reason: 'Student answer does not contain enough text to evaluate ATP synthesis.',
        },
      ],
      limitations: ['model-capability'],
    };

    const outcome = validateRubricProposal(outputNotAssessable, shortQuestion, studentResponse);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.criteria[1].status).toBe('not-assessable');
    }
  });
});
