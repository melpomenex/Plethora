import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  type CapabilityId,
  type CapabilityState,
  type EntitlementSnapshot,
  type PlanId,
  type QuotaWindow,
  type SnapshotSource,
  CAPABILITY_IDS,
  CAPABILITY_REGISTRY,
  FREE_DEFAULT_SNAPSHOT,
} from '../types/entitlements';
import { invoke, isTauri } from '../lib/tauri';
import { PLETHORA_API_URL, isCloudApiEnabled, isPlethoraCloudAvailable } from '../config/product';
import { useAccountStore } from './accountStore';

const GRACE_PERIOD_MS = 72 * 60 * 60 * 1000; // 72 hours
const TTL_MS = 15 * 60 * 1000; // 15 minutes

/** Typed native refresh outcome (src-tauri/src/entitlements/mod.rs). */
export type EntitlementRefreshOutcome =
  | { status: 'verified'; snapshot: EntitlementSnapshot }
  | { status: 'stale_cache'; snapshot: EntitlementSnapshot }
  | { status: 'auth_expired'; snapshot: EntitlementSnapshot }
  | { status: 'anonymous'; snapshot: EntitlementSnapshot };

export type EntitlementVerificationStatus = 'checking' | 'verified' | 'stale' | 'anonymous';

/** Monotonic refresh generation: a response may only be applied while it is
 * still the latest refresh. Guards billing-init vs account-init races and any
 * late-resolving stale request. */
let refreshGeneration = 0;

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

/** PWA/browser transport for the authoritative entitlement snapshot. Mirrors
 * the native flow: bearer when authenticated, 401 → refresh token → retry
 * once, anonymous → server Free. */
async function fetchEntitlementsFromServer(bearer?: string): Promise<Response> {
  return fetch(`${PLETHORA_API_URL}/v1/entitlements`, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
  });
}

