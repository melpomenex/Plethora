import React from 'react';
import type { AttemptSummary } from '../../../types/assessmentSessions';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface DiagnosticResumeCardProps {
  attempt: AttemptSummary | null;
  onResume?: (attemptId: string) => void | Promise<void>;
  onDiscard?: (attemptId: string) => void | Promise<void>;
}

export const DiagnosticResumeCard: React.FC<DiagnosticResumeCardProps> = ({
  attempt,
  onResume,
  onDiscard,
}) => {
        useI18n();
        if (!attempt) return null;
  return (
    <section aria-label={translateRecentFeature("studyPlans.ui.resume-diagnostic.334572a5")} data-testid="diagnostic-resume" className="rounded-xl border border-outline-variant/30 p-4 space-y-2">
      <p className="text-xs" data-testid="diagnostic-resume-id">{translateRecentFeature("studyPlans.ui.interrupted-diagnostic-var0-.f2f264de", {var0: attempt.id, var1: attempt.status})}</p>
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="diagnostic-resume-button"
          onClick={() => void onResume?.(attempt.id)}
          className="text-xs underline min-h-[32px]"
        >
          {translateRecentFeature("aiLibrary.indexResume")}</button>
        {onDiscard && (
          <button
            type="button"
            data-testid="diagnostic-discard-button"
            onClick={() => void onDiscard?.(attempt.id)}
            className="text-xs underline min-h-[32px]"
          >
            {translateRecentFeature("screenshot.discard")}</button>
        )}
      </div>
    </section>
  );
};
