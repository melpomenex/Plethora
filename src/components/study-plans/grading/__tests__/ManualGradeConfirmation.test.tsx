import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ManualGradeConfirmation } from '../ManualGradeConfirmation';

describe('ManualGradeConfirmation', () => {
  const sampleCriteria = [
    {
      criterionId: 'crit-accuracy',
      title: 'Factual Accuracy',
      level: 3,
      weight: 2,
      pointsContribution: 4.5,
      rationale: 'Good understanding shown',
    },
    {
      criterionId: 'crit-clarity',
      title: 'Structural Clarity',
      level: 4,
      weight: 1,
      pointsContribution: 1.5,
    },
  ];

  it('renders calculated score summary and criteria breakdown', () => {
    render(
      <ManualGradeConfirmation
        questionTitle="Explain photosynthesis in C3 plants"
        calculatedPoints={6}
        maxPoints={8}
        criteria={sampleCriteria}
        manualReason="Student provided nuanced explanation with alternative phrasing."
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByText('Confirm Authoritative Manual Grade')).toBeInTheDocument();
    expect(screen.getByText('Explain photosynthesis in C3 plants')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('/ 8 pts')).toBeInTheDocument();
    expect(screen.getByText('75% of maximum points')).toBeInTheDocument();

    // Verify criteria summary
    expect(screen.getByText('Factual Accuracy')).toBeInTheDocument();
    expect(screen.getByText('Level 3/4')).toBeInTheDocument();
    expect(screen.getByText('+4.5 pts (w: 2)')).toBeInTheDocument();
    expect(screen.getByText('"Good understanding shown"')).toBeInTheDocument();

    expect(screen.getByText('Structural Clarity')).toBeInTheDocument();
    expect(screen.getByText('Level 4/4')).toBeInTheDocument();
    expect(screen.getByText('+1.5 pts (w: 1)')).toBeInTheDocument();

    // Verify manual justification
    expect(
      screen.getByText('"Student provided nuanced explanation with alternative phrasing."')
    ).toBeInTheDocument();
  });

  it('invokes onConfirm and onBack when respective buttons are clicked', () => {
    const handleConfirm = vi.fn();
    const handleBack = vi.fn();

    render(
      <ManualGradeConfirmation
        calculatedPoints={6}
        maxPoints={8}
        criteria={sampleCriteria}
        manualReason="Manual adjustment"
        onConfirm={handleConfirm}
        onBack={handleBack}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Back to Editing/i }));
    expect(handleBack).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Confirm & Commit Manual Grade/i }));
    expect(handleConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables buttons when isSubmitting is true', () => {
    render(
      <ManualGradeConfirmation
        calculatedPoints={6}
        maxPoints={8}
        criteria={sampleCriteria}
        manualReason="Manual adjustment"
        isSubmitting={true}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Saving.../i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Back to Editing/i })).toBeDisabled();
  });
});
