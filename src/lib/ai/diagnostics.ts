/**
 * Privacy-preserving production diagnostics and evaluation records
 * (design D8).
 *
 * Contains only task ids, provider/model metadata, model-class and capability
 * hashes, counts, latencies, retrieval references, validation outcomes, and
 * error categories. Excludes all source text, prompts, completions, image
 * bytes, and data URLs — the no-user-content rule is enforced by the explicit
 * field allowlist in `recordTaskDiagnostic`.
 */

import type { AITaskFallbackPath, AITaskModelClass, AITaskType, AITaskValidationOutcome } from "./tasks/types";

export interface OnDeviceTaskDiagnostic {
  taskId: string;
  taskType: AITaskType;
  /** Served model class (router outcome). */
  modelClass?: AITaskModelClass;
  /** Class the task requested (differs under reasoning fallback). */
  requestedModelClass?: AITaskModelClass;
  providerId?: string;
  providerKind?: "ondevice" | "cloud";
  /** Stable hash of the capability snapshot used for the run. */
  capabilityHash?: string;
  /** Retrieved chunk count feeding the prompt (0 until Phase 3). */
  retrievalCount?: number;
  /** Retrieved chunk ids (ids only, never chunk text). */
  chunkIds?: string[];
  /** Outcome of the structured-output validation step. */
  validationOutcome?: AITaskValidationOutcome;
  /** Which fallback executed, if any. */
  fallbackPath?: AITaskFallbackPath;
  /** Unified error category (design D6) when the run failed. */
  errorCategory?: string;
  baseModelName?: string;
  inputTokens?: number;
  outputTokens?: number;
  tokenLimit?: number;
  firstTokenLatencyMs?: number;
  totalLatencyMs?: number;
  finishReason?: string;
  errorCode?: string;
  grounded?: boolean;
  accepted?: boolean;
  timestamp: number;
}

const diagnosticLog: OnDeviceTaskDiagnostic[] = [];
const MAX_DIAGNOSTIC_ENTRIES = 50;

/**
 * Record a privacy-sanitized task diagnostic. Only the fields declared on
 * `OnDeviceTaskDiagnostic` are copied — anything else (notably prompt or
 * completion text) is dropped by construction.
 */
export function recordTaskDiagnostic(
  entry: Omit<OnDeviceTaskDiagnostic, "timestamp">
): OnDeviceTaskDiagnostic {
  const sanitized: OnDeviceTaskDiagnostic = {
    taskId: entry.taskId,
    taskType: entry.taskType,
    modelClass: entry.modelClass,
    requestedModelClass: entry.requestedModelClass,
    providerId: entry.providerId,
    providerKind: entry.providerKind,
    capabilityHash: entry.capabilityHash,
    retrievalCount: entry.retrievalCount,
    chunkIds: entry.chunkIds,
    validationOutcome: entry.validationOutcome,
    fallbackPath: entry.fallbackPath,
    errorCategory: entry.errorCategory,
    baseModelName: entry.baseModelName,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    tokenLimit: entry.tokenLimit,
    firstTokenLatencyMs: entry.firstTokenLatencyMs,
    totalLatencyMs: entry.totalLatencyMs,
    finishReason: entry.finishReason,
    errorCode: entry.errorCode,
    grounded: entry.grounded,
    accepted: entry.accepted,
    timestamp: Date.now(),
  };

  diagnosticLog.push(sanitized);
  if (diagnosticLog.length > MAX_DIAGNOSTIC_ENTRIES) {
    diagnosticLog.shift();
  }

  return sanitized;
}

/**
 * Get recorded task diagnostics (read-only).
 */
export function getTaskDiagnostics(): readonly OnDeviceTaskDiagnostic[] {
  return diagnosticLog;
}

/**
 * Clear recorded diagnostics.
 */
export function clearTaskDiagnostics(): void {
  diagnosticLog.length = 0;
}

export interface AiDiagnosticsDebugSummary {
  total: number;
  byTaskId: Record<string, number>;
  byErrorCategory: Record<string, number>;
  byValidationOutcome: Record<string, number>;
  /** Mean total latency of successful runs, when any exist. */
  meanTotalLatencyMs?: number;
  /** The most recent entries, oldest first. */
  recent: readonly OnDeviceTaskDiagnostic[];
}

/**
 * Minimal debug entry point for the future settings → AI → diagnostics panel
 * (task 1.13): aggregate, content-free statistics over the ring buffer.
 */
export function getAiDiagnosticsDebugSummary(): AiDiagnosticsDebugSummary {
  const byTaskId: Record<string, number> = {};
  const byErrorCategory: Record<string, number> = {};
  const byValidationOutcome: Record<string, number> = {};
  let latencySum = 0;
  let latencyCount = 0;

  for (const entry of diagnosticLog) {
    byTaskId[entry.taskId] = (byTaskId[entry.taskId] ?? 0) + 1;
    if (entry.errorCategory) {
      byErrorCategory[entry.errorCategory] = (byErrorCategory[entry.errorCategory] ?? 0) + 1;
    }
    if (entry.validationOutcome) {
      byValidationOutcome[entry.validationOutcome] =
        (byValidationOutcome[entry.validationOutcome] ?? 0) + 1;
    }
    if (entry.totalLatencyMs !== undefined && !entry.errorCategory) {
      latencySum += entry.totalLatencyMs;
      latencyCount += 1;
    }
  }

  return {
    total: diagnosticLog.length,
    byTaskId,
    byErrorCategory,
    byValidationOutcome,
    meanTotalLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : undefined,
    recent: diagnosticLog,
  };
}
