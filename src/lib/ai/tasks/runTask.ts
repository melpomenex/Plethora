/**
 * `runTask` — the single execution path for every AI feature (design D4/D5/D7).
 *
 * Responsibilities, in order:
 *   1. in-flight coalescing keyed `taskId+targetId`;
 *   2. provider resolution through the model-class router (reasoning fallback);
 *   3. capability gate (vision when required; token budget estimate);
 *   4. generation with streaming, cancellation (AbortSignal + hard timeout),
 *      and legacy `cloudExecutor` support (design D30 behavior preservation);
 *   5. structured-output validation with the strict-JSON fallback chain:
 *      native structured → parse → validate → ONE repair retry appending the
 *      validation error → else `InvalidStructuredOutput` (never partial);
 *   6. privacy-sanitized diagnostics (task id, classes, capability hash,
 *      retrieval refs, validation outcome, fallback path, error category).
 */

import { estimateTokens } from "../chunkTextByTokens";
import { recordTaskDiagnostic } from "../diagnostics";
import { AIError, isCancelledError, toAIError } from "../errors";
import { requestCloudFallback } from "../provider";
import type {
  AIModelCapabilities,
  AIRequest,
  AIResponse,
  AIProvider,
} from "../providers/types";
import { fnv1aHash, hashCapabilities } from "../providers/types";
import { repairTruncatedJson } from "../schemas/jsonRepair";
import type { ValidationOutcome } from "../schemas/common";
import { isFailedOutcome, isValidOutcome } from "../schemas/common";
import { resolveTaskRoute, type AITaskRoute } from "./router";
import type {
  AITaskDefinition,
  AITaskResult,
  AITaskRunOptions,
  AITaskValidationOutcome,
} from "./types";

/** Repair prompt appended to the user turn after a failed validation. */
const REPAIR_PREAMBLE =
  "Your previous response was rejected by validation for these reasons:";
const REPAIR_INSTRUCTION =
  "Respond again with ONLY the corrected JSON value — no prose, no markdown fences.";

const STRICT_JSON_PREAMBLE =
  "Respond with ONLY a single JSON value (no prose, no markdown fences, no commentary) " +
  "exactly matching this shape. Emit COMPACT JSON on a single line: no indentation and " +
  "no redundant whitespace — pretty-printing wastes the output budget and gets truncated:";

// ──────────────────────────────────────────────────────────────────────────
// In-flight coalescing (design D7)
// ──────────────────────────────────────────────────────────────────────────

const inFlightTasks = new Map<string, Promise<AITaskResult<unknown>>>();

function coalescingKey(taskId: string, targetId: string): string {
  return `${taskId}\u0000${targetId}`;
}

/** Introspection for tests. */
export function getInFlightTaskCount(): number {
  return inFlightTasks.size;
}

// ──────────────────────────────────────────────────────────────────────────
// runTask
// ──────────────────────────────────────────────────────────────────────────

export async function runTask<I, O>(
  task: AITaskDefinition<I, O>,
  input: I,
  options: AITaskRunOptions = {}
): Promise<AITaskResult<O>> {
  const builtPreview = safeBuildInput(task, input);
  const targetId =
    options.targetId ??
    fnv1aHash(
      `${task.id}\u0000${builtPreview?.text.slice(0, 4096) ?? ""}\u0000${builtPreview?.image?.mimeType ?? ""}${
        builtPreview?.image ? builtPreview.image.data.length : 0
      }`
    );
  const key = coalescingKey(task.id, targetId);

  const existing = inFlightTasks.get(key);
  if (existing) return existing as Promise<AITaskResult<O>>;

  const execution = executeTask(task, input, options);
  inFlightTasks.set(key, execution as Promise<AITaskResult<unknown>>);
  const cleanup = () => inFlightTasks.delete(key);
  execution.then(cleanup, cleanup);
  return execution;
}

function safeBuildInput<I, O>(
  task: AITaskDefinition<I, O>,
  input: I
): ReturnType<AITaskDefinition<I, O>["buildInput"]> | undefined {
  try {
    return task.buildInput(input);
  } catch {
    return undefined;
  }
}

