import React from 'react';
import type { ConceptMasterySummary } from '../../../types/learningEvidence';
import { EvidenceSummaryCard } from './EvidenceSummaryCard';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface WeakConceptListProps {
  summaries: ConceptMasterySummary[];
  onSelectConcept?: (conceptId: string) => void;
}

export const WeakConceptList: React.FC<WeakConceptListProps> = ({ summaries, onSelectConcept }) => {
        useI18n();
        const weak = summaries.filter(
    (s) => s.level === 'needs-attention' || s.level === 'insufficient-evidence',
  );
  if (weak.length === 0) {
    return (
      <p data-testid="weak-concept-empty" className="text-sm text-on-surface-variant">
        {translateRecentFeature("studyPlans.ui.no-weak-concepts-sparse-evid.e837a888")}</p>
    );
  }
  return (
    <ul aria-label={translateRecentFeature("studyPlans.ui.weak-concepts.ae35948a")} className="space-y-2">
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
