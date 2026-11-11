import React from 'react';
import type { AttemptSummary } from '../../../types/assessmentSessions';

export interface PerformanceComparisonProps {
  attempts: AttemptSummary[];
}

/**
 * Final-only history comparison. Same blueprint revision rows are labeled
 * same-paper with memory-effect warning; different revisions are descriptive
 * cross-paper history, never an equivalence claim.
 */
export const PerformanceComparison: React.FC<PerformanceComparisonProps> = ({ attempts }) => {
  const complete = attempts.filter((a) => a.status === 'complete' && a.awardedPoints !== null);
  if (complete.length === 0) {
    return (
      <p data-testid="performance-empty" className="text-xs text-on-surface-variant">
        No Final scores yet — pending or failed items are not compared.
      </p>
    );
  }
  const byRevision = new Map<string, AttemptSummary[]>();
  for (const a of complete) {
    const list = byRevision.get(a.blueprintRevisionId) ?? [];
    list.push(a);
    byRevision.set(a.blueprintRevisionId, list);
  }
  return (
    <div data-testid="performance-comparison" className="space-y-2 text-xs">
      {Array.from(byRevision.entries()).map(([rev, list]) => {
        const sorted = [...list].sort((a, b) =>
          (a.startedAt ?? a.id).localeCompare(b.startedAt ?? b.id),
        );
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const delta =
          first.awardedPoints !== null && last.awardedPoints !== null
            ? last.awardedPoints - first.awardedPoints
            : null;
        return (
          <div
            key={rev}
            data-testid={sorted.length > 1 ? 'performance-same-paper' : 'performance-cross-paper'}
            className="rounded-xl border border-outline-variant/30 p-3"
          >
            <p>
              {sorted.length > 1 ? 'Same-paper' : 'Cross-paper'} · {sorted.length} Final attempt(s)
              {delta !== null && sorted.length > 1 ? ` · delta ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pts` : ''}
            </p>
            {sorted.length > 1 && (
              <p className="text-on-surface-variant">
                Same-paper retakes may include memory or familiarization effects.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};
