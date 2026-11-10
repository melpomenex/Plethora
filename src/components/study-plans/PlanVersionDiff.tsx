/**
 * Plan Version Diff component for reviewing version changes and publication approval.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.3
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T09)
 */

import React from 'react';
import {
  PlusCircle,
  MinusCircle,
  PencilSimple,
  ArrowsDownUp,
  Lock,
  GitFork,
  CheckCircle,
} from '@phosphor-icons/react';
import type { PlanVersionDiff as PlanVersionDiffType } from '../../types/learningPaths';

export interface PlanVersionDiffProps {
  diff: PlanVersionDiffType | null;
  onAcknowledgeLockConflicts?: () => void;
  lockConflictsAcknowledged?: boolean;
}

export const PlanVersionDiff: React.FC<PlanVersionDiffProps> = ({
  diff,
  onAcknowledgeLockConflicts,
  lockConflictsAcknowledged = false,
}) => {
  if (!diff) {
    return (
      <div className="py-6 text-center text-xs text-surface-500">
        No structural diff available for this version.
      </div>
    );
  }

  const hasChanges =
    diff.addedNodeIds.length > 0 ||
    diff.removedNodeIds.length > 0 ||
    diff.modifiedNodeIds.length > 0 ||
    diff.reorderedNodeIds.length > 0 ||
    diff.addedPrerequisites.length > 0 ||
    diff.removedPrerequisites.length > 0 ||
    diff.lockConflicts.length > 0;

  if (!hasChanges) {
    return (
      <div className="py-6 text-center text-xs text-surface-500 flex items-center justify-center gap-2">
        <CheckCircle size={16} className="text-emerald-500" />
        <span>No changes detected from previous version.</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-xs">
      {/* Lock conflicts warning */}
      {diff.lockConflicts.length > 0 && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 space-y-2"
        >
          <div className="flex items-center gap-2 font-bold">
            <Lock size={16} weight="fill" className="text-amber-600 dark:text-amber-400" />
            <span>Lock-Position Conflicts ({diff.lockConflicts.length})</span>
          </div>
          <p className="text-[11px] leading-relaxed">
            The following locked topics were moved because prerequisite topological ordering
            required it:
          </p>
          <ul className="list-disc list-inside space-y-0.5 text-[11px]">
            {diff.lockConflicts.map((c, i) => (
              <li key={i}>
                Topic <span className="font-mono">{c.nodeId.slice(0, 8)}</span>: moved from position{' '}
                {c.previousPosition + 1} to {c.actualPosition + 1}
              </li>
            ))}
          </ul>
          {onAcknowledgeLockConflicts && (
            <label className="flex items-center gap-2 pt-1 font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={lockConflictsAcknowledged}
                onChange={onAcknowledgeLockConflicts}
                className="text-amber-600 focus:ring-amber-500 rounded"
              />
              <span>I reviewed and acknowledge these {diff.lockConflicts.length} position changes</span>
            </label>
          )}
        </div>
      )}

      {/* Summary grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
          <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold mb-1">
            <PlusCircle size={15} />
            <span>Added</span>
          </div>
          <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
            {diff.addedNodeIds.length}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
          <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400 font-bold mb-1">
            <MinusCircle size={15} />
            <span>Removed</span>
          </div>
          <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
            {diff.removedNodeIds.length}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
          <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-bold mb-1">
            <PencilSimple size={15} />
            <span>Modified</span>
          </div>
          <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
            {diff.modifiedNodeIds.length}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
          <div className="flex items-center gap-1.5 text-purple-600 dark:text-purple-400 font-bold mb-1">
            <ArrowsDownUp size={15} />
            <span>Reordered</span>
          </div>
          <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
            {diff.reorderedNodeIds.length}
          </div>
        </div>
      </div>

      {/* Prerequisites diff */}
      {(diff.addedPrerequisites.length > 0 || diff.removedPrerequisites.length > 0) && (
        <div className="p-3 rounded-xl bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-surface-800 dark:text-surface-200">
            <GitFork size={15} />
            <span>Prerequisite Edge Changes</span>
          </div>
          {diff.addedPrerequisites.length > 0 && (
            <p className="text-emerald-600 dark:text-emerald-400">
              +{diff.addedPrerequisites.length} prerequisite relationship(s) added
            </p>
          )}
          {diff.removedPrerequisites.length > 0 && (
            <p className="text-red-600 dark:text-red-400">
              -{diff.removedPrerequisites.length} prerequisite relationship(s) removed
            </p>
          )}
        </div>
      )}
    </div>
  );
};
