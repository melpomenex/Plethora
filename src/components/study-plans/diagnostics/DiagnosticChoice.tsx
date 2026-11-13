import React from 'react';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export type DiagnosticAvailability =
  | 'ready'
  | 'none'
  | 'no-provider'
  | 'local-only'
  | 'cancelled'
  | 'interrupted';

export interface DiagnosticChoiceProps {
  availability?: DiagnosticAvailability;
  isBusy?: boolean;
  onTake?: () => void | Promise<void>;
  onSkip?: () => void | Promise<void>;
}

export const DiagnosticChoice: React.FC<DiagnosticChoiceProps> = ({
  availability = 'ready',
  isBusy = false,
  onTake,
  onSkip,
}) => {
        useI18n();
        return (
    <section aria-label={translateRecentFeature("studyPlans.ui.optional-diagnostic.48139e98")} data-testid="diagnostic-choice" className="space-y-2 rounded-xl border border-outline-variant/30 p-4">
      <h3 className="font-medium text-sm">{translateRecentFeature("studyPlans.ui.optional-diagnostic-4-12-que.bb077a1d")}</h3>
      <p className="text-xs text-on-surface-variant">
        {translateRecentFeature("studyPlans.ui.take-a-short-diagnostic-to-g.ce5d725a")}</p>
      {availability !== 'ready' && (
        <p data-testid="diagnostic-availability" className="text-xs">{translateRecentFeature("studyPlans.ui.state-var0-skip-leaves-no-ar.9d207738", {var0: availability})}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="diagnostic-take"
          disabled={isBusy || !onTake}
          onClick={() => void onTake?.()}
          className="text-xs underline min-h-[32px] disabled:opacity-50"
        >
          {translateRecentFeature("studyPlans.ui.take-diagnostic.7f3ab455")}</button>
        <button
          type="button"
          data-testid="diagnostic-skip"
          disabled={isBusy || !onSkip}
          onClick={() => void onSkip?.()}
          className="text-xs underline min-h-[32px] disabled:opacity-50"
        >
          {translateRecentFeature("common.skip")}</button>
      </div>
    </section>
  );
};
