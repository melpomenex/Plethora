/**
 * Learner Grade Challenge and Manual Review Request Form.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.8
 * - openspec/changes/implement-rubric-based-exam-grading/tasks.md (C5-T06)
 *
 * Allows learner to request manual educator re-evaluation with explicit reasoning.
 */

import React, { useState } from 'react';
import {
  WarningCircle,
  PaperPlaneTilt,
  X,
  ChatText,
} from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import type { GradeRecord } from '../../../types/assessmentSessions';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";
import { studyErrorMessage } from "../../../lib/study-plans/studyErrorMessage";


export interface GradeChallengeFormProps {
  questionTitle?: string;
  currentGrade?: GradeRecord | null;
  onSubmitChallenge: (payload: { reason: string; notes?: string }) => Promise<void> | void;
  onClose: () => void;
  isSubmitting?: boolean;
  className?: string;
}

export const GradeChallengeForm: React.FC<GradeChallengeFormProps> = ({
  questionTitle,
  currentGrade,
  onSubmitChallenge,
  onClose,
  isSubmitting = false,
  className = '',
}) => {
        useI18n();
        const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError(translateRecentFeature("studyPlans.ui.please-provide-an-explanatio.b756877f"));
      return;
    }

    try {
      setError(null);
      await onSubmitChallenge({
        reason: trimmedReason,
        notes: notes.trim() || undefined,
      });
    } catch (err: any) {
      setError(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.operation-failed")));
    }
  };

  return (
    <div
      className={`p-5 bg-surface dark:bg-surface-dark rounded-2xl border border-outline-variant/40 space-y-4 shadow-sm ${className}`}
      data-testid="grade-challenge-form"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-outline-variant/20">
        <div className="space-y-0.5">
          <h3 className="text-base font-bold text-on-surface flex items-center gap-2">
            <ChatText size={20} className="text-primary" weight="bold" />
            {translateRecentFeature("studyPlans.ui.request-grade-review-challen.068fa153")}</h3>
          {questionTitle && (
            <p className="text-xs text-on-surface-variant font-medium">
              {questionTitle}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="p-1 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50 transition-colors"
          aria-label={translateRecentFeature("studyPlans.ui.close-challenge-form.02da456e")}
        >
          <X size={18} />
        </button>
      </div>

      {/* Grade Context Info */}
      {currentGrade && (
        <div className="flex items-center justify-between p-3 rounded-xl bg-surface-container/40 dark:bg-surface-container-dark/40 border border-outline-variant/30 text-xs">
          <span className="text-on-surface-variant font-medium">
            {translateRecentFeature("studyPlans.ui.current-award.93b1cf0d")}{' '}
            <strong className="text-on-surface font-bold">
              {currentGrade.points !== null ? currentGrade.points : '\u2014'}{translateRecentFeature("studyPlans.ui.var0-pts.b9b87d13", {var0: currentGrade.maxPoints})}</strong>
          </span>
          <span className="capitalize px-2 py-0.5 rounded-full text-[11px] font-bold bg-surface-container-high text-on-surface-variant">{translateRecentFeature("studyPlans.ui.state-var0.16b83a2f", {var0: currentGrade.state})}</span>
        </div>
      )}

      {/* Notice */}
      <p className="text-xs text-on-surface-variant leading-relaxed">
        {translateRecentFeature("studyPlans.ui.if-you-believe-an-automated-.9023af03")}</p>

      {/* Challenge Form */}
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div className="space-y-1">
          <label
            htmlFor="challenge-reason-input"
            className="block text-xs font-bold text-on-surface uppercase tracking-wider"
          >
            {translateRecentFeature("studyPlans.ui.reason-for-challenge-re-eval.4fbad206")}<span className="text-error">*</span>
          </label>
          <textarea
            id="challenge-reason-input"
            data-testid="challenge-reason-input"
            rows={3}
            value={reason}
            disabled={isSubmitting}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError(null);
            }}
            placeholder={translateRecentFeature("studyPlans.ui.explain-why-you-are-requesti.2481f1fb")}
            className="w-full text-xs p-3 rounded-xl border border-outline-variant/40 bg-surface-container-low dark:bg-surface-container-low-dark text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all resize-y"
            aria-label={translateRecentFeature("studyPlans.ui.grade-challenge-explanation.5b1e1776")}
            required
          />
        </div>

        <div className="space-y-1">
          <label
            htmlFor="challenge-notes-input"
            className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider text-[11px]"
          >
            {translateRecentFeature("studyPlans.ui.additional-citations-or-refe.5d63ffa4")}</label>
          <textarea
            id="challenge-notes-input"
            rows={2}
            value={notes}
            disabled={isSubmitting}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={translateRecentFeature("studyPlans.ui.include-any-section-referenc.9c36e3c8")}
            className="w-full text-xs p-2.5 rounded-xl border border-outline-variant/40 bg-surface-container-low dark:bg-surface-container-low-dark text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all resize-y"
            aria-label={translateRecentFeature("studyPlans.ui.additional-citations-or-refe.f20ace9a")}
          />
        </div>

        {/* Error message */}
        {error && (
          <div className="p-2.5 rounded-lg bg-error/10 border border-error/30 text-xs text-error font-medium flex items-center gap-2" role="alert">
            <WarningCircle size={16} className="shrink-0" weight="fill" />
            <span>{error}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
          <Button
            type="button"
            variant="text"
            onClick={onClose}
            disabled={isSubmitting}
            className="min-h-[40px] px-4 text-xs font-semibold"
          >
            {translateRecentFeature("common.cancel")}</Button>

          <Button
            type="submit"
            variant="filled"
            disabled={isSubmitting || !reason.trim()}
            className="min-h-[40px] px-5 text-xs font-bold shadow-sm"
          >
            <PaperPlaneTilt size={16} className={`mr-1.5 inline ${isSubmitting ? 'animate-spin' : ''}`} />
            {isSubmitting ? translateRecentFeature("studyPlans.ui.submitting.71afc058") : translateRecentFeature("studyPlans.ui.submit-challenge.3bc281d9")}
          </Button>
        </div>
      </form>
    </div>
  );
};
