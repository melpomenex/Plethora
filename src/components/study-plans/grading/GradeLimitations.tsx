/**
 * Grade Limitations and Warning Callouts Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.8
 * - openspec/changes/implement-rubric-based-exam-grading/tasks.md (C5-T05)
 */

import React from 'react';
import { Warning, Info } from '@phosphor-icons/react';
import type { RubricLimitation } from '../../../types/assessmentSessions';

export interface GradeLimitationsProps {
  limitations?: (RubricLimitation | string)[] | null;
  className?: string;
}

const LIMITATION_DESCRIPTIONS: Record<string, { label: string; detail: string; severity: 'warning' | 'info' }> = {
  'ambiguous-answer': {
    label: 'Ambiguous Student Response',
    detail: 'The answer is semantically ambiguous; manual educator review is strongly recommended.',
    severity: 'warning',
  },
  'non-reasoning-fallback': {
    label: 'Non-Reasoning Model Fallback',
    detail: 'An essay answer was evaluated using standard model fallback without multi-step reasoning.',
    severity: 'warning',
  },
  'model-capability': {
    label: 'Model Capability Constraint',
    detail: 'The AI provider reported context or complexity limitations while grading.',
    severity: 'info',
  },
  'insufficient-source': {
    label: 'Source Grounding Limitation',
    detail: 'One or more required source references were unavailable during evaluation.',
    severity: 'warning',
  },
};

export const GradeLimitations: React.FC<GradeLimitationsProps> = ({
  limitations,
  className = '',
}) => {
  if (!limitations || limitations.length === 0) {
    return null;
  }

  return (
    <div className={`space-y-2 ${className}`} data-testid="grade-limitations">
      {limitations.map((lim, idx) => {
        const meta = LIMITATION_DESCRIPTIONS[lim] || {
          label: lim,
          detail: 'Assessment limitation noted during evaluation.',
          severity: 'info',
        };

        const isWarning = meta.severity === 'warning';

        return (
          <div
            key={idx}
            className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
              isWarning
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300'
                : 'bg-primary/10 border-primary/30 text-primary dark:text-primary-light'
            }`}
          >
            {isWarning ? (
              <Warning size={16} weight="bold" className="shrink-0 mt-0.5" />
            ) : (
              <Info size={16} weight="bold" className="shrink-0 mt-0.5" />
            )}
            <div className="space-y-0.5">
              <span className="font-semibold block">{meta.label}</span>
              <p className="text-on-surface-variant/90">{meta.detail}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
