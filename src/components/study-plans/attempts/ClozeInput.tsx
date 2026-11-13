/**
 * Cloze (Fill-in-the-Blank) Question Learner Input Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.6
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T05)
 */

import React from 'react';
import type {
  ClozeQuestion,
  LearnerConfidence,
} from '../../../types/assessmentQuestions';
import { ConfidenceSelector } from './ConfidenceSelector';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface ClozeInputProps {
  question: ClozeQuestion;
  answers: Record<string, string>;
  confidence?: LearnerConfidence;
  onChangeBlank: (blankId: string, value: string) => void;
  onChangeConfidence: (confidence: LearnerConfidence) => void;
  disabled?: boolean;
  className?: string;
}

export const ClozeInput: React.FC<ClozeInputProps> = ({
  question,
  answers,
  confidence,
  onChangeBlank,
  onChangeConfidence,
  disabled = false,
  className = '',
}) => {
  useI18n();
  const hasAnyAnswer = Object.values(answers).some((v) => v.trim().length > 0);

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Question Prompt */}
      {question.prompt && (
        <h3 className="text-base font-semibold text-on-surface dark:text-on-surface-dark mb-4 leading-relaxed">
          {question.prompt}
        </h3>
      )}

      {/* Segmented Passage with Inline Blanks */}
      <div className="p-4 bg-surface-container-low dark:bg-surface-container-low-dark rounded-xl border border-outline-variant/30 leading-loose text-base text-on-surface dark:text-on-surface-dark">
        {question.segments.map((seg, idx) => {
                    if (seg.kind === 'text') {
            return <span key={idx}>{seg.text}</span>;
          }

          const blank = question.blanks.find((b) => b.id === seg.blankId);
          const currentVal = answers[seg.blankId] || '';

          return (
            <span key={idx} className="inline-block mx-1.5 my-1">
              <input
                type="text"
                value={currentVal}
                onChange={(e) => onChangeBlank(seg.blankId, e.target.value)}
                disabled={disabled}
                placeholder={translateRecentFeature("studyPlans.ui.blank.3c5bf21d")}
                className="min-h-[44px] min-w-[120px] px-3 py-1.5 text-sm bg-surface-container-high dark:bg-surface-container-high-dark border border-outline-variant rounded-lg text-on-surface dark:text-on-surface-dark focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary disabled:opacity-60"
                aria-label={translateRecentFeature("studyPlans.ui.blank-var0.fbe2ee84", {var0: blank ? question.blanks.indexOf(blank) + 1 : idx + 1})}
              />
            </span>
          );
        })}
      </div>

      {/* Confidence Selector */}
      {hasAnyAnswer && (
        <ConfidenceSelector
          value={confidence}
          onChange={onChangeConfidence}
          disabled={disabled}
        />
      )}
    </div>
  );
};
