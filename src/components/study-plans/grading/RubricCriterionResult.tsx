/**
 * Criterion-Level Rubric Result Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.8
 * - openspec/changes/implement-rubric-based-exam-grading/tasks.md (C5-T05)
 */

import React from 'react';
import {
  WarningCircle,
  Quotes,
  BookOpen,
  UserCheck,
} from '@phosphor-icons/react';
import type { RubricCriterion, RubricLevel } from '../../../types/assessmentQuestions';
import type { CriterionResult } from '../../../types/assessmentSessions';

export interface RubricCriterionResultProps {
  criterion: RubricCriterion;
  result?: CriterionResult;
  className?: string;
}

export const RubricCriterionResult: React.FC<RubricCriterionResultProps> = ({
  criterion,
  result,
  className = '',
}) => {
  const isAssessed = result?.status === 'assessed';
  const isNotAssessable = result?.status === 'not-assessable';
  const isManual = result?.status === 'manual';

  const level: RubricLevel | null =
    result && 'level' in result && result.level !== undefined && result.level !== null
      ? (result.level as RubricLevel)
      : null;

  const levelDescriptor = level !== null ? criterion.levels[String(level) as keyof typeof criterion.levels] : null;

  return (
    <div
      className={`p-4 rounded-xl border bg-surface-container-low dark:bg-surface-container-low-dark border-outline-variant/30 space-y-3 ${className}`}
      data-testid={`criterion-result-${criterion.id}`}
    >
      {/* Header: Title, Weight & Status Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-on-surface">
            {criterion.title}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-surface-container-high dark:bg-surface-container-high-dark text-on-surface-variant font-medium">
            Weight: {criterion.weight}×
          </span>
        </div>

        <div className="flex items-center gap-2">
          {level !== null && (
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1 ${
                level >= 3
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                  : level >= 2
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30'
              }`}
            >
              Level {level}/4
            </span>
          )}

          {isManual && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30 flex items-center gap-1 font-medium">
              <UserCheck size={12} weight="bold" />
              Manual Review
            </span>
          )}

          {isNotAssessable && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 flex items-center gap-1 font-medium">
              <WarningCircle size={12} weight="bold" />
              Not Assessable
            </span>
          )}
        </div>
      </div>

      {/* Level Ladder 0..4 */}
      <div className="flex items-center gap-1.5 pt-1" aria-label="Level ladder">
        {([0, 1, 2, 3, 4] as RubricLevel[]).map((lvl) => {
          const isActive = level === lvl;
          return (
            <div
              key={lvl}
              className={`flex-1 text-center py-1 rounded text-xs transition-colors ${
                isActive
                  ? 'bg-primary text-on-primary font-bold shadow-sm'
                  : 'bg-surface-container-high/40 dark:bg-surface-container-high-dark/40 text-on-surface-variant/70'
              }`}
            >
              L{lvl}
            </div>
          );
        })}
      </div>

      {/* Active Level Descriptor */}
      {levelDescriptor && (
        <p className="text-xs text-on-surface-variant italic bg-surface-container/40 dark:bg-surface-container-dark/40 p-2.5 rounded-lg border border-outline-variant/20">
          &ldquo;{levelDescriptor}&rdquo;
        </p>
      )}

      {/* Student Evidence Substring */}
      {isAssessed && result.answerEvidence && (
        <div className="space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1">
            <Quotes size={12} weight="fill" />
            Learner Evidence Quote:
          </span>
          <div className="text-xs font-mono bg-surface-container-highest/30 dark:bg-surface-container-highest-dark/30 p-2.5 rounded-lg border border-outline-variant/30 text-on-surface">
            &ldquo;{result.answerEvidence}&rdquo;
          </div>
        </div>
      )}

      {/* Grader Rationale */}
      {isAssessed && result.rationale && (
        <div className="text-xs text-on-surface-variant space-y-1">
          <span className="font-semibold text-on-surface">Rationale: </span>
          <span>{result.rationale}</span>
        </div>
      )}

      {/* Not Assessable Reason */}
      {isNotAssessable && result.reason && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-700 dark:text-amber-300">
          <span className="font-bold">Cannot Assess: </span>
          {result.reason}
        </div>
      )}

      {/* Missing Concepts & Misconceptions */}
      {isAssessed && (
        <div className="flex flex-wrap gap-2 pt-1">
          {result.missingConcepts && result.missingConcepts.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
              <span className="font-semibold">Missing:</span>
              <span>{result.missingConcepts.join(', ')}</span>
            </div>
          )}

          {result.misconception && (
            <div className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-md border border-rose-500/20">
              <span className="font-semibold">Misconception:</span>
              <span>{result.misconception}</span>
            </div>
          )}

          {result.sourceRefIds && result.sourceRefIds.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-on-surface-variant bg-surface-container-high/60 dark:bg-surface-container-high-dark/60 px-2 py-0.5 rounded-md">
              <BookOpen size={11} />
              <span>{result.sourceRefIds.join(', ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
