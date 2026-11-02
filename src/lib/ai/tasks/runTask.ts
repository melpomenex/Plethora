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

import { completionMetadata, responseFailureKind, structuredSystemInstruction, CORRECTION_OVERHEAD_TOKENS, type CompletionRecovery, type CompletionFailureKind, errorFailureKind } from "./completion";
import { estimateTokens } from "../chunkTextByTokens";
import { recordFeatureObservation, recordTaskDiagnostic } from "../diagnostics";
import { normalizeProviderClass } from "../diagnostics/featureReport";
import { AIError, isCancelledError, toAIError } from "../errors";
import { appleFmSupportsNativeSchema } from "../apple/nativeSchemas";
import { APPLE_FOUNDATION_PROVIDER_ID } from "../providers/appleFoundationProvider";
import { getRoutingProviders } from "../providers";
import { requestCloudFallback } from "../provider";
import type {
  AIModelCapabilities,
  AIRequest,
  AIResponse,
  AIProvider,
} from "../providers/types";
import { fnv1aHash, hashCapabilities } from "../providers/types";
import { repairTruncatedJson } from "../schemas/jsonRepair";
import { isValidOutcome } from "../schemas/common";
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


function taskLayerProviderKind(kind: AIProvider["kind"]): "ondevice" | "cloud" {
  return kind === "cloud" ? "cloud" : "ondevice";
}

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

  // A run whose owner already cancelled must not resolve a provider, probe
  // capabilities or send content anywhere.
  if (options.signal?.aborted) {
    const cancelled = new AIError("Cancelled", `Task ${task.id} was cancelled before it started.`, {
      code: "cancelled",
      taskId: task.id,
    });
    recordFailure(task, options, started, cancelled, undefined, undefined);
    throw cancelled;
  }

  // ── Resolve provider (router; reasoning fallback per design D3) ──────────
  const selectedProvider = options.provider ?? options.resolvedProvider;
  const route = selectedProvider
    ? {
        task: task as AITaskDefinition<never, unknown>,
        provider: selectedProvider,
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

  const policy = boundedRequestPolicy(options.requestPolicy, provider.getRequestPolicy?.());
  const maxOutputTokens = Math.min(options.maxOutputTokens ?? task.maxOutputTokens, policy?.maxOutputTokens ?? Infinity);

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
  // The listener does not fire for an already-aborted signal; bridge it now so
  // a cancellation that lands between the start check and here still stops
  // generation before it begins.
  if (options.signal?.aborted) controller.abort();
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

  const ctx: GenerationContext = {
    provider, capabilities, built, maxOutputTokens, controller, streamWanted, trackFirstToken,
    policy, recovery: { attemptCount: 0 },
  };
  try {
    let response = await generateWithFallbacks(task, input, options, ctx);
    Object.assign(ctx.recovery, completionMetadata(response));
    ctx.recovery.outputLimitObserved = response.finishReason === "length";
    const validated = await validateOutput(task, input, response, options, ctx);
    const { value, validationOutcome } = validated;
    response = validated.response;

    recordTaskDiagnostic({
      taskId: task.id,
      taskType: task.taskType ?? "prompt",
      modelClass: route.servedModelClass,
      requestedModelClass: route.requestedModelClass,
      providerId: provider.id,
      providerKind: taskLayerProviderKind(provider.kind),
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
      ...ctx.recovery,
    });

    if (options.observation) {
      recordFeatureObservation({
        featureId: options.observation.featureId,
        runId: options.observation.runId,
        stage: "generation",
        level: "operational",
        outcome: "success",
        durationMs: Date.now() - started,
        capabilityRevision: options.observation.capabilityRevision,
        providerClass: normalizeProviderClass(provider.id),
        modelClass: route.servedModelClass,
        smoke: options.observation.smoke,
      });
    }

    return {
      taskId: task.id,
      output: value as O,
      text: response.text,
      providerId: provider.id,
      providerKind: taskLayerProviderKind(provider.kind),
      requestedModelClass: route.requestedModelClass,
      servedModelClass: route.servedModelClass,
      fallbackPath: route.fallbackPath,
      validationOutcome,
      baseModelName: response.baseModelName,
      usage: response.usage,
    };
  } catch (error) {
    const mapped = completionError(error, task.id, ctx, timedOut, timeoutMs);
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
  const cloudFallbackEligible =
      (provider.kind === "ondevice" || provider.kind === "local-model") &&
      !options.kind &&
      !options.provider &&
      !options.signal?.aborted &&
      mapped.category !== "Cancelled" &&
      mapped.category !== "SafetyBlocked" &&
      mapped.category !== "CapabilityUnavailable" &&
      mapped.category !== "ModelDownloadRequired" &&
      mapped.category !== "Busy";

    if (cloudFallbackEligible) {
      const all = getRoutingProviders();
      const failedIdx = all.findIndex((p) => p.id === provider.id);
      if (failedIdx >= 0) {
        for (const next of all.slice(failedIdx + 1).filter((p) => p.kind !== "cloud")) {
          const altRoute = await resolveTaskRoute(task, { providers: [next] }).catch(() => null);
          if (!altRoute) continue;
          try {
            return await executeTask(task, input, { ...options, provider: next });
          } catch (error) {
            rethrowTerminalError(error, options.signal);
            // Try remaining on-device / local-model providers before cloud.
          }
        }
      }

      const cloudRoute = await resolveTaskRoute(task, { kind: "cloud" }).catch(() => null);
      if (cloudRoute && (await requestCloudFallback(task.id))) {
        try {
          return await executeTask(task, input, {
            ...options,
            provider: cloudRoute.provider,
          });
        } catch (error) {
          rethrowTerminalError(error, options.signal);
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
  recovery: CompletionRecovery;
  policy?: AITaskRunOptions["requestPolicy"];
}

async function generateWithFallbacks<I, O>(
  task: AITaskDefinition<I, O>,
  input: I,
  options: AITaskRunOptions,
  ctx: GenerationContext
): Promise<AIResponse> {
  // Legacy cloud commands keep byte-identical Phase-0 behavior (design D30).
  if (ctx.provider.kind === "cloud" && task.cloudExecutor) {
    ctx.recovery.attemptCount++;
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
    ctx.capabilities?.structuredGeneration === true &&
    (ctx.provider.id !== APPLE_FOUNDATION_PROVIDER_ID ||
      appleFmSupportsNativeSchema(task.schema.nativeName));

  const request: AIRequest = {
    requestId: makeRequestId(task.id),
    systemInstruction: useNativeStructured
      ? task.systemInstruction
      : task.outputKind === "structured" && task.schema
        ? structuredSystemInstruction(task.systemInstruction, task.schema.json)
        : task.systemInstruction,
    text: ctx.built.text,
    image: ctx.built.image,
    maxOutputTokens: ctx.maxOutputTokens,
    structured: useNativeStructured,
    schemaName: useNativeStructured ? task.schema!.nativeName : undefined,
    // Structured tasks own correction; text-only tasks retain legacy transport behavior.
    taskManagedRecovery: task.outputKind === "structured",
  };

  checkRequestBudget(request, ctx);
  ctx.recovery.attemptCount++;
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

interface ValidatedOutput<O> {
  value: O;
  validationOutcome: AITaskValidationOutcome;
  response: AIResponse;
}

type OutputCheck<O> = { ok: true; value: O; validationOutcome: AITaskValidationOutcome } |
  { ok: false; errors: string[]; kind: CompletionFailureKind };

/** One validation pass; correction never recursively enters validation/recovery. */
function inspectOutput<I, O>(task: AITaskDefinition<I, O>, input: I, response: AIResponse, salvage: boolean): OutputCheck<O> {
  if (responseFailureKind(response, "schema-invalid") === "refusal") {
    return { ok: false, errors: ["provider refusal"], kind: "refusal" };
  }
  if (task.outputKind !== "structured" || !task.validate) {
    const outcome = task.validate?.(response.text, input);
    if (!outcome) return { ok: true, value: response.text as O, validationOutcome: "text" };
    if (isValidOutcome(outcome)) return { ok: true, value: outcome.value, validationOutcome: "text" };
    return { ok: false, errors: outcome.errors, kind: "schema-invalid" };
  }
  let candidate = response.structured;
  let validationOutcome: AITaskValidationOutcome = "native-structured";
  if (candidate == null) {
    const parsed = parseStrictJson(response.text);
    validationOutcome = "strict-json";
    if (isParseFailure(parsed)) {
      candidate = salvage && response.text.trim() ? repairTruncatedJson(response.text) : null;
      if (candidate == null) return { ok: false, errors: [parsed.error === "empty response" ? "empty response (provider body had no content)" : parsed.error], kind: responseFailureKind(response, "malformed-json") };
      validationOutcome = "truncated-json-salvaged";
    } else candidate = parsed.value;
  }
  const outcome = task.validate(candidate, input);
  return isValidOutcome(outcome) ? { ok: true, value: outcome.value, validationOutcome } :
    { ok: false, errors: outcome.errors, kind: responseFailureKind(response, "schema-invalid") };
}

async function validateOutput<I, O>(
  task: AITaskDefinition<I, O>, input: I, response: AIResponse,
  _options: AITaskRunOptions, ctx: GenerationContext
): Promise<ValidatedOutput<O>> {
  const checked = inspectOutput(task, input, response, true);
  if (checked.ok === true) return { ...checked, response };
  ctx.recovery.firstFailureKind = checked.kind;
  if (checked.kind === "refusal") {
    ctx.recovery.terminalFailureKind = "refusal";
    throw new AIError("SafetyBlocked", "The model refused to answer.", { code: "safety_blocked", taskId: task.id });
  }
  if (task.outputKind !== "structured" || !task.validate) throw invalidStructuredOutput(task.id, checked.errors);
  const repaired = await repairOnce(task, input, ctx, checked.errors, response);
  if (repaired.ok === true) return repaired.output;
  throw repaired.error;
}

/** Both limits are included in the source-preparation correction reserve. */
const REPAIR_REJECTED_BOUND = 2_000;
const REPAIR_ERROR_BOUND = 160;

type CorrectionResult<O> = { ok: true; output: ValidatedOutput<O> } | { ok: false; error: AIError };

async function repairOnce<I, O>(
  task: AITaskDefinition<I, O>, input: I, ctx: GenerationContext,
  errors: string[], rejected: AIResponse
): Promise<CorrectionResult<O>> {
  const truncationHint = rejected.finishReason === "length" || errors.some(e => /Unterminated string|Unexpected end|truncat/i.test(e))
    ? "\nYour previous output was CUT OFF at the output-token limit. Shorten the content (fewer or terser entries) so the JSON document completes within the limit."
    : rejected.responseKind === "reasoning-only" ? "\nReturn a compact final JSON answer within the output limit." : "";
  const excerpt = rejected.text.length > REPAIR_REJECTED_BOUND
    ? `${rejected.text.slice(0, REPAIR_REJECTED_BOUND)}\n…[truncated; ${rejected.text.length} chars total]`
    : rejected.text || "(empty response)";
  const suffix = `\n\n${REPAIR_PREAMBLE}\n${errors.slice(0, 8).map(e => `- ${e.slice(0, REPAIR_ERROR_BOUND)}`).join("\n")}${truncationHint}\n\nYour rejected response (bounded):\n${excerpt}\n${REPAIR_INSTRUCTION}`;
  const repairRequest: AIRequest = {
    requestId: makeRequestId(`${task.id}-repair`),
    systemInstruction: structuredSystemInstruction(task.systemInstruction, task.schema?.json),
    text: ctx.built.text + suffix,
    image: ctx.built.image, maxOutputTokens: ctx.maxOutputTokens,
    structured: false, taskManagedRecovery: true,
  };
  try {
    // No provider call if cancellation landed between attempts.
    if (ctx.controller.signal.aborted) throw new AIError("Cancelled", "Correction was cancelled.", { code: "cancelled" });
    if (estimateTokens(suffix) > CORRECTION_OVERHEAD_TOKENS) throw new AIError("InputTooLarge", "Correction exceeds its reserved budget.", { code: "context_too_large" });
    checkRequestBudget(repairRequest, ctx);
    ctx.recovery.attemptCount++;
    // Clear first-attempt usage; a failing provider request supplies no completion metadata.
    Object.assign(ctx.recovery, { finishReason: undefined, inputTokens: undefined, outputTokens: undefined });
    const response = await ctx.provider.generateStream(repairRequest, { signal: ctx.controller.signal, stream: false });
    Object.assign(ctx.recovery, completionMetadata(response));
    ctx.recovery.outputLimitObserved ||= response.finishReason === "length";
    const checked = inspectOutput(task, input, response, false);
    if (checked.ok === true) return { ok: true, output: { value: checked.value, response, validationOutcome: "repaired" } };
    ctx.recovery.terminalFailureKind = checked.kind;
    return { ok: false, error: checked.kind === "refusal"
      ? new AIError("SafetyBlocked", "The model refused to answer.", { code: "safety_blocked", taskId: task.id })
      : invalidStructuredOutput(task.id, checked.errors) };
  } catch (error) {
    const mapped = toAIError(error, { providerId: ctx.provider.id, taskId: task.id });
    ctx.recovery.terminalFailureKind = errorFailureKind(mapped);
    return { ok: false, error: mapped };
  }
}

function completionError(error: unknown, taskId: string, ctx: GenerationContext, timedOut: boolean, timeoutMs: number): AIError {
  let mapped = toAIError(error, { providerId: ctx.provider.id, taskId });
  if (timedOut) mapped = new AIError("GenerationFailed", `Task ${taskId} exceeded its ${timeoutMs}ms timeout.`, {
    code: "timeout", providerId: ctx.provider.id, taskId, cause: error,
  });
  ctx.recovery.terminalFailureKind ??= errorFailureKind(mapped);
  if (timedOut) ctx.recovery.terminalFailureKind = "timeout";
  return new AIError(mapped.category, mapped.message, {
    code: mapped.code, providerId: mapped.providerId, taskId: mapped.taskId,
    details: mapped.details, completion: { ...ctx.recovery }, cause: mapped,
  });
}

/** Cancellation and refusal from any fallback remain terminal. */
function rethrowTerminalError(error: unknown, signal?: AbortSignal): void {
  const terminal = toAIError(error);
  if (["Cancelled", "SafetyBlocked"].includes(terminal.category) || signal?.aborted) throw terminal;
}

function checkRequestBudget(request: AIRequest, ctx: GenerationContext): void {
  if (!ctx.policy) return;
  const input = estimateTokens(request.text) + estimateTokens(request.systemInstruction ?? "") + (request.image ? 258 : 0) + 32;
  if (input + ctx.maxOutputTokens > ctx.policy.configuredContextTokens || ctx.maxOutputTokens > ctx.policy.maxOutputTokens) {
    throw new AIError("InputTooLarge", "The complete request exceeds the selected model context.", { code: "context_too_large", providerId: ctx.provider.id });
  }
}

/** A consented fallback reuses evidence within the intersection of both policies. */
function boundedRequestPolicy(prepared: AITaskRunOptions["requestPolicy"], serving: AITaskRunOptions["requestPolicy"]): AITaskRunOptions["requestPolicy"] {
  if (!prepared || !serving) return prepared;
  return { ...prepared,
    configuredContextTokens: Math.min(prepared.configuredContextTokens, serving.configuredContextTokens),
    maxOutputTokens: Math.min(prepared.maxOutputTokens, serving.maxOutputTokens),
  };
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

/** Derive the validation-outcome class from a thrown AIError's details. */
function validationOutcomeForError(error: AIError): AITaskValidationOutcome | undefined {
  if (error.category !== "InvalidStructuredOutput") return undefined;
  if (error.completion?.terminalFailureKind === "empty-response" || error.completion?.terminalFailureKind === "reasoning-only" || error.completion?.terminalFailureKind === "tool-only") return "empty-response";
  if (error.completion?.terminalFailureKind === "output-limit") return "truncated-json";
  const details = (error.details ?? []) as string[];
  if (details.some((d) => typeof d === "string" && d.includes("empty response"))) {
    return "empty-response";
  }
  if (
    details.some((d) => typeof d === "string" && /Unterminated string|Unexpected end|truncat/i.test(d))
  ) {
    return "truncated-json";
  }
  return "invalid-structured-output";
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
  if (options.observation) {
    recordFeatureObservation({
      featureId: options.observation.featureId,
      runId: options.observation.runId,
      stage: "generation",
      level: "operational",
      outcome: error.category === "Cancelled" ? "cancelled" : "failed",
      durationMs: Date.now() - started,
      capabilityRevision: options.observation.capabilityRevision,
      providerClass: route?.provider ? normalizeProviderClass(route.provider.id) : undefined,
      modelClass: route?.servedModelClass,
      errorCategory: error.category,
      recoveryCode: error.code,
      smoke: options.observation.smoke,
    });
  }
  recordTaskDiagnostic({
    taskId: task.id,
    taskType: task.taskType ?? "prompt",
    modelClass: route?.servedModelClass,
    requestedModelClass: route?.requestedModelClass,
    providerId: route?.provider.id,
    providerKind: route?.provider.kind
      ? taskLayerProviderKind(route.provider.kind)
      : undefined,
    capabilityHash,
    retrievalCount: options.retrieval?.count ?? 0,
    chunkIds: options.retrieval?.chunkIds ?? [],
    validationOutcome: validationOutcomeForError(error),
    fallbackPath: route?.fallbackPath,
    errorCategory: error.category,
    errorCode: error.code,
    ...error.completion,
    firstTokenLatencyMs: firstTokenAt !== undefined ? firstTokenAt - started : undefined,
    totalLatencyMs: Date.now() - started,
  });
}
