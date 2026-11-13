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
import { t as translateRecentFeature, useI18n } from '../../../lib/i18n';

export interface GradeLimitationsProps {
  limitations?: (RubricLimitation | string)[] | null;
  className?: string;
}

const LIMITATION_DESCRIPTIONS: Record<string, { labelKey: string; detailKey: string; severity: 'warning' | 'info' }> = {
  'ambiguous-answer': {
    labelKey: 'studyPlans.ui.ambiguous-student-response.cb980a76',
    detailKey: 'studyPlans.ui.the-answer-is-semantically-a.8c833c29',
    severity: 'warning',
  },
  'non-reasoning-fallback': {
    labelKey: 'studyPlans.ui.non-reasoning-model-fallback.58404ddb',
    detailKey: 'studyPlans.ui.an-essay-answer-was-evaluate.6510cfc4',
    severity: 'warning',
  },
  'model-capability': {
    labelKey: 'studyPlans.ui.model-capability-constraint.b491e10a',
    detailKey: 'studyPlans.ui.the-ai-provider-reported-con.10a273b4',
    severity: 'info',
  },
  'insufficient-source': {
    labelKey: 'studyPlans.ui.source-grounding-limitation.8029e77a',
    detailKey: 'studyPlans.ui.one-or-more-required-source-.b9119372',
    severity: 'warning',
  },
};

export const GradeLimitations: React.FC<GradeLimitationsProps> = ({
  limitations,
  className = '',
}) => {
  useI18n();
    if (!limitations || limitations.length === 0) {
    return null;
  }

  return (
    <div className={`space-y-2 ${className}`} data-testid="grade-limitations">
      {limitations.map((lim, idx) => {
        const meta = LIMITATION_DESCRIPTIONS[lim] || {
          label: lim,
          detail: translateRecentFeature('studyPlans.ui.assessment-limitation-noted-.829ae1ac'),
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
              <span className="font-semibold block">{'labelKey' in meta ? translateRecentFeature(meta.labelKey) : meta.label}</span>
              <p className="text-on-surface-variant/90">{'detailKey' in meta ? translateRecentFeature(meta.detailKey) : meta.detail}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
