/**
 * Privacy-preserving production diagnostics, evaluation records and feature
 * observations (design D8; change
 * `implement-ai-feature-operational-diagnostics`).
 *
 * The existing 50-entry task ring stays the only task-event store. Feature
 * observations add a bounded, per-feature stage summary — last outcome per
 * stage, session-local, invalidated by a capability revision change. There is
 * deliberately no second general event log.
 *
 * No source text, prompts, completions, image bytes, document identifiers,
 * endpoints, credentials or arbitrary exception strings are ever stored.
 */

import {
  FEATURE_IDS,
  type FeatureId,
} from "./features/types";
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
  /**
   * Agent runs (Phase 7, design D25): counts and outcome categories only —
   * tool args/results stay content-free (fnv1a digests live in the trace
   * ring, not here).
   */
  agentTurns?: number;
  agentToolCalls?: number;
  agentProposals?: number;
  /** End-reason category: final-answer | tool-budget | timeout | … */
  agentEndReason?: string;
  /** Route facts (change fix-learning-agent-model-routing-and-tool-orchestration). */
  agentSelectedProviderId?: string;
  agentSelectedModel?: string;
  agentServedProviderId?: string;
  agentServedModel?: string;
  agentEmptyTurns?: number;
  agentOffContractTurns?: number;
  agentRecoveryNotes?: number;
  agentRepairAttempted?: number;
  agentRepairSucceeded?: number;
  agentToolOutcomeCounts?: {
    attempted?: number;
    validated?: number;
    executed?: number;
    ok?: number;
    notFound?: number;
    notAvailable?: number;
    invalidInput?: number;
    rejected?: number;
    errored?: number;
  };
  timestamp: number;
}

const diagnosticLog: OnDeviceTaskDiagnostic[] = [];
const MAX_DIAGNOSTIC_ENTRIES = 50;

/**
 * Counter-only whitelist for the agent tool outcome ledger: only the known
 * numeric keys survive; anything else (content, credentials, arbitrary keys)
 * is dropped by construction.
 */
function sanitizeToolCounts(
  counts: OnDeviceTaskDiagnostic["agentToolOutcomeCounts"]
): OnDeviceTaskDiagnostic["agentToolOutcomeCounts"] | undefined {
  if (!counts) return undefined;
  const safe: NonNullable<OnDeviceTaskDiagnostic["agentToolOutcomeCounts"]> = {};
  for (const key of [
    "attempted",
    "validated",
    "executed",
    "ok",
    "notFound",
    "notAvailable",
    "invalidInput",
    "rejected",
    "errored",
  ] as const) {
    const value = counts[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      safe[key] = Math.round(value);
    }
  }
  return safe;
}

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
    agentTurns: entry.agentTurns,
    agentToolCalls: entry.agentToolCalls,
    agentProposals: entry.agentProposals,
    agentEndReason: entry.agentEndReason,
    agentSelectedProviderId: entry.agentSelectedProviderId,
    agentSelectedModel: entry.agentSelectedModel,
    agentServedProviderId: entry.agentServedProviderId,
    agentServedModel: entry.agentServedModel,
    agentEmptyTurns: entry.agentEmptyTurns,
    agentOffContractTurns: entry.agentOffContractTurns,
    agentRecoveryNotes: entry.agentRecoveryNotes,
    agentRepairAttempted: entry.agentRepairAttempted,
    agentRepairSucceeded: entry.agentRepairSucceeded,
    agentToolOutcomeCounts: sanitizeToolCounts(entry.agentToolOutcomeCounts),
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

/* ------------------------------------------------------------------------- */
/* Feature observations (D0)                                                 */
/* ------------------------------------------------------------------------- */

export const FEATURE_STAGES = [
  "preflight",
  "retrieval",
  "generation",
  "validation",
  "preview",
  "persistence",
  "navigation",
] as const;

export type FeatureStage = (typeof FEATURE_STAGES)[number];

export type FeatureObservationLevel = "static" | "dependency" | "operational";

export type FeatureObservationOutcome =
  | "success"
  | "failed"
  | "cancelled"
  | "skipped"
  | "incomplete";

export interface FeatureObservation {
  readonly featureId: FeatureId;
  readonly runId: string;
  readonly stage: FeatureStage;
  readonly level: FeatureObservationLevel;
  readonly outcome: FeatureObservationOutcome;
  readonly durationMs: number;
  readonly timestamp: number;
  readonly capabilityRevision: string;
  /** Finite provider class, never a raw endpoint or display name. */
  readonly providerClass?: string;
  readonly modelClass?: string;
  readonly errorCategory?: string;
  readonly recoveryCode?: string;
  /** True when the observation came from an explicit fixture smoke run. */
  readonly smoke?: boolean;
}

