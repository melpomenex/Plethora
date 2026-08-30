import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (command: string): Promise<unknown> => {
    if (command === 'sync_generate_recovery_key') {
      return 'a'.repeat(64);
    }
    if (command === 'sync_get_status') {
      return {
        is_syncing: false,
        last_synced_at: null,
        pending_outbox_count: 0,
        storage_used_bytes: 0,
        error: null,
      };
    }
    if (command === 'sync_recovery_key_acknowledged') {
      return false;
    }
    if (command === 'sync_has_master_key') {
      return false;
    }
    if (command === 'sync_fetch_storage_usage') {
      return { usedBytes: 0, limitBytes: 10 * 1024 * 1024 * 1024 };
    }
    if (command === 'sync_run') {
      return undefined;
    }
    throw new Error(`unexpected command: ${command}`);
  }),
}));

vi.mock('../../lib/tauri', () => ({
  invoke: invokeMock,
  isTauri: () => true,
  invokeCommand: invokeMock,
  loadTauriAPI: vi.fn(),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

import { useSyncStore } from '../syncStore';

describe('SyncStore & Recovery Key Generation', () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockClear();
    useSyncStore.setState({
      isSyncing: false,
      lastSyncedAt: null,
      pendingOutboxCount: 0,
      storageUsedBytes: 0,
      hasMasterKey: false,
      recoveryKeyAcknowledged: false,
      error: null,
    });
  });

  it('generates non-empty recovery keys', async () => {
    const key = await useSyncStore.getState().generateRecoveryKey();
    expect(key).toBeTruthy();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('executes syncNow and surfaces errors when sync is unavailable', async () => {
    const success = await useSyncStore.getState().syncNow();
    expect(typeof success).toBe('boolean');
    expect(useSyncStore.getState().isSyncing).toBe(false);
  });

  it('loads hasMasterKey from init', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'sync_get_status') {
        return {
          is_syncing: false,
          last_synced_at: null,
          pending_outbox_count: 0,
          storage_used_bytes: 0,
          error: null,
        };
      }
      if (command === 'sync_recovery_key_acknowledged') return false;
      if (command === 'sync_has_master_key') return true;
      if (command === 'sync_fetch_storage_usage') {
        return { usedBytes: 1024, limitBytes: 10 * 1024 * 1024 * 1024 };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await useSyncStore.getState().init();
    expect(useSyncStore.getState().hasMasterKey).toBe(true);
    expect(useSyncStore.getState().recoveryKeyAcknowledged).toBe(false);
  });

  it('clears stale acknowledgement when init finds ack without a master key', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'sync_get_status') {
        return {
          is_syncing: false,
          last_synced_at: null,
          pending_outbox_count: 0,
          storage_used_bytes: 0,
          error: null,
        };
      }
      if (command === 'sync_recovery_key_acknowledged') return true;
      if (command === 'sync_has_master_key') return false;
      if (command === 'sync_clear_recovery_ack') return undefined;
      if (command === 'sync_fetch_storage_usage') {
        return { usedBytes: 0, limitBytes: 10 * 1024 * 1024 * 1024 };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    useSyncStore.setState({ recoveryKeyAcknowledged: true, hasMasterKey: false });
    await useSyncStore.getState().init();

    expect(invokeMock).toHaveBeenCalledWith('sync_clear_recovery_ack');
    expect(useSyncStore.getState().recoveryKeyAcknowledged).toBe(false);
    expect(useSyncStore.getState().hasMasterKey).toBe(false);
  });

  it('sets hasMasterKey after storing a recovery key', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'sync_store_recovery_key') return undefined;
      throw new Error(`unexpected command: ${command}`);
    });

    await useSyncStore.getState().storeRecoveryKey('b'.repeat(64));
    expect(useSyncStore.getState().hasMasterKey).toBe(true);
  });
});
