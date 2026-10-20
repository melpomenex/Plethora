/**
 * Feature readiness evaluator (F0, change
 * `harden-ai-learning-feature-initialization`, task 1.1).
 *
 * PURE: given a `FeatureDependencyContext` it returns the readiness rows for
 * every registered feature. No store reads, no inference, no downloads and no
 * indexing are possible from here — the caller gathers read-only probes.
 *
 * Status precedence (design): disabled preference → no permitted platform
 * route → unresolved setup/consent → explicit downloadable model →
 * index-building when required → typed error → ready. Checking never renders
 * as ready.
 */

import {
  FEATURE_DESCRIPTORS,
  FEATURE_IDS,
  RECOVERY_ACTIONS,
  recoveryFor,
  type DependencyCode,
  type DependencyState,
  type FeatureDependency,
  type FeatureDependencyContext,
  type FeatureDescriptor,
  type FeatureId,
  type FeatureOperationReadiness,
  type FeatureReadiness,
  type FeatureStatus,
  type OperationSpec,
  type RecoveryAction,
} from "./types";

const STATE_SEVERITY: Record<DependencyState, number> = {
  satisfied: 0,
  degraded: 1,
  checking: 2,
  unknown: 3,
  missing: 4,
  unsupported: 5,
};

function flagValue(ctx: FeatureDependencyContext, key: string): boolean {
  return ctx.flags[key] === true;
}

function featureEnabled(ctx: FeatureDependencyContext, descriptor: FeatureDescriptor): boolean {
  const anyOn = descriptor.flags.anyOf.some((key) => flagValue(ctx, key));
  if (!anyOn) return false;
  if (descriptor.flags.allOf) {
    return descriptor.flags.allOf.every((key) => flagValue(ctx, key));
  }
  return true;
}

function operationEnabled(
  ctx: FeatureDependencyContext,
  spec: OperationSpec
): boolean {
  if (!spec.flagKeys || spec.flagKeys.length === 0) return true;
  return spec.flagKeys.some((key) => flagValue(ctx, key));
}

interface DependencyResult {
  dependency: FeatureDependency;
  /** The status this dependency alone implies. */
  status: FeatureStatus;
}

function dependency(
  code: DependencyCode,
  state: DependencyState,
  reasonKey?: string,
  recovery?: RecoveryAction
): FeatureDependency {
  return { code, state, reasonKey, recovery: recovery ?? recoveryFor(code) };
}

function generationDependency(
  ctx: FeatureDependencyContext
): DependencyResult {
  const gen = ctx.generation;
  switch (gen.state) {
    case "available":
      return {
        dependency: dependency("generation", "satisfied"),
        status: "ready",
      };
    case "degraded":
      return {
        dependency: dependency("generation", "degraded", gen.reasonKey),
        status: "ready",
      };
    case "checking":
      return {
        dependency: dependency("generation", "checking", gen.reasonKey),
        status: "checking",
      };
    case "unsupported":
      return {
        dependency: dependency("platform", "unsupported", gen.reasonKey ?? "ai.reason.platformUnsupported"),
        status: "unavailable-platform",
      };
    case "unavailable":
      return {
        dependency: dependency(
          gen.modelDownloadRequired ? "model" : "generation",
          "missing",
          gen.reasonKey ?? "ai.reason.noGenerationRoute"
        ),
        status: gen.modelDownloadRequired ? "model-download-required" : "setup-required",
      };
    case "unknown":
    default:
      return {
        dependency: dependency("generation", "unknown", gen.reasonKey ?? "ai.reason.probeUnknown"),
        status: "checking",
      };
  }
}

