import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GradeChallengeForm } from '../GradeChallengeForm';
import type { GradeRecord } from '../../../../types/assessmentSessions';

describe('GradeChallengeForm', () => {
  const sampleGrade: GradeRecord = {
    id: 'grade-123',
    responseSubmissionId: 'sub-456',
    questionRevisionId: 'rev-789',
    origin: 'ai',
    state: 'final',
    points: 2,
    maxPoints: 8,
    assessment: null,
    criteria: [],
    provenance: null,
    manualReason: null,
    supersedesGradeId: null,
    isCurrent: true,
    createdAt: '2026-03-30T10:00:00Z',
  };

  it('renders current award and challenge input fields', () => {
    render(
      <GradeChallengeForm
        questionTitle="Explain ATP Synthase"
        currentGrade={sampleGrade}
        onSubmitChallenge={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Request Grade Review / Challenge')).toBeInTheDocument();
    expect(screen.getByText('Explain ATP Synthase')).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 8 pts/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Grade challenge explanation/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Additional citations or references/i)).toBeInTheDocument();
  });

  it('disables submit button when explanation is empty', () => {
    render(
      <GradeChallengeForm
        currentGrade={sampleGrade}
        onSubmitChallenge={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const submitBtn = screen.getByRole('button', { name: /Submit Challenge/i });
    expect(submitBtn).toBeDisabled();
  });

  it('submits challenge successfully with trimmed payload', async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <GradeChallengeForm
        currentGrade={sampleGrade}
        onSubmitChallenge={handleSubmit}
        onClose={vi.fn()}
      />
    );

    const reasonInput = screen.getByLabelText(/Grade challenge explanation/i);
    const notesInput = screen.getByLabelText(/Additional citations or references/i);
    const submitBtn = screen.getByRole('button', { name: /Submit Challenge/i });

    fireEvent.change(reasonInput, {
      target: { value: '   My answer used the accepted biochemical synonym.   ' },
    });
    fireEvent.change(notesInput, {
      target: { value: '   See Chapter 4, page 112   ' },
    });

    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledWith({
        reason: 'My answer used the accepted biochemical synonym.',
        notes: 'See Chapter 4, page 112',
      });
    });
  });

  it('displays error alert if submission throws', async () => {
    const handleSubmit = vi.fn().mockRejectedValue(new Error('Network error during challenge'));
    render(
      <GradeChallengeForm
        currentGrade={sampleGrade}
        onSubmitChallenge={handleSubmit}
        onClose={vi.fn()}
      />
    );

    const reasonInput = screen.getByLabelText(/Grade challenge explanation/i);
    fireEvent.change(reasonInput, { target: { value: 'Valid explanation' } });

    fireEvent.click(screen.getByRole('button', { name: /Submit Challenge/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network error during challenge');
    });
  });

  it('calls onClose when cancel or close button is clicked', () => {
    const handleClose = vi.fn();
    render(
      <GradeChallengeForm
        currentGrade={sampleGrade}
        onSubmitChallenge={vi.fn()}
        onClose={handleClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Close challenge form/i }));
    expect(handleClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(handleClose).toHaveBeenCalledTimes(2);
  });
});
