/**
 * Grade Model Provenance Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.8
 * - openspec/changes/implement-rubric-based-exam-grading/tasks.md (C5-T05)
 */

import React from 'react';
import { Cpu, ShieldCheck, ArrowUUpLeft, Clock } from '@phosphor-icons/react';
import type { GenerationProvenance } from '../../../types/assessmentQuestions';

export interface GradeProvenanceProps {
  provenance: GenerationProvenance | null | undefined;
  origin?: 'deterministic' | 'ai' | 'manual';
  manualReason?: string | null;
  className?: string;
}

export const GradeProvenance: React.FC<GradeProvenanceProps> = ({
  provenance,
  origin = 'ai',
  manualReason,
  className = '',
}) => {
  if (origin === 'manual') {
    return (
      <div
        className={`flex flex-wrap items-center gap-2 text-xs text-on-surface-variant bg-surface-container-high/40 dark:bg-surface-container-high-dark/40 px-3 py-1.5 rounded-lg border border-outline-variant/30 ${className}`}
      >
        <span className="font-semibold text-primary flex items-center gap-1">
          <ShieldCheck size={14} weight="bold" />
          Human Manual Evaluation
        </span>
        {manualReason && (
          <span className="text-on-surface-variant">
            &mdash; &ldquo;{manualReason}&rdquo;
          </span>
        )}
      </div>
    );
  }

  if (origin === 'deterministic') {
    return (
      <div
        className={`flex items-center gap-2 text-xs text-on-surface-variant bg-surface-container-high/40 dark:bg-surface-container-high-dark/40 px-3 py-1.5 rounded-lg border border-outline-variant/30 ${className}`}
      >
        <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
          <ShieldCheck size={14} weight="bold" />
          Deterministic Exact Scoring
        </span>
      </div>
    );
  }

  if (!provenance) {
    return null;
  }

  const pAny = provenance as any;
  const providerName = provenance.providerId || pAny.provider || 'AI Grader';
  const modelName = provenance.baseModelName || pAny.servedModelName || pAny.model;
  const isFallback =
    (provenance.fallbackPath && provenance.fallbackPath !== 'none') ||
    provenance.taskId === 'study-rubric-grade-full' ||
    pAny.taskType === 'study-rubric-grade-full' ||
    (typeof modelName === 'string' && modelName.includes('fallback'));

  return (
    <div
      className={`flex flex-wrap items-center gap-2 text-xs text-on-surface-variant bg-surface-container-high/40 dark:bg-surface-container-high-dark/40 px-3 py-1.5 rounded-lg border border-outline-variant/30 ${className}`}
      data-testid="grade-provenance"
    >
      <div className="flex items-center gap-1 font-medium text-on-surface">
        <Cpu size={14} />
        <span>{providerName}</span>
      </div>

      {modelName && (
        <span className="px-2 py-0.5 rounded bg-surface-container-highest/60 dark:bg-surface-container-highest-dark/60 font-mono text-[11px]">
          {modelName}
        </span>
      )}

      {isFallback && (
        <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-medium flex items-center gap-1 text-[11px]">
          <ArrowUUpLeft size={11} />
          Fallback Grader
        </span>
      )}

      {pAny.latencyMs !== undefined && (
        <span className="flex items-center gap-1 text-[11px] text-on-surface-variant/70">
          <Clock size={11} />
          {pAny.latencyMs}ms
        </span>
      )}
    </div>
  );
};
