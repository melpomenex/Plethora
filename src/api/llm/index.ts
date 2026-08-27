/**
 * LLM Provider Integration
 * Supports OpenAI, Anthropic, and local Ollama models with streaming support
 */

import { invokeCommand, listen, type UnlistenFn } from "../../lib/tauri";
import { resolveRequestPolicy, type LlmRequestPolicy } from "./policy";

export type {
  ContextWindowPreset,
  LlmRequestPolicy,
  PolicyResolutionInput,
  ProviderLike,
} from "./policy";
export {
  AUTO_CONTEXT_CEILING,
  AUTO_CONTEXT_FLOOR,
  AUTO_CONTEXT_PRESET,
  CONSERVATIVE_CONTEXT_FALLBACK,
  CONTEXT_WINDOW_PRESET_VALUES,
  DEFAULT_MAX_OUTPUT_TOKENS,
  MIN_PROMPT_HEADROOM,
  OLLAMA_MIGRATION_CONTEXT,
  formatAutoResolvedLabel,
  isContextComboValid,
  resolveAutoContext,
  resolveConfiguredContext,
  resolveConfiguredContextForProvider,
  resolveRequestPolicy,
} from "./policy";

export type LLMProvider = "openai" | "anthropic" | "gemini" | "deepseek" | "ollama" | "openrouter";

export interface LLMTextContentPart {
  type: "text";
  text: string;
}

export interface LLMImageContentPart {
  type: "image_url";
  imageUrl: string;
}

export type LLMMessageContentPart = LLMTextContentPart | LLMImageContentPart;

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string | LLMMessageContentPart[];
}

export interface LLMRequest {
  provider: LLMProvider;
  model?: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  baseUrl?: string;
  /**
   * Optional id used to identify this stream for cancellation via
   * {@link llmCancelStream}. When provided, `llm_stream_chat` registers the
   * request so it can be aborted mid-stream; the cancelled stream terminates
   * with a single `llm:stream:error` event whose payload carries
   * `code: "cancelled"`.
   */
  requestId?: string;
  /** Optional resolved request policy (Ollama `num_ctx` / cloud `max_tokens`). */
  policy?: LlmRequestPolicy;
}

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    // DeepSeek only: how many prompt tokens were served from DeepSeek's
    // automatic prompt cache (billed at the model's discounted cache_read
    // rate) vs. freshly processed. Undefined for other providers.
    promptCacheHitTokens?: number;
    promptCacheMissTokens?: number;
  };
}

export interface LLMContext {
  type: "document" | "web" | "general" | "video";
  documentId?: string;
  url?: string;
  selection?: string;
  content?: string;
  /**
   * @deprecated Prompt-budget hint only. Prefer `promptBudgetTokens` and
   * `configuredContextTokens`. Must not be used as max output tokens.
   */
  contextWindowTokens?: number;
  promptBudgetTokens?: number;
  configuredContextTokens?: number;
  maxOutputTokens?: number;
  memoryEnabled?: boolean;
}

export interface StreamOptions {
  onChunk: (chunk: string) => void;
  onDone?: () => void;
  onError?: (error: string) => void;
}

/**
 * Chat with LLM (non-streaming)
 */
export async function chatWithLLM(request: LLMRequest): Promise<LLMResponse> {
  return await invokeCommand<LLMResponse>("llm_chat", {
    provider: request.provider,
    model: request.model,
    messages: request.messages,
    temperature: request.temperature ?? 0.7,
    maxTokens: request.maxTokens ?? request.policy?.maxOutputTokens ?? 2000,
    apiKey: request.apiKey,
    baseUrl: request.baseUrl,
    policy: request.policy,
  });
}

/**
 * Chat with LLM with context (non-streaming)
 */
/**
 * Normalize context content to ensure it's always a string
 * Content can be stored as: string, Uint8Array, or number[] (byte array)
 */
