/**
 * Practice Check Control Panel and Instant Feedback Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.7
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T06)
 */

import React, { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  Lightbulb,
  ArrowsClockwise,
  BookOpen,
} from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import type {
  PracticeCheckResult,
} from '../../../types/assessmentSessions';
import type { AssessmentQuestionRevision } from '../../../types/assessmentQuestions';
import type { ResponseSlotState } from '../../../lib/study-plans/attempts/attemptController';
import { checkPracticeResponse } from '../../../api/exam-sessions';
import { PracticeRoundHistory, type PracticeRoundItem } from './PracticeRoundHistory';

export interface PracticeCheckPanelProps {
  questionRevision: AssessmentQuestionRevision;
  attemptId: string;
  attemptRevision: number;
  slot: ResponseSlotState;
  hintLevel?: number;
  onCheckSuccess?: (result: PracticeCheckResult) => void;
  disabled?: boolean;
  className?: string;
}

export const PracticeCheckPanel: React.FC<PracticeCheckPanelProps> = ({
  questionRevision,
  attemptId,
  attemptRevision,
  slot,
  hintLevel = 0,
  onCheckSuccess,
  disabled = false,
  className = '',
}) => {
  const [isChecking, setIsChecking] = useState(false);
  const [latestResult, setLatestResult] = useState<PracticeCheckResult | null>(null);
  const [rounds, setRounds] = useState<PracticeRoundItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const qData = questionRevision.question;

  const handleCheck = async () => {
    setIsChecking(true);
    setError(null);

    try {
      const clientMutationId = `mut_prac_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const safeHintLevel = Number.isInteger(hintLevel) && hintLevel >= 0 && hintLevel <= 3 ? hintLevel : 0;
      const result = await checkPracticeResponse({
        attemptId,
        responseId: slot.responseId,
        expectedAttemptRevision: attemptRevision,
        clientMutationId,
        hintLevel: safeHintLevel,
        draft: slot.draft,
        mark: slot.mark,
        objectiveGrade: null,
      });

      setLatestResult(result);
      setRounds((prev) => [
        ...prev,
        {
          submission: result.submission,
          grade: result.grade,
        },
      ]);
      onCheckSuccess?.(result);
    } catch (err: any) {
      setError(err?.messageKey || err?.message || 'Failed to check practice response');
    } finally {
      setIsChecking(false);
    }
  };

  const grade = latestResult?.grade;
  const explanation = latestResult?.explanation ?? qData.explanation;
  const isCorrect = grade?.outcome === 'correct';
  const isPartial = grade?.outcome === 'partial';
  const isIncorrect = grade?.outcome === 'incorrect';
  const isPending = !grade || grade.outcome === 'pending';

  return (
    <div className={`space-y-4 pt-4 border-t border-outline-variant/30 ${className}`}>
      {/* Check Action Button */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs text-on-surface-variant dark:text-on-surface-variant-dark font-medium">
          Practice Mode: Check your answer instantly without affecting exam history.
        </span>

        <Button
          variant="filled"
          onClick={handleCheck}
          disabled={disabled || isChecking}
          className="min-h-[44px] min-w-[44px] px-5 bg-secondary hover:bg-secondary-dark text-on-secondary shadow-sm"
        >
          {isChecking ? (
            <>
              <ArrowsClockwise size={16} className="mr-1.5 animate-spin" />
              Checking...
            </>
          ) : (
            <>
              <CheckCircle size={16} className="mr-1.5" />
              Check Answer
            </>
          )}
        </Button>
      </div>

      {/* Error alert */}
      {error && (
        <div className="p-3 bg-error/10 border border-error/30 rounded-xl text-xs text-error dark:text-error-dark">
          {error}
        </div>
      )}

      {/* Latest Feedback Banner */}
      {latestResult && (
        <div
          className={`p-4 rounded-xl border flex items-start gap-3 text-sm ${
            isCorrect
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200'
              : isPartial
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200'
              : isIncorrect
              ? 'bg-error/10 border-error/30 text-error-900 dark:text-error-200'
              : 'bg-primary/10 border-primary/30 text-primary-900 dark:text-primary-200'
          }`}
          role="status"
          aria-live="polite"
        >
          {isCorrect ? (
            <CheckCircle size={22} className="text-emerald-500 shrink-0 mt-0.5" weight="fill" />
          ) : isPartial ? (
            <Lightbulb size={22} className="text-amber-500 shrink-0 mt-0.5" weight="fill" />
          ) : isIncorrect ? (
            <XCircle size={22} className="text-error shrink-0 mt-0.5" weight="fill" />
          ) : (
            <Lightbulb size={22} className="text-primary shrink-0 mt-0.5" weight="fill" />
          )}

          <div className="space-y-1">
            <span className="font-bold block">
              {isCorrect
                ? 'Correct!'
                : isPartial
                ? 'Partially Correct'
                : isIncorrect
                ? 'Not Quite'
                : 'Response Recorded'}
            </span>
            <p className="text-xs leading-relaxed opacity-90">
              {isCorrect && 'Great work! You scored full credit on this question.'}
              {isPartial && 'You received partial credit. Review the question and try again.'}
              {isIncorrect && 'Your answer does not match the expected answer. Review the explanation below and try another attempt.'}
              {isPending && 'This response requires rubric evaluation and will be scored during grading.'}
            </p>
          </div>
        </div>
      )}

      {/* Explanation & Grounding Card (Revealed after check) */}
      {latestResult && explanation && (
        <div className="p-4 bg-surface-container-low dark:bg-surface-container-low-dark rounded-xl border border-outline-variant/30 space-y-2">
          <h4 className="text-xs font-bold text-on-surface dark:text-on-surface-dark flex items-center gap-1.5 uppercase tracking-wide">
            <BookOpen size={16} className="text-primary dark:text-primary-dark" />
            Committed Explanation
          </h4>
          <p className="text-xs leading-relaxed text-on-surface-variant dark:text-on-surface-variant-dark whitespace-pre-line">
            {explanation}
          </p>
        </div>
      )}

      {/* Multi-round check history */}
      <PracticeRoundHistory rounds={rounds} />
    </div>
  );
};
