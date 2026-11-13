/**
 * Study Plan state notices for capability refusal, errors, and empty library.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §2.2
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T08)
 */

import React from 'react';
import { WarningCircle, Database, BookOpen, ArrowClockwise } from '@phosphor-icons/react';
import { Button } from '../md3/Button';
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";


export interface StudyPlanStateNoticeProps {
  type: 'unsupported_platform' | 'storage_failed' | 'empty_library' | 'generic_error';
  title?: string;
  message?: string;
  onRetry?: () => void;
  onAction?: () => void;
  actionLabel?: string;
}

export const StudyPlanStateNotice: React.FC<StudyPlanStateNoticeProps> = ({
  type,
  title,
  message,
  onRetry,
  onAction,
  actionLabel,
}) => {
        useI18n();
        if (type === 'unsupported_platform') {
    return (
      <div
        role="region"
        aria-label={translateRecentFeature("studyPlans.ui.study-plans-platform-notice.3413fc82")}
        className="flex flex-col items-center justify-center p-8 max-w-lg mx-auto text-center"
      >
        <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center mb-4">
          <Database size={32} />
        </div>
        <h2 className="text-xl font-bold text-surface-900 dark:text-surface-100 mb-2">
          {title || translateRecentFeature("i18nAudit.ui.desktop-or-mobile-app-requir.c5cf8f19")}
        </h2>
        <p className="text-sm text-surface-600 dark:text-surface-400 mb-6 leading-relaxed">
          {message ||
            translateRecentFeature("i18nAudit.ui.study-plans-and-source-groun.0f62dd11")}
        </p>
      </div>
    );
  }

  if (type === 'empty_library') {
    return (
      <div
        role="region"
        aria-label={translateRecentFeature("studyPlans.ui.empty-library-notice.97fa26f2")}
        className="flex flex-col items-center justify-center p-8 max-w-md mx-auto text-center bg-surface-50 dark:bg-surface-800/50 rounded-2xl border border-surface-200 dark:border-surface-700"
      >
        <div className="w-12 h-12 rounded-full bg-primary-500/10 text-primary-500 flex items-center justify-center mb-3">
          <BookOpen size={28} />
        </div>
        <h3 className="text-base font-semibold text-surface-900 dark:text-surface-100 mb-1">
          {title || translateRecentFeature("i18nAudit.ui.no-material-in-library.c621b6f8")}
        </h3>
        <p className="text-xs text-surface-600 dark:text-surface-400 mb-4">
          {message ||
            translateRecentFeature("i18nAudit.ui.you-do-not-have-any-document.6c1c5517")}
        </p>
        {onAction && actionLabel && (
          <Button variant="tonal" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </div>
    );
  }

  // Error notice (storage_failed or generic_error)
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center p-6 max-w-md mx-auto text-center bg-red-500/5 rounded-2xl border border-red-500/20"
    >
      <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mb-3">
        <WarningCircle size={28} />
      </div>
      <h3 className="text-base font-semibold text-red-600 dark:text-red-400 mb-1">
        {title || translateRecentFeature("i18nAudit.ui.storage-error.fb70f252")}
      </h3>
      <p className="text-xs text-surface-600 dark:text-surface-400 mb-4">
        {message || translateRecentFeature("i18nAudit.ui.unable-to-communicate-with-t.7b673de8")}
      </p>
      {onRetry && (
        <Button variant="tonal" onClick={onRetry}>
          <ArrowClockwise size={16} />
          <span>{translateRecentFeature("assistant.actions.retry")}</span>
        </Button>
      )}
    </div>
  );
};