export interface FeatureStageSummary {
  readonly stage: FeatureStage;
  readonly level: FeatureObservationLevel;
  readonly outcome: FeatureObservationOutcome;
  readonly timestamp: number;
  readonly durationMs: number;
  readonly errorCategory?: string;
  readonly recoveryCode?: string;
}

export interface FeatureSmokeSummary {
  readonly outcome: FeatureObservationOutcome;
  readonly timestamp: number;
  readonly capabilityRevision: string;
  readonly stages: readonly FeatureStage[];
}

export interface FeatureOperationalSummary {
  readonly featureId: FeatureId;
  /** Last terminal outcome across all stages (success/failed/cancelled). */
  readonly lastOutcome?: FeatureObservationOutcome;
  readonly lastOutcomeAt?: number;
  readonly lastSuccessAt?: number;
  readonly lastErrorAt?: number;
  readonly lastErrorCategory?: string;
  readonly lastRecoveryCode?: string;
  /**
   * Revision the observations were recorded under. When it differs from the
   * current revision the evidence is stale, not a current success.
   */
  readonly capabilityRevision?: string;
  readonly providerClass?: string;
  readonly modelClass?: string;
  readonly stages: Readonly<Partial<Record<FeatureStage, FeatureStageSummary>>>;
  readonly smoke?: FeatureSmokeSummary;
}

const featureSummaries = new Map<FeatureId, FeatureOperationalSummary>();
const MAX_FEATURE_SUMMARIES = FEATURE_IDS.length;

function isFeatureId(value: unknown): value is FeatureId {
  return typeof value === "string" && (FEATURE_IDS as readonly string[]).includes(value);
}

function isStage(value: unknown): value is FeatureStage {
  return typeof value === "string" && (FEATURE_STAGES as readonly string[]).includes(value);
}

function safeString(value: unknown, maxLength = 64): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  // Enum-like fields only: reject anything that could carry a sentence, URL,
  // path, credential or identifier with whitespace/punctuation payloads.
  if (value.length > maxLength) return undefined;
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) return undefined;
  return value;
}

function safeDuration(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0;
}

const PROVIDER_CLASSES = new Set([
  "android-nano",
  "apple-native",
  "windows-system",
  "foundry-local",
  "ollama-local",
  "configured-provider",
  "configured-external",
  "local-model",
  "unknown",
]);

const MODEL_CLASSES = new Set(["fast", "full", "reasoning", "embedding"]);

const FEATURE_ERROR_CATEGORIES = new Set([
  "Cancelled",
  "ModelUnavailable",
  "ModelDownloadRequired",
  "Busy",
  "SafetyBlocked",
  "CapabilityUnavailable",
  "VisionUnavailable",
  "InputTooLarge",
  "InvalidStructuredOutput",
  "GenerationFailed",
  "NetworkError",
  "AuthenticationError",
  "RateLimited",
  "QuotaExceeded",
  "Timeout",
  "NotFound",
  "ValidationFailed",
  "PermissionDenied",
  "Unknown",
]);

function safeErrorCategory(value: unknown): string | undefined {
  return typeof value === "string" && FEATURE_ERROR_CATEGORIES.has(value)
    ? value
    : undefined;
}

function safeProviderClass(value: unknown): string | undefined {
  return typeof value === "string" && PROVIDER_CLASSES.has(value) ? value : undefined;
}

function safeModelClass(value: unknown): string | undefined {
  return typeof value === "string" && MODEL_CLASSES.has(value) ? value : undefined;
}

/**
 * Record one stage observation. Invalid feature/stage values are dropped (a
 * caller bug must not create a phantom feature row). Values are normalized to
 * enum-like tokens; the raw strings never reach the export.
 */
