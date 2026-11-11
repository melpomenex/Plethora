import React from 'react';
import type { AttemptSummary } from '../../../types/assessmentSessions';

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
  if (!attempt) return null;
  return (
    <section aria-label="Resume diagnostic" data-testid="diagnostic-resume" className="rounded-xl border border-outline-variant/30 p-4 space-y-2">
      <p className="text-xs" data-testid="diagnostic-resume-id">
        Interrupted diagnostic {attempt.id} ({attempt.status}) — resume restores persisted work after restart.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="diagnostic-resume-button"
          onClick={() => void onResume?.(attempt.id)}
          className="text-xs underline min-h-[32px]"
        >
          Resume
        </button>
        {onDiscard && (
          <button
            type="button"
            data-testid="diagnostic-discard-button"
            onClick={() => void onDiscard?.(attempt.id)}
            className="text-xs underline min-h-[32px]"
          >
            Discard
          </button>
        )}
      </div>
    </section>
  );
};
