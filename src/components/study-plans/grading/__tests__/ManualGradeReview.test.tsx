import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ManualGradeReview } from '../ManualGradeReview';
import type { AssessmentQuestionRevision } from '../../../../types/assessmentQuestions';
import type { GradeRecord, GradeSettlementOutcome } from '../../../../types/assessmentSessions';

describe('ManualGradeReview', () => {
  const sampleQuestionRevision: AssessmentQuestionRevision = {
    id: 'rev-q1',
    blueprintQuestionId: 'bq-1',
    revisionNumber: 1,
    createdAt: '2026-03-30T10:00:00Z',
    question: {
      schemaVersion: 1,
      kind: 'essay',
      prompt: 'Explain the mechanism of ATP synthase.',
      learningObjectives: [],
      explanation: 'Mechanism of ATP synthase involves rotary catalysis.',
      applicationLevel: 'recall',
      hints: [],
      difficulty: 3,
      maxPoints: 8,
      sourceRefIds: ['src-bio'],
      expectedReasoning: 'Proton gradient drives the F0 rotor subunit.',
      rubric: {
        schemaVersion: 1,
        expectedConcepts: ['proton gradient', 'rotor'],
        gradingConstraints: [],
        criteria: [
          {
            id: 'crit-gradient',
            title: 'Proton Gradient Concept',
            assessmentInstruction: 'Evaluate understanding of proton gradient.',
            weight: 2,
            grounding: 'reasoning',
            sourceRefIds: [],
            keyFactIds: [],
            levels: {
              '0': 'No mention of gradient.',
              '1': 'Vague mention.',
              '2': 'Partially explained.',
              '3': 'Clearly explained.',
              '4': 'Thoroughly detailed electrochemical gradient.',
            },
          },
          {
            id: 'crit-mechanical',
            title: 'Rotary Mechanism',
            assessmentInstruction: 'Evaluate understanding of rotary subunit.',
            weight: 2,
            grounding: 'reasoning',
            sourceRefIds: [],
            keyFactIds: [],
            levels: {
              '0': 'No rotary mechanism mentioned.',
              '1': 'Mentions rotation without subunit details.',
              '2': 'Explains rotation of rotor.',
              '3': 'Accurately explains conformational changes.',
              '4': 'Complete structural and conformational analysis.',
            },
          },
        ],
      },
    },
  };

  const sampleExistingGrade: GradeRecord = {
    id: 'grade-ai-1',
    responseSubmissionId: 'sub-1',
    questionRevisionId: 'rev-q1',
    origin: 'ai',
    state: 'needs-review',
    points: 4,
    maxPoints: 8,
    assessment: {
      classification: 'partial',
      score: 0.5,
      completeness: 0.5,
      confidence: 0.85,
      missingConcepts: ['rotary mechanism'],
      feedback: 'Good description of proton gradient but missed rotary motion details.',
    },
    criteria: [
      {
        criterionId: 'crit-gradient',
        status: 'assessed',
        level: 3,
        answerEvidence: 'Protons flow down',
        rationale: 'Identified electrochemical gradient',
        missingConcepts: [],
        misconception: null,
        sourceRefIds: [],
      },
    ],
    provenance: {
      taskId: 'study-rubric-grade',
      providerId: 'ollama',
      baseModelName: 'qwen2.5:7b',
      endpointLocality: 'loopback',
      requestedModelClass: 'reasoning',
      servedModelClass: 'reasoning',
      fallbackPath: 'none',
      validationOutcome: 'valid',
      promptContractVersion: 'study-ai-v1',
    },
    manualReason: null,
    supersedesGradeId: null,
    isCurrent: true,
    createdAt: '2026-03-30T10:05:00Z',
  };

  it('renders prompt, student response verbatim, and rubric criteria', () => {
    render(
      <ManualGradeReview
        isOpen={true}
        attemptId="att-100"
        responseSubmissionId="sub-1"
        expectedAttemptRevision={2}
        questionRevision={sampleQuestionRevision}
        studentResponse="Protons flow down the electrochemical gradient, turning the rotor subunit."
        sourceContext="Biology 101 Chapter 5"
        existingGrade={sampleExistingGrade}
        onClose={vi.fn()}
        onGradeRecorded={vi.fn()}
      />
    );

    expect(screen.getByText('Manual Grade Review & Override')).toBeInTheDocument();
    expect(screen.getByText('Explain the mechanism of ATP synthase.')).toBeInTheDocument();
    expect(
      screen.getByText('Protons flow down the electrochemical gradient, turning the rotor subunit.')
    ).toBeInTheDocument();
    expect(screen.getByText(/Biology 101 Chapter 5/)).toBeInTheDocument();
    expect(screen.getByText('Proton Gradient Concept')).toBeInTheDocument();
    expect(screen.getByText('Rotary Mechanism')).toBeInTheDocument();

    // AI advisory note
    expect(
      screen.getByText(/Previous automated evaluation is advisory. Human manual grading takes precedence./i)
    ).toBeInTheDocument();
  });

  it('validates missing criterion levels and empty manualReason before confirmation', () => {
    render(
      <ManualGradeReview
        isOpen={true}
        attemptId="att-100"
        responseSubmissionId="sub-1"
        expectedAttemptRevision={2}
        questionRevision={sampleQuestionRevision}
        studentResponse="Sample response"
        existingGrade={null}
        onClose={vi.fn()}
        onGradeRecorded={vi.fn()}
      />
    );

    // Attempt to proceed without selecting levels or typing reason
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Confirmation/i }));

    expect(
      screen.getByText('Please select all criterion levels and provide a justification.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('A justification or reason is required for manual grading.')
    ).toBeInTheDocument();
  });

  it('recalculates projected score dynamically and allows proceeding to confirmation', () => {
    render(
      <ManualGradeReview
        isOpen={true}
        attemptId="att-100"
        responseSubmissionId="sub-1"
        expectedAttemptRevision={2}
        questionRevision={sampleQuestionRevision}
        studentResponse="Sample response"
        existingGrade={null}
        onClose={vi.fn()}
        onGradeRecorded={vi.fn()}
      />
    );

    // Select Level 4 for Gradient (weight 2 of 4 = 50% * 4/4 * 8 = 4 pts)
    fireEvent.click(
      screen.getByLabelText('Level 4: Thoroughly detailed electrochemical gradient.')
    );

    // Select Level 2 for Mechanical (weight 2 of 4 = 50% * 2/4 * 8 = 2 pts)
    fireEvent.click(
      screen.getByLabelText('Level 2: Explains rotation of rotor.')
    );

    // Score should be 4 + 2 = 6 pts
    expect(screen.getByText('6 / 8 pts')).toBeInTheDocument();

    // Enter required justification
    fireEvent.change(screen.getByTestId('manual-reason-input'), {
      target: { value: 'Mechanisms accurately described.' },
    });

    // Proceed to confirmation
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Confirmation/i }));

    expect(screen.getByTestId('manual-grade-confirmation')).toBeInTheDocument();
    expect(screen.getByText('Confirm Authoritative Manual Grade')).toBeInTheDocument();
    expect(screen.getByText('"Mechanisms accurately described."')).toBeInTheDocument();

    // Click back to return to edit mode
    fireEvent.click(screen.getByRole('button', { name: /Back to Editing/i }));
    expect(screen.getByTestId('manual-grade-review-modal')).toBeInTheDocument();
  });

  it('commits manual grade successfully via recordManualGradeFn and notifies caller', async () => {
    const mockOutcome: GradeSettlementOutcome = {
      gradeId: 'grade-manual-1',
      isCurrent: true,
      supersedesGradeId: 'grade-ai-1',
      attemptStatus: 'complete',
      attemptAwardedPoints: 8,
      attemptRevision: 3,
    };

    const mockRecordManual = vi.fn().mockResolvedValue(mockOutcome);
    const handleGradeRecorded = vi.fn();
    const handleClose = vi.fn();

    render(
      <ManualGradeReview
        isOpen={true}
        attemptId="att-100"
        responseSubmissionId="sub-1"
        expectedAttemptRevision={2}
        questionRevision={sampleQuestionRevision}
        studentResponse="Sample response"
        existingGrade={sampleExistingGrade}
        onClose={handleClose}
        onGradeRecorded={handleGradeRecorded}
        recordManualGradeFn={mockRecordManual}
      />
    );

    // Existing grade already prefilled crit-gradient level 3
    // Select level 4 for crit-mechanical
    fireEvent.click(
      screen.getByLabelText('Level 4: Complete structural and conformational analysis.')
    );

    // Enter manual justification
    fireEvent.change(screen.getByTestId('manual-reason-input'), {
      target: { value: 'Full credit given after educator review.' },
    });

    // Advance to confirmation
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Confirmation/i }));

    // Click confirm & commit
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Commit Manual Grade/i }));

    await waitFor(() => {
      expect(mockRecordManual).toHaveBeenCalledWith({
        attemptId: 'att-100',
        responseSubmissionId: 'sub-1',
        questionRevisionId: 'rev-q1',
        expectedAttemptRevision: 2,
        manualReason: 'Full credit given after educator review.',
        criteria: [
          {
            criterionId: 'crit-gradient',
            level: 3,
            rationale: 'Identified electrochemical gradient',
          },
          {
            criterionId: 'crit-mechanical',
            level: 4,
            rationale: null,
          },
        ],
        feedback: 'Good description of proton gradient but missed rotary motion details.',
      });
      expect(handleGradeRecorded).toHaveBeenCalledWith(mockOutcome);
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it('handles concurrent stale revision conflict and displays warning', async () => {
    const staleError = new Error('stale_attempt_revision: Expected revision 2, found 3');
    (staleError as any).code = 'stale_attempt_revision';
    const mockRecordManual = vi.fn().mockRejectedValue(staleError);

    render(
      <ManualGradeReview
        isOpen={true}
        attemptId="att-100"
        responseSubmissionId="sub-1"
        expectedAttemptRevision={2}
        questionRevision={sampleQuestionRevision}
        studentResponse="Sample response"
        existingGrade={sampleExistingGrade}
        onClose={vi.fn()}
        onGradeRecorded={vi.fn()}
        recordManualGradeFn={mockRecordManual}
      />
    );

    // Fill level 4 for mechanical
    fireEvent.click(
      screen.getByLabelText('Level 4: Complete structural and conformational analysis.')
    );

    // Fill reason
    fireEvent.change(screen.getByTestId('manual-reason-input'), {
      target: { value: 'Educator manual update' },
    });

    // Proceed to confirmation
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Confirmation/i }));

    // Commit
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Commit Manual Grade/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/The attempt was modified concurrently. Please reload results/i)
      ).toBeInTheDocument();
    });
  });
});
