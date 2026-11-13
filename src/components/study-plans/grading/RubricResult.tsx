/**
 * Complete Rubric Assessment Result View.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.8
 * - openspec/changes/implement-rubric-based-exam-grading/tasks.md (C5-T05)
 */

import React from 'react';
import {
  Sparkle,
  PencilSimple,
  Lightbulb,
} from '@phosphor-icons/react';
import type { ShortAnswerQuestion, EssayQuestion } from '../../../types/assessmentQuestions';
import type { GradeRecord, RubricLimitation } from '../../../types/assessmentSessions';
import { RubricCriterionResult } from './RubricCriterionResult';
import { GradeProvenance } from './GradeProvenance';
import { GradeLimitations } from './GradeLimitations';
import { GradeHistory } from './GradeHistory';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface RubricResultProps {
  question: ShortAnswerQuestion | EssayQuestion;
  grade: GradeRecord;
  history?: GradeRecord[];
  onManualReviewClick?: () => void;
  className?: string;
}

export const RubricResult: React.FC<RubricResultProps> = ({
  question,
  grade,
  history = [],
  onManualReviewClick,
  className = '',
}) => {
        useI18n();
        const assessment = grade.assessment;
  const criteriaResults = grade.criteria || [];
  const criteriaMap = new Map(criteriaResults.map((c) => [c.criterionId, c]));

  const isFinal = grade.state === 'final';
  const isNeedsReview = grade.state === 'needs-review';

  const limitations = (grade as any).limitations as RubricLimitation[] | undefined;

  return (
    <div
      className={`space-y-4 pt-2 border-t border-outline-variant/30 ${className}`}
      data-testid="rubric-result"
    >
      {/* Rubric Score and Review Status Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-surface-container/50 dark:bg-surface-container-dark/50 border border-outline-variant/30">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-on-surface">
              {translateRecentFeature("studyPlans.ui.rubric-assessment.7890b78d")}</span>
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                isFinal
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                  : isNeedsReview
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30'
              }`}
            >
              {grade.state === 'final'
                ? translateRecentFeature("studyPlans.ui.final.c535ed76")
                : grade.state === 'needs-review'
                ? translateRecentFeature("studyPlans.ui.needs-review.5b4ea576")
                : translateRecentFeature("studyPlans.ui.failed.82e58636")}
            </span>
          </div>

          <p className="text-xs text-on-surface-variant">
            {isFinal
              ? translateRecentFeature("studyPlans.ui.criteria-evaluations-confirm.f82a430a")
              : isNeedsReview
              ? translateRecentFeature("studyPlans.ui.evaluation-flagged-for-human.2a397c30")
              : translateRecentFeature("studyPlans.ui.automated-evaluation-could-n.121d8d1c")}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-lg font-black text-on-surface">
              {grade.points !== null ? grade.points : '\u2014'}
            </span>
            <span className="text-xs text-on-surface-variant font-medium">
              {' '}{translateRecentFeature("studyPlans.ui.var0-pts.b9b87d13", {var0: grade.maxPoints})}</span>
            {isNeedsReview && (
              <span className="block text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                {translateRecentFeature("studyPlans.ui.awaiting-review.6e15ac5c")}</span>
            )}
          </div>

          {onManualReviewClick && (
            <button
              type="button"
              onClick={onManualReviewClick}
              className="px-3 py-1.5 rounded-lg border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <PencilSimple size={14} weight="bold" />
              {translateRecentFeature("studyPlans.ui.manual-review.d870dbe1")}</button>
          )}
        </div>
      </div>

      {/* Limitations Warnings */}
      <GradeLimitations limitations={limitations} />

      {/* Overall Model Assessment Feedback Envelope */}
      {assessment && (
        <div className="p-4 rounded-xl border border-outline-variant/30 bg-surface dark:bg-surface-dark space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
              <Sparkle size={14} className="text-primary" weight="fill" />
              {translateRecentFeature("studyPlans.ui.overall-feedback.98a9eb2a")}</span>

            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-bold capitalize ${
                assessment.classification === 'correct'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : assessment.classification === 'partial'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
              }`}
            >
              {assessment.classification}
            </span>
          </div>

          {assessment.feedback && (
            <p className="text-xs text-on-surface leading-relaxed">
              {assessment.feedback}
            </p>
          )}

          {assessment.suggestedCorrection && (
            <div className="p-2.5 rounded-lg bg-surface-container-high/40 dark:bg-surface-container-high-dark/40 border border-outline-variant/20 text-xs text-on-surface-variant space-y-0.5">
              <span className="font-semibold text-on-surface flex items-center gap-1 text-[11px]">
                <Lightbulb size={12} weight="fill" className="text-amber-500" />
                {translateRecentFeature("studyPlans.ui.correction-guidance.bfd2f5ce")}</span>
              <p className="italic">{assessment.suggestedCorrection}</p>
            </div>
          )}
        </div>
      )}

      {/* Per-Criterion Evaluated Cards */}
      <div className="space-y-3">
        <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant block">{translateRecentFeature("studyPlans.ui.committed-rubric-criteria-va.947b12f6", {var0: question.rubric.criteria.length})}</span>

        <div className="space-y-2.5">
          {question.rubric.criteria.map((crit) => (
            <RubricCriterionResult
              key={crit.id}
              criterion={crit}
              result={criteriaMap.get(crit.id)}
            />
          ))}
        </div>
      </div>

      {/* Provenance Footer */}
      <GradeProvenance
        provenance={grade.provenance}
        origin={grade.origin}
        manualReason={grade.manualReason}
      />

      {/* Grade History */}
      {history.length > 0 && <GradeHistory grades={history} />}
    </div>
  );
};