function normalizeContextContent(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return new TextDecoder("utf-8").decode(value);
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
    try {
      return new TextDecoder("utf-8").decode(Uint8Array.from(value));
    } catch {
      return undefined;
    }
  }
  return String(value);
}

export async function chatWithContext(
  provider: LLMProvider,
  model: string | undefined,
  messages: LLMMessage[],
  context: LLMContext,
  apiKey?: string,
  baseUrl?: string,
  temperature?: number,
  maxTokens?: number,
  systemPrompt?: string,
  contextFromRelatedCards?: boolean,
  documentSnippetLength?: number
): Promise<LLMResponse> {
  // Normalize context content to ensure it's always a string
  const normalizedContent = normalizeContextContent(context.content);
  if (context.type === "document" && !normalizedContent?.trim()) {
    throw new Error("Document context is unavailable for this request.");
  }

  // Prepend system message if systemPrompt is provided
  const effectiveMessages = systemPrompt
    ? [{ role: "system" as const, content: systemPrompt }, ...messages]
    : messages;

  const policy = resolveRequestPolicy({
    provider,
    providerMaxOutput: maxTokens,
    maxOutputOverride: maxTokens,
    configuredContextOverride: context.configuredContextTokens,
    promptBudgetHint: context.promptBudgetTokens ?? context.contextWindowTokens,
    applyOllamaDefaultGuard: provider === "ollama",
  });

  const args = {
    provider,
    model,
    messages: effectiveMessages,
    temperature: temperature ?? 0.7,
    maxTokens: policy.maxOutputTokens,
    context: {
      type: context.type,
      documentId: context.documentId,
      url: context.url,
      selection: context.selection,
      content: normalizedContent,
      // Keep legacy field as prompt-budget hint for older backends.
      contextWindowTokens: context.promptBudgetTokens ?? context.contextWindowTokens,
      promptBudgetTokens: context.promptBudgetTokens ?? policy.promptBudgetTokens,
      configuredContextTokens: context.configuredContextTokens ?? policy.configuredContextTokens,
      maxOutputTokens: context.maxOutputTokens ?? policy.maxOutputTokens,
      contextFromRelatedCards,
      documentSnippetLength,
      memoryEnabled: context.memoryEnabled,
    },
    apiKey,
    baseUrl,
    policy,
  };

  return await invokeCommand<LLMResponse>("llm_chat_with_context", args);
}

/**
 * Stream chat with LLM
 * Returns a promise that resolves when streaming is complete
 */
export async function streamChatWithLLM(
  request: LLMRequest,
  options: StreamOptions
): Promise<void> {
  const unlisteners: UnlistenFn[] = [];

  // Debounce incoming chunks via requestAnimationFrame so we coalesce many
  // per-token IPC events into at most one `onChunk` call per animation frame.
  let pending = "";
  let rafScheduled = false;
  let rafId: number | null = null;

  const flushPending = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    rafScheduled = false;
    if (pending.length > 0) {
      const text = pending;
      pending = "";
      options.onChunk(text);
    }
  };

  const scheduleFlush = () => {
    if (rafScheduled) return;
    rafScheduled = true;
    rafId = requestAnimationFrame(() => {
      rafScheduled = false;
      rafId = null;
      if (pending.length > 0) {
        const text = pending;
        pending = "";
        options.onChunk(text);
      }
    });
  };

  try {
    const chunkUnlisten = await listen<{ content: string; done: boolean }>(
      "llm:stream:chunk",
      (event) => {
        pending += event.payload.content;
        scheduleFlush();
      }
    );
    unlisteners.push(chunkUnlisten);

    const doneUnlisten = await listen("llm:stream:done", () => {
      flushPending();
      options.onDone?.();
    });
    unlisteners.push(doneUnlisten);

    const errorUnlisten = await listen<{ error: string }>(
      "llm:stream:error",
      (event) => {
        flushPending();
        options.onError?.(event.payload.error);
      }
    );
    unlisteners.push(errorUnlisten);

    await invokeCommand("llm_stream_chat", {
      provider: request.provider,
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      maxTokens: request.maxTokens ?? request.policy?.maxOutputTokens ?? 2000,
      apiKey: request.apiKey,
      baseUrl: request.baseUrl,
      requestId: request.requestId,
      policy: request.policy,
    });
  } finally {
    // Final synchronous flush of any buffered text, then clean up listeners
    // after a delay to ensure all events are received.
    flushPending();
    setTimeout(() => {
      unlisteners.forEach((unlisten) => {
        try {
          unlisten();
        } catch {
          // Ignore errors during cleanup - listener may already be removed
        }
      });
    }, 1000);
  }
}

