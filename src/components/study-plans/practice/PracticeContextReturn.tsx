import React from 'react';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface PracticeReturnContext {
  planId?: string | null;
  versionId?: string | null;
  nodeId?: string | null;
  gapId?: string | null;
  sourceAttemptId?: string | null;
}

export interface PracticeContextReturnProps {
  context: PracticeReturnContext | null;
  onReturn?: () => void;
}

export const PracticeContextReturn: React.FC<PracticeContextReturnProps> = ({ context, onReturn }) => {
        useI18n();
        if (!context || (!context.planId && !context.nodeId && !context.gapId)) return null;
  return (
    <div data-testid="practice-context-return" className="rounded-xl border border-outline-variant/30 p-3">
      <p className="text-xs">
        {translateRecentFeature("studyPlans.ui.return-context-plan.fa789fc6")}{context.planId ?? '—'}{translateRecentFeature("studyPlans.ui.node.eddadd59")}{context.nodeId ?? '—'}{translateRecentFeature("studyPlans.ui.gap.1e310263")}{context.gapId ?? '—'}
      </p>
      <button
        type="button"
        data-testid="practice-context-return-button"
        onClick={() => onReturn?.()}
        className="text-xs underline min-h-[32px]"
      >
        {translateRecentFeature("studyPlans.ui.return-to-plan.1c81213c")}</button>
    </div>
  );
};
