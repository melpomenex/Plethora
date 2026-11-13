/**
 * Persistent Save and Error Status Region.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.6
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T05)
 */

import React from 'react';
import { Check, ArrowsClockwise, WarningCircle } from '@phosphor-icons/react';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface AttemptSaveStatusProps {
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  error: string | null;
  onRetry?: () => void;
  className?: string;
}

export const AttemptSaveStatus: React.FC<AttemptSaveStatusProps> = ({
  isSaving,
  hasUnsavedChanges,
  error,
  onRetry,
  className = '',
}) => {
        useI18n();
        return (
    <div
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
        error
          ? 'bg-error/10 text-error dark:bg-error-dark/20 dark:text-error-dark'
          : isSaving
          ? 'bg-primary/10 text-primary dark:bg-primary-dark/20 dark:text-primary-dark'
          : hasUnsavedChanges
          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
          : 'bg-surface-container-high dark:bg-surface-container-high-dark text-on-surface-variant dark:text-on-surface-variant-dark'
      } ${className}`}
      aria-live="polite"
    >
      {error ? (
        <>
          <WarningCircle size={14} className="shrink-0 text-error" />
          <span>{translateRecentFeature("notebooklmChat.saveFailedTitle")}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="ml-1 underline font-semibold hover:opacity-80 focus:outline-none min-h-[32px] px-1"
              aria-label={translateRecentFeature("studyPlans.ui.retry-saving-draft-response.9953dd4b")}
            >
              {translateRecentFeature("assistant.actions.retry")}</button>
          )}
        </>
      ) : isSaving ? (
        <>
          <ArrowsClockwise size={14} className="shrink-0 animate-spin" />
          <span>{translateRecentFeature("common.saving")}</span>
        </>
      ) : hasUnsavedChanges ? (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
          <span>{translateRecentFeature("extractScrollItem.unsaved")}</span>
        </>
      ) : (
        <>
          <Check size={14} className="shrink-0 text-emerald-500" />
          <span>{translateRecentFeature("extractScrollItem.saved")}</span>
        </>
      )}
    </div>
  );
};
