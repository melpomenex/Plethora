import React from 'react';
import type { ReassessmentReturnContext } from './returnContext';
import { ReassessmentChoice } from './ReassessmentChoice';

export interface WeakTopicWorkspaceProps {
  planId: string;
  nodeId: string | null;
  gapId: string | null;
  sourceAttemptId: string | null;
  returnContext: ReassessmentReturnContext;
  children?: React.ReactNode;
  onOpenSource?: () => void;
  onOpenTutor?: () => void;
  onOpenPractice?: () => void;
  onOpenCards?: () => void;
  onDismissGap?: () => void;
  onRetakeSame?: (revisionId: string) => void;
  onCreateNewPaper?: () => void;
  readyRevisionId?: string | null;
  excludedFingerprints?: string[];
  weakTopics?: string[];
  sourceState?: 'ok' | 'deleted' | 'stale';
  recomputeNote?: string | null;
}

export const WeakTopicWorkspace: React.FC<WeakTopicWorkspaceProps> = ({
  planId,
  nodeId,
  gapId,
  sourceAttemptId,
  returnContext,
  children,
  onOpenSource,
  onOpenTutor,
  onOpenPractice,
  onOpenCards,
  onDismissGap,
  onRetakeSame,
  onCreateNewPaper,
  readyRevisionId = null,
  excludedFingerprints = [],
  weakTopics = [],
  sourceState = 'ok',
  recomputeNote = null,
}) => {
  return (
    <section aria-label="Weak topic workspace" data-testid="weak-topic-workspace" className="space-y-3">
      <p className="text-xs text-on-surface-variant" data-testid="weak-topic-context">
        Weak topic: plan {planId}, node {nodeId ?? '—'}, gap {gapId ?? '—'}, from attempt {sourceAttemptId ?? '—'}.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="weak-open-source" disabled={!onOpenSource} onClick={() => onOpenSource?.()} className="text-xs underline min-h-[32px] disabled:opacity-50">Open source</button>
        <button type="button" data-testid="weak-open-tutor" disabled={!onOpenTutor} onClick={() => onOpenTutor?.()} className="text-xs underline min-h-[32px] disabled:opacity-50">Scoped tutor</button>
        <button type="button" data-testid="weak-open-practice" disabled={!onOpenPractice} onClick={() => onOpenPractice?.()} className="text-xs underline min-h-[32px] disabled:opacity-50">Practice</button>
        <button type="button" data-testid="weak-open-cards" disabled={!onOpenCards} onClick={() => onOpenCards?.()} className="text-xs underline min-h-[32px] disabled:opacity-50">Cards</button>
        <button type="button" data-testid="weak-dismiss" disabled={!onDismissGap} onClick={() => onDismissGap?.()} className="text-xs underline min-h-[32px] disabled:opacity-50">Dismiss</button>
      </div>
      <ReassessmentChoice
        readyRevisionId={readyRevisionId}
        excludedFingerprints={excludedFingerprints}
        weakTopics={weakTopics}
        sourceState={sourceState}
        returnContext={returnContext}
        onRetakeSame={onRetakeSame}
        onCreateNewPaper={onCreateNewPaper}
      />
      {children}
      {recomputeNote && (
        <p role="status" data-testid="weak-recompute-note" className="text-xs">{recomputeNote}</p>
      )}
      <p className="text-xs text-on-surface-variant" data-testid="weak-history-note">
        Same-revision rows are same-paper with memory effects; different revisions are descriptive cross-paper
        history without equivalence claims. Evidence recomputes when reassessment finishes.
      </p>
    </section>
  );
};
