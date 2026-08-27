/**
 * `AIProvider` over the explicitly configured cloud/local-host LLM
 * (OpenAI / Anthropic / Gemini / DeepSeek / Ollama / OpenRouter) via
 * `src/api/llm`, plus the legacy `src/api/ai` commands used by existing
 * adapters (those flow through task `cloudExecutor`s, not this class).
 *
 * Cloud is never implicit: this provider only exists when the user configured
 * an enabled provider (see `provider.ts` `hasCloudProvider`).
 */

import { invokeCommand } from "../../tauri";
import {
  chatWithLLM,
  streamChatWithLLM,
  type LLMMessage,
  type LLMMessageContentPart,
  type LLMProvider as CloudLLMProviderName,
  type LLMRequest,
  type LLMResponse,
} from "../../../api/llm";
import { useLLMProvidersStore, type LLMProviderConfig } from "../../../stores/llmProvidersStore";
import { resolveRequestPolicy } from "../../../api/llm/policy";
import { providerAllowsKeylessAccess } from "../../../utils/llmProviderUtils";
import { AIError, aiErrorFromCloud } from "../errors";
import type {
  AIModelCapabilities,
  AIProvider,
  AIRequest,
  AIResponse,
  AIStreamOptions,
} from "./types";

export const CLOUD_PROVIDER_ID = "cloud-llm";

/** Providers whose chat models accept image input at the registry level. */
const VISION_CAPABLE_PROVIDERS = new Set<CloudLLMProviderName>([
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
]);

/** Heuristic: does the configured model name advertise reasoning output? */
export function cloudModelSupportsReasoning(model: string | undefined): boolean {
  if (!model) return false;
  return /(?:^|[^a-z0-9])(?:o1|o3|o4|r1)(?:[^a-z0-9]|$)|reasoner|thinking/i.test(model);
}

/**
 * First enabled, usable provider config (key present or keyless access such
 * as Ollama / local OpenAI-compatible endpoints). Null when cloud is not
 * configured at all.
 */
export function getActiveCloudConfig(): LLMProviderConfig | null {
  const found = useLLMProvidersStore
    .getState()
    .providers.find(
      (p) =>
        p.enabled &&
        (p.apiKey.trim().length > 0 || providerAllowsKeylessAccess(p.provider, p.baseUrl))
    );
  return found ?? null;
}

/** Map a provider-registry row onto the neutral capability contract. */
export function capabilitiesFromCloudConfig(
  config: LLMProviderConfig | null
): AIModelCapabilities {
  if (!config) {
    return {
      textGeneration: false,
      structuredGeneration: false,
      vision: false,
      multiImage: false,
      systemInstructions: false,
      toolCalling: false,
      reasoning: false,
      embeddings: false,
      contextTokens: 0,
      streaming: false,
      prefixCaching: false,
      offlineAvailable: false,
      downloadState: "not-applicable",
    };
  }
  const vision = VISION_CAPABLE_PROVIDERS.has(config.provider);
  return {
    textGeneration: true,
    // Design D5: cloud providers use the strict-JSON prompt fallback, not a
    // schema-compiled native mode.
    structuredGeneration: false,
    vision,
    multiImage: vision,
    systemInstructions: true,
    toolCalling: false,
    reasoning: cloudModelSupportsReasoning(config.model),
    embeddings: false,
    // Configured runtime ceiling for local models — not the model's theoretical max.
    contextTokens:
      config.provider === "ollama"
        ? (config.contextWindowTokens ?? 8192)
        : 128000,
    streaming: true,
    prefixCaching: config.provider === "anthropic" || config.provider === "deepseek",
    offlineAvailable: config.provider === "ollama",
    downloadState: "not-applicable",
  };
}

export interface CloudProviderTransport {
  chat?: (request: LLMRequest) => Promise<LLMResponse>;
  streamChat?: typeof streamChatWithLLM;
  cancelStream?: (requestId: string) => Promise<void>;
}

export class CloudProvider implements AIProvider {
  readonly id = CLOUD_PROVIDER_ID;
  readonly kind = "cloud" as const;
  private readonly transport: CloudProviderTransport;

  constructor(transport: CloudProviderTransport = {}) {
    this.transport = {
      chat: transport.chat ?? ((request) => chatWithLLM(request)),
      streamChat: transport.streamChat ?? streamChatWithLLM,
      cancelStream: transport.cancelStream ?? defaultCancelStream,
    };
  }

  /** Resolved lazily so capability changes (provider added/removed) are live. */
  private activeConfig(): LLMProviderConfig | null {
    return getActiveCloudConfig();
  }

  async getCapabilities(): Promise<AIModelCapabilities> {
    return capabilitiesFromCloudConfig(this.activeConfig());
  }

