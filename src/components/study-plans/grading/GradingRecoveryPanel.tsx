/**
 * Grading Recovery and Manual Review Action Banner.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.8
 * - openspec/changes/implement-rubric-based-exam-grading/tasks.md (C5-T05)
 */

import React from 'react';
import {
  Warning,
  ArrowClockwise,
  PencilSimple,
} from '@phosphor-icons/react';
import type { GradingRecoveryStatus } from '../../../lib/study-plans/grading/gradingRecovery';

export interface GradingRecoveryPanelProps {
  status: GradingRecoveryStatus;
  onRetry?: () => void;
  onManualReviewAll?: () => void;
  isRetrying?: boolean;
  className?: string;
}

export const GradingRecoveryPanel: React.FC<GradingRecoveryPanelProps> = ({
  status,
  onRetry,
  onManualReviewAll,
  isRetrying = false,
  className = '',
}) => {
  if (status.isFullyFinal) {
    return null;
  }

  const hasIssues = status.needsReviewCount > 0 || status.failedCount > 0 || status.pendingCount > 0;
  if (!hasIssues) {
    return null;
  }

  return (
    <div
      className={`p-4 sm:p-5 rounded-2xl border bg-amber-500/10 border-amber-500/30 text-on-surface space-y-3 ${className}`}
      data-testid="grading-recovery-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Warning size={20} weight="bold" className="text-amber-600 dark:text-amber-400 shrink-0" />
          <div>
            <h4 className="text-sm font-bold text-on-surface">
              Subjective Evaluation Pending Review
            </h4>
            <p className="text-xs text-on-surface-variant">
              {status.needsReviewCount > 0 && `${status.needsReviewCount} question(s) flagged for educator review. `}
              {status.failedCount > 0 && `${status.failedCount} question(s) failed automated grading. `}
              {status.pendingCount > 0 && `${status.pendingCount} question(s) pending grading. `}
              Official total points remain pending until resolved.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status.canRetry && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={isRetrying}
              className="px-3.5 py-1.5 rounded-xl bg-primary text-on-primary hover:bg-primary/90 text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-60"
            >
              <ArrowClockwise size={14} className={isRetrying ? 'animate-spin' : ''} />
              {isRetrying ? 'Retrying...' : 'Retry Failed'}
            </button>
          )}

          {status.canManualReview && onManualReviewAll && (
            <button
              type="button"
              onClick={onManualReviewAll}
              className="px-3.5 py-1.5 rounded-xl border border-primary/40 bg-surface dark:bg-surface-dark text-primary hover:bg-primary/10 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <PencilSimple size={14} weight="bold" />
              Manual Review
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
