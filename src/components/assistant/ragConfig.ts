/**
 * Shared helper to resolve an `EmbeddingConfig` for library AI surfaces
 * (semantic indexing / retrieval / neural queue).
 *
 * Reads the user's persisted embedding settings (provider/model/chunk-size)
 * and resolves the API key from the **LLM providers store** — the same store
 * the AI settings UI populates and that `chatWithContext` reads from. This is
 * important: the backend `get_embedding_config` command reads from a separate
 * `AIKeyStore` that the settings UI does not populate, so we must resolve keys
 * here on the frontend to actually find the user's configured key.
 *
 * Local Ollama needs no key — only a base URL.
 */

import { buildEmbeddingConfig, type EmbeddingConfig } from "../../api/ai-learning";
import { useSettingsStore } from "../../stores/settingsStore";
import { useLLMProvidersStore } from "../../stores/llmProvidersStore";
import { cloudEmbeddingRequiresConsent } from "../../utils/aiBillingConsent";

/** Find the first enabled provider of a given type with a non-empty API key. */
function keyForProviderType(
  type: "openai" | "openrouter" | "cohere"
): string | undefined {
  // Cohere isn't an LLM provider type in the store, so it has no chat key —
  // but OpenAI/OpenRouter are. Match by the store's provider field.
  const match = useLLMProvidersStore
    .getState()
    .providers.find(
      (p) => p.provider === type && p.apiKey && p.apiKey.trim().length > 0
    );
  return match?.apiKey;
}

/**
 * Resolve the embedding config for retrieval-side / query-side embeds.
 *
 * ai-billing-safety #14: when the configured embedding provider is a paid
 * cloud API but `paidEmbeddingsEnabled` is off, the config is NOT returned —
 * the caller then degrades to the non-billable on-device/lexical path, so a
 * query-side `embed_text` is never silently sent to a paid provider. The
 * opt-in lives in Settings → Embeddings (and the visible paid indicator).
 */
export async function resolveEmbeddingConfigForRag(): Promise<EmbeddingConfig | undefined> {
  const settings = useSettingsStore.getState().settings.embedding;

  // Local Ollama: no key lookup needed, never billable.
  if (settings.provider === "ollama") {
    return buildEmbeddingConfig(settings, {});
  }

  // Paid cloud provider without explicit consent: refuse to return a config
  // that would trigger a billable query embed.
  if (cloudEmbeddingRequiresConsent(settings.provider, { embedding: settings })) {
    return undefined;
  }

  // Cloud providers: resolve keys from the LLM providers store (where the
  // AI settings UI actually saves them).
  return buildEmbeddingConfig(settings, {
    openai: keyForProviderType("openai"),
    openrouter: keyForProviderType("openrouter"),
    cohere: keyForProviderType("cohere"),
  });
}