function embeddingsDependency(
  ctx: FeatureDependencyContext,
  requirement: "required" | "optional"
): { dependency: FeatureDependency; status: FeatureStatus; limitation?: string } {
  const embeddings = ctx.embeddings;
  const lexical = embeddings.detail?.lexicalFallback === true;

  if (embeddings.state === "available" || embeddings.state === "degraded") {
    return {
      dependency: dependency("embeddings", "satisfied"),
      status: "ready",
    };
  }

  if (requirement === "optional" && lexical) {
    return {
      dependency: dependency(
        "lexical-retrieval",
        "degraded",
        embeddings.reasonKey ?? "ai.reason.lexicalOnly"
      ),
      status: "ready",
      limitation: "ai.limitation.lexicalRetrieval",
    };
  }

  if (embeddings.state === "checking") {
    return {
      dependency: dependency("embeddings", "checking", embeddings.reasonKey),
      status: "checking",
    };
  }
  if (embeddings.state === "unsupported") {
    return {
      dependency: dependency("embeddings", "unsupported", embeddings.reasonKey),
      status: requirement === "required" ? "unavailable-platform" : "ready",
      limitation: requirement === "required" ? undefined : "ai.limitation.lexicalRetrieval",
    };
  }
  if (embeddings.state === "unknown") {
    return {
      dependency: dependency("embeddings", "unknown", embeddings.reasonKey ?? "ai.reason.probeUnknown"),
      status: requirement === "required" ? "checking" : "ready",
      limitation: requirement === "required" ? undefined : "ai.limitation.lexicalRetrieval",
    };
  }
  return {
    dependency: dependency(
      embeddings.modelDownloadRequired ? "model" : "embeddings",
      "missing",
      embeddings.reasonKey ?? "ai.reason.noEmbeddingRoute"
    ),
    status: embeddings.modelDownloadRequired ? "model-download-required" : "setup-required",
  };
}

function indexDependency(
  ctx: FeatureDependencyContext,
  requirement: "required" | "optional"
): { dependency: FeatureDependency; status: FeatureStatus } {
  const index = ctx.index;
  switch (index.state) {
    case "ready":
      return { dependency: dependency("index", "satisfied"), status: "ready" };
    case "indexing":
    case "queued":
    case "paused":
      return {
        dependency: dependency("index", "missing", index.reasonKey ?? "ai.reason.indexing"),
        status: "indexing",
      };
    case "failed":
      return {
        dependency: dependency("index", "missing", index.reasonKey ?? "ai.reason.indexFailed"),
        status: "error",
      };
    case "not-started":
      return {
        dependency: dependency("index", "missing", index.reasonKey ?? "ai.reason.indexNotStarted"),
        status: requirement === "required" ? "indexing" : "ready",
      };
    case "unknown":
    default:
      return {
        dependency: dependency("index", "unknown", index.reasonKey ?? "ai.reason.probeUnknown"),
        status: requirement === "required" ? "checking" : "ready",
      };
  }
}

function ocrDependency(ctx: FeatureDependencyContext): DependencyResult {
  const ocr = ctx.ocr;
  if (ocr.state === "available") {
    return { dependency: dependency("ocr", "satisfied"), status: "ready" };
  }
  if (ocr.state === "checking") {
    return { dependency: dependency("ocr", "checking", ocr.reasonKey), status: "checking" };
  }
  if (ocr.state === "unsupported") {
    return {
      dependency: dependency("ocr", "unsupported", ocr.reasonKey ?? "ai.reason.ocrUnsupported"),
      status: "unavailable-platform",
    };
  }
  return {
    dependency: dependency(
      ocr.modelDownloadRequired ? "model" : "ocr",
      ocr.state === "unknown" ? "unknown" : "missing",
      ocr.reasonKey ?? "ai.reason.ocrUnavailable"
    ),
    status: ocr.modelDownloadRequired ? "model-download-required" : "setup-required",
  };
}

function relationshipDependency(
  ctx: FeatureDependencyContext,
  which: "prerequisites" | "links"
): DependencyResult {
  const rel = ctx.relationships;
  if (rel.state === "checking") {
    return { dependency: dependency("concept-store", "checking", rel.reasonKey), status: "checking" };
  }
  if (rel.state === "unsupported") {
    return {
      dependency: dependency("concept-store", "unsupported", rel.reasonKey ?? "ai.reason.conceptsUnavailable"),
      status: "setup-required",
    };
  }
  const available = which === "prerequisites" ? rel.detail?.prerequisites : rel.detail?.links;
  if (rel.state === "available" && available !== false) {
    return { dependency: dependency("concept-store", "satisfied"), status: "ready" };
  }
  return {
    dependency: dependency(
      "concept-store",
      rel.state === "unknown" ? "unknown" : "missing",
      rel.reasonKey ?? "ai.reason.conceptsUnavailable"
    ),
    status: rel.state === "unknown" ? "checking" : "setup-required",
  };
}

