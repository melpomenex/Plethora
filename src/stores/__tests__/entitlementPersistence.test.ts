import { describe, expect, it, beforeEach, vi } from 'vitest';

// Native IPC mock — tests drive refresh outcomes through this. The account
// store is used REAL (driven via setState) rather than module-mocked: the
// production entitlementStore ↔ accountStore import cycle makes a module mock
// fragile under shared test-worker module registries.
const invokeMock = vi.fn();
vi.mock('../../lib/tauri', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  listen: vi.fn(() => Promise.resolve(() => {})),
  isTauri: () => true,
  isNativeMobile: () => false,
  isWebMode: () => false,
  isTauriRuntimeTarget: () => true,
}));

import { useAccountStore } from '../accountStore';
import {
  selectEntitlementStatus,
  selectIsPro,
  selectPlan,
  useEntitlementStore,
  type EntitlementRefreshOutcome,
} from '../entitlementStore';
import { FREE_DEFAULT_SNAPSHOT, type EntitlementSnapshot } from '../../types/entitlements';

function proSnapshot(accountId = 'user-pro'): EntitlementSnapshot {
  return {
    accountId,
    plan: 'pro',
    fetchedAt: new Date().toISOString(),
    source: 'server',
    capabilities: {
      ...FREE_DEFAULT_SNAPSHOT.capabilities,
      cloud_sync: { enabled: true },
    },
  };
}

function freeSnapshot(accountId = 'user-pro'): EntitlementSnapshot {
  return {
    accountId,
    plan: 'free',
    fetchedAt: new Date().toISOString(),
    source: 'server',
    capabilities: { ...FREE_DEFAULT_SNAPSHOT.capabilities },
  };
}

function outcome(
  status: EntitlementRefreshOutcome['status'],
  snapshot: EntitlementSnapshot,
): EntitlementRefreshOutcome {
  return { status, snapshot } as EntitlementRefreshOutcome;
}

function signInAs(accountId: string, tier = 'pro') {
  useAccountStore.setState({
    isAuthenticated: true,
    user: { id: accountId, email: `${accountId}@example.com`, subscriptionTier: tier },
    tokens: { accessToken: 'token', refreshToken: 'refresh', expiresIn: 900 },
    devices: [],
    loading: false,
    error: null,
  });
}

function signOutLocal() {
  useAccountStore.setState({
    isAuthenticated: false,
    user: null,
    tokens: null,
    devices: [],
  });
}