/**
 * Cancel an in-flight `llm_stream_chat` request by the `requestId` it was
 * started with.
 *
 * The backend aborts the stream (no further chunk events are emitted) and the
 * stream terminates with a single `llm:stream:error` event carrying
 * `code: "cancelled"`, matching the on-device cancellation semantics. Returns
 * `true` when a live stream was cancelled, `false` when the id is unknown or
 * the stream already finished (no-op).
 */
export async function llmCancelStream(requestId: string): Promise<boolean> {
  return await invokeCommand<boolean>("llm_cancel_stream", { requestId });
}

/**
 * Model pricing information.
 *
 * Unit contract: `prompt`, `completion`, `cache_read` and `cache_write` are USD
 * per 1,000 tokens; `request`, `image` and `web_search` are per-call costs and
 * are NOT scaled. `undefined` means not priced / unknown; `0` means free.
 * Provider adapters convert upstream units to this contract at the fetch
 * boundary (see the OpenRouter normalization in both backends).
 */
export interface ModelPricing {
  prompt?: number;        // Input token cost per 1K tokens
  completion?: number;    // Output token cost per 1K tokens
  request?: number;       // Per-request cost
  image?: number;         // Image processing cost
  web_search?: number;    // Web search cost
  cache_read?: number;    // Cache read cost per 1K tokens
  cache_write?: number;   // Cache write cost per 1K tokens
}

/**
 * Model information with pricing
 */
export interface ModelInfo {
  id: string;
  name: string;
  context_length?: number;
  pricing?: ModelPricing;
}

/**
 * Get available models for a provider with pricing information
 */
export async function getAvailableModels(
  provider: LLMProvider,
  apiKey?: string,
  baseUrl?: string
): Promise<ModelInfo[]> {
  return await invokeCommand<ModelInfo[]>("llm_get_models", {
    provider,
    apiKey,
    baseUrl,
  });
}

/**
 * Test LLM connection
 */
export async function testLLMConnection(
  provider: LLMProvider,
  apiKey: string,
  baseUrl?: string
): Promise<boolean> {
  return await invokeCommand<boolean>("llm_test_connection", {
    provider,
    apiKey,
    baseUrl,
  });
}

// Provider-specific configurations
export const PROVIDER_CONFIGS = {
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  },
  anthropic: {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-sonnet-20241022",
    models: [
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
    ],
  },
  gemini: {
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-3.5-flash",
    models: ["gemini-3.5-flash", "gemini-3.5-pro"],
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  ollama: {
    name: "Ollama",
    baseUrl: "http://localhost:11434",
    defaultModel: "llama3.2",
    models: ["llama3.2", "mistral", "codellama", "phi3"],
  },
  openrouter: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemma-2-9b-it:free",
    models: [
      "google/gemma-2-9b-it:free",
      "google/gemma-2-9b-it",
      "meta-llama/llama-3-8b-instruct:free",
      "meta-llama/llama-3-8b-instruct",
      "microsoft/phi-3-medium-128k-instruct:free",
      "microsoft/phi-3-mini-128k-instruct:free",
      "anthropic/claude-3.5-haiku",
      "anthropic/claude-3.5-sonnet:beta",
      "openai/gpt-4o-mini",
      "openai/gpt-4o",
      "deepseek/deepseek-chat",
    ],
  },
};
