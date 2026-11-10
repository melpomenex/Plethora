/**
 * Single-Select Question Learner Input Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.6
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T05)
 */

import React from 'react';
import type {
  SingleSelectQuestion,
  LearnerConfidence,
} from '../../../types/assessmentQuestions';
import { ConfidenceSelector } from './ConfidenceSelector';

export interface SingleSelectInputProps {
  question: SingleSelectQuestion;
  selectedOptionId: string | null;
  confidence?: LearnerConfidence;
  onChangeOption: (optionId: string) => void;
  onChangeConfidence: (confidence: LearnerConfidence) => void;
  disabled?: boolean;
  className?: string;
}

export const SingleSelectInput: React.FC<SingleSelectInputProps> = ({
  question,
  selectedOptionId,
  confidence,
  onChangeOption,
  onChangeConfidence,
  disabled = false,
  className = '',
}) => {
  return (
    <div className={`space-y-6 ${className}`}>
      {/* Fieldset with Radio Options */}
      <fieldset className="space-y-3" disabled={disabled}>
        <legend className="text-base font-semibold text-on-surface dark:text-on-surface-dark mb-4 leading-relaxed">
          {question.prompt}
        </legend>

        <div className="space-y-2.5" role="radiogroup" aria-label="Answer options">
          {question.options.map((option, index) => {
            const isSelected = selectedOptionId === option.id;
            const letter = String.fromCharCode(65 + index); // A, B, C, D...

            return (
              <label
                key={option.id}
                className={`min-h-[48px] flex items-center gap-3.5 p-3.5 rounded-xl border cursor-pointer transition-all duration-150 focus-within:ring-2 focus-within:ring-primary ${
                  isSelected
                    ? 'bg-primary/10 border-primary text-primary dark:bg-primary-dark/15 dark:border-primary-dark dark:text-primary-dark font-medium shadow-sm'
                    : 'bg-surface-container-low dark:bg-surface-container-low-dark border-outline-variant/40 hover:bg-surface-container hover:border-outline-variant text-on-surface dark:text-on-surface-dark'
                } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <input
                  type="radio"
                  name={`question-${question.prompt}`}
                  value={option.id}
                  checked={isSelected}
                  onChange={() => onChangeOption(option.id)}
                  disabled={disabled}
                  className="sr-only"
                />

                <span
                  className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                    isSelected
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-high dark:bg-surface-container-high-dark text-on-surface-variant'
                  }`}
                  aria-hidden="true"
                >
                  {letter}
                </span>

                <span className="text-sm flex-1 leading-snug">{option.text}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Confidence Selector */}
      {selectedOptionId && (
        <ConfidenceSelector
          value={confidence}
          onChange={onChangeConfidence}
          disabled={disabled}
        />
      )}
    </div>
  );
};
