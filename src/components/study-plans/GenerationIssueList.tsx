/**
 * Generation & Validation Issue List Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.3
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T09)
 */

import React from 'react';
import {
  Warning,
  WarningOctagon,
  ArrowsClockwise,
  GitFork,
  FileX,
  X,
} from '@phosphor-icons/react';
import type { FieldIssue } from '../../types/learningPaths';
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";


export interface GenerationIssueListProps {
  generalError?: string | null;
  fieldIssues?: FieldIssue[];
  droppedCycleEdgesCount?: number;
  unsupportedNodeCount?: number;
  staleSources?: string[];
  missingSources?: string[];
  onDismiss?: () => void;
}

export const GenerationIssueList: React.FC<GenerationIssueListProps> = ({
  generalError,
  fieldIssues = [],
  droppedCycleEdgesCount = 0,
  unsupportedNodeCount = 0,
  staleSources = [],
  missingSources = [],
  onDismiss,
}) => {
        useI18n();
        const hasIssues =
    Boolean(generalError) ||
    fieldIssues.length > 0 ||
    droppedCycleEdgesCount > 0 ||
    unsupportedNodeCount > 0 ||
    staleSources.length > 0 ||
    missingSources.length > 0;

  if (!hasIssues) return null;

  return (
    <div
      role="alert"
      aria-label={translateRecentFeature("studyPlans.ui.generation-issues-and-notice.0691295b")}
      className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-500/5 text-amber-900 dark:text-amber-100 space-y-3 text-xs"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-200">
          <Warning size={18} className="text-amber-500 flex-shrink-0" />
          <span>{translateRecentFeature("studyPlans.ui.generation-notices-issues.e21ca779")}</span>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={translateRecentFeature("studyPlans.ui.dismiss-issue-list.58503d42")}
            className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-white p-1 rounded-md"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* General Error Banner */}
      {generalError && (
        <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 flex items-start gap-2">
          <WarningOctagon size={16} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1 font-semibold leading-relaxed">{generalError}</div>
        </div>
      )}

      {/* Dropped Cycle Edges notice */}
      {droppedCycleEdgesCount > 0 && (
        <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
          <GitFork size={15} className="flex-shrink-0 mt-0.5 text-amber-600" />
          <div>
            <span className="font-semibold">{translateRecentFeature("studyPlans.ui.pruned-cyclic-dependencies.38058bfc")}</span>
            <span>{translateRecentFeature("studyPlans.ui.var0-proposed-cyclic-prerequ.cb02d4c4", {var0: droppedCycleEdgesCount})}</span>
          </div>
        </div>
      )}

      {/* Unsupported Nodes notice */}
      {unsupportedNodeCount > 0 && (
        <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
          <FileX size={15} className="flex-shrink-0 mt-0.5 text-amber-600" />
          <div>
            <span className="font-semibold">{translateRecentFeature("studyPlans.ui.ungrounded-topics-var0.59906605", {var0: unsupportedNodeCount})}</span>
            <span>{translateRecentFeature("studyPlans.ui.var0-topic-s-lack-grounded-c.1ac92cb0", {var0: unsupportedNodeCount})}</span>
          </div>
        </div>
      )}

      {/* Stale Sources */}
      {staleSources.length > 0 && (
        <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
          <ArrowsClockwise size={15} className="flex-shrink-0 mt-0.5 text-amber-600" />
          <div>
            <span className="font-semibold">{translateRecentFeature("studyPlans.ui.stale-source-material.377d4e72")}</span>
            <span>{translateRecentFeature("studyPlans.ui.var0-document-s-have-changed.c1dcf7cc", {var0: staleSources.length})}</span>
          </div>
        </div>
      )}

      {/* Missing Sources */}
      {missingSources.length > 0 && (
        <div className="flex items-start gap-2 text-red-700 dark:text-red-300">
          <FileX size={15} className="flex-shrink-0 mt-0.5 text-red-500" />
          <div>
            <span className="font-semibold">{translateRecentFeature("studyPlans.ui.missing-source-material.5dd9a0a1")}</span>
            <span>{translateRecentFeature("studyPlans.ui.var0-selected-document-s-cou.c2f14321", {var0: missingSources.length})}</span>
          </div>
        </div>
      )}

      {/* Specific Field Issues */}
      {fieldIssues.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-amber-500/20">
          <div className="font-semibold text-[11px] text-amber-700 dark:text-amber-300">{translateRecentFeature("studyPlans.ui.field-validation-issues-var0.7f0dfb78", {var0: fieldIssues.length})}</div>
          <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-800 dark:text-amber-200">
            {fieldIssues.map((issue, idx) => (
              <li key={idx}>
                <span className="font-mono text-[10px]">{issue.path || 'root'}</span>:{' '}
                {issue.messageKey
                  ? translateRecentFeature(issue.messageKey)
                  : (issue as any).message || issue.code}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
