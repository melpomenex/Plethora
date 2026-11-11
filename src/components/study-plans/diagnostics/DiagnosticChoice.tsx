import React from 'react';

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
  return (
    <section aria-label="Optional diagnostic" data-testid="diagnostic-choice" className="space-y-2 rounded-xl border border-outline-variant/30 p-4">
      <h3 className="font-medium text-sm">Optional diagnostic (4–12 questions, no timer, no essay)</h3>
      <p className="text-xs text-on-surface-variant">
        Take a short diagnostic to guide review emphasis, or Skip with no attempt or evidence created.
      </p>
      {availability !== 'ready' && (
        <p data-testid="diagnostic-availability" className="text-xs">
          State: {availability}. Skip leaves no artifacts; Take starts only on click.
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="diagnostic-take"
          disabled={isBusy || !onTake}
          onClick={() => void onTake?.()}
          className="text-xs underline min-h-[32px] disabled:opacity-50"
        >
          Take diagnostic
        </button>
        <button
          type="button"
          data-testid="diagnostic-skip"
          disabled={isBusy || !onSkip}
          onClick={() => void onSkip?.()}
          className="text-xs underline min-h-[32px] disabled:opacity-50"
        >
          Skip
        </button>
      </div>
    </section>
  );
};
