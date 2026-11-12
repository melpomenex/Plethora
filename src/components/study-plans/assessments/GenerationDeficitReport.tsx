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
            <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              Quota Shortfall Detected ({accepted} of {requested} accepted)
            </h4>
            <p className="text-xs text-amber-800 dark:text-amber-200 mt-0.5">
              {accepted === 0
                ? 'No questions passed validation. Review the issues below or add a question manually.'
                : `${deficitCount} requested question${deficitCount === 1 ? '' : 's'} could not be filled.`}
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
              Retry Deficits
            </Button>
          )}

          {onAcceptShortfall && accepted > 0 && deficitCount > 0 && (
            <Button
              variant="filled"
              size="sm"
              onClick={onAcceptShortfall}
              disabled={isPublishing}
              className="text-xs bg-amber-600 hover:bg-amber-700 text-white"
            >
              <Check className="w-3.5 h-3.5 mr-1.5" />
              Accept {accepted}-Question Paper
            </Button>
          )}
        </div>
      </div>

      {/* Itemized Deficits */}
      {deficits.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-amber-900 dark:text-amber-200 block">
            Unfulfilled Slots Breakdown:
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {deficits.map((d, idx) => (
              <div
                key={`${d.kind}-${d.topicIndex}-${d.difficulty}-${idx}`}
                className="p-2 rounded bg-white/60 dark:bg-surface-800/60 border border-amber-200 dark:border-amber-800 flex items-center justify-between"
              >
                <div className="truncate">
                  <span className="font-semibold text-surface-900 dark:text-surface-100 uppercase text-[10px] mr-1.5 px-1 py-0.5 rounded bg-surface-100 dark:bg-surface-700">
                    {d.kind}
                  </span>
                  <span className="text-surface-600 dark:text-surface-300">
                    Topic {d.topicIndex + 1} (Diff {d.difficulty})
                  </span>
                </div>
                <span className="text-xs font-mono font-bold text-amber-700 dark:text-amber-300">
                  {d.count} missing
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Duplicates notice */}
      {duplicateQuestionFingerprints.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300 bg-white/40 dark:bg-surface-800/40 p-2 rounded">
          <Copy className="w-3.5 h-3.5 flex-shrink-0" />
          <span>
            {duplicateQuestionFingerprints.length} candidate{duplicateQuestionFingerprints.length === 1 ? '' : 's'} rejected as exact or near duplicates.
          </span>
        </div>
      )}

      {/* Validation issues */}
      {validationIssues.length > 0 && (
        <div className="text-xs text-amber-800 dark:text-amber-300 space-y-1">
          <span className="font-medium block">Validation Issues:</span>
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
