/**
 * Chronological Grade History Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.8
 * - openspec/changes/implement-rubric-based-exam-grading/tasks.md (C5-T05)
 */

import React, { useState } from 'react';
import {
  ClockCounterClockwise,
  ShieldCheck,
  Cpu,
  CaretDown,
  CaretUp,
} from '@phosphor-icons/react';
import type { GradeRecord } from '../../../types/assessmentSessions';

export interface GradeHistoryProps {
  grades: GradeRecord[];
  className?: string;
}

export const GradeHistory: React.FC<GradeHistoryProps> = ({
  grades,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!grades || grades.length <= 1) {
    return null; // Don't clutter UI if only a single grade exists
  }

  return (
    <div
      className={`rounded-xl border border-outline-variant/30 bg-surface-container-low dark:bg-surface-container-low-dark overflow-hidden ${className}`}
      data-testid="grade-history"
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-on-surface hover:bg-surface-container-high/40 transition-colors"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-1.5">
          <ClockCounterClockwise size={15} />
          Evaluation History ({grades.length} revisions)
        </span>
        {isOpen ? <CaretUp size={14} /> : <CaretDown size={14} />}
      </button>

      {isOpen && (
        <div className="p-3 space-y-2 border-t border-outline-variant/30">
          {grades.map((grade, idx) => {
            const isManual = grade.origin === 'manual';
            const isAI = grade.origin === 'ai';

            return (
              <div
                key={grade.id || idx}
                className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                  grade.isCurrent
                    ? 'bg-surface dark:bg-surface-dark border-primary/40 shadow-sm'
                    : 'bg-surface-container/30 dark:bg-surface-container-dark/30 border-outline-variant/20 opacity-80'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-on-surface flex items-center gap-1">
                      {isManual ? (
                        <>
                          <ShieldCheck size={14} className="text-primary" />
                          Manual Override
                        </>
                      ) : isAI ? (
                        <>
                          <Cpu size={14} className="text-secondary" />
                          AI Evaluation
                        </>
                      ) : (
                        'Deterministic'
                      )}
                    </span>

                    {grade.isCurrent && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary text-on-primary">
                        CURRENT
                      </span>
                    )}

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                        grade.state === 'final'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : grade.state === 'needs-review'
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {grade.state}
                    </span>
                  </div>

                  <span className="font-bold text-on-surface">
                    {grade.points !== null ? `${grade.points}/${grade.maxPoints} pts` : 'Pending'}
                  </span>
                </div>

                {isManual && grade.manualReason && (
                  <p className="text-on-surface-variant italic text-[11px]">
                    Reason: &ldquo;{grade.manualReason}&rdquo;
                  </p>
                )}

                <div className="text-[10px] text-on-surface-variant/70">
                  {new Date(grade.createdAt).toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
