/**
 * Workload + cost estimation for paid embedding jobs (OpenSpec
 * `ai-billing-safety`, requirement #14).
 *
 * Only known STATIC pricing constants are used — never a fabricated or exact
 * dollar figure. When a provider/model price is not known to the app
 * (e.g. OpenRouter's dynamic per-model pricing) the estimate reports
 * `costUnknown` so the UI can say "an exact cost cannot be estimated" instead
 * of printing a made-up number.
 */

export interface EmbeddingEstimate {
  /** Estimated number of chunks the job will embed. */
  estimatedChunks: number;
  /** Number of characters the estimate is based on. */
  characterCount: number;
  /** Estimated USD from known static pricing (absent when unknown). */
  estimatedCostUsd?: number;
  /** True when the provider/model pricing is not known to the app. */
  costUnknown: boolean;
}

/**
 * Known static embedding pricing in USD per 1M tokens. Sources: provider
 * published per-1M-token rates. `openrouter` is deliberately absent — its
 * per-model pricing is dynamic and is NOT guessed.
 */
export const EMBEDDING_PRICING_DEFAULTS: Record<
  string,
  Record<string, number>
> = {
  openai: {
    "text-embedding-3-small": 0.02,
    "text-embedding-3-large": 0.13,
    "text-embedding-ada-002": 0.1,
    default: 0.1,
  },
  cohere: {
    "embed-english-v3.0": 0.1,
    "embed-multilingual-v3.0": 0.1,
    default: 0.1,
  },
};

/** Rough tokens per character for embedding size estimation (English ~4). */
const CHARS_PER_TOKEN = 4;
/** Rough characters per word for chunk-count estimation (~5 chars/word). */
const CHARS_PER_WORD = 5;

/** "openai" → "OpenAI", "openrouter" → "OpenRouter", "ollama" → "Ollama". */
export function embeddingProviderLabel(provider: string): string {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "cohere":
      return "Cohere";
    case "openrouter":
      return "OpenRouter";
    case "ollama":
      return "Ollama";
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
}

export function estimateEmbeddingWorkload(options: {
  characterCount: number;
  provider: string;
  model?: string;
  chunkSize?: number;
}): EmbeddingEstimate {
  const { characterCount, provider, model = "default", chunkSize = 200 } = options;
  const charsPerChunk = Math.max(50, Math.max(1, chunkSize) * CHARS_PER_WORD);
  const estimatedChunks = Math.max(1, Math.ceil(characterCount / charsPerChunk));

  const providerRule = EMBEDDING_PRICING_DEFAULTS[provider.toLowerCase()];
  if (!providerRule) {
    return { estimatedChunks, characterCount, costUnknown: true };
  }
  const pricePerMillion = providerRule[model] ?? providerRule.default;
  if (typeof pricePerMillion !== "number" || !Number.isFinite(pricePerMillion)) {
    return { estimatedChunks, characterCount, costUnknown: true };
  }

  const estimatedTokens = Math.max(1, Math.ceil(characterCount / CHARS_PER_TOKEN));
  const estimatedCostUsd = (estimatedTokens / 1_000_000) * pricePerMillion;
  return {
    estimatedChunks,
    characterCount,
    estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
    costUnknown: false,
  };
}

/**
 * Human-readable cost portion for a pre-flight confirmation. Returns a short
 * clause like "~$0.02" or the explicit "cannot be precisely estimated" text —
 * never a fabricated number.
 */
export function formatEmbeddingCostClause(estimate: EmbeddingEstimate): string {
  if (estimate.costUnknown || typeof estimate.estimatedCostUsd !== "number") {
    return "an exact cost cannot be estimated";
  }
  if (estimate.estimatedCostUsd <= 0) return "likely a negligible cost";
  return `estimated at ~$${estimate.estimatedCostUsd.toFixed(2)}`;
}
