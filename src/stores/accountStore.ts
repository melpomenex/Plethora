import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { invoke, isTauri } from '../lib/tauri';
import { PLETHORA_API_URL, isCloudApiEnabled } from '../config/product';
import { useEntitlementStore } from './entitlementStore';

export interface UserProfile {
  id: string;
  email: string;
  subscriptionTier: string;
}

export interface DeviceInfo {
  id: string;
  deviceName: string;
  platform: string;
  publicKey?: string;
  createdAt: string;
  lastSeen: string;
  revokedAt?: string;
}

export interface AccountTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AccountStoreState {
  isAuthenticated: boolean;
  user: UserProfile | null;
  deviceId: string | null;
  tokens: AccountTokens | null;
  devices: DeviceInfo[];
  loading: boolean;
  error: string | null;

  // Actions
  signIn: (email: string, password: string, deviceName?: string) => Promise<void>;
  register: (email: string, password: string, deviceName?: string) => Promise<void>;
  signOut: (localOnly?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  loadDevices: () => Promise<void>;
  revokeDevice: (deviceId: string) => Promise<void>;
  init: () => Promise<void>;
}

export const useAccountStore = create<AccountStoreState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      user: null,
      deviceId: null,
      tokens: null,
      devices: [],
      loading: false,
      error: null,

      signIn: async (email: string, password: string, deviceName?: string) => {
        set({ loading: true, error: null });
        try {
          if (!isCloudApiEnabled()) {
            throw new Error('Plethora Cloud API is disabled. Set VITE_PLETHORA_API_URL to your API host.');
          }
          if (isTauri()) {
            await invoke('account_sign_in', { email, password, deviceName });
          }

          // Fetch from server / local API
          const res = await fetch(`${PLETHORA_API_URL}/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, deviceName, platform: 'desktop' }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error?.message || 'Login failed');
          }

          const data = await res.json();
          set({
            isAuthenticated: true,
            user: data.user,
            tokens: data.tokens,
            deviceId: data.device?.id || null,
            loading: false,
          });

          // Refresh entitlements on successful sign-in
          void useEntitlementStore.getState().refresh();
          void get().loadDevices();
        } catch (err) {
          // No mock fallback (Change F §2.1): a failed sign-in must never
          // fabricate a session. Surface an explicit, retryable error and
          // stay signed out.
          const message =
            err instanceof TypeError
              ? 'Could not reach Plethora cloud. Check your connection and try again.'
              : err instanceof Error && err.message
                ? err.message
                : 'Sign-in failed. Please try again.';
          set({
            isAuthenticated: false,
            user: null,
            tokens: null,
            deviceId: null,
            loading: false,
            error: message,
          });
          throw new Error(message);
        }
      },

      register: async (email: string, password: string, deviceName?: string) => {
        set({ loading: true, error: null });
        try {
          if (!isCloudApiEnabled()) {
            throw new Error('Plethora Cloud API is disabled. Set VITE_PLETHORA_API_URL to your API host.');
          }
          const res = await fetch(`${PLETHORA_API_URL}/v1/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, deviceName, platform: 'desktop' }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error?.message || 'Registration failed');
          }

          const data = await res.json();
          set({
            isAuthenticated: true,
            user: data.user,
            tokens: data.tokens,
            deviceId: data.device?.id || null,
            loading: false,
          });

          void useEntitlementStore.getState().refresh();
          void get().loadDevices();
        } catch (err) {
          // No mock fallback (Change F §2.1): registration failures are
          // surfaced honestly and never produce a fabricated session.
          const message =
            err instanceof TypeError
              ? 'Could not reach Plethora cloud. Check your connection and try again.'
              : err instanceof Error && err.message
                ? err.message
                : 'Registration failed. Please try again.';
          set({
            isAuthenticated: false,
            user: null,
            tokens: null,
            deviceId: null,
            loading: false,
            error: message,
          });
          throw new Error(message);
        }
      },

      signOut: async (localOnly = true) => {
        set({ loading: true });
        try {
          const tokens = get().tokens;
          if (tokens?.accessToken) {
            await fetch(`${PLETHORA_API_URL}/v1/auth/logout`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${tokens.accessToken}`,
              },
            }).catch(() => {});
          }

          if (isTauri()) {
            await invoke('account_sign_out', { localOnly }).catch(() => {});
          }
        } finally {
          set({
            isAuthenticated: false,
            user: null,
            tokens: null,
            devices: [],
            loading: false,
            error: null,
          });
          // Reset to Free defaults on sign out
          void useEntitlementStore.getState().refresh();
        }
      },

      refresh: async () => {
        const tokens = get().tokens;
        if (!tokens?.refreshToken) return;

        try {
          const res = await fetch(`${PLETHORA_API_URL}/v1/auth/token/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: tokens.refreshToken }),
          });

          if (!res.ok) {
            if (res.status === 401) {
              // Refresh token rejected (expired/revoked family, or session
              // cascade-deleted by account deletion elsewhere): transition
              // cleanly to signed-out local mode (Change F §2.3).
              await get().signOut();
            }
            return;
          }

          const data = await res.json();
          set((state) => ({
            tokens: {
              accessToken: data.accessToken,
              refreshToken: data.refreshToken,
              expiresIn: data.expiresIn,
            },
          }));
        } catch {
          // Keep state offline
        }
      },

      loadDevices: async () => {
        const tokens = get().tokens;
        if (!tokens?.accessToken) return;

        try {
          if (isTauri()) {
            const devices = await invoke<DeviceInfo[]>('account_list_devices');
            if (devices && devices.length > 0) {
              set({ devices });
              return;
            }
          }

          const res = await fetch(`${PLETHORA_API_URL}/v1/auth/devices`, {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          });
          if (res.ok) {
            const data = await res.json();
            set({ devices: data.devices || [] });
          }
        } catch {
          // Keep offline
        }
      },

      revokeDevice: async (deviceId: string) => {
        const tokens = get().tokens;
        if (isTauri()) {
          await invoke('account_revoke_device', { deviceId }).catch(() => {});
        }

        if (tokens?.accessToken) {
          await fetch(`${PLETHORA_API_URL}/v1/auth/devices/${deviceId}/revoke`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          }).catch(() => {});
        }

        set((state) => ({
          devices: state.devices.map((d) =>
            d.id === deviceId ? { ...d, revokedAt: new Date().toISOString() } : d
          ),
        }));
      },

      init: async () => {
        if (isTauri()) {
          try {
            const state = await invoke<{ is_signed_in: boolean; user?: UserProfile; device_id?: string }>(
              'account_get_state'
            );
            if (state.is_signed_in && state.user) {
              set({
                isAuthenticated: true,
                user: state.user,
                deviceId: state.device_id || null,
              });
            }
          } catch {
            // Keep persisted state
          }
        }
      },
    }),
    {
      name: 'plethora-account',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        tokens: state.tokens,
        deviceId: state.deviceId,
      }),
    }
  )
);
