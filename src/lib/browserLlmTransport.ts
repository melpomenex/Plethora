import { providerRequiresApiKey } from "../utils/llmProviderUtils";
import {
  normalizeLLMResponse,
  parseAnthropicCompletion,
  parseOpenAICompletion,
  type LLMResponseKind,
} from "../api/llm/response";
import type { LLMMessage, LLMRequest, LLMResponse, StreamOptions } from "../api/llm";

interface BrowserLLMArgs extends Pick<LLMRequest,
  "provider" | "model" | "messages" | "temperature" | "maxTokens" | "apiKey" | "baseUrl" | "policy"> {}

interface BrowserContextArgs extends BrowserLLMArgs {
  context: {
    type: string;
    scope?: string;
    documentId?: string;
    url?: string;
    content?: unknown;
    selection?: string;
    contextWindowTokens?: number;
    promptBudgetTokens?: number;
    configuredContextTokens?: number;
    maxOutputTokens?: number;
    memoryEnabled?: boolean;
  };
}

interface BrowserRequestShape {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  provider: string;
}

const DEFAULTS: Record<string, { url: string; model: string }> = {
  openrouter: { url: "https://openrouter.ai/api/v1", model: "anthropic/claude-3.5-sonnet" },
  openai: { url: "https://api.openai.com/v1", model: "gpt-4o" },
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.5-flash" },
  deepseek: { url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  anthropic: { url: "https://api.anthropic.com/v1", model: "claude-3-5-sonnet-20241022" },
};

function makeBrowserRequest(request: BrowserLLMArgs, streaming: boolean): BrowserRequestShape {
  const config = DEFAULTS[request.provider];
  if (!config) {
    throw new Error(
      `Provider '${request.provider}' is not supported in browser mode. Supported: openrouter, openai, gemini, deepseek, anthropic`,
    );
  }
  const baseUrl = (request.baseUrl || config.url).replace(/\/+$/, "");
  if (providerRequiresApiKey(request.provider, baseUrl) && !request.apiKey) {
    throw new Error("API key is required");
  }
  const model = request.model || config.model;
  const temperature = request.temperature ?? 0.7;
  const maxTokens = request.maxTokens ?? request.policy?.maxOutputTokens ?? 2000;

  if (request.provider === "anthropic") {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": request.apiKey ?? "",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
    return {
      url: `${baseUrl}/messages`,
      headers,
      provider: request.provider,
      body: {
        model,
        max_tokens: maxTokens,
        temperature,
        stream: streaming,
        messages: request.messages.filter((message) => message.role !== "system").map((message) => ({
          role: message.role,
          content: message.content,
        })),
        system: request.messages
          .filter((message) => message.role === "system")
          .map((message) => typeof message.content === "string" ? message.content : "")
          .filter(Boolean)
          .join("\n\n"),
      },
    };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (request.apiKey) headers.Authorization = `Bearer ${request.apiKey}`;
  if (request.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://plethora.app";
    headers["X-Title"] = "Plethora";
  }
  return {
    url: `${baseUrl}/chat/completions`,
    headers,
    provider: request.provider,
    body: {
      model,
      messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
      temperature,
      max_tokens: maxTokens,
      stream: streaming,
    },
  };
}

export async function browserChatCompletion(request: BrowserLLMArgs): Promise<LLMResponse> {
  const built = makeBrowserRequest(request, false);
  const response = await fetch(built.url, {
    method: "POST",
    headers: built.headers,
    body: JSON.stringify(built.body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${built.provider} API error (${response.status}): ${errorText}`);
  }
  const data: unknown = await response.json();
  return built.provider === "anthropic" ? parseAnthropicCompletion(data) : parseOpenAICompletion(data);
}

function normalizeContextContent(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{1,3}(?:,\s*\d{1,3})+$/.test(trimmed)) {
      const bytes = trimmed.split(",").map((part) => Number.parseInt(part.trim(), 10));
      if (bytes.some((byte) => Number.isNaN(byte))) return value;
      try { return new TextDecoder("utf-8").decode(Uint8Array.from(bytes)); }
      catch { return value; }
    }
    return trimmed;
  }
  if (value instanceof Uint8Array) return new TextDecoder("utf-8").decode(value);
  if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
    try { return new TextDecoder("utf-8").decode(Uint8Array.from(value)); }
    catch { return value.join(","); }
  }
  return String(value);
}

export function prepareBrowserContextRequest(request: BrowserContextArgs): BrowserLLMArgs {
  const { context } = request;
  const promptBudget = context.promptBudgetTokens ?? context.contextWindowTokens;
  const normalizedContent = normalizeContextContent(context.content);
  if (context.type === "document" && context.scope === "document" && !normalizedContent?.trim()) {
    throw new Error("Document context is unavailable for this request.");
  }
  const maxOutput = request.maxTokens && request.maxTokens > 0
    ? request.maxTokens
    : context.maxOutputTokens && context.maxOutputTokens > 0
      ? context.maxOutputTokens
      : request.policy?.maxOutputTokens ?? 2000;
  const tokenLimit = promptBudget && promptBudget > 0 ? promptBudget : 2000;
  const maxChars = tokenLimit * 4;
  const content = normalizedContent && normalizedContent.length > maxChars
    ? normalizedContent.slice(0, maxChars)
    : normalizedContent;

  let contextPrompt = "";
  if (context.type === "document" && content) {
    contextPrompt = `You are a helpful assistant analyzing the following document content:\n\n${content}\n\nAnswer questions based on this document.`;
    if (context.selection?.trim()) contextPrompt += `\n\nSelected text:\n${context.selection}`;
  } else if (context.type === "video" && content) {
    contextPrompt = `You are a helpful assistant analyzing the following video transcript:\n\n${content}\n\nAnswer questions based on this transcript.`;
    if (context.selection?.trim()) contextPrompt += `\n\nSelected text:\n${context.selection}`;
  } else if (context.type === "web") {
    if (content) {
      contextPrompt = `You are a helpful assistant analyzing the following web page content:\n\n${content}\n\nAnswer questions based on this page.`;
      if (context.selection?.trim()) contextPrompt += `\n\nSelected text:\n${context.selection}`;
    } else {
      contextPrompt = "You are a helpful assistant that can search the web for information.";
    }
  } else {
    contextPrompt = "You are a helpful assistant.";
  }

  return {
    provider: request.provider,
    model: request.model,
    messages: [{ role: "system", content: contextPrompt }, ...request.messages],
    temperature: request.temperature ?? 0.7,
    maxTokens: maxOutput,
    apiKey: request.apiKey,
    baseUrl: request.baseUrl,
    policy: request.policy,
  };
}

interface SseRecord {
  event?: string;
  data: string;
}

async function* readSse(response: Response, signal: AbortSignal): AsyncGenerator<SseRecord> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const cancelRead = () => { void reader.cancel(); };
  signal.addEventListener("abort", cancelRead, { once: true });

  const parseRecord = (record: string): SseRecord | undefined => {
    let event: string | undefined;
    const data: string[] = [];
    for (const line of record.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    return data.length ? { event, data: data.join("\n") } : undefined;
  };

  try {
    while (true) {
      if (signal.aborted) throw Object.assign(new Error("Stream aborted"), { code: "cancelled" });
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
        const record = parseRecord(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + separator.length);
        if (record) yield record;
        boundary = buffer.search(/\r?\n\r?\n/);
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const record = parseRecord(buffer);
      if (record) yield record;
    }
  } finally {
    signal.removeEventListener("abort", cancelRead);
    reader.releaseLock();
  }
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function textDelta(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map(object)
    .filter((part) => part.type == null || part.type === "text" || part.type === "output_text")
    .map((part) => typeof part.text === "string" ? part.text : "")
    .join("");
}

function responseKindForStream(
  content: string,
  finishReason?: string,
  sawRefusal = false,
  sawReasoning = false,
  sawTool = false,
): LLMResponseKind {
  if (sawRefusal || ["refusal", "content_filter", "safety"].includes(finishReason ?? "")) return "refusal";
  if (content.trim()) return "final-text";
  if (sawTool || ["tool_calls", "function_call", "tool_use"].includes(finishReason ?? "")) return "tool-only";
  return sawReasoning ? "reasoning-only" : "empty";
}

export async function streamBrowserLLM(request: LLMRequest, options: StreamOptions): Promise<void> {
  const prepared = request.context
    ? prepareBrowserContextRequest({ ...request, context: request.context })
    : request;
  const built = makeBrowserRequest(prepared, true);
  const controller = new AbortController();
  let terminal = false;
  let text = "";
  let finishReason: string | undefined;
  let usage: LLMResponse["usage"];
  let sawRefusal = false;
  let sawReasoning = false;
  let sawTool = false;
  const abort = () => controller.abort();

  if (options.signal?.aborted) {
    throw Object.assign(new Error("Browser stream was cancelled."), { code: "cancelled" });
  }
  options.signal?.addEventListener("abort", abort, { once: true });

  try {
    const response = await fetch(built.url, {
      method: "POST",
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${built.provider} API error (${response.status}): ${errorText}`);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/event-stream")) {
      // Some compatible endpoints accept stream=true but return a complete
      // JSON response. Use that same response once; do not replay it as fake
      // token-by-token streaming.
      const result = built.provider === "anthropic"
        ? parseAnthropicCompletion(await response.json())
        : parseOpenAICompletion(await response.json());
      if (result.content) {
        text = result.content;
        options.onChunk(text);
      }
      terminal = true;
      options.onDone?.({ finishReason: result.finishReason, responseKind: result.responseKind, usage: result.usage });
      return;
    }
    if (!response.body) throw new Error("This endpoint did not provide a readable stream.");

    for await (const record of readSse(response, controller.signal)) {
      if (controller.signal.aborted || terminal) break;
      if (record.data === "[DONE]") break;
      let data: Record<string, unknown>;
      try { data = object(JSON.parse(record.data)); }
      catch { continue; }

      if (built.provider === "anthropic") {
        const eventType = typeof data.type === "string" ? data.type : record.event;
        if (eventType === "message_start") {
          const message = object(data.message);
          const startUsage = object(message.usage);
          usage = {
            promptTokens: typeof startUsage.input_tokens === "number" ? startUsage.input_tokens : undefined,
            completionTokens: typeof startUsage.output_tokens === "number" ? startUsage.output_tokens : undefined,
          };
        } else if (eventType === "content_block_start") {
          const block = object(data.content_block);
          sawTool ||= block.type === "tool_use";
          sawReasoning ||= block.type === "thinking" || block.type === "redacted_thinking";
        } else if (eventType === "content_block_delta") {
          const delta = object(data.delta);
          if (delta.type === "text_delta" && typeof delta.text === "string") {
            text += delta.text;
            options.onChunk(delta.text);
          } else if (delta.type === "thinking_delta" || delta.type === "signature_delta") {
            sawReasoning = true;
          } else if (delta.type === "input_json_delta") {
            sawTool = true;
          }
        } else if (eventType === "message_delta") {
          const delta = object(data.delta);
          if (typeof delta.stop_reason === "string") finishReason = delta.stop_reason === "max_tokens" ? "length" : delta.stop_reason;
          const deltaUsage = object(data.usage);
          if (typeof deltaUsage.output_tokens === "number") usage = { ...usage, completionTokens: deltaUsage.output_tokens };
          sawRefusal ||= delta.stop_reason === "refusal";
        } else if (eventType === "error") {
          const error = object(data.error);
          throw new Error(typeof error.message === "string" ? error.message : "Anthropic streaming error");
        }
        if (eventType === "message_stop") break;
      } else {
        const choices = Array.isArray(data.choices) ? data.choices.map(object) : [];
        const choice = choices[0];
        const delta = object(choice?.delta);
        const chunkText = textDelta(delta.content);
        if (chunkText) {
          text += chunkText;
          options.onChunk(chunkText);
        }
        if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
        if (typeof delta.refusal === "string" && delta.refusal) sawRefusal = true;
        if (typeof delta.reasoning_content === "string" || typeof delta.reasoning === "string") sawReasoning = true;
        sawTool ||= Boolean(delta.tool_calls) || Boolean(delta.function_call);
        if (data.usage) {
          const normalized = normalizeLLMResponse({ content: text, usage: data.usage }).usage;
          if (normalized) usage = normalized;
        }
      }
    }

    if (controller.signal.aborted || options.signal?.aborted) {
      throw Object.assign(new Error("Browser stream was cancelled."), { code: "cancelled" });
    }
    terminal = true;
    options.onDone?.({
      finishReason,
      responseKind: responseKindForStream(text, finishReason, sawRefusal, sawReasoning, sawTool),
      usage,
    });
  } catch (error) {
    if (!terminal) {
      terminal = true;
      const aborted = controller.signal.aborted || options.signal?.aborted;
      const message = error instanceof Error ? error.message : String(error);
      options.onError?.(aborted ? "Stream cancelled" : message, aborted ? "cancelled" : (error as { code?: string })?.code);
    }
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}
