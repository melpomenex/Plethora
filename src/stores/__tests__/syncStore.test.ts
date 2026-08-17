import { beforeEach, describe, expect, it } from 'vitest';
import { useSyncStore } from '../syncStore';

describe('SyncStore & Recovery Key Generation', () => {
  beforeEach(() => {
    localStorage.clear();
    useSyncStore.setState({
      isSyncing: false,
      lastSyncedAt: null,
      pendingOutboxCount: 0,
      storageUsedBytes: 0,
      recoveryKey: null,
      error: null,
    });
  });

  it('generates non-empty recovery keys', async () => {
    const key = await useSyncStore.getState().generateRecoveryKey();
    expect(key).toBeTruthy();
    expect(useSyncStore.getState().recoveryKey).toBe(key);
  });

  it('executes syncNow and updates lastSyncedAt', async () => {
    const success = await useSyncStore.getState().syncNow();
    expect(success).toBe(true);
    expect(useSyncStore.getState().lastSyncedAt).not.toBeNull();
    expect(useSyncStore.getState().isSyncing).toBe(false);
  });
});
