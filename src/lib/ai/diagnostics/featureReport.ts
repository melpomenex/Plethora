/**
 * Redacted, schema-versioned diagnostics export (D0 task 4.1).
 *
 * The report is REBUILT from finite allowlisted projections — it is never
 * `JSON.stringify` of a store, and it never regex-redacts arbitrary strings.
 * Unknown values are omitted or mapped to `unknown`, so a credential, path,
 * endpoint, document title, prompt, completion, error message or model string
 * cannot survive in any branch.
 *
 * No network calls and no inference happen here. Callers present the report
 * for preview and only then offer a local download.
 */

import type { OnDeviceTaskDiagnostic } from "../diagnostics";
import type {
  FeatureDependency,
  FeatureId,
  FeatureOperationReadiness,
  FeatureReadiness,
  FeatureStatus,
} from "../features/types";
import { FEATURE_IDS } from "../features/types";
import type {
  FeatureObservationOutcome,
  FeatureOperationalSummary,
  FeatureStage,
} from "../diagnostics";
import { FEATURE_STAGES } from "../diagnostics";

export const DIAGNOSTICS_REPORT_SCHEMA_VERSION = "ai-diagnostics-report-v1";
export const MAX_REPORT_BYTES = 256 * 1024;
const MAX_TASK_ENTRIES = 50;

export type PlatformFamily = "android" | "ios" | "windows" | "macos" | "linux" | "web" | "unknown";

export interface RedactedDiagnosticsReportInput {
  readonly appVersion: string;
  readonly platformFamily: PlatformFamily;
  readonly capabilityRevision?: string;
  readonly taskDiagnostics: readonly OnDeviceTaskDiagnostic[];
  readonly featureReadiness: readonly FeatureReadiness[];
  readonly featureSummaries: readonly FeatureOperationalSummary[];
  readonly currentRevision?: string;
  readonly now?: number;
}

export interface RedactedTaskEntry {
  readonly taskId: string;
  readonly taskType: string;
  readonly modelClass?: string;
  readonly requestedModelClass?: string;
  readonly providerClass: string;
  readonly providerKind?: "ondevice" | "cloud";
  readonly capabilityHash?: string;
  readonly retrievalCount?: number;
  readonly validationOutcome?: string;
  readonly fallbackPath?: string;
  readonly errorCategory?: string;
  readonly errorCode?: string;
  readonly grounded?: boolean;
  readonly accepted?: boolean;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly tokenLimit?: number;
  readonly firstTokenLatencyMs?: number;
  readonly totalLatencyMs?: number;
  readonly agentTurns?: number;
  readonly agentToolCalls?: number;
  readonly agentProposals?: number;
  readonly agentEndReason?: string;
  readonly timestamp: number;
}

export interface RedactedFeatureEntry {
  readonly featureId: FeatureId;
  readonly enabled: boolean;
  readonly status: FeatureStatus;
  readonly checkedAt: number | null;
  readonly dependencyRevisionPresent: boolean;
  readonly dependencies: ReadonlyArray<{ code: string; state: string }>;
  readonly operations: ReadonlyArray<{
    operationId: string;
    status: FeatureStatus;
    dependencies: ReadonlyArray<{ code: string; state: string }>;
  }>;
  readonly providerClass?: string;
  readonly destination?: string;
  readonly limitations: readonly string[];
  readonly recoveryTargets: readonly string[];
  readonly evidence?: {
    lastOutcome?: FeatureObservationOutcome;
    lastSuccessAt?: number;
    lastErrorAt?: number;
    lastErrorCategory?: string;
    lastRecoveryCode?: string;
    stale: boolean;
    stages: ReadonlyArray<{ stage: FeatureStage; outcome: FeatureObservationOutcome; level: string }>;
    smoke?: { outcome: FeatureObservationOutcome; stages: readonly FeatureStage[] } | null;
  };
}

export interface RedactedDiagnosticsReport {
  readonly schemaVersion: typeof DIAGNOSTICS_REPORT_SCHEMA_VERSION;
  readonly generatedAt: number;
  readonly app: { version: string; platformFamily: PlatformFamily };
  readonly scope: "session";
  readonly notes: readonly string[];
  readonly capabilityRevision?: string;
  readonly features: readonly RedactedFeatureEntry[];
  readonly tasks: readonly RedactedTaskEntry[];
  readonly truncation: {
    readonly tasksOmitted: number;
    readonly featuresOmitted: number;
    readonly truncated: boolean;
  };
}

