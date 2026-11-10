import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ObjectiveScoreSummary } from '../ObjectiveScoreSummary';
import type { AttemptScoreSummary } from '../../../../types/assessmentSessions';

describe('ObjectiveScoreSummary Component', () => {
  it('displays official score and percentages when attempt is complete', () => {
    const summary: AttemptScoreSummary = {
      attemptId: 'att_1',
      maximumPoints: 10,
      awardedPoints: 8.5,
      provisionalObjectivePoints: 8.5,
      totalQuestions: 5,
      finalQuestions: 5,
      pendingQuestions: 0,
      needsReviewQuestions: 0,
      failedQuestions: 0,
      isFullyFinal: true,
      derivedStatus: 'complete',
    };

    render(
      <ObjectiveScoreSummary
        scoreSummary={summary}
        status="complete"
        startedAt="2026-11-10T12:00:00Z"
        completedAt="2026-11-10T12:20:00Z"
      />
    );

    expect(screen.getAllByText(/8.5/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/\/ 10/i)).toBeInTheDocument();
    expect(screen.getByText('(85%)')).toBeInTheDocument();
    expect(screen.getByText(/8.5 pts confirmed/i)).toBeInTheDocument();
  });

  it('displays pending banner and separate provisional subtotal when questions are unresolved', () => {
    const summary: AttemptScoreSummary = {
      attemptId: 'att_2',
      maximumPoints: 20,
      awardedPoints: null, // strictly null while pending
      provisionalObjectivePoints: 6.0,
      totalQuestions: 4,
      finalQuestions: 2,
      pendingQuestions: 2,
      needsReviewQuestions: 0,
      failedQuestions: 0,
      isFullyFinal: false,
      derivedStatus: 'grading',
    };

    render(
      <ObjectiveScoreSummary
        scoreSummary={summary}
        status="grading"
        startedAt="2026-11-10T12:00:00Z"
        completedAt="2026-11-10T12:30:00Z"
      />
    );

    expect(screen.getByText('Pending Final Evaluation')).toBeInTheDocument();
    expect(screen.getByText('6 pts confirmed')).toBeInTheDocument();
    expect(
      screen.getByText(/2 question\(s\) require AI rubric grading/i)
    ).toBeInTheDocument();
  });
});
