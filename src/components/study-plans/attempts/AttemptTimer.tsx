/**
 * Resumable Examination Attempt Timer Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.6
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T05)
 */

import React, { useMemo } from 'react';
import { Clock, WarningCircle } from '@phosphor-icons/react';

export interface AttemptTimerProps {
  remainingSeconds: number | null;
  className?: string;
}

export const AttemptTimer: React.FC<AttemptTimerProps> = ({
  remainingSeconds,
  className = '',
}) => {
  if (remainingSeconds === null) {
    return null; // Untimed mode
  }

  const isExpired = remainingSeconds <= 0;
  const isCritical = remainingSeconds > 0 && remainingSeconds <= 60;
  const isWarning = remainingSeconds > 60 && remainingSeconds <= 300;

  const formattedTime = useMemo(() => {
    if (isExpired) return '00:00';
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');

    if (hours > 0) {
      return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}`;
  }, [remainingSeconds, isExpired]);

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono font-medium text-sm transition-colors duration-200 ${
        isExpired
          ? 'bg-error/10 text-error dark:bg-error-dark/20 dark:text-error-dark border border-error/30'
          : isCritical
          ? 'bg-error/10 text-error dark:bg-error-dark/20 dark:text-error-dark border border-error/20 animate-pulse'
          : isWarning
          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
          : 'bg-surface-container-high dark:bg-surface-container-high-dark text-on-surface dark:text-on-surface-dark'
      } ${className}`}
      role="timer"
      aria-label={`Time remaining: ${formattedTime}`}
    >
      {isCritical || isExpired ? (
        <WarningCircle size={18} className="shrink-0" />
      ) : (
        <Clock size={18} className="shrink-0 text-on-surface-variant dark:text-on-surface-variant-dark" />
      )}
      <span aria-hidden="true">{formattedTime}</span>

      {/* Screen-reader milestone alert only (no second-by-second spam) */}
      <div className="sr-only" aria-live="polite">
        {isExpired
          ? 'Time has expired. Submitting examination.'
          : isCritical
          ? 'Less than one minute remaining.'
          : isWarning
          ? 'Less than five minutes remaining.'
          : undefined}
      </div>
    </div>
  );
};
