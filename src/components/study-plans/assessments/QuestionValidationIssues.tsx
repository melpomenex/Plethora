/**
 * Question Validation Issues Display Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.3
 * - openspec/changes/generate-study-plan-examinations/ (C3-T09)
 */

import React from 'react';
import { XCircle } from '@phosphor-icons/react';
import type { FieldIssue } from '../../../types/learningPaths';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface QuestionValidationIssuesProps {
  issues: FieldIssue[];
  className?: string;
}

export const QuestionValidationIssues: React.FC<QuestionValidationIssuesProps> = ({
  issues,
  className = '',
}) => {
        useI18n();
        if (issues.length === 0) return null;

  return (
    <div
      className={`p-3 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/30 space-y-2 text-xs ${className}`}
      role="alert"
    >
      <div className="flex items-center gap-1.5 font-semibold text-red-900 dark:text-red-200">
        <XCircle className="w-4 h-4 flex-shrink-0 text-red-600 dark:text-red-400" />
        <span>{translateRecentFeature(issues.length === 1 ? "studyPlans.ui.var0-validation-constraint.0e71e521" : "studyPlans.ui.var0-validation-constraints.ed03ac3a", {var0: issues.length})}</span>
      </div>
      <ul className="list-disc list-inside space-y-1 text-red-800 dark:text-red-300">
        {issues.map((issue, idx) => (
          <li key={`${issue.path}-${issue.code}-${idx}`} className="break-words">
            <span className="font-mono text-[11px] font-semibold">{issue.path}: </span>
            <span>{translateRecentFeature(issue.messageKey)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
