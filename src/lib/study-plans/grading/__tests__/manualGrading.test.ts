import { describe, it, expect } from 'vitest';
import { createManualGradeRecord } from '../manualGrading';
import type { AnalyticRubric } from '../../../../types/assessmentQuestions';

describe('Manual Rubric Grading Engine', () => {
  const sampleRubric: AnalyticRubric = {
    schemaVersion: 1,
    expectedConcepts: ['mitochondria', 'ATP'],
    gradingConstraints: [],
    criteria: [
      {
        id: 'crit_1',
        title: 'Organelle Identity',
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
        title: 'Mechanism',
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

  it('creates an authoritative manual GradeRecord when all criteria and reason are provided', () => {
    const result = createManualGradeRecord(
      {
        attemptId: 'att_1',
        responseSubmissionId: 'subm_1',
        expectedAttemptRevision: 1,
        questionRevisionId: 'qrev_1',
        manualReason: 'Student demonstrated accurate understanding through alternative terminology.',
        criteria: [
          { criterionId: 'crit_1', level: 4, rationale: 'Clear identification.' },
          { criterionId: 'crit_2', level: 2, rationale: 'Partial mechanism.' },
        ],
      },
      sampleRubric,
      8
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.gradeRecord).toBeDefined();

    const record = result.gradeRecord!;
    expect(record.origin).toBe('manual');
    expect(record.state).toBe('final');
    // 50 * 1.0 + 50 * 0.5 = 75% -> 8 * 0.75 = 6.0
    expect(record.points).toBe(6.0);
    expect(record.maxPoints).toBe(8);
    expect(record.manualReason).toBe(
      'Student demonstrated accurate understanding through alternative terminology.'
    );
    expect(record.criteria).toHaveLength(2);
    expect(record.criteria[0].status).toBe('manual');
    expect(record.isCurrent).toBe(true);
  });

  it('rejects manual grade input without a nonempty manualReason', () => {
    const result = createManualGradeRecord(
      {
        attemptId: 'att_1',
        responseSubmissionId: 'subm_1',
        expectedAttemptRevision: 1,
        questionRevisionId: 'qrev_1',
        manualReason: '   ', // Blank reason!
        criteria: [
          { criterionId: 'crit_1', level: 4 },
          { criterionId: 'crit_2', level: 4 },
        ],
      },
      sampleRubric,
      8
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('nonempty reason'))).toBe(true);
  });

  it('rejects manual grade input with missing criteria', () => {
    const result = createManualGradeRecord(
      {
        attemptId: 'att_1',
        responseSubmissionId: 'subm_1',
        expectedAttemptRevision: 1,
        questionRevisionId: 'qrev_1',
        manualReason: 'Valid reason.',
        criteria: [
          { criterionId: 'crit_1', level: 4 },
          // crit_2 omitted!
        ],
      },
      sampleRubric,
      8
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('omitted expected criterion'))).toBe(true);
  });

  it('rejects manual grade input with invalid or out-of-range levels', () => {
    const result = createManualGradeRecord(
      {
        attemptId: 'att_1',
        responseSubmissionId: 'subm_1',
        expectedAttemptRevision: 1,
        questionRevisionId: 'qrev_1',
        manualReason: 'Valid reason.',
        criteria: [
          { criterionId: 'crit_1', level: 5 as any }, // Level 5 > 4
          { criterionId: 'crit_2', level: 2 },
        ],
      },
      sampleRubric,
      8
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('integer between 0 and 4'))).toBe(true);
  });
});
