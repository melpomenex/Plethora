import React from 'react';
import type { UncertaintyReason } from '../../../types/learningEvidence';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


const REASON_LABELS: Record<UncertaintyReason, string> = {
  'no-assessment': 'studyPlans.ui.no-assessment-evidence-yet.060857e3',
  'one-independent-session': 'studyPlans.ui.only-one-independent-session.fba3204f',
  'few-independent-sessions': 'studyPlans.ui.fewer-than-three-independent.bc6a616b',
  'same-question-repetition': 'studyPlans.ui.same-question-repeated-reduc.99598fdc',
  'hints-used': 'studyPlans.ui.hints-were-used.6f0a6228',
  'ai-graded': 'studyPlans.ui.graded-by-ai-reduced-weight.f101e7c8',
  'conflicting-outcomes': 'studyPlans.ui.conflicting-outcomes-across-.6abe98fb',
  'stale-evidence': 'studyPlans.ui.latest-evidence-older-than-9.05483e80',
  'narrow-difficulty': 'studyPlans.ui.narrow-difficulty-coverage.4bb12586',
  'source-missing': 'studyPlans.ui.source-missing-for-some-evid.d01e05ff',
  'not-enough-recent-success': 'studyPlans.ui.not-enough-recent-success.a4a58409',
  'low-learner-confidence': 'studyPlans.ui.low-learner-confidence-repor.8bfb81b8',
  'high-confidence-error': 'studyPlans.ui.high-confidence-but-incorrec.39c1e0d1',
};

export interface UncertaintyReasonsProps {
  reasons: UncertaintyReason[] | string[];
  compact?: boolean;
}

export const UncertaintyReasons: React.FC<UncertaintyReasonsProps> = ({ reasons, compact = false }) => {
        useI18n();
        if (reasons.length === 0) return null;
  return (
    <ul
      aria-label={translateRecentFeature("studyPlans.ui.evidence-uncertainty-reasons.4bb0995c")}
      className={compact ? 'text-xs space-y-0.5' : 'text-sm space-y-1'}
    >
      {reasons.map((r) => (
        <li key={r} data-testid={`uncertainty-${r}`}>
          {REASON_LABELS[r as UncertaintyReason]
            ? translateRecentFeature(REASON_LABELS[r as UncertaintyReason])
            : r}
        </li>
      ))}
    </ul>
  );
};
