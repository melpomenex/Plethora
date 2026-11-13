import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RubricResult } from '../RubricResult';
import type { ShortAnswerQuestion } from '../../../../types/assessmentQuestions';
import type { GradeRecord } from '../../../../types/assessmentSessions';

describe('RubricResult', () => {
  const mockQuestion: ShortAnswerQuestion = {
    schemaVersion: 1,
    kind: 'short-answer',
    prompt: 'How does the sodium-potassium pump work?',
    maxPoints: 4,
    sourceRefIds: ['src_cell_bio_p42'],
    difficulty: 3,
    applicationLevel: 'comprehension',
    hints: [],
    explanation: 'Pump moves 3 Na+ out and 2 K+ in per ATP consumed.',
    learningObjectives: [],
    referenceAnswer: 'It pumps 3 Na+ ions out of the cell and 2 K+ ions into the cell using 1 ATP.',
    keyFacts: [],
    acceptedAnswers: [],
    rubric: {
      schemaVersion: 1,
      expectedConcepts: ['Na+', 'K+', 'ATP'],
      gradingConstraints: [],
      criteria: [
        {
          id: 'crit_ions',
          title: 'Ion Stoichiometry',
          assessmentInstruction: 'Evaluate correct numbers of Na and K ions',
          grounding: 'reasoning',
          sourceRefIds: [],
          keyFactIds: [],
          weight: 1,
          levels: {
            '0': 'Incorrect numbers.',
            '1': 'Vague mention.',
            '2': 'Partial stoichiometry.',
            '3': '3 Na or 2 K correct.',
            '4': 'Exactly 3 Na+ out and 2 K+ in.',
          },
        },
      ],
    },
  };

  const mockFinalGrade: GradeRecord = {
    id: 'grd_1',
    responseSubmissionId: 'sub_1',
    questionRevisionId: 'q_1',
    origin: 'ai',
    state: 'final',
    points: 4,
    maxPoints: 4,
    assessment: {
      classification: 'correct',
      score: 1.0,
      completeness: 1.0,
      confidence: 0.95,
      feedback: 'Excellent explanation of ion movement and energy utilization.',
      missingConcepts: [],
    },
    criteria: [
      {
        criterionId: 'crit_ions',
        status: 'assessed',
        level: 4,
        answerEvidence: '3 sodium out and 2 potassium in',
        rationale: 'Fully accurate stoichiometry stated.',
        missingConcepts: [],
        misconception: null,
        sourceRefIds: [],
      },
    ],
    provenance: {
      taskId: 'study-rubric-grade',
      providerId: 'local',
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
    createdAt: '2026-11-10T12:00:00Z',
  };

  it('renders final rubric grade with points, feedback, and criteria', () => {
    render(<RubricResult question={mockQuestion} grade={mockFinalGrade} />);

    expect(screen.getByText('Rubric Assessment')).toBeInTheDocument();
    expect(screen.getByText('Final')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('/ 4 pts')).toBeInTheDocument();
    expect(
      screen.getByText('Excellent explanation of ion movement and energy utilization.')
    ).toBeInTheDocument();
    expect(screen.getByText('Ion Stoichiometry')).toBeInTheDocument();
    expect(screen.getByText('“3 sodium out and 2 potassium in”')).toBeInTheDocument();
  });

  it('handles needs-review state and fires manual review callback', () => {
    const onManualReview = vi.fn();

    const needsReviewGrade: GradeRecord = {
      ...mockFinalGrade,
      state: 'needs-review',
      points: null,
    };

    render(
      <RubricResult
        question={mockQuestion}
        grade={needsReviewGrade}
        onManualReviewClick={onManualReview}
      />
    );

    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText('(Awaiting Review)')).toBeInTheDocument();

    const reviewBtn = screen.getByRole('button', { name: /manual review/i });
    expect(reviewBtn).toBeInTheDocument();
    fireEvent.click(reviewBtn);
    expect(onManualReview).toHaveBeenCalledTimes(1);
  });

  it('renders grade history accordion when multiple grade entries are passed', () => {
    const historicalGrade: GradeRecord = {
      ...mockFinalGrade,
      id: 'grd_old',
      isCurrent: false,
      points: 2,
    };

    render(
      <RubricResult
        question={mockQuestion}
        grade={mockFinalGrade}
        history={[historicalGrade, mockFinalGrade]}
      />
    );

    const historyBtn = screen.getByRole('button', { name: /evaluation history/i });
    expect(historyBtn).toBeInTheDocument();
    fireEvent.click(historyBtn);

    expect(screen.getByText('CURRENT')).toBeInTheDocument();
    expect(screen.getByText('2/4 pts')).toBeInTheDocument();
  });
});