const KNOWN_PROVIDER_IDS: Readonly<Record<string, string>> = {
  "ondevice-gemini-nano": "android-nano",
  "ondevice-apple-foundation": "apple-native",
  "ondevice-apple-coreai": "apple-native",
  "ondevice-windows-system": "windows-system",
  "ondevice-foundry-local": "foundry-local",
  "local-model": "local-model",
  "local-decision-engine": "local-model",
  "cloud-llm": "configured-provider",
};

/**
 * Finite task-id allowlist. A task id is a code constant, but the diagnostic
 * ring is a plain array — a caller bug could put arbitrary text there. Only
 * known ids survive; everything else maps to `other`.
 */
const KNOWN_TASK_IDS = new Set([
  "agent-runner",
  "ask-library",
  "ask-plethora",
  "assess-answer",
  "assess-answer-full",
  "conversational-follow-up",
  "daqe-decision",
  "extract-article-summary",
  "extract-key-points",
  "extract-study-questions",
  "extract-suggest-tags",
  "flashcard-generation",
  "image-cards",
  "image-describe",
  "image-occlusions",
  "learn-this",
  "occlusion-freeform-regions",
  "occlusion-label-selection",
  "passage-classification",
  "passage-explain-detailed",
  "passage-explain-simple",
  "passage-explain-study-note",
  "passage-key-terms",
  "passage-qa",
  "passage-simplify",
  "passage-summarize",
  "prerequisite-analysis",
  "recall-question",
  "smart-tagging",
  "studio-explain-card",
  "studio-review-hint",
  "tutor-turn",
  "tutor-turn-full",
  "workflow-key-points",
  "workflow-qa",
  "workflow-simplify",
  "workflow-summarize",
  "workflow-title",
]);

const KNOWN_ERROR_CODES = new Set([
  "cancelled",
  "context_too_large",
  "empty_completion",
  "engine_unavailable",
  "engine_unreachable",
  "feature_disabled",
  "feature_unavailable",
  "generation_failed",
  "inference_failed",
  "invalid_argument",
  "invalid_structured_output",
  "model_downloadable",
  "model_downloading",
  "model_unavailable",
  "not_found",
  "parse_failed",
  "permission_denied",
  "platform_unsupported",
  "provider_offline",
  "quota_exceeded",
  "runtime_unavailable",
  "safety_blocked",
  "storage_unavailable",
  "timeout",
  "wrong_rag_namespace",
]);

/** Recovery codes are app-defined constants; anything else is dropped. */
const KNOWN_RECOVERY_CODES = new Set([
  "smoke_cancelled",
  "smoke_consent_denied",
  "smoke_failed",
  "smoke_timeout",
  "preview_invalid",
  "preview_grounding_failed",
  "preview_duplicate_unavailable",
  "save_failed",
  "save_partial",
  "provenance_repair",
  "source_stale",
  "source_removed",
  "index_not_ready",
  "provider_unavailable",
  "consent_required",
  "cancelled",
  "unknown",
]);

