import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  type CapabilityId,
  type CapabilityState,
  type EntitlementSnapshot,
  CAPABILITY_IDS,
  CAPABILITY_REGISTRY,
  FREE_DEFAULT_SNAPSHOT,
  createFreeDefaultCapabilities,
} from '../types/entitlements';
import { invoke, isTauri } from '../lib/tauri';

const GRACE_PERIOD_MS = 72 * 60 * 60 * 1000; // 72 hours
const TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface EntitlementStoreState {
  snapshot: EntitlementSnapshot;
  overrides: Partial<Record<CapabilityId, boolean>>;
  loading: boolean;
  error: string | null;

  // Actions
  setSnapshot: (snapshot: EntitlementSnapshot) => void;
  setOverride: (capability: CapabilityId, enabled: boolean | null) => void;
  clearOverrides: () => void;
  refresh: () => Promise<EntitlementSnapshot>;
  getCapabilityState: (capability: CapabilityId) => CapabilityState;
  isCapabilityEnabled: (capability: CapabilityId) => boolean;
  init: () => Promise<void>;
}

/**
 * Resolve capability state from overrides -> cached snapshot -> free defaults.
 */
export function resolveCapability(
  capability: CapabilityId,
  snapshot: EntitlementSnapshot,
  overrides: Partial<Record<CapabilityId, boolean>>,
  now = Date.now()
): CapabilityState {
  // 1. Local overrides take top precedence
  if (typeof overrides[capability] === 'boolean') {
    const enabled = overrides[capability]!;
    return {
      enabled,
      reason: enabled ? undefined : 'plan',
    };
  }

  // 2. Cached server snapshot (fresh or within 72h grace window)
  if (snapshot.source === 'local_defaults' && snapshot.capabilities && snapshot.capabilities[capability]) {
    return snapshot.capabilities[capability];
  }

  const fetchedAt = new Date(snapshot.fetchedAt).getTime();
  const age = now - fetchedAt;

  if (snapshot.capabilities && snapshot.capabilities[capability]) {
    const state = snapshot.capabilities[capability];
    if (age <= TTL_MS) {
      return state;
    }
    if (age <= GRACE_PERIOD_MS) {
      return state;
    }
    // Past grace period: non-free capabilities degrade to offline/plan
    const desc = CAPABILITY_REGISTRY[capability];
    if (desc && desc.defaultPlan !== 'free') {
      return {
        enabled: false,
        reason: 'offline',
      };
    }
    return state;
  }

  // 3. Fallback to Free plan defaults
  const desc = CAPABILITY_REGISTRY[capability];
  if (desc) {
    return {
      enabled: desc.defaultPlan === 'free',
      reason: desc.defaultPlan === 'free' ? undefined : 'plan',
    };
  }

  return {
    enabled: false,
    reason: 'unavailable',
  };
}

export const useEntitlementStore = create<EntitlementStoreState>()(
  persist(
    (set, get) => ({
      snapshot: FREE_DEFAULT_SNAPSHOT,
      overrides: {},
      loading: false,
      error: null,

      setSnapshot: (snapshot) => {
        set({ snapshot, error: null });
      },

      setOverride: (capability, enabled) => {
        set((state) => {
          const nextOverrides = { ...state.overrides };
          if (enabled === null) {
            delete nextOverrides[capability];
          } else {
            nextOverrides[capability] = enabled;
          }
          return { overrides: nextOverrides };
        });

        // Sync with Tauri backend if available
        if (isTauri()) {
          if (enabled === null) {
            invoke('entitlement_override_clear', { capability }).catch(() => {});
          } else {
            invoke('entitlement_override_set', { capability, enabled }).catch(() => {});
          }
        }
      },

      clearOverrides: () => {
        set({ overrides: {} });
        if (isTauri()) {
          invoke('entitlement_override_clear', { capability: null }).catch(() => {});
        }
      },

      refresh: async () => {
        set({ loading: true, error: null });
        try {
          if (isTauri()) {
            const serverSnapshot = await invoke<EntitlementSnapshot>('entitlement_refresh');
            set({ snapshot: serverSnapshot, loading: false });
            return serverSnapshot;
          }

          // In PWA/web mode, refresh updates fetchedAt timestamp
          const current = get().snapshot;
          const refreshed: EntitlementSnapshot = {
            ...current,
            fetchedAt: new Date().toISOString(),
          };
          set({ snapshot: refreshed, loading: false });
          return refreshed;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          set({ loading: false, error: errorMsg });
          return get().snapshot;
        }
      },

      getCapabilityState: (capability: CapabilityId): CapabilityState => {
        const { snapshot, overrides } = get();
        return resolveCapability(capability, snapshot, overrides);
      },

      isCapabilityEnabled: (capability: CapabilityId): boolean => {
        return get().getCapabilityState(capability).enabled;
      },

      init: async () => {
        if (isTauri()) {
          try {
            const snapshot = await invoke<EntitlementSnapshot>('entitlement_get_snapshot');
            set({ snapshot });
          } catch {
            // Keep persisted or free defaults on IPC failure
          }
        }
      },
    }),
    {
      name: 'plethora-entitlements',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        snapshot: state.snapshot,
        overrides: state.overrides,
      }),
    }
  )
);
