import React from 'react';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


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
        useI18n();
        if (status !== 'suggested') {
    return (
      <span data-testid={`remediation-status-${recommendationId}`} className="text-xs">{translateRecentFeature("studyPlans.ui.disposition-var0-reversible-.2ebab084", {var0: status})}</span>
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
        {translateRecentFeature("studyPlans.ui.accept.20ea1c04")}</button>
      <button
        type="button"
        data-testid={`remediation-dismiss-${recommendationId}`}
        onClick={() => void onDisposition?.('dismissed')}
        className="text-xs underline min-h-[32px]"
      >
        {translateRecentFeature("studyPlans.ui.reject.99208483")}</button>
    </div>
  );
};
