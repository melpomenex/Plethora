/**
 * Learner Self-Reported Confidence Selector.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.6
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T05)
 */

import React from 'react';
import type { LearnerConfidence } from '../../../types/assessmentQuestions';

export interface ConfidenceSelectorProps {
  value: LearnerConfidence | undefined;
  onChange: (value: LearnerConfidence) => void;
  disabled?: boolean;
  className?: string;
}

const CONFIDENCE_STOPS: Array<{ stop: LearnerConfidence; label: string; percent: string }> = [
  { stop: 0, label: 'No idea', percent: '0%' },
  { stop: 0.3, label: 'Uncertain', percent: '30%' },
  { stop: 0.5, label: 'Fifty-fifty', percent: '50%' },
  { stop: 0.7, label: 'Likely', percent: '70%' },
  { stop: 0.9, label: 'Very confident', percent: '90%' },
  { stop: 1, label: 'Certain', percent: '100%' },
];

export const ConfidenceSelector: React.FC<ConfidenceSelectorProps> = ({
  value,
  onChange,
  disabled = false,
  className = '',
}) => {
  return (
    <div
      className={`p-3 bg-surface-container-low dark:bg-surface-container-low-dark rounded-xl border border-outline-variant/30 ${className}`}
      role="group"
      aria-label="Self-reported confidence"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-on-surface-variant dark:text-on-surface-variant-dark">
          Stated Confidence <span className="text-[10px] opacity-75">(self-report, does not affect score)</span>
        </span>
        {value !== undefined && (
          <span className="text-xs font-semibold text-primary dark:text-primary-dark">
            {CONFIDENCE_STOPS.find((s) => s.stop === value)?.label} ({Math.round(value * 100)}%)
          </span>
        )}
      </div>

      <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label="Confidence level">
        {CONFIDENCE_STOPS.map(({ stop, label, percent }) => {
          const isSelected = value === stop;

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
              aria-label={`${percent} confidence - ${label}`}
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
