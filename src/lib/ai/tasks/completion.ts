import type { AIResponse } from "../providers/types";

export const COMPLETION_FAILURE_KINDS = [
  "empty-response",
  "output-limit",
  "reasoning-only",
  "tool-only",
  "refusal",
  "malformed-json",
  "schema-invalid",
  "provider-error",
  "cancelled",
  "timeout",
] as const;
export type CompletionFailureKind = (typeof COMPLETION_FAILURE_KINDS)[number];

/** Content-free details for the initial and terminal/accepted completion. */
export interface CompletionRecovery {
  attemptCount: number;
  firstFailureKind?: CompletionFailureKind;
  terminalFailureKind?: CompletionFailureKind;
  outputLimitObserved?: boolean;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** Shared allowlist for the diagnostic ring and its redacted export. */
export function sanitizeCompletionRecovery(value: Partial<CompletionRecovery>): Partial<CompletionRecovery> {
  const count = (n: number | undefined) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  const stopReasons = ["stop", "end_turn", "length", "max_tokens", "tool_calls", "function_call", "content_filter", "safety", "refusal", "unknown"];
  return {
    attemptCount: [0, 1, 2].includes(value.attemptCount!) ? value.attemptCount : undefined,
    firstFailureKind: COMPLETION_FAILURE_KINDS.includes(value.firstFailureKind!) ? value.firstFailureKind : undefined,
    terminalFailureKind: COMPLETION_FAILURE_KINDS.includes(value.terminalFailureKind!) ? value.terminalFailureKind : undefined,
    finishReason: stopReasons.includes(value.finishReason!) ? value.finishReason : undefined,
    inputTokens: count(value.inputTokens), outputTokens: count(value.outputTokens),
    outputLimitObserved: value.outputLimitObserved === true || undefined,
  };
}

export function completionMetadata(
  response: AIResponse
): Pick<CompletionRecovery, "finishReason" | "inputTokens" | "outputTokens"> {
  return {
    finishReason: response.finishReason,
    inputTokens: response.usage?.inputTokens,
    outputTokens: response.usage?.outputTokens,
  };
}

export function responseFailureKind(
  response: AIResponse,
  otherwise: CompletionFailureKind
): CompletionFailureKind {
  if (
    response.responseKind === "refusal" ||
    ["content_filter", "safety", "refusal"].includes(response.finishReason ?? "")
  )
    return "refusal";
  if (response.finishReason === "length") return "output-limit";
  if (response.responseKind === "tool-only" || response.responseKind === "reasoning-only")
    return response.responseKind;
  return !response.text.trim() && response.structured == null ? "empty-response" : otherwise;
}

/** Reserve for a bounded corrective suffix, including errors and rejected output. */
export const CORRECTION_OVERHEAD_TOKENS = 1100;

export function structuredSystemInstruction(system: string, schema?: string): string {
  return `${system}\n\nRespond with ONLY a single JSON value (no prose, no markdown fences, no commentary) exactly matching this shape. Emit COMPACT JSON on a single line: no indentation and no redundant whitespace — pretty-printing wastes the output budget and gets truncated: ${schema ?? ""}`;
}

export function errorFailureKind(error: { category: string; code: string }): CompletionFailureKind {
  if (error.code === "timeout") return "timeout";
  const categories: Record<string, CompletionFailureKind> = {
    Cancelled: "cancelled",
    SafetyBlocked: "refusal",
  };
  return categories[error.category] ?? "provider-error";
}
