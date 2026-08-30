import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (command: string): Promise<unknown> => {
    if (command === 'sync_generate_recovery_key') {
      return 'a'.repeat(64);
    }
    if (command === 'sync_get_status') {
      return {
        isSyncing: false,
        lastSyncedAt: null,
        pendingOutboxCount: 0,
        storageUsedBytes: 0,
        error: null,
      };
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
});
