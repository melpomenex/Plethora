import React from 'react';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface NextPracticePanelProps {
  conceptId: string;
  advisedDifficulty: number;
  reason: 'decrease' | 'increase' | 'same';
  excludedFingerprints: string[];
  onCreateNext?: () => void | Promise<void>;
}

export const NextPracticePanel: React.FC<NextPracticePanelProps> = ({
  conceptId,
  advisedDifficulty,
  reason,
  excludedFingerprints,
  onCreateNext,
}) => {
        useI18n();
        return (
    <div data-testid="next-practice" className="rounded-xl border border-outline-variant/30 p-3 space-y-1">
      <p className="text-xs" data-testid="next-practice-advice">{translateRecentFeature("studyPlans.ui.next-practice-for-var0-diffi.3d1db8d4", {var0: conceptId, var1: advisedDifficulty, var2: reason, var3: excludedFingerprints.length})}</p>
      <p className="text-xs text-on-surface-variant">{translateRecentFeature("studyPlans.ui.created-only-on-your-request.47d486df")}</p>
      <button
        type="button"
        data-testid="next-practice-create"
        onClick={() => void onCreateNext?.()}
        className="text-xs underline min-h-[32px]"
      >
        {translateRecentFeature("studyPlans.ui.create-next-practice-draft.1b419c6b")}</button>
    </div>
  );
};
