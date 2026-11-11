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
        newErrors[c.id] = `Please assign a level (0–4) for "${c.title}".`;
      }
    }

    // 2. Verify nonempty manualReason
    if (!manualReason.trim()) {
      newErrors['manualReason'] = 'A justification or reason is required for manual grading.';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setGeneralError('Please select all criterion levels and provide a justification.');
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
        setGeneralError('The attempt was modified concurrently. Please reload results to see the latest version.');
      } else {
        setGeneralError(msg || 'Failed to save manual grade override.');
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
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-review-confirmation-title"
      >
        <div className="w-full max-w-2xl my-8">
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-review-title"
    >
      <div
        className={`w-full max-w-3xl my-8 bg-surface dark:bg-surface-dark rounded-2xl border border-outline-variant/40 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${className}`}
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
              Manual Grade Review & Override
            </h2>
            <p className="text-xs text-on-surface-variant font-medium">
              Review committed rubric criteria and record an authoritative grade.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50 transition-colors"
            aria-label="Close manual review"
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
                The examination attempt was modified concurrently. Please reload results.
              </span>
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
              Question Prompt
            </span>
            <p className="text-xs sm:text-sm font-medium text-on-surface leading-relaxed">
              {q.prompt}
            </p>
          </div>

          {/* Student's Verbatim Response */}
          <div className="space-y-1.5 p-4 rounded-xl bg-surface-container/40 dark:bg-surface-container-dark/40 border border-outline-variant/30">
            <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
              <User size={14} className="text-primary" />
              Learner's Submitted Response
            </span>
            <div
              className="text-xs sm:text-sm font-mono p-3 rounded-lg bg-surface dark:bg-surface-dark border border-outline-variant/20 text-on-surface whitespace-pre-wrap leading-relaxed select-text"
              data-testid="student-response-verbatim"
            >
              {typeof studentResponse === 'string'
                ? studentResponse || '(No response provided)'
                : JSON.stringify(studentResponse, null, 2)}
            </div>
          </div>

          {/* Source Grounding Context if provided */}
          {sourceContext && (
            <div className="space-y-1 p-3 rounded-xl bg-surface-container-low dark:bg-surface-container-low-dark border border-outline-variant/20 text-xs">
              <span className="font-semibold text-on-surface-variant text-[11px] uppercase tracking-wider">
                Grounding Source Reference:
              </span>
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
                Previous automated evaluation is advisory. Human manual grading takes precedence.
              </span>
            </div>
          )}

          {/* Rubric Criteria Evaluation Inputs */}
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-1">
              <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-on-surface">
                Committed Rubric Criteria
              </h3>

              <div className="text-right">
                <span className="text-xs text-on-surface-variant font-medium">
                  Projected Score:{' '}
                </span>
                <span className="text-sm font-bold text-on-surface">
                  {computedScore.points} / {maxPoints} pts
                </span>
              </div>
            </div>

            {(!rubric || !rubric.criteria || rubric.criteria.length === 0) ? (
              <p className="text-xs text-error font-medium p-3 rounded-lg bg-error/5 border border-error/20">
                No rubric defined for this question.
              </p>
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
              Authoritative Reason / Justification <span className="text-error">*</span>
            </label>
            <p className="text-xs text-on-surface-variant">
              Required explanation describing why this manual score or override is being committed.
            </p>
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
              placeholder="e.g. Correct reasoning provided using alternative phrasing not recognized by automated prompt..."
              className={`w-full text-xs p-3 rounded-xl border bg-surface-container-low dark:bg-surface-container-low-dark text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all resize-y ${
                errors.manualReason
                  ? 'border-error/60 bg-error/5'
                  : 'border-outline-variant/40'
              }`}
              aria-label="Authoritative justification"
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
              Learner Feedback (Optional)
            </label>
            <textarea
              id="manual-feedback-input"
              rows={2}
              value={feedback}
              disabled={isSubmitting || isStaleRevision}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Guidance or commentary for the learner..."
              className="w-full text-xs p-2.5 rounded-xl border border-outline-variant/40 bg-surface-container-low dark:bg-surface-container-low-dark text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all resize-y"
              aria-label="Learner feedback"
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
            Cancel
          </Button>

          <Button
            type="button"
            variant="filled"
            onClick={handleProceedToConfirm}
            disabled={isSubmitting || isStaleRevision}
            className="min-h-[40px] px-5 text-xs font-bold shadow-sm"
          >
            <span>Proceed to Confirmation</span>
            <ArrowRight size={16} className="ml-1.5 inline" />
          </Button>
        </div>
      </div>
    </div>
  );
};