function capabilityDependency(
  code: DependencyCode,
  probe: FeatureDependencyContext["passageAdapter"],
  unavailableStatus: FeatureStatus
): DependencyResult {
  if (probe.state === "available" || probe.state === "degraded") {
    return { dependency: dependency(code, "satisfied"), status: "ready" };
  }
  if (probe.state === "checking") {
    return { dependency: dependency(code, "checking", probe.reasonKey), status: "checking" };
  }
  if (probe.state === "unsupported") {
    return {
      dependency: dependency(code, "unsupported", probe.reasonKey ?? "ai.reason.unsupported"),
      status: unavailableStatus,
    };
  }
  return {
    dependency: dependency(code, probe.state === "unknown" ? "unknown" : "missing", probe.reasonKey),
    status: probe.state === "unknown" ? "checking" : unavailableStatus,
  };
}

function consentDependencies(
  ctx: FeatureDependencyContext,
  spec: OperationSpec
): DependencyResult[] {
  const results: DependencyResult[] = [];
  if (spec.requires?.disclosure) {
    const disclosure = ctx.disclosure;
    if (disclosure.state === "available") {
      results.push({ dependency: dependency("disclosure", "satisfied"), status: "ready" });
    } else if (disclosure.state === "checking" || disclosure.state === "unknown") {
      results.push({
        dependency: dependency("disclosure", disclosure.state === "checking" ? "checking" : "unknown", disclosure.reasonKey),
        status: "checking",
      });
    } else {
      results.push({
        dependency: dependency("disclosure", "missing", disclosure.reasonKey ?? "ai.reason.disclosureRequired"),
        status: "setup-required",
      });
    }
  }
  if (spec.requires?.billing) {
    const billing = ctx.billing;
    if (billing.state === "available") {
      results.push({ dependency: dependency("billing", "satisfied"), status: "ready" });
    } else if (billing.state === "checking" || billing.state === "unknown") {
      results.push({
        dependency: dependency("billing", billing.state === "checking" ? "checking" : "unknown", billing.reasonKey),
        status: "checking",
      });
    } else {
      results.push({
        dependency: dependency("billing", "missing", billing.reasonKey ?? "ai.reason.billingRequired"),
        status: "setup-required",
      });
    }
  }
  return results;
}

/**
 * One operation's dependencies are conjunctive: every required dependency
 * must be satisfied (or explicitly degraded) before the operation is ready.
 * `ready` wins over `disabled` only when another sub-operation is independent.
 */
function aggregateOperationStatus(statuses: readonly FeatureStatus[]): FeatureStatus {
  if (statuses.length === 0) return "ready";
  if (statuses.includes("error")) return "error";
  if (statuses.includes("unavailable-platform")) return "unavailable-platform";
  if (statuses.includes("model-download-required")) return "model-download-required";
  if (statuses.includes("checking")) return "checking";
  if (statuses.includes("indexing")) return "indexing";
  if (statuses.includes("setup-required")) return "setup-required";
  if (statuses.every((status) => status === "disabled")) return "disabled";
  return "ready";
}

/**
 * A feature is ready only when every ENABLED operation is ready. One usable
 * operation beside a blocked one is not a ready feature; the operation rows
 * still expose the usable part (e.g. lexical retrieval beside an unavailable
 * answer route).
 */
function aggregateFeatureStatus(operations: readonly FeatureOperationReadiness[]): FeatureStatus {
  const enabled = operations.filter((operation) => operation.status !== "disabled");
  if (enabled.length === 0) return "disabled";
  if (enabled.length === 1) return enabled[0].status;
  return aggregateOperationStatus(enabled.map((operation) => operation.status));
}

