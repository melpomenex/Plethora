import React from 'react';
import { usePaywallStore } from '../../stores/paywallStore';

export const TrialBadge: React.FC = () => {
  const { trial } = usePaywallStore();

  if (!trial.isActive) return null;

  return (
    <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-accent-muted text-accent-fg border border-accent/20">
      <span>✨</span>
      <span>Pro Trial ({trial.daysRemaining}d left)</span>
    </div>
  );
};
