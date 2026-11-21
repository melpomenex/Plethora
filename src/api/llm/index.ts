/**
 * LLM Provider Integration
 * Supports OpenAI, Anthropic, and local Ollama models with streaming support
 */

import { invokeCommand, isTauri, listen, type UnlistenFn } from "../../lib/tauri";
import { resolveRequestPolicy, type LlmRequestPolicy } from "./policy";
import { normalizeLLMResponse, type LLMResponseKind } from "./response";

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
  /** Context envelope used by the shared contextual chat pipeline. */
  context?: LLMContext;
  /** The task runner owns the single corrective attempt. Disable hidden transport recovery. */
  taskManagedRecovery?: boolean;
  pinEndpoint?: boolean;
}

export interface LLMResponse {
  content: string;
  /** Provider-reported stop reason ("length" = truncated at the output cap). */
  finishReason?: string;
  responseKind?: LLMResponseKind;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    // DeepSeek only: how many prompt tokens were served from DeepSeek's
    // automatic prompt cache (billed at the model's discounted cache_read
    // rate) vs. freshly processed. Undefined for other providers.
    promptCacheHitTokens?: number;
    promptCacheMissTokens?: number;
  };
}

export interface LLMContext {
  type: "document" | "web" | "general" | "video";
  scope?: "chat" | "document" | "library";
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
  signal?: AbortSignal;
  onChunk: (chunk: string) => void;
  onDone?: (info?: {
    finishReason?: string;
    responseKind?: LLMResponseKind;
    usage?: LLMResponse["usage"];
  }) => void;
  onError?: (error: string, code?: string) => void;
}

/**
 * Chat with LLM (non-streaming)
 */
