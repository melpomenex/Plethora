/**
 * Manual Grade Confirmation Dialog Content.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.8
 * - openspec/changes/implement-rubric-based-exam-grading/tasks.md (C5-T06)
 *
 * Summarizes calculated points, criteria levels, and reason before CAS mutation.
 */

import React from 'react';
import {
  WarningCircle,
  CheckCircle,
  ArrowLeft,
  FloppyDisk,
} from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface CriterionConfirmationItem {
  criterionId: string;
  title: string;
  level: number;
  weight: number;
  pointsContribution: number;
  rationale?: string | null;
}

export interface ManualGradeConfirmationProps {
  questionTitle?: string;
  calculatedPoints: number;
  maxPoints: number;
  criteria: CriterionConfirmationItem[];
  manualReason: string;
  isSubmitting?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onBack: () => void;
  className?: string;
}

export const ManualGradeConfirmation: React.FC<ManualGradeConfirmationProps> = ({
  questionTitle,
  calculatedPoints,
  maxPoints,
  criteria,
  manualReason,
  isSubmitting = false,
  error = null,
  onConfirm,
  onBack,
  className = '',
}) => {
        useI18n();
        const percentage = maxPoints > 0 ? Math.round((calculatedPoints / maxPoints) * 100) : 0;

  return (
    <div
      className={`space-y-5 p-5 bg-surface dark:bg-surface-dark rounded-2xl border border-outline-variant/40 ${className}`}
      data-testid="manual-grade-confirmation"
    >
      {/* Header */}
      <div className="space-y-1">
        <h3 className="text-base font-bold text-on-surface flex items-center gap-2">
          <CheckCircle size={20} className="text-primary" weight="fill" />
          {translateRecentFeature("studyPlans.ui.confirm-authoritative-manual.7f32ac82")}</h3>
        {questionTitle && (
          <p className="text-xs text-on-surface-variant font-medium">
            {questionTitle}
          </p>
        )}
      </div>

      {/* Warning Notice */}
      <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs flex items-start gap-2.5">
        <WarningCircle size={18} className="shrink-0 mt-0.5" weight="fill" />
        <div className="space-y-0.5">
          <span className="font-bold">{translateRecentFeature("studyPlans.ui.authoritative-override.3f21fc90")}</span>
          <p className="text-xs leading-relaxed">
            {translateRecentFeature("studyPlans.ui.committing-this-evaluation-p.55cfe236")}<code className="px-1 py-0.5 bg-amber-500/20 rounded font-mono">{translateRecentFeature("studyPlans.ui.final.052f23d0")}</code> {translateRecentFeature("studyPlans.ui.and-origin.c65f84b3")}<code className="px-1 py-0.5 bg-amber-500/20 rounded font-mono">{translateRecentFeature("studyPlans.ui.manual.c6e2933d")}</code>{translateRecentFeature("studyPlans.ui.it-cannot-be-automatically-d.50438269")}</p>
        </div>
      </div>

      {/* Score Summary Banner */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-surface-container/60 dark:bg-surface-container-dark/60 border border-outline-variant/30">
        <div>
          <span className="text-xs font-semibold text-on-surface-variant block uppercase tracking-wider">
            {translateRecentFeature("studyPlans.ui.calculated-award.1d7db40e")}</span>
          <span className="text-xs text-on-surface-variant">{translateRecentFeature("studyPlans.ui.var0-of-maximum-points.9c77f99e", {var0: percentage})}</span>
        </div>

        <div className="text-right">
          <span className="text-2xl font-black text-on-surface">
            {calculatedPoints}
          </span>
          <span className="text-sm font-semibold text-on-surface-variant">
            {' '}{translateRecentFeature("studyPlans.ui.var0-pts.b9b87d13", {var0: maxPoints})}</span>
        </div>
      </div>

      {/* Criteria Breakdown */}
      <div className="space-y-2">
        <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant block">
          {translateRecentFeature("studyPlans.ui.criteria-summary.f7015651")}</span>

        <div className="divide-y divide-outline-variant/20 rounded-xl border border-outline-variant/30 overflow-hidden bg-surface-container-low/40 dark:bg-surface-container-low-dark/40">
          {criteria.map((c) => {
                        return (
            <div key={c.criterionId} className="p-3 text-xs flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5 max-w-[70%]">
                <span className="font-semibold text-on-surface block">
                  {c.title}
                </span>
                {c.rationale && (
                  <p className="text-[11px] text-on-surface-variant italic">
                    "{c.rationale}"
                  </p>
                )}
              </div>

              <div className="text-right">
                <span className="font-bold text-on-surface block">{translateRecentFeature("studyPlans.ui.level-var0-4.e8de2f4e", {var0: c.level})}</span>
                <span className="text-[11px] text-on-surface-variant">{translateRecentFeature("studyPlans.ui.var0-pts-w-var1.c967f25b", {var0: c.pointsContribution, var1: c.weight})}</span>
              </div>
            </div>
          );
          })}
        </div>
      </div>

      {/* Mandatory Reason */}
      <div className="space-y-1.5 p-3.5 rounded-xl bg-surface-container-low dark:bg-surface-container-low-dark border border-outline-variant/30 text-xs">
        <span className="font-bold uppercase tracking-wider text-on-surface-variant block text-[10px]">
          {translateRecentFeature("studyPlans.ui.recorded-justification-reaso.9adc844f")}</span>
        <p className="text-xs text-on-surface italic leading-relaxed whitespace-pre-wrap">
          "{manualReason}"
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-3 rounded-lg bg-error/10 border border-error/30 text-xs text-error font-medium" role="alert">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        <Button
          variant="text"
          onClick={onBack}
          disabled={isSubmitting}
          className="min-h-[40px] px-4 text-xs font-semibold"
        >
          <ArrowLeft size={16} className="mr-1.5 inline" />
          {translateRecentFeature("studyPlans.ui.back-to-editing.89727b71")}</Button>

        <Button
          variant="filled"
          onClick={onConfirm}
          disabled={isSubmitting}
          className="min-h-[40px] px-5 text-xs font-bold shadow-sm"
        >
          <FloppyDisk size={16} className={`mr-1.5 inline ${isSubmitting ? 'animate-spin' : ''}`} />
          {isSubmitting ? translateRecentFeature("common.saving") : translateRecentFeature("studyPlans.ui.confirm-commit-manual-grade.eb6a853d")}
        </Button>
      </div>
    </div>
  );
};
