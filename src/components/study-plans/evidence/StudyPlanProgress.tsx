import React, { useCallback, useEffect, useState } from 'react';
import type { KnowledgeGapView, NodeLearningProgress, PlanEvidenceSummary } from '../../../types/learningEvidence';
import type { TargetedPracticeOptions } from '../../../lib/study-plans/remediation/remediationService';
import { getStudyPlanEvidence } from '../../../api/learning-evidence';
import { useKnowledgeGapsStore } from '../../../stores/knowledgeGapsStore';
import { NodeLearningProgressView } from './NodeLearningProgress';
import { GapHistory } from './GapHistory';

export interface StudyPlanProgressProps {
  planId: string;
  nodeTitles?: Record<string, string>;
  onOpenSource?: (sourceRefId: string | null) => void;
  onPrepareAssessment?: (gap: KnowledgeGapView, mode: 'practice' | 'exam', options?: TargetedPracticeOptions) => void;
  onOpenLesson?: (nodeId: string) => void;
  onProposeCards?: (gap: KnowledgeGapView) => void;
}

export const StudyPlanProgress: React.FC<StudyPlanProgressProps> = ({
  planId,
  nodeTitles,
  onOpenSource,
  onPrepareAssessment,
  onOpenLesson,
  onProposeCards,
}) => {
  const [summary, setSummary] = useState<PlanEvidenceSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const gaps = useKnowledgeGapsStore((s) => s.gaps);
  const isRefreshing = useKnowledgeGapsStore((s) => s.isLoading);
  const refreshGaps = useKnowledgeGapsStore((s) => s.refreshGaps);
  const dismissGapNative = useKnowledgeGapsStore((s) => s.dismissGapNative);
  const loadGaps = useKnowledgeGapsStore((s) => s.loadGaps);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const s = await getStudyPlanEvidence(planId);
      setSummary(s);
      await loadGaps(planId);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [planId, loadGaps]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = useCallback(async () => {
    try {
      await refreshGaps(planId);
      const s = await getStudyPlanEvidence(planId);
      setSummary(s);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [planId, refreshGaps]);

  if (isLoading) {
    return (
      <div aria-live="polite" data-testid="plan-progress-loading" className="text-sm">
        Loading demonstrated evidence…
      </div>
    );
  }

  if (loadError) {
    return (
      <div role="alert" data-testid="plan-progress-error" className="text-sm space-y-2">
        <p>Evidence unavailable offline or without native support: {loadError}</p>
        <button type="button" onClick={() => void load()} className="text-xs underline">
          Retry
        </button>
      </div>
    );
  }

  const nodes: NodeLearningProgress[] = summary?.nodes ?? [];
  const planGaps = gaps.filter((g) => g.planId === planId);
  const handleDismiss = (id: string) => {
    const gap = planGaps.find((item) => item.id === id);
    if (!gap) return;
    void dismissGapNative(id, gap.evidenceCutoff).catch(() => setLoadError('Could not dismiss the gap.'));
  };

  return (
    <div data-testid="plan-progress" className="space-y-4">
      <p className="text-xs text-on-surface-variant">
        Three separate axes — content coverage, study activity, demonstrated evidence. No composite
        score is shown and no value is a probability of mastery.
      </p>
      {nodes.length === 0 ? (
        <p data-testid="plan-progress-empty" className="text-sm text-on-surface-variant">
          No node evidence yet. Coverage and activity alone are not mastery.
        </p>
      ) : (
        <div className="space-y-3">
          {nodes.map((n) => (
            <NodeLearningProgressView
              key={n.nodeId}
              progress={n}
              nodeTitle={nodeTitles?.[n.nodeId] ?? n.nodeId}
              onOpenSource={() => onOpenSource?.(null)}
            />
          ))}
        </div>
      )}
      <GapHistory gaps={planGaps} onDismiss={handleDismiss} onOpenSource={onOpenSource}
        onPrepareAssessment={onPrepareAssessment} onOpenLesson={onOpenLesson} onProposeCards={onProposeCards} onRefresh={() => void handleRefresh()} isRefreshing={isRefreshing} />
    </div>
  );
};
