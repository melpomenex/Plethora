import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { invoke, isTauri } from '../lib/tauri';
import { isTauriRuntimeTarget } from '../lib/runtimeTarget';
import { PLETHORA_API_URL, isCloudApiEnabled } from '../config/product';
import { useEntitlementStore } from './entitlementStore';
import {
  CAPABILITY_REGISTRY,
  FREE_DEFAULT_SNAPSHOT,
  type EntitlementSnapshot,
  type PlanId,
} from '../types/entitlements';

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

/** Error body shape used by the Plethora API (`{ error: { code, message } }`). */
interface ServerApiError {
  error?: { code?: string; message?: string };
}

interface AuthSessionPayload {
  user: {
    id: string;
    email: string;
    subscriptionTier?: string;
    subscription_tier?: string;
  };
  tokens: {
    accessToken?: string;
    access_token?: string;
    refreshToken?: string;
    refresh_token?: string;
    expiresIn?: number;
    expires_in?: number;
  };
  device?: { id: string };
}

function normalizeAuthSession(data: AuthSessionPayload) {
  return {
    user: {
      id: data.user.id,
      email: data.user.email,
      subscriptionTier: data.user.subscriptionTier ?? data.user.subscription_tier ?? 'free',
    },
    tokens: {
      accessToken: data.tokens.accessToken ?? data.tokens.access_token ?? '',
      refreshToken: data.tokens.refreshToken ?? data.tokens.refresh_token ?? '',
      expiresIn: data.tokens.expiresIn ?? data.tokens.expires_in ?? 900,
    },
    deviceId: data.device?.id ?? null,
  };
}

async function syncNativeSession(data: AuthSessionPayload) {
  const normalized = normalizeAuthSession(data);
  await invoke('account_sync_session', {
    user: {
      id: normalized.user.id,
      email: normalized.user.email,
      subscription_tier: normalized.user.subscriptionTier,
    },
    tokens: {
      access_token: normalized.tokens.accessToken,
      refresh_token: normalized.tokens.refreshToken,
      expires_in: normalized.tokens.expiresIn,
    },
    deviceId: normalized.deviceId,
  });
  return normalized;
}

function usesNativeCloudAuth(): boolean {
  return isTauriRuntimeTarget() || isTauri();
}

/** Decode a JWT's `exp` (seconds since epoch) without verification — an
 * expiry hint only, authentication stays server-side. Malformed tokens are
 * treated as expiring so the caller refreshes. */
export function accessTokenExpiry(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    const exp = typeof json?.exp === 'number' ? json.exp : null;
    return exp;
  } catch {
    return null;
  }
}

/** True when the access token is missing, undecodable, or expiring within
 * `withinMs` (default 60s). */
export function accessTokenExpiring(token: string | undefined, withinMs = 60_000): boolean {
  if (!token) return true;
  const exp = accessTokenExpiry(token);
  if (exp === null) return true;
  return exp * 1000 - Date.now() <= withinMs;
}

/** Optimistic post-auth snapshot: the login response IS a server-verified
 * plan statement (auth-verified), immediately confirmed or corrected by the
 * first entitlement refresh — so a fresh Pro login never flashes "Upgrade". */
function snapshotFromAuthTier(accountId: string, tier: string | undefined): EntitlementSnapshot | null {
  if (!tier) return null;
  const plan: PlanId = tier === 'pro' ? 'pro' : 'free';
  const capabilities: EntitlementSnapshot['capabilities'] = {} as EntitlementSnapshot['capabilities'];
  for (const id of Object.keys(CAPABILITY_REGISTRY) as Array<keyof typeof CAPABILITY_REGISTRY>) {
    const desc = CAPABILITY_REGISTRY[id];
    capabilities[id] = {
      enabled: plan === 'pro' || desc.defaultPlan === 'free',
      reason: plan === 'pro' || desc.defaultPlan === 'free' ? undefined : 'plan',
    };
  }
  return {
    accountId,
    plan,
    capabilities,
    fetchedAt: new Date().toISOString(),
    source: 'cache',
  };
}

function authErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof TypeError) {
    if (usesNativeCloudAuth()) {
      const detail = err.message?.trim();
      return detail
        ? `Native cloud auth failed (${detail}). Try restarting the app.`
        : 'Native cloud auth failed. Try restarting the app.';
    }
    return 'Could not reach Plethora cloud. Check your connection and try again.';
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
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

          let normalized;
          if (usesNativeCloudAuth()) {
            const data = await invoke<AuthSessionPayload>('account_auth_login', {
              email,
              password,
              // Re-login must reuse this install's device row: the server
              // stamps the identity into the access token, and sync traffic
              // is rejected when it does not match. Tauri commands camel-case
              // Rust argument names by default (`device_id` -> `deviceId`).
              deviceId: get().deviceId,
              deviceName,
              platform: 'desktop',
            });
            normalized = await syncNativeSession(data);
          } else {
            const res = await fetch(`${PLETHORA_API_URL}/v1/auth/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email,
                password,
                deviceId: get().deviceId ?? undefined,
                deviceName,
                platform: 'desktop',
              }),
            });

            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              throw new Error(errData.error?.message || 'Login failed');
            }

            normalized = normalizeAuthSession(await res.json());
          }

          set({
            isAuthenticated: true,
            user: normalized.user,
            tokens: normalized.tokens,
            deviceId: normalized.deviceId,
            loading: false,
          });

          const optimistic = snapshotFromAuthTier(normalized.user.id, normalized.user.subscriptionTier);
          if (optimistic) useEntitlementStore.getState().setSnapshot(optimistic);
          void useEntitlementStore.getState().refresh();
          void get().loadDevices();
        } catch (err) {
          const message = authErrorMessage(err, 'Sign-in failed. Please try again.');
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

          let normalized;
          if (usesNativeCloudAuth()) {
            const data = await invoke<AuthSessionPayload>('account_auth_register', {
              email,
              password,
              deviceName,
              platform: 'desktop',
            });
            normalized = await syncNativeSession(data);
          } else {
            const res = await fetch(`${PLETHORA_API_URL}/v1/auth/register`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password, deviceName, platform: 'desktop' }),
            });

            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              throw new Error(errData.error?.message || 'Registration failed');
            }

            normalized = normalizeAuthSession(await res.json());
          }

          set({
            isAuthenticated: true,
            user: normalized.user,
            tokens: normalized.tokens,
            deviceId: normalized.deviceId,
            loading: false,
          });

          const optimistic = snapshotFromAuthTier(normalized.user.id, normalized.user.subscriptionTier);
          if (optimistic) useEntitlementStore.getState().setSnapshot(optimistic);
          void useEntitlementStore.getState().refresh();
          void get().loadDevices();
        } catch (err) {
          const message = authErrorMessage(err, 'Registration failed. Please try again.');
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
          // Reset to Free defaults on sign out — the logged-out UI must not
          // keep rendering the prior account's Pro status (persisted local
          // snapshot included). Native `account_sign_out` cleared the active
          // in-memory snapshot already; refresh() then resolves anonymous.
          useEntitlementStore.getState().setSnapshot(FREE_DEFAULT_SNAPSHOT);
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
              // Distinguish a genuine Plethora API rejection from a captive
              // portal / MITM proxy answering a bare 401 page: only the API
              // error shape revokes the session.
              const body = (await res.json().catch(() => null)) as ServerApiError | null;
              if (body?.error?.code) {
                // Refresh token rejected (expired/revoked family, or session
                // cascade-deleted by account deletion elsewhere): transition
                // cleanly to signed-out local mode (Change F §2.3).
                await get().signOut();
              }
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

          // Native entitlement fetches present the token from the Rust
          // AuthManager — without re-mirroring, rotation never reaches them
          // and every subsequent refresh would keep using the stale token.
          const { user, deviceId } = get();
          if (isTauri() && user && data.accessToken) {
            await invoke('account_sync_session', {
              user: {
                id: user.id,
                email: user.email,
                subscription_tier: user.subscriptionTier ?? 'free',
              },
              tokens: {
                access_token: data.accessToken,
                refresh_token: data.refreshToken,
                expires_in: data.expiresIn,
              },
              deviceId: deviceId ?? null,
            }).catch(() => {});
          }
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
        if (!isTauri()) {
          return;
        }

        const { isAuthenticated, user, tokens, deviceId } = get();

        // After relaunch the WebView keeps tokens in localStorage but the Rust
        // AuthManager starts empty — re-mirror the session so native entitlement
        // refresh can reach the server. Access tokens are 15-minute JWTs: an
        // expired one would make /v1/entitlements answer 401 (correctly), so
        // refresh it FIRST whenever it is missing, undecodable, or near
        // expiry — token expiry must never become an entitlement downgrade.
        if (isAuthenticated && user && tokens?.refreshToken && accessTokenExpiring(tokens.accessToken)) {
          await get().refresh();
        }
        const currentTokens = get().tokens;
        if (isAuthenticated && user && currentTokens?.accessToken) {
          try {
            await invoke('account_sync_session', {
              user: {
                id: user.id,
                email: user.email,
                subscription_tier: user.subscriptionTier ?? 'free',
              },
              tokens: {
                access_token: currentTokens.accessToken,
                refresh_token: currentTokens.refreshToken ?? '',
                expires_in: currentTokens.expiresIn ?? 900,
              },
              deviceId: deviceId ?? null,
            });
            await useEntitlementStore.getState().refresh();
          } catch {
            // Keep persisted state; user can sign out/in to recover.
          }
          return;
        }

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
