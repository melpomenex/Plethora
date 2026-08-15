/**
 * `AITaskDefinition` — the unit of AI work in the task layer (design D4).
 *
 * A task owns its prompt text (static `systemInstruction` + `buildInput`);
 * prompts never live in UI components. `runTask(task, input)` handles provider
 * resolution, capability gating, token budgeting, streaming, structured-output
 * validation (with the strict-JSON fallback + one repair retry), diagnostics,
 * cancellation, and in-flight coalescing.
 */

import type { OnDeviceRequirement } from "../onDeviceAI";
import type { AIImagePayload, AIProvider } from "../providers/types";
import type { ValidationOutcome } from "../schemas/common";

export type { ValidationOutcome };

export type AITaskId = string;
export type AITaskModelClass = "fast" | "full" | "reasoning";
export type AITaskOutputKind = "text" | "structured";

/** Diagnostic task families (kept compatible with the existing union). */
export type AITaskType =
  | "prompt"
  | "summarization"
  | "image-prompt"
  | "passage-qa"
  | "extract-analysis"
  | "review-hint";

export interface AITaskBuiltInput {
  text: string;
  image?: AIImagePayload;
}

export interface AISchemaDescriptor {
  /** Canonical schema name (PascalCase, matches the Kotlin envelope). */
  name: string;
  /** Native wire name for schema-compiled structured output. */
  nativeName: string;
  /** Compact JSON shape for strict-JSON prompt mode. */
  json: string;
}

export interface AITaskRunOptions {
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
  onRetry?: (attempt: number, delayMs: number) => void;
  /**
   * Logical target of the run; keys in-flight coalescing. Defaults to a hash
   * of the built input so duplicate calls on the same content share a run.
   */
  targetId?: string;
  /**
   * Force the provider kind. Callers that already resolved availability
   * (`runAiAction` / legacy adapters) pin the kind so `runTask` does not
   * second-guess the resolution; failures surface as typed errors for the
   * caller's fallback logic.
   */
  kind?: "ondevice" | "cloud";
  /** Explicit provider injection (tests, fake providers). */
  provider?: AIProvider;
  /** Overrides the task's default output-token ceiling. */
  maxOutputTokens?: number;
  /** Overrides the task's timeout. 0 disables. */
  timeoutMs?: number;
  /** Overrides the task's streaming preference. */
  streaming?: boolean;
  /** Retrieval provenance recorded in diagnostics (Phase 3+). */
  retrieval?: { count: number; chunkIds: string[] };
}

export interface AITaskDefinition<I = unknown, O = unknown> {
  /** Stable task id, e.g. "passage-qa" (also the diagnostics task id). */
  id: AITaskId;
  /** Diagnostic family. */
  taskType: AITaskType;
  /** Router class (design D3). */
  modelClass: AITaskModelClass;
  /**
   * Static instruction prefix — identical across invocations of the task so
   * the provider can reuse a cached KV prefix. MUST include the untrusted
   * containment clause; dynamic values belong in the user turn.
   */
  systemInstruction: string;
  /** Builds the user turn; all untrusted content inside blocks (D9). */
  buildInput(input: I): AITaskBuiltInput;
  outputKind: AITaskOutputKind;
  /** Declared structured envelope (enables validation + JSON fallback). */
  schema?: AISchemaDescriptor;
  /** Validates raw output; fail-closed. Receives the original input. */
  validate?(output: unknown, input: I): ValidationOutcome<O>;
  /** Output-token ceiling. */
  maxOutputTokens: number;
  /** Hard wall-clock timeout for the whole run. */
  timeoutMs: number;
  /** Task executed instead when no reasoning-capable provider exists (D3). */
  reasoningFallback?: AITaskId;
  /** Native feature gate used by availability resolution (default prompt). */
  requirement?: OnDeviceRequirement;
  /** Default streaming preference (non-streaming native prompt when false). */
  streaming?: boolean;
  /**
   * Hard vision gate: refuse to run without the vision capability. Legacy
   * image tasks that rely on the bridge's own error leave this unset in
   * Phase 0; new vision tasks set it.
   */
  requiresVision?: boolean;
  /**
   * Token-budget policy. "estimate" rejects inputs whose estimated size plus
   * output exceeds the provider context (estimation only — no blocking IPC,
   * per the nano fast-path finding). "pre-budgeted" skips the gate because
   * the adapter already fit the input (e.g. `fitPassage`).
   */
  budgetPolicy?: "estimate" | "pre-budgeted";
  /**
   * Legacy cloud executor preserving byte-identical pre-task-layer cloud
   * behavior (design D30). Used when the router resolves a cloud provider;
   * new tasks use `CloudProvider.generateStream` instead. May return a plain
   * string (command output) or an envelope.
   */
  cloudExecutor?(
    input: I,
    ctx: { signal?: AbortSignal }
  ): Promise<string | { text: string; baseModelName?: string }>;
}

/** Diagnostics-visible outcome of the output-validation step. */
export type AITaskValidationOutcome =
  | "text"
  | "native-structured"
  | "strict-json"
  | "repaired"
  | "invalid-structured-output";

export type AITaskFallbackPath = "none" | "cloud-fallback" | "reasoning-fallback";

export interface AITaskResult<O = unknown> {
  taskId: AITaskId;
  /** Validated output: text for text tasks, the envelope for structured. */
  output: O;
  /** Raw text of the final (possibly repaired) response. */
  text: string;
  providerId: string;
  providerKind: "ondevice" | "cloud";
  requestedModelClass: AITaskModelClass;
  servedModelClass: AITaskModelClass;
  fallbackPath: AITaskFallbackPath;
  validationOutcome: AITaskValidationOutcome;
  baseModelName?: string;
  usage?: { inputTokens?: number; outputTokens?: number; tokenLimit?: number };
}
