/**
 * Attempt Status and Mode Badges.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.8
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T07)
 */

import React from 'react';
import type { AttemptStatus } from '../../../types/assessmentSessions';
import type { AssessmentMode } from '../../../types/assessmentQuestions';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface AttemptStatusBadgeProps {
  status: AttemptStatus;
  mode?: AssessmentMode;
  className?: string;
}

export const AttemptStatusBadge: React.FC<AttemptStatusBadgeProps> = ({
  status,
  mode,
  className = '',
}) => {
  useI18n();
  const getStatusConfig = (st: AttemptStatus) => {
        switch (st) {
      case 'complete':
        return {
          label: translateRecentFeature("studyPlans.ui.completed.b0775abf"),
          bg: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
        };
      case 'in-progress':
        return {
          label: translateRecentFeature("studyPlans.ui.in-progress.fd8773c8"),
          bg: 'bg-primary/10 text-primary dark:bg-primary-dark/20 dark:text-primary-dark border-primary/30',
        };
      case 'grading':
      case 'submitted':
        return {
          label: translateRecentFeature("studyPlans.ui.grading.fa025a95"),
          bg: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30',
        };
      case 'partially-graded':
        return {
          label: translateRecentFeature("studyPlans.ui.partially-graded.0b74cb6f"),
          bg: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
        };
      case 'grading-failed':
        return {
          label: translateRecentFeature("studyPlans.ui.grading-failed.e2a70910"),
          bg: 'bg-error/10 text-error dark:bg-error-dark/20 dark:text-error-dark border-error/30',
        };
      case 'cancelled':
        return {
          label: translateRecentFeature("studyPlans.ui.cancelled.cd408c66"),
          bg: 'bg-surface-container-high dark:bg-surface-container-high-dark text-on-surface-variant border-outline-variant/40',
        };
    }
  };

  const config = getStatusConfig(status);

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      {mode && (
        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-surface-container-high dark:bg-surface-container-high-dark text-on-surface-variant capitalize border border-outline-variant/30">
          {mode}
        </span>
      )}
      <span
        className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${config.bg}`}
      >
        {config.label}
      </span>
    </div>
  );
};