const ERROR_CATEGORY_ALLOWLIST = new Set([
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

const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

function safeToken(value: unknown, fallback?: string): string | undefined {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) return fallback;
  return value;
}

function safeTaskId(value: unknown): string {
  return typeof value === "string" && KNOWN_TASK_IDS.has(value) ? value : "other";
}

const TASK_TYPES = new Set([
  "prompt",
  "summarization",
  "image-prompt",
  "passage-qa",
  "extract-analysis",
  "review-hint",
]);

const MODEL_CLASSES = new Set(["fast", "full", "reasoning"]);
const VALIDATION_OUTCOMES = new Set([
  "text",
  "native-structured",
  "strict-json",
  "truncated-json-salvaged",
  "repaired",
  "invalid-structured-output",
]);
const FALLBACK_PATHS = new Set(["none", "cloud-fallback", "reasoning-fallback"]);
const AGENT_END_REASONS = new Set([
  "final-answer",
  "tool-budget",
  "proposal-budget",
  "timeout",
  "retrieval-hops",
  "loop-detected",
  "turn-budget",
  "cancelled",
  "invalid-turn",
  "error",
]);

function oneOf(value: unknown, allowed: ReadonlySet<string>): string | undefined {
  return typeof value === "string" && allowed.has(value) ? value : undefined;
}

export function normalizeProviderClass(providerId: unknown): string {
  if (typeof providerId !== "string") return "unknown";
  return KNOWN_PROVIDER_IDS[providerId] ?? "unknown";
}

export function normalizeErrorCategory(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return ERROR_CATEGORY_ALLOWLIST.has(value) ? value : "Unknown";
}

export function normalizeErrorCode(value: unknown): string | undefined {
  return typeof value === "string" && KNOWN_ERROR_CODES.has(value) ? value : undefined;
}

function normalizeRecoveryCode(value: unknown): string | undefined {
  return typeof value === "string" && KNOWN_RECOVERY_CODES.has(value) ? value : undefined;
}

function normalizeTask(task: OnDeviceTaskDiagnostic): RedactedTaskEntry {
  return {
    taskId: safeTaskId(task.taskId),
    taskType: oneOf(task.taskType, TASK_TYPES) ?? "other",
    modelClass: oneOf(task.modelClass, MODEL_CLASSES) as RedactedTaskEntry["modelClass"],
    requestedModelClass: oneOf(
      task.requestedModelClass,
      MODEL_CLASSES
    ) as RedactedTaskEntry["requestedModelClass"],
    providerClass: normalizeProviderClass(task.providerId),
    providerKind: task.providerKind,
    capabilityHash: safeToken(task.capabilityHash),
    retrievalCount: typeof task.retrievalCount === "number" ? task.retrievalCount : undefined,
    validationOutcome: oneOf(task.validationOutcome, VALIDATION_OUTCOMES),
    fallbackPath: oneOf(task.fallbackPath, FALLBACK_PATHS),
    errorCategory: normalizeErrorCategory(task.errorCategory),
    errorCode: normalizeErrorCode(task.errorCode),
    grounded: task.grounded,
    accepted: task.accepted,
    inputTokens: task.inputTokens,
    outputTokens: task.outputTokens,
    tokenLimit: task.tokenLimit,
    firstTokenLatencyMs: task.firstTokenLatencyMs,
    totalLatencyMs: task.totalLatencyMs,
    agentTurns: task.agentTurns,
    agentToolCalls: task.agentToolCalls,
    agentProposals: task.agentProposals,
    agentEndReason: oneOf(task.agentEndReason, AGENT_END_REASONS),
    timestamp: task.timestamp,
  };
}

function redactDependencies(deps: readonly FeatureDependency[]): RedactedFeatureEntry["dependencies"] {
  return deps.map((dep) => ({ code: dep.code, state: dep.state }));
}

function redactOperations(
  operations: readonly FeatureOperationReadiness[]
): RedactedFeatureEntry["operations"] {
  return operations.map((operation) => ({
    operationId: operation.operationId,
    status: operation.status,
    dependencies: redactDependencies(operation.dependencies),
  }));
}

function redactFeature(
  row: FeatureReadiness,
  summary: FeatureOperationalSummary | undefined,
  currentRevision: string | undefined
): RedactedFeatureEntry {
  const stages = summary
    ? FEATURE_STAGES.flatMap((stage) => {
        const entry = summary.stages[stage];
        return entry
          ? [{ stage, outcome: entry.outcome, level: entry.level }]
          : [];
      })
    : [];

  return {
    featureId: row.featureId,
    enabled: row.enabled,
    status: row.status,
    checkedAt: row.checkedAt,
    dependencyRevisionPresent: row.dependencyRevision.length > 0,
    dependencies: redactDependencies(row.dependencies),
    operations: redactOperations(row.operations),
    providerClass: row.provider?.providerClass,
    destination: row.provider?.destination,
    limitations: [...row.limitations],
    recoveryTargets: row.recoveryActions.map((action) => action.targetId),
    evidence: summary
      ? {
          lastOutcome: summary.lastOutcome,
          lastSuccessAt: summary.lastSuccessAt,
          lastErrorAt: summary.lastErrorAt,
          lastErrorCategory: normalizeErrorCategory(summary.lastErrorCategory),
          lastRecoveryCode: normalizeRecoveryCode(summary.lastRecoveryCode),
          stale:
            currentRevision !== undefined &&
            summary.capabilityRevision !== undefined &&
            summary.capabilityRevision !== currentRevision,
          stages,
          smoke: summary.smoke
            ? { outcome: summary.smoke.outcome, stages: [...summary.smoke.stages] }
            : null,
        }
      : undefined,
  };
}

/**
 * Build the report object. Task entries are newest-first and capped; feature
 * rows are the ten registry features only.
 */
export function buildRedactedDiagnosticsReport(
  input: RedactedDiagnosticsReportInput
): RedactedDiagnosticsReport {
  const notes = [
    "Session-local evidence only; execution history is not persisted across restarts.",
    "Evidence is scoped to the observed stages; a successful generation is not proof of preview, persistence or navigation.",
    "No source text, prompts, completions, identifiers, endpoints, credentials or raw exceptions are included.",
  ];

  const orderedTasks = [...input.taskDiagnostics].sort((a, b) => b.timestamp - a.timestamp);
  const tasks = orderedTasks.slice(0, MAX_TASK_ENTRIES).map(normalizeTask);

  const summariesById = new Map(input.featureSummaries.map((s) => [s.featureId, s]));
  const rowsById = new Map(input.featureReadiness.map((row) => [row.featureId, row]));
  const features = FEATURE_IDS.map((featureId) => {
    const row = rowsById.get(featureId);
    if (!row) {
      // A feature that has never been evaluated still appears, never as ready.
      const placeholder: FeatureReadiness = {
        featureId,
        enabled: false,
        status: "checking",
        checkedAt: null,
        checking: true,
        dependencyRevision: "",
        dependencies: [],
        operations: [],
        recoveryActions: [],
        limitations: [],
      };
      return redactFeature(placeholder, summariesById.get(featureId), input.currentRevision);
    }
    return redactFeature(row, summariesById.get(featureId), input.currentRevision);
  });

  return {
    schemaVersion: DIAGNOSTICS_REPORT_SCHEMA_VERSION,
    generatedAt: input.now ?? Date.now(),
    app: {
      version: safeToken(input.appVersion, "unknown")!,
      platformFamily: input.platformFamily,
    },
    scope: "session",
    notes,
    capabilityRevision: safeToken(input.capabilityRevision),
    features,
    tasks,
    truncation: {
      tasksOmitted: Math.max(0, orderedTasks.length - MAX_TASK_ENTRIES),
      featuresOmitted: 0,
      truncated: orderedTasks.length > MAX_TASK_ENTRIES,
    },
  };
}

export interface SerializedReport {
  readonly json: string;
  readonly bytes: number;
  readonly truncated: boolean;
}

/**
 * Serialize with a hard byte cap. If the object exceeds the cap the oldest
 * task detail is dropped (never truncated mid-string, which could leave
 * partial values). A visible truncation note stays in the object.
 */
export function serializeRedactedDiagnosticsReport(
  report: RedactedDiagnosticsReport,
  maxBytes = MAX_REPORT_BYTES
): SerializedReport {
  let candidate: RedactedDiagnosticsReport = report;
  let truncated = false;
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

  let json = JSON.stringify(candidate, null, 2);

  const dropTasks = (keep: number) => {
    const omitted = candidate.tasks.length - keep;
    if (omitted <= 0) return false;
    truncated = true;
    candidate = {
      ...candidate,
      tasks: candidate.tasks.slice(0, keep),
      truncation: {
        ...candidate.truncation,
        tasksOmitted: candidate.truncation.tasksOmitted + omitted,
        truncated: true,
      },
    };
    json = JSON.stringify(candidate, null, 2);
    return true;
  };

  while (encode(candidate) > maxBytes && candidate.tasks.length > 0) {
    const drop = Math.max(1, Math.ceil(candidate.tasks.length / 4));
    dropTasks(Math.max(0, candidate.tasks.length - drop));
  }

  // Compact formatting is still valid JSON and often enough on its own.
  if (encode(candidate) > maxBytes) {
    json = JSON.stringify(candidate);
  }

  // Drop stage detail (the oldest evidence) before the feature verdicts.
  if (encode(candidate) > maxBytes) {
    truncated = true;
    candidate = {
      ...candidate,
      features: candidate.features.map((feature) => ({
        ...feature,
        evidence: feature.evidence ? { ...feature.evidence, stages: [] } : undefined,
      })),
      truncation: { ...candidate.truncation, truncated: true },
    };
    json = JSON.stringify(candidate);
  }

  // Last resort: keep one row per feature with its verdict, drop the
  // dependency/operation/recovery detail and the long explanatory notes. The
  // report still parses, names every feature and states its scope; it never
  // emits a partial string.
  if (encode(candidate) > maxBytes) {
    truncated = true;
    candidate = {
      ...candidate,
      notes: ["Truncated to the configured size limit; scope and verdicts retained."],
      features: candidate.features.map((feature) => ({
        ...feature,
        // `undefined` is omitted by JSON.stringify — the minimal envelope
        // keeps only identity, enabled and status.
        checkedAt: undefined as never,
        dependencyRevisionPresent: undefined as never,
        dependencies: [],
        operations: [],
        limitations: [],
        recoveryTargets: [],
        providerClass: undefined,
        destination: undefined,
        evidence: undefined,
      })),
      truncation: { ...candidate.truncation, truncated: true },
    };
    json = JSON.stringify(candidate);
  }

  return {
    json,
    bytes: encode(candidate),
    truncated: truncated || candidate.truncation.truncated,
  };
}
