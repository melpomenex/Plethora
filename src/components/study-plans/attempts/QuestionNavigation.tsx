/**
 * Question Navigation Map and Sequential Controls.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.6
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T05)
 */

import React from 'react';
import { ArrowLeft, ArrowRight, Flag } from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import type { ResponseSlotState } from '../../../lib/study-plans/attempts/attemptController';
import type { AssessmentQuestionRevision } from '../../../types/assessmentQuestions';

export interface QuestionNavigationProps {
  questions: AssessmentQuestionRevision[];
  slots: Record<string, ResponseSlotState>;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  className?: string;
}

export const QuestionNavigation: React.FC<QuestionNavigationProps> = ({
  questions,
  slots,
  selectedIndex,
  onSelectIndex,
  className = '',
}) => {
  const total = questions.length;
  const hasPrev = selectedIndex > 0;
  const hasNext = selectedIndex < total - 1;

  return (
    <div className={`space-y-4 ${className}`} role="navigation" aria-label="Question Navigation">
      {/* Sequential Next / Prev Controls */}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outlined"
          onClick={() => onSelectIndex(selectedIndex - 1)}
          disabled={!hasPrev}
          className="min-h-[44px] min-w-[44px] px-4"
          aria-label="Previous Question"
        >
          <ArrowLeft size={18} className="mr-1.5 inline" />
          Previous
        </Button>

        <span className="text-xs font-semibold text-on-surface-variant dark:text-on-surface-variant-dark">
          {selectedIndex + 1} / {total}
        </span>

        <Button
          variant="filled"
          onClick={() => onSelectIndex(selectedIndex + 1)}
          disabled={!hasNext}
          className="min-h-[44px] min-w-[44px] px-4"
          aria-label="Next Question"
        >
          Next
          <ArrowRight size={18} className="ml-1.5 inline" />
        </Button>
      </div>

      {/* Grid of Question Number Buttons */}
      <div
        className="flex flex-wrap gap-2 p-3 bg-surface-container-low dark:bg-surface-container-low-dark rounded-xl border border-outline-variant/30 max-h-48 overflow-y-auto"
        role="group"
        aria-label="Question Map"
      >
        {questions.map((q, idx) => {
          const slot = slots[q.id];
          const isSelected = idx === selectedIndex;
          const isAnswered = slot?.mark === 'answered';
          const isSkipped = slot?.mark === 'skipped';

          let stateLabel = 'Unanswered';
          if (isAnswered) stateLabel = 'Answered';
          if (isSkipped) stateLabel = 'Skipped';

          return (
            <button
              key={q.id}
              type="button"
              onClick={() => onSelectIndex(idx)}
              className={`relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-sm font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                isSelected
                  ? 'bg-primary text-on-primary ring-2 ring-primary/40 shadow-sm'
                  : isAnswered
                  ? 'bg-primary/15 text-primary dark:bg-primary-dark/25 dark:text-primary-dark border border-primary/30'
                  : isSkipped
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                  : 'bg-surface-container-high dark:bg-surface-container-high-dark text-on-surface hover:bg-surface-container-highest border border-outline-variant/40'
              }`}
              aria-label={`Question ${idx + 1}: ${stateLabel}${isSelected ? ' (Current)' : ''}`}
              aria-current={isSelected ? 'true' : undefined}
            >
              <span>{idx + 1}</span>
              {isSkipped && (
                <Flag
                  size={10}
                  weight="fill"
                  className="absolute top-1 right-1 text-amber-500"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
