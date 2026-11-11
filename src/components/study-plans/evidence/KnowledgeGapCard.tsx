import React from 'react';
import type { KnowledgeGapView } from '../../../types/learningEvidence';
import { GapEvidencePanel } from './GapEvidencePanel';

export interface KnowledgeGapCardProps {
  gap: KnowledgeGapView;
  onDismiss?: (gapId: string) => void;
  onOpenSource?: (sourceRefId: string | null) => void;
  onPrepareAssessment?: (gap: KnowledgeGapView, mode: 'practice' | 'exam') => void;
}

function structuralNote(kind: KnowledgeGapView['kind']): string | null {
  if (kind === 'missing_concept') return 'Structural material gap — not a learner deficit claim.';
  if (kind === 'disconnected_cluster') return 'Structural graph gap — material organization issue, not a learner deficit.';
  if (kind === 'read_never_reviewed') return 'Reading-only signal — no assessment claim.';
  return null;
}

export const KnowledgeGapCard: React.FC<KnowledgeGapCardProps> = ({ gap, onDismiss, onOpenSource, onPrepareAssessment }) => {
  const note = structuralNote(gap.kind);
  return (
    <article
      aria-label={`Knowledge gap ${gap.conceptName}`}
      data-testid={`gap-card-${gap.id}`}
      data-gap-kind={gap.kind}
      data-gap-status={gap.status}
      className="rounded-xl border border-outline-variant/30 p-4 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-medium text-sm" data-testid="gap-title">
          {gap.conceptName} — {gap.kind}
        </h4>
        <span data-testid="gap-status" className="text-xs px-2 py-0.5 rounded-full bg-surface-container-high">
          {gap.status}
        </span>
      </div>
      <p className="text-xs text-on-surface-variant" data-testid="gap-rule">
        Rule {gap.ruleId} · evidence cutoff {gap.evidenceCutoff}
      </p>
      {note && (
        <p className="text-xs" data-testid="gap-structural-note">
          {note}
        </p>
      )}
      {gap.demonstrated && (
        <p className="text-xs" data-testid="gap-demonstrated">
          Observed {gap.demonstrated.observedMean !== null ? `${(gap.demonstrated.observedMean * 100).toFixed(2)}%` : '—'}
          {' '}({gap.demonstrated.independentSessions} sessions) — not a mastery probability.
        </p>
      )}
      <GapEvidencePanel gap={gap} onOpenSource={onOpenSource} />
      {gap.status === 'active' && gap.demonstrated && onPrepareAssessment && (
        <div className="flex flex-wrap gap-3">
          <button type="button" className="min-h-10 text-sm underline"
            onClick={() => onPrepareAssessment(gap, 'practice')}>Create practice draft</button>
          <button type="button" className="min-h-10 text-sm underline"
            onClick={() => onPrepareAssessment(gap, 'exam')}>Create follow-up exam draft</button>
        </div>
      )}
      {gap.status === 'active' && onDismiss && (
        <button
          type="button"
          data-testid={`gap-dismiss-${gap.id}`}
          onClick={() => onDismiss(gap.id)}
          className="text-xs underline"
          aria-label={`Dismiss gap ${gap.conceptName}`}
        >
          Dismiss (evidence preserved)
        </button>
      )}
    </article>
  );
};
