import type { LLMResponse } from "./index";

/** Safe completion categories. Payloads in other channels never become an answer. */
export type LLMResponseKind = "final-text" | "empty" | "refusal" | "reasoning-only" | "tool-only";

type WireObject = Record<string, unknown>;
function object(value: unknown): WireObject {
  return value !== null && typeof value === "object" ? (value as WireObject) : {};
}

export function normalizeFinishReason(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return ["length", "max_tokens", "max_output_tokens", "MAX_TOKENS"].includes(value)
    ? "length"
    : value;
}

/** Accept native snake case and browser camel case, including older runtimes. */
export function normalizeLLMResponse(value: unknown): LLMResponse {
  const raw = object(value);
  const usage = object(raw.usage);
  const token = (camel: string, snake: string): number | undefined => {
    const n = usage[camel] ?? usage[snake];
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const kind = raw.responseKind ?? raw.response_kind;
  return {
    content: typeof raw.content === "string" ? raw.content : "",
    finishReason: normalizeFinishReason(raw.finishReason ?? raw.finish_reason),
    responseKind: ["final-text", "empty", "refusal", "reasoning-only", "tool-only"].includes(
      String(kind)
    )
      ? (kind as LLMResponseKind)
      : undefined,
    usage: raw.usage
      ? {
          promptTokens: token("promptTokens", "prompt_tokens"),
          completionTokens: token("completionTokens", "completion_tokens"),
          totalTokens: token("totalTokens", "total_tokens"),
          promptCacheHitTokens: token("promptCacheHitTokens", "prompt_cache_hit_tokens"),
          promptCacheMissTokens: token("promptCacheMissTokens", "prompt_cache_miss_tokens"),
        }
      : undefined,
  };
}

/** OpenAI-compatible HTTP response, with only final text and bounded metadata retained. */
export function parseOpenAICompletion(value: unknown): LLMResponse {
  const raw = object(value);
  const choice = object(Array.isArray(raw.choices) ? raw.choices[0] : undefined);
  const message = object(choice.message);
  const parts = Array.isArray(message.content) ? message.content.map(object) : [];
  const content =
    typeof message.content === "string"
      ? message.content
      : parts
          .filter(
            (part) => part.type == null || part.type === "text" || part.type === "output_text"
          )
          .map((part) => (typeof part.text === "string" ? part.text : ""))
          .join("");
  const finishReason = normalizeFinishReason(choice.finish_reason);
  const refusal =
    Boolean(message.refusal) ||
    parts.some((part) => part.type === "refusal") ||
    ["content_filter", "safety", "refusal"].includes(finishReason ?? "");
  const hasReasoning =
    [message.reasoning_content, message.reasoning].some((v) => typeof v === "string" && v.trim()) ||
    parts.some((part) => part.type === "reasoning" || part.type === "thinking");
  const hasTools =
    (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) ||
    Boolean(message.function_call) ||
    ["tool_calls", "function_call"].includes(finishReason ?? "");
  return normalizeLLMResponse({
    content,
    finishReason,
    usage: raw.usage,
    responseKind: refusal
      ? "refusal"
      : content.trim()
        ? "final-text"
        : hasTools
          ? "tool-only"
          : hasReasoning
            ? "reasoning-only"
            : "empty",
  });
}

export function parseAnthropicCompletion(value: unknown): LLMResponse {
  const raw = object(value);
  const parts = Array.isArray(raw.content) ? raw.content.map(object) : [];
  const content = parts
    .filter((part) => part.type === "text")
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
  const usage = object(raw.usage);
  const input = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
  const output = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
  return normalizeLLMResponse({
    content,
    finishReason: raw.stop_reason,
    responseKind:
      raw.stop_reason === "refusal"
        ? "refusal"
        : content.trim()
          ? "final-text"
          : parts.some((part) => part.type === "tool_use")
            ? "tool-only"
            : parts.some((part) => part.type === "thinking" || part.type === "redacted_thinking")
              ? "reasoning-only"
              : "empty",
    usage: raw.usage
      ? {
          promptTokens: input,
          completionTokens: output,
          totalTokens: input != null && output != null ? input + output : undefined,
        }
      : undefined,
  });
}
