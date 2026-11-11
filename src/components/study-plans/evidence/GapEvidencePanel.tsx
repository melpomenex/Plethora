import React from 'react';
import type { KnowledgeGapView } from '../../../types/learningEvidence';

export interface GapEvidencePanelProps {
  gap: KnowledgeGapView;
  onOpenSource?: (sourceRefId: string | null) => void;
}

export const GapEvidencePanel: React.FC<GapEvidencePanelProps> = ({ gap, onOpenSource }) => {
  if (gap.evidence.length === 0) {
    return (
      <p data-testid="gap-evidence-empty" className="text-xs text-on-surface-variant">
        No linked evidence rows — dismissal preserves this state.
      </p>
    );
  }
  return (
    <ul aria-label="Gap evidence" className="space-y-1 text-xs">
      {gap.evidence.map((e) => (
        <li key={`${e.recordId}-${e.kind}`} data-testid={`gap-evidence-${e.recordId}`}>
          <span data-testid="gap-evidence-desc">{e.description}</span>{' '}
          <span className="text-on-surface-variant">({e.kind})</span>
          {e.sourceRefId && (
            <button
              type="button"
              data-testid={`gap-evidence-source-${e.recordId}`}
              onClick={() => onOpenSource?.(e.sourceRefId)}
              className="underline ml-1"
            >
              Open source
            </button>
          )}
        </li>
      ))}
    </ul>
  );
};
