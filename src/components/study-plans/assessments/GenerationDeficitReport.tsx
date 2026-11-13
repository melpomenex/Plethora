/**
 * Generation Deficit & Shortfall Report Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.4
 * - openspec/changes/generate-study-plan-examinations/ (C3-T08)
 */

import React from 'react';
import { Warning, ArrowCounterClockwise, Check, Copy } from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import { studyErrorMessageForKey } from '../../../lib/study-plans/studyErrorMessage';
import type { QuotaReport } from '../../../types/assessmentQuestions';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface GenerationDeficitReportProps {
  quotaReport: QuotaReport;
  onRetryDeficits?: () => void;
  onAcceptShortfall?: () => void;
  isRetrying?: boolean;
  canRetry?: boolean;
  isPublishing?: boolean;
  className?: string;
}

export const GenerationDeficitReport: React.FC<GenerationDeficitReportProps> = ({
  quotaReport,
  onRetryDeficits,
  onAcceptShortfall,
  isRetrying = false,
  canRetry = true,
  isPublishing = false,
  className = '',
}) => {
        useI18n();
        const { requested, accepted, deficits, duplicateQuestionFingerprints, validationIssues } =
    quotaReport;
  const deficitCount = requested - accepted;

  if (deficitCount <= 0 && duplicateQuestionFingerprints.length === 0) {
    return null;
  }

  return (
    <div
      className={`p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 space-y-4 ${className}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-2.5">
          <Warning className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-100">{translateRecentFeature("studyPlans.ui.quota-shortfall-detected-var.83959d54", {var0: accepted, var1: requested})}</h4>
            <p className="text-xs text-amber-800 dark:text-amber-200 mt-0.5">
              {accepted === 0
                ? translateRecentFeature("studyPlans.ui.no-questions-passed-validati.832fadff")
                : translateRecentFeature(deficitCount === 1 ? "studyPlans.ui.var0-requested-question-coul.0b1a4ead" : "studyPlans.ui.var0-requested-questions-cou.cfa2832b", {var0: deficitCount})}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {onRetryDeficits && (
            <Button
              variant="outlined"
              size="sm"
              onClick={onRetryDeficits}
              disabled={isRetrying || !canRetry || isPublishing}
              className="text-xs text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-700"
            >
              <ArrowCounterClockwise className={`w-3.5 h-3.5 mr-1.5 ${isRetrying ? 'animate-spin' : ''}`} />
              {translateRecentFeature("studyPlans.ui.retry-deficits.4746729d")}</Button>
          )}

          {onAcceptShortfall && accepted > 0 && deficitCount > 0 && (
            <Button
              variant="filled"
              size="sm"
              onClick={onAcceptShortfall}
              disabled={isPublishing}
              className="text-xs bg-amber-600 hover:bg-amber-700 text-white"
            >
              <Check className="w-3.5 h-3.5 mr-1.5" />{translateRecentFeature("studyPlans.ui.accept-var0-question-paper.78b23506", {var0: accepted})}</Button>
          )}
        </div>
      </div>

      {/* Itemized Deficits */}
      {deficits.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-amber-900 dark:text-amber-200 block">
            {translateRecentFeature("studyPlans.ui.unfulfilled-slots-breakdown.d19d62ef")}</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {deficits.map((d, idx) => {
                            return (
              <div
                key={`${d.kind}-${d.topicIndex}-${d.difficulty}-${idx}`}
                className="p-2 rounded bg-white/60 dark:bg-surface-800/60 border border-amber-200 dark:border-amber-800 flex items-center justify-between"
              >
                <div className="truncate">
                  <span className="font-semibold text-surface-900 dark:text-surface-100 uppercase text-[10px] mr-1.5 px-1 py-0.5 rounded bg-surface-100 dark:bg-surface-700">
                    {d.kind}
                  </span>
                  <span className="text-surface-600 dark:text-surface-300">{translateRecentFeature("studyPlans.ui.topic-var0-diff-var1.89e73a5e", {var0: d.topicIndex + 1, var1: d.difficulty})}</span>
                </div>
                <span className="text-xs font-mono font-bold text-amber-700 dark:text-amber-300">{translateRecentFeature("studyPlans.ui.var0-missing.a937646c", {var0: d.count})}</span>
              </div>
            );
            })}
          </div>
        </div>
      )}

      {/* Duplicates notice */}
      {duplicateQuestionFingerprints.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300 bg-white/40 dark:bg-surface-800/40 p-2 rounded">
          <Copy className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{translateRecentFeature(duplicateQuestionFingerprints.length === 1 ? "studyPlans.ui.var0-candidate-was-rejected-.b098e6de" : "studyPlans.ui.var0-candidates-were-rejecte.3c006b4f", {var0: duplicateQuestionFingerprints.length})}</span>
        </div>
      )}

      {/* Validation issues */}
      {validationIssues.length > 0 && (
        <div className="text-xs text-amber-800 dark:text-amber-300 space-y-1">
          <span className="font-medium block">{translateRecentFeature("studyPlans.ui.validation-issues.6f0ad08f")}</span>
          <ul className="list-disc list-inside space-y-0.5 text-[11px]">
            {validationIssues.slice(0, 4).map((iss, i) => (
              <li key={i} className="truncate">
                {studyErrorMessageForKey(iss.messageKey) ?? `${iss.path}: ${iss.code.replaceAll('_', ' ')}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
