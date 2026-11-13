import React from 'react';
import type { AssessmentConfigV1 } from '../../../types/assessmentQuestions';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface DiagnosticGenerationPanelProps {
  config: AssessmentConfigV1;
  status?: 'idle' | 'generating' | 'needs-review' | 'ready' | 'error';
  progress?: string | null;
  error?: string | null;
  onStart?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
}

export const DiagnosticGenerationPanel: React.FC<DiagnosticGenerationPanelProps> = ({
  config,
  status = 'idle',
  progress = null,
  error = null,
  onStart,
  onCancel,
}) => {
        useI18n();
        return (
    <section aria-label={translateRecentFeature("studyPlans.ui.diagnostic-generation.d3059e1d")} data-testid="diagnostic-generation" className="space-y-2 rounded-xl border border-outline-variant/30 p-4">
      <p className="text-xs" data-testid="diagnostic-config">{translateRecentFeature("studyPlans.ui.diagnostic-var0-questions-mo.33f9d11b", {var0: config.requestedCount, var1: config.mode})}{' '}
        {config.timeLimitSeconds === null ? translateRecentFeature("studyPlans.ui.none.b4ef817b") : String(config.timeLimitSeconds)}{translateRecentFeature("studyPlans.ui.generation-and-privacy-contr.0cf07d09")}</p>
      {progress && (
        <p role="status" data-testid="diagnostic-progress" className="text-xs">
          {progress}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="diagnostic-error" className="text-xs">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="diagnostic-start"
          disabled={status === 'generating' || !onStart}
          onClick={() => void onStart?.()}
          className="text-xs underline min-h-[32px] disabled:opacity-50"
        >
          {translateRecentFeature("studyPlans.ui.start-diagnostic.19db1312")}</button>
        {onCancel && (
          <button
            type="button"
            data-testid="diagnostic-cancel"
            onClick={() => void onCancel?.()}
            className="text-xs underline min-h-[32px]"
          >
            {translateRecentFeature("common.cancel")}</button>
        )}
      </div>
      <p className="text-xs text-on-surface-variant">{translateRecentFeature("studyPlans.ui.status-var0-no-attempt-exist.10ad3602", {var0: status})}</p>
    </section>
  );
};
