/**
 * Resumable Examination Attempt Progress Bar & Summary.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.6
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T05)
 */

import React from 'react';
import type { ResponseSlotState } from '../../../lib/study-plans/attempts/attemptController';

export interface AttemptProgressProps {
  currentIndex: number;
  totalQuestions: number;
  slots: Record<string, ResponseSlotState>;
  className?: string;
}

export const AttemptProgress: React.FC<AttemptProgressProps> = ({
  currentIndex,
  totalQuestions,
  slots,
  className = '',
}) => {
  const slotList = Object.values(slots);
  const answeredCount = slotList.filter((s) => s.mark === 'answered').length;
  const skippedCount = slotList.filter((s) => s.mark === 'skipped').length;
  const unansweredCount = Math.max(0, totalQuestions - answeredCount - skippedCount);

  const percent = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between text-xs text-on-surface-variant dark:text-on-surface-variant-dark font-medium">
        <span>
          Question <strong className="text-on-surface dark:text-on-surface-dark">{currentIndex + 1}</strong> of{' '}
          {totalQuestions}
        </span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-primary dark:bg-primary-dark" />
            {answeredCount} Answered
          </span>
          {skippedCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              {skippedCount} Skipped
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-outline-variant/60" />
            {unansweredCount} Left
          </span>
        </div>
      </div>

      {/* Accessible Progress Bar */}
      <div
        className="h-2 w-full bg-surface-container-high dark:bg-surface-container-high-dark rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Examination progress: ${percent}% completed`}
      >
        <div
          className="h-full bg-primary dark:bg-primary-dark transition-all duration-300 rounded-full"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};