function evaluateOperation(
  ctx: FeatureDependencyContext,
  spec: OperationSpec
): FeatureOperationReadiness {
  const deps: FeatureDependency[] = [];
  const statuses: FeatureStatus[] = [];
  const limitations: string[] = [];

  if (!operationEnabled(ctx, spec)) {
    return {
      operationId: spec.operationId,
      labelKey: spec.labelKey,
      status: "disabled",
      dependencies: [
        dependency("feature-enabled", "missing", "ai.reason.preferenceOff"),
      ],
    };
  }

  // The recall interaction mode is an independent preference: an intentional
  // `off` keeps the feature's prompts disabled even with `aiActiveRecall` on.
  if (spec.operationId === "recall-prompts" && ctx.activeRecallMode === "off") {
    return {
      operationId: spec.operationId,
      labelKey: spec.labelKey,
      status: "disabled",
      dependencies: [dependency("recall-mode", "missing", "ai.reason.recallModeOff")],
    };
  }

  const requires = spec.requires ?? {};

  if (requires.generation || requires.reasoning) {
    const result = generationDependency(ctx);
    deps.push(result.dependency);
    statuses.push(result.status);

    // Generation that leaves the device needs the existing cloud disclosure
    // regardless of which feature requested it. A keyless/LAN Ollama endpoint
    // is included: keyless is not local.
    const destination = ctx.generation.detail?.destination;
    if (destination === "lan" || destination === "remote" || destination === "unknown") {
      const disclosure = ctx.disclosure;
      if (disclosure.state === "available") {
        deps.push(dependency("disclosure", "satisfied"));
      } else if (disclosure.state === "checking" || disclosure.state === "unknown") {
        deps.push(dependency("disclosure", disclosure.state === "checking" ? "checking" : "unknown", disclosure.reasonKey));
        statuses.push("checking");
      } else {
        deps.push(dependency("disclosure", "missing", disclosure.reasonKey ?? "ai.reason.disclosureRequired"));
        statuses.push("setup-required");
      }
    }
  }
  if (requires.embeddings) {
    const result = embeddingsDependency(ctx, requires.embeddings);
    deps.push(result.dependency);
    statuses.push(result.status);
    if (result.limitation) limitations.push(result.limitation);
  }
  if (requires.index) {
    const result = indexDependency(ctx, requires.index);
    deps.push(result.dependency);
    // An optional index that is still building must not pretend the whole
    // operation is blocked; it degrades to lexical/partial retrieval.
    if (requires.index === "optional" && result.status === "indexing") {
      deps[deps.length - 1] = dependency(
        "index",
        "degraded",
        result.dependency.reasonKey
      );
      limitations.push("ai.limitation.indexing");
    } else {
      statuses.push(result.status);
    }
  }
  if (requires.ocr) {
    const result = ocrDependency(ctx);
    deps.push(result.dependency);
    statuses.push(result.status);
  }
  if (requires.relationships) {
    const result = relationshipDependency(ctx, requires.relationships);
    deps.push(result.dependency);
    statuses.push(result.status);
  }
  if (requires.passageAdapter) {
    const result = capabilityDependency("passage-adapter", ctx.passageAdapter, "unavailable-platform");
    deps.push(result.dependency);
    statuses.push(result.status);
  }
  if (requires.source) {
    const result = capabilityDependency("source", ctx.source, "setup-required");
    deps.push(result.dependency);
    statuses.push(result.status);
  }
  for (const result of consentDependencies(ctx, spec)) {
    deps.push(result.dependency);
    statuses.push(result.status);
  }

  return {
    operationId: spec.operationId,
    labelKey: spec.labelKey,
    status: aggregateOperationStatus(statuses),
    degradedReasonKey: limitations[0],
    dependencies: deps,
  };
}

function collectDependencies(
  operations: readonly FeatureOperationReadiness[],
  enabled: boolean
): FeatureDependency[] {
  const byCode = new Map<DependencyCode, FeatureDependency>();
  if (!enabled) {
    byCode.set("feature-enabled", dependency("feature-enabled", "missing", "ai.reason.preferenceOff"));
  }
  for (const operation of operations) {
    for (const dep of operation.dependencies) {
      const existing = byCode.get(dep.code);
      if (!existing || STATE_SEVERITY[dep.state] > STATE_SEVERITY[existing.state]) {
        byCode.set(dep.code, dep);
      }
    }
  }
  return [...byCode.values()];
}