async function executeTask<I, O>(
  task: AITaskDefinition<I, O>,
  input: I,
  options: AITaskRunOptions
): Promise<AITaskResult<O>> {
  const started = Date.now();
  let firstTokenAt: number | undefined;

  // ── Resolve provider (router; reasoning fallback per design D3) ──────────
  const route = options.provider
    ? {
        task: task as AITaskDefinition<never, unknown>,
        provider: options.provider,
        requestedModelClass: task.modelClass,
        servedModelClass: task.modelClass,
        fallbackPath: "none" as const,
      }
    : await resolveTaskRoute(task, { kind: options.kind });

  if (!route) {
    const error = new AIError("ModelUnavailable", "No AI provider is available for this task.", {
      code: "model_unavailable",
      taskId: task.id,
    });
    recordFailure(task, options, started, error, undefined, undefined);
    throw error;
  }
  if (route.task !== (task as unknown as AITaskDefinition<never, unknown>)) {
    // Reasoning fallback resolved a different task definition.
    task = route.task as unknown as AITaskDefinition<I, O>;
  }

  const provider: AIProvider = route.provider;
  const capabilities = await provider.getCapabilities().catch(() => undefined);
  const capabilityHash = capabilities ? hashCapabilities(capabilities) : undefined;

  const built = task.buildInput(input);

  // ── Capability gate ──────────────────────────────────────────────────────
  if (task.requiresVision && built.image && capabilities && !capabilities.vision) {
    const error = new AIError(
      "VisionUnavailable",
      "This task requires image understanding, which the active provider does not report.",
      { code: "feature_unavailable", providerId: provider.id, taskId: task.id }
    );
    recordFailure(task, options, started, error, route, capabilityHash);
    throw error;
  }

  const maxOutputTokens = options.maxOutputTokens ?? task.maxOutputTokens;

  // ── Token budget (estimation only — no blocking token-count IPC, keeping
  //    the nano fast-path finding intact) ───────────────────────────────────
  if (task.budgetPolicy !== "pre-budgeted" && capabilities && capabilities.contextTokens > 0) {
    const inputEstimate =
      estimateTokens(built.text) +
      estimateTokens(task.systemInstruction ?? "") +
      (built.image ? 258 : 0);
    if (inputEstimate + maxOutputTokens > capabilities.contextTokens) {
      const error = new AIError(
        "InputTooLarge",
        `Task input (~${inputEstimate} tokens) plus ${maxOutputTokens} output tokens exceeds the provider context of ${capabilities.contextTokens}.`,
        { code: "context_too_large", providerId: provider.id, taskId: task.id }
      );
      recordFailure(task, options, started, error, route, capabilityHash);
      throw error;
    }
  }

  // ── Cancellation + timeout controller ────────────────────────────────────
  const timeoutMs = options.timeoutMs ?? task.timeoutMs;
  const controller = new AbortController();
  let timedOut = false;
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onOuterAbort, { once: true });
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : undefined;

  const streamWanted = options.streaming ?? task.streaming ?? true;
  const trackFirstToken = (chunk: string) => {
    if (firstTokenAt === undefined && chunk.length > 0) firstTokenAt = Date.now();
    options.onChunk?.(chunk);
  };

  try {
    const response = await generateWithFallbacks(task, input, options, {
      provider,
      capabilities,
      built,
      maxOutputTokens,
      controller,
      streamWanted,
      trackFirstToken,
    });

    // ── Output validation (design D5) ──────────────────────────────────────
    const { value, validationOutcome } = await validateOutput(
      task,
      input,
      response,
      options,
      {
        provider,
        capabilities,
        built,
        maxOutputTokens,
        controller,
        streamWanted,
        trackFirstToken,
      }
    );

    recordTaskDiagnostic({
      taskId: task.id,
      taskType: task.taskType ?? "prompt",
      modelClass: route.servedModelClass,
      requestedModelClass: route.requestedModelClass,
      providerId: provider.id,
      providerKind: provider.kind,
      capabilityHash,
      retrievalCount: options.retrieval?.count ?? 0,
      chunkIds: options.retrieval?.chunkIds ?? [],
      validationOutcome,
      fallbackPath: route.fallbackPath,
      baseModelName: response.baseModelName,
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
      tokenLimit: response.usage?.tokenLimit,
      firstTokenLatencyMs:
        firstTokenAt !== undefined ? firstTokenAt - started : undefined,
      totalLatencyMs: Date.now() - started,
      finishReason: response.finishReason,
    });

    return {
      taskId: task.id,
      output: value as O,
      text: response.text,
      providerId: provider.id,
      providerKind: provider.kind,
      requestedModelClass: route.requestedModelClass,
      servedModelClass: route.servedModelClass,
      fallbackPath: route.fallbackPath,
      validationOutcome,
      baseModelName: response.baseModelName,
      usage: response.usage,
    };
  } catch (error) {
    let mapped = toAIError(error, { providerId: provider.id, taskId: task.id });
    if (timedOut) {
      // A timeout-triggered abort must read as a generation failure, not a
      // user cancellation (which would suppress cloud fallback).
      mapped = new AIError(
        "GenerationFailed",
        `Task ${task.id} exceeded its ${timeoutMs}ms timeout.`,
        { code: "timeout", providerId: provider.id, taskId: task.id, cause: error }
      );
    }
    recordFailure(task, options, started, mapped, route, capabilityHash, firstTokenAt);

    // On-device failure (e.g. timeout or generation failure) may retry on the
    // configured cloud provider — mirroring the long-standing `runAiAction`
    // fallback — but ONLY with explicit consent (ai-billing-safety #14 /
    // design D27: cloud transmission is never silent). Free/local cloud
    // targets (Ollama, local endpoints) are never billable and proceed; a
    // paid cloud target proceeds when the persisted `allowCloudFallback` flag
    // is set or the ai-fallback consent surface is approved. A denial stops
    // the operation (the original error surfaces to the caller's UI), and a
    // user cancellation or on-device safety refusal never re-sends content.
    if (
      provider.kind === "ondevice" &&
      !options.kind &&
      !options.provider &&
      !options.signal?.aborted &&
      mapped.category !== "Cancelled" &&
      mapped.category !== "SafetyBlocked"
    ) {
      const cloudRoute = await resolveTaskRoute(task, { kind: "cloud" }).catch(() => null);
      if (cloudRoute && (await requestCloudFallback(task.id))) {
        try {
          return await executeTask(task, input, {
            ...options,
            provider: cloudRoute.provider,
          });
        } catch {
          // Fallback also failed or unavailable; throw original mapped error below
        }
      }
    }

    throw mapped;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onOuterAbort);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Generation (legacy cloud executor + provider stream)
