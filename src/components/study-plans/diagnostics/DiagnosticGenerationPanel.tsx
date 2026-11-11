import React from 'react';
import type { AssessmentConfigV1 } from '../../../types/assessmentQuestions';

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
  return (
    <section aria-label="Diagnostic generation" data-testid="diagnostic-generation" className="space-y-2 rounded-xl border border-outline-variant/30 p-4">
      <p className="text-xs" data-testid="diagnostic-config">
        Diagnostic: {config.requestedCount} questions, mode {config.mode}, timer{' '}
        {config.timeLimitSeconds === null ? 'none' : String(config.timeLimitSeconds)}. Generation and
        privacy controls reuse the existing builder flow.
      </p>
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
          Start diagnostic
        </button>
        {onCancel && (
          <button
            type="button"
            data-testid="diagnostic-cancel"
            onClick={() => void onCancel?.()}
            className="text-xs underline min-h-[32px]"
          >
            Cancel
          </button>
        )}
      </div>
      <p className="text-xs text-on-surface-variant">Status: {status}. No attempt exists before Start.</p>
    </section>
  );
};
