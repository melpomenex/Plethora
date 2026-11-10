/**
 * Practice Check Rounds History List Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.7
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T06)
 */

import React from 'react';
import { CheckCircle, XCircle, Clock, WarningCircle } from '@phosphor-icons/react';
import type { ResponseSubmission, GradeRecord } from '../../../types/assessmentSessions';

export interface PracticeRoundItem {
  submission: ResponseSubmission;
  grade?: GradeRecord | null;
}

export interface PracticeRoundHistoryProps {
  rounds: PracticeRoundItem[];
  className?: string;
}

export const PracticeRoundHistory: React.FC<PracticeRoundHistoryProps> = ({
  rounds,
  className = '',
}) => {
  if (rounds.length === 0) return null;

  return (
    <div className={`space-y-3 pt-4 border-t border-outline-variant/30 ${className}`}>
      <h4 className="text-xs font-bold text-on-surface-variant dark:text-on-surface-variant-dark uppercase tracking-wider">
        Check History ({rounds.length} {rounds.length === 1 ? 'Round' : 'Rounds'})
      </h4>

      <div className="space-y-2">
        {rounds.map((round) => {
          const { submission, grade } = round;
          const isCorrect = grade?.outcome === 'correct';
          const isPartial = grade?.outcome === 'partial';
          const isIncorrect = grade?.outcome === 'incorrect';

          const timeFormatted = new Date(submission.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });

          return (
            <div
              key={submission.id}
              className="flex items-center justify-between p-3 rounded-xl bg-surface-container-low dark:bg-surface-container-low-dark border border-outline-variant/30 text-xs"
            >
              <div className="flex items-center gap-2.5">
                {isCorrect ? (
                  <CheckCircle size={18} className="text-emerald-500 shrink-0" weight="fill" />
                ) : isPartial ? (
                  <WarningCircle size={18} className="text-amber-500 shrink-0" weight="fill" />
                ) : isIncorrect ? (
                  <XCircle size={18} className="text-error shrink-0" weight="fill" />
                ) : (
                  <Clock size={18} className="text-primary dark:text-primary-dark shrink-0" />
                )}

                <div>
                  <span className="font-semibold text-on-surface dark:text-on-surface-dark block">
                    Round {submission.ordinal}
                  </span>
                  <span className="text-[11px] text-on-surface-variant dark:text-on-surface-variant-dark">
                    {timeFormatted}
                  </span>
                </div>
              </div>

              <div className="text-right">
                <span
                  className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold capitalize ${
                    isCorrect
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : isPartial
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : isIncorrect
                      ? 'bg-error/10 text-error dark:bg-error-dark/20 dark:text-error-dark'
                      : 'bg-primary/10 text-primary dark:bg-primary-dark/20 dark:text-primary-dark'
                  }`}
                >
                  {grade?.outcome || 'Checked'}
                </span>
                {grade && grade.points !== null && (
                  <span className="block text-[11px] text-on-surface-variant font-medium mt-0.5">
                    {grade.points} / {grade.maxPoints} pts
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
