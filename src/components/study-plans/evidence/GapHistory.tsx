import React from 'react';
import type { KnowledgeGapView } from '../../../types/learningEvidence';
import type { TargetedPracticeOptions } from '../../../lib/study-plans/remediation/remediationService';
import { KnowledgeGapCard } from './KnowledgeGapCard';

export interface GapHistoryProps {
  gaps: KnowledgeGapView[];
  onDismiss?: (gapId: string) => void;
  onOpenSource?: (sourceRefId: string | null) => void;
  onPrepareAssessment?: (gap: KnowledgeGapView, mode: 'practice' | 'exam', options?: TargetedPracticeOptions) => void;
  onOpenLesson?: (nodeId: string) => void;
  onProposeCards?: (gap: KnowledgeGapView) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const GapHistory: React.FC<GapHistoryProps> = ({
  gaps,
  onDismiss,
  onOpenSource,
  onPrepareAssessment,
  onOpenLesson,
  onProposeCards,
  onRefresh,
  isRefreshing = false,
}) => {
  const active = gaps.filter((g) => g.status === 'active');
  const past = gaps.filter((g) => g.status !== 'active');
  return (
    <section aria-label="Knowledge gap history" data-testid="gap-history" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">
          Gaps ({active.length} active, {past.length} dismissed/resolved)
        </h3>
        {onRefresh && (
          <button
            type="button"
            data-testid="gap-refresh"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-live="polite"
            className="text-xs underline disabled:opacity-50"
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh locally'}
          </button>
        )}
      </div>
      {active.length === 0 && (
        <p data-testid="gap-history-empty" className="text-xs text-on-surface-variant">
          No active gaps. Dismissed gaps stay suppressed until materially new evidence arrives.
        </p>
      )}
      <div className="space-y-2">
        {active.map((g) => (
          <KnowledgeGapCard key={g.id} gap={g} onDismiss={onDismiss} onOpenSource={onOpenSource}
            onPrepareAssessment={onPrepareAssessment} onOpenLesson={onOpenLesson} onProposeCards={onProposeCards} />
        ))}
      </div>
      {past.length > 0 && (
        <details data-testid="gap-history-past">
          <summary className="text-xs underline cursor-pointer">
            Dismissed/resolved ({past.length})
          </summary>
          <div className="space-y-2 mt-2">
            {past.map((g) => (
              <KnowledgeGapCard key={g.id} gap={g} onOpenSource={onOpenSource} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
};
