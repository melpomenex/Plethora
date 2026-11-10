/**
 * Question Result Inspection Card Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.8
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T07)
 */

import React from 'react';
import {
  CheckCircle,
  XCircle,
  WarningCircle,
  Clock,
  BookOpen,
} from '@phosphor-icons/react';
import type {
  AssessmentQuestionRevision,
  AssessmentResponse,
} from '../../../types/assessmentQuestions';
import type { GradeRecord, ResponseMark } from '../../../types/assessmentSessions';
import type { StudySourceRefV1 } from '../../../types/studySource';
import { AttemptSourceAction } from './AttemptSourceAction';

export interface QuestionResultCardProps {
  questionNumber: number;
  questionRevision: AssessmentQuestionRevision;
  responseDraft: AssessmentResponse;
  responseMark: ResponseMark;
  grade?: GradeRecord | null;
  sourceRefs?: StudySourceRefV1[];
  className?: string;
}

export const QuestionResultCard: React.FC<QuestionResultCardProps> = ({
  questionNumber,
  questionRevision,
  responseDraft,
  responseMark,
  grade,
  sourceRefs = [],
  className = '',
}) => {
  const qData = questionRevision.question;
  const outcome = grade?.outcome || (responseMark === 'skipped' ? 'skipped' : 'pending');

  const isCorrect = outcome === 'correct';
  const isPartial = outcome === 'partial';
  const isIncorrect = outcome === 'incorrect';
  const isSkipped = outcome === 'skipped';

  const confidenceVal = responseDraft.confidence;
  const confidencePercent = confidenceVal !== undefined ? `${Math.round(confidenceVal * 100)}%` : null;

  return (
    <div
      className={`p-5 sm:p-6 bg-surface dark:bg-surface-dark border rounded-2xl shadow-sm space-y-5 ${
        isCorrect
          ? 'border-emerald-500/30'
          : isPartial
          ? 'border-amber-500/30'
          : isIncorrect
          ? 'border-error/30'
          : 'border-outline-variant/40'
      } ${className}`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-outline-variant/30">
        <div className="flex items-center gap-2.5">
          <span className="px-2.5 py-1 bg-surface-container-high dark:bg-surface-container-high-dark font-bold text-xs rounded-lg text-on-surface">
            Question {questionNumber}
          </span>
          <span className="text-xs text-on-surface-variant capitalize">
            {qData.kind.replace('-', ' ')}
          </span>
          <span className="text-xs text-on-surface-variant font-medium">
            (Diff: {qData.difficulty})
          </span>
        </div>

        {/* Outcome & Points Badge */}
        <div className="flex items-center gap-3">
          {confidencePercent && (
            <span className="text-xs text-on-surface-variant font-medium">
              Stated confidence: {confidencePercent}
            </span>
          )}

          <div className="flex items-center gap-1.5">
            {isCorrect ? (
              <CheckCircle size={18} className="text-emerald-500 shrink-0" weight="fill" />
            ) : isPartial ? (
              <WarningCircle size={18} className="text-amber-500 shrink-0" weight="fill" />
            ) : isIncorrect ? (
              <XCircle size={18} className="text-error shrink-0" weight="fill" />
            ) : isSkipped ? (
              <span className="text-xs font-bold text-on-surface-variant">Skipped</span>
            ) : (
              <Clock size={18} className="text-primary dark:text-primary-dark shrink-0" />
            )}

            <span
              className={`px-2 py-0.5 rounded text-xs font-bold capitalize ${
                isCorrect
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : isPartial
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : isIncorrect
                  ? 'bg-error/10 text-error dark:text-error-dark'
                  : isSkipped
                  ? 'bg-surface-container-high text-on-surface-variant'
                  : 'bg-primary/10 text-primary dark:bg-primary-dark/20 dark:text-primary-dark'
              }`}
            >
              {outcome}
            </span>

            <span className="text-xs font-bold text-on-surface dark:text-on-surface-dark ml-1">
              {grade?.points !== null && grade?.points !== undefined
                ? `${grade.points} / ${qData.maxPoints} pts`
                : `-- / ${qData.maxPoints} pts`}
            </span>
          </div>
        </div>
      </div>

      {/* Prompt */}
      <h3 className="text-base font-semibold text-on-surface dark:text-on-surface-dark leading-relaxed">
        {qData.prompt}
      </h3>

      {/* Learner's Submitted Response */}
      <div className="p-3.5 bg-surface-container-low dark:bg-surface-container-low-dark rounded-xl border border-outline-variant/30 space-y-1.5 text-xs">
        <span className="font-semibold text-on-surface-variant dark:text-on-surface-variant-dark block">
          Your Response:
        </span>

        {responseDraft.kind === 'single-select' && (
          <p className="text-sm font-medium text-on-surface dark:text-on-surface-dark">
            {qData.kind === 'single-select' && responseDraft.optionId
              ? qData.options.find((o) => o.id === responseDraft.optionId)?.text || responseDraft.optionId
              : 'No option selected'}
          </p>
        )}

        {responseDraft.kind === 'multi-select' && (
          <ul className="list-disc list-inside space-y-0.5 text-sm font-medium text-on-surface dark:text-on-surface-dark">
            {qData.kind === 'multi-select' && responseDraft.optionIds.length > 0 ? (
              responseDraft.optionIds.map((optId) => {
                const optText = qData.options.find((o) => o.id === optId)?.text || optId;
                return <li key={optId}>{optText}</li>;
              })
            ) : (
              <li>No options selected</li>
            )}
          </ul>
        )}

        {responseDraft.kind === 'cloze' && (
          <div className="text-sm font-medium text-on-surface dark:text-on-surface-dark space-y-1">
            {Object.entries(responseDraft.answers).map(([bId, ans], bIdx) => (
              <span key={bId} className="inline-block mr-3">
                Blank {bIdx + 1}: <strong className="font-semibold">{ans || '(empty)'}</strong>
              </span>
            ))}
          </div>
        )}

        {(responseDraft.kind === 'short-answer' || responseDraft.kind === 'essay') && (
          <p className="text-sm leading-relaxed text-on-surface dark:text-on-surface-dark whitespace-pre-wrap">
            {responseDraft.text || '(empty)'}
          </p>
        )}
      </div>

      {/* Expected Answer / Committed Solution */}
      <div className="p-3.5 bg-surface-container-high/40 dark:bg-surface-container-high-dark/40 rounded-xl space-y-1 text-xs">
        <span className="font-semibold text-on-surface-variant dark:text-on-surface-variant-dark block">
          Expected Answer:
        </span>
        {qData.kind === 'single-select' && (
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            {qData.options.find((o) => o.id === qData.correctOptionId)?.text || qData.correctOptionId}
          </p>
        )}

        {qData.kind === 'multi-select' && (
          <ul className="list-disc list-inside space-y-0.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            {qData.correctOptionIds.map((optId) => (
              <li key={optId}>{qData.options.find((o) => o.id === optId)?.text || optId}</li>
            ))}
          </ul>
        )}

        {qData.kind === 'cloze' && (
          <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 space-y-0.5">
            {qData.blanks.map((b, bIdx) => (
              <span key={b.id} className="inline-block mr-3">
                Blank {bIdx + 1}: {b.acceptedAnswers.join(' / ')}
              </span>
            ))}
          </div>
        )}

        {qData.kind === 'short-answer' && (
          <p className="text-sm font-medium text-on-surface dark:text-on-surface-dark">
            Reference Answer: <span className="font-semibold text-emerald-700 dark:text-emerald-300">{qData.referenceAnswer}</span>
          </p>
        )}

        {qData.kind === 'essay' && (
          <p className="text-sm font-medium text-on-surface dark:text-on-surface-dark">
            Expected Reasoning: <span className="font-normal">{qData.expectedReasoning}</span>
          </p>
        )}
      </div>

      {/* Explanation */}
      {qData.explanation && (
        <div className="space-y-1 text-xs">
          <span className="font-semibold text-on-surface-variant dark:text-on-surface-variant-dark block uppercase tracking-wider text-[10px]">
            Explanation
          </span>
          <p className="text-xs leading-relaxed text-on-surface dark:text-on-surface-dark">
            {qData.explanation}
          </p>
        </div>
      )}

      {/* Grounding Source Citations */}
      {sourceRefs.length > 0 && (
        <div className="pt-2 border-t border-outline-variant/30 space-y-2">
          <span className="text-[11px] font-bold text-on-surface-variant dark:text-on-surface-variant-dark flex items-center gap-1.5 uppercase">
            <BookOpen size={14} className="text-primary dark:text-primary-dark" />
            Grounding Sources
          </span>
          <div className="flex flex-wrap gap-2">
            {sourceRefs.map((ref) => (
              <AttemptSourceAction key={ref.id} sourceRef={ref} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
