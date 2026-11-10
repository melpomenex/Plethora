/**
 * Multi-Select Question Learner Input Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.6
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T05)
 */

import React from 'react';
import { Info, Check } from '@phosphor-icons/react';
import type {
  MultiSelectQuestion,
  LearnerConfidence,
} from '../../../types/assessmentQuestions';
import { ConfidenceSelector } from './ConfidenceSelector';

export interface MultiSelectInputProps {
  question: MultiSelectQuestion;
  selectedOptionIds: string[];
  confidence?: LearnerConfidence;
  onToggleOption: (optionId: string) => void;
  onChangeConfidence: (confidence: LearnerConfidence) => void;
  disabled?: boolean;
  className?: string;
}

export const MultiSelectInput: React.FC<MultiSelectInputProps> = ({
  question,
  selectedOptionIds,
  confidence,
  onToggleOption,
  onChangeConfidence,
  disabled = false,
  className = '',
}) => {
  return (
    <div className={`space-y-6 ${className}`}>
      {/* Notice about all-or-nothing grading */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-container-high/60 dark:bg-surface-container-high-dark/60 rounded-lg text-xs text-on-surface-variant dark:text-on-surface-variant-dark border border-outline-variant/30">
        <Info size={16} className="text-primary dark:text-primary-dark shrink-0" />
        <span>Select all that apply. Scoring is all-or-nothing (all correct options required for credit).</span>
      </div>

      {/* Fieldset with Checkboxes */}
      <fieldset className="space-y-3" disabled={disabled}>
        <legend className="text-base font-semibold text-on-surface dark:text-on-surface-dark mb-4 leading-relaxed">
          {question.prompt}
        </legend>

        <div className="space-y-2.5" role="group" aria-label="Answer options">
          {question.options.map((option, index) => {
            const isChecked = selectedOptionIds.includes(option.id);
            const letter = String.fromCharCode(65 + index);

            return (
              <label
                key={option.id}
                className={`min-h-[48px] flex items-center gap-3.5 p-3.5 rounded-xl border cursor-pointer transition-all duration-150 focus-within:ring-2 focus-within:ring-primary ${
                  isChecked
                    ? 'bg-primary/10 border-primary text-primary dark:bg-primary-dark/15 dark:border-primary-dark dark:text-primary-dark font-medium shadow-sm'
                    : 'bg-surface-container-low dark:bg-surface-container-low-dark border-outline-variant/40 hover:bg-surface-container hover:border-outline-variant text-on-surface dark:text-on-surface-dark'
                } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <input
                  type="checkbox"
                  name={`question-${question.prompt}`}
                  value={option.id}
                  checked={isChecked}
                  onChange={() => onToggleOption(option.id)}
                  disabled={disabled}
                  className="sr-only"
                />

                <span
                  className={`w-6 h-6 rounded-md flex items-center justify-center border text-xs font-bold shrink-0 transition-colors ${
                    isChecked
                      ? 'bg-primary border-primary text-on-primary'
                      : 'border-outline-variant bg-surface-container-high dark:bg-surface-container-high-dark text-transparent'
                  }`}
                  aria-hidden="true"
                >
                  <Check size={14} weight="bold" />
                </span>

                <span className="text-xs font-bold text-on-surface-variant shrink-0" aria-hidden="true">
                  {letter}.
                </span>

                <span className="text-sm flex-1 leading-snug">{option.text}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Confidence Selector */}
      {selectedOptionIds.length > 0 && (
        <ConfidenceSelector
          value={confidence}
          onChange={onChangeConfidence}
          disabled={disabled}
        />
      )}
    </div>
  );
};
