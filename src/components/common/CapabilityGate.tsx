import React, { type ReactNode } from 'react';
import { useCapability } from '../../hooks/useCapability';
import type { CapabilityId, CapabilityState, QuotaState } from '../../types/entitlements';

export interface CapabilityGateProps {
  capability: CapabilityId;
  children: ReactNode | ((state: CapabilityState) => ReactNode);
  fallback?: ReactNode | ((state: CapabilityState) => ReactNode);
  renderDisabledReason?: boolean;
}

/**
 * Conditionally renders children if the specified capability is enabled.
 * Otherwise renders the optional fallback or an unstyled reason message.
 */
export function CapabilityGate({
  capability,
  children,
  fallback,
  renderDisabledReason = false,
}: CapabilityGateProps) {
  const state = useCapability(capability);

  if (state.enabled) {
    if (typeof children === 'function') {
      return <>{children(state)}</>;
    }
    return <>{children}</>;
  }

  if (fallback !== undefined) {
    if (typeof fallback === 'function') {
      return <>{fallback(state)}</>;
    }
    return <>{fallback}</>;
  }

  if (renderDisabledReason && state.reason) {
    return (
      <div className="text-xs text-muted-foreground italic py-1">
        Feature unavailable ({state.reason})
      </div>
    );
  }

  return null;
}

export interface QuotaMeterProps {
  quota: QuotaState;
  showLabel?: boolean;
  className?: string;
}

/**
 * Primitives for rendering quota usage and limits.
 */
export function QuotaMeter({ quota, showLabel = true, className = '' }: QuotaMeterProps) {
  const percentage = quota.limit > 0 ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0;
  const isExhausted = quota.limit > 0 && quota.used >= quota.limit;

  return (
    <div className={`space-y-1 ${className}`}>
      {showLabel && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Usage</span>
          <span>
            {quota.used.toLocaleString()} / {quota.limit.toLocaleString()}
          </span>
        </div>
      )}
      <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${
            isExhausted ? 'bg-destructive' : percentage > 80 ? 'bg-amber-500' : 'bg-primary'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {quota.resetsAt && (
        <div className="text-[10px] text-muted-foreground text-right">
          Resets {new Date(quota.resetsAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}
