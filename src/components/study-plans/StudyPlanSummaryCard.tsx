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
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";


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
        useI18n();
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
      aria-label={translateRecentFeature("studyPlans.ui.study-plan-var0.e049ebb2", {var0: plan.title})}
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
                {translateRecentFeature("viewer.archived")}</span>
            )}
            {plan.hasDraft && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                {translateRecentFeature("studyPlans.ui.draft-active.00736535")}</span>
            )}
            <span className="text-xs text-surface-500">
              {plan.currentVersion > 0 ? translateRecentFeature("i18nAudit.ui.v-var0.21a5b169", {var0: plan.currentVersion}) : translateRecentFeature("studyPlans.ui.not-yet-published.027f16c2")}
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
          <div className="flex items-center gap-1.5" title={translateRecentFeature("studyPlans.ui.topics-completed-total.97fc5355")}>
            <CheckCircle size={15} className="text-emerald-500" />
            <span>{translateRecentFeature("studyPlans.ui.var0-var1-topics.03737d81", {var0: plan.completedNodeCount, var1: plan.nodeCount})}</span>
          </div>
          <div className="flex items-center gap-1.5" title={translateRecentFeature("studyPlans.ui.source-documents.716e72f0")}>
            <FileText size={15} className="text-blue-500" />
            <span>{translateRecentFeature("studyPlans.ui.var0-docs.b4a5e24c", {var0: plan.sourceDocumentCount})}</span>
          </div>
        </div>
      </div>

      {/* Action buttons footer */}
      <div className="flex items-center justify-between gap-2 pt-3 border-t border-surface-200 dark:border-surface-700/60">
        <Button variant="filled" size="sm" onClick={() => onOpen(plan.id)}>
          {translateRecentFeature("studyPlans.ui.open-plan.627ca3b7")}</Button>

        <div className="flex items-center gap-1">
          {isArchived ? (
            onRestore && (
              <Button
                variant="text"
                size="sm"
                onClick={() => onRestore(plan.id)}
                title={translateRecentFeature("studyPlans.ui.restore-from-archive.d47ec105")}
              >
                <ArrowCounterClockwise size={16} />
                <span>{translateRecentFeature("mainLayout.restore")}</span>
              </Button>
            )
          ) : (
            onArchive && (
              <Button
                variant="text"
                size="sm"
                onClick={() => onArchive(plan.id)}
                title={translateRecentFeature("studyPlans.ui.archive-plan.49c28a81")}
              >
                <Archive size={16} />
                <span>{translateRecentFeature("cardContextMenu.archive")}</span>
              </Button>
            )
          )}
          {onDelete && (
            <Button
              variant="text"
              size="iconSm"
              onClick={() => setShowDeleteConfirm(true)}
              title={translateRecentFeature("studyPlans.ui.delete-plan.d3e27551")}
              aria-label={translateRecentFeature("studyPlans.ui.delete-plan.d3e27551")}
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
        title={translateRecentFeature("studyPlans.ui.delete-var0.0f83b5b5", {var0: plan.title})}
        message={translateRecentFeature("studyPlans.ui.this-will-delete-this-study-.7bd42e1b")}
        confirmLabel={translateRecentFeature("studyPlans.ui.delete-plan.c935cbb5")}
        variant="danger"
      />
    </div>
  );
};