export function recordFeatureObservation(
  input: Omit<FeatureObservation, "timestamp" | "durationMs"> & {
    timestamp?: number;
    durationMs?: number;
  }
): FeatureObservation | undefined {
  if (!isFeatureId(input.featureId) || !isStage(input.stage)) return undefined;

  const observation: FeatureObservation = {
    featureId: input.featureId,
    runId: safeString(input.runId, 96) ?? "run-unknown",
    stage: input.stage,
    level: input.level,
    outcome: input.outcome,
    durationMs: safeDuration(input.durationMs),
    timestamp: typeof input.timestamp === "number" ? input.timestamp : Date.now(),
    capabilityRevision: safeString(input.capabilityRevision, 96) ?? "unknown",
    providerClass: safeProviderClass(input.providerClass),
    modelClass: safeModelClass(input.modelClass),
    errorCategory: safeErrorCategory(input.errorCategory),
    recoveryCode: safeString(input.recoveryCode, 64),
    smoke: input.smoke === true || undefined,
  };

  const previous = featureSummaries.get(observation.featureId);
  const stages = { ...(previous?.stages ?? {}) };
  stages[observation.stage] = {
    stage: observation.stage,
    level: observation.level,
    outcome: observation.outcome,
    timestamp: observation.timestamp,
    durationMs: observation.durationMs,
    errorCategory: observation.errorCategory,
    recoveryCode: observation.recoveryCode,
  };

  const isTerminal = observation.stage === "persistence" || observation.stage === "navigation";
  const failed = observation.outcome === "failed";
  const success =
    observation.outcome === "success" && observation.level === "operational";

  const next: FeatureOperationalSummary = {
    featureId: observation.featureId,
    lastOutcome:
      isTerminal || observation.stage === "generation"
        ? observation.outcome
        : previous?.lastOutcome,
    lastOutcomeAt:
      isTerminal || observation.stage === "generation"
        ? observation.timestamp
        : previous?.lastOutcomeAt,
    lastSuccessAt: success ? observation.timestamp : previous?.lastSuccessAt,
    lastErrorAt: failed ? observation.timestamp : previous?.lastErrorAt,
    lastErrorCategory: failed ? observation.errorCategory : previous?.lastErrorCategory,
    lastRecoveryCode: failed ? observation.recoveryCode : previous?.lastRecoveryCode,
    capabilityRevision: observation.capabilityRevision,
    providerClass: observation.providerClass ?? previous?.providerClass,
    modelClass: observation.modelClass ?? previous?.modelClass,
    stages,
    smoke:
      observation.smoke === true
        ? {
            outcome: observation.outcome,
            timestamp: observation.timestamp,
            capabilityRevision: observation.capabilityRevision,
            stages: stagesForSmoke(previous?.smoke, observation),
          }
        : previous?.smoke,
  };

  featureSummaries.set(observation.featureId, next);
  while (featureSummaries.size > MAX_FEATURE_SUMMARIES) {
    const oldest = featureSummaries.keys().next().value as FeatureId | undefined;
    if (!oldest) break;
    featureSummaries.delete(oldest);
  }
  return observation;
}

function stagesForSmoke(
  previous: FeatureSmokeSummary | undefined,
  observation: FeatureObservation
): FeatureStage[] {
  const set = new Set<FeatureStage>(previous?.stages ?? []);
  set.add(observation.stage);
  return [...set];
}

export interface FeatureSummaryView extends FeatureOperationalSummary {
  /** True when the recorded evidence predates the current capability revision. */
  readonly stale: boolean;
  /** True when no observation exists this session. */
  readonly unknown: boolean;
}

/**
 * Wrap one production stage so success/failure/cancellation is recorded with
 * a duration and safe error category. Feature owners call this at their real
 * preview/persistence/navigation boundaries; it never captures return values
 * or payloads.
 */
export async function observeFeatureStage<T>(
  meta: {
    featureId: FeatureId;
    runId: string;
    stage: FeatureStage;
    level?: FeatureObservationLevel;
    capabilityRevision: string;
    providerClass?: string;
    modelClass?: string;
    smoke?: boolean;
    recoveryCode?: string;
  },
  work: () => Promise<T> | T
): Promise<T> {
  const started = Date.now();
  try {
    const value = await work();
    recordFeatureObservation({
      ...meta,
      level: meta.level ?? "operational",
      outcome: "success",
      durationMs: Date.now() - started,
    });
    return value;
  } catch (error) {
    const cancelled =
      (error as { category?: string } | undefined)?.category === "Cancelled" ||
      (error as { name?: string } | undefined)?.name === "AbortError";
    recordFeatureObservation({
      ...meta,
      level: meta.level ?? "operational",
      outcome: cancelled ? "cancelled" : "failed",
      durationMs: Date.now() - started,
      errorCategory: cancelled
        ? "Cancelled"
        : typeof (error as { category?: string })?.category === "string"
          ? (error as { category: string }).category
          : "GenerationFailed",
      recoveryCode: meta.recoveryCode,
    });
    throw error;
  }
}

/** Current, revision-aware view of one feature's operational evidence. */
export function getFeatureSummary(
  featureId: FeatureId,
  currentRevision?: string
): FeatureSummaryView | undefined {
  const summary = featureSummaries.get(featureId);
  if (!summary) return undefined;
  return {
    ...summary,
    stale:
      currentRevision !== undefined &&
      summary.capabilityRevision !== undefined &&
      summary.capabilityRevision !== currentRevision,
    unknown: false,
  };
}

/** All summaries observed this session (bounded to the ten features). */
export function getFeatureSummaries(): readonly FeatureOperationalSummary[] {
  return [...featureSummaries.values()];
}

export function clearFeatureDiagnostics(): void {
  featureSummaries.clear();
}

/** Clear task records and feature summaries together (one user action). */
export function clearAllDiagnostics(): void {
  clearTaskDiagnostics();
  clearFeatureDiagnostics();
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
 * Minimal debug entry point for the settings → AI → diagnostics panel:
 * aggregate, content-free statistics over the ring buffer.
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
