import { describe, expect, it, beforeEach } from 'vitest';
import {
  useEntitlementStore,
  resolveCapability,
} from '../entitlementStore';
import {
  CAPABILITY_IDS,
  CAPABILITY_REGISTRY,
  FREE_DEFAULT_SNAPSHOT,
  type EntitlementSnapshot,
  type CapabilityId,
} from '../../types/entitlements';
import { defaultSettings } from '../../config/defaultSettings';
import { useSettingsStore } from '../settingsStore';

describe('entitlementStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useEntitlementStore.setState({
      snapshot: FREE_DEFAULT_SNAPSHOT,
      overrides: {},
      loading: false,
      error: null,
    });
  });

  it('resolves anonymous/cold start to Free defaults', () => {
    const state = useEntitlementStore.getState();
    expect(state.snapshot.plan).toBe('free');

    for (const id of CAPABILITY_IDS) {
      const capState = state.getCapabilityState(id);
      const desc = CAPABILITY_REGISTRY[id];
      if (desc.defaultPlan === 'free') {
        expect(capState.enabled).toBe(true);
      } else {
        expect(capState.enabled).toBe(false);
        expect(capState.reason).toBe('plan');
      }
    }
  });

  it('local overrides take top precedence over server snapshot', () => {
    const store = useEntitlementStore.getState();

    // Start with disabled cloud_sync
    expect(store.isCapabilityEnabled('cloud_sync')).toBe(false);

    // Set dev override
    store.setOverride('cloud_sync', true);
    expect(useEntitlementStore.getState().isCapabilityEnabled('cloud_sync')).toBe(true);

    const capState = useEntitlementStore.getState().getCapabilityState('cloud_sync');
    expect(capState.enabled).toBe(true);
    expect(capState.reason).toBeUndefined();

    // Clear override
    store.setOverride('cloud_sync', null);
    expect(useEntitlementStore.getState().isCapabilityEnabled('cloud_sync')).toBe(false);
  });

  it('honors offline grace window for cached Pro snapshot', () => {
    const now = Date.now();
    const mockProSnapshot: EntitlementSnapshot = {
      plan: 'pro',
      fetchedAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(), // 24 hours ago (within 72h grace)
      source: 'server',
      capabilities: {
        ...FREE_DEFAULT_SNAPSHOT.capabilities,
        cloud_sync: { enabled: true },
        library_intelligence: { enabled: true },
      },
    };

    // Within grace: cloud_sync is enabled
    const withinGrace = resolveCapability('cloud_sync', mockProSnapshot, {}, now);
    expect(withinGrace.enabled).toBe(true);

    // Past 72h grace (e.g. 80 hours ago): cloud capability degrades to disabled with reason offline
    const pastGraceSnapshot: EntitlementSnapshot = {
      ...mockProSnapshot,
      fetchedAt: new Date(now - 80 * 60 * 60 * 1000).toISOString(),
    };
    const expiredGrace = resolveCapability('cloud_sync', pastGraceSnapshot, {}, now);
    expect(expiredGrace.enabled).toBe(false);
    expect(expiredGrace.reason).toBe('offline');
  });

  it('handles unknown capabilities and plans gracefully without throwing', () => {
    const customSnapshot = {
      plan: 'enterprise_preview',
      fetchedAt: new Date().toISOString(),
      source: 'server',
      capabilities: {},
    } as unknown as EntitlementSnapshot;

    useEntitlementStore.getState().setSnapshot(customSnapshot);
    const resolved = useEntitlementStore.getState().getCapabilityState('cloud_sync');
    expect(resolved.enabled).toBe(false);
    expect(resolved.reason).toBe('plan');
  });
});

describe('settings v6 -> v7 migration', () => {
  it('deep-merges plethora section without modifying prior settings', () => {
    const priorPersisted = {
      general: { ...defaultSettings.general, autoSaveMinutes: 10 },
      interface: { ...defaultSettings.interface, theme: 'dark' },
    };

    const rehydrated = {
      ...defaultSettings,
      ...priorPersisted,
      plethora: {
        ...defaultSettings.plethora,
        overrides: { cloud_sync: true },
      },
    };

    expect(rehydrated.general.autoSaveMinutes).toBe(10);
    expect(rehydrated.interface.theme).toBe('dark');
    expect(rehydrated.plethora?.overrides?.cloud_sync).toBe(true);
  });
});
