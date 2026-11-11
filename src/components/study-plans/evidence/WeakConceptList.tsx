import React from 'react';
import type { ConceptMasterySummary } from '../../../types/learningEvidence';
import { EvidenceSummaryCard } from './EvidenceSummaryCard';

export interface WeakConceptListProps {
  summaries: ConceptMasterySummary[];
  onSelectConcept?: (conceptId: string) => void;
}

export const WeakConceptList: React.FC<WeakConceptListProps> = ({ summaries, onSelectConcept }) => {
  const weak = summaries.filter(
    (s) => s.level === 'needs-attention' || s.level === 'insufficient-evidence',
  );
  if (weak.length === 0) {
    return (
      <p data-testid="weak-concept-empty" className="text-sm text-on-surface-variant">
        No weak concepts — sparse evidence is shown as insufficient, not as mastery.
      </p>
    );
  }
  return (
    <ul aria-label="Weak concepts" className="space-y-2">
      {weak.map((s) => (
        <li key={s.conceptId}>
          <button
            type="button"
            data-testid={`weak-concept-${s.conceptId}`}
            onClick={() => onSelectConcept?.(s.conceptId)}
            className="w-full text-left"
          >
            <EvidenceSummaryCard summary={s} />
          </button>
        </li>
      ))}
    </ul>
  );
};