  async generateStream(req: AIRequest, opts: AIStreamOptions = {}): Promise<AIResponse> {
    const config = this.activeConfig();
    if (!config) {
      throw new AIError("ModelUnavailable", "No cloud provider is configured.", {
        code: "model_unavailable",
        providerId: this.id,
      });
    }
    if (opts.signal?.aborted) {
      throw new AIError("Cancelled", "Cloud generation was cancelled before it started.", {
        code: "cancelled",
        providerId: this.id,
      });
    }

    const messages = this.buildMessages(req);
    const request: LLMRequest = {
      provider: config.provider,
      model: config.model,
      messages,
      temperature: req.temperature ?? config.temperature,
      maxTokens: req.maxOutputTokens ?? config.maxTokens,
      apiKey: config.apiKey || undefined,
      baseUrl: config.baseUrl,
      policy: resolveRequestPolicy({
        provider: config.provider,
        providerMaxOutput: config.maxTokens,
        maxOutputOverride: req.maxOutputTokens ?? config.maxTokens,
        providerContextTokens: config.contextWindowTokens,
        perModelOverride: config.modelContextWindows?.[config.model],
        autoPreset: config.contextWindowPreset === "auto",
        applyOllamaDefaultGuard: config.provider === "ollama",
      }),
    };

    if (opts.stream === false || (opts.stream !== true && !opts.onChunk)) {
      // Non-streaming path (chat command) — still emitted whole to onChunk so
      // UI consumers see a uniform stream.
      try {
        const res = await this.raceWithAbort(
          this.transport.chat!(request),
          opts.signal
        );
        opts.onChunk?.(res.content);
        return {
          requestId: req.requestId,
          text: res.content,
          baseModelName: config.model,
          usage: res.usage
            ? {
                inputTokens: res.usage.promptTokens,
                outputTokens: res.usage.completionTokens,
                tokenLimit: undefined,
              }
            : undefined,
        };
      } catch (error) {
        throw this.wrapError(error);
      }
    }

    // Streaming path.
    let text = "";
    let aborted = false;
    let streamError: string | null = null;
    const signal = opts.signal;
    const cancel = () => {
      if (aborted) return;
      aborted = true;
      try {
        void this.transport.cancelStream?.(req.requestId);
      } catch {
        // Cancellation is best-effort; the Rust registry arrives with D7/task 1.12.
      }
    };
    signal?.addEventListener("abort", cancel, { once: true });

    try {
      await this.transport.streamChat!(request, {
        onChunk: (chunk) => {
          if (aborted || signal?.aborted) return;
          text += chunk;
          opts.onChunk?.(chunk);
        },
        onError: (error) => {
          streamError = error;
        },
      });
    } catch (error) {
      cancel();
      throw this.wrapError(error);
    } finally {
      signal?.removeEventListener("abort", cancel);
    }

    if (signal?.aborted) {
      throw new AIError("Cancelled", "Cloud stream was cancelled.", {
        code: "cancelled",
        providerId: this.id,
      });
    }
    if (streamError) {
      throw this.wrapError(new Error(streamError));
    }
    return {
      requestId: req.requestId,
      text,
      baseModelName: config.model,
    };
  }

  private buildMessages(req: AIRequest): LLMMessage[] {
    const messages: LLMMessage[] = [];
    if (req.systemInstruction) {
      messages.push({ role: "system", content: req.systemInstruction });
    }
    if (req.image) {
      const parts: LLMMessageContentPart[] = [
        { type: "text", text: req.text },
        {
          type: "image_url",
          imageUrl: `data:${req.image.mimeType};base64,${req.image.data}`,
        },
      ];
      messages.push({ role: "user", content: parts });
    } else {
      messages.push({ role: "user", content: req.text });
    }
    return messages;
  }

  private raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () =>
        reject(
          new AIError("Cancelled", "Cloud generation was cancelled.", {
            code: "cancelled",
            providerId: this.id,
          })
        );
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
    });
  }

  private wrapError(error: unknown): AIError {
    if (error instanceof AIError) return error;
    const message = error instanceof Error ? error.message : String(error);
    if (/cancel|abort/i.test(message)) {
      return new AIError("Cancelled", message, {
        code: "cancelled",
        providerId: this.id,
        cause: error,
      });
    }
    return aiErrorFromCloud(error, { providerId: this.id });
  }
}

/** Forward-compatible cancellation: `llm_cancel_stream` lands with task 1.12. */
async function defaultCancelStream(requestId: string): Promise<void> {
  try {
    await invokeCommand<void>("llm_cancel_stream", { requestId });
  } catch {
    // Command may not exist yet — cancellation then relies on the signal.
  }
}

let instance: CloudProvider | null = null;

/** Shared singleton. Tests construct their own with injected transports. */
export function getCloudProvider(): CloudProvider {
  if (!instance) instance = new CloudProvider();
  return instance;
}