function collectRecovery(
  dependencies: readonly FeatureDependency[],
  descriptor: FeatureDescriptor
): RecoveryAction[] {
  const seen = new Set<string>();
  const actions: RecoveryAction[] = [];
  for (const dep of dependencies) {
    const action = dep.recovery;
    if (!action || seen.has(action.targetId)) continue;
    seen.add(action.targetId);
    actions.push(action);
  }
  // Always offer the feature's own settings row as a fallback destination.
  const own = RECOVERY_ACTIONS[descriptor.id === "knowledge-relationships" ? "ai.prerequisites" : "ai.featureReadiness"];
  if (own && !seen.has(own.targetId)) actions.push(own);
  return actions;
}

function collectLimitations(operations: readonly FeatureOperationReadiness[]): string[] {
  const seen = new Set<string>();
  for (const operation of operations) {
    if (operation.degradedReasonKey) seen.add(operation.degradedReasonKey);
  }
  return [...seen];
}

/** Evaluate every registered feature from one dependency context. */
export function evaluateFeatureReadiness(
  ctx: FeatureDependencyContext
): FeatureReadiness[] {
  return FEATURE_IDS.map((id) => evaluateFeature(ctx, FEATURE_DESCRIPTORS[id]));
}

export function evaluateFeature(
  ctx: FeatureDependencyContext,
  descriptor: FeatureDescriptor
): FeatureReadiness {
  const enabled = featureEnabled(ctx, descriptor);
  const operations = descriptor.operations.map((spec) => evaluateOperation(ctx, spec));
  const dependencies = collectDependencies(operations, enabled);
  const status = enabled ? aggregateFeatureStatus(operations) : "disabled";

  return {
    featureId: descriptor.id,
    enabled,
    status,
    checkedAt: ctx.checkedAt,
    checking: ctx.checking,
    dependencyRevision: ctx.revision,
    dependencies,
    operations,
    provider:
      ctx.generation.detail && (ctx.generation.state === "available" || ctx.generation.state === "degraded")
        ? {
            providerClass: ctx.generation.detail.providerClass,
            destination: ctx.generation.detail.destination,
          }
        : undefined,
    recoveryActions: enabled ? collectRecovery(dependencies, descriptor) : [],
    limitations: collectLimitations(operations),
  };
}

/** Convenience lookup for a single feature from a precomputed row set. */
export function findFeatureReadiness(
  rows: readonly FeatureReadiness[],
  featureId: FeatureId
): FeatureReadiness | undefined {
  return rows.find((row) => row.featureId === featureId);
}

/** Summary used by Enable All: enabled vs ready vs setup counts. */
export interface ActivationSummary {
  total: number;
  ready: number;
  needsSetup: number;
  unsupported: number;
  disabled: number;
}

export function summarizeActivation(
  rows: readonly FeatureReadiness[]
): ActivationSummary {
  let ready = 0;
  let needsSetup = 0;
  let unsupported = 0;
  let disabled = 0;
  for (const row of rows) {
    if (row.status === "ready") ready += 1;
    else if (row.status === "unavailable-platform") unsupported += 1;
    else if (row.status === "disabled") disabled += 1;
    else needsSetup += 1;
  }
  return { total: rows.length, ready, needsSetup, unsupported, disabled };
}

/** The main feature flags Enable All may change. Deliberately exhaustive. */
export const ENABLE_ALL_FLAG_KEYS = [
  "aiLearnThis",
  "aiLibraryRag",
  "aiSocraticTutor",
  "aiOcclusionAssist",
  "aiSemanticIndex",
  "aiActiveRecall",
  "aiAnswerAssessment",
  "aiPrerequisites",
  "aiConceptLinks",
  "aiExtractWorthiness",
  "aiAgent",
] as const;

/**
 * Flags Enable All must NEVER touch: provider choice, fallback, paid
 * embeddings, freeform vision, active-recall interaction mode.
 */
export const ENABLE_ALL_PRESERVED_FLAG_KEYS = [
  "aiOcclusionFreeform",
] as const;
