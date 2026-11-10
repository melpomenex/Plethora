import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttemptStartConfirmation } from '../AttemptStartConfirmation';

describe('AttemptStartConfirmation Component', () => {
  it('renders exam details and triggers onStart', () => {
    const onStart = vi.fn();
    const onCancel = vi.fn();

    render(
      <AttemptStartConfirmation
        title="Genetics Final Exam"
        mode="exam"
        questionCount={25}
        totalPoints={50}
        timeLimitSeconds={3600}
        onStart={onStart}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText('Genetics Final Exam')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('60m')).toBeInTheDocument();
    expect(screen.getByText(/Examination Rules/i)).toBeInTheDocument();

    const startBtn = screen.getByRole('button', { name: /Start Examination/i });
    fireEvent.click(startBtn);
    expect(onStart).toHaveBeenCalledTimes(1);

    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders practice mode guidelines correctly', () => {
    render(
      <AttemptStartConfirmation
        title="Organic Chemistry Practice"
        mode="practice"
        questionCount={15}
        totalPoints={15}
        timeLimitSeconds={null}
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('Untimed')).toBeInTheDocument();
    expect(screen.getByText(/Practice Guidelines/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Practice/i })).toBeInTheDocument();
  });
});
