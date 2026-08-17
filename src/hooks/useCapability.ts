import { useMemo } from 'react';
import { useEntitlementStore } from '../stores/entitlementStore';
import {
  type CapabilityId,
  type CapabilityState,
  CAPABILITY_IDS,
} from '../types/entitlements';

/**
 * Hook to inspect the entitlement state of a specific capability.
 */
export function useCapability(id: CapabilityId): CapabilityState {
  const snapshot = useEntitlementStore((state) => state.snapshot);
  const overrides = useEntitlementStore((state) => state.overrides);
  const getCapabilityState = useEntitlementStore((state) => state.getCapabilityState);

  return useMemo(() => {
    return getCapabilityState(id);
  }, [id, snapshot, overrides, getCapabilityState]);
}

/**
 * Hook to inspect the entitlement state of all registered capabilities.
 */
export function useAllCapabilities(): Record<CapabilityId, CapabilityState> {
  const snapshot = useEntitlementStore((state) => state.snapshot);
  const overrides = useEntitlementStore((state) => state.overrides);
  const getCapabilityState = useEntitlementStore((state) => state.getCapabilityState);

  return useMemo(() => {
    const map = {} as Record<CapabilityId, CapabilityState>;
    for (const id of CAPABILITY_IDS) {
      map[id] = getCapabilityState(id);
    }
    return map;
  }, [snapshot, overrides, getCapabilityState]);
}
