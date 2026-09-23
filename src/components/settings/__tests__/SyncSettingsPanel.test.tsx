import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SyncSettingsPanel } from '../SyncSettingsPanel';
import { useSyncStore } from '../../../stores/syncStore';
import { useAccountStore } from '../../../stores/accountStore';
import { useEntitlementStore } from '../../../stores/entitlementStore';
import * as productModule from '../../../config/product';

const VALID_KEY = 'a'.repeat(64);

function seedStores({
  hasMasterKey = false,
  recoveryKeyAcknowledged = false,
}: {
  hasMasterKey?: boolean;
  recoveryKeyAcknowledged?: boolean;
} = {}) {
  useAccountStore.setState({
    isAuthenticated: true,
    user: { id: 'u1', email: 'user@example.com', subscriptionTier: 'pro' },
    tokens: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900 },
    deviceId: 'dev-1',
    devices: [],
    loading: false,
    error: null,
  });
  useEntitlementStore.setState({
    snapshot: { plan: 'pro', features: {}, limits: {} },
  } as never);
  useSyncStore.setState({
    hasMasterKey,
    recoveryKeyAcknowledged,
    isSyncing: false,
    lastSyncedAt: null,
    pendingOutboxCount: 0,
    storageUsedBytes: 0,
    wifiOnly: false,
    openIssues: [],
    error: null,
    init: vi.fn().mockResolvedValue(undefined),
    listIssues: vi.fn().mockResolvedValue([]),
    syncNow: vi.fn().mockResolvedValue(true),
    generateRecoveryKey: vi.fn().mockResolvedValue(VALID_KEY),
    storeRecoveryKey: vi.fn().mockResolvedValue(true),
    acknowledgeRecoveryKey: vi.fn().mockResolvedValue(true),
    fetchStorageUsage: vi.fn().mockResolvedValue(undefined),
    resolveIssue: vi.fn().mockResolvedValue(true),
    setWifiOnly: vi.fn(),
    wipeCloudData: vi.fn().mockResolvedValue(false),
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('SyncSettingsPanel accountless mode (cloud unavailable)', () => {
  it('renders Coming Soon card and no account/sync controls', () => {
    seedStores();
    render(<SyncSettingsPanel />);
    expect(screen.getByText('Plethora Cloud')).toBeTruthy();
    expect(screen.getByText('Coming Soon')).toBeTruthy();
    expect(
      screen.getByText(/Optional end-to-end encrypted synchronization between your devices is coming in a future release/i)
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sync Now/i })).toBeNull();
    expect(screen.queryByLabelText(/Paste recovery key/i)).toBeNull();
    expect(screen.queryByText(/Sign in to your Plethora account/i)).toBeNull();
    expect(screen.queryByText(/Plethora Pro is required/i)).toBeNull();
    expect(useSyncStore.getState().init).not.toHaveBeenCalled();
    expect(useSyncStore.getState().listIssues).not.toHaveBeenCalled();
  });
});

describe('SyncSettingsPanel recovery key setup', () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(productModule, 'isPlethoraCloudAvailable').mockReturnValue(true);
  });

  afterEach(() => {
    spy.mockRestore();
  });
  it('shows paste field and import on a fresh device with no master key', () => {
    seedStores({ hasMasterKey: false, recoveryKeyAcknowledged: false });
    render(<SyncSettingsPanel />);
    expect(screen.getByLabelText(/Paste recovery key from your synced device/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import Key' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Generate New Key/i })).toBeTruthy();
  });

  it('shows a validation error for an invalid import key', async () => {
    seedStores({ hasMasterKey: false, recoveryKeyAcknowledged: false });
    render(<SyncSettingsPanel />);
    fireEvent.change(screen.getByLabelText(/Paste recovery key from your synced device/i), {
      target: { value: 'not-a-valid-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import Key' }));
    expect(
      await screen.findByText(/Recovery key must contain exactly 64 hexadecimal characters/i)
    ).toBeTruthy();
    expect(useSyncStore.getState().storeRecoveryKey).not.toHaveBeenCalled();
  });

  it('imports a valid recovery key and acknowledges it', async () => {
    seedStores({ hasMasterKey: false, recoveryKeyAcknowledged: false });
    render(<SyncSettingsPanel />);
    fireEvent.change(screen.getByLabelText(/Paste recovery key from your synced device/i), {
      target: { value: VALID_KEY },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import Key' }));
    await waitFor(() => {
      expect(useSyncStore.getState().storeRecoveryKey).toHaveBeenCalledWith(VALID_KEY);
      expect(useSyncStore.getState().acknowledgeRecoveryKey).toHaveBeenCalled();
    });
  });

  it('hides paste/import when a master key is configured and acknowledged', () => {
    seedStores({ hasMasterKey: true, recoveryKeyAcknowledged: true });
    render(<SyncSettingsPanel />);
    expect(screen.queryByLabelText(/Paste recovery key/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import Key' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Recovery Key Configured' })).toBeTruthy();
  });

  it('shows paste field when acknowledgement is stale but no master key exists', () => {
    seedStores({ hasMasterKey: false, recoveryKeyAcknowledged: true });
    render(<SyncSettingsPanel />);
    expect(screen.getByLabelText(/Paste recovery key from your synced device/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Recovery Key Configured' })).toBeNull();
  });
});
