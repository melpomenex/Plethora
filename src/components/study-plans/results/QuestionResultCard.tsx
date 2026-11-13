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
  ShortAnswerQuestion,
  EssayQuestion,
} from '../../../types/assessmentQuestions';
import type { GradeRecord, ResponseMark } from '../../../types/assessmentSessions';
import type { StudySourceRefV1 } from '../../../types/studySource';
import { AttemptSourceAction } from './AttemptSourceAction';
import { RubricResult } from '../grading/RubricResult';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface QuestionResultCardProps {
  questionNumber: number;
  questionRevision: AssessmentQuestionRevision;
  responseDraft: AssessmentResponse;
  responseMark: ResponseMark;
  grade?: GradeRecord | null;
  history?: GradeRecord[];
  onManualReviewClick?: () => void;
  sourceRefs?: StudySourceRefV1[];
  className?: string;
}

export const QuestionResultCard: React.FC<QuestionResultCardProps> = ({
  questionNumber,
  questionRevision,
  responseDraft,
  responseMark,
  grade,
  history = [],
  onManualReviewClick,
  sourceRefs = [],
  className = '',
}) => {
        useI18n();
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
          <span className="px-2.5 py-1 bg-surface-container-high dark:bg-surface-container-high-dark font-bold text-xs rounded-lg text-on-surface">{translateRecentFeature("studyPlans.ui.question-var0.55fd818d", {var0: questionNumber})}</span>
          <span className="text-xs text-on-surface-variant capitalize">
            {qData.kind.replace('-', ' ')}
          </span>
          <span className="text-xs text-on-surface-variant font-medium">{translateRecentFeature("studyPlans.ui.diff-var0.57707f84", {var0: qData.difficulty})}</span>
        </div>

        {/* Outcome & Points Badge */}
        <div className="flex items-center gap-3">
          {confidencePercent && (
            <span className="text-xs text-on-surface-variant font-medium">{translateRecentFeature("studyPlans.ui.stated-confidence-var0.fe57efa3", {var0: confidencePercent})}</span>
          )}

          <div className="flex items-center gap-1.5">
            {isCorrect ? (
              <CheckCircle size={18} className="text-emerald-500 shrink-0" weight="fill" />
            ) : isPartial ? (
              <WarningCircle size={18} className="text-amber-500 shrink-0" weight="fill" />
            ) : isIncorrect ? (
              <XCircle size={18} className="text-error shrink-0" weight="fill" />
            ) : isSkipped ? (
              <span className="text-xs font-bold text-on-surface-variant">{translateRecentFeature("studyPlans.ui.skipped.76bc3e23")}</span>
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
                ? translateRecentFeature("i18nAudit.ui.var0-var1-pts.67bf563a", {var0: grade.points, var1: qData.maxPoints})
                : translateRecentFeature("i18nAudit.ui.var0-pts.ec48db9e", {var0: qData.maxPoints})}
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
          {translateRecentFeature("studyPlans.ui.your-response.f10036a4")}</span>

        {responseDraft.kind === 'single-select' && (
          <p className="text-sm font-medium text-on-surface dark:text-on-surface-dark">
            {qData.kind === 'single-select' && responseDraft.optionId
              ? qData.options.find((o) => o.id === responseDraft.optionId)?.text || responseDraft.optionId
              : translateRecentFeature("studyPlans.ui.no-option-selected.bac3433e")}
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
              <li>{translateRecentFeature("studyPlans.ui.no-options-selected.08e22b42")}</li>
            )}
          </ul>
        )}

        {responseDraft.kind === 'cloze' && (
          <div className="text-sm font-medium text-on-surface dark:text-on-surface-dark space-y-1">
            {Object.entries(responseDraft.answers).map(([bId, ans], bIdx) => {
                            return (
              <span key={bId} className="inline-block mr-3">{translateRecentFeature("studyPlans.ui.blank-var0.8538d746", {var0: bIdx + 1})}<strong className="font-semibold">{ans || translateRecentFeature("i18nAudit.ui.empty.70c9be9c")}</strong>
              </span>
            );
            })}
          </div>
        )}

        {(responseDraft.kind === 'short-answer' || responseDraft.kind === 'essay') && (
          <p className="text-sm leading-relaxed text-on-surface dark:text-on-surface-dark whitespace-pre-wrap">
            {responseDraft.text || translateRecentFeature("i18nAudit.ui.empty.70c9be9c")}
          </p>
        )}
      </div>

      {/* Expected Answer / Committed Solution */}
      <div className="p-3.5 bg-surface-container-high/40 dark:bg-surface-container-high-dark/40 rounded-xl space-y-1 text-xs">
        <span className="font-semibold text-on-surface-variant dark:text-on-surface-variant-dark block">
          {translateRecentFeature("studyPlans.ui.expected-answer.6f018c59")}</span>
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
            {qData.blanks.map((b, bIdx) => {
                            return (
              <span key={b.id} className="inline-block mr-3">{translateRecentFeature("studyPlans.ui.blank-var0.8538d746", {var0: bIdx + 1})}{b.acceptedAnswers.join(' / ')}
              </span>
            );
            })}
          </div>
        )}

        {qData.kind === 'short-answer' && (
          <p className="text-sm font-medium text-on-surface dark:text-on-surface-dark">
            {translateRecentFeature("studyPlans.ui.reference-answer.1b3250e3")}<span className="font-semibold text-emerald-700 dark:text-emerald-300">{qData.referenceAnswer}</span>
          </p>
        )}

        {qData.kind === 'essay' && (
          <p className="text-sm font-medium text-on-surface dark:text-on-surface-dark">
            {translateRecentFeature("studyPlans.ui.expected-reasoning.b28678d4")}<span className="font-normal">{qData.expectedReasoning}</span>
          </p>
        )}
      </div>

      {/* Explanation */}
      {qData.explanation && (
        <div className="space-y-1 text-xs">
          <span className="font-semibold text-on-surface-variant dark:text-on-surface-variant-dark block uppercase tracking-wider text-[10px]">
            {translateRecentFeature("studyPlans.ui.explanation.60cbf6b2")}</span>
          <p className="text-xs leading-relaxed text-on-surface dark:text-on-surface-dark">
            {qData.explanation}
          </p>
        </div>
      )}

      {/* Rubric Assessment Result for Subjective Questions */}
      {(qData.kind === 'short-answer' || qData.kind === 'essay') && grade && (
        <RubricResult
          question={qData as ShortAnswerQuestion | EssayQuestion}
          grade={grade}
          history={history}
          onManualReviewClick={onManualReviewClick}
        />
      )}

      {/* Grounding Source Citations */}
      {sourceRefs.length > 0 && (
        <div className="pt-2 border-t border-outline-variant/30 space-y-2">
          <span className="text-[11px] font-bold text-on-surface-variant dark:text-on-surface-variant-dark flex items-center gap-1.5 uppercase">
            <BookOpen size={14} className="text-primary dark:text-primary-dark" />
            {translateRecentFeature("studyPlans.ui.grounding-sources.59d3db36")}</span>
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
