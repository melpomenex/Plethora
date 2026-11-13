/**
 * Learner Self-Reported Confidence Selector.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.6
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T05)
 */

import React from 'react';
import type { LearnerConfidence } from '../../../types/assessmentQuestions';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface ConfidenceSelectorProps {
  value: LearnerConfidence | undefined;
  onChange: (value: LearnerConfidence) => void;
  disabled?: boolean;
  className?: string;
}

const CONFIDENCE_STOPS: Array<{ stop: LearnerConfidence; labelKey: string; percent: string }> = [
  { stop: 0, labelKey: 'studyPlans.ui.no-idea.81675512', percent: '0%' },
  { stop: 0.3, labelKey: 'studyPlans.ui.uncertain.dcd00fef', percent: '30%' },
  { stop: 0.5, labelKey: 'studyPlans.ui.fifty-fifty.ae8d5552', percent: '50%' },
  { stop: 0.7, labelKey: 'studyPlans.ui.likely.13e6db81', percent: '70%' },
  { stop: 0.9, labelKey: 'studyPlans.ui.very-confident.2f156bdd', percent: '90%' },
  { stop: 1, labelKey: 'studyPlans.ui.certain.4476d3e4', percent: '100%' },
];

export const ConfidenceSelector: React.FC<ConfidenceSelectorProps> = ({
  value,
  onChange,
  disabled = false,
  className = '',
}) => {
        useI18n();
        return (
    <div
      className={`p-3 bg-surface-container-low dark:bg-surface-container-low-dark rounded-xl border border-outline-variant/30 ${className}`}
      role="group"
      aria-label={translateRecentFeature("studyPlans.ui.self-reported-confidence.580e0961")}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-on-surface-variant dark:text-on-surface-variant-dark">
          {translateRecentFeature("studyPlans.ui.stated-confidence.90113ab0")}<span className="text-[10px] opacity-75">{translateRecentFeature("studyPlans.ui.self-report-does-not-affect-.d997b45f")}</span>
        </span>
        {value !== undefined && (
          <span className="text-xs font-semibold text-primary dark:text-primary-dark">
            {(() => {
              const stop = CONFIDENCE_STOPS.find((item) => item.stop === value);
              return stop ? translateRecentFeature(stop.labelKey) : '';
            })()} ({Math.round(value * 100)}%)
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6" role="radiogroup" aria-label={translateRecentFeature("studyPlans.ui.confidence-level.4174c024")}>
        {CONFIDENCE_STOPS.map(({ stop, labelKey, percent }) => {
                    const isSelected = value === stop;
          const label = translateRecentFeature(labelKey);

          return (
            <button
              key={stop}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => onChange(stop)}
              className={`min-h-[44px] flex flex-col items-center justify-center p-1 rounded-lg text-xs font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                isSelected
                  ? 'bg-primary text-on-primary shadow-sm font-semibold'
                  : 'bg-surface-container-high dark:bg-surface-container-high-dark text-on-surface hover:bg-surface-container-highest border border-outline-variant/30'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              aria-label={translateRecentFeature("studyPlans.ui.var0-confidence-var1.0bcb31f1", {var0: percent, var1: label})}
            >
              <span className="text-xs">{percent}</span>
              <span className="text-[9px] truncate max-w-full px-0.5 opacity-80">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
