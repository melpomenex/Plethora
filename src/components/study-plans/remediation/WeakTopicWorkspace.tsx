import React from 'react';
import type { ReassessmentReturnContext } from './returnContext';
import { ReassessmentChoice } from './ReassessmentChoice';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


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
        useI18n();
        return (
    <section aria-label={translateRecentFeature("studyPlans.ui.weak-topic-workspace.c1ce3665")} data-testid="weak-topic-workspace" className="space-y-3">
      <p className="text-xs text-on-surface-variant" data-testid="weak-topic-context">{translateRecentFeature("studyPlans.ui.weak-topic-plan-var0-node.56580044", {var0: planId})}{nodeId ?? '—'}{translateRecentFeature("studyPlans.ui.gap.1e310263")}{gapId ?? '—'}{translateRecentFeature("studyPlans.ui.from-attempt.470f01ba")}{sourceAttemptId ?? '—'}.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="weak-open-source" disabled={!onOpenSource} onClick={() => onOpenSource?.()} className="text-xs underline min-h-[32px] disabled:opacity-50">{translateRecentFeature("audio.openSource")}</button>
        <button type="button" data-testid="weak-open-tutor" disabled={!onOpenTutor} onClick={() => onOpenTutor?.()} className="text-xs underline min-h-[32px] disabled:opacity-50">{translateRecentFeature("studyPlans.ui.scoped-tutor.a92c7518")}</button>
        <button type="button" data-testid="weak-open-practice" disabled={!onOpenPractice} onClick={() => onOpenPractice?.()} className="text-xs underline min-h-[32px] disabled:opacity-50">{translateRecentFeature("studyPlans.ui.practice.e7940d9b")}</button>
        <button type="button" data-testid="weak-open-cards" disabled={!onOpenCards} onClick={() => onOpenCards?.()} className="text-xs underline min-h-[32px] disabled:opacity-50">{translateRecentFeature("reviewComplete.cards")}</button>
        <button type="button" data-testid="weak-dismiss" disabled={!onDismissGap} onClick={() => onDismissGap?.()} className="text-xs underline min-h-[32px] disabled:opacity-50">{translateRecentFeature("queue.dismiss")}</button>
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
        {translateRecentFeature("studyPlans.ui.same-revision-rows-are-same-.0245e4e5")}</p>
    </section>
  );
};