describe('entitlementStore refresh outcomes (native)', () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
    signOutLocal();
    signInAs('user-pro');
    useAccountStore.setState({ refresh: vi.fn(() => Promise.resolve()) });
    useEntitlementStore.setState({
      snapshot: proSnapshot(),
      overrides: {},
      loading: false,
      error: null,
    });
  });

  it('a verified Free response for the same account downgrades Pro → Free', async () => {
    invokeMock.mockResolvedValueOnce(outcome('verified', freeSnapshot()));
    await useEntitlementStore.getState().refresh();
    expect(useEntitlementStore.getState().snapshot.plan).toBe('free');
  });

  it('a stale_cache outcome keeps the retained Pro snapshot untouched (fetchedAt preserved)', async () => {
    const before = useEntitlementStore.getState().snapshot;
    invokeMock.mockResolvedValueOnce(outcome('stale_cache', { ...before, source: 'grace' }));
    await useEntitlementStore.getState().refresh();
    const after = useEntitlementStore.getState().snapshot;
    expect(after.plan).toBe('pro');
    expect(after.fetchedAt).toBe(before.fetchedAt);
  });

  it('auth_expired triggers token refresh + one retry, ending verified', async () => {
    invokeMock
      .mockResolvedValueOnce(outcome('auth_expired', proSnapshot()))
      .mockResolvedValueOnce(outcome('verified', proSnapshot()));
    const snapshot = await useEntitlementStore.getState().refresh();
    expect(useAccountStore.getState().refresh).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(snapshot.plan).toBe('pro');
  });

  it('auth_expired that still fails keeps Pro (never Free)', async () => {
    invokeMock
      .mockResolvedValueOnce(outcome('auth_expired', proSnapshot()))
      .mockResolvedValueOnce(outcome('auth_expired', proSnapshot()));
    const snapshot = await useEntitlementStore.getState().refresh();
    expect(snapshot.plan).toBe('pro');
  });

  it('anonymous outcome applies Free defaults (logged-out state)', async () => {
    signOutLocal();
    invokeMock.mockResolvedValueOnce(outcome('anonymous', FREE_DEFAULT_SNAPSHOT));
    await useEntitlementStore.getState().refresh();
    expect(useEntitlementStore.getState().snapshot.plan).toBe('free');
    expect(useEntitlementStore.getState().snapshot.accountId).toBeUndefined();
  });

  it('an anonymous outcome while still signed in keeps the retained snapshot (no ambiguous downgrade)', async () => {
    invokeMock.mockResolvedValueOnce(outcome('anonymous', FREE_DEFAULT_SNAPSHOT));
    await useEntitlementStore.getState().refresh();
    expect(useEntitlementStore.getState().snapshot.plan).toBe('pro');
  });

  it('a late-resolving older refresh cannot overwrite a newer verified result', async () => {
    // Refresh A (older) resolves last with Free; refresh B (newer) resolved Pro.
    let resolveA!: (value: EntitlementRefreshOutcome) => void;
    invokeMock.mockImplementationOnce(
      () =>
        new Promise<EntitlementRefreshOutcome>((resolve) => {
          resolveA = resolve;
        }),
    );
    const refreshA = useEntitlementStore.getState().refresh();
    invokeMock.mockResolvedValueOnce(outcome('verified', proSnapshot()));
    const refreshB = useEntitlementStore.getState().refresh();
    await refreshB;
    resolveA(outcome('verified', freeSnapshot()));
    await refreshA;

    expect(useEntitlementStore.getState().snapshot.plan).toBe('pro');
  });

  it('a response for a different account is not applied', async () => {
    invokeMock.mockResolvedValueOnce(outcome('verified', proSnapshot('user-other')));
    await useEntitlementStore.getState().refresh();
    expect(useEntitlementStore.getState().snapshot.plan).toBe('pro');
    expect(useEntitlementStore.getState().snapshot.accountId).toBe('user-pro');
  });

  it('sign-out reset uses canonical Free defaults (no lingering Pro capabilities)', () => {
    useEntitlementStore.getState().setSnapshot(FREE_DEFAULT_SNAPSHOT);
    const state = useEntitlementStore.getState();
    expect(state.snapshot.plan).toBe('free');
    expect(state.snapshot.source).toBe('local_defaults');
    expect(state.snapshot.capabilities.cloud_sync.enabled).toBe(false);
  });
});

describe('entitlement selectors', () => {
  beforeEach(() => {
    localStorage.clear();
    signOutLocal();
    signInAs('user-pro');
    useEntitlementStore.setState({
      snapshot: FREE_DEFAULT_SNAPSHOT,
      overrides: {},
      loading: false,
      error: null,
    });
  });

  it('local_defaults for a signed-in account reads as checking, never confirmed Free', () => {
    expect(selectEntitlementStatus(useEntitlementStore.getState())).toBe('checking');
  });

  it('server snapshot reads as verified; grace reads as stale', () => {
    useEntitlementStore.setState({ snapshot: proSnapshot() });
    expect(selectEntitlementStatus(useEntitlementStore.getState())).toBe('verified');
    useEntitlementStore.setState({ snapshot: { ...proSnapshot(), source: 'grace' } });
    expect(selectEntitlementStatus(useEntitlementStore.getState())).toBe('stale');
  });

  it('plan/isPro derive from the snapshot', () => {
    useEntitlementStore.setState({ snapshot: proSnapshot() });
    expect(selectIsPro(useEntitlementStore.getState())).toBe(true);
    expect(selectPlan(useEntitlementStore.getState())).toBe('pro');
    useEntitlementStore.setState({ snapshot: freeSnapshot() });
    expect(selectIsPro(useEntitlementStore.getState())).toBe(false);
  });

  it('anonymous local_defaults reads as anonymous when signed out', () => {
    signOutLocal();
    expect(selectEntitlementStatus(useEntitlementStore.getState())).toBe('anonymous');
  });
});
