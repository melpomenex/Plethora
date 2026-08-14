/**
 * Privacy-preserving production diagnostics and evaluation records.
 * Contains only task, model metadata, counts, latency, and error codes.
 * Excludes all source text, prompts, completions, image bytes, and data URLs.
 */

export interface OnDeviceTaskDiagnostic {
  taskId: string;
  taskType: "prompt" | "summarization" | "image-prompt" | "passage-qa" | "extract-analysis" | "review-hint";
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
 * Record a privacy-sanitized task diagnostic.
 */
export function recordTaskDiagnostic(
  entry: Omit<OnDeviceTaskDiagnostic, "timestamp">
): OnDeviceTaskDiagnostic {
  const sanitized: OnDeviceTaskDiagnostic = {
    taskId: entry.taskId,
    taskType: entry.taskType,
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
