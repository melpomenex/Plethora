import React, { useState } from 'react';
import type { RemediationRecommendation } from '../../../types/learningEvidence';

export interface RemediationActionProps {
  recommendation: RemediationRecommendation;
  onAction?: (recommendation: RemediationRecommendation) => void | Promise<void>;
  actionLabel?: string;
  disabledReason?: string | null;
}

export const RemediationAction: React.FC<RemediationActionProps> = ({
  recommendation,
  onAction,
  actionLabel,
  disabledReason = null,
}) => {
  const [isBusy, setIsBusy] = useState(false);
  const defaultLabel =
    recommendation.kind === 'open-source'
      ? 'Open source'
      : recommendation.kind === 'targeted-practice'
        ? 'Create practice draft'
        : recommendation.kind === 'follow-up-exam'
          ? 'Create follow-up draft'
          : recommendation.kind === 'plan-adjustment'
            ? 'Create plan-adjustment draft'
            : recommendation.kind;

  const handle = async () => {
    if (!onAction || disabledReason) return;
    setIsBusy(true);
    try {
      await onAction(recommendation);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div
      data-testid={`remediation-action-${recommendation.id}`}
      className="flex items-center justify-between gap-2 text-sm"
    >
      <span>
        {recommendation.kind} · {recommendation.status}
      </span>
      <button
        type="button"
        data-testid={`remediation-do-${recommendation.id}`}
        onClick={() => void handle()}
        disabled={!onAction || !!disabledReason || isBusy}
        title={disabledReason ?? undefined}
        className="text-xs underline disabled:opacity-50 min-h-[32px]"
      >
        {isBusy ? 'Working…' : (actionLabel ?? defaultLabel)}
      </button>
    </div>
  );
};
