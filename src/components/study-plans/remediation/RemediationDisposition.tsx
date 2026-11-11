import React from 'react';

export interface RemediationDispositionProps {
  recommendationId: string;
  status: string;
  onDisposition?: (status: 'accepted' | 'dismissed' | 'completed') => void | Promise<void>;
}

export const RemediationDisposition: React.FC<RemediationDispositionProps> = ({
  recommendationId,
  status,
  onDisposition,
}) => {
  if (status !== 'suggested') {
    return (
      <span data-testid={`remediation-status-${recommendationId}`} className="text-xs">
        Disposition: {status} (reversible — evidence preserved)
      </span>
    );
  }
  return (
    <div className="flex gap-2" data-testid={`remediation-disposition-${recommendationId}`}>
      <button
        type="button"
        data-testid={`remediation-accept-${recommendationId}`}
        onClick={() => void onDisposition?.('accepted')}
        className="text-xs underline min-h-[32px]"
      >
        Accept
      </button>
      <button
        type="button"
        data-testid={`remediation-dismiss-${recommendationId}`}
        onClick={() => void onDisposition?.('dismissed')}
        className="text-xs underline min-h-[32px]"
      >
        Reject
      </button>
    </div>
  );
};
