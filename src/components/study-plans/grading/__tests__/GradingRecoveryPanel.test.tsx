import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GradingRecoveryPanel } from '../GradingRecoveryPanel';
import type { GradingRecoveryStatus } from '../../../../lib/study-plans/grading/gradingRecovery';

describe('GradingRecoveryPanel', () => {
  const finalStatus: GradingRecoveryStatus = {
    totalQuestions: 5,
    finalCount: 5,
    needsReviewCount: 0,
    failedCount: 0,
    pendingCount: 0,
    isFullyFinal: true,
    canRetry: false,
    canManualReview: false,
    needsReviewSubmissionIds: [],
    failedSubmissionIds: [],
  };

  const pendingReviewStatus: GradingRecoveryStatus = {
    totalQuestions: 5,
    finalCount: 3,
    needsReviewCount: 1,
    failedCount: 1,
    pendingCount: 0,
    isFullyFinal: false,
    canRetry: true,
    canManualReview: true,
    needsReviewSubmissionIds: ['sub_review_1'],
    failedSubmissionIds: ['sub_fail_1'],
  };

  it('renders nothing when all questions are fully finalized', () => {
    const { container } = render(<GradingRecoveryPanel status={finalStatus} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders recovery alert and triggers action callbacks', () => {
    const onRetry = vi.fn();
    const onManualReview = vi.fn();

    render(
      <GradingRecoveryPanel
        status={pendingReviewStatus}
        onRetry={onRetry}
        onManualReviewAll={onManualReview}
      />
    );

    expect(screen.getByText('Subjective Evaluation Pending Review')).toBeInTheDocument();
    expect(
      screen.getByText(/1 question\(s\) flagged for educator review/)
    ).toBeInTheDocument();
    expect(screen.getByText(/1 question\(s\) failed automated grading/)).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /retry failed/i });
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);

    const reviewBtn = screen.getByRole('button', { name: /manual review/i });
    fireEvent.click(reviewBtn);
    expect(onManualReview).toHaveBeenCalledTimes(1);
  });
});
