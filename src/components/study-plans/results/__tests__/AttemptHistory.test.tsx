import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttemptHistory } from '../AttemptHistory';
import type { AttemptSummary } from '../../../../types/assessmentSessions';

describe('AttemptHistory Component', () => {
  it('renders attempt list, memory effect notice, and longitudinal deltas', () => {
    const attempts: AttemptSummary[] = [
      {
        id: 'att_2',
        blueprintRevisionId: 'bpr_1',
        blueprintId: 'bp_1',
        blueprintTitle: 'Cell Biology Exam',
        mode: 'exam',
        status: 'complete',
        startedAt: '2026-11-10T14:00:00Z',
        deadlineAt: null,
        completedAt: '2026-11-10T14:25:00Z',
        awardedPoints: 10,
        maximumPoints: 10,
        questionCount: 5,
      },
      {
        id: 'att_1',
        blueprintRevisionId: 'bpr_1',
        blueprintId: 'bp_1',
        blueprintTitle: 'Cell Biology Exam',
        mode: 'exam',
        status: 'complete',
        startedAt: '2026-11-10T12:00:00Z',
        deadlineAt: null,
        completedAt: '2026-11-10T12:30:00Z',
        awardedPoints: 7,
        maximumPoints: 10,
        questionCount: 5,
      },
    ];

    const onSelectAttempt = vi.fn();
    const onRetakePaper = vi.fn();

    render(
      <AttemptHistory
        attempts={attempts}
        onSelectAttempt={onSelectAttempt}
        onRetakePaper={onRetakePaper}
      />
    );

    // Memory effect notice must be present
    expect(
      screen.getByText(/Retakes on the same examination paper may include memory or familiarization effects/i)
    ).toBeInTheDocument();

    // Delta calculation (+3.0 pts vs prior attempt)
    expect(screen.getByText(/\(\+3.0 pts vs prior attempt\)/i)).toBeInTheDocument();

    const viewButtons = screen.getAllByRole('button', { name: /View Results/i });
    expect(viewButtons).toHaveLength(2);
    fireEvent.click(viewButtons[0]);
    expect(onSelectAttempt).toHaveBeenCalledWith('att_2');

    const retakeButtons = screen.getAllByRole('button', { name: /Retake this examination paper/i });
    fireEvent.click(retakeButtons[0]);
    expect(onRetakePaper).toHaveBeenCalledWith('bpr_1');
  });
});