// ──────────────────────────────────────────────────────────────────────────

interface GenerationContext {
  provider: AIProvider;
  capabilities: AIModelCapabilities | undefined;
  built: { text: string; image?: { mimeType: string; data: string } };
  maxOutputTokens: number;
  controller: AbortController;
  streamWanted: boolean;
  trackFirstToken: (chunk: string) => void;
}

async function generateWithFallbacks<I, O>(
  task: AITaskDefinition<I, O>,
  input: I,
  options: AITaskRunOptions,
  ctx: GenerationContext
): Promise<AIResponse> {
  // Legacy cloud commands keep byte-identical Phase-0 behavior (design D30).
  if (ctx.provider.kind === "cloud" && task.cloudExecutor) {
    const raw = await task.cloudExecutor(input, { signal: ctx.controller.signal });
    const out = typeof raw === "string" ? { text: raw } : raw;
    ctx.trackFirstToken(out.text);
    return {
      requestId: `${task.id}-${Date.now()}`,
      text: out.text,
      baseModelName: out.baseModelName,
    };
  }

  const useNativeStructured =
    task.outputKind === "structured" &&
    !!task.schema &&
    ctx.capabilities?.structuredGeneration === true;

  const request: AIRequest = {
    requestId: makeRequestId(task.id),
    systemInstruction: useNativeStructured
      ? task.systemInstruction
      : task.outputKind === "structured" && task.schema
        ? `${task.systemInstruction}\n\n${STRICT_JSON_PREAMBLE} ${task.schema.json}`
        : task.systemInstruction,
    text: ctx.built.text,
    image: ctx.built.image,
    maxOutputTokens: ctx.maxOutputTokens,
    structured: useNativeStructured,
    schemaName: useNativeStructured ? task.schema!.nativeName : undefined,
  };

  try {
    return await ctx.provider.generateStream(request, {
      signal: ctx.controller.signal,
      onChunk: ctx.trackFirstToken,
      onRetry: options.onRetry,
      // Native structured output emits no incremental text events; the
      // terminal response carries the envelope.
      stream: useNativeStructured ? false : ctx.streamWanted,
    });
  } catch (error) {
    // Native structured may come back null/fallback without erroring; errors
    // map through the taxonomy, cancellation stays cancellation.
    if (isCancelledError(error)) throw error;
    throw toAIError(error, { providerId: ctx.provider.id, taskId: task.id });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Structured-output validation + strict-JSON fallback + ONE repair retry
// ──────────────────────────────────────────────────────────────────────────

async function validateOutput<I, O>(
  task: AITaskDefinition<I, O>,
  input: I,
  response: AIResponse,
  options: AITaskRunOptions,
  ctx: GenerationContext
): Promise<{ value: O; validationOutcome: AITaskValidationOutcome }> {
  if (task.outputKind !== "structured" || !task.validate) {
    if (task.validate) {
      // Text task with a validator: still fail closed.
      const outcome = task.validate(response.text, input);
      if (isValidOutcome(outcome)) {
        return { value: outcome.value, validationOutcome: "text" };
      }
      throw invalidStructuredOutput(task.id, outcome.errors);
    }
    return { value: response.text as unknown as O, validationOutcome: "text" };
  }

  const attempt = (candidate: unknown): ValidationOutcome<O> | undefined =>
    candidate === undefined ? undefined : task.validate!(candidate, input);

  // 1. Native structured payload (schema-compiled path) when present.
  if (response.structured !== null && response.structured !== undefined) {
    const outcome = attempt(response.structured);
    if (outcome !== undefined && isValidOutcome(outcome)) {
      return { value: outcome.value, validationOutcome: "native-structured" };
    }
    if (outcome !== undefined && isFailedOutcome(outcome)) {
      // 2. One repair retry through strict-JSON text mode.
      const repaired = await repairOnce(task, input, ctx, outcome.errors);
      if (repaired) return repaired;
      throw invalidStructuredOutput(task.id, outcome.errors);
    }
  }

  // 3. Strict-JSON parse of the text response.
  const parsed = parseStrictJson(response.text);
  if (isParseFailure(parsed)) {
    // Truncation salvage (device reports: "Unterminated string … at position
    // N"): output clipped at the token cap. Close strings/brackets and drop
    // the incomplete tail programmatically — a proposal missing its last,
    // half-written entry beats no proposal, and the repair retry would
    // truncate again at the same cap. The task validator still gates this.
    const salvaged = repairTruncatedJson(response.text);
    if (salvaged !== null) {
      const outcome = attempt(salvaged);
      if (outcome !== undefined && isValidOutcome(outcome)) {
        return { value: outcome.value, validationOutcome: "truncated-json-salvaged" };
      }
      // Salvage parsed but failed validation: repair against the real
      // validation errors rather than the parse error.
      const errors =
        outcome !== undefined && isFailedOutcome(outcome)
          ? outcome.errors
          : [parsed.error];
      const repaired = await repairOnce(task, input, ctx, errors);
      if (repaired) return repaired;
      throw invalidStructuredOutput(task.id, errors);
    }
    const repaired = await repairOnce(task, input, ctx, [parsed.error]);
    if (repaired) return repaired;
    throw invalidStructuredOutput(task.id, [parsed.error]);
  }
  const outcome = attempt(parsed.value);
  if (outcome !== undefined && isValidOutcome(outcome)) {
    return { value: outcome.value, validationOutcome: "strict-json" };
  }
  const errors =
    outcome !== undefined && isFailedOutcome(outcome)
      ? outcome.errors
      : ["structured output failed validation"];
  const repaired = await repairOnce(task, input, ctx, errors);
  if (repaired) return repaired;
  throw invalidStructuredOutput(task.id, errors);
}

async function repairOnce<I, O>(
  task: AITaskDefinition<I, O>,
  input: I,
  ctx: GenerationContext,
  errors: string[]
): Promise<{ value: O; validationOutcome: AITaskValidationOutcome } | undefined> {
  // A truncation-shaped parse error means the previous output was cut off
  // at the token cap — tell the model to compact and shorten instead of
  // re-emitting the same length (which would truncate identically).
  const truncationHint = errors.some((e) =>
    /Unterminated string|Unexpected end|truncat/i.test(e)
  )
    ? "\nYour previous output was CUT OFF at the output-token limit. Shorten the content (fewer or terser entries) so the JSON document completes within the limit."
    : "";
  const repairRequest: AIRequest = {
    requestId: makeRequestId(`${task.id}-repair`),
    systemInstruction: `${task.systemInstruction}\n\n${STRICT_JSON_PREAMBLE} ${
      task.schema?.json ?? ""
    }`,
    text: `${ctx.built.text}\n\n${REPAIR_PREAMBLE}\n${errors
      .slice(0, 8)
      .map((e) => `- ${e}`)
      .join("\n")}${truncationHint}\n${REPAIR_INSTRUCTION}`,
    image: ctx.built.image,
    maxOutputTokens: ctx.maxOutputTokens,
    structured: false,
  };

  let response: AIResponse;
  try {
    response = await ctx.provider.generateStream(repairRequest, {
      signal: ctx.controller.signal,
      stream: false,
    });
  } catch (error) {
    if (isCancelledError(error)) throw error;
    return undefined;
  }

  const candidate =
    response.structured !== null && response.structured !== undefined
      ? response.structured
      : (() => {
          const parsed = parseStrictJson(response.text);
          return isParseFailure(parsed) ? undefined : parsed.value;
        })();

  const outcome = task.validate!(candidate, input);
  if (outcome !== undefined && isValidOutcome(outcome)) {
    return { value: outcome.value, validationOutcome: "repaired" };
  }
  return undefined;
}

export type ParsedJsonResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Narrowing guard (see `schemas/common.ts` note on this tsconfig). */
export function isParseFailure(parsed: ParsedJsonResult): parsed is { ok: false; error: string } {
  return parsed.ok !== true;
}

/**
 * Strict JSON extraction: accepts a pure JSON document, optionally wrapped in
 * a ```json fence; rejects anything else.
 */
export function parseStrictJson(text: string): ParsedJsonResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "empty response" };

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;

  if (!candidate.startsWith("{") && !candidate.startsWith("[")) {
    return { ok: false, error: "response is not a JSON object or array" };
  }
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch (error) {
    return { ok: false, error: `JSON parse failed: ${(error as Error).message}` };
  }
}

