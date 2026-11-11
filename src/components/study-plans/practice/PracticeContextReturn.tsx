import React from 'react';

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
  if (!context || (!context.planId && !context.nodeId && !context.gapId)) return null;
  return (
    <div data-testid="practice-context-return" className="rounded-xl border border-outline-variant/30 p-3">
      <p className="text-xs">
        Return context: plan {context.planId ?? '—'}, node {context.nodeId ?? '—'}, gap {context.gapId ?? '—'}
      </p>
      <button
        type="button"
        data-testid="practice-context-return-button"
        onClick={() => onReturn?.()}
        className="text-xs underline min-h-[32px]"
      >
        Return to plan
      </button>
    </div>
  );
};
