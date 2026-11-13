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
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";


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
        useI18n();
        if (!diff) {
    return (
      <div className="py-6 text-center text-xs text-surface-500">
        {translateRecentFeature("studyPlans.ui.no-structural-diff-available.cf382966")}</div>
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
        <span>{translateRecentFeature("studyPlans.ui.no-changes-detected-from-pre.1f0e5392")}</span>
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
            <span>{translateRecentFeature("studyPlans.ui.lock-position-conflicts-var0.89454345", {var0: diff.lockConflicts.length})}</span>
          </div>
          <p className="text-[11px] leading-relaxed">
            {translateRecentFeature("studyPlans.ui.the-following-locked-topics-.55571a1d")}</p>
          <ul className="list-disc list-inside space-y-0.5 text-[11px]">
            {diff.lockConflicts.map((c, i) => {
                            return (
              <li key={i}>
                {translateRecentFeature("tagSuggestions.category.topic")}<span className="font-mono">{c.nodeId.slice(0, 8)}</span>{translateRecentFeature("studyPlans.ui.moved-from-position.c93037c9")}{' '}{translateRecentFeature("studyPlans.ui.var0-to-var1.70c63dcb", {var0: c.previousPosition + 1, var1: c.actualPosition + 1})}</li>
            );
            })}
          </ul>
          {onAcknowledgeLockConflicts && (
            <label className="flex items-center gap-2 pt-1 font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={lockConflictsAcknowledged}
                onChange={onAcknowledgeLockConflicts}
                className="text-amber-600 focus:ring-amber-500 rounded"
              />
              <span>{translateRecentFeature("studyPlans.ui.i-reviewed-and-acknowledge-t.4155444c", {var0: diff.lockConflicts.length})}</span>
            </label>
          )}
        </div>
      )}

      {/* Summary grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
          <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold mb-1">
            <PlusCircle size={15} />
            <span>{translateRecentFeature("imageRegistry.added")}</span>
          </div>
          <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
            {diff.addedNodeIds.length}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
          <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400 font-bold mb-1">
            <MinusCircle size={15} />
            <span>{translateRecentFeature("studyPlans.ui.removed.253c680d")}</span>
          </div>
          <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
            {diff.removedNodeIds.length}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
          <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-bold mb-1">
            <PencilSimple size={15} />
            <span>{translateRecentFeature("studyPlans.ui.modified.9f201b77")}</span>
          </div>
          <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
            {diff.modifiedNodeIds.length}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
          <div className="flex items-center gap-1.5 text-purple-600 dark:text-purple-400 font-bold mb-1">
            <ArrowsDownUp size={15} />
            <span>{translateRecentFeature("studyPlans.ui.reordered.d56f5487")}</span>
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
            <span>{translateRecentFeature("studyPlans.ui.prerequisite-edge-changes.125582e9")}</span>
          </div>
          {diff.addedPrerequisites.length > 0 && (
            <p className="text-emerald-600 dark:text-emerald-400">{translateRecentFeature("studyPlans.ui.var0-prerequisite-relationsh.e786c9b6", {var0: diff.addedPrerequisites.length})}</p>
          )}
          {diff.removedPrerequisites.length > 0 && (
            <p className="text-red-600 dark:text-red-400">{translateRecentFeature("studyPlans.ui.var0-prerequisite-relationsh.a336a6ad", {var0: diff.removedPrerequisites.length})}</p>
          )}
        </div>
      )}
    </div>
  );
};
