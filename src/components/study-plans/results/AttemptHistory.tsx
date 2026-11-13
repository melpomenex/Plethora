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
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


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
        useI18n();
        if (attempts.length === 0) {
    return (
      <div className={`p-8 text-center text-on-surface-variant dark:text-on-surface-variant-dark ${className}`}>
        {translateRecentFeature("studyPlans.ui.no-previous-examination-atte.1ab7dcc4")}</div>
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
    <div className={`space-y-4 ${className}`} role="region" aria-label={translateRecentFeature("studyPlans.ui.examination-attempt-history.4e39940d")}>
      {/* Notice about memory effects on retakes */}
      <div className="flex items-center gap-2 p-3 bg-surface-container-high dark:bg-surface-container-high-dark rounded-xl text-xs text-on-surface-variant dark:text-on-surface-variant-dark border border-outline-variant/30">
        <Info size={16} className="text-primary dark:text-primary-dark shrink-0" />
        <span>{translateRecentFeature("studyPlans.ui.retakes-on-the-same-examinat.a6a30b55")}</span>
      </div>
      <p data-testid="history-final-only-note" className="text-xs text-on-surface-variant">
        {translateRecentFeature("studyPlans.ui.history-lists-final-official.c55fc8c3")}</p>

      {/* List of attempts */}
      <div className="space-y-3">
        {attemptsWithDelta.map(({ attempt, priorAttempt, deltaText, deltaPositive }) => {
                    const isComplete = attempt.status === 'complete';
          const isInProgress = attempt.status === 'in-progress';
          const hasResults = !isInProgress && attempt.status !== 'cancelled';
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
                  <span>{translateRecentFeature("studyPlans.ui.var0-questions.1fbbd3f3", {var0: attempt.questionCount})}</span>
                  {isComplete && attempt.awardedPoints !== null && (
                    <span className="font-bold text-on-surface dark:text-on-surface-dark">{translateRecentFeature("studyPlans.ui.score-var0-var1-pts.114d3b31", {var0: attempt.awardedPoints, var1: attempt.maximumPoints})}</span>
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
                      ({deltaText}){priorAttempt ? (" " + translateRecentFeature("studyPlans.ui.same-paper.08ed456d")) : (" " + translateRecentFeature("studyPlans.ui.cross-paper.b052d828"))}
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
                    {translateRecentFeature("studyPlans.ui.resume-attempt.fbf9bd4e")}<ArrowRight size={14} className="ml-1 inline" />
                  </Button>
                )}

                {hasResults && (
                  <Button
                    variant="tonal"
                    size="sm"
                    onClick={() => onSelectAttempt(attempt.id)}
                    className="min-h-[44px] text-xs"
                  >
                    {translateRecentFeature("studyPlans.ui.view-results.85cc15c4")}<ArrowRight size={14} className="ml-1 inline" />
                  </Button>
                )}

                {isComplete && onRetakePaper && (
                  <Button
                    variant="outlined"
                    size="sm"
                    onClick={() => onRetakePaper(attempt.blueprintRevisionId)}
                    className="min-h-[44px] text-xs"
                    aria-label={translateRecentFeature("studyPlans.ui.retake-this-examination-pape.d9bbf142")}
                  >
                    <ArrowsCounterClockwise size={14} className="mr-1 inline" />
                    {translateRecentFeature("studyPlans.ui.retake.995e4c94")}</Button>
                )}

                {onDeleteAttempt && (
                  <Button
                    variant="text"
                    size="iconSm"
                    onClick={() => onDeleteAttempt(attempt.id)}
                    className="min-h-[44px] min-w-[44px] text-on-surface-variant hover:text-error"
                    aria-label={translateRecentFeature("studyPlans.ui.delete-attempt-from-history.6eb56c6d")}
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
