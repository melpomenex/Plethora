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
      aria-label="Generation issues and notices"
      className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-500/5 text-amber-900 dark:text-amber-100 space-y-3 text-xs"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-200">
          <Warning size={18} className="text-amber-500 flex-shrink-0" />
          <span>Generation Notices &amp; Issues</span>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss issue list"
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
            <span className="font-semibold">Pruned Cyclic Dependencies: </span>
            <span>
              {droppedCycleEdgesCount} proposed cyclic prerequisite edge(s) were removed to maintain a strict acyclic learning progression.
            </span>
          </div>
        </div>
      )}

      {/* Unsupported Nodes notice */}
      {unsupportedNodeCount > 0 && (
        <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
          <FileX size={15} className="flex-shrink-0 mt-0.5 text-amber-600" />
          <div>
            <span className="font-semibold">Ungrounded Topics ({unsupportedNodeCount}): </span>
            <span>
              {unsupportedNodeCount} topic(s) lack grounded citations from your selected source material and are marked as unsupported proposals.
            </span>
          </div>
        </div>
      )}

      {/* Stale Sources */}
      {staleSources.length > 0 && (
        <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
          <ArrowsClockwise size={15} className="flex-shrink-0 mt-0.5 text-amber-600" />
          <div>
            <span className="font-semibold">Stale Source Material: </span>
            <span>
              {staleSources.length} document(s) have changed on disk since the scope was frozen. Citations may need review.
            </span>
          </div>
        </div>
      )}

      {/* Missing Sources */}
      {missingSources.length > 0 && (
        <div className="flex items-start gap-2 text-red-700 dark:text-red-300">
          <FileX size={15} className="flex-shrink-0 mt-0.5 text-red-500" />
          <div>
            <span className="font-semibold">Missing Source Material: </span>
            <span>
              {missingSources.length} selected document(s) could not be located in your library.
            </span>
          </div>
        </div>
      )}

      {/* Specific Field Issues */}
      {fieldIssues.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-amber-500/20">
          <div className="font-semibold text-[11px] text-amber-700 dark:text-amber-300">
            Field Validation Issues ({fieldIssues.length}):
          </div>
          <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-800 dark:text-amber-200">
            {fieldIssues.map((issue, idx) => (
              <li key={idx}>
                <span className="font-mono text-[10px]">{issue.path || 'root'}</span>:{' '}
                {issue.messageKey || (issue as any).message || issue.code}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