function snapshotFromServerResponse(payload: unknown): EntitlementSnapshot | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  const capabilities: Record<string, CapabilityState> =
    (raw.capabilities as Record<string, CapabilityState>) ?? {};
  const mapped: Partial<Record<CapabilityId, CapabilityState>> = {};
  let known = 0;
  for (const [key, state] of Object.entries(capabilities)) {
    if ((CAPABILITY_IDS as readonly string[]).includes(key)) {
      mapped[key as CapabilityId] = {
        enabled: state?.enabled === true,
        reason: state?.reason,
        quota: state?.quota
          ? {
              used: Number((state.quota as { used?: number }).used ?? 0),
              limit: Number((state.quota as { limit?: number }).limit ?? 0),
              window: ((state.quota as { window?: string }).window ?? 'monthly') as QuotaWindow,
              resetsAt: (state.quota as { resetsAt?: string }).resetsAt,
            }
          : undefined,
      };
      known += 1;
    }
  }
  if (known === 0) return null;
  const source: SnapshotSource = raw.source === 'cache' ? 'cache' : raw.source === 'grace' ? 'grace' : 'server';
  return {
    accountId: (raw.accountId as string) ?? undefined,
    plan: (raw.plan as PlanId) ?? 'free',
    capabilities: mapped as Record<CapabilityId, CapabilityState>,
    fetchedAt: (raw.fetchedAt as string) ?? new Date().toISOString(),
    expiresAt: (raw.expiresAt as string) ?? undefined,
    source,
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
        const generation = ++refreshGeneration;
        set({ loading: true, error: null });
        /** Apply a snapshot only when this refresh is still the latest AND
         * the snapshot belongs to the currently signed-in account. */
        const applyIfCurrent = (snapshot: EntitlementSnapshot): boolean => {
          if (generation !== refreshGeneration) return false;
          // Strict account match: a response fetched for account A applies
          // neither to account B nor to a signed-out session (mid-flight
          // switch / sign-out during the request).
          const activeAccount = useAccountStore.getState().user?.id ?? null;
          const snapshotAccount = snapshot.accountId ?? null;
          return snapshotAccount === activeAccount;
        };

        try {
          if (isTauri()) {
            let outcome = await invoke<EntitlementRefreshOutcome>('entitlement_refresh');

            // The server rejected the presented bearer (e.g. the 15-minute
            // access token expired): refresh the token, mirror it into native
            // auth, and retry once. Token expiry is never a Free downgrade.
            if (outcome.status === 'auth_expired') {
              await useAccountStore.getState().refresh();
              outcome = await invoke<EntitlementRefreshOutcome>('entitlement_refresh');
            }

            if (applyIfCurrent(outcome.snapshot)) {
              set({ snapshot: outcome.snapshot, loading: false });
            } else {
              set({ loading: false });
            }
            return get().snapshot;
          }

          // PWA/browser: fetch the authoritative snapshot from the server with
          // the same semantics (bearer, 401 → refresh → retry, anonymous).
          // Cloud-disabled builds (VITE_PLETHORA_API_URL=off) keep the local
          // snapshot instead of fetching a nonsense 'off/...' URL.
          // When Plethora Cloud is unavailable and user is anonymous, skip server
          // fetch to prevent cold-boot unauthenticated network calls.
          if (!isCloudApiEnabled() || (!isPlethoraCloudAvailable() && !useAccountStore.getState().isAuthenticated)) {
            set({ loading: false });
            return get().snapshot;
          }
          const account = useAccountStore.getState();
          const bearer = account.isAuthenticated ? account.tokens?.accessToken : undefined;
          let response = await fetchEntitlementsFromServer(bearer);
          if (response.status === 401 && account.isAuthenticated) {
            await useAccountStore.getState().refresh();
            const rotated = useAccountStore.getState().tokens?.accessToken;
            if (rotated) {
              response = await fetchEntitlementsFromServer(rotated);
            }
          }
          if (!response.ok && response.status !== 401) {
            // Network/server failure: keep the persisted snapshot with its
            // original provenance — never manufacture or freshen a fallback.
            set({ loading: false });
            return get().snapshot;
          }
          const payload = await response.json().catch(() => null);
          const snapshot = response.ok ? snapshotFromServerResponse(payload) : null;
          // A 401 that survived the token refresh (or an unusable payload)
          // keeps the retained snapshot — never a manufactured downgrade.
          if (snapshot && applyIfCurrent(snapshot)) {
            set({ snapshot, loading: false });
          } else {
            set({ loading: false });
          }
          return get().snapshot;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          if (generation === refreshGeneration) {
            set({ loading: false, error: errorMsg });
          }
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
          return;
        }
        // PWA: hydrate from the server (nothing calls refresh at startup
        // otherwise, leaving a stale local snapshot while online).
        if (isCloudApiEnabled() && (isPlethoraCloudAvailable() || useAccountStore.getState().isAuthenticated)) {
          await get().refresh();
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

// ---------------------------------------------------------------------------
// Central selectors — UI plan/Pro/status gating goes through these instead of
// each component interpreting partial startup state on its own.
// ---------------------------------------------------------------------------

export function selectPlan(state: EntitlementStoreState): PlanId {
  return state.snapshot.plan;
}

export function selectIsPro(state: EntitlementStoreState): boolean {
  return state.snapshot.plan === 'pro';
}

/** Verification status for display purposes:
 *  - `checking`: no verified/persisted snapshot yet for a signed-in account
 *    (includes the local-defaults snapshot a buggy prior build may have
 *    persisted — that must never read as *confirmed* Free while signed in);
 *  - `verified` / `stale` / `anonymous` derived from the snapshot source. */
export function selectEntitlementStatus(
  state: EntitlementStoreState
): EntitlementVerificationStatus {
  const { snapshot } = state;
  if (snapshot.source === 'local_defaults') {
    const signedIn = useAccountStore.getState().isAuthenticated;
    return signedIn ? 'checking' : 'anonymous';
  }
  if (snapshot.source === 'server') return 'verified';
  if (snapshot.source === 'grace') return 'stale';
  if (snapshot.source === 'cache') return 'verified';
  return 'anonymous';
}
