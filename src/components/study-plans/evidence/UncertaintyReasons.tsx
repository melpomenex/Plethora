import React from 'react';
import type { UncertaintyReason } from '../../../types/learningEvidence';

const REASON_LABELS: Record<UncertaintyReason, string> = {
  'no-assessment': 'No assessment evidence yet',
  'one-independent-session': 'Only one independent session',
  'few-independent-sessions': 'Fewer than three independent sessions',
  'same-question-repetition': 'Same question repeated — reduced weight',
  'hints-used': 'Hints were used',
  'ai-graded': 'Graded by AI — reduced weight',
  'conflicting-outcomes': 'Conflicting outcomes across sessions',
  'stale-evidence': 'Latest evidence older than 90 days',
  'narrow-difficulty': 'Narrow difficulty coverage',
  'source-missing': 'Source missing for some evidence',
  'not-enough-recent-success': 'Not enough recent success',
  'low-learner-confidence': 'Low learner confidence reported',
  'high-confidence-error': 'High confidence but incorrect',
};

export interface UncertaintyReasonsProps {
  reasons: UncertaintyReason[] | string[];
  compact?: boolean;
}

export const UncertaintyReasons: React.FC<UncertaintyReasonsProps> = ({ reasons, compact = false }) => {
  if (reasons.length === 0) return null;
  return (
    <ul
      aria-label="Evidence uncertainty reasons"
      className={compact ? 'text-xs space-y-0.5' : 'text-sm space-y-1'}
    >
      {reasons.map((r) => (
        <li key={r} data-testid={`uncertainty-${r}`}>
          {(REASON_LABELS as Record<string, string>)[r] ?? r}
        </li>
      ))}
    </ul>
  );
};
