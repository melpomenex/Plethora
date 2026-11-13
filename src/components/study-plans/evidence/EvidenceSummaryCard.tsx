import React from 'react';
import type { ConceptMasterySummary } from '../../../types/learningEvidence';
import { UncertaintyReasons } from './UncertaintyReasons';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface EvidenceSummaryCardProps {
  summary: ConceptMasterySummary;
  conceptLabel?: string;
}

function formatObserved(mean: number | null): string {
  if (mean === null || !Number.isFinite(mean)) {
    return translateRecentFeature("studyPlans.ui.no-scored-evidence.c6d3b79c");
  }
  return translateRecentFeature("studyPlans.ui.weighted-observed-performanc.7d230705", {
    var0: (mean * 100).toFixed(2),
  });
}

export const EvidenceSummaryCard: React.FC<EvidenceSummaryCardProps> = ({ summary, conceptLabel }) => {
        useI18n();
        return (
    <section
      aria-label={translateRecentFeature("studyPlans.ui.demonstrated-evidence-var0.b0eb4970", {var0: conceptLabel ?? summary.conceptId})}
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
      <p className="text-xs text-on-surface-variant" data-testid="evidence-counts">{translateRecentFeature("studyPlans.ui.var0-independent-session-s-v.0e3bc379", {var0: summary.independentSessions, var1: summary.distinctDays})}{summary.minimumObserved !== null && summary.maximumObserved !== null
          ? translateRecentFeature("i18nAudit.ui.range-var0-var1.06b9005b", {var0: (summary.minimumObserved * 100).toFixed(0), var1: (summary.maximumObserved * 100).toFixed(0)})
          : ''}
        {translateRecentFeature("studyPlans.ui.weight-var0.98fd489c", {var0: summary.evidenceWeight.toFixed(2)})}
      </p>
      <p className="text-xs text-on-surface-variant">
        {translateRecentFeature("studyPlans.ui.weighted-observed-performanc.e0614ef0")}</p>
      <UncertaintyReasons reasons={summary.uncertainty} compact />
    </section>
  );
};
