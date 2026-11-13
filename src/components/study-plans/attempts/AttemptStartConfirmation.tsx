/**
 * Examination Attempt Start Confirmation Screen.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.6
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T05)
 */

import React from 'react';
import {
  GraduationCap,
  Clock,
  CheckCircle,
  Warning,
  ArrowRight,
  ArrowLeft,
  BookOpen,
} from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import type { AssessmentMode } from '../../../types/assessmentQuestions';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface AttemptStartConfirmationProps {
  title: string;
  mode: AssessmentMode;
  questionCount: number;
  totalPoints: number;
  timeLimitSeconds: number | null;
  onStart: () => void;
  onCancel: () => void;
  isStarting?: boolean;
  className?: string;
}

export const AttemptStartConfirmation: React.FC<AttemptStartConfirmationProps> = ({
  title,
  mode,
  questionCount,
  totalPoints,
  timeLimitSeconds,
  onStart,
  onCancel,
  isStarting = false,
  className = '',
}) => {
        useI18n();
        const isExam = mode === 'exam';
  const timeLimitMinutes = timeLimitSeconds ? Math.round(timeLimitSeconds / 60) : null;

  return (
    <div
      className={`max-w-2xl mx-auto p-6 bg-surface dark:bg-surface-dark border border-outline-variant/30 rounded-2xl shadow-lg ${className}`}
      role="region"
      aria-label={translateRecentFeature("studyPlans.ui.assessment-start-confirmatio.7c4041c8")}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div
          className={`p-3 rounded-xl ${
            isExam
              ? 'bg-primary/10 text-primary dark:bg-primary-dark/20 dark:text-primary-dark'
              : 'bg-secondary/10 text-secondary dark:bg-secondary-dark/20 dark:text-secondary-dark'
          }`}
        >
          {isExam ? <GraduationCap size={32} /> : <BookOpen size={32} />}
        </div>
        <div>
          <h2 className="text-xl font-bold text-on-surface dark:text-on-surface-dark">
            {title}
          </h2>
          <span
            className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${
              isExam
                ? 'bg-primary/10 text-primary dark:bg-primary-dark/20 dark:text-primary-dark'
                : 'bg-secondary/10 text-secondary dark:bg-secondary-dark/20 dark:text-secondary-dark'
            }`}
          >{translateRecentFeature("studyPlans.ui.var0-mode.0548e82e", {var0: mode})}</span>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 min-[360px]:grid-cols-3 gap-3 sm:gap-4 mb-6">
        <div className="p-4 bg-surface-container-low dark:bg-surface-container-low-dark rounded-xl text-center">
          <span className="text-xs text-on-surface-variant dark:text-on-surface-variant-dark block mb-1">
            {translateRecentFeature("studyPlans.ui.questions.391023b3")}</span>
          <span className="text-2xl font-bold text-on-surface dark:text-on-surface-dark">
            {questionCount}
          </span>
        </div>
        <div className="p-4 bg-surface-container-low dark:bg-surface-container-low-dark rounded-xl text-center">
          <span className="text-xs text-on-surface-variant dark:text-on-surface-variant-dark block mb-1">
            {translateRecentFeature("studyPlans.ui.max-points.7ba61ea7")}</span>
          <span className="text-2xl font-bold text-on-surface dark:text-on-surface-dark">
            {totalPoints}
          </span>
        </div>
        <div className="p-4 bg-surface-container-low dark:bg-surface-container-low-dark rounded-xl text-center">
          <span className="text-xs text-on-surface-variant dark:text-on-surface-variant-dark block mb-1">
            {translateRecentFeature("studyPlans.ui.time-limit.05484e6d")}</span>
          <span className="text-2xl font-bold text-on-surface dark:text-on-surface-dark flex items-center justify-center gap-1">
            {timeLimitMinutes ? (
              <>
                <Clock size={20} className="inline" />{translateRecentFeature("studyPlans.ui.var0-m.eb6cdffd", {var0: timeLimitMinutes})}</>
            ) : (
              'Untimed'
            )}
          </span>
        </div>
      </div>

      {/* Rules & Guidance */}
      <div className="p-4 bg-surface-container-highest/40 dark:bg-surface-container-highest-dark/40 rounded-xl mb-6 space-y-2.5 text-sm text-on-surface-variant dark:text-on-surface-variant-dark">
        <h3 className="font-semibold text-on-surface dark:text-on-surface-dark flex items-center gap-2">
          {isExam ? <Warning size={18} className="text-amber-500" /> : <CheckCircle size={18} className="text-emerald-500" />}
          {isExam ? translateRecentFeature("studyPlans.ui.examination-rules.e3f552df") : translateRecentFeature("studyPlans.ui.practice-guidelines.5cface46")}
        </h3>
        {isExam ? (
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>{translateRecentFeature("studyPlans.ui.answers-are-hidden-until-you.3a4ab732")}</li>
            <li>{translateRecentFeature("studyPlans.ui.your-progress-is-continuousl.43f15049")}</li>
            {timeLimitMinutes && (
              <li>{translateRecentFeature("studyPlans.ui.the-timer-will-run-continuou.041b10c1")}</li>
            )}
            <li>{translateRecentFeature("studyPlans.ui.all-questions-must-be-review.0422e91e")}</li>
          </ul>
        ) : (
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>{translateRecentFeature("studyPlans.ui.you-can-check-your-answers-i.80b2b168")}</li>
            <li>{translateRecentFeature("studyPlans.ui.explanations-sample-outlines.b2bb8231")}</li>
            <li>{translateRecentFeature("studyPlans.ui.take-as-much-time-as-you-nee.e0e7b3f5")}</li>
          </ul>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between gap-4 pt-2 border-t border-outline-variant/30">
        <Button
          variant="text"
          onClick={onCancel}
          disabled={isStarting}
          className="min-h-[44px] min-w-[44px]"
        >
          <ArrowLeft size={18} className="mr-2 inline" />
          {translateRecentFeature("common.cancel")}</Button>
        <Button
          variant="filled"
          onClick={onStart}
          disabled={isStarting}
          className="min-h-[44px] min-w-[44px] px-6"
        >
          {isStarting ? (
            'Starting...'
          ) : (
            <>
              {isExam ? translateRecentFeature("studyPlans.ui.start-examination.47dd8cec") : translateRecentFeature("studyPlans.ui.start-practice.be207895")}
              <ArrowRight size={18} className="ml-2 inline" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
