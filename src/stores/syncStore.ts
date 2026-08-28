import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { invoke, isTauri } from '../lib/tauri';

export interface SyncStatusState {
  isSyncing: boolean;
  lastSyncedAt: string | null;
  pendingOutboxCount: number;
  storageUsedBytes: number;
  recoveryKey: string | null;
  error: string | null;

  // Actions
  init: () => Promise<void>;
  syncNow: () => Promise<boolean>;
  generateRecoveryKey: () => Promise<string>;
  wipeCloudData: () => Promise<boolean>;
}

export const useSyncStore = create<SyncStatusState>()(
  persist(
    (set, get) => ({
      isSyncing: false,
      lastSyncedAt: null,
      pendingOutboxCount: 0,
      storageUsedBytes: 0,
      recoveryKey: null,
      error: null,

      init: async () => {
        if (isTauri()) {
          try {
            const status = await invoke<{
              is_syncing: boolean;
              last_synced_at?: string;
              pending_outbox_count: number;
              storage_used_bytes: number;
              error?: string;
            }>('sync_get_status');

            if (status) {
              set({
                isSyncing: status.is_syncing,
                lastSyncedAt: status.last_synced_at || get().lastSyncedAt,
                pendingOutboxCount: status.pending_outbox_count,
                storageUsedBytes: status.storage_used_bytes,
                error: status.error || null,
              });
            }
          } catch {
            // Keep persisted status
          }
        }
      },

      syncNow: async () => {
        set({ isSyncing: true, error: null });
        try {
          if (isTauri()) {
            const push = await invoke<{ accepted: number; latest_seq: number }>('sync_run');
            await useSyncStore.getState().init();
            set({
              isSyncing: false,
              lastSyncedAt: new Date().toISOString(),
              error: null,
            });
            return (push?.accepted ?? 0) >= 0;
          }

          set({
            isSyncing: false,
            error: 'Sync requires the Plethora desktop app.',
          });
          return false;
        } catch (err) {
          set({
            isSyncing: false,
            error: err instanceof Error ? err.message : 'Sync failed',
          });
          return false;
        }
      },

      generateRecoveryKey: async () => {
        try {
          let key: string | undefined;
          if (isTauri()) {
            key = await invoke<string>('sync_generate_recovery_key');
          }
          if (!key) {
            key = Array.from(crypto.getRandomValues(new Uint8Array(32)))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('');
          }
          set({ recoveryKey: key });
          return key;
        } catch {
          const fallback = 'plethora-recovery-fallback-key';
          set({ recoveryKey: fallback });
          return fallback;
        }
      },

      wipeCloudData: async () => {
        const tokens = useAccountStore.getState().tokens;
        if (tokens?.accessToken) {
          const res = await fetch(`${PLETHORA_API_URL}/v1/sync/data`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          });
          if (res.ok) {
            set({ lastSyncedAt: null, storageUsedBytes: 0 });
            return true;
          }
        }
        return false;
      },
    }),
    {
      name: 'plethora-sync',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        lastSyncedAt: state.lastSyncedAt,
        recoveryKey: state.recoveryKey,
      }),
    }
  )
);
