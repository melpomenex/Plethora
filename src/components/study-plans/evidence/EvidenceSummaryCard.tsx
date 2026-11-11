import React from 'react';
import type { ConceptMasterySummary } from '../../../types/learningEvidence';
import { UncertaintyReasons } from './UncertaintyReasons';

export interface EvidenceSummaryCardProps {
  summary: ConceptMasterySummary;
  conceptLabel?: string;
}

function formatObserved(mean: number | null): string {
  if (mean === null || !Number.isFinite(mean)) return 'No scored evidence';
  return `${(mean * 100).toFixed(2)}% weighted observed performance`;
}

export const EvidenceSummaryCard: React.FC<EvidenceSummaryCardProps> = ({ summary, conceptLabel }) => {
  return (
    <section
      aria-label={`Demonstrated evidence${conceptLabel ? ` for ${conceptLabel}` : ''}`}
      data-testid={`evidence-summary-${summary.conceptId}`}
      className="rounded-xl border border-outline-variant/30 p-4 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-medium text-sm">{conceptLabel ?? summary.conceptId}</h4>
        <span
          data-testid="evidence-level"
          className="text-xs px-2 py-0.5 rounded-full bg-surface-container-high"
        >
          {summary.level}
        </span>
      </div>
      <p data-testid="evidence-observed" className="text-sm">
        {formatObserved(summary.observedMean)}
      </p>
      <p className="text-xs text-on-surface-variant" data-testid="evidence-counts">
        {summary.independentSessions} independent session(s), {summary.distinctDays} day(s)
        {summary.minimumObserved !== null && summary.maximumObserved !== null
          ? `, range ${(summary.minimumObserved * 100).toFixed(0)}–${(summary.maximumObserved * 100).toFixed(0)}%`
          : ''}
        {`, weight ${summary.evidenceWeight.toFixed(2)}`}
      </p>
      <p className="text-xs text-on-surface-variant">
        Weighted observed performance, not a probability of mastery.
      </p>
      <UncertaintyReasons reasons={summary.uncertainty} compact />
    </section>
  );
};
