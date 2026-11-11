/**
 * Examination Attempt History and Longitudinal Retake Comparisons.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.8
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T07)
 */

import React from 'react';
import {
  Clock,
  Trash,
  ArrowRight,
  ArrowsCounterClockwise,
  Info,
} from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import type { AttemptSummary } from '../../../types/assessmentSessions';
import { AttemptStatusBadge } from './AttemptStatusBadge';

export interface AttemptHistoryProps {
  attempts: AttemptSummary[];
  onSelectAttempt: (attemptId: string) => void;
  onResumeAttempt?: (attemptId: string) => void;
  onRetakePaper?: (blueprintRevisionId: string) => void;
  onDeleteAttempt?: (attemptId: string) => void;
  className?: string;
}

export const AttemptHistory: React.FC<AttemptHistoryProps> = ({
  attempts,
  onSelectAttempt,
  onResumeAttempt,
  onRetakePaper,
  onDeleteAttempt,
  className = '',
}) => {
  if (attempts.length === 0) {
    return (
      <div className={`p-8 text-center text-on-surface-variant dark:text-on-surface-variant-dark ${className}`}>
        No previous examination attempts recorded.
      </div>
    );
  }

  // Calculate score delta for same blueprint revision retakes
  // attempts are sorted descending by started_at
  const attemptsWithDelta = attempts.map((att, idx) => {
    // Look for previous attempt on same blueprintRevisionId (which will appear after idx in DESC list)
    const priorAttempt = attempts.slice(idx + 1).find((a) => a.blueprintRevisionId === att.blueprintRevisionId && a.status === 'complete');
    let deltaText: string | null = null;
    let deltaPositive: boolean | null = null;

    if (att.status === 'complete' && att.awardedPoints !== null && priorAttempt && priorAttempt.awardedPoints !== null) {
      const diff = att.awardedPoints - priorAttempt.awardedPoints;
      deltaPositive = diff >= 0;
      deltaText = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} pts vs prior attempt`;
    }

    return {
      attempt: att,
      priorAttempt,
      deltaText,
      deltaPositive,
    };
  });

  return (
    <div className={`space-y-4 ${className}`} role="region" aria-label="Examination Attempt History">
      {/* Notice about memory effects on retakes */}
      <div className="flex items-center gap-2 p-3 bg-surface-container-high dark:bg-surface-container-high-dark rounded-xl text-xs text-on-surface-variant dark:text-on-surface-variant-dark border border-outline-variant/30">
        <Info size={16} className="text-primary dark:text-primary-dark shrink-0" />
        <span>Retakes on the same examination paper may include memory or familiarization effects.</span>
      </div>
      <p data-testid="history-final-only-note" className="text-xs text-on-surface-variant">
        History lists Final official scores only. Same-revision rows are same-paper comparisons with
        possible memory effects; different revisions are descriptive cross-paper history, not
        equivalent measures.
      </p>

      {/* List of attempts */}
      <div className="space-y-3">
        {attemptsWithDelta.map(({ attempt, priorAttempt, deltaText, deltaPositive }) => {
          const isComplete = attempt.status === 'complete';
          const isInProgress = attempt.status === 'in-progress';
          const dateFormatted = new Date(attempt.startedAt).toLocaleDateString([], {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });

          return (
            <div
              key={attempt.id}
              className="p-4 bg-surface dark:bg-surface-dark border border-outline-variant/30 rounded-2xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:border-outline-variant/60 transition-colors"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <span className="font-bold text-sm text-on-surface dark:text-on-surface-dark">
                    {attempt.blueprintTitle}
                  </span>
                  <AttemptStatusBadge status={attempt.status} mode={attempt.mode} />
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-on-surface-variant dark:text-on-surface-variant-dark">
                  <span className="flex items-center gap-1">
                    <Clock size={13} />
                    {dateFormatted}
                  </span>
                  <span>{attempt.questionCount} Questions</span>
                  {isComplete && attempt.awardedPoints !== null && (
                    <span className="font-bold text-on-surface dark:text-on-surface-dark">
                      Score: {attempt.awardedPoints} / {attempt.maximumPoints} pts
                    </span>
                  )}
                  {deltaText && (
                    <span
                      data-testid={
                        priorAttempt ? 'history-same-paper-delta' : 'history-cross-paper-delta'
                      }
                      className={`font-semibold ${
                        deltaPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-error'
                      }`}
                    >
                      ({deltaText}){priorAttempt ? ' · same-paper' : ' · cross-paper'}
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 self-end sm:self-center">
                {isInProgress && onResumeAttempt && (
                  <Button
                    variant="filled"
                    size="sm"
                    onClick={() => onResumeAttempt(attempt.id)}
                    className="min-h-[44px] text-xs"
                  >
                    Resume Attempt
                    <ArrowRight size={14} className="ml-1 inline" />
                  </Button>
                )}

                {isComplete && (
                  <Button
                    variant="tonal"
                    size="sm"
                    onClick={() => onSelectAttempt(attempt.id)}
                    className="min-h-[44px] text-xs"
                  >
                    View Results
                    <ArrowRight size={14} className="ml-1 inline" />
                  </Button>
                )}

                {isComplete && onRetakePaper && (
                  <Button
                    variant="outlined"
                    size="sm"
                    onClick={() => onRetakePaper(attempt.blueprintRevisionId)}
                    className="min-h-[44px] text-xs"
                    aria-label="Retake this examination paper"
                  >
                    <ArrowsCounterClockwise size={14} className="mr-1 inline" />
                    Retake
                  </Button>
                )}

                {onDeleteAttempt && (
                  <Button
                    variant="text"
                    size="iconSm"
                    onClick={() => onDeleteAttempt(attempt.id)}
                    className="min-h-[44px] min-w-[44px] text-on-surface-variant hover:text-error"
                    aria-label="Delete attempt from history"
                  >
                    <Trash size={16} />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
