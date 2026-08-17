import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useAccountStore } from './accountStore';
import { PLETHORA_API_URL } from '../config/product';

export interface ApiTokenInfo {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt?: string;
  createdAt: string;
  revokedAt?: string;
}

export interface WebhookInfo {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

export interface ApiTokensStoreState {
  tokens: ApiTokenInfo[];
  webhooks: WebhookInfo[];
  isLoading: boolean;
  error: string | null;

  // Actions
  addLocalToken: (token: ApiTokenInfo) => void;
  removeLocalToken: (id: string) => void;
  addLocalWebhook: (webhook: WebhookInfo) => void;
  removeLocalWebhook: (id: string) => void;
  createToken: (name: string, scopes: string[]) => Promise<ApiTokenInfo & { secretToken: string }>;
  revokeToken: (id: string) => Promise<void>;
  registerWebhook: (url: string, events: string[]) => Promise<WebhookInfo>;
  deleteWebhook: (id: string) => Promise<void>;
  setError: (error: string | null) => void;
}

function authContext(): { userId: string; headers: Record<string, string> } {
  const { user, tokens } = useAccountStore.getState();
  if (!user || !tokens?.accessToken) {
    throw new Error('Sign in to your Plethora account to manage API tokens and webhooks.');
  }
  return {
    userId: user.id,
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  };
}

async function apiRequest<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${PLETHORA_API_URL}${path}`, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error?.message || `Request failed (${res.status})`);
  }
  return body?.data as T;
}

export const useApiTokensStore = create<ApiTokensStoreState>()(
  persist(
    (set, get) => ({
      tokens: [],
      webhooks: [],
      isLoading: false,
      error: null,

      addLocalToken: (token) => {
        set({ tokens: [token, ...get().tokens.filter((t) => t.id !== token.id)] });
      },

      removeLocalToken: (id) => {
        set({ tokens: get().tokens.filter((t) => t.id !== id) });
      },

      addLocalWebhook: (webhook) => {
        set({ webhooks: [webhook, ...get().webhooks.filter((w) => w.id !== webhook.id)] });
      },

      removeLocalWebhook: (id) => {
        set({ webhooks: get().webhooks.filter((w) => w.id !== id) });
      },

      createToken: async (name, scopes) => {
        const { userId, headers } = authContext();
        const data = await apiRequest<{
          id: string;
          name: string;
          token: string;
          prefix: string;
          scopes: string[];
          createdAt: string;
        }>('/v1/api/tokens', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, name, scopes }),
        });
        const info: ApiTokenInfo = {
          id: data.id,
          name: data.name,
          prefix: data.prefix,
          scopes: data.scopes,
          createdAt: data.createdAt,
        };
        get().addLocalToken(info);
        return { ...info, secretToken: data.token };
      },

      revokeToken: async (id) => {
        const { headers } = authContext();
        await apiRequest(`/v1/api/tokens/${id}`, { method: 'DELETE', headers });
        const revokedAt = new Date().toISOString();
        set({ tokens: get().tokens.map((t) => (t.id === id ? { ...t, revokedAt } : t)) });
      },

      registerWebhook: async (url, events) => {
        const { userId, headers } = authContext();
        const data = await apiRequest<{
          id: string;
          url: string;
          secret: string;
          events: string[];
          createdAt: string;
        }>('/v1/api/webhooks', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, url, events }),
        });
        const webhook: WebhookInfo = { ...data, active: true };
        get().addLocalWebhook(webhook);
        return webhook;
      },

      deleteWebhook: async (id) => {
        const { headers } = authContext();
        await apiRequest(`/v1/api/webhooks/${id}`, { method: 'DELETE', headers });
        get().removeLocalWebhook(id);
      },

      setError: (error) => {
        set({ error });
      },
    }),
    {
      name: 'plethora-api-tokens',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        tokens: state.tokens,
        webhooks: state.webhooks,
      }),
    }
  )
);
