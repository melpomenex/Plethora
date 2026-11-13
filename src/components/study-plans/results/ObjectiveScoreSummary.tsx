/**
 * Objective Score Summary Card Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.8
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T07)
 */

import React from 'react';
import {
  CheckCircle,
  WarningCircle,
  Clock,
  Flag,
  Sparkle,
} from '@phosphor-icons/react';
import type { AttemptScoreSummary, AttemptStatus } from '../../../types/assessmentSessions';
import { AttemptStatusBadge } from './AttemptStatusBadge';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface ObjectiveScoreSummaryProps {
  scoreSummary: AttemptScoreSummary;
  status: AttemptStatus;
  startedAt: string;
  completedAt: string | null;
  className?: string;
}

export const ObjectiveScoreSummary: React.FC<ObjectiveScoreSummaryProps> = ({
  scoreSummary,
  status,
  startedAt: _startedAt,
  completedAt: _completedAt,
  className = '',
}) => {
        useI18n();
        const isComplete = status === 'complete';
  const hasPending = scoreSummary.pendingQuestions > 0;
  const maxPoints = scoreSummary.maximumPoints;

  const officialPointsFormatted =
    scoreSummary.awardedPoints !== null
      ? scoreSummary.awardedPoints.toFixed(scoreSummary.awardedPoints % 1 === 0 ? 0 : 1)
      : null;

  const percentScore =
    scoreSummary.awardedPoints !== null && maxPoints > 0
      ? Math.round((scoreSummary.awardedPoints / maxPoints) * 100)
      : null;

  const provisionalPointsFormatted = scoreSummary.provisionalObjectivePoints.toFixed(
    scoreSummary.provisionalObjectivePoints % 1 === 0 ? 0 : 1
  );

  return (
    <div
      className={`p-6 bg-surface dark:bg-surface-dark border border-outline-variant/30 rounded-2xl shadow-sm space-y-6 ${className}`}
      role="region"
      aria-label={translateRecentFeature("studyPlans.ui.examination-score-summary.5feacefb")}
    >
      {/* Top Header & Official vs Provisional Score */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-outline-variant/30">
        <div>
          <span className="text-xs font-semibold text-on-surface-variant dark:text-on-surface-variant-dark uppercase tracking-wider block mb-1">
            {translateRecentFeature("studyPlans.ui.official-examination-result.a617cf05")}</span>
          <div className="flex items-baseline gap-3">
            {isComplete && scoreSummary.awardedPoints !== null ? (
              <>
                <span className="text-3xl sm:text-4xl font-extrabold text-on-surface dark:text-on-surface-dark">
                  {officialPointsFormatted}{' '}
                  <span className="text-base sm:text-lg font-normal text-on-surface-variant">
                    / {maxPoints}
                  </span>
                </span>
                <span className="text-lg font-bold text-primary dark:text-primary-dark">
                  ({percentScore}%)
                </span>
              </>
            ) : (
              <div className="space-y-1">
                <span className="text-2xl font-bold text-on-surface dark:text-on-surface-dark">
                  {translateRecentFeature("studyPlans.ui.pending-final-evaluation.d997a47c")}</span>
                <p className="text-xs text-on-surface-variant dark:text-on-surface-variant-dark">
                  {translateRecentFeature("studyPlans.ui.official-score-will-be-final.5ab9f6db")}</p>
              </div>
            )}
          </div>
        </div>

        <AttemptStatusBadge status={status} />
      </div>

      {/* Provisional Objective Points (Always separate subtotal) */}
      <div className="p-3.5 bg-surface-container-low dark:bg-surface-container-low-dark rounded-xl border border-outline-variant/30 flex items-center justify-between text-xs">
        <span className="font-medium text-on-surface dark:text-on-surface-dark flex items-center gap-1.5">
          <Sparkle size={16} className="text-primary dark:text-primary-dark" />
          {translateRecentFeature("studyPlans.ui.provisional-objective-subtot.c1280c47")}</span>
        <span className="font-bold text-on-surface dark:text-on-surface-dark font-mono">{translateRecentFeature("studyPlans.ui.var0-pts-confirmed.2788bd98", {var0: provisionalPointsFormatted})}</span>
      </div>

      {/* Breakdown Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <div className="p-3 bg-surface-container-high/40 dark:bg-surface-container-high-dark/40 rounded-xl">
          <div className="flex items-center justify-center gap-1 text-xs text-on-surface-variant font-medium mb-1">
            <span>{translateRecentFeature("studyPlans.ui.total-questions.8e5de9a9")}</span>
          </div>
          <span className="text-lg font-bold text-on-surface dark:text-on-surface-dark">
            {scoreSummary.totalQuestions}
          </span>
        </div>

        <div className="p-3 bg-emerald-500/10 rounded-xl">
          <div className="flex items-center justify-center gap-1 text-xs text-emerald-700 dark:text-emerald-300 font-medium mb-1">
            <CheckCircle size={14} />
            <span>{translateRecentFeature("studyPlans.ui.finalized.8d41adc3")}</span>
          </div>
          <span className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
            {scoreSummary.finalQuestions}
          </span>
        </div>

        <div className="p-3 bg-primary/10 rounded-xl">
          <div className="flex items-center justify-center gap-1 text-xs text-primary dark:text-primary-dark font-medium mb-1">
            <Clock size={14} />
            <span>{translateRecentFeature("studyPlans.ui.pending-ai.13832dab")}</span>
          </div>
          <span className="text-lg font-bold text-primary dark:text-primary-dark">
            {scoreSummary.pendingQuestions}
          </span>
        </div>

        <div className="p-3 bg-surface-container-high/40 dark:bg-surface-container-high-dark/40 rounded-xl">
          <div className="flex items-center justify-center gap-1 text-xs text-on-surface-variant font-medium mb-1">
            <Flag size={14} />
            <span>{translateRecentFeature("reviewComplete.needsReview")}</span>
          </div>
          <span className="text-lg font-bold text-on-surface dark:text-on-surface-dark">
            {scoreSummary.needsReviewQuestions}
          </span>
        </div>
      </div>

      {hasPending && (
        <div className="p-3 bg-primary/10 border border-primary/20 rounded-xl text-xs text-primary dark:text-primary-dark flex items-start gap-2">
          <WarningCircle size={16} className="shrink-0 mt-0.5" />
          <span>{translateRecentFeature("studyPlans.ui.var0-question-s-require-ai-r.aa356467", {var0: scoreSummary.pendingQuestions})}</span>
        </div>
      )}
    </div>
  );
};
