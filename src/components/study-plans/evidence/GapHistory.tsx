import React from 'react';
import type { KnowledgeGapView } from '../../../types/learningEvidence';
import type { TargetedPracticeOptions } from '../../../lib/study-plans/remediation/remediationService';
import { KnowledgeGapCard } from './KnowledgeGapCard';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


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
        useI18n();
        const active = gaps.filter((g) => g.status === 'active');
  const past = gaps.filter((g) => g.status !== 'active');
  return (
    <section aria-label={translateRecentFeature("studyPlans.ui.knowledge-gap-history.c92828f6")} data-testid="gap-history" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">{translateRecentFeature("studyPlans.ui.gaps-var0-active-var1-dismis.068f1d4a", {var0: active.length, var1: past.length})}</h3>
        {onRefresh && (
          <button
            type="button"
            data-testid="gap-refresh"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-live="polite"
            className="text-xs underline disabled:opacity-50"
          >
            {isRefreshing ? translateRecentFeature("studyPlans.ui.refreshing.0267c45b") : translateRecentFeature("studyPlans.ui.refresh-locally.b6bad4fa")}
          </button>
        )}
      </div>
      {active.length === 0 && (
        <p data-testid="gap-history-empty" className="text-xs text-on-surface-variant">
          {translateRecentFeature("studyPlans.ui.no-active-gaps-dismissed-gap.8274c031")}</p>
      )}
      <div className="space-y-2">
        {active.map((g) => (
          <KnowledgeGapCard key={g.id} gap={g} onDismiss={onDismiss} onOpenSource={onOpenSource}
            onPrepareAssessment={onPrepareAssessment} onOpenLesson={onOpenLesson} onProposeCards={onProposeCards} />
        ))}
      </div>
      {past.length > 0 && (
        <details data-testid="gap-history-past">
          <summary className="text-xs underline cursor-pointer">{translateRecentFeature("studyPlans.ui.dismissed-resolved-var0.fefed159", {var0: past.length})}</summary>
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
