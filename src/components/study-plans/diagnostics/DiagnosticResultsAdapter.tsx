import React from 'react';
import type { CurriculumPriorEvidence } from '../../../lib/study-plans/generation/types';
import type { ConceptMasterySummary } from '../../../types/learningEvidence';

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
  if (!priorEvidence) {
    return (
      <p data-testid="diagnostic-results-empty" className="text-xs text-on-surface-variant">
        No diagnostic evidence — skipped or incomplete. Apply disabled; rejecting leaves the draft unchanged.
      </p>
    );
  }
  const disabled = hasPendingGrading || !!applyDisabledReason;
  return (
    <section aria-label="Diagnostic results" data-testid="diagnostic-results" className="space-y-2 rounded-xl border border-outline-variant/30 p-4">
      <p className="text-xs" data-testid="diagnostic-attempt">
        Diagnostic {priorEvidence.diagnosticAttemptId}: {priorEvidence.concepts.length} concept(s).
      </p>
      <ul className="text-xs space-y-1">
        {priorEvidence.concepts.map((c) => (
          <li key={c.conceptId} data-testid={`diagnostic-concept-${c.conceptId}`}>
            {c.conceptId}: {c.level}
            {summaries.find((s) => s.conceptId === c.conceptId)?.observedMean !== undefined
              ? ` (observed ${summaries.find((s) => s.conceptId === c.conceptId)?.observedMean ?? '—'})`
              : ''}
          </li>
        ))}
      </ul>
      {hasPendingGrading && (
        <p role="alert" data-testid="diagnostic-pending" className="text-xs">
          Grading pending — Retry or Manual review required. Apply disabled until all official items are final.
        </p>
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
          Apply to draft
        </button>
        {onReject && (
          <button
            type="button"
            data-testid="diagnostic-reject"
            onClick={() => void onReject?.()}
            className="text-xs underline min-h-[32px]"
          >
            Reject adaptation
          </button>
        )}
      </div>
      <p className="text-xs text-on-surface-variant">Apply creates a reviewable Draft/diff with plan/head CAS; Publish stays explicit.</p>
    </section>
  );
};
