/**
 * Assessment Blueprint History component for inspecting immutable revisions and copying drafts.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.4, §5.4, §5.5
 * - openspec/changes/generate-study-plan-examinations/ (C3-T09)
 */

import React from 'react';
import { Copy, Eye, Clock, CheckCircle, Warning, Archive, Trash } from '@phosphor-icons/react';
import type { BlueprintState, AssessmentMode } from '../../../types/assessmentQuestions';
import { Button } from '../../md3/Button';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface BlueprintRevisionSummary {
  id: string;
  blueprintId: string;
  revision: number;
  state: BlueprintState;
  mode: AssessmentMode;
  questionCount: number;
  requestedCount: number;
  createdAt: string;
  publishedAt: string | null;
  shortfallAccepted: boolean;
}

export interface BlueprintHistoryProps {
  revisions: BlueprintRevisionSummary[];
  currentRevisionId: string | null;
  onSelectRevision: (revisionId: string) => void;
  onCopyAsDraft?: (revisionId: string) => void;
  canCreateDraft?: boolean;
  onArchiveBlueprint?: () => void;
  onDeleteBlueprint?: () => void;
  hasAttempts?: boolean;
  className?: string;
}

export const BlueprintHistory: React.FC<BlueprintHistoryProps> = ({
  revisions,
  currentRevisionId,
  onSelectRevision,
  onCopyAsDraft,
  canCreateDraft = true,
  onArchiveBlueprint,
  onDeleteBlueprint,
  hasAttempts = false,
  className = '',
}) => {
        useI18n();
        if (revisions.length === 0) {
    return (
      <div className={`py-8 text-center text-xs text-surface-500 ${className}`}>
        {translateRecentFeature("studyPlans.ui.no-revision-history-availabl.666d0771")}</div>
    );
  }

  const renderStateBadge = (state: BlueprintState) => {
        switch (state) {
      case 'ready':
        return (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
            <CheckCircle weight="fill" className="w-3 h-3" />
            {translateRecentFeature("studyPlans.ui.ready-published.beedf73f")}</span>
        );
      case 'draft':
        return (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            {translateRecentFeature("studyPlans.ui.draft.ae10641e")}</span>
        );
      case 'needs-review':
        return (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 flex items-center gap-1">
            <Warning weight="bold" className="w-3 h-3" />
            {translateRecentFeature("reviewComplete.needsReview")}</span>
        );
      case 'failed':
        return (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
            {translateRecentFeature("common.failed")}</span>
        );
      case 'cancelled':
        return (
          <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-400">
            {translateRecentFeature("studyPlans.ui.cancelled.cd408c66")}</span>
        );
      default:
        return null;
    }
  };

  const formatDate = (isoString: string | null) => {
    if (!isoString) return 'Unpublished';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h4 className="text-sm font-bold text-surface-900 dark:text-surface-100 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-primary-500" />
            {translateRecentFeature("studyPlans.ui.revision-history.18e8c9ec")}</h4>
          <p className="text-xs text-surface-500 mt-0.5">
            {translateRecentFeature("studyPlans.ui.published-revisions-are-immu.9aacdc36")}</p>
        </div>

        <div className="flex items-center gap-2">
          {onArchiveBlueprint && (
            <Button
              variant="text"
              size="sm"
              onClick={onArchiveBlueprint}
              className="text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-surface-200 text-xs gap-1"
            >
              <Archive className="w-3.5 h-3.5" />
              {translateRecentFeature("studyPlans.ui.archive-blueprint.86851b24")}</Button>
          )}
          {onDeleteBlueprint && !hasAttempts && (
            <Button
              variant="text"
              size="sm"
              onClick={onDeleteBlueprint}
              className="text-rose-600 hover:text-rose-700 dark:text-rose-400 text-xs gap-1"
            >
              <Trash className="w-3.5 h-3.5" />
              {translateRecentFeature("studyPlans.ui.delete-unused.cb35438c")}</Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {revisions.map((rev) => {
                    const isCurrent = currentRevisionId === rev.id;

          return (
            <div
              key={rev.id}
              className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 rounded-xl border text-xs transition-colors ${
                isCurrent
                  ? 'bg-primary-500/10 border-primary-500/40 shadow-sm'
                  : 'bg-surface-50 dark:bg-surface-800/60 border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-surface-900 dark:text-surface-100">{translateRecentFeature("studyPlans.ui.revision-var0.bdd5f888", {var0: rev.revision})}</span>
                  {renderStateBadge(rev.state)}
                  <span className="text-[11px] text-surface-400 capitalize">{translateRecentFeature("studyPlans.ui.var0-mode.15f1a643", {var0: rev.mode})}</span>
                </div>

                <div className="flex items-center gap-3 text-[11px] text-surface-500 flex-wrap">
                  <span>
                    {translateRecentFeature("studyPlans.ui.questions.4b57d958")}{' '}
                    <strong className="text-surface-700 dark:text-surface-300">
                      {rev.questionCount} / {rev.requestedCount}
                    </strong>
                    {rev.shortfallAccepted && ' (Shortfall accepted)'}
                  </span>
                  <span>•</span>
                  <span>{translateRecentFeature("studyPlans.ui.created-var0.e56e92a8", {var0: formatDate(rev.createdAt)})}</span>
                  {rev.publishedAt && (
                    <>
                      <span>•</span>
                      <span>{translateRecentFeature("studyPlans.ui.published-var0.dd184c0b", {var0: formatDate(rev.publishedAt)})}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                <Button
                  variant={isCurrent ? 'filled' : 'outlined'}
                  size="sm"
                  onClick={() => onSelectRevision(rev.id)}
                  className="gap-1.5 text-xs py-1 px-3"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {isCurrent ? translateRecentFeature("studyPlans.ui.viewing.5db6eb6d") : translateRecentFeature("studyPlans.ui.inspect.ecf6b83f")}
                </Button>

                {onCopyAsDraft && canCreateDraft && rev.state === 'ready' && (
                  <Button
                    variant="text"
                    size="sm"
                    onClick={() => onCopyAsDraft(rev.id)}
                    className="gap-1 text-xs py-1 px-2.5 text-surface-600 dark:text-surface-300"
                    title={translateRecentFeature("studyPlans.ui.copy-this-published-revision.64b1bf02")}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {translateRecentFeature("studyPlans.ui.copy-as-new-draft.6427ba3a")}</Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
