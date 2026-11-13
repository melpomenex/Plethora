/**
 * Final Examination Submission Confirmation Panel.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.6
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T05)
 */

import React from 'react';
import {
  Warning,
  CheckCircle,
  Flag,
  ArrowRight,
  ArrowLeft,
  GraduationCap,
} from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import type { ResponseSlotState } from '../../../lib/study-plans/attempts/attemptController';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface SubmitAttemptPanelProps {
  totalQuestions: number;
  slots: Record<string, ResponseSlotState>;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  submitError?: string | null;
  className?: string;
}

export const SubmitAttemptPanel: React.FC<SubmitAttemptPanelProps> = ({
  totalQuestions,
  slots,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitError = null,
  className = '',
}) => {
    useI18n();
    const slotList = Object.values(slots);
  const answeredCount = slotList.filter((s) => s.mark === 'answered').length;
  const skippedCount = slotList.filter((s) => s.mark === 'skipped').length;
  const unansweredCount = Math.max(0, totalQuestions - answeredCount - skippedCount);

  const hasIncomplete = unansweredCount > 0 || skippedCount > 0;

  return (
    <div
      className={`adaptive-dialog-panel adaptive-dialog-centered study-plans-dialog w-full max-w-lg mx-auto overflow-y-auto p-4 sm:p-6 bg-surface dark:bg-surface-dark border border-outline-variant/30 rounded-2xl shadow-xl ${className}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="submit-dialog-title"
    >
      {/* Title */}
      <div className="flex items-center gap-3 mb-5">
        <div className="p-3 bg-primary/10 text-primary dark:bg-primary-dark/20 dark:text-primary-dark rounded-xl">
          <GraduationCap size={28} />
        </div>
        <div>
          <h2 id="submit-dialog-title" className="text-lg font-bold text-on-surface dark:text-on-surface-dark">
            {translateRecentFeature("studyPlans.ui.submit-examination.12c1fa25")}</h2>
          <span className="text-xs text-on-surface-variant dark:text-on-surface-variant-dark">
            {translateRecentFeature("studyPlans.ui.review-your-completion-statu.84379783")}</span>
        </div>
      </div>

      {/* Completion Breakdown */}
      <div className="grid grid-cols-1 min-[360px]:grid-cols-3 gap-3 mb-5">
        <div className="p-3 bg-primary/10 dark:bg-primary-dark/15 border border-primary/20 rounded-xl text-center">
          <div className="flex items-center justify-center gap-1 text-primary dark:text-primary-dark text-xs mb-1 font-medium">
            <CheckCircle size={14} />
            <span>{translateRecentFeature("studyPlans.ui.answered.09d7a855")}</span>
          </div>
          <span className="text-xl font-bold text-on-surface dark:text-on-surface-dark">
            {answeredCount}
          </span>
        </div>

        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-center">
          <div className="flex items-center justify-center gap-1 text-amber-600 dark:text-amber-400 text-xs mb-1 font-medium">
            <Flag size={14} />
            <span>{translateRecentFeature("studyPlans.ui.skipped.76bc3e23")}</span>
          </div>
          <span className="text-xl font-bold text-on-surface dark:text-on-surface-dark">
            {skippedCount}
          </span>
        </div>

        <div className="p-3 bg-surface-container-high dark:bg-surface-container-high-dark border border-outline-variant/30 rounded-xl text-center">
          <div className="flex items-center justify-center gap-1 text-on-surface-variant dark:text-on-surface-variant-dark text-xs mb-1 font-medium">
            <Warning size={14} />
            <span>{translateRecentFeature("studyPlans.ui.unanswered.fd2bab1f")}</span>
          </div>
          <span className="text-xl font-bold text-on-surface dark:text-on-surface-dark">
            {unansweredCount}
          </span>
        </div>
      </div>

      {/* Incomplete Warning */}
      {hasIncomplete && (
        <div className="p-3.5 bg-amber-500/15 border border-amber-500/30 rounded-xl text-xs text-amber-800 dark:text-amber-300 mb-5 flex items-start gap-2.5">
          <Warning size={18} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div>
            <span className="font-semibold block mb-0.5">{translateRecentFeature("studyPlans.ui.unanswered-questions-remaini.2be57ee6")}</span>
            <span>{translateRecentFeature("studyPlans.ui.you-have-var0-unanswered-or-.590989e3", {var0: unansweredCount + skippedCount})}</span>
          </div>
        </div>
      )}

      {/* Error alert if submission failed */}
      {submitError && (
        <div className="p-3 bg-error/10 border border-error/30 rounded-xl text-xs text-error dark:text-error-dark mb-5">
          {submitError}
        </div>
      )}

      {/* Actions */}
      <div className="adaptive-dialog-footer flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-outline-variant/30">
        <Button
          variant="text"
          onClick={onCancel}
          disabled={isSubmitting}
          className="min-h-[44px] min-w-[44px] w-full sm:w-auto"
        >
          <ArrowLeft size={16} className="mr-1.5 inline" />
          {translateRecentFeature("studyPlans.ui.review-questions.428089b0")}</Button>

        <Button
          variant="filled"
          onClick={onSubmit}
          disabled={isSubmitting}
          className="min-h-[44px] min-w-[44px] w-full sm:w-auto px-6"
        >
          {isSubmitting ? (
            'Submitting...'
          ) : (
            <>
              {translateRecentFeature("studyPlans.ui.confirm-submit.ed6686b3")}<ArrowRight size={16} className="ml-1.5 inline" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