export async function chatWithLLM(request: LLMRequest): Promise<LLMResponse> {
  return normalizeLLMResponse(await invokeCommand<unknown>("llm_chat", {
    provider: request.provider,
    model: request.model,
    messages: request.messages,
    temperature: request.temperature ?? 0.7,
    maxTokens: request.maxTokens ?? request.policy?.maxOutputTokens ?? 2000,
    apiKey: request.apiKey,
    baseUrl: request.baseUrl,
    policy: request.policy,
    taskManagedRecovery: request.taskManagedRecovery,
    pinEndpoint: request.pinEndpoint,
  }));
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

function buildContextChatRequest(
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
): LLMRequest {
  // Normalize context content to ensure it's always a string
  const normalizedContent = normalizeContextContent(context.content);
  if (context.type === "document" && context.scope === "document" && !normalizedContent?.trim()) {
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

  const contextRequest: LLMContext = {
    type: context.type,
    scope: context.scope,
    documentId: context.documentId,
    url: context.url,
    selection: context.selection,
    content: normalizedContent,
    contextWindowTokens: context.promptBudgetTokens ?? context.contextWindowTokens,
    promptBudgetTokens: context.promptBudgetTokens ?? policy.promptBudgetTokens,
    configuredContextTokens: context.configuredContextTokens ?? policy.configuredContextTokens,
    maxOutputTokens: context.maxOutputTokens ?? policy.maxOutputTokens,
    memoryEnabled: context.memoryEnabled,
  };

  return {
    provider,
    model,
    messages: effectiveMessages,
    temperature: temperature ?? 0.7,
    maxTokens: policy.maxOutputTokens,
    context: {
      ...contextRequest,
      contextFromRelatedCards,
      documentSnippetLength,
    } as LLMContext,
    apiKey,
    baseUrl,
    policy,
  };
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
  const request = buildContextChatRequest(
    provider, model, messages, context, apiKey, baseUrl, temperature,
    maxTokens, systemPrompt, contextFromRelatedCards, documentSnippetLength,
  );
  return normalizeLLMResponse(await invokeCommand<unknown>("llm_chat_with_context", {
    ...request,
    context: request.context,
  }));
}

export async function streamChatWithContext(
  provider: LLMProvider,
  model: string | undefined,
  messages: LLMMessage[],
  context: LLMContext,
  options: StreamOptions,
  apiKey?: string,
  baseUrl?: string,
  temperature?: number,
  maxTokens?: number,
  systemPrompt?: string,
  contextFromRelatedCards?: boolean,
  documentSnippetLength?: number
): Promise<void> {
  const request = buildContextChatRequest(
    provider, model, messages, context, apiKey, baseUrl, temperature,
    maxTokens, systemPrompt, contextFromRelatedCards, documentSnippetLength,
  );
  return streamChatWithLLM(request, options);
}

/**
 * Stream chat with LLM
 * Returns a promise that resolves when streaming is complete
 */
export async function streamChatWithLLM(
  request: LLMRequest,
  options: StreamOptions
): Promise<void> {
  if (!isTauri()) {
    // Browser streaming uses the same configured endpoint and request shape as
    // the buffered browser chat path. Its transport is implemented beside the
    // browser command backend so PWA builds do not depend on Tauri events.
    const { streamBrowserLLM } = await import("../../lib/browserLlmTransport");
    await streamBrowserLLM(request, options);
    return;
  }

  const unlisteners: UnlistenFn[] = [];
  const requestId = request.requestId ?? createLLMRequestId();
  let terminal = false;
  let terminalError: Error | undefined;
  let receivedText = "";
  const onAbort = () => { void llmCancelStream(requestId); };

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
    if (pending.length > 0 && !terminal && !options.signal?.aborted) {
      const text = pending;
      pending = "";
      options.onChunk(text);
    }
  };

  const discardPending = () => {
    pending = "";
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    rafScheduled = false;
  };

  const scheduleFlush = () => {
    if (rafScheduled) return;
    rafScheduled = true;
    rafId = requestAnimationFrame(() => {
      rafScheduled = false;
      rafId = null;
      if (pending.length > 0 && !terminal && !options.signal?.aborted) {
        const text = pending;
        pending = "";
        options.onChunk(text);
      }
    });
  };

  try {
    if (options.signal?.aborted) {
      throw Object.assign(new Error("Cloud stream was cancelled."), { code: "cancelled" });
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const chunkUnlisten = await listen<{ requestId?: string; content: string; done?: boolean }>(
      "llm:stream:chunk",
      (event) => {
        if (terminal || options.signal?.aborted || event.payload.requestId !== requestId) return;
        receivedText += event.payload.content;
        pending += event.payload.content;
        scheduleFlush();
      }
    );
    unlisteners.push(chunkUnlisten);

    const doneUnlisten = await listen<{
      requestId?: string;
      finishReason?: string;
      responseKind?: LLMResponseKind;
      usage?: LLMResponse["usage"];
    }>(
      "llm:stream:done",
      (event) => {
        if (terminal || options.signal?.aborted || event.payload.requestId !== requestId) return;
        flushPending();
        terminal = true;
        options.onDone?.({
          finishReason: event.payload.finishReason,
          responseKind: event.payload.responseKind ?? inferStreamResponseKind(receivedText, event.payload.finishReason),
          usage: event.payload.usage,
        });
      }
    );
    unlisteners.push(doneUnlisten);

    const errorUnlisten = await listen<{ requestId?: string; error: string; code?: string }>(
      "llm:stream:error",
      (event) => {
        if (
          terminal ||
          event.payload.requestId !== requestId ||
          (options.signal?.aborted && event.payload.code !== "cancelled")
        ) return;
        if (event.payload.code === "cancelled") discardPending();
        else flushPending();
        terminal = true;
        terminalError = new Error(event.payload.error);
        options.onError?.(event.payload.error, event.payload.code);
      }
    );
    unlisteners.push(errorUnlisten);

    await invokeCommand(request.context ? "llm_stream_chat_with_context" : "llm_stream_chat", {
      provider: request.provider,
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      maxTokens: request.maxTokens ?? request.policy?.maxOutputTokens ?? 2000,
      apiKey: request.apiKey,
      baseUrl: request.baseUrl,
      requestId,
      policy: request.policy,
      pinEndpoint: request.pinEndpoint,
      context: request.context,
    });
    if (options.signal?.aborted && !terminal) {
      throw Object.assign(new Error("Cloud stream was cancelled."), { code: "cancelled" });
    }
    if (!terminal) {
      flushPending();
      terminal = true;
      options.onDone?.({ responseKind: inferStreamResponseKind(receivedText) });
    }
    if (terminalError) throw terminalError;
  } catch (error) {
    if (!terminal) {
      if (options.signal?.aborted) discardPending();
      else flushPending();
      terminal = true;
      const message = error instanceof Error ? error.message : String(error);
      options.onError?.(message, (error as { code?: string })?.code);
    }
    throw error;
  } finally {
    // Terminal events are request-scoped and emitted before the native command
    // returns, so listeners can be released synchronously here.
    flushPending();
    unlisteners.forEach((unlisten) => {
      try {
        unlisten();
      } catch {
        // Ignore errors during cleanup - listener may already be removed
      }
    });
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function createLLMRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `llm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function inferStreamResponseKind(content: string, finishReason?: string): LLMResponseKind {
  if (["refusal", "content_filter", "safety"].includes(finishReason ?? "")) return "refusal";
  if (content.trim()) return "final-text";
  if (["tool_calls", "function_call", "tool_use"].includes(finishReason ?? "")) return "tool-only";
  return "empty";
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
  reasoning?: boolean;
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
