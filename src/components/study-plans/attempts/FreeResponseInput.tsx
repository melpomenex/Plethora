/**
 * Free-Response (Short-Answer / Essay) Learner Input Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.6
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T05)
 */

import React from 'react';
import type {
  ShortAnswerQuestion,
  EssayQuestion,
  LearnerConfidence,
} from '../../../types/assessmentQuestions';
import { ConfidenceSelector } from './ConfidenceSelector';

export interface FreeResponseInputProps {
  question: ShortAnswerQuestion | EssayQuestion;
  text: string;
  confidence?: LearnerConfidence;
  onChangeText: (text: string) => void;
  onChangeConfidence: (confidence: LearnerConfidence) => void;
  disabled?: boolean;
  className?: string;
}

export const FreeResponseInput: React.FC<FreeResponseInputProps> = ({
  question,
  text,
  confidence,
  onChangeText,
  onChangeConfidence,
  disabled = false,
  className = '',
}) => {
  const isEssay = question.kind === 'essay';
  const maxChars = isEssay ? 60000 : 20000;
  const currentChars = text.length;

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Prompt */}
      <div>
        <h3 className="text-base font-semibold text-on-surface dark:text-on-surface-dark mb-2 leading-relaxed">
          {question.prompt}
        </h3>
        <span className="text-xs text-on-surface-variant dark:text-on-surface-variant-dark">
          {isEssay ? 'Long-form essay response' : 'Short concise answer'}
        </span>
      </div>

      {/* Textarea */}
      <div className="space-y-1.5">
        <textarea
          rows={isEssay ? 10 : 4}
          value={text}
          onChange={(e) => onChangeText(e.target.value.slice(0, maxChars))}
          disabled={disabled}
          placeholder={isEssay ? 'Compose your essay response here...' : 'Type your answer here...'}
          className="w-full min-h-[120px] p-4 bg-surface-container-low dark:bg-surface-container-low-dark border border-outline-variant/60 rounded-xl text-sm leading-relaxed text-on-surface dark:text-on-surface-dark focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary disabled:opacity-60 resize-y"
          aria-label={isEssay ? 'Essay answer' : 'Short answer'}
        />

        <div className="flex justify-end text-xs text-on-surface-variant dark:text-on-surface-variant-dark font-mono">
          <span>
            {currentChars.toLocaleString()} / {maxChars.toLocaleString()} characters
          </span>
        </div>
      </div>

      {/* Confidence Selector */}
      {text.trim().length > 0 && (
        <ConfidenceSelector
          value={confidence}
          onChange={onChangeConfidence}
          disabled={disabled}
        />
      )}
    </div>
  );
};
