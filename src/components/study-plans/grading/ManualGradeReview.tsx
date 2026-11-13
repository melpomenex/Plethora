/**
 * Manual Rubric Grade Review and Override Modal.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.8
 * - openspec/changes/implement-rubric-based-exam-grading/tasks.md (C5-T06)
 *
 * Provides human educators and learners with full-criterion manual evaluation,
 * transparent reasoning input, live score preview, and atomic CAS persistence.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  PencilSimple,
  X,
  WarningCircle,
  Sparkle,
  BookOpen,
  User,
  ArrowRight,
} from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import type {
  AssessmentQuestionRevision,
  AnalyticRubric,
  RubricLevel,
} from '../../../types/assessmentQuestions';
import type {
  GradeRecord,
  GradeSettlementOutcome,
  RecordManualGradeInput,
  CriterionResult,
} from '../../../types/assessmentSessions';
import { calculateRubricScore } from '../../../lib/study-plans/grading/rubricAggregation';
import { recordManualGrade } from '../../../api/exam-grading';
import { ManualCriterionInput } from './ManualCriterionInput';
import { ManualGradeConfirmation } from './ManualGradeConfirmation';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";
import { studyErrorMessage } from "../../../lib/study-plans/studyErrorMessage";


export interface ManualGradeReviewProps {
  isOpen: boolean;
  attemptId: string;
  responseSubmissionId: string;
  expectedAttemptRevision: number;
  questionRevision: AssessmentQuestionRevision;
  studentResponse: string | any;
  sourceContext?: string | null;
  existingGrade?: GradeRecord | null;
  onClose: () => void;
  onGradeRecorded: (outcome: GradeSettlementOutcome) => void;
  recordManualGradeFn?: (input: RecordManualGradeInput) => Promise<GradeSettlementOutcome>;
  className?: string;
}

export const ManualGradeReview: React.FC<ManualGradeReviewProps> = ({
  isOpen,
  attemptId,
  responseSubmissionId,
  expectedAttemptRevision,
  questionRevision,
  studentResponse,
  sourceContext,
  existingGrade,
  onClose,
  onGradeRecorded,
  recordManualGradeFn = recordManualGrade,
  className = '',
}) => {
    useI18n();
    const q = questionRevision.question as any;
  const rubric = q.rubric as AnalyticRubric | undefined;
  const maxPoints = q.maxPoints ?? 0;

  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [selectedLevels, setSelectedLevels] = useState<Record<string, RubricLevel | null>>({});
  const [rationales, setRationales] = useState<Record<string, string>>({});
  const [manualReason, setManualReason] = useState('');
  const [feedback, setFeedback] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStaleRevision, setIsStaleRevision] = useState(false);

  // Initialize or reset state when opening modal
  useEffect(() => {
    if (!isOpen) {
      setStep('edit');
      setErrors({});
      setGeneralError(null);
      setIsSubmitting(false);
      setIsStaleRevision(false);
      return;
    }

    const initialLevels: Record<string, RubricLevel | null> = {};
    const initialRationales: Record<string, string> = {};

    // Prefill from existing valid criterion judgments if available
    if (existingGrade?.criteria && Array.isArray(existingGrade.criteria)) {
      for (const item of existingGrade.criteria) {
        if (
          'level' in item &&
          typeof item.level === 'number' &&
          Number.isInteger(item.level) &&
          item.level >= 0 &&
          item.level <= 4
        ) {
          initialLevels[item.criterionId] = item.level as RubricLevel;
        }
        if ('rationale' in item && item.rationale) {
          initialRationales[item.criterionId] = item.rationale;
        }
      }
    }

    setSelectedLevels(initialLevels);
    setRationales(initialRationales);
    setManualReason('');
    setFeedback(existingGrade?.assessment?.feedback || '');
  }, [isOpen, existingGrade]);

  // Handle escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  // Compute live score from current selections
  const computedScore = useMemo(() => {
    if (!rubric || !rubric.criteria) {
      return { points: 0, isFullyAssessed: false };
    }

    const critResults: CriterionResult[] = rubric.criteria.map((c) => {
      const lvl = selectedLevels[c.id];
      if (lvl !== null && lvl !== undefined) {
        return {
          criterionId: c.id,
          status: 'manual' as const,
          level: lvl,
          rationale: rationales[c.id] || null,
        };
      }
      return {
        criterionId: c.id,
        status: 'not-assessable' as const,
        reason: 'Pending manual evaluation',
      };
    });

    const score = calculateRubricScore(rubric, critResults, maxPoints);
    return {
      points: score.points ?? 0,
      isFullyAssessed: score.isFullyAssessed,
    };
  }, [rubric, selectedLevels, rationales, maxPoints]);

  const handleLevelChange = useCallback((criterionId: string, level: RubricLevel) => {
    setSelectedLevels((prev) => ({ ...prev, [criterionId]: level }));
    setErrors((prev) => {
      if (!prev[criterionId]) return prev;
      const next = { ...prev };
      delete next[criterionId];
      return next;
    });
  }, []);

  const handleRationaleChange = useCallback((criterionId: string, text: string) => {
    setRationales((prev) => ({ ...prev, [criterionId]: text }));
  }, []);

  const handleProceedToConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!rubric || !rubric.criteria || rubric.criteria.length === 0) {
      setGeneralError('Question rubric is missing or empty.');
      return;
    }

    // 1. Verify every criterion has a level 0..4
    for (const c of rubric.criteria) {
      const lvl = selectedLevels[c.id];
      if (lvl === null || lvl === undefined) {
        newErrors[c.id] = translateRecentFeature("studyPlans.ui.grade-criterion-level-required", { title: c.title });
      }
    }

    // 2. Verify nonempty manualReason
    if (!manualReason.trim()) {
      newErrors['manualReason'] = translateRecentFeature("studyPlans.ui.grade-reason-required");
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setGeneralError(translateRecentFeature("studyPlans.ui.grade-review-fields-required"));
      return;
    }

    setErrors({});
    setGeneralError(null);
    setStep('confirm');
  };

  const handleCommit = async () => {
    if (!rubric || !rubric.criteria) return;

    try {
      setIsSubmitting(true);
      setGeneralError(null);

      const criteriaPayload = rubric.criteria.map((c) => ({
        criterionId: c.id,
        level: selectedLevels[c.id] as number,
        rationale: rationales[c.id]?.trim() || null,
      }));

      const input: RecordManualGradeInput = {
        attemptId,
        responseSubmissionId,
        questionRevisionId: questionRevision.id,
        expectedAttemptRevision,
        manualReason: manualReason.trim(),
        criteria: criteriaPayload,
        feedback: feedback.trim() || null,
      };

      const outcome = await recordManualGradeFn(input);
      setIsSubmitting(false);
      onGradeRecorded(outcome);
      onClose();
    } catch (err: any) {
      setIsSubmitting(false);
      const msg = err?.message || String(err);
      if (msg.includes('stale') || err?.code === 'stale_attempt_revision') {
        setIsStaleRevision(true);
        setGeneralError(translateRecentFeature("studyPlans.ui.attempt-changed-reload-results"));
      } else {
        setGeneralError(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.operation-failed")));
      }
    }
  };

  if (!isOpen) return null;

  // Render Confirmation Step
  if (step === 'confirm' && rubric) {
    const confirmationCriteria = rubric.criteria.map((c) => {
      const lvl = selectedLevels[c.id] as number;
      const totalWeight = rubric.criteria.reduce((sum, item) => sum + item.weight, 0);
      const pointsContribution =
        totalWeight > 0 ? Number(((lvl / 4) * (c.weight / totalWeight) * maxPoints).toFixed(2)) : 0;

      return {
        criterionId: c.id,
        title: c.title,
        level: lvl,
        weight: c.weight,
        pointsContribution,
        rationale: rationales[c.id],
      };
    });

    return (
      <div
        className="adaptive-dialog-layer bg-black/60 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-review-confirmation-title"
      >
        <div className="adaptive-dialog-panel adaptive-dialog-centered study-plans-dialog-wide w-full max-w-2xl my-8 overflow-y-auto rounded-2xl">
          <ManualGradeConfirmation
            questionTitle={q.prompt}
            calculatedPoints={computedScore.points}
            maxPoints={maxPoints}
            criteria={confirmationCriteria}
            manualReason={manualReason}
            isSubmitting={isSubmitting}
            error={generalError}
            onConfirm={handleCommit}
            onBack={() => setStep('edit')}
          />
        </div>
      </div>
    );
  }

  // Render Edit Form Step
  return (
    <div
      className="adaptive-dialog-layer bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-review-title"
    >
      <div
        className={`adaptive-dialog-panel adaptive-dialog-centered study-plans-dialog-wide w-full max-w-3xl bg-surface dark:bg-surface-dark rounded-2xl border border-outline-variant/40 shadow-2xl overflow-hidden flex flex-col ${className}`}
        data-testid="manual-grade-review-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-outline-variant/30 shrink-0 bg-surface-container/30 dark:bg-surface-container-dark/30">
          <div className="space-y-0.5">
            <h2
              id="manual-review-title"
              className="text-base sm:text-lg font-bold text-on-surface flex items-center gap-2"
            >
              <PencilSimple size={20} className="text-primary" weight="bold" />
              {translateRecentFeature("studyPlans.ui.manual-grade-review-override.38f427f4")}</h2>
            <p className="text-xs text-on-surface-variant font-medium">
              {translateRecentFeature("studyPlans.ui.review-committed-rubric-crit.aea7fb52")}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50 transition-colors"
            aria-label={translateRecentFeature("studyPlans.ui.close-manual-review.b4cd9d29")}
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {/* Stale Revision Alert */}
          {isStaleRevision && (
            <div className="p-3.5 rounded-xl bg-error/10 border border-error/30 text-error text-xs flex items-center gap-2">
              <WarningCircle size={18} weight="fill" className="shrink-0" />
              <span>
                {translateRecentFeature("studyPlans.ui.the-examination-attempt-was-.13c981d9")}</span>
            </div>
          )}

          {/* General Error Alert */}
          {generalError && !isStaleRevision && (
            <div className="p-3.5 rounded-xl bg-error/10 border border-error/30 text-error text-xs flex items-center gap-2">
              <WarningCircle size={18} weight="fill" className="shrink-0" />
              <span>{generalError}</span>
            </div>
          )}

          {/* Question Prompt */}
          <div className="space-y-1.5 p-4 rounded-xl bg-surface-container-low/60 dark:bg-surface-container-low-dark/60 border border-outline-variant/30">
            <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
              <BookOpen size={14} className="text-primary" />
              {translateRecentFeature("studyPlans.ui.question-prompt.042a80b4")}</span>
            <p className="text-xs sm:text-sm font-medium text-on-surface leading-relaxed">
              {q.prompt}
            </p>
          </div>

          {/* Student's Verbatim Response */}
          <div className="space-y-1.5 p-4 rounded-xl bg-surface-container/40 dark:bg-surface-container-dark/40 border border-outline-variant/30">
            <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
              <User size={14} className="text-primary" />
              {translateRecentFeature("studyPlans.ui.learner-s-submitted-response.36a97cb5")}</span>
            <div
              className="text-xs sm:text-sm font-mono p-3 rounded-lg bg-surface dark:bg-surface-dark border border-outline-variant/20 text-on-surface whitespace-pre-wrap leading-relaxed select-text"
              data-testid="student-response-verbatim"
            >
              {typeof studentResponse === 'string'
                ? studentResponse || translateRecentFeature("i18nAudit.ui.no-response-provided.796a757d")
                : JSON.stringify(studentResponse, null, 2)}
            </div>
          </div>

          {/* Source Grounding Context if provided */}
          {sourceContext && (
            <div className="space-y-1 p-3 rounded-xl bg-surface-container-low dark:bg-surface-container-low-dark border border-outline-variant/20 text-xs">
              <span className="font-semibold text-on-surface-variant text-[11px] uppercase tracking-wider">
                {translateRecentFeature("studyPlans.ui.grounding-source-reference.f5afc4cd")}</span>
              <p className="text-on-surface-variant italic leading-relaxed">
                {sourceContext}
              </p>
            </div>
          )}

          {/* Advisory Notice regarding AI provenance */}
          {existingGrade?.origin === 'ai' && (
            <div className="p-3 rounded-xl bg-primary/5 dark:bg-primary/10 border border-primary/20 text-xs text-on-surface-variant flex items-center gap-2">
              <Sparkle size={16} className="text-primary shrink-0" weight="fill" />
              <span>
                {translateRecentFeature("studyPlans.ui.previous-automated-evaluatio.d85a8fd7")}</span>
            </div>
          )}

          {/* Rubric Criteria Evaluation Inputs */}
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-1">
              <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-on-surface">
                {translateRecentFeature("studyPlans.ui.committed-rubric-criteria.41670486")}</h3>

              <div className="text-right">
                <span className="text-xs text-on-surface-variant font-medium">
                  {translateRecentFeature("studyPlans.ui.projected-score.bab7c2fd")}{' '}
                </span>
                <span className="text-sm font-bold text-on-surface">{translateRecentFeature("studyPlans.ui.var0-var1-pts.097b763a", {var0: computedScore.points, var1: maxPoints})}</span>
              </div>
            </div>

            {(!rubric || !rubric.criteria || rubric.criteria.length === 0) ? (
              <p className="text-xs text-error font-medium p-3 rounded-lg bg-error/5 border border-error/20">
                {translateRecentFeature("studyPlans.ui.no-rubric-defined-for-this-q.7cf715f8")}</p>
            ) : (
              rubric.criteria.map((c) => (
                <ManualCriterionInput
                  key={c.id}
                  criterion={c}
                  selectedLevel={selectedLevels[c.id] ?? null}
                  rationale={rationales[c.id]}
                  disabled={isSubmitting || isStaleRevision}
                  error={errors[c.id]}
                  onLevelChange={(level) => handleLevelChange(c.id, level)}
                  onRationaleChange={(text) => handleRationaleChange(c.id, text)}
                />
              ))
            )}
          </div>

          {/* Mandatory Manual Reason Textarea */}
          <div className="space-y-1.5 pt-2">
            <label
              htmlFor="manual-reason-input"
              className="block text-xs font-bold text-on-surface uppercase tracking-wider"
            >
              {translateRecentFeature("studyPlans.ui.authoritative-reason-justifi.d133327d")}<span className="text-error">*</span>
            </label>
            <p className="text-xs text-on-surface-variant">
              {translateRecentFeature("studyPlans.ui.required-explanation-describ.b43606c6")}</p>
            <textarea
              id="manual-reason-input"
              data-testid="manual-reason-input"
              rows={3}
              value={manualReason}
              disabled={isSubmitting || isStaleRevision}
              onChange={(e) => {
                setManualReason(e.target.value);
                setErrors((prev) => {
                  if (!prev.manualReason) return prev;
                  const next = { ...prev };
                  delete next.manualReason;
                  return next;
                });
              }}
              placeholder={translateRecentFeature("studyPlans.ui.e-g-correct-reasoning-provid.ba7c4b67")}
              className={`w-full text-xs p-3 rounded-xl border bg-surface-container-low dark:bg-surface-container-low-dark text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all resize-y ${
                errors.manualReason
                  ? 'border-error/60 bg-error/5'
                  : 'border-outline-variant/40'
              }`}
              aria-label={translateRecentFeature("studyPlans.ui.authoritative-justification.f1d966e1")}
              required
            />
            {errors.manualReason && (
              <p className="text-xs text-error font-medium" role="alert">
                {errors.manualReason}
              </p>
            )}
          </div>

          {/* Optional Learner Feedback */}
          <div className="space-y-1.5 pt-1">
            <label
              htmlFor="manual-feedback-input"
              className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider text-[11px]"
            >
              {translateRecentFeature("studyPlans.ui.learner-feedback-optional.ae5119d9")}</label>
            <textarea
              id="manual-feedback-input"
              rows={2}
              value={feedback}
              disabled={isSubmitting || isStaleRevision}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={translateRecentFeature("studyPlans.ui.guidance-or-commentary-for-t.0c791ecd")}
              className="w-full text-xs p-2.5 rounded-xl border border-outline-variant/40 bg-surface-container-low dark:bg-surface-container-low-dark text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all resize-y"
              aria-label={translateRecentFeature("studyPlans.ui.learner-feedback.ba377b6d")}
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5 border-t border-outline-variant/30 shrink-0 bg-surface-container/30 dark:bg-surface-container-dark/30">
          <Button
            type="button"
            variant="text"
            onClick={onClose}
            disabled={isSubmitting}
            className="min-h-[40px] px-4 text-xs font-semibold"
          >
            {translateRecentFeature("common.cancel")}</Button>

          <Button
            type="button"
            variant="filled"
            onClick={handleProceedToConfirm}
            disabled={isSubmitting || isStaleRevision}
            className="min-h-[40px] px-5 text-xs font-bold shadow-sm"
          >
            <span>{translateRecentFeature("studyPlans.ui.proceed-to-confirmation.ac0f8c7f")}</span>
            <ArrowRight size={16} className="ml-1.5 inline" />
          </Button>
        </div>
      </div>
    </div>
  );
};
