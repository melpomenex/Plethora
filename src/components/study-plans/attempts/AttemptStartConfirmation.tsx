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
  const isExam = mode === 'exam';
  const timeLimitMinutes = timeLimitSeconds ? Math.round(timeLimitSeconds / 60) : null;

  return (
    <div
      className={`max-w-2xl mx-auto p-6 bg-surface dark:bg-surface-dark border border-outline-variant/30 rounded-2xl shadow-lg ${className}`}
      role="region"
      aria-label="Assessment Start Confirmation"
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
          >
            {mode} Mode
          </span>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="p-4 bg-surface-container-low dark:bg-surface-container-low-dark rounded-xl text-center">
          <span className="text-xs text-on-surface-variant dark:text-on-surface-variant-dark block mb-1">
            Questions
          </span>
          <span className="text-2xl font-bold text-on-surface dark:text-on-surface-dark">
            {questionCount}
          </span>
        </div>
        <div className="p-4 bg-surface-container-low dark:bg-surface-container-low-dark rounded-xl text-center">
          <span className="text-xs text-on-surface-variant dark:text-on-surface-variant-dark block mb-1">
            Max Points
          </span>
          <span className="text-2xl font-bold text-on-surface dark:text-on-surface-dark">
            {totalPoints}
          </span>
        </div>
        <div className="p-4 bg-surface-container-low dark:bg-surface-container-low-dark rounded-xl text-center">
          <span className="text-xs text-on-surface-variant dark:text-on-surface-variant-dark block mb-1">
            Time Limit
          </span>
          <span className="text-2xl font-bold text-on-surface dark:text-on-surface-dark flex items-center justify-center gap-1">
            {timeLimitMinutes ? (
              <>
                <Clock size={20} className="inline" />
                {timeLimitMinutes}m
              </>
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
          {isExam ? 'Examination Rules' : 'Practice Guidelines'}
        </h3>
        {isExam ? (
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>Answers are hidden until you complete and submit the examination.</li>
            <li>Your progress is continuously auto-saved. If interrupted, you can resume.</li>
            {timeLimitMinutes && (
              <li>The timer will run continuously. When time expires, your exam will automatically submit.</li>
            )}
            <li>All questions must be reviewed and submitted as your final attempt.</li>
          </ul>
        ) : (
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>You can check your answers immediately after attempting each question.</li>
            <li>Explanations, sample outlines, and hints are available as you practice.</li>
            <li>Take as much time as you need to master each concept.</li>
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
          Cancel
        </Button>
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
              {isExam ? 'Start Examination' : 'Start Practice'}
              <ArrowRight size={18} className="ml-2 inline" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