function invalidStructuredOutput(taskId: string, errors: string[]): AIError {
  return new AIError(
    "InvalidStructuredOutput",
    `Task ${taskId} produced structured output that failed validation: ${errors
      .slice(0, 5)
      .join("; ")}`,
    { code: "invalid_structured_output", taskId, details: errors.slice(0, 12) }
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function makeRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function recordFailure<I, O>(
  task: AITaskDefinition<I, O>,
  options: AITaskRunOptions,
  started: number,
  error: AIError,
  route: AITaskRoute | undefined,
  capabilityHash: string | undefined,
  firstTokenAt?: number
): void {
  recordTaskDiagnostic({
    taskId: task.id,
    taskType: task.taskType ?? "prompt",
    modelClass: route?.servedModelClass,
    requestedModelClass: route?.requestedModelClass,
    providerId: route?.provider.id,
    providerKind: route?.provider.kind,
    capabilityHash,
    retrievalCount: options.retrieval?.count ?? 0,
    chunkIds: options.retrieval?.chunkIds ?? [],
    validationOutcome: error.category === "InvalidStructuredOutput" ? "invalid-structured-output" : undefined,
    fallbackPath: route?.fallbackPath,
    errorCategory: error.category,
    errorCode: error.code,
    firstTokenLatencyMs: firstTokenAt !== undefined ? firstTokenAt - started : undefined,
    totalLatencyMs: Date.now() - started,
  });
}
