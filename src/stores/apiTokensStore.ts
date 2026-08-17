import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface ApiTokenInfo {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt?: string;
  createdAt: string;
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
  setError: (error: string | null) => void;
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
