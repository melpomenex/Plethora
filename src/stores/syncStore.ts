import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { listen } from '@tauri-apps/api/event';
import { invoke, isTauri } from '../lib/tauri';
import { PLETHORA_API_URL } from '../config/product';
import { useAccountStore } from './accountStore';

type SyncStatusPayload = {
  is_syncing: boolean;
  last_synced_at?: string | null;
  pending_outbox_count: number;
  storage_used_bytes: number;
  error?: string | null;
};

export type SyncIssue = {
  id: string;
  entityType: string;
  entityId: string;
  conflictKind: string;
  localChangeId?: string | null;
  serverRevision: number;
  baseRevision: number;
  status: string;
  createdAt: number;
};

export interface SyncStatusState {
  isSyncing: boolean;
  lastSyncedAt: string | null;
  pendingOutboxCount: number;
  storageUsedBytes: number;
  wifiOnly: boolean;
  hasMasterKey: boolean;
  recoveryKeyAcknowledged: boolean;
  openIssues: SyncIssue[];
  error: string | null;

  init: () => Promise<void>;
  syncNow: () => Promise<boolean>;
  generateRecoveryKey: () => Promise<string>;
  storeRecoveryKey: (key: string) => Promise<boolean>;
  acknowledgeRecoveryKey: () => Promise<boolean>;
  fetchStorageUsage: () => Promise<void>;
  listIssues: () => Promise<SyncIssue[]>;
  resolveIssue: (issueId: string, resolution: 'keep_mine' | 'keep_theirs' | 'both') => Promise<boolean>;
  setWifiOnly: (enabled: boolean) => void;
  wipeCloudData: () => Promise<boolean>;
}

let syncListenerRegistered = false;

function applySyncStatus(
  set: (partial: Partial<SyncStatusState>) => void,
  get: () => SyncStatusState,
  status: SyncStatusPayload
) {
  set({
    isSyncing: status.is_syncing,
    lastSyncedAt: status.last_synced_at || get().lastSyncedAt,
    pendingOutboxCount: status.pending_outbox_count,
    storageUsedBytes: status.storage_used_bytes,
    error: status.error || null,
  });
}

function bindNetworkListeners(setOnline: (online: boolean) => void) {
  if (typeof window === 'undefined') return;
  const update = () => {
    const online = navigator.onLine;
    setOnline(online);
    if (online && isTauri()) {
      void invoke('sync_on_network_restored');
    }
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

export const useSyncStore = create<SyncStatusState>()(
  persist(
    (set, get) => ({
      isSyncing: false,
      lastSyncedAt: null,
      pendingOutboxCount: 0,
      storageUsedBytes: 0,
      wifiOnly: false,
      hasMasterKey: false,
      recoveryKeyAcknowledged: false,
      openIssues: [],
      error: null,

      init: async () => {
        if (!isTauri()) return;

        if (!syncListenerRegistered) {
          syncListenerRegistered = true;
          void listen<SyncStatusPayload>('plethora-sync-status-changed', (event) => {
            applySyncStatus(set, get, event.payload);
          });
          bindNetworkListeners((online) => {
            void invoke('sync_set_online', { online });
          });
        }

        try {
          const [status, acknowledged, hasMasterKey] = await Promise.all([
            invoke<SyncStatusPayload>('sync_get_status'),
            invoke<boolean>('sync_recovery_key_acknowledged'),
            invoke<boolean>('sync_has_master_key'),
          ]);
          if (status) {
            applySyncStatus(set, get, status);
          }

          let recoveryKeyAcknowledged = acknowledged;
          if (acknowledged && !hasMasterKey) {
            await invoke('sync_clear_recovery_ack');
            recoveryKeyAcknowledged = false;
          }

          set({ recoveryKeyAcknowledged, hasMasterKey });
          await get().fetchStorageUsage();
        } catch {
          // Keep persisted status
        }
      },

      syncNow: async () => {
        set({ isSyncing: true, error: null });
        try {
          if (isTauri()) {
            // The Rust engine owns the crash-safe initial pull/bootstrap order.
            // Keeping that invariant in one place also ensures background and
            // manual sync behave identically.
            await invoke('sync_run');
            await get().init();
            set({ isSyncing: false, lastSyncedAt: new Date().toISOString(), error: null });
            return true;
          }
          set({ isSyncing: false, error: 'Sync requires the Plethora desktop app.' });
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
        if (!isTauri()) {
          // Browser/PWA fallback: same format as the Rust generator
          // (hex-encoded 32 random bytes) so the store contract holds.
          const bytes = new Uint8Array(32);
          crypto.getRandomValues(bytes);
          return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        }
        const key = await invoke<string>('sync_generate_recovery_key');
        return key;
      },

      storeRecoveryKey: async (key: string) => {
        await invoke('sync_store_recovery_key', { recoveryKey: key });
        set({ hasMasterKey: true });
        return true;
      },

      acknowledgeRecoveryKey: async () => {
        await invoke('sync_ack_recovery_key');
        set({ recoveryKeyAcknowledged: true, hasMasterKey: true });
        return true;
      },

      fetchStorageUsage: async () => {
        if (!isTauri()) return;
        try {
          const usage = await invoke<{ usedBytes: number; limitBytes: number }>('sync_fetch_storage_usage');
          set({ storageUsedBytes: usage.usedBytes });
        } catch {
          // Ignore when offline or unsigned in
        }
      },

      listIssues: async () => {
        if (!isTauri()) return [];
        const issues = await invoke<SyncIssue[]>('sync_list_issues', { limit: 20 });
        set({ openIssues: issues });
        return issues;
      },

      resolveIssue: async (issueId, resolution) => {
        await invoke('sync_resolve_issue', { issueId, resolution });
        await get().listIssues();
        return true;
      },

      setWifiOnly: (enabled: boolean) => {
        set({ wifiOnly: enabled });
        if (isTauri()) {
          void invoke('sync_set_wifi_only', { enabled });
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
        wifiOnly: state.wifiOnly,
        hasMasterKey: state.hasMasterKey,
        recoveryKeyAcknowledged: state.recoveryKeyAcknowledged,
      }),
    }
  )
);
