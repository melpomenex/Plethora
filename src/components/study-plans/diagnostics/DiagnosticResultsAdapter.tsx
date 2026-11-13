import React from 'react';
import type { CurriculumPriorEvidence } from '../../../lib/study-plans/generation/types';
import type { ConceptMasterySummary } from '../../../types/learningEvidence';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface DiagnosticResultsAdapterProps {
  priorEvidence: CurriculumPriorEvidence | null;
  summaries?: ConceptMasterySummary[];
  hasPendingGrading?: boolean;
  applyDisabledReason?: string | null;
  onApply?: () => void | Promise<void>;
  onReject?: () => void | Promise<void>;
}

export const DiagnosticResultsAdapter: React.FC<DiagnosticResultsAdapterProps> = ({
  priorEvidence,
  summaries = [],
  hasPendingGrading = false,
  applyDisabledReason = null,
  onApply,
  onReject,
}) => {
        useI18n();
        if (!priorEvidence) {
    return (
      <p data-testid="diagnostic-results-empty" className="text-xs text-on-surface-variant">
        {translateRecentFeature("studyPlans.ui.no-diagnostic-evidence-skipp.648d0699")}</p>
    );
  }
  const disabled = hasPendingGrading || !!applyDisabledReason;
  return (
    <section aria-label={translateRecentFeature("studyPlans.ui.diagnostic-results.ee1010a6")} data-testid="diagnostic-results" className="space-y-2 rounded-xl border border-outline-variant/30 p-4">
      <p className="text-xs" data-testid="diagnostic-attempt">{translateRecentFeature("studyPlans.ui.diagnostic-var0-var1-concept.fb91ff5b", {var0: priorEvidence.diagnosticAttemptId, var1: priorEvidence.concepts.length})}</p>
      <ul className="text-xs space-y-1">
        {priorEvidence.concepts.map((c) => (
          <li key={c.conceptId} data-testid={`diagnostic-concept-${c.conceptId}`}>
            {c.conceptId}: {c.level}
            {summaries.find((s) => s.conceptId === c.conceptId)?.observedMean !== undefined
              ? translateRecentFeature("i18nAudit.ui.observed-var0.6aaac7c1", {var0: summaries.find((s) => s.conceptId === c.conceptId)?.observedMean ?? '—'})
              : ''}
          </li>
        ))}
      </ul>
      {hasPendingGrading && (
        <p role="alert" data-testid="diagnostic-pending" className="text-xs">
          {translateRecentFeature("studyPlans.ui.grading-pending-retry-or-man.10fb6c11")}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="diagnostic-apply"
          disabled={disabled || !onApply}
          title={applyDisabledReason ?? undefined}
          onClick={() => void onApply?.()}
          className="text-xs underline min-h-[32px] disabled:opacity-50"
        >
          {translateRecentFeature("studyPlans.ui.apply-to-draft.1a7a9004")}</button>
        {onReject && (
          <button
            type="button"
            data-testid="diagnostic-reject"
            onClick={() => void onReject?.()}
            className="text-xs underline min-h-[32px]"
          >
            {translateRecentFeature("studyPlans.ui.reject-adaptation.f527cf4a")}</button>
        )}
      </div>
      <p className="text-xs text-on-surface-variant">{translateRecentFeature("studyPlans.ui.apply-creates-a-reviewable-d.8c2662ff")}</p>
    </section>
  );
};
