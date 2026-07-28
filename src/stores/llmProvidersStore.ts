import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../utils/id';
import type { ModelInfo } from '../api/llm';
import { providerAllowsKeylessAccess } from '../utils/llmProviderUtils';
import { invokeCommand, isTauri } from '../lib/tauri';

export interface LLMProviderConfig {
  id: string;
  provider: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'openrouter';
  name: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
  enabled: boolean;
  // Store pricing information for cost calculations
  modelPricing?: Record<string, ModelInfo>;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
}

interface LLMProvidersState {
  providers: LLMProviderConfig[];
  addProvider: (provider: Omit<LLMProviderConfig, 'id'>) => void;
  updateProvider: (id: string, updates: Partial<LLMProviderConfig>) => void;
  removeProvider: (id: string) => void;
  getProvider: (id: string) => LLMProviderConfig | undefined;
  getEnabledProviders: () => LLMProviderConfig[];
  getProvidersByType: (type: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'openrouter') => LLMProviderConfig[];
}

export async function syncPrimaryProviderToNativeAI(
  providers: LLMProviderConfig[],
): Promise<void> {
  if (typeof window === 'undefined' || !isTauri()) return;

  const provider = providers.find((candidate) => candidate.enabled);
  if (!provider || provider.provider === 'gemini') return;

  try {
    if (provider.provider !== 'ollama' && provider.apiKey.trim()) {
      try {
        await invokeCommand('set_api_key', {
          provider: provider.provider,
          apiKey: provider.apiKey,
        });
      } catch (error) {
        // The provider registry already owns this configured secret. A keychain
        // migration failure must not prevent the browser extension from using
        // the same live provider as the desktop UI.
        console.warn('[AI] Could not migrate provider key to the keychain:', error);
      }
    }

    const models = {
      openai_model: 'gpt-4o-mini',
      anthropic_model: 'claude-3-5-sonnet-20241022',
      openrouter_model: 'anthropic/claude-3.5-sonnet',
      ollama_model: 'llama3.2',
    };
    const modelKey = `${provider.provider}_model` as keyof typeof models;
    models[modelKey] = provider.model;

    const apiKeys: Record<string, string> = {};
    if (provider.provider !== 'ollama' && provider.apiKey.trim()) {
      apiKeys[provider.provider] = provider.apiKey;
    }

    await invokeCommand('set_ai_config', {
      config: {
        default_provider: {
          openai: 'OpenAI',
          anthropic: 'Anthropic',
          openrouter: 'OpenRouter',
          ollama: 'Ollama',
        }[provider.provider],
        api_keys: apiKeys,
        models,
        local_settings: {
          ollama_base_url: provider.provider === 'ollama'
            ? (provider.baseUrl || 'http://localhost:11434').replace(/\/v1\/?$/, '')
            : 'http://localhost:11434',
        },
      },
    });
  } catch (error) {
    console.warn('[AI] Failed to synchronize the provider registry with native AI:', error);
  }
}

export const useLLMProvidersStore = create<LLMProvidersState>()(
  persist(
    (set, get) => ({
      providers: [],

      addProvider: (provider) => {
        const newProvider: LLMProviderConfig = {
          ...provider,
          id: generateId(),
          temperature: provider.temperature ?? 0.7,
          maxTokens: provider.maxTokens ?? 4096,
        };
        set((state) => ({
          providers: [...state.providers, newProvider],
        }));
        void syncPrimaryProviderToNativeAI(get().providers);
      },

      updateProvider: (id, updates) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        }));
        void syncPrimaryProviderToNativeAI(get().providers);
      },

      removeProvider: (id) => {
        set((state) => ({
          providers: state.providers.filter((p) => p.id !== id),
        }));
        void syncPrimaryProviderToNativeAI(get().providers);
      },

      getProvider: (id) => {
        return get().providers.find((p) => p.id === id);
      },

      getEnabledProviders: () => {
        const enabled = get().providers.filter((p) => p.enabled);
        return enabled;
      },

      getProvidersByType: (type) => {
        return get().providers.filter((p) => p.provider === type);
      },
    }),
    {
      name: 'llm-providers-storage',
      version: 0,
      migrate: (persisted: unknown) => persisted as LLMProvidersState,
      // Persist API keys in localStorage for now
      // TODO: Implement proper encryption or use system keychain
      partialize: (state) => ({
        providers: state.providers,
      }),
      // Clean up providers with empty API keys on hydration using merge
      // This prevents infinite loops caused by mutating state in onRehydrateStorage
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<LLMProvidersState> | undefined;
        if (!persisted || !persisted.providers) {
          return currentState;
        }
        // Remove providers with empty API keys only when the configured endpoint really requires one.
        const cleanedProviders = persisted.providers.filter((p) =>
          providerAllowsKeylessAccess(p.provider, p.baseUrl) || (p.apiKey ? p.apiKey.trim().length > 0 : false)
        );
        const removed = persisted.providers.length - cleanedProviders.length;
        if (removed > 0) {
        }
        void syncPrimaryProviderToNativeAI(cleanedProviders);
        return {
          ...currentState,
          providers: cleanedProviders,
        };
      },
    }
  )
);
