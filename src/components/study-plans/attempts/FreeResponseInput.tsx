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
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


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
        useI18n();
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
          {isEssay ? translateRecentFeature("studyPlans.ui.long-form-essay-response.3b825f2b") : translateRecentFeature("studyPlans.ui.short-concise-answer.da56c042")}
        </span>
      </div>

      {/* Textarea */}
      <div className="space-y-1.5">
        <textarea
          rows={isEssay ? 10 : 4}
          value={text}
          onChange={(e) => onChangeText(e.target.value.slice(0, maxChars))}
          disabled={disabled}
          placeholder={isEssay ? translateRecentFeature("studyPlans.ui.compose-your-essay-response-.c5957a7d") : translateRecentFeature("studyPlans.ui.type-your-answer-here.cb698ac1")}
          className="w-full min-h-[120px] p-4 bg-surface-container-low dark:bg-surface-container-low-dark border border-outline-variant/60 rounded-xl text-sm leading-relaxed text-on-surface dark:text-on-surface-dark focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary disabled:opacity-60 resize-y"
          aria-label={isEssay ? translateRecentFeature("studyPlans.ui.essay-answer.82c53aac") : translateRecentFeature("studyPlans.ui.short-answer.e137a7c1")}
        />

        <div className="flex justify-end text-xs text-on-surface-variant dark:text-on-surface-variant-dark font-mono">
          <span>{translateRecentFeature("studyPlans.ui.var0-var1-characters.18f44fcb", {var0: currentChars.toLocaleString(), var1: maxChars.toLocaleString()})}</span>
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
