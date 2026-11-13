import React from 'react';
import type { ReassessmentReturnContext } from './returnContext';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface ReassessmentChoiceProps {
  readyRevisionId: string | null;
  excludedFingerprints: string[];
  weakTopics: string[];
  sourceState?: 'ok' | 'deleted' | 'stale';
  returnContext?: ReassessmentReturnContext | null;
  onRetakeSame?: (revisionId: string) => void | Promise<void>;
  onCreateNewPaper?: () => void | Promise<void>;
}

export const ReassessmentChoice: React.FC<ReassessmentChoiceProps> = ({
  readyRevisionId,
  excludedFingerprints,
  weakTopics,
  sourceState = 'ok',
  returnContext = null,
  onRetakeSame,
  onCreateNewPaper,
}) => {
        useI18n();
        return (
    <section aria-label={translateRecentFeature("studyPlans.ui.follow-up-reassessment-choic.9f5b0b26")} data-testid="reassessment-choice" className="space-y-2 rounded-xl border border-outline-variant/30 p-4">
      <h3 className="font-medium text-sm">{translateRecentFeature("studyPlans.ui.follow-up-retake-or-new-pape.bdd450d8")}</h3>
      <p className="text-xs text-on-surface-variant" data-testid="reassessment-scope">{translateRecentFeature("studyPlans.ui.targets-var0-weak-topic-s-ex.f0ce029a", {var0: weakTopics.length, var1: excludedFingerprints.length})}</p>
      {sourceState !== 'ok' && (
        <p role="alert" data-testid="reassessment-source-state" className="text-xs">{translateRecentFeature("studyPlans.ui.source-var0-historical-excer.aff3689a", {var0: sourceState})}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="reassessment-retake"
          disabled={!readyRevisionId || !onRetakeSame}
          onClick={() => readyRevisionId && void onRetakeSame?.(readyRevisionId)}
          className="text-xs underline min-h-[32px] disabled:opacity-50"
        >
          {translateRecentFeature("studyPlans.ui.retake-same-ready-paper.1a4f5831")}</button>
        <button
          type="button"
          data-testid="reassessment-new-paper"
          disabled={!onCreateNewPaper}
          onClick={() => void onCreateNewPaper?.()}
          className="text-xs underline min-h-[32px] disabled:opacity-50"
        >
          {translateRecentFeature("studyPlans.ui.new-paper-weak-topics-exclus.5501862b")}</button>
      </div>
      {returnContext && (
        <p className="text-xs" data-testid="reassessment-return">
          {translateRecentFeature("studyPlans.ui.returns-to-plan.2d198b12")}{returnContext.planId ?? '—'} {translateRecentFeature("studyPlans.ui.after-results-published-plan.0f05eff2")}</p>
      )}
    </section>
  );
};
