/**
 * Study Plan Summary Card component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.1
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T08)
 */

import React, { useState } from 'react';
import {
  CheckCircle,
  Archive,
  ArrowCounterClockwise,
  Trash,
  FileText,
} from '@phosphor-icons/react';
import type { StudyPlanSummary } from '../../types/learningPaths';
import { Button } from '../md3/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';

export interface StudyPlanSummaryCardProps {
  plan: StudyPlanSummary;
  onOpen: (planId: string) => void;
  onArchive?: (planId: string) => void;
  onRestore?: (planId: string) => void;
  onDelete?: (planId: string) => void;
}

export const StudyPlanSummaryCard: React.FC<StudyPlanSummaryCardProps> = ({
  plan,
  onOpen,
  onArchive,
  onRestore,
  onDelete,
}) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const depthColor =
    plan.depth === 'deep'
      ? 'border-purple-500/30 text-purple-600 dark:text-purple-400'
      : plan.depth === 'foundational'
      ? 'border-blue-500/30 text-blue-600 dark:text-blue-400'
      : 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400';

  const isArchived = plan.status === 'archived';

  return (
    <div
      role="article"
      aria-label={`Study plan ${plan.title}`}
      className="group relative flex flex-col justify-between p-5 rounded-2xl bg-surface-50 dark:bg-surface-800/60 border border-surface-200 dark:border-surface-700/80 hover:border-primary-500/40 transition-all shadow-sm hover:shadow"
    >
      <div>
        {/* Top header row */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${depthColor}`}
            >
              {plan.depth}
            </span>
            {isArchived && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300">
                Archived
              </span>
            )}
            {plan.hasDraft && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                Draft active
              </span>
            )}
            <span className="text-xs text-surface-500">
              {plan.currentVersion > 0 ? `v${plan.currentVersion}` : 'Not yet published'}
            </span>
          </div>
        </div>

        {/* Title & Goal */}
        <h3
          onClick={() => onOpen(plan.id)}
          className="text-base font-bold text-surface-900 dark:text-surface-100 mb-1.5 cursor-pointer hover:text-primary-600 dark:hover:text-primary-400 transition-colors line-clamp-1"
        >
          {plan.title}
        </h3>
        <p className="text-xs text-surface-600 dark:text-surface-400 line-clamp-2 mb-4 leading-relaxed">
          {plan.goal}
        </p>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs text-surface-500 dark:text-surface-400 mb-4 flex-wrap">
          <div className="flex items-center gap-1.5" title="Topics completed / total">
            <CheckCircle size={15} className="text-emerald-500" />
            <span>
              {plan.completedNodeCount} / {plan.nodeCount} topics
            </span>
          </div>
          <div className="flex items-center gap-1.5" title="Source documents">
            <FileText size={15} className="text-blue-500" />
            <span>{plan.sourceDocumentCount} docs</span>
          </div>
        </div>
      </div>

      {/* Action buttons footer */}
      <div className="flex items-center justify-between gap-2 pt-3 border-t border-surface-200 dark:border-surface-700/60">
        <Button variant="filled" size="sm" onClick={() => onOpen(plan.id)}>
          Open Plan
        </Button>

        <div className="flex items-center gap-1">
          {isArchived ? (
            onRestore && (
              <Button
                variant="text"
                size="sm"
                onClick={() => onRestore(plan.id)}
                title="Restore from archive"
              >
                <ArrowCounterClockwise size={16} />
                <span>Restore</span>
              </Button>
            )
          ) : (
            onArchive && (
              <Button
                variant="text"
                size="sm"
                onClick={() => onArchive(plan.id)}
                title="Archive plan"
              >
                <Archive size={16} />
                <span>Archive</span>
              </Button>
            )
          )}
          {onDelete && (
            <Button
              variant="text"
              size="iconSm"
              onClick={() => setShowDeleteConfirm(true)}
              title="Delete plan"
              aria-label="Delete plan"
            >
              <Trash size={16} className="text-red-500" />
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          setShowDeleteConfirm(false);
          onDelete?.(plan.id);
        }}
        title={`Delete "${plan.title}"?`}
        message="This will delete this study plan, its versions, and its topic activity. Your original library documents and any examination history will remain intact."
        confirmLabel="Delete Plan"
        variant="danger"
      />
    </div>
  );
};
