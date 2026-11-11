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
          Confirm Authoritative Manual Grade
        </h3>
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
          <span className="font-bold">Authoritative Override</span>
          <p className="text-xs leading-relaxed">
            Committing this evaluation permanently records a human educator grade
            with state <code className="px-1 py-0.5 bg-amber-500/20 rounded font-mono">final</code> and
            origin <code className="px-1 py-0.5 bg-amber-500/20 rounded font-mono">manual</code>.
            It cannot be automatically displaced by future AI retries.
          </p>
        </div>
      </div>

      {/* Score Summary Banner */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-surface-container/60 dark:bg-surface-container-dark/60 border border-outline-variant/30">
        <div>
          <span className="text-xs font-semibold text-on-surface-variant block uppercase tracking-wider">
            Calculated Award
          </span>
          <span className="text-xs text-on-surface-variant">
            {percentage}% of maximum points
          </span>
        </div>

        <div className="text-right">
          <span className="text-2xl font-black text-on-surface">
            {calculatedPoints}
          </span>
          <span className="text-sm font-semibold text-on-surface-variant">
            {' '}/ {maxPoints} pts
          </span>
        </div>
      </div>

      {/* Criteria Breakdown */}
      <div className="space-y-2">
        <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant block">
          Criteria Summary
        </span>

        <div className="divide-y divide-outline-variant/20 rounded-xl border border-outline-variant/30 overflow-hidden bg-surface-container-low/40 dark:bg-surface-container-low-dark/40">
          {criteria.map((c) => (
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
                <span className="font-bold text-on-surface block">
                  Level {c.level}/4
                </span>
                <span className="text-[11px] text-on-surface-variant">
                  +{c.pointsContribution} pts (w: {c.weight})
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Mandatory Reason */}
      <div className="space-y-1.5 p-3.5 rounded-xl bg-surface-container-low dark:bg-surface-container-low-dark border border-outline-variant/30 text-xs">
        <span className="font-bold uppercase tracking-wider text-on-surface-variant block text-[10px]">
          Recorded Justification / Reason:
        </span>
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
          Back to Editing
        </Button>

        <Button
          variant="filled"
          onClick={onConfirm}
          disabled={isSubmitting}
          className="min-h-[40px] px-5 text-xs font-bold shadow-sm"
        >
          <FloppyDisk size={16} className={`mr-1.5 inline ${isSubmitting ? 'animate-spin' : ''}`} />
          {isSubmitting ? 'Saving...' : 'Confirm & Commit Manual Grade'}
        </Button>
      </div>
    </div>
  );
};
