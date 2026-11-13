/**
 * Manual Rubric Criterion Input Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.8
 * - openspec/changes/implement-rubric-based-exam-grading/tasks.md (C5-T06)
 *
 * Renders level selection (0..4) with committed descriptors and optional rationale.
 */

import React from 'react';
import type { RubricCriterion, RubricLevel } from '../../../types/assessmentQuestions';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface ManualCriterionInputProps {
  criterion: RubricCriterion;
  selectedLevel: RubricLevel | null;
  rationale?: string;
  onLevelChange: (level: RubricLevel) => void;
  onRationaleChange: (rationale: string) => void;
  disabled?: boolean;
  error?: string;
  className?: string;
}

const LEVELS: RubricLevel[] = [0, 1, 2, 3, 4];

export const ManualCriterionInput: React.FC<ManualCriterionInputProps> = ({
  criterion,
  selectedLevel,
  rationale = '',
  onLevelChange,
  onRationaleChange,
  disabled = false,
  error,
  className = '',
}) => {
        useI18n();
        const radioGroupName = `criterion-${criterion.id}-level`;

  return (
    <div
      className={`p-4 rounded-xl border bg-surface dark:bg-surface-dark space-y-3.5 transition-colors ${
        error
          ? 'border-error/50 bg-error/5 dark:bg-error/5'
          : selectedLevel !== null
          ? 'border-outline-variant/60'
          : 'border-outline-variant/40'
      } ${className}`}
      data-testid={`manual-criterion-${criterion.id}`}
    >
      {/* Criterion Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <span className="font-bold text-sm text-on-surface">
            {criterion.title}
          </span>
          <span className="block text-xs text-on-surface-variant">{translateRecentFeature("studyPlans.ui.weight-factor-var0.22e00e83", {var0: criterion.weight})}</span>
        </div>

        {selectedLevel !== null && (
          <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-primary/10 text-primary border border-primary/20">{translateRecentFeature("studyPlans.ui.selected-level-var0-4.9dbcf526", {var0: selectedLevel})}</span>
        )}
      </div>

      {/* Level Selection Radios */}
      <div
        role="radiogroup"
        aria-label={translateRecentFeature("studyPlans.ui.var0-level.547169ec", {var0: criterion.title})}
        className="space-y-2 pt-1"
      >
        {LEVELS.map((level) => {
                    const isSelected = selectedLevel === level;
          const descriptor =
            criterion.levels?.[String(level) as '0' | '1' | '2' | '3' | '4'] ??
            (criterion as any).descriptors?.[level] ??
            '';
          const inputId = `${radioGroupName}-${level}`;

          return (
            <label
              key={level}
              htmlFor={inputId}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                disabled ? 'opacity-60 cursor-not-allowed' : ''
              } ${
                isSelected
                  ? 'border-primary bg-primary/5 dark:bg-primary/10 shadow-sm'
                  : 'border-outline-variant/30 hover:border-outline-variant/60 hover:bg-surface-container/30'
              }`}
            >
              <input
                id={inputId}
                type="radio"
                name={radioGroupName}
                value={level}
                checked={isSelected}
                disabled={disabled}
                onChange={() => onLevelChange(level)}
                className="mt-1 h-4 w-4 text-primary focus:ring-primary focus:ring-offset-1 border-outline-variant"
                aria-label={translateRecentFeature("studyPlans.ui.level-var0-var1.bb9570fb", {var0: level, var1: descriptor})}
              />

              <div className="flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-on-surface">{translateRecentFeature("studyPlans.ui.level-var0.13b77221", {var0: level})}</span>
                  <span className="text-[11px] text-on-surface-variant font-medium">{translateRecentFeature("studyPlans.ui.var0-4.717d6f44", {var0: level})}</span>
                </div>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  {descriptor}
                </p>
              </div>
            </label>
          );
        })}
      </div>

      {/* Optional Criterion Note / Rationale */}
      <div className="pt-1 space-y-1">
        <label
          htmlFor={`criterion-${criterion.id}-note`}
          className="block text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider"
        >
          {translateRecentFeature("studyPlans.ui.criterion-note-optional.983a49c6")}</label>
        <textarea
          id={`criterion-${criterion.id}-note`}
          rows={2}
          value={rationale}
          disabled={disabled}
          onChange={(e) => onRationaleChange(e.target.value)}
          placeholder={translateRecentFeature("studyPlans.ui.add-specific-observation-or-.35ef09ab", {var0: criterion.title})}
          className="w-full text-xs p-2.5 rounded-lg border border-outline-variant/40 bg-surface-container-low dark:bg-surface-container-low-dark text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all resize-y"
          aria-label={translateRecentFeature("studyPlans.ui.note-for-var0.56274957", {var0: criterion.title})}
        />
      </div>

      {/* Validation Error Message */}
      {error && (
        <p className="text-xs text-error font-medium" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
